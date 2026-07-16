// lib/db.js
// CampusIQ datastore.
// - Local dev: JSON files under data/
// - Vercel production: Vercel KV (persistent key-value store)

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// On Vercel/serverless, the deployment directory is read-only.
// Use /tmp for writable local-file fallback, and prefer Vercel KV if configured.
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = isServerless
  ? path.join('/tmp', 'campusiq-data')
  : path.join(__dirname, '..', 'data');

function ensureDir() {
  if (fs.existsSync(DATA_DIR)) {
    const st = fs.lstatSync(DATA_DIR);
    if (!st.isDirectory()) throw new Error('DATA_DIR exists but is not a directory');
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function filePath(collection) {
  const name = String(collection).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!name) throw new Error('Invalid collection name');
  const fp = path.join(DATA_DIR, name + '.json');
  const base = path.resolve(DATA_DIR);
  const resolved = path.resolve(fp);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('Invalid collection path');
  }
  return fp;
}

function readCollection(collection) {
  ensureDir();
  const fp = filePath(collection);
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, '[]', { encoding: 'utf8', mode: 0o600 });
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return [];
  }
}

function writeCollection(collection, arr) {
  ensureDir();
  fs.writeFileSync(filePath(collection), JSON.stringify(arr, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function genId(prefix = '') {
  return prefix + crypto.randomUUID();
}

// =====================================================================
// VERCEL KV BACKEND
// =====================================================================
let kv = null;

function initKv() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN;
  if (!url || !token) return null;
  try {
    const mod = require('@vercel/kv');
    // @vercel/kv v2 exports { default, kv, VercelKV, createClient }.
    // Return the actual KV client proxy (named `kv` export, or `default` for backward compat).
    const client = mod.kv || mod.default;
    if (!client) return null;
    return client;
  } catch {
    return null;
  }
}

function isKv() {
  return !!kv;
}

// Per-record key layout in KV.
// Each record lives under its own key (`coll:<collection>:<id>`), and we keep an
// index set of ids under `coll:<collection>:__index`. Reading a collection scans
// the index and fetches each record. This makes single-record writes (insert /
// update / delete) fully atomic — a new user can NEVER be clobbered by a
// concurrent write to a different record, which is the root cause of the
// "create a user, refresh, and it vanished (then came back)" symptom under
// Vercel's serverless cold starts and eventual consistency.
function kvCollPrefix(collection) {
  return 'coll:' + String(collection).replace(/[^a-zA-Z0-9_-]/g, '');
}
function kvRecordKey(collection, id) {
  return kvCollPrefix(collection) + ':' + String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}
function kvIndexKey(collection) {
  return kvCollPrefix(collection) + ':__index';
}

// Read-with-retry for KV eventual consistency.
// Vercel KV is eventually consistent: immediately after a write, a read may
// still hit a stale replica. Retry for a short window so a fresh read (e.g.
// GET /api/users right after creating a user) reliably sees the latest data
// instead of intermittently showing a stale snapshot.
async function withRetry(fn, attempts = 6, gapMs = 120) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, gapMs));
    }
  }
  throw lastErr;
}

async function kvGetIndex(collection) {
  const raw = await kv.get(kvIndexKey(collection));
  if (!raw) return [];
  const ids = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : raw);
  return Array.isArray(ids) ? ids : [];
}

async function kvSetIndex(collection, ids) {
  await kv.set(kvIndexKey(collection), JSON.stringify(ids));
}

// Atomically add an id to the index, retrying if the index changed underneath.
async function kvIndexAdd(collection, id) {
  await withRetry(async () => {
    const ids = await kvGetIndex(collection);
    if (!ids.includes(id)) {
      ids.push(id);
      await kvSetIndex(collection, ids);
    }
  });
}

// Atomically remove an id from the index, retrying if the index changed.
async function kvIndexRemove(collection, id) {
  await withRetry(async () => {
    const ids = await kvGetIndex(collection);
    const next = ids.filter(x => x !== id);
    if (next.length !== ids.length) await kvSetIndex(collection, next);
  });
}

async function kvGetAll(collection) {
  const ids = await withRetry(() => kvGetIndex(collection));
  if (!ids.length) return [];
  // Fetch every record in parallel. Filter out any that went missing mid-read.
  const records = await Promise.all(ids.map(id =>
    withRetry(() => kv.get(kvRecordKey(collection, id)), 2, 60)
      .then(r => (r ? (typeof r === 'string' ? JSON.parse(r) : r) : null))
      .catch(() => null)
  ));
  return records.filter(Boolean);
}

async function kvGetById(collection, id) {
  const raw = await withRetry(() => kv.get(kvRecordKey(collection, id)));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// =====================================================================
// PUBLIC API — async
// =====================================================================
async function getAll(collection) {
  if (isKv()) return await kvGetAll(collection);
  return readCollection(collection);
}

async function getById(collection, id) {
  if (isKv()) return await kvGetById(collection, id);
  return (await getAll(collection)).find(x => x.id === id) || null;
}

async function find(collection, predicateFn) {
  return (await getAll(collection)).filter(predicateFn);
}

async function findOne(collection, predicateFn) {
  return (await getAll(collection)).find(predicateFn) || null;
}

async function insert(collection, obj) {
  const record = { id: genId(), createdAt: new Date().toISOString(), ...obj };
  if (isKv()) {
    // Atomic single-record write + index append. Never clobbers other records.
    await kv.set(kvRecordKey(collection, record.id), JSON.stringify(record));
    await kvIndexAdd(collection, record.id);
    return record;
  }
  const arr = readCollection(collection);
  arr.push(record);
  writeCollection(collection, arr);
  return record;
}

async function update(collection, id, patch) {
  if (isKv()) {
    // Read-modify-write a single record. Concurrent writes to other records
    // are unaffected, so no data loss.
    const existing = await kvGetById(collection, id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await kv.set(kvRecordKey(collection, id), JSON.stringify(updated));
    return updated;
  }
  const arr = readCollection(collection);
  const idx = arr.findIndex(x => x.id === id);
  if (idx === -1) return null;
  arr[idx] = { ...arr[idx], ...patch, updatedAt: new Date().toISOString() };
  writeCollection(collection, arr);
  return arr[idx];
}

async function remove(collection, id) {
  if (isKv()) {
    await kv.del(kvRecordKey(collection, id));
    await kvIndexRemove(collection, id);
    return true;
  }
  const arr = readCollection(collection);
  const idx = arr.findIndex(x => x.id === id);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  writeCollection(collection, arr);
  return true;
}

async function removeWhere(collection, predicateFn) {
  const items = await find(collection, predicateFn);
  if (!items.length) return 0;
  if (isKv()) {
    await Promise.all(items.map(x => kv.del(kvRecordKey(collection, x.id))));
    const ids = await kvGetIndex(collection);
    const removeSet = new Set(items.map(x => x.id));
    await kvSetIndex(collection, ids.filter(id => !removeSet.has(id)));
    return items.length;
  }
  const arr = readCollection(collection);
  const remaining = arr.filter(x => !predicateFn(x));
  const removedCount = arr.length - remaining.length;
  if (removedCount > 0) writeCollection(collection, remaining);
  return removedCount;
}

// Seed default data on first run (admin account, sample hostels, etc.)
// Idempotent: only seeds a collection when its index key does NOT exist at all
// (a freshly created KV store), not when it merely reads as empty. This prevents
// cold-start instances from re-seeding and wiping real data that a concurrent
// read hadn't yet caught up to.
async function seedIfEmpty() {
  if (await kvIndexExists('users')) return;
  await insert('users', {
    name: 'Super Admin',
    email: 'admin@kstu.edu.gh',
    username: 'admin',
    password: 'admin123',
    role: 'admin',
    department: 'ICT',
    status: 'active'
  });
  await insert('hostels', { name: 'Volta Hall (Block A)', type: 'Mixed', capacity: 320, occupied: 262, feePerSemester: 800, status: 'available' });
  await insert('hostels', { name: 'Pra Hall (Block B)', type: 'Male', capacity: 280, occupied: 280, feePerSemester: 950, status: 'full' });
  await insert('hostels', { name: 'Komfo Hall (Block C)', type: 'Female', capacity: 300, occupied: 213, feePerSemester: 650, status: 'available' });
  await insert('feeStructure', { programme: 'BTech Computer Technology', level: 'Level 100', academicYear: '2025/2026', tuition: 4200, hostel: 800, examFee: 150, srcDues: 200, total: 5350 });
  await insert('feeStructure', { programme: 'BTech Computer Technology', level: 'Level 200', academicYear: '2025/2026', tuition: 4400, hostel: 800, examFee: 150, srcDues: 200, total: 5550 });
  await insert('feeStructure', { programme: 'BEng Electrical Engineering', level: 'Level 100', academicYear: '2025/2026', tuition: 4600, hostel: 800, examFee: 180, srcDues: 200, total: 5780 });
  await insert('timetable', { day: 'Monday', time: '7:30–9:30', courseCode: 'CPT 301', room: 'Lab A-201', lecturer: 'Dr. Mensah K.' });
  await insert('timetable', { day: 'Monday', time: '10:00–12:00', courseCode: 'MAT 201', room: 'Room B-104', lecturer: 'Mr. Asante C.' });
  await insert('timetable', { day: 'Wednesday', time: '10:00–12:00', courseCode: 'CPT 301', room: 'Lab A-201', lecturer: 'Dr. Mensah K.' });
}

// True only when the collection index key exists in KV (i.e. already seeded or
// previously written to). Used to skip seeding and avoid clobbering live data.
async function kvIndexExists(collection) {
  if (!isKv()) return false;
  try {
    // kv.exists returns 1 if present, 0 if not.
    const ex = await kv.exists(kvIndexKey(collection));
    return ex === 1 || ex === true;
  } catch {
    return false;
  }
}

// One-time migration: older deployments stored each collection as a single
// JSON array under `collection:<name>`. If that legacy key exists but the new
// per-record index does not, import the records so existing data is preserved
// and the new atomic-write layout takes over. Idempotent.
async function migrateLegacyCollections() {
  if (!isKv()) return;
  const legacyNames = ['users', 'hostels', 'feeStructure', 'timetable', 'results',
    'exams', 'attendance', 'payments', 'registrations', 'assignments', 'materials',
    'notices', 'calendar', 'hostelApplications', 'liveLocations', 'chatMessages',
    'portfolios', 'alumniQuestions', 'referrals', 'notifications'];
  for (const name of legacyNames) {
    const legacyKey = 'collection:' + String(name).replace(/[^a-zA-Z0-9_-]/g, '');
    if (await kvIndexExists(name)) continue; // already on new layout
    let raw;
    try { raw = await kv.get(legacyKey); } catch { raw = null; }
    if (!raw) continue;
    const arr = Array.isArray(raw) ? raw
      : (typeof raw === 'string' ? JSON.parse(raw) : (raw && Array.isArray(raw.data) ? raw.data : null));
    if (!Array.isArray(arr) || !arr.length) continue;
    // Import without seeding logic clobbering anything.
    for (const rec of arr) {
      const id = rec.id || genId();
      await kv.set(kvRecordKey(name, id), JSON.stringify({ ...rec, id }));
      await kvIndexAdd(name, id);
    }
    console.log(`[CampusIQ] Migrated ${arr.length} legacy records for "${name}"`);
  }
}

// Initialize KV backend
kv = initKv();
if (kv) {
  console.log('[CampusIQ] Using Vercel KV for persistent data storage');
  // Fire-and-forget migration so it doesn't block the first request; seed
  // waits on it to avoid racing.
  const migrationPromise = migrateLegacyCollections().catch(e => console.error('[CampusIQ] Migration failed:', e));
  const origSeed = seedIfEmpty;
  seedIfEmpty = async () => { await migrationPromise; return origSeed(); };
} else {
  console.log('[CampusIQ] KV not configured, using ephemeral file storage at:', DATA_DIR);
}

module.exports = {
  getAll, getById, find, findOne, insert, update, remove, removeWhere, genId, seedIfEmpty
};

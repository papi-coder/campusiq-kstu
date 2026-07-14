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

function kvKey(collection) {
  return 'collection:' + String(collection).replace(/[^a-zA-Z0-9_-]/g, '');
}

async function kvGet(collection) {
  const raw = await kv.get(kvKey(collection));
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return JSON.parse(raw);
  return raw;
}

async function kvSet(collection, arr) {
  await kv.set(kvKey(collection), JSON.stringify(arr));
}

// =====================================================================
// PUBLIC API — async
// =====================================================================
async function getAll(collection) {
  if (isKv()) return await kvGet(collection);
  return readCollection(collection);
}

async function getById(collection, id) {
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
    const arr = await kvGet(collection);
    arr.push(record);
    await kvSet(collection, arr);
  } else {
    const arr = readCollection(collection);
    arr.push(record);
    writeCollection(collection, arr);
  }
  return record;
}

async function update(collection, id, patch) {
  if (isKv()) {
    const arr = await kvGet(collection);
    const idx = arr.findIndex(x => x.id === id);
    if (idx === -1) return null;
    arr[idx] = { ...arr[idx], ...patch, updatedAt: new Date().toISOString() };
    await kvSet(collection, arr);
    return arr[idx];
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
    const arr = await kvGet(collection);
    const idx = arr.findIndex(x => x.id === id);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    await kvSet(collection, arr);
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
  if (isKv()) {
    const arr = await kvGet(collection);
    const remaining = arr.filter(x => !predicateFn(x));
    const removedCount = arr.length - remaining.length;
    if (removedCount > 0) await kvSet(collection, remaining);
    return removedCount;
  }
  const arr = readCollection(collection);
  const remaining = arr.filter(x => !predicateFn(x));
  const removedCount = arr.length - remaining.length;
  if (removedCount > 0) writeCollection(collection, remaining);
  return removedCount;
}

// Seed default data on first run (admin account, sample hostels, etc.)
async function seedIfEmpty() {
  if ((await getAll('users')).length === 0) {
   await insert('users', {
     name: 'Super Admin',
     email: 'admin@kstu.edu.gh',
     username: 'admin',
     password: 'admin123',
     role: 'admin',
     department: 'ICT',
     status: 'active'
   });
  }
  if ((await getAll('hostels')).length === 0) {
    await insert('hostels', { name: 'Volta Hall (Block A)', type: 'Mixed', capacity: 320, occupied: 262, feePerSemester: 800, status: 'available' });
    await insert('hostels', { name: 'Pra Hall (Block B)', type: 'Male', capacity: 280, occupied: 280, feePerSemester: 950, status: 'full' });
    await insert('hostels', { name: 'Komfo Hall (Block C)', type: 'Female', capacity: 300, occupied: 213, feePerSemester: 650, status: 'available' });
  }
  if ((await getAll('feeStructure')).length === 0) {
    await insert('feeStructure', { programme: 'BTech Computer Technology', level: 'Level 100', academicYear: '2025/2026', tuition: 4200, hostel: 800, examFee: 150, srcDues: 200, total: 5350 });
    await insert('feeStructure', { programme: 'BTech Computer Technology', level: 'Level 200', academicYear: '2025/2026', tuition: 4400, hostel: 800, examFee: 150, srcDues: 200, total: 5550 });
    await insert('feeStructure', { programme: 'BEng Electrical Engineering', level: 'Level 100', academicYear: '2025/2026', tuition: 4600, hostel: 800, examFee: 180, srcDues: 200, total: 5780 });
  }
  if ((await getAll('timetable')).length === 0) {
    await insert('timetable', { day: 'Monday', time: '7:30–9:30', courseCode: 'CPT 301', room: 'Lab A-201', lecturer: 'Dr. Mensah K.' });
    await insert('timetable', { day: 'Monday', time: '10:00–12:00', courseCode: 'MAT 201', room: 'Room B-104', lecturer: 'Mr. Asante C.' });
    await insert('timetable', { day: 'Wednesday', time: '10:00–12:00', courseCode: 'CPT 301', room: 'Lab A-201', lecturer: 'Dr. Mensah K.' });
  }
}

// Initialize KV backend
kv = initKv();
if (kv) {
  console.log('[CampusIQ] Using Vercel KV for persistent data storage');
} else {
  console.log('[CampusIQ] KV not configured, using ephemeral file storage at:', DATA_DIR);
}

module.exports = {
  getAll, getById, find, findOne, insert, update, remove, removeWhere, genId, seedIfEmpty
};

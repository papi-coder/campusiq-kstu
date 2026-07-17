// lib/db.js
// CampusIQ datastore — PostgreSQL via Supabase.
// Falls back to local JSON files if SUPABASE_DB_URL is not set.

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const DATA_DIR = path.join(__dirname, '..', 'data');

let pool = null;
let usePostgres = false;

function initPostgres() {
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) return false;
  try {
    pool = new Pool({
      connectionString: url,
      ssl: url.includes('supabase') || url.includes('pooler') ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
    usePostgres = true;
    console.log('[CampusIQ] Using PostgreSQL (Supabase) for persistent data storage');
    return true;
  } catch (e) {
    console.warn('[CampusIQ] PostgreSQL init failed, falling back to JSON:', e.message);
    return false;
  }
}

const pgReady = initPostgres();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

function filePath(collection) {
  const name = String(collection).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!name) throw new Error('Invalid collection name');
  return path.join(DATA_DIR, name + '.json');
}

function readCollection(collection) {
  ensureDataDir();
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
  ensureDataDir();
  fs.writeFileSync(filePath(collection), JSON.stringify(arr, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function genId(prefix = '') {
  return prefix + crypto.randomUUID();
}

async function pgEnsureTable(collection) {
  const safeName = String(collection).replace(/[^a-zA-Z0-9_]/g, '');
  if (!safeName) throw new Error('Invalid collection name');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${safeName}" (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "${safeName}_data_idx" ON "${safeName}" USING GIN (data)`);
}

// =====================================================================
// PUBLIC API — async
// =====================================================================

async function getAll(collection) {
  if (!usePostgres) return readCollection(collection);
  await pgEnsureTable(collection);
  const res = await pool.query(`SELECT data FROM "${collection}"`);
  return res.rows.map(r => r.data);
}

async function getById(collection, id) {
  if (!usePostgres) return (await getAll(collection)).find(x => x.id === id) || null;
  await pgEnsureTable(collection);
  const res = await pool.query(`SELECT data FROM "${collection}" WHERE id = $1`, [id]);
  return res.rows[0]?.data || null;
}

async function find(collection, predicateFn) {
  if (!usePostgres) {
    const all = await getAll(collection);
    if (typeof predicateFn !== 'function') return all;
    return all.filter(predicateFn);
  }
  await pgEnsureTable(collection);
  const all = await pool.query(`SELECT data FROM "${collection}"`);
  const rows = all.rows.map(r => r.data);
  if (typeof predicateFn !== 'function') return rows;
  return rows.filter(predicateFn);
}

async function findOne(collection, predicateFn) {
  if (!usePostgres) {
    const all = await getAll(collection);
    if (typeof predicateFn !== 'function') return all[0] || null;
    return all.find(predicateFn) || null;
  }
  await pgEnsureTable(collection);
  const all = await pool.query(`SELECT data FROM "${collection}"`);
  const rows = all.rows.map(r => r.data);
  if (typeof predicateFn !== 'function') return rows[0] || null;
  return rows.find(predicateFn) || null;
}

async function insert(collection, obj) {
  const record = { id: genId(), createdAt: new Date().toISOString(), ...obj };
  if (!usePostgres) {
    const arr = readCollection(collection);
    arr.push(record);
    writeCollection(collection, arr);
    return record;
  }
  await pgEnsureTable(collection);
  await pool.query(
    `INSERT INTO "${collection}" (id, data, created_at, updated_at) VALUES ($1, $2, $3, $4)`,
    [record.id, JSON.stringify(record), record.createdAt, record.createdAt]
  );
  return record;
}

async function update(collection, id, patch) {
  if (!usePostgres) {
    const arr = readCollection(collection);
    const idx = arr.findIndex(x => x.id === id);
    if (idx === -1) return null;
    const updated = { ...arr[idx], ...patch, updatedAt: new Date().toISOString() };
    arr[idx] = updated;
    writeCollection(collection, arr);
    return updated;
  }
  await pgEnsureTable(collection);
  const existing = await pool.query(`SELECT data FROM "${collection}" WHERE id = $1`, [id]);
  if (!existing.rows.length) return null;
  const updated = { ...existing.rows[0].data, ...patch, updatedAt: new Date().toISOString() };
  await pool.query(
    `UPDATE "${collection}" SET data = $1, updated_at = $2 WHERE id = $3`,
    [JSON.stringify(updated), updated.updatedAt, id]
  );
  return updated;
}

async function remove(collection, id) {
  if (!usePostgres) {
    const arr = readCollection(collection);
    const idx = arr.findIndex(x => x.id === id);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    writeCollection(collection, arr);
    return true;
  }
  await pgEnsureTable(collection);
  const res = await pool.query(`DELETE FROM "${collection}" WHERE id = $1`, [id]);
  return (res.rowCount || 0) > 0;
}

async function removeWhere(collection, predicateFn) {
  if (!usePostgres) {
    const arr = readCollection(collection);
    const remaining = arr.filter(x => !predicateFn(x));
    const removedCount = arr.length - remaining.length;
    if (removedCount > 0) writeCollection(collection, remaining);
    return removedCount;
  }
  await pgEnsureTable(collection);
  const all = await pool.query(`SELECT id, data FROM "${collection}"`);
  const toRemove = all.rows.filter(r => predicateFn(r.data));
  if (!toRemove.length) return 0;
  await pool.query(`DELETE FROM "${collection}" WHERE id = ANY($1)`, [toRemove.map(r => r.id)]);
  return toRemove.length;
}

// Seed default data on first run (idempotent)
async function seedIfEmpty() {
  if (!usePostgres) {
    ensureDataDir();
    const fp = filePath('users');
    if (fs.existsSync(fp)) {
      try {
        const existing = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (existing.length) return;
      } catch {}
    }
  }

  await pgEnsureTable('users');

  const defaults = [
    { collection: 'users', record: { name: 'Super Admin', email: 'admin@kstu.edu.gh', username: 'admin', password: 'admin123', role: 'admin', department: 'ICT', status: 'active' } },
    { collection: 'hostels', record: { name: 'Volta Hall (Block A)', type: 'Mixed', capacity: 320, occupied: 262, feePerSemester: 800, status: 'available' } },
    { collection: 'hostels', record: { name: 'Pra Hall (Block B)', type: 'Male', capacity: 280, occupied: 280, feePerSemester: 950, status: 'full' } },
    { collection: 'hostels', record: { name: 'Komfo Hall (Block C)', type: 'Female', capacity: 300, occupied: 213, feePerSemester: 650, status: 'available' } },
    { collection: 'feeStructure', record: { programme: 'BTech Computer Technology', level: 'Level 100', academicYear: '2025/2026', tuition: 4200, hostel: 800, examFee: 150, srcDues: 200, total: 5350 } },
    { collection: 'feeStructure', record: { programme: 'BTech Computer Technology', level: 'Level 200', academicYear: '2025/2026', tuition: 4400, hostel: 800, examFee: 150, srcDues: 200, total: 5550 } },
    { collection: 'feeStructure', record: { programme: 'BEng Electrical Engineering', level: 'Level 100', academicYear: '2025/2026', tuition: 4600, hostel: 800, examFee: 180, srcDues: 200, total: 5780 } },
    { collection: 'timetable', record: { day: 'Monday', time: '7:30–9:30', courseCode: 'CPT 301', room: 'Lab A-201', lecturer: 'Dr. Mensah K.' } },
    { collection: 'timetable', record: { day: 'Monday', time: '10:00–12:00', courseCode: 'MAT 201', room: 'Room B-104', lecturer: 'Mr. Asante C.' } },
    { collection: 'timetable', record: { day: 'Wednesday', time: '10:00–12:00', courseCode: 'CPT 301', room: 'Lab A-201', lecturer: 'Dr. Mensah K.' } },
  ];

  for (const item of defaults) {
    let exists = false;
    if (usePostgres) {
      const safeName = String(item.collection).replace(/[^a-zA-Z0-9_]/g, '');
      const checks = [];
      const params = [];
      let p = 1;
      if (item.record.email) { checks.push(`(data->>'email') = $${p++}`); params.push(item.record.email); }
      if (item.record.name) { checks.push(`(data->>'name') = $${p++}`); params.push(item.record.name); }
      if (item.record.day) { checks.push(`(data->>'day') = $${p++}`); params.push(item.record.day); }
      if (checks.length) {
        const res = await pool.query(`SELECT id FROM "${safeName}" WHERE ${checks.join(' OR ')} LIMIT 1`, params);
        exists = res.rows.length > 0;
      }
    } else {
      exists = !!await findOne(item.collection, r => r.name === item.record.name || r.email === item.record.email || r.day === item.record.day);
    }
    if (!exists) await insert(item.collection, item.record);
  }
}

// Migration helper: one-time import from legacy JSON arrays in data/
async function migrateFromJson() {
  if (!usePostgres) return;
  const collections = ['users', 'hostels', 'feeStructure', 'timetable', 'results',
    'exams', 'attendance', 'payments', 'registrations', 'assignments', 'materials',
    'notices', 'calendar', 'hostelApplications', 'liveLocations', 'chatMessages',
    'portfolios', 'alumniQuestions', 'referrals', 'notifications'];
  for (const name of collections) {
    const fp = path.join(DATA_DIR, name + '.json');
    if (!fs.existsSync(fp)) continue;
    try {
      const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (!Array.isArray(arr) || !arr.length) continue;
      await pgEnsureTable(name);
      const existing = await pool.query(`SELECT COUNT(*) FROM "${name}"`);
      if (Number(existing.rows[0].count) > 0) continue; // already migrated
      for (const rec of arr) {
        const id = rec.id || genId();
        await pool.query(`INSERT INTO "${name}" (id, data, created_at, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
          [id, JSON.stringify({ ...rec, id }), rec.createdAt || new Date().toISOString(), rec.updatedAt || new Date().toISOString()]);
      }
      console.log(`[CampusIQ] Migrated ${arr.length} records from ${name}.json to PostgreSQL`);
    } catch (e) {
      console.warn(`[CampusIQ] Migration failed for ${name}:`, e.message);
    }
  }
}

module.exports = {
  getAll,
  getById,
  find,
  findOne,
  insert,
  update,
  remove,
  removeWhere,
  genId,
  seedIfEmpty,
  migrateFromJson,
  get pool() { return pool; },
  get isPostgres() { return usePostgres; },
};

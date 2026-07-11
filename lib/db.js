// lib/db.js
// Simple JSON-file-based datastore for local development.
// On Vercel, /tmp is writable but NOT persistent across deployments or cold starts reliably.
// For production persistence across all users/devices, swap this file's internals to use
// Vercel Postgres or Vercel KV (see DEPLOY.md in project root for exact instructions).
// The function signatures below (getAll, getById, insert, update, remove) stay the same
// either way, so no other file needs to change.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// Resolve the datastore directory.
// Locally it lives inside the project (not publicly writable).
// On Vercel, /tmp is world-writable, so we never reuse a predictable path
// there: fs.mkdtempSync() creates a unique, owner-only subdirectory with a
// random suffix that another local user cannot pre-plant as a symlink or
// pre-create (mitigates symlink/race attacks in shared temp dirs).
function resolveDataDir() {
  if (process.env.VERCEL) {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'campusiq-data-'));
  }
  return path.join(__dirname, '..', 'data');
}

const DATA_DIR = resolveDataDir();

function ensureDir() {
  if (fs.existsSync(DATA_DIR)) {
    // Reject symlinks / non-directories so a pre-planted symlink in a world-writable
    // dir (e.g. /tmp on Vercel) cannot redirect reads/writes to an attacker-controlled path.
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

function getAll(collection) {
  return readCollection(collection);
}

function getById(collection, id) {
  return readCollection(collection).find(x => x.id === id) || null;
}

function find(collection, predicateFn) {
  return readCollection(collection).filter(predicateFn);
}

function findOne(collection, predicateFn) {
  return readCollection(collection).find(predicateFn) || null;
}

function insert(collection, obj) {
  const arr = readCollection(collection);
  const record = { id: genId(), createdAt: new Date().toISOString(), ...obj };
  arr.push(record);
  writeCollection(collection, arr);
  return record;
}

function update(collection, id, patch) {
  const arr = readCollection(collection);
  const idx = arr.findIndex(x => x.id === id);
  if (idx === -1) return null;
  arr[idx] = { ...arr[idx], ...patch, updatedAt: new Date().toISOString() };
  writeCollection(collection, arr);
  return arr[idx];
}

function remove(collection, id) {
  const arr = readCollection(collection);
  const idx = arr.findIndex(x => x.id === id);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  writeCollection(collection, arr);
  return true;
}

function removeWhere(collection, predicateFn) {
  const arr = readCollection(collection);
  const remaining = arr.filter(x => !predicateFn(x));
  const removedCount = arr.length - remaining.length;
  writeCollection(collection, remaining);
  return removedCount;
}

// Seed default data on first run (admin account, sample hostels, etc.)
function seedIfEmpty() {
  if (getAll('users').length === 0) {
   insert('users', {
     name: 'Super Admin',
     email: 'admin@kstu.edu.gh',
     username: 'admin',
     password: 'admin123',
     role: 'admin',
     department: 'ICT',
     status: 'active'
   });
  }
  if (getAll('hostels').length === 0) {
    insert('hostels', { name: 'Volta Hall (Block A)', type: 'Mixed', capacity: 320, occupied: 262, feePerSemester: 800, status: 'available' });
    insert('hostels', { name: 'Pra Hall (Block B)', type: 'Male', capacity: 280, occupied: 280, feePerSemester: 950, status: 'full' });
    insert('hostels', { name: 'Komfo Hall (Block C)', type: 'Female', capacity: 300, occupied: 213, feePerSemester: 650, status: 'available' });
  }
  if (getAll('feeStructure').length === 0) {
    insert('feeStructure', { programme: 'BTech Computer Technology', level: 'Level 100', academicYear: '2025/2026', tuition: 4200, hostel: 800, examFee: 150, srcDues: 200, total: 5350 });
    insert('feeStructure', { programme: 'BTech Computer Technology', level: 'Level 200', academicYear: '2025/2026', tuition: 4400, hostel: 800, examFee: 150, srcDues: 200, total: 5550 });
    insert('feeStructure', { programme: 'BEng Electrical Engineering', level: 'Level 100', academicYear: '2025/2026', tuition: 4600, hostel: 800, examFee: 180, srcDues: 200, total: 5780 });
  }
  if (getAll('timetable').length === 0) {
    insert('timetable', { day: 'Monday', time: '7:30–9:30', courseCode: 'CPT 301', room: 'Lab A-201', lecturer: 'Dr. Mensah K.' });
    insert('timetable', { day: 'Monday', time: '10:00–12:00', courseCode: 'MAT 201', room: 'Room B-104', lecturer: 'Mr. Asante C.' });
    insert('timetable', { day: 'Wednesday', time: '10:00–12:00', courseCode: 'CPT 301', room: 'Lab A-201', lecturer: 'Dr. Mensah K.' });
  }
}

module.exports = {
  getAll, getById, find, findOne, insert, update, remove, removeWhere, genId, seedIfEmpty
};

// api/index.js
// CampusIQ backend API — Express app exported for Vercel serverless,
// also runnable standalone with `node api/index.js` for local dev.

const express = require('express');
const path = require('node:path');
const db = require('../lib/db');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');

// CORS must come BEFORE body parsing / routes so preflight + actual requests succeed
const cors = require('cors');
app.use(cors({
  origin: true, // reflect request origin
  credentials: true,
}));
app.use(express.json());
app.use(express.static(publicDir));

// One-time migration from JSON files to PostgreSQL (Supabase)
// Fire-and-forget so it doesn't block server startup.
const migrationPromise = db.migrateFromJson().catch(e => console.error('[CampusIQ] Migration failed:', e));

// Seed default data on first run (admin account, sample hostels, etc.)
// Wrapped so a seeding failure does not crash the serverless function
// and take down /api/health and every other route.
const seedPromise = (async () => { await migrationPromise; await db.seedIfEmpty(); })();
seedPromise.catch((e) => console.error('[CampusIQ] Seed failed:', e));

// ---------- helpers ----------
function ok(res, data) { res.json({ success: true, data }); }
function fail(res, status, message) { res.status(status).json({ success: false, message }); }

// =====================================================================
// AUTH — Admin login
// =====================================================================
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return fail(res, 400, "Email and password are required");
  }

  let admin = await db.findOne("users", u =>
    (u.email.toLowerCase() === String(email).toLowerCase() || u.username?.toLowerCase() === String(email).toLowerCase()) &&
    u.password === password &&
    u.role === "admin"
  );
  if (!admin) {
    await new Promise(r => setTimeout(r, 150));
    admin = await db.findOne("users", u =>
      (u.email.toLowerCase() === String(email).toLowerCase() || u.username?.toLowerCase() === String(email).toLowerCase()) &&
      u.password === password &&
      u.role === "admin"
    );
  }
  if (!admin) {
    return fail(res, 401, "Invalid admin credentials");
  }

  const safeAdmin = { ...admin };
  delete safeAdmin.password;

  ok(res, safeAdmin);
});

app.post('/api/admin/change-password', async (req, res) => {
  const { username, email, oldPassword, newPassword } = req.body || {};
  // support both email and username field
  const identifier = username || email;
  if (!identifier || !oldPassword) return fail(res, 400, 'Username/email and current password are required');
  const admin = await db.findOne('users', a =>
    (a.email && a.email.toLowerCase() === identifier.toLowerCase() || (a.username && a.username.toLowerCase() === identifier.toLowerCase())) &&
    a.password === oldPassword &&
    a.role === "admin"
  );
  if (!admin) return fail(res, 401, 'Current password is incorrect');
  if (!newPassword || newPassword.length < 6) return fail(res, 400, 'New password must be at least 6 characters');
  await db.update('users', admin.id, { password: newPassword });
  ok(res, { message: 'Password updated' });
});

// =====================================================================
// AUTH — Student/Lecturer/HOD login (accounts created by admin)
// =====================================================================
app.post('/api/login', async (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || !role) return fail(res, 400, 'Email, password, and role are required');
  let user = await db.findOne('users', u =>
    u.email.toLowerCase() === String(email).toLowerCase() &&
    u.password === password &&
    u.role === role
  );
  // Brief retry for KV read-after-write consistency (newly created accounts)
  if (!user) {
    await new Promise(r => setTimeout(r, 150));
    user = await db.findOne('users', u =>
      u.email.toLowerCase() === String(email).toLowerCase() &&
      u.password === password &&
      u.role === role
    );
  }
  if (!user) return fail(res, 401, 'Invalid email, password, or role. Contact your admin if you need an account.');
  const safeUser = { ...user };
  delete safeUser.password;
  ok(res, safeUser);
});

// =====================================================================
// USERS — Admin creates/edits/deletes Student, Lecturer, HOD accounts
// =====================================================================
app.get('/api/users', async (req, res) => {
  const { role } = req.query;
  let users = await db.getAll('users');
  if (role) users = users.filter(u => u.role === role);
  ok(res, users.map(({ password, ...u }) => u)); // never return passwords in list
});

app.get('/api/users/lookup', async (req, res) => {
  const { studentId } = req.query;
  if (!studentId) return fail(res, 400, 'studentId is required');
  let user = await db.findOne('users', u => String(u.studentId||'').includes(studentId));
  if (!user) {
    await new Promise(r => setTimeout(r, 150));
    user = await db.findOne('users', u => String(u.studentId||'').includes(studentId));
  }
  if (!user) return fail(res, 404, 'User not found');
  const { password, ...safe } = user;
  ok(res, safe);
});

app.get('/api/users/:id/photo', async (req, res) => {
  const user = await db.getById('users', req.params.id);
  if (!user) return fail(res, 404, 'User not found');
  const photo = user.passportDataUrl || user.avatar || user.photo;
  if (!photo) return fail(res, 404, 'No passport photo');
  if (typeof photo !== 'string' || !photo.startsWith('data:')) return fail(res, 404, 'No passport photo');
  const match = photo.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return fail(res, 404, 'No passport photo');
  const mime = match[1] || 'image/png';
  res.set('Content-Type', mime);
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(Buffer.from(match[2], 'base64'));
});

app.get('/api/users/:id', async (req, res) => {
  const user = await db.getById('users', req.params.id);
  if (!user) return fail(res, 404, 'User not found');
  const { password, ...safe } = user;
  ok(res, safe);
});

app.post('/api/users', async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) return fail(res, 400, 'name, email, password, and role are required');
  if (!['student', 'lecturer', 'hod'].includes(role)) return fail(res, 400, 'role must be student, lecturer, or hod');
  const exists = await db.findOne('users', u => u.email.toLowerCase() === String(email).toLowerCase());
  if (exists) return fail(res, 409, 'An account with this email already exists');

  const record = await db.insert('users', {
    name, email: String(email).toLowerCase(), password, role,
    studentId: req.body.studentId || null,
    staffId: req.body.staffId || null,
    programme: req.body.programme || null,
    level: req.body.level || null,
    department: req.body.department || null,
    title: req.body.title || null,
  });
  const safe = { ...record };
  delete safe.password;
  ok(res, safe);
});

app.put('/api/users/:id', async (req, res) => {
  const patch = { ...req.body };
  delete patch.id; delete patch.createdAt; delete patch.password;
  const updated = await db.update('users', req.params.id, patch);
  if (!updated) return fail(res, 404, 'User not found');
  const { password, ...safe } = updated;
  ok(res, safe);
});

app.delete('/api/users/:id', async (req, res) => {
  const removed = await db.remove('users', req.params.id);
  if (!removed) return fail(res, 404, 'User not found');
  ok(res, { id: req.params.id });
});

// =====================================================================
// HOSTELS — Admin creates/edits/deletes
// =====================================================================
app.get('/api/hostels', async (req, res) => ok(res, await db.getAll('hostels')));

app.post('/api/hostels', async (req, res) => {
  const { name, type, capacity, feePerSemester } = req.body || {};
  if (!name || !type || capacity == null || feePerSemester == null) return fail(res, 400, 'name, type, capacity, feePerSemester are required');
  const record = await db.insert('hostels', {
    name, type, capacity: Number(capacity), occupied: Number(req.body.occupied || 0),
    feePerSemester: Number(feePerSemester), status: req.body.status || 'available'
  });
  ok(res, record);
});

app.put('/api/hostels/:id', async (req, res) => {
  const updated = await db.update('hostels', req.params.id, req.body);
  if (!updated) return fail(res, 404, 'Hostel not found');
  ok(res, updated);
});

app.delete('/api/hostels/:id', async (req, res) => {
  const removed = await db.remove('hostels', req.params.id);
  if (!removed) return fail(res, 404, 'Hostel not found');
  ok(res, { id: req.params.id });
});

// =====================================================================
// FEES & FINANCE — Fee structures + student payment records
// =====================================================================
app.get('/api/fees/structure', async (req, res) => ok(res, await db.getAll('feeStructure')));

app.post('/api/fees/structure', async (req, res) => {
  const { programme, level, academicYear, tuition, hostel, examFee, srcDues } = req.body || {};
  if (!programme || !level || !academicYear || tuition == null) return fail(res, 400, 'programme, level, academicYear, tuition are required');
  const t = Number(tuition), h = Number(hostel || 0), e = Number(examFee || 0), s = Number(srcDues || 0);
  const record = await db.insert('feeStructure', { programme, level, academicYear, tuition: t, hostel: h, examFee: e, srcDues: s, total: t + h + e + s });
  ok(res, record);
});

app.put('/api/fees/structure/:id', async (req, res) => {
  const patch = { ...req.body };
  const existing = await db.getById('feeStructure', req.params.id);
  if (!existing) return fail(res, 404, 'Fee structure not found');
  const merged = { ...existing, ...patch };
  merged.total = Number(merged.tuition || 0) + Number(merged.hostel || 0) + Number(merged.examFee || 0) + Number(merged.srcDues || 0);
  const updated = await db.update('feeStructure', req.params.id, merged);
  ok(res, updated);
});

app.delete('/api/fees/structure/:id', async (req, res) => {
  const removed = await db.remove('feeStructure', req.params.id);
  if (!removed) return fail(res, 404, 'Fee structure not found');
  ok(res, { id: req.params.id });
});

app.get('/api/fees/payments', async (req, res) => {
  const { studentId } = req.query;
  let payments = await db.getAll('payments');
  if (studentId) payments = payments.filter(p => p.studentId === studentId);
  ok(res, payments);
});

app.post('/api/fees/payments', async (req, res) => {
  const { studentId, amount, method } = req.body || {};
  if (!studentId || amount == null) return fail(res, 400, 'studentId and amount are required');
  const record = await db.insert('payments', { studentId, amount: Number(amount), method: method || 'Mobile Money', status: 'completed' });
  ok(res, record);
});

// =====================================================================
// TIMETABLE — Admin manages university-wide timetable
// =====================================================================
app.get('/api/timetable', async (req, res) => {
  const { courseCode, day } = req.query;
  let rows = await db.getAll('timetable');
  if (courseCode) rows = rows.filter(r => r.courseCode === courseCode);
  if (day) rows = rows.filter(r => r.day === day);
  ok(res, rows);
});

app.post('/api/timetable', async (req, res) => {
  const { day, time, courseCode, room, lecturer } = req.body || {};
  if (!day || !time || !courseCode || !room) return fail(res, 400, 'day, time, courseCode, room are required');
  const record = await db.insert('timetable', { day, time, courseCode, room, lecturer: lecturer || '' });
  ok(res, record);
});

app.put('/api/timetable/:id', async (req, res) => {
  const updated = await db.update('timetable', req.params.id, req.body);
  if (!updated) return fail(res, 404, 'Timetable entry not found');
  ok(res, updated);
});

app.delete('/api/timetable/:id', async (req, res) => {
  const removed = await db.remove('timetable', req.params.id);
  if (!removed) return fail(res, 404, 'Timetable entry not found');
  ok(res, { id: req.params.id });
});

// =====================================================================
// RESULTS & GRADING — Lecturer/Admin enters scores per student per course
// =====================================================================
app.get('/api/results', async (req, res) => {
  const { studentId, courseCode } = req.query;
  let rows = await db.getAll('results');
  if (studentId) rows = rows.filter(r => r.studentId === studentId);
  if (courseCode) rows = rows.filter(r => r.courseCode === courseCode);
  ok(res, rows);
});

function gradeFromScore(score) {
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

app.post('/api/results', async (req, res) => {
  const { studentId, studentName, courseCode, caScore, examScore } = req.body || {};
  if (!studentId || !courseCode || caScore == null || examScore == null) {
    return fail(res, 400, 'studentId, courseCode, caScore, examScore are required');
  }
  const total = Number(caScore) + Number(examScore);
  const record = await db.insert('results', {
    studentId, studentName: studentName || '', courseCode,
    caScore: Number(caScore), examScore: Number(examScore),
    total, grade: gradeFromScore(total)
  });
  ok(res, record);
});

app.put('/api/results/:id', async (req, res) => {
  const existing = await db.getById('results', req.params.id);
  if (!existing) return fail(res, 404, 'Result not found');
  const merged = { ...existing, ...req.body };
  merged.total = Number(merged.caScore || 0) + Number(merged.examScore || 0);
  merged.grade = gradeFromScore(merged.total);
  const updated = await db.update('results', req.params.id, merged);
  ok(res, updated);
});

app.delete('/api/results/:id', async (req, res) => {
  const removed = await db.remove('results', req.params.id);
  if (!removed) return fail(res, 404, 'Result not found');
  ok(res, { id: req.params.id });
});

// =====================================================================
// VIRTUAL CLASSROOM — Lecturers post exams/quizzes, students take them
// =====================================================================
app.get('/api/exams', async (req, res) => {
  const { courseCode, lecturerId } = req.query;
  let rows = await db.getAll('exams');
  if (courseCode) rows = rows.filter(r => r.courseCode === courseCode);
  if (lecturerId) rows = rows.filter(r => r.lecturerId === lecturerId);
  ok(res, rows);
});

app.get('/api/exams/:id', async (req, res) => {
  const exam = await db.getById('exams', req.params.id);
  if (!exam) return fail(res, 404, 'Exam not found');
  ok(res, exam);
});

app.post('/api/exams', async (req, res) => {
  const { title, courseCode, lecturerId, lecturerName, durationMinutes, questions, openAt, closeAt } = req.body || {};
  if (!title || !courseCode || !questions || !Array.isArray(questions) || questions.length === 0) {
    return fail(res, 400, 'title, courseCode, and a non-empty questions array are required');
  }
  if (!lecturerId) {
    return fail(res, 400, 'lecturerId is required');
  }
  const author = await db.getById('users', lecturerId);
  if (!author || (author.role !== 'lecturer' && author.role !== 'admin' && author.role !== 'hod')) {
    return fail(res, 403, 'Only lecturers, HODs, and admins can create exams');
  }
  const record = await db.insert('exams', {
    title, courseCode, lecturerId, lecturerName: lecturerName || author.name,
    durationMinutes: Number(durationMinutes || 30),
    questions,
    totalPoints: questions.reduce((s, q) => s + Number(q.points || 1), 0),
    openAt: openAt || null, closeAt: closeAt || null,
    status: 'published'
  });
  ok(res, record);
});

app.put('/api/exams/:id', async (req, res) => {
  const updated = await db.update('exams', req.params.id, req.body);
  if (!updated) return fail(res, 404, 'Exam not found');
  ok(res, updated);
});

app.delete('/api/exams/:id', async (req, res) => {
  const removed = await db.remove('exams', req.params.id);
  if (!removed) return fail(res, 404, 'Exam not found');
  ok(res, { id: req.params.id });
});

// Student submits answers; auto-graded against correctIndex
app.post('/api/exams/:id/submit', async (req, res) => {
  const exam = await db.getById('exams', req.params.id);
  if (!exam) return fail(res, 404, 'Exam not found');
  const { studentId, studentName, answers } = req.body || {}; // answers: [selectedIndex,...]
  if (!studentId || !Array.isArray(answers)) return fail(res, 400, 'studentId and answers array are required');
  if (answers.length < exam.questions.length) return fail(res, 400, 'You must answer all questions before submitting');

  const already = await db.findOne('examSubmissions', s => s.examId === exam.id && s.studentId === studentId);
  if (already) return fail(res, 409, 'You have already submitted this exam');

  let score = 0;
  const breakdown = exam.questions.map((q, i) => {
    const correct = Number(answers[i]) === Number(q.correctIndex);
    if (correct) score += Number(q.points || 1);
    return { question: q.text, selected: answers[i], correctIndex: q.correctIndex, correct, points: correct ? Number(q.points || 1) : 0 };
  });

  const record = await db.insert('examSubmissions', {
    examId: exam.id, examTitle: exam.title, courseCode: exam.courseCode,
    studentId, studentName: studentName || '',
    answers, breakdown, score, totalPoints: exam.totalPoints,
    percentage: exam.totalPoints ? Math.round((score / exam.totalPoints) * 100) : 0,
    submittedAt: new Date().toISOString()
  });
  ok(res, record);
});

app.get('/api/exams/:id/submissions', async (req, res) => {
  const rows = await db.find('examSubmissions', s => s.examId === req.params.id);
  ok(res, rows);
});

app.get('/api/students/:studentId/submissions', async (req, res) => {
  const rows = await db.find('examSubmissions', s => s.studentId === req.params.studentId);
  ok(res, rows);
});

// =====================================================================
// ATTENDANCE — Lecturer takes attendance per course/session
// =====================================================================
app.get('/api/attendance', async (req, res) => {
  const { courseCode, studentId, date } = req.query;
  let rows = await db.getAll('attendance');
  if (courseCode) rows = rows.filter(r => r.courseCode === courseCode);
  if (studentId) rows = rows.filter(r => r.studentId === studentId);
  if (date) rows = rows.filter(r => r.date === date);
  ok(res, rows);
});

app.get('/api/attendance/roster', async (req, res) => {
  const { courseCode, date } = req.query;
  if (!courseCode || !date) return fail(res, 400, 'courseCode and date are required');
  const regs = await db.find('registrations', r => r.courseCode === courseCode);
  const users = await db.getAll('users');
  const existing = await db.find('attendance', r => r.courseCode === courseCode && r.date === date);
  const existingMap = new Map(existing.map(r => [r.studentId, r]));
  const roster = regs.map(r => {
    const student = users.find(u => u.id === r.studentId || u.studentId === r.studentId);
    const prev = existingMap.get(r.studentId);
    return {
      studentId: r.studentId,
      studentName: student ? student.name : r.studentName || r.studentId,
      status: prev ? prev.status : 'present',
      prev
    };
  });
  ok(res, roster);
});

app.post('/api/attendance/self', async (req, res) => {
  const { courseCode, date, studentId, studentName } = req.body || {};
  if (!courseCode || !date || !studentId) return fail(res, 400, 'courseCode, date, and studentId are required');
  const author = await db.findOne('users', u => u.id === studentId || u.studentId === studentId);
  if (!author) return fail(res, 403, 'Only registered students can mark attendance');
  const existing = await db.findOne('attendance', r => r.courseCode === courseCode && r.date === date && r.studentId === studentId);
  if (existing) {
    const updated = await db.update('attendance', existing.id, { status: 'present', studentName: studentName || existing.studentName });
    return ok(res, updated);
  }
  const session = await db.insert('attendance', {
    courseCode, date, lecturerId: '',
    studentId, studentName: studentName || author.name || '',
    status: 'present'
  });
  ok(res, session);
});

// Lecturer submits a full session's attendance at once
// body: { courseCode, date, lecturerId, records: [{studentId, studentName, status}] }
app.post('/api/attendance/session', async (req, res) => {
  const { courseCode, date, lecturerId, records } = req.body || {};
  if (!courseCode || !date || !Array.isArray(records)) {
    return fail(res, 400, 'courseCode, date, and records array are required');
  }
  // Remove any existing entries for this course+date so re-submission overwrites cleanly
  await db.removeWhere('attendance', r => r.courseCode === courseCode && r.date === date);
  const saved = await Promise.all(records.map(async r => await db.insert('attendance', {
    courseCode, date, lecturerId: lecturerId || '',
    studentId: r.studentId, studentName: r.studentName || '',
    status: r.status || 'absent' // present | absent | late
  })));
  ok(res, saved);
});

app.get('/api/attendance/summary/:studentId', async (req, res) => {
  const rows = await db.find('attendance', r => r.studentId === req.params.studentId);
  const total = rows.length;
  const present = rows.filter(r => r.status === 'present').length;
  const late = rows.filter(r => r.status === 'late').length;
  const absent = rows.filter(r => r.status === 'absent').length;
  ok(res, { total, present, late, absent, percentage: total ? Math.round((present / total) * 100) : 0 });
});

// =====================================================================
// Health check
// =====================================================================
app.get('/api/health', async (req, res) => ok(res, { status: 'CampusIQ API running', time: new Date().toISOString() }));


app.get('/', async (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

module.exports = app;

// Allow standalone local run: `node api/index.js`
function startServer(port = Number(process.env.PORT || 3001), attempt = 1) {
  const server = app.listen(port, () => {
    console.log(`CampusIQ API running locally at http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy. Retrying on ${nextPort}...`);
      server.close(() => startServer(nextPort, attempt + 1));
      return;
    }
    console.error(`Failed to start CampusIQ API on port ${port}:`, err);
    process.exit(1);
  });
}

// Start server when run directly: `node api/index.js`
if (require.main === module) {
  startServer();
}

// =====================================================================
// NOTIFICATIONS
// =====================================================================
app.get('/api/notifications/:userId', async (req, res) => {
  const rows = await db.find('notifications', n => n.userId === req.params.userId || n.userId === 'all');
  ok(res, rows.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30));
});
app.post('/api/notifications', async (req, res) => {
  const { userId, title, message, type } = req.body || {};
  if (!title || !message) return fail(res, 400, 'title and message required');
  ok(res, await db.insert('notifications', { userId: userId || 'all', title, message, type: type || 'info', read: false }));
});
app.put('/api/notifications/:id/read', async (req, res) => {
  const n = await db.update('notifications', req.params.id, { read: true });
  if (!n) return fail(res, 404, 'Not found');
  ok(res, n);
});
app.delete('/api/notifications/:id', async (req, res) => {
  await db.remove('notifications', req.params.id); ok(res, { id: req.params.id });
});

// =====================================================================
// BULK IMPORT — admin uploads many records at once (CSV/JSON -> rows)
// =====================================================================
const BULK_COLLECTIONS = ['users','hostels','feeStructure','timetable','results','exams','attendance','payments','registrations','assignments','materials','notices','calendar','hostelApplications','portfolios','alumniQuestions','referrals'];
app.post('/api/bulk-import', async (req, res) => {
  const { collection, records } = req.body || {};
  if (!BULK_COLLECTIONS.includes(collection)) return fail(res, 400, 'Unknown or unsupported collection: ' + collection);
  if (!Array.isArray(records) || !records.length) return fail(res, 400, 'records must be a non-empty array');
  if (records.length > 2000) return fail(res, 400, 'Too many records (max 2000 per import)');
  try {
    const inserted = [];
    for (const rec of records) {
      if (rec && typeof rec === 'object') inserted.push(await db.insert(collection, rec));
    }
    ok(res, { imported: inserted.length, collection });
  } catch (e) {
    fail(res, 500, 'Import failed: ' + e.message);
  }
});

// =====================================================================
// FEES — PAYMENTS (student uploads receipt, admin confirms)
// =====================================================================
app.get('/api/fees/payments/:studentId', async (req, res) => {
  ok(res, await db.find('payments', p => p.studentId === req.params.studentId));
});
app.post('/api/fees/payments/:studentId/receipt', async (req, res) => {
  const { amount, method, reference, receiptNote } = req.body || {};
  if (!amount) return fail(res, 400, 'amount required');
  ok(res, await db.insert('payments', {
    studentId: req.params.studentId, amount: Number(amount),
    method: method || 'Mobile Money', reference: reference || '', receiptNote: receiptNote || '',
    status: 'pending_confirmation'
  }));
});
app.put('/api/fees/payments/:id/confirm', async (req, res) => {
  const p = await db.update('payments', req.params.id, { status: 'confirmed', confirmedAt: new Date().toISOString() });
  if (!p) return fail(res, 404, 'Payment not found');
  ok(res, p);
});
app.delete('/api/fees/payments/:id', async (req, res) => {
  const removed = await db.remove('payments', req.params.id);
  if (!removed) return fail(res, 404, 'Payment not found');
  ok(res, { id: req.params.id });
});

// =====================================================================
// COURSE REGISTRATION
// =====================================================================
app.get('/api/registrations', async (req, res) => {
  const { studentId, semester, courseCode } = req.query;
  let rows = await db.getAll('registrations');
  if (studentId) rows = rows.filter(r => r.studentId === studentId);
  if (semester) rows = rows.filter(r => r.semester === semester);
  if (courseCode) rows = rows.filter(r => r.courseCode === courseCode);
  ok(res, rows);
});
app.post('/api/registrations', async (req, res) => {
  const { studentId, studentName, courseCode, courseName, semester } = req.body || {};
  if (!studentId || !courseCode || !semester) return fail(res, 400, 'studentId, courseCode, semester required');
  const exists = await db.findOne('registrations', r => r.studentId === studentId && r.courseCode === courseCode && r.semester === semester);
  if (exists) return fail(res, 409, 'Already registered for this course this semester');
  ok(res, await db.insert('registrations', { studentId, studentName: studentName || '', courseCode, courseName: courseName || '', semester, status: 'registered' }));
});
app.delete('/api/registrations/:id', async (req, res) => {
  await db.remove('registrations', req.params.id); ok(res, { id: req.params.id });
});

// =====================================================================
// ASSIGNMENTS
// =====================================================================
app.get('/api/assignments', async (req, res) => {
  const { courseCode, lecturerId } = req.query;
  let rows = await db.getAll('assignments');
  if (courseCode) rows = rows.filter(a => a.courseCode === courseCode);
  if (lecturerId) rows = rows.filter(a => a.lecturerId === lecturerId);
  ok(res, rows);
});
app.post('/api/assignments', async (req, res) => {
  const { title, courseCode, lecturerId, lecturerName, description, deadline, maxScore } = req.body || {};
  if (!title || !courseCode || !deadline) return fail(res, 400, 'title, courseCode, deadline required');
  if (!lecturerId) {
    return fail(res, 400, 'lecturerId is required');
  }
  const author = await db.getById('users', lecturerId);
  if (!author || (author.role !== 'lecturer' && author.role !== 'admin' && author.role !== 'hod')) {
    return fail(res, 403, 'Only lecturers, HODs, and admins can create assignments');
  }
  ok(res, await db.insert('assignments', { title, courseCode, lecturerId, lecturerName: lecturerName || author.name, description: description || '', deadline, maxScore: Number(maxScore || 100) }));
});
app.delete('/api/assignments/:id', async (req, res) => {
  await db.remove('assignments', req.params.id); ok(res, { id: req.params.id });
});
app.post('/api/assignments/:id/submit', async (req, res) => {
  const { studentId, studentName, response, link } = req.body || {};
  if (!studentId) return fail(res, 400, 'studentId required');
  const already = await db.findOne('assignmentSubmissions', s => s.assignmentId === req.params.id && s.studentId === studentId);
  if (already) return fail(res, 409, 'Already submitted');
  ok(res, await db.insert('assignmentSubmissions', { assignmentId: req.params.id, studentId, studentName: studentName || '', response: response || '', link: link || '', status: 'submitted', score: null, feedback: '' }));
});
app.get('/api/assignments/:id/submissions', async (req, res) => {
  ok(res, await db.find('assignmentSubmissions', s => s.assignmentId === req.params.id));
});
app.put('/api/assignments/submissions/:id/grade', async (req, res) => {
  const { score, feedback } = req.body || {};
  const s = await db.update('assignmentSubmissions', req.params.id, { score: Number(score), feedback: feedback || '', status: 'graded' });
  if (!s) return fail(res, 404, 'Submission not found');
  ok(res, s);
});

// =====================================================================
// COURSE MATERIALS
// =====================================================================
app.get('/api/materials', async (req, res) => {
  const { courseCode } = req.query;
  let rows = await db.getAll('materials');
  if (courseCode) rows = rows.filter(m => m.courseCode === courseCode);
  ok(res, rows.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)));
});
app.post('/api/materials', async (req, res) => {
  const { courseCode, title, type, url, week, lecturerId } = req.body || {};
  if (!courseCode || !title || !url) return fail(res, 400, 'courseCode, title, url required');
  if (!lecturerId) {
    return fail(res, 400, 'lecturerId is required');
  }
  const author = await db.getById('users', lecturerId);
  if (!author || (author.role !== 'lecturer' && author.role !== 'admin' && author.role !== 'hod')) {
    return fail(res, 403, 'Only lecturers, HODs, and admins can add materials');
  }
  ok(res, await db.insert('materials', { courseCode, title, type: type || 'link', url, week: week || '', lecturerId }));
});
app.delete('/api/materials/:id', async (req, res) => {
  await db.remove('materials', req.params.id); ok(res, { id: req.params.id });
});

// =====================================================================
// NOTICES / ANNOUNCEMENTS
// =====================================================================
app.get('/api/notices', async (req, res) => {
  const notices = await db.getAll('notices');
  const sorted = Array.isArray(notices) ? notices.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)) : [];
  ok(res, sorted);
});
app.post('/api/notices', async (req, res) => {
  const { title, body, category, adminName } = req.body || {};
  if (!title || !body) return fail(res, 400, 'title and body required');
  const notice = await db.insert('notices', { title, body, category: category || 'general', adminName: adminName || 'Admin' });
  // Push notification to all users
  await db.insert('notifications', { userId: 'all', title: '📢 ' + title, message: body.slice(0, 100), type: 'notice', read: false });
  ok(res, notice);
});
app.delete('/api/notices/:id', async (req, res) => {
  await db.remove('notices', req.params.id); ok(res, { id: req.params.id });
});

// =====================================================================
// ACADEMIC CALENDAR
// =====================================================================
app.get('/api/calendar', async (req, res) => {
  const cal = await db.getAll('calendar');
  const sorted = Array.isArray(cal) ? cal.sort((a,b) => new Date(a.startDate) - new Date(b.startDate)) : [];
  ok(res, sorted);
});
app.post('/api/calendar', async (req, res) => {
  const { title, startDate, endDate, type } = req.body || {};
  if (!title || !startDate) return fail(res, 400, 'title and startDate required');
  ok(res, await db.insert('calendar', { title, startDate, endDate: endDate || startDate, type: type || 'event' }));
});
app.put('/api/calendar/:id', async (req, res) => {
  const c = await db.update('calendar', req.params.id, req.body);
  if (!c) return fail(res, 404, 'Not found');
  ok(res, c);
});
app.delete('/api/calendar/:id', async (req, res) => {
  await db.remove('calendar', req.params.id); ok(res, { id: req.params.id });
});

// =====================================================================
// HOSTEL ALLOCATION
// =====================================================================
app.get('/api/hostel-applications', async (req, res) => {
  const { studentId, status } = req.query;
  let rows = await db.getAll('hostelApplications');
  if (studentId) rows = rows.filter(r => r.studentId === studentId);
  if (status) rows = rows.filter(r => r.status === status);
  ok(res, rows);
});
app.post('/api/hostel-applications', async (req, res) => {
  const { studentId, studentName, hostelId, hostelName, programme, level } = req.body || {};
  if (!studentId || !hostelId) return fail(res, 400, 'studentId and hostelId required');
  const exists = await db.findOne('hostelApplications', a => a.studentId === studentId && a.status !== 'rejected');
  if (exists) return fail(res, 409, 'You already have a pending or approved hostel application');
  ok(res, await db.insert('hostelApplications', { studentId, studentName: studentName || '', hostelId, hostelName: hostelName || '', programme: programme || '', level: level || '', status: 'pending', roomNumber: null }));
});
app.put('/api/hostel-applications/:id/allocate', async (req, res) => {
  const { roomNumber, status } = req.body || {};
  const a = await db.update('hostelApplications', req.params.id, { roomNumber: roomNumber || null, status: status || 'approved', allocatedAt: new Date().toISOString() });
  if (!a) return fail(res, 404, 'Application not found');
  ok(res, a);
});
app.delete('/api/hostel-applications/:id', async (req, res) => {
  const removed = await db.remove('hostelApplications', req.params.id);
  if (!removed) return fail(res, 404, 'Application not found');
  ok(res, { id: req.params.id });
});

// =====================================================================
// LIVE LOCATION SHARING
// =====================================================================
app.post('/api/location/update', async (req, res) => {
  const { userId, userName, role, lat, lng, building, shareMode } = req.body || {};
  if (!userId || lat == null || lng == null) return fail(res, 400, 'userId, lat, lng required');
  // Upsert — overwrite existing location for this user
  const existing = await db.findOne('liveLocations', l => l.userId === userId);
  if (existing) {
    ok(res, await db.update('liveLocations', existing.id, { lat, lng, building: building || '', shareMode: shareMode || 'all', updatedAt: new Date().toISOString(), userName, role }));
  } else {
    ok(res, await db.insert('liveLocations', { userId, userName: userName || '', role: role || 'student', lat, lng, building: building || '', shareMode: shareMode || 'all' }));
  }
});
app.get('/api/location/live', async (req, res) => {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min stale cutoff
  const active = await db.find('liveLocations', l => (l.updatedAt || l.createdAt) > cutoff);
  ok(res, active);
});
app.delete('/api/location/stop/:userId', async (req, res) => {
  await db.removeWhere('liveLocations', l => l.userId === req.params.userId);
  ok(res, { stopped: true });
});

// =====================================================================
// COURSE CHAT
// =====================================================================
app.get('/api/chat/:courseCode', async (req, res) => {
  const msgs = await db.find('chatMessages', m => m.courseCode === req.params.courseCode);
  ok(res, msgs.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-100));
});
app.post('/api/chat/:courseCode', async (req, res) => {
  const { userId, userName, role, message } = req.body || {};
  if (!userId || !message) return fail(res, 400, 'userId and message required');
  ok(res, await db.insert('chatMessages', { courseCode: req.params.courseCode, userId, userName: userName || '', role: role || 'student', message }));
});

// =====================================================================
// PORTFOLIO
// =====================================================================
app.get('/api/portfolio/:userId', async (req, res) => {
  ok(res, await db.find('portfolios', p => p.userId === req.params.userId));
});
app.post('/api/portfolio/:userId', async (req, res) => {
  const { title, courseCode, desc, skills, link } = req.body || {};
  if (!title || !desc) return fail(res, 400, 'title and desc required');
  ok(res, await db.insert('portfolios', {
    userId: req.params.userId, title,
    courseCode: courseCode || '', desc,
    skills: Array.isArray(skills) ? skills : (skills || '').split(',').map(s => s.trim()).filter(Boolean),
    link: link || ''
  }));
});
app.delete('/api/portfolio/:id', async (req, res) => {
  await db.remove('portfolios', req.params.id);
  ok(res, { id: req.params.id });
});

// =====================================================================
// ALUMNI QUESTIONS
// =====================================================================
app.get('/api/alumni-questions/:userId', async (req, res) => {
  ok(res, await db.find('alumniQuestions', q => q.askedBy === req.params.userId));
});
app.post('/api/alumni-questions', async (req, res) => {
  const { alumniId, alumniName, question, askedBy, askedByName } = req.body || {};
  if (!alumniId || !question || !askedBy) return fail(res, 400, 'alumniId, question, askedBy required');
  ok(res, await db.insert('alumniQuestions', {
    alumniId, alumniName: alumniName || '', question, askedBy,
    askedByName: askedByName || '', status: 'pending', answer: ''
  }));
});

// =====================================================================
// PAPI AI — campus tutor proxy (uses API key from env when present,
// otherwise gracefully falls back to the client-side offline engine)
// =====================================================================
const PAPI_SYSTEM = `You are Papi, the official AI academic assistant and tutor for Kumasi Technical University (KsTU) in Ghana. You have expert knowledge of all KsTU programmes: Engineering, Applied Sciences (Computer Technology, AI, Data Science), Business School, Creative Arts, Health Sciences, Built Environment, and Entrepreneurship.

Your abilities:
- Explain any academic concept clearly with step-by-step examples
- Create personalised study plans and exam preparation strategies based on the student's actual courses and results
- Help with assignments and problem-solving across all disciplines, including complex multi-step problems
- Provide career guidance specific to Ghana's job market (Vodafone, MTN, GRIDCo, Stanbic, Hubtel, etc.)
- Answer questions about KsTU campus life, procedures, locations, and programmes
- When a user attaches a file, read its contents carefully and answer the questions inside it

Be warm, encouraging, concise (under 220 words unless the question genuinely needs more), and always relevant to KsTU students in Ghana. Use relatable Ghanaian examples where helpful. If a question mentions a place on or near campus, you may mention it can be shown on the in-app map.`;

app.post('/api/ai', async (req, res) => {
  const { messages, system, locale, fileContent } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return fail(res, 400, 'messages are required');
  }
  let sys = system || PAPI_SYSTEM;
  if (locale === 'tw') sys += '\n\nRespond in Twi (Akan) where natural; keep technical terms clear.';
  // Attach any uploaded file content to the latest user message
  let msgs = messages;
  if (fileContent) {
    msgs = messages.map((m, i) => {
      if (i === messages.length - 1 && m.role === 'user') {
        return { role: 'user', content: (m.content || '') + '\n\n[Attached file content]\n' + fileContent };
      }
      return m;
    });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-3-5-haiku-latest', max_tokens: 1200, system: sys, messages: msgs })
      });
      const data = await r.json();
      const reply = data?.content?.[0]?.text;
      if (reply) return ok(res, { reply });
    } catch (e) {
      console.warn('Papi upstream failed, using offline fallback:', e.message);
    }
  }
  ok(res, { offline: true });
});

// =====================================================================
// REFERRALS
// =====================================================================
app.get('/api/referrals/:userId', async (req, res) => {
  ok(res, await db.find('referrals', r => r.userId === req.params.userId));
});
app.post('/api/referrals', async (req, res) => {
  const { userId, jobId, company, alumniName, code } = req.body || {};
  if (!userId || !jobId || !code) return fail(res, 400, 'userId, jobId, code required');
  ok(res, await db.insert('referrals', {
    userId, jobId, company: company || '', alumniName: alumniName || '',
    code, status: 'requested', usedInApplication: false
  }));
});
app.put('/api/referrals/:id/use', async (req, res) => {
  const r = await db.update('referrals', req.params.id, { usedInApplication: true, status: 'active' });
  if (!r) return fail(res, 404, 'Referral not found');
  ok(res, r);
});

// =====================================================================
// PAPI AI — server-side proxy (keeps provider API keys secret)
// Supports Anthropic, OpenAI, or OpenRouter depending on env vars.
// Returns { success:true, data:{ reply, provider } } or fail(501,'NO_AI_KEY')
// when no provider key is configured (frontend then uses offline replies).
// =====================================================================
app.post('/api/ai/ask', async (req, res) => {
  const { messages, system, fileContent } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return fail(res, 400, 'messages are required');
  }

  let convo = messages.slice(-20).map(m => ({ role: m.role, content: String(m.content || '') }));
  if (fileContent && String(fileContent).trim()) {
    convo.push({ role: 'user', content: '[[Uploaded document content]]\n' + String(fileContent).slice(0, 12000) });
  }

  const sysPrompt = system || 'You are Papi, the friendly AI academic tutor for Kumasi Technical University (KsTU) in Ghana. Explain concepts clearly, help with exam prep, assignments, and career advice relevant to Ghanaian students.';

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  try {
    if (anthropicKey) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
          max_tokens: 1024, system: sysPrompt, messages: convo
        })
      });
      const data = await r.json();
      const text = data.content && data.content[0] && data.content[0].text;
      if (!text) return fail(res, 502, 'Empty response from AI provider');
      return ok(res, { reply: text, provider: 'anthropic' });
    }

    const base = openrouterKey
      ? { url: 'https://openrouter.ai/api/v1/chat/completions', key: openrouterKey, model: process.env.OPENAI_MODEL || 'openai/gpt-4o-mini' }
      : openaiKey
        ? { url: 'https://api.openai.com/v1/chat/completions', key: openaiKey, model: process.env.OPENAI_MODEL || 'gpt-4o-mini' }
        : null;

    if (base) {
      const r = await fetch(base.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + base.key },
        body: JSON.stringify({ model: base.model, max_tokens: 1024, messages: [{ role: 'system', content: sysPrompt }, ...convo] })
      });
      const data = await r.json();
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!text) return fail(res, 502, 'Empty response from AI provider');
      return ok(res, { reply: text, provider: openrouterKey ? 'openrouter' : 'openai' });
    }

    return fail(res, 501, 'NO_AI_KEY');
  } catch (err) {
    console.error('Papi AI error:', err);
    return fail(res, 502, 'AI provider request failed');
  }
});


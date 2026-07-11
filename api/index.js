// api/index.js
// CampusIQ backend API — Express app exported for Vercel serverless,
// also runnable standalone with `node api/index.js` for local dev.

const express = require('express');
const path = require('node:path');
const db = require('../lib/db');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.json());
app.use(express.static(publicDir));

db.seedIfEmpty();

// ---------- helpers ----------
function ok(res, data) { res.json({ success: true, data }); }
function fail(res, status, message) { res.status(status).json({ success: false, message }); }

// =====================================================================
// AUTH — Admin login
// =====================================================================
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return fail(res, 400, "Email and password are required");
  }

  const admin = db.findOne("users", u =>
    (u.email.toLowerCase() === String(email).toLowerCase() || u.username?.toLowerCase() === String(email).toLowerCase()) &&
    u.password === password &&
    u.role === "admin"
  );

  if (!admin) {
    return fail(res, 401, "Invalid admin credentials");
  }

  const safeAdmin = { ...admin };
  delete safeAdmin.password;

  ok(res, safeAdmin);
});

app.post('/api/admin/change-password', (req, res) => {
  const { username, email, oldPassword, newPassword } = req.body || {};
  // support both email and username field
  const identifier = username || email;
  if (!identifier || !oldPassword) return fail(res, 400, 'Username/email and current password are required');
  const admin = db.findOne('users', a =>
    (a.email && a.email.toLowerCase() === identifier.toLowerCase() || (a.username && a.username.toLowerCase() === identifier.toLowerCase())) &&
    a.password === oldPassword &&
    a.role === "admin"
  );
  if (!admin) return fail(res, 401, 'Current password is incorrect');
  if (!newPassword || newPassword.length < 6) return fail(res, 400, 'New password must be at least 6 characters');
  db.update('users', admin.id, { password: newPassword });
  ok(res, { message: 'Password updated' });
});

// =====================================================================
// AUTH — Student/Lecturer/HOD login (accounts created by admin)
// =====================================================================
app.post('/api/login', (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || !role) return fail(res, 400, 'Email, password, and role are required');
  const user = db.findOne('users', u =>
    u.email.toLowerCase() === String(email).toLowerCase() &&
    u.password === password &&
    u.role === role
  );
  if (!user) return fail(res, 401, 'Invalid email, password, or role. Contact your admin if you need an account.');
  const safeUser = { ...user };
  delete safeUser.password;
  ok(res, safeUser);
});

// =====================================================================
// USERS — Admin creates/edits/deletes Student, Lecturer, HOD accounts
// =====================================================================
app.get('/api/users', (req, res) => {
  const { role } = req.query;
  let users = db.getAll('users');
  if (role) users = users.filter(u => u.role === role);
  ok(res, users.map(({ password, ...u }) => u)); // never return passwords in list
});

app.get('/api/users/lookup', (req, res) => {
  const { studentId } = req.query;
  if (!studentId) return fail(res, 400, 'studentId is required');
  const user = db.findOne('users', u => String(u.studentId||'').includes(studentId));
  if (!user) return fail(res, 404, 'User not found');
  const { password, ...safe } = user;
  ok(res, safe);
});

app.get('/api/users/:id', (req, res) => {
  const user = db.getById('users', req.params.id);
  if (!user) return fail(res, 404, 'User not found');
  const { password, ...safe } = user;
  ok(res, safe);
});

app.post('/api/users', (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) return fail(res, 400, 'name, email, password, and role are required');
  if (!['student', 'lecturer', 'hod'].includes(role)) return fail(res, 400, 'role must be student, lecturer, or hod');
  const exists = db.findOne('users', u => u.email.toLowerCase() === String(email).toLowerCase());
  if (exists) return fail(res, 409, 'An account with this email already exists');

  const record = db.insert('users', {
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

app.put('/api/users/:id', (req, res) => {
  const patch = { ...req.body };
  delete patch.id; delete patch.createdAt;
  const updated = db.update('users', req.params.id, patch);
  if (!updated) return fail(res, 404, 'User not found');
  const { password, ...safe } = updated;
  ok(res, safe);
});

app.delete('/api/users/:id', (req, res) => {
  const removed = db.remove('users', req.params.id);
  if (!removed) return fail(res, 404, 'User not found');
  ok(res, { id: req.params.id });
});

// =====================================================================
// HOSTELS — Admin creates/edits/deletes
// =====================================================================
app.get('/api/hostels', (req, res) => ok(res, db.getAll('hostels')));

app.post('/api/hostels', (req, res) => {
  const { name, type, capacity, feePerSemester } = req.body || {};
  if (!name || !type || capacity == null || feePerSemester == null) return fail(res, 400, 'name, type, capacity, feePerSemester are required');
  const record = db.insert('hostels', {
    name, type, capacity: Number(capacity), occupied: Number(req.body.occupied || 0),
    feePerSemester: Number(feePerSemester), status: req.body.status || 'available'
  });
  ok(res, record);
});

app.put('/api/hostels/:id', (req, res) => {
  const updated = db.update('hostels', req.params.id, req.body);
  if (!updated) return fail(res, 404, 'Hostel not found');
  ok(res, updated);
});

app.delete('/api/hostels/:id', (req, res) => {
  const removed = db.remove('hostels', req.params.id);
  if (!removed) return fail(res, 404, 'Hostel not found');
  ok(res, { id: req.params.id });
});

// =====================================================================
// FEES & FINANCE — Fee structures + student payment records
// =====================================================================
app.get('/api/fees/structure', (req, res) => ok(res, db.getAll('feeStructure')));

app.post('/api/fees/structure', (req, res) => {
  const { programme, level, academicYear, tuition, hostel, examFee, srcDues } = req.body || {};
  if (!programme || !level || !academicYear || tuition == null) return fail(res, 400, 'programme, level, academicYear, tuition are required');
  const t = Number(tuition), h = Number(hostel || 0), e = Number(examFee || 0), s = Number(srcDues || 0);
  const record = db.insert('feeStructure', { programme, level, academicYear, tuition: t, hostel: h, examFee: e, srcDues: s, total: t + h + e + s });
  ok(res, record);
});

app.put('/api/fees/structure/:id', (req, res) => {
  const patch = { ...req.body };
  const existing = db.getById('feeStructure', req.params.id);
  if (!existing) return fail(res, 404, 'Fee structure not found');
  const merged = { ...existing, ...patch };
  merged.total = Number(merged.tuition || 0) + Number(merged.hostel || 0) + Number(merged.examFee || 0) + Number(merged.srcDues || 0);
  const updated = db.update('feeStructure', req.params.id, merged);
  ok(res, updated);
});

app.delete('/api/fees/structure/:id', (req, res) => {
  const removed = db.remove('feeStructure', req.params.id);
  if (!removed) return fail(res, 404, 'Fee structure not found');
  ok(res, { id: req.params.id });
});

app.get('/api/fees/payments', (req, res) => {
  const { studentId } = req.query;
  let payments = db.getAll('payments');
  if (studentId) payments = payments.filter(p => p.studentId === studentId);
  ok(res, payments);
});

app.post('/api/fees/payments', (req, res) => {
  const { studentId, amount, method } = req.body || {};
  if (!studentId || amount == null) return fail(res, 400, 'studentId and amount are required');
  const record = db.insert('payments', { studentId, amount: Number(amount), method: method || 'Mobile Money', status: 'completed' });
  ok(res, record);
});

// =====================================================================
// TIMETABLE — Admin manages university-wide timetable
// =====================================================================
app.get('/api/timetable', (req, res) => {
  const { courseCode, day } = req.query;
  let rows = db.getAll('timetable');
  if (courseCode) rows = rows.filter(r => r.courseCode === courseCode);
  if (day) rows = rows.filter(r => r.day === day);
  ok(res, rows);
});

app.post('/api/timetable', (req, res) => {
  const { day, time, courseCode, room, lecturer } = req.body || {};
  if (!day || !time || !courseCode || !room) return fail(res, 400, 'day, time, courseCode, room are required');
  const record = db.insert('timetable', { day, time, courseCode, room, lecturer: lecturer || '' });
  ok(res, record);
});

app.put('/api/timetable/:id', (req, res) => {
  const updated = db.update('timetable', req.params.id, req.body);
  if (!updated) return fail(res, 404, 'Timetable entry not found');
  ok(res, updated);
});

app.delete('/api/timetable/:id', (req, res) => {
  const removed = db.remove('timetable', req.params.id);
  if (!removed) return fail(res, 404, 'Timetable entry not found');
  ok(res, { id: req.params.id });
});

// =====================================================================
// RESULTS & GRADING — Lecturer/Admin enters scores per student per course
// =====================================================================
app.get('/api/results', (req, res) => {
  const { studentId, courseCode } = req.query;
  let rows = db.getAll('results');
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

app.post('/api/results', (req, res) => {
  const { studentId, studentName, courseCode, caScore, examScore } = req.body || {};
  if (!studentId || !courseCode || caScore == null || examScore == null) {
    return fail(res, 400, 'studentId, courseCode, caScore, examScore are required');
  }
  const total = Number(caScore) + Number(examScore);
  const record = db.insert('results', {
    studentId, studentName: studentName || '', courseCode,
    caScore: Number(caScore), examScore: Number(examScore),
    total, grade: gradeFromScore(total)
  });
  ok(res, record);
});

app.put('/api/results/:id', (req, res) => {
  const existing = db.getById('results', req.params.id);
  if (!existing) return fail(res, 404, 'Result not found');
  const merged = { ...existing, ...req.body };
  merged.total = Number(merged.caScore || 0) + Number(merged.examScore || 0);
  merged.grade = gradeFromScore(merged.total);
  const updated = db.update('results', req.params.id, merged);
  ok(res, updated);
});

app.delete('/api/results/:id', (req, res) => {
  const removed = db.remove('results', req.params.id);
  if (!removed) return fail(res, 404, 'Result not found');
  ok(res, { id: req.params.id });
});

// =====================================================================
// VIRTUAL CLASSROOM — Lecturers post exams/quizzes, students take them
// =====================================================================
app.get('/api/exams', (req, res) => {
  const { courseCode, lecturerId } = req.query;
  let rows = db.getAll('exams');
  if (courseCode) rows = rows.filter(r => r.courseCode === courseCode);
  if (lecturerId) rows = rows.filter(r => r.lecturerId === lecturerId);
  ok(res, rows);
});

app.get('/api/exams/:id', (req, res) => {
  const exam = db.getById('exams', req.params.id);
  if (!exam) return fail(res, 404, 'Exam not found');
  ok(res, exam);
});

app.post('/api/exams', (req, res) => {
  const { title, courseCode, lecturerId, lecturerName, durationMinutes, questions, openAt, closeAt } = req.body || {};
  if (!title || !courseCode || !questions || !Array.isArray(questions) || questions.length === 0) {
    return fail(res, 400, 'title, courseCode, and a non-empty questions array are required');
  }
  // Each question: { text, options: [..], correctIndex, points }
  const record = db.insert('exams', {
    title, courseCode, lecturerId: lecturerId || '', lecturerName: lecturerName || '',
    durationMinutes: Number(durationMinutes || 30),
    questions,
    totalPoints: questions.reduce((s, q) => s + Number(q.points || 1), 0),
    openAt: openAt || null, closeAt: closeAt || null,
    status: 'published'
  });
  ok(res, record);
});

app.put('/api/exams/:id', (req, res) => {
  const updated = db.update('exams', req.params.id, req.body);
  if (!updated) return fail(res, 404, 'Exam not found');
  ok(res, updated);
});

app.delete('/api/exams/:id', (req, res) => {
  const removed = db.remove('exams', req.params.id);
  if (!removed) return fail(res, 404, 'Exam not found');
  ok(res, { id: req.params.id });
});

// Student submits answers; auto-graded against correctIndex
app.post('/api/exams/:id/submit', (req, res) => {
  const exam = db.getById('exams', req.params.id);
  if (!exam) return fail(res, 404, 'Exam not found');
  const { studentId, studentName, answers } = req.body || {}; // answers: [selectedIndex,...]
  if (!studentId || !Array.isArray(answers)) return fail(res, 400, 'studentId and answers array are required');

  const already = db.findOne('examSubmissions', s => s.examId === exam.id && s.studentId === studentId);
  if (already) return fail(res, 409, 'You have already submitted this exam');

  let score = 0;
  const breakdown = exam.questions.map((q, i) => {
    const correct = Number(answers[i]) === Number(q.correctIndex);
    if (correct) score += Number(q.points || 1);
    return { question: q.text, selected: answers[i], correctIndex: q.correctIndex, correct, points: correct ? Number(q.points || 1) : 0 };
  });

  const record = db.insert('examSubmissions', {
    examId: exam.id, examTitle: exam.title, courseCode: exam.courseCode,
    studentId, studentName: studentName || '',
    answers, breakdown, score, totalPoints: exam.totalPoints,
    percentage: exam.totalPoints ? Math.round((score / exam.totalPoints) * 100) : 0,
    submittedAt: new Date().toISOString()
  });
  ok(res, record);
});

app.get('/api/exams/:id/submissions', (req, res) => {
  const rows = db.find('examSubmissions', s => s.examId === req.params.id);
  ok(res, rows);
});

app.get('/api/students/:studentId/submissions', (req, res) => {
  const rows = db.find('examSubmissions', s => s.studentId === req.params.studentId);
  ok(res, rows);
});

// =====================================================================
// ATTENDANCE — Lecturer takes attendance per course/session
// =====================================================================
app.get('/api/attendance', (req, res) => {
  const { courseCode, studentId, date } = req.query;
  let rows = db.getAll('attendance');
  if (courseCode) rows = rows.filter(r => r.courseCode === courseCode);
  if (studentId) rows = rows.filter(r => r.studentId === studentId);
  if (date) rows = rows.filter(r => r.date === date);
  ok(res, rows);
});

// Lecturer submits a full session's attendance at once
// body: { courseCode, date, lecturerId, records: [{studentId, studentName, status}] }
app.post('/api/attendance/session', (req, res) => {
  const { courseCode, date, lecturerId, records } = req.body || {};
  if (!courseCode || !date || !Array.isArray(records)) {
    return fail(res, 400, 'courseCode, date, and records array are required');
  }
  // Remove any existing entries for this course+date so re-submission overwrites cleanly
  db.removeWhere('attendance', r => r.courseCode === courseCode && r.date === date);
  const saved = records.map(r => db.insert('attendance', {
    courseCode, date, lecturerId: lecturerId || '',
    studentId: r.studentId, studentName: r.studentName || '',
    status: r.status || 'absent' // present | absent | late
  }));
  ok(res, saved);
});

app.get('/api/attendance/summary/:studentId', (req, res) => {
  const rows = db.find('attendance', r => r.studentId === req.params.studentId);
  const total = rows.length;
  const present = rows.filter(r => r.status === 'present').length;
  const late = rows.filter(r => r.status === 'late').length;
  const absent = rows.filter(r => r.status === 'absent').length;
  ok(res, { total, present, late, absent, percentage: total ? Math.round((present / total) * 100) : 0 });
});

// =====================================================================
// Health check
// =====================================================================
app.get('/api/health', (req, res) => ok(res, { status: 'CampusIQ API running', time: new Date().toISOString() }));

app.get('/', (req, res) => {
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

if (require.main === module) {
  startServer();
}

// =====================================================================
// NOTIFICATIONS
// =====================================================================
app.get('/api/notifications/:userId', (req, res) => {
  const rows = db.find('notifications', n => n.userId === req.params.userId || n.userId === 'all');
  ok(res, rows.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30));
});
app.post('/api/notifications', (req, res) => {
  const { userId, title, message, type } = req.body || {};
  if (!title || !message) return fail(res, 400, 'title and message required');
  ok(res, db.insert('notifications', { userId: userId || 'all', title, message, type: type || 'info', read: false }));
});
app.put('/api/notifications/:id/read', (req, res) => {
  const n = db.update('notifications', req.params.id, { read: true });
  if (!n) return fail(res, 404, 'Not found');
  ok(res, n);
});
app.delete('/api/notifications/:id', (req, res) => {
  db.remove('notifications', req.params.id); ok(res, { id: req.params.id });
});

// =====================================================================
// FEES — PAYMENTS (student uploads receipt, admin confirms)
// =====================================================================
app.get('/api/fees/payments/:studentId', (req, res) => {
  ok(res, db.find('payments', p => p.studentId === req.params.studentId));
});
app.post('/api/fees/payments/:studentId/receipt', (req, res) => {
  const { amount, method, reference, receiptNote } = req.body || {};
  if (!amount) return fail(res, 400, 'amount required');
  ok(res, db.insert('payments', {
    studentId: req.params.studentId, amount: Number(amount),
    method: method || 'Mobile Money', reference: reference || '', receiptNote: receiptNote || '',
    status: 'pending_confirmation'
  }));
});
app.put('/api/fees/payments/:id/confirm', (req, res) => {
  const p = db.update('payments', req.params.id, { status: 'confirmed', confirmedAt: new Date().toISOString() });
  if (!p) return fail(res, 404, 'Payment not found');
  ok(res, p);
});

// =====================================================================
// COURSE REGISTRATION
// =====================================================================
app.get('/api/registrations', (req, res) => {
  const { studentId, semester, courseCode } = req.query;
  let rows = db.getAll('registrations');
  if (studentId) rows = rows.filter(r => r.studentId === studentId);
  if (semester) rows = rows.filter(r => r.semester === semester);
  if (courseCode) rows = rows.filter(r => r.courseCode === courseCode);
  ok(res, rows);
});
app.post('/api/registrations', (req, res) => {
  const { studentId, studentName, courseCode, courseName, semester } = req.body || {};
  if (!studentId || !courseCode || !semester) return fail(res, 400, 'studentId, courseCode, semester required');
  const exists = db.findOne('registrations', r => r.studentId === studentId && r.courseCode === courseCode && r.semester === semester);
  if (exists) return fail(res, 409, 'Already registered for this course this semester');
  ok(res, db.insert('registrations', { studentId, studentName: studentName || '', courseCode, courseName: courseName || '', semester, status: 'registered' }));
});
app.delete('/api/registrations/:id', (req, res) => {
  db.remove('registrations', req.params.id); ok(res, { id: req.params.id });
});

// =====================================================================
// ASSIGNMENTS
// =====================================================================
app.get('/api/assignments', (req, res) => {
  const { courseCode, lecturerId } = req.query;
  let rows = db.getAll('assignments');
  if (courseCode) rows = rows.filter(a => a.courseCode === courseCode);
  if (lecturerId) rows = rows.filter(a => a.lecturerId === lecturerId);
  ok(res, rows);
});
app.post('/api/assignments', (req, res) => {
  const { title, courseCode, lecturerId, lecturerName, description, deadline, maxScore } = req.body || {};
  if (!title || !courseCode || !deadline) return fail(res, 400, 'title, courseCode, deadline required');
  ok(res, db.insert('assignments', { title, courseCode, lecturerId: lecturerId || '', lecturerName: lecturerName || '', description: description || '', deadline, maxScore: Number(maxScore || 100) }));
});
app.delete('/api/assignments/:id', (req, res) => {
  db.remove('assignments', req.params.id); ok(res, { id: req.params.id });
});
app.post('/api/assignments/:id/submit', (req, res) => {
  const { studentId, studentName, response, link } = req.body || {};
  if (!studentId) return fail(res, 400, 'studentId required');
  const already = db.findOne('assignmentSubmissions', s => s.assignmentId === req.params.id && s.studentId === studentId);
  if (already) return fail(res, 409, 'Already submitted');
  ok(res, db.insert('assignmentSubmissions', { assignmentId: req.params.id, studentId, studentName: studentName || '', response: response || '', link: link || '', status: 'submitted', score: null, feedback: '' }));
});
app.get('/api/assignments/:id/submissions', (req, res) => {
  ok(res, db.find('assignmentSubmissions', s => s.assignmentId === req.params.id));
});
app.put('/api/assignments/submissions/:id/grade', (req, res) => {
  const { score, feedback } = req.body || {};
  const s = db.update('assignmentSubmissions', req.params.id, { score: Number(score), feedback: feedback || '', status: 'graded' });
  if (!s) return fail(res, 404, 'Submission not found');
  ok(res, s);
});

// =====================================================================
// COURSE MATERIALS
// =====================================================================
app.get('/api/materials', (req, res) => {
  const { courseCode } = req.query;
  let rows = db.getAll('materials');
  if (courseCode) rows = rows.filter(m => m.courseCode === courseCode);
  ok(res, rows.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)));
});
app.post('/api/materials', (req, res) => {
  const { courseCode, title, type, url, week, lecturerId } = req.body || {};
  if (!courseCode || !title || !url) return fail(res, 400, 'courseCode, title, url required');
  ok(res, db.insert('materials', { courseCode, title, type: type || 'link', url, week: week || '', lecturerId: lecturerId || '' }));
});
app.delete('/api/materials/:id', (req, res) => {
  db.remove('materials', req.params.id); ok(res, { id: req.params.id });
});

// =====================================================================
// NOTICES / ANNOUNCEMENTS
// =====================================================================
app.get('/api/notices', (req, res) => {
  ok(res, db.getAll('notices').sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)));
});
app.post('/api/notices', (req, res) => {
  const { title, body, category, adminName } = req.body || {};
  if (!title || !body) return fail(res, 400, 'title and body required');
  const notice = db.insert('notices', { title, body, category: category || 'general', adminName: adminName || 'Admin' });
  // Push notification to all users
  db.insert('notifications', { userId: 'all', title: '📢 ' + title, message: body.slice(0, 100), type: 'notice', read: false });
  ok(res, notice);
});
app.delete('/api/notices/:id', (req, res) => {
  db.remove('notices', req.params.id); ok(res, { id: req.params.id });
});

// =====================================================================
// ACADEMIC CALENDAR
// =====================================================================
app.get('/api/calendar', (req, res) => ok(res, db.getAll('calendar').sort((a,b) => new Date(a.startDate) - new Date(b.startDate))));
app.post('/api/calendar', (req, res) => {
  const { title, startDate, endDate, type } = req.body || {};
  if (!title || !startDate) return fail(res, 400, 'title and startDate required');
  ok(res, db.insert('calendar', { title, startDate, endDate: endDate || startDate, type: type || 'event' }));
});
app.put('/api/calendar/:id', (req, res) => {
  const c = db.update('calendar', req.params.id, req.body);
  if (!c) return fail(res, 404, 'Not found');
  ok(res, c);
});
app.delete('/api/calendar/:id', (req, res) => {
  db.remove('calendar', req.params.id); ok(res, { id: req.params.id });
});

// =====================================================================
// HOSTEL ALLOCATION
// =====================================================================
app.get('/api/hostel-applications', (req, res) => {
  const { studentId, status } = req.query;
  let rows = db.getAll('hostelApplications');
  if (studentId) rows = rows.filter(r => r.studentId === studentId);
  if (status) rows = rows.filter(r => r.status === status);
  ok(res, rows);
});
app.post('/api/hostel-applications', (req, res) => {
  const { studentId, studentName, hostelId, hostelName, programme, level } = req.body || {};
  if (!studentId || !hostelId) return fail(res, 400, 'studentId and hostelId required');
  const exists = db.findOne('hostelApplications', a => a.studentId === studentId && a.status !== 'rejected');
  if (exists) return fail(res, 409, 'You already have a pending or approved hostel application');
  ok(res, db.insert('hostelApplications', { studentId, studentName: studentName || '', hostelId, hostelName: hostelName || '', programme: programme || '', level: level || '', status: 'pending', roomNumber: null }));
});
app.put('/api/hostel-applications/:id/allocate', (req, res) => {
  const { roomNumber, status } = req.body || {};
  const a = db.update('hostelApplications', req.params.id, { roomNumber: roomNumber || null, status: status || 'approved', allocatedAt: new Date().toISOString() });
  if (!a) return fail(res, 404, 'Application not found');
  ok(res, a);
});

// =====================================================================
// LIVE LOCATION SHARING
// =====================================================================
app.post('/api/location/update', (req, res) => {
  const { userId, userName, role, lat, lng, building, shareMode } = req.body || {};
  if (!userId || lat == null || lng == null) return fail(res, 400, 'userId, lat, lng required');
  // Upsert — overwrite existing location for this user
  const existing = db.findOne('liveLocations', l => l.userId === userId);
  if (existing) {
    ok(res, db.update('liveLocations', existing.id, { lat, lng, building: building || '', shareMode: shareMode || 'all', updatedAt: new Date().toISOString(), userName, role }));
  } else {
    ok(res, db.insert('liveLocations', { userId, userName: userName || '', role: role || 'student', lat, lng, building: building || '', shareMode: shareMode || 'all' }));
  }
});
app.get('/api/location/live', (req, res) => {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min stale cutoff
  const active = db.find('liveLocations', l => (l.updatedAt || l.createdAt) > cutoff);
  ok(res, active);
});
app.delete('/api/location/stop/:userId', (req, res) => {
  db.removeWhere('liveLocations', l => l.userId === req.params.userId);
  ok(res, { stopped: true });
});

// =====================================================================
// COURSE CHAT
// =====================================================================
app.get('/api/chat/:courseCode', (req, res) => {
  const msgs = db.find('chatMessages', m => m.courseCode === req.params.courseCode);
  ok(res, msgs.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-100));
});
app.post('/api/chat/:courseCode', (req, res) => {
  const { userId, userName, role, message } = req.body || {};
  if (!userId || !message) return fail(res, 400, 'userId and message required');
  ok(res, db.insert('chatMessages', { courseCode: req.params.courseCode, userId, userName: userName || '', role: role || 'student', message }));
});

// =====================================================================
// PORTFOLIO
// =====================================================================
app.get('/api/portfolio/:userId', (req, res) => {
  ok(res, db.find('portfolios', p => p.userId === req.params.userId));
});
app.post('/api/portfolio/:userId', (req, res) => {
  const { title, courseCode, desc, skills, link } = req.body || {};
  if (!title || !desc) return fail(res, 400, 'title and desc required');
  ok(res, db.insert('portfolios', {
    userId: req.params.userId, title,
    courseCode: courseCode || '', desc,
    skills: Array.isArray(skills) ? skills : (skills || '').split(',').map(s => s.trim()).filter(Boolean),
    link: link || ''
  }));
});
app.delete('/api/portfolio/:id', (req, res) => {
  db.remove('portfolios', req.params.id);
  ok(res, { id: req.params.id });
});

// =====================================================================
// ALUMNI QUESTIONS
// =====================================================================
app.get('/api/alumni-questions/:userId', (req, res) => {
  ok(res, db.find('alumniQuestions', q => q.askedBy === req.params.userId));
});
app.post('/api/alumni-questions', (req, res) => {
  const { alumniId, alumniName, question, askedBy, askedByName } = req.body || {};
  if (!alumniId || !question || !askedBy) return fail(res, 400, 'alumniId, question, askedBy required');
  ok(res, db.insert('alumniQuestions', {
    alumniId, alumniName: alumniName || '', question, askedBy,
    askedByName: askedByName || '', status: 'pending', answer: ''
  }));
});

// =====================================================================
// REFERRALS
// =====================================================================
app.get('/api/referrals/:userId', (req, res) => {
  ok(res, db.find('referrals', r => r.userId === req.params.userId));
});
app.post('/api/referrals', (req, res) => {
  const { userId, jobId, company, alumniName, code } = req.body || {};
  if (!userId || !jobId || !code) return fail(res, 400, 'userId, jobId, code required');
  ok(res, db.insert('referrals', {
    userId, jobId, company: company || '', alumniName: alumniName || '',
    code, status: 'requested', usedInApplication: false
  }));
});
app.put('/api/referrals/:id/use', (req, res) => {
  const r = db.update('referrals', req.params.id, { usedInApplication: true, status: 'active' });
  if (!r) return fail(res, 404, 'Referral not found');
  ok(res, r);
});

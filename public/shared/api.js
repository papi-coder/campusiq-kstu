// public/shared/api.js
// Thin fetch wrapper used by every CampusIQ page to talk to the backend API.
// Auto-detects local API port (3001-3005) or falls back to same-origin/production.
// Works when opened via http(s) or file:// on the local machine.

const CampusAPI = (() => {
  let BASE = '';
  const { protocol, hostname } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const isFile = protocol === 'file:';

  // For file:// we must use an absolute http(s) origin, never file://
  const originFor = () => {
    if (isLocal) return `${protocol}//${hostname}`;
    return 'http://localhost';
  };

  const candidates = [];
  if (isLocal || isFile) {
    const base = originFor();
    for (let p = 3001; p <= 3005; p++) candidates.push(`${base}:${p}`);
  }
  // Same-origin fallback (Vercel/production, or when a static server proxies /api)
  if (!isFile) {
    candidates.push(`${protocol}//${isLocal ? hostname : ''}`);
  } else {
    candidates.push('http://localhost');
  }

  // Probe health endpoint to find the live API server
  (async () => {
    for (const candidate of candidates) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 400);
        const r = await fetch(candidate + '/api/health', { method: 'GET', signal: ctrl.signal });
        clearTimeout(tid);
        if (r.ok) { BASE = candidate; return; }
      } catch (e) { /* try next */ }
    }
    BASE = candidates[candidates.length - 1];
  })();

  async function request(path, options = {}) {
    // If BASE hasn't resolved yet (probe still in flight), give it a moment
    if (!BASE && (isLocal || isFile)) {
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    const url = BASE + path;
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    let json;
    try { json = await res.json(); }
    catch { throw new Error('Server returned an invalid response'); }
    if (!res.ok || (json && json.success === false)) {
      throw new Error(json?.message || `Request failed (${res.status})`);
    }
    return json.data;
  }

  return {
    get: (path) => request(path, { method: 'GET' }),
    post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
    put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
    del: (path) => request(path, { method: 'DELETE' }),

    // ---- convenience wrappers ----
    adminLogin: (email, password) =>
    CampusAPI.post('/api/admin/login', { email, password }),
    adminChangePassword: (username, oldPassword, newPassword) =>
    CampusAPI.post('/api/admin/change-password', {
        username,
        oldPassword,
        newPassword
    }),
    login: (email, password, role) => CampusAPI.post('/api/login', { email, password, role }),

    listUsers: (role) => CampusAPI.get('/api/users' + (role ? `?role=${role}` : '')),
    createUser: (user) => CampusAPI.post('/api/users', user),
    updateUser: (id, patch) => CampusAPI.put(`/api/users/${id}`, patch),
    deleteUser: (id) => CampusAPI.del(`/api/users/${id}`),
    getUserByStudentId: (studentId) => CampusAPI.get(`/api/users/lookup?studentId=${encodeURIComponent(studentId)}`),

    listHostels: () => CampusAPI.get('/api/hostels'),
    createHostel: (h) => CampusAPI.post('/api/hostels', h),
    updateHostel: (id, patch) => CampusAPI.put(`/api/hostels/${id}`, patch),
    deleteHostel: (id) => CampusAPI.del(`/api/hostels/${id}`),

    listFeeStructures: () => CampusAPI.get('/api/fees/structure'),
    createFeeStructure: (f) => CampusAPI.post('/api/fees/structure', f),
    updateFeeStructure: (id, patch) => CampusAPI.put(`/api/fees/structure/${id}`, patch),
    deleteFeeStructure: (id) => CampusAPI.del(`/api/fees/structure/${id}`),
    listPayments: (studentId) => CampusAPI.get('/api/fees/payments' + (studentId ? `?studentId=${studentId}` : '')),
    recordPayment: (p) => CampusAPI.post('/api/fees/payments', p),

    listTimetable: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return CampusAPI.get('/api/timetable' + (qs ? `?${qs}` : ''));
    },
    createTimetableEntry: (t) => CampusAPI.post('/api/timetable', t),
    updateTimetableEntry: (id, patch) => CampusAPI.put(`/api/timetable/${id}`, patch),
    deleteTimetableEntry: (id) => CampusAPI.del(`/api/timetable/${id}`),

    listResults: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return CampusAPI.get('/api/results' + (qs ? `?${qs}` : ''));
    },
    createResult: (r) => CampusAPI.post('/api/results', r),
    updateResult: (id, patch) => CampusAPI.put(`/api/results/${id}`, patch),
    deleteResult: (id) => CampusAPI.del(`/api/results/${id}`),

    listExams: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return CampusAPI.get('/api/exams' + (qs ? `?${qs}` : ''));
    },
    getExam: (id) => CampusAPI.get(`/api/exams/${id}`),
    createExam: (e) => CampusAPI.post('/api/exams', e),
    updateExam: (id, patch) => CampusAPI.put(`/api/exams/${id}`, patch),
    deleteExam: (id) => CampusAPI.del(`/api/exams/${id}`),
    submitExam: (id, submission) => CampusAPI.post(`/api/exams/${id}/submit`, submission),
    examSubmissions: (id) => CampusAPI.get(`/api/exams/${id}/submissions`),
    studentSubmissions: (studentId) => CampusAPI.get(`/api/students/${studentId}/submissions`),

    listAttendance: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return CampusAPI.get('/api/attendance' + (qs ? `?${qs}` : ''));
    },
    submitAttendanceSession: (session) => CampusAPI.post('/api/attendance/session', session),
    attendanceSummary: (studentId) => CampusAPI.get(`/api/attendance/summary/${studentId}`),
    getAttendanceRoster: (courseCode, date) => CampusAPI.get(`/api/attendance/roster?courseCode=${encodeURIComponent(courseCode)}&date=${encodeURIComponent(date)}`),
    markSelfAttendance: (data) => CampusAPI.post('/api/attendance/self', data),
  };
})();

// ---- Extended API methods ----
Object.assign(CampusAPI, {
  // Notifications
  getNotifications: (userId) => CampusAPI.get(`/api/notifications/${userId}`),
  markRead: (id) => CampusAPI.put(`/api/notifications/${id}/read`, {}),
  postNotice: (n) => CampusAPI.post('/api/notifications', n),

  // Payments
  getPayments: (studentId) => CampusAPI.get(`/api/fees/payments/${studentId}`),
  submitReceipt: (studentId, p) => CampusAPI.post(`/api/fees/payments/${studentId}/receipt`, p),
  confirmPayment: (id) => CampusAPI.put(`/api/fees/payments/${id}/confirm`, {}),
  updatePayment: (id, patch) => CampusAPI.put(`/api/fees/payments/${id}`, patch),

  // Course registration
  getRegistrations: (params = {}) => { const q = new URLSearchParams(params).toString(); return CampusAPI.get('/api/registrations' + (q ? '?' + q : '')); },
  registerCourse: (r) => CampusAPI.post('/api/registrations', r),
  unregisterCourse: (id) => CampusAPI.del(`/api/registrations/${id}`),

  // Assignments
  listAssignments: (params = {}) => { const q = new URLSearchParams(params).toString(); return CampusAPI.get('/api/assignments' + (q ? '?' + q : '')); },
  createAssignment: (a) => CampusAPI.post('/api/assignments', a),
  deleteAssignment: (id) => CampusAPI.del(`/api/assignments/${id}`),
  submitAssignment: (id, s) => CampusAPI.post(`/api/assignments/${id}/submit`, s),
  getAssignmentSubmissions: (id) => CampusAPI.get(`/api/assignments/${id}/submissions`),
  gradeSubmission: (id, g) => CampusAPI.put(`/api/assignments/submissions/${id}/grade`, g),

  // Materials
  listMaterials: (courseCode) => CampusAPI.get('/api/materials' + (courseCode ? `?courseCode=${courseCode}` : '')),
  postMaterial: (m) => CampusAPI.post('/api/materials', m),
  deleteMaterial: (id) => CampusAPI.del(`/api/materials/${id}`),

  // Notices
  listNotices: () => CampusAPI.get('/api/notices'),
  postNoticeAdmin: (n) => CampusAPI.post('/api/notices', n),
  deleteNotice: (id) => CampusAPI.del(`/api/notices/${id}`),

  // Calendar
  listCalendar: () => CampusAPI.get('/api/calendar'),
  createCalendarEvent: (e) => CampusAPI.post('/api/calendar', e),
  updateCalendarEvent: (id, p) => CampusAPI.put(`/api/calendar/${id}`, p),
  deleteCalendarEvent: (id) => CampusAPI.del(`/api/calendar/${id}`),

  // Hostel allocation
  listHostelApplications: (params = {}) => { const q = new URLSearchParams(params).toString(); return CampusAPI.get('/api/hostel-applications' + (q ? '?' + q : '')); },
  applyHostel: (a) => CampusAPI.post('/api/hostel-applications', a),
  allocateHostel: (id, p) => CampusAPI.put(`/api/hostel-applications/${id}/allocate`, p),

  // Live location
  updateLocation: (l) => CampusAPI.post('/api/location/update', l),
  getLiveLocations: () => CampusAPI.get('/api/location/live'),
  stopSharing: (userId) => CampusAPI.del(`/api/location/stop/${userId}`),

  // Course chat
  getChatMessages: (courseCode) => CampusAPI.get(`/api/chat/${courseCode}`),
  sendChatMessage: (courseCode, m) => CampusAPI.post(`/api/chat/${courseCode}`, m),

  // Papi AI tutor
  askAI: (payload) => CampusAPI.post('/api/ai', payload),
});

// Portfolio, alumni, referrals
Object.assign(CampusAPI, {
  getPortfolio: (userId) => CampusAPI.get(`/api/portfolio/${userId}`),
  addPortfolioItem: (userId, item) => CampusAPI.post(`/api/portfolio/${userId}`, item),
  deletePortfolioItem: (id) => CampusAPI.del(`/api/portfolio/${id}`),
  getAlumniQuestions: (userId) => CampusAPI.get(`/api/alumni-questions/${userId}`),
  askAlumniQuestion: (q) => CampusAPI.post('/api/alumni-questions', q),
    getReferrals: (userId) => CampusAPI.get(`/api/referrals/${userId}`),
    useReferral: (id) => CampusAPI.put(`/api/referrals/${id}/use`, {}),

    // Papi AI
    askAI: (payload) => CampusAPI.post('/api/ai/ask', payload),
});

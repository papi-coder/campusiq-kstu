// public/shared/api.js
// Thin fetch wrapper used by every CampusIQ page to talk to the backend API.
// Auto-detects local API port (3001-3010) or falls back to same-origin/production.
// Works when opened via http(s) or file:// on the local machine.

const CampusAPI = (() => {
  let BASE = '';
  const { protocol, hostname } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const isFile = protocol === 'file:';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // For file:// we must use an absolute http(s) origin, never file://
  const originFor = () => {
    if (isLocal) return `${protocol}//${hostname}`;
    return 'http://localhost';
  };

  const candidates = [];
  let fallbackOrigin = '';
  if (isLocal || isFile) {
    const base = originFor();
    // The API server auto-retries ports 3001..3010 on EADDRINUSE, so probe the
    // same range to discover whichever port it actually bound to.
    for (let p = 3001; p <= 3010; p++) candidates.push(`${base}:${p}`);
    fallbackOrigin = candidates[0]; // e.g. http://localhost:3001
  }
  // Same-origin fallback (Vercel/production, or when a static server proxies /api)
  if (!isFile) {
    candidates.push(`${protocol}//${hostname}`);
  } else {
    candidates.push(fallbackOrigin);
  }

  // ---- Connectivity monitoring --------------------------------------------
  // Tracks whether the backend API is reachable and shows a clear status banner
  // on every page (all pages load this module). Pages can also subscribe via
  // CampusAPI.onStatus(cb) to react to online/offline transitions.
  let online = null; // null = unknown, true = reachable, false = offline
  const statusListeners = [];
  function setStatus(next) {
    if (next === online) return;
    online = next;
    updateBanner();
    statusListeners.forEach(cb => { try { cb(online); } catch (e) { console.debug('[CampusAPI] Status listener error:', e); } });
  }
  function onStatus(cb) { if (typeof cb === 'function') statusListeners.push(cb); }

  let bannerEl = null;
  function ensureBanner() {
    if (bannerEl) return bannerEl;
    bannerEl = document.createElement('div');
    bannerEl.id = 'api-status-banner';
    bannerEl.setAttribute('role', 'status');
    bannerEl.setAttribute('aria-live', 'polite');
    Object.assign(bannerEl.style, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: '99999',
      textAlign: 'center', padding: '8px 12px', fontSize: '0.8rem',
      fontWeight: '700', letterSpacing: '0.02em', fontFamily: 'inherit',
      pointerEvents: 'none', transition: 'opacity .3s ease', display: 'none'
    });
    (document.body || document.documentElement).appendChild(bannerEl);
    return bannerEl;
  }
  function updateBanner() {
    const el = ensureBanner();
    const dot = document.getElementById('api-status-dot');
    const label = document.getElementById('api-status-label');
    if (online === false) {
      el.textContent = '⚠ Offline — API unavailable. Connect the CampusIQ server or check your network.';
      el.style.background = '#7f1d1d';
      el.style.color = '#fecaca';
      el.style.borderBottom = '1px solid #b91c1c';
      el.style.display = '';
      if (dot) { dot.style.background = '#ef4444'; dot.style.animation = 'none'; }
      if (label) label.textContent = 'Offline — API unavailable';
    } else if (online === true) {
      el.textContent = '● API Connected';
      el.style.background = '#064e3b';
      el.style.color = '#a7f3d0';
      el.style.borderBottom = '1px solid #047857';
      el.style.display = '';
      if (dot) { dot.style.background = '#22c55e'; dot.style.animation = 'blink 2s infinite'; }
      if (label) label.textContent = 'API Connected';
      clearTimeout(ensureBanner._hideT);
      ensureBanner._hideT = setTimeout(() => { if (online === true) el.style.display = 'none'; }, 2500);
    } else {
      el.style.display = 'none';
      if (dot) dot.style.background = '#f59e0b';
    }
  }

  let probing = false;
  async function probe() {
    if (probing) return online;
    probing = true;
    try {
      const order = (BASE ? [BASE, ...candidates] : candidates).filter(Boolean);
      console.log('[CampusAPI] Probing API endpoints:', order.slice(0, 5).join(', ') + (order.length > 5 ? '...' : ''));
      for (const candidate of order) {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 700);
        try {
          const r = await fetch(candidate + '/api/health', { method: 'GET', signal: ctrl.signal });
          clearTimeout(tid);
          if (r.ok) { BASE = candidate; console.log('[CampusAPI] API found at:', BASE); setStatus(true); return true; }
        } catch {
          clearTimeout(tid);
          continue; // try next candidate on failure
        }
      }
      // Same-origin /api/health (Vercel/production only; localhost always uses a
      // different port for the backend, so skip the same-origin probe there to
      // avoid needless 404s and service-worker noise).
      if (!isFile && !isLocal) {
        const r = await fetch('/api/health', { method: 'GET' }).catch(() => null);
        if (r?.ok) { BASE = ''; console.log('[CampusAPI] API found at same-origin /api'); setStatus(true); return true; }
      }
      console.warn('[CampusAPI] API probe failed. No backend reachable at:', candidates.join(', '));
      setStatus(false);
      return false;
    } finally {
      probing = false;
    }
  }
  function safeProbe() { return probe(); }

  // Initial probe, periodic monitoring, and reconnect when the browser reports
  // connectivity changes.
  safeProbe();
  setInterval(safeProbe, 15000);
  window.addEventListener('online', safeProbe);
  window.addEventListener('offline', () => setStatus(false));

  // ---- Helpers to keep request() flat ----
  async function _discoverApi() {
    console.log('[CampusAPI] Initial probe timed out, trying direct discovery...');
    for (const candidate of candidates.filter(Boolean)) {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 400);
      try {
        const r = await fetch(candidate + '/api/health', { method: 'GET', signal: ctrl.signal });
        clearTimeout(tid);
        if (r.ok) { BASE = candidate; console.log('[CampusAPI] API discovered at:', BASE); return true; }
      } catch {
        clearTimeout(tid);
        continue; // try next candidate
      }
    }
    return false;
  }

  async function _waitForBase() {
    if (!BASE && (isLocal || isFile)) {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        if (BASE) break;
        await sleep(100);
      }
      if (!BASE && !await _discoverApi()) {
        if (!BASE) BASE = fallbackOrigin || candidates.at(-1);
        console.log('[CampusAPI] Final BASE:', BASE);
      }
    }
  }

  async function _fetchWithRetry(url, path, options) {
    try {
      return await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
    } catch (netErr) {
      console.error('[CampusAPI] Network error for', url, ':', netErr.message);
      if (online === false) {
        throw new Error('Offline — API unavailable. Connect the CampusIQ server or check your network.');
      }
      safeProbe();
      if (BASE && BASE !== url) {
        const retryUrl = BASE + path;
        console.log('[CampusAPI] Retrying with rediscovered base:', retryUrl);
        try {
          return await fetch(retryUrl, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
          });
        } catch (retryErr) {
          console.error('[CampusAPI] Retry also failed:', retryErr.message);
          throw new Error('Offline — API unavailable. Connect the CampusIQ server or check your network.');
        }
      }
      throw new Error('Offline — API unavailable. Connect the CampusIQ server or check your network.');
    }
  }

  async function request(path, options = {}) {
    if (online === false) {
      safeProbe();
      throw new Error('Offline — API unavailable. Connect the CampusIQ server or check your network.');
    }
    await _waitForBase();
    const url = BASE + path;
    console.log('[CampusAPI] Request:', options.method || 'GET', url);
    const res = await _fetchWithRetry(url, path, options);
    let json;
    try { json = await res.json(); }
    catch { throw new Error('Server returned an invalid response'); }
    if (!res.ok || (json?.success === false)) {
      throw new Error(json?.message || `Request failed (${res.status})`);
    }
    return json.data;
  }

  return {
    get status() { return online; },
    isOnline: () => online === true,
    onStatus,
    probe: safeProbe,
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
});

// Portfolio, alumni, referrals
Object.assign(CampusAPI, {
  getPortfolio: (userId) => CampusAPI.get(`/api/portfolio/${userId}`),
  addPortfolioItem: (userId, item) => CampusAPI.post(`/api/portfolio/${userId}`, item),
  deletePortfolioItem: (id) => CampusAPI.del(`/api/portfolio/${id}`),
  getAlumniQuestions: (userId) => CampusAPI.get(`/api/alumni-questions/${userId}`),
  askAlumniQuestion: (q) => CampusAPI.post('/api/alumni-questions', q),
    getReferrals: (userId) => CampusAPI.get(`/api/referrals/${userId}`),
    createReferral: (payload) => CampusAPI.post('/api/referrals', payload),
    useReferral: (id) => CampusAPI.put(`/api/referrals/${id}/use`, {}),

  // Papi AI
  askAI: (payload) => CampusAPI.post('/api/ai/ask', payload),
});

// Virtual classrooms
Object.assign(CampusAPI, {
  listClassrooms: (params = {}) => { const q = new URLSearchParams(params).toString(); return CampusAPI.get('/api/classrooms' + (q ? '?' + q : '')); },
  getClassroom: (id) => CampusAPI.get(`/api/classrooms/${id}`),
  createClassroom: (c) => CampusAPI.post('/api/classrooms', c),
  updateClassroom: (id, patch) => CampusAPI.put(`/api/classrooms/${id}`, patch),
  deleteClassroom: (id) => CampusAPI.del(`/api/classrooms/${id}`),
  submitClassroom: (id, body) => CampusAPI.post(`/api/classrooms/${id}/submit`, body),
  listClassroomSubmissions: (id) => CampusAPI.get(`/api/classrooms/${id}/submissions`),
});

// Bulk import
Object.assign(CampusAPI, {
  bulkImport: (collection, records) => CampusAPI.post('/api/bulk-import', { collection, records }),
});

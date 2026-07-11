

// =====================================================================
// STATE
// =====================================================================
let currentUser = null;
let loginRole = 'student';
let currentLang = 'en';
let isDark = true;
let locationInterval = null;
let chatInterval = null;
let examResultCache = {};
// Helper functions to reduce nested ternaries
function renderExamAction(ex, submitted, isLec) {
  if (isLec) {
    return `<button class="btn-sm bs-blue u-inline-74" onclick="viewSubs('${ex.id}','${escAttr(ex.title)}')" >Submissions</button><button class="btn-sm bs-red" onclick="delExam('${ex.id}')">Delete</button>`;
  }
  if (submitted) {
    examResultCache[submitted.id] = submitted;
    return `<span class="badge b-green">✓ ${submitted.percentage}%</span> <button class="btn-sm bs-blue" onclick="showResult('${submitted.id}')">View</button>`;
  }
  return `<button class="btn-p btn-sm" onclick="startExam('${ex.id}')">Take Exam</button>`;
}
function renderAssignmentAction(a, mySub, isLec) {
  if (isLec) {
    return `<button class="btn-sm bs-blue" onclick="viewAsgnSubs('${a.id}','${escAttr(a.title)}')">View Submissions</button>`;
  }
  if (mySub) {
    const scoreText = mySub.score != null ? ` · ${mySub.score}/${a.maxScore}` : '';
    const feedbackHtml = mySub.feedback ? `<div class="text-072 text-t2 mt-3">Feedback: ${escAttr(mySub.feedback)}</div>` : '';
    return `<span class="badge b-green">✓ Submitted${scoreText}</span>${feedbackHtml}`;
  }
  return `<button class="btn-p btn-sm" onclick="openSubmitAsgn('${a.id}','${escAttr(a.title)}','${escAttr(a.description||'')}')">Submit</button>`;
}
function renderMaterialRow(m, isLec) {
  const weekHtml = m.week ? `<span class="text-068 text-t2">${escAttr(m.week)}</span>` : '';
  const deleteButton = isLec ? `<button class="btn-sm bs-red" onclick="delMaterial('${m.id}')">Del</button>` : '';
  return `<div class="material-row">
    <div><strong class="text-sm">${escAttr(m.title)}</strong> <span class="badge b-blue">${escAttr(m.courseCode)}</span>${weekHtml}<div class="text-070 text-t2">${escAttr(m.type)}</div></div>
    <div class="material-actions">
      <a href="${escAttr(m.url)}" target="_blank" class="btn-sm bs-green">Open</a>
      ${deleteButton}
    </div>
  </div>`;
}
function getResultToneClass(pct){
  if(pct >= 70) return 'text-green';
  if(pct >= 50) return 'text-gold';
  return 'text-red';
}
function getResultBadgeClass(pct){
  if(pct >= 70) return 'b-green';
  if(pct >= 50) return 'b-gold';
  return 'b-red';
}
function getResultLabel(pct){
  if(pct >= 70) return 'Excellent';
  if(pct >= 50) return 'Pass';
  return 'Needs Improvement';
}
function getGradeBadgeClassByLetter(g){
  if(g === 'A') return 'b-green';
  if(g === 'F') return 'b-red';
  return 'b-blue';
}
function getGradeMarkerColor(g){
  if(g === 'A') return '#10b981';
  if(g === 'F') return '#ef4444';
  return '#3b82f6';
}
function getHostelStatusClass(status){
  if(status === 'approved') return 'green';
  if(status === 'pending') return 'gold';
  return 'red';
}
function getBalanceColor(owed){
  return owed > 0 ? '#fca5a5' : '#34d399';
}
function getHostelActionHtml(hostel, myApp){
  if(!myApp && hostel.occupied < hostel.capacity){
    return `<button class="btn-g w-full text-base" onclick="applyHostel('${hostel.id}','${hostel.name}')">Apply for Allocation</button>`;
  }
  if(myApp?.hostelId === hostel.id){
    return '<span class="badge b-blue">Applied</span>';
  }
  return '';
}
function sendLocationSnapshot(){
  navigator.geolocation.getCurrentPosition(async p => {
    const lat = p.coords.latitude;
    const lng = p.coords.longitude;
    const building = getBuildingName(lat, lng);
    await CampusAPI.updateLocation({userId:currentUser.id,userName:currentUser.name,role:currentUser.role,lat,lng,building}).catch(()=>{});
    if(googleMap){
      if(mapMarkers[currentUser.id]) mapMarkers[currentUser.id].setPosition({lat,lng});
      else updateMapMarkers();
    }
    document.getElementById('loc-my-building').textContent = building || 'On campus';
    loadLiveLocations();
  }, ()=>{}, {enableHighAccuracy:true});
}
function statusBadgeClass(s){
  if(s==='approved'||s==='confirmed') return 'b-green';
  if(s==='pending_confirmation'||s==='pending') return 'b-gold';
  return 'b-red';
}
function availBadgeClass(occupied, capacity){ return occupied>=capacity?'b-red':'b-green'; }
function attendanceBadgeClass(s){
  if(s==='present') return 'b-green';
  if(s==='late') return 'b-gold';
  return 'b-red';
}
let notifInterval = null;
let examTimer = null;
let examSeconds = 0;
let activeExam = null;
let activeExamId = null;
let qCount = 0;
let currentChatCourse = '';
let activeSubmitAsgnId = null;
let mapInitialized = false;
let googleMap = null;
let mapMarkers = {};

// =====================================================================
// TRANSLATIONS
// =====================================================================
const T = {
  en: {
    timetable:'This Week\'s Timetable', upcoming:'Upcoming Events', classroom:'Virtual Classroom',
    exams:'Exams', assignments:'Assignments', materials:'Course Materials',
    attendance:'Attendance', results:'Results & GPA', tt:'Timetable',
    home:'Home', ai:'Papi AI'
  },
  tw: {
    timetable:'Nnawotwe Yi Amammui', upcoming:'Ahorow a Ɛreba', classroom:'Ɔkwankyerɛ Mu Asɔrekɔbea',
    exams:'Nhwɛsoɔ', assignments:'Adwuma', materials:'Kɔrsɔ Nhyehyɛe',
    attendance:'Wɔ Hɔ', results:'Abusuadeɛ', tt:'Bɔɔding',
    home:'Fie', ai:'Papi AI'
  }
};
function t(key){ return (T[currentLang]||T.en)[key] || key; }
function toggleLang(){
  currentLang = currentLang === 'en' ? 'tw' : 'en';
  document.getElementById('lang-btn').textContent = currentLang === 'en' ? '🇬🇭 TW' : '🇬🇧 EN';
  applyTranslations();
}
function applyTranslations(){
  Object.keys(T.en).forEach(k => {
    const el = document.getElementById('t-'+k);
    if(el) el.textContent = t(k);
  });
}

// =====================================================================
// THEME
// =====================================================================
function toggleTheme(){
  isDark = !isDark;
  document.body.classList.toggle('light', !isDark);
  document.getElementById('theme-btn').textContent = isDark ? '☀️' : '🌙';
}

// =====================================================================
// AUTH
// =====================================================================
function selRole(r, btn){
  loginRole = r;
  document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
}
async function doLogin(){
  const email = document.getElementById('l-email').value.trim();
  const pass = document.getElementById('l-pass').value;
  const loginMessage = document.getElementById('l-err');
  try {
    const user = await CampusAPI.login(email, pass, loginRole);
    currentUser = user;
    launchApp();
   } catch(err){ console.warn(err); loginMessage.textContent = err.message; }
}
document.getElementById('l-pass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });

function launchApp(){
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('nav').classList.remove('hidden');
  document.getElementById('notice-ticker').classList.remove('hidden');
  document.getElementById('main').classList.remove('hidden');
  const navText = document.getElementById('nav-av-text');
  const navImg = document.getElementById('nav-av-img');
  if(currentUser.passportDataUrl){
    navImg.src = currentUser.passportDataUrl;
    navImg.style.display = 'block';
    if(navText) navText.style.display = 'none';
  } else {
    navImg.style.display = 'none';
    if(navText){ navText.style.display = 'flex'; navText.textContent = currentUser.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
  }
  buildNav();
  showScreen('home');
  loadNoticeTicker();
  loadNotifications();
  notifInterval = setInterval(loadNotifications, 30000);
}
function logout(){
  if(locationInterval){ clearInterval(locationInterval); CampusAPI.stopSharing(currentUser.id).catch(()=>{}); }
  clearInterval(notifInterval); clearInterval(chatInterval);
  currentUser = null; location.reload();
}
function hidePublicProfile(){
  const el = document.getElementById('public-profile-screen');
  if(el){ el.classList.add('hidden'); el.style.display = 'none'; }
}
function showLogin(){
  const el = document.getElementById('login-screen');
  if(el){ el.classList.remove('hidden'); el.style.display = ''; }
  const pub = document.getElementById('public-profile-screen');
  if(pub){ pub.classList.add('hidden'); pub.style.display = 'none'; }
}

// NAV CONFIG
const NAV = {
  student: [
    {id:'home',icon:'🏠',label:'Home'},{id:'ai',icon:'🧠',label:'Papi AI'},
    {id:'classroom',icon:'🧑‍💻',label:'Classroom'},{id:'attendance',icon:'✅',label:'Attendance'},
    {id:'results',icon:'🏆',label:'Results'},{id:'registration',icon:'📝',label:'Register'},
    {id:'fees',icon:'💰',label:'Fees'},{id:'hostels',icon:'🏠',label:'Hostels'},
    {id:'timetable',icon:'📅',label:'Timetable'},{id:'locator',icon:'📍',label:'Locator'},
    {id:'idcard',icon:'🪪',label:'ID Card'},{id:'chat',icon:'💬',label:'Chat'},
    {id:'calendar',icon:'📆',label:'Calendar'},
  ],
  lecturer: [
    {id:'home',icon:'🏠',label:'Home'},{id:'ai',icon:'🧠',label:'Papi AI'},
    {id:'classroom',icon:'🧑‍💻',label:'Classroom'},{id:'attendance',icon:'✅',label:'Attendance'},
    {id:'results',icon:'🏆',label:'Results'},{id:'timetable',icon:'📅',label:'Timetable'},
    {id:'locator',icon:'📍',label:'Locator'},{id:'chat',icon:'💬',label:'Chat'},
    {id:'calendar',icon:'📆',label:'Calendar'},
  ],
  hod: [
    {id:'home',icon:'🏠',label:'Home'},{id:'ai',icon:'🧠',label:'Papi AI'},
    {id:'classroom',icon:'🧑‍💻',label:'Classroom'},{id:'results',icon:'🏆',label:'Results'},
    {id:'timetable',icon:'📅',label:'Timetable'},{id:'locator',icon:'📍',label:'Locator'},
    {id:'chat',icon:'💬',label:'Chat'},{id:'calendar',icon:'📆',label:'Calendar'},
  ],
};
function buildNav(){
  const tabs = document.getElementById('ntabs');
  tabs.innerHTML = '';
  (NAV[currentUser.role]||[]).forEach(t => {
    const b = document.createElement('button');
    b.className = 'ntab';
    b.textContent = t.icon + ' ' + t.label;
    b.onclick = () => showScreen(t.id);
    tabs.appendChild(b);
  });
}
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-'+id).classList.add('active');
  const tabs = document.querySelectorAll('.ntab');
  (NAV[currentUser.role]||[]).forEach((t,i) => { if(tabs[i]) tabs[i].classList.toggle('active', t.id===id); });
  if(id==='home') loadHome();
  if(id==='classroom') loadClassroom();
  if(id==='attendance') loadAttendanceScreen();
  if(id==='results') loadResults();
  if(id==='timetable') loadTimetable();
  if(id==='registration') loadRegistration();
  if(id==='fees') loadFees();
  if(id==='hostels') loadHostels();
  if(id==='locator') loadLocator();
  if(id==='idcard') renderIDCard();
  if(id==='calendar') loadCalendar();
  if(id==='chat'){ clearInterval(chatInterval); }
}
function closeM(id){ document.getElementById(id).classList.remove('open'); }

// =====================================================================
// HOME
// =====================================================================
async function loadHome(){
  document.getElementById('home-greet').textContent = 'Welcome back, ' + currentUser.name.split(' ')[0] + ' 👋';
  document.getElementById('home-sub').textContent = (currentUser.programme||currentUser.department||currentUser.role) + ' · ' + currentUser.email;
  try {
    const [tt, notices, exams] = await Promise.all([
      CampusAPI.listTimetable().catch(()=>[]),
      CampusAPI.listNotices().catch(()=>[]),
      CampusAPI.listExams().catch(()=>[]),
    ]);
    // Notice board
    if(notices.length){
      const nb = document.getElementById('notice-board');
      nb.style.display = 'block';
       nb.innerHTML = '<div class="gc gold">' + notices.slice(0,2).map(n=>`<div class="mb-4"><strong>📢 ${n.title}</strong> <span class="text-072 text-t2">${n.category}</span><div class="text-base text-t2 mt-3">${n.body}</div></div>`).join('') + '</div>';
    }
       document.getElementById('home-tt').innerHTML = tt.slice(0,5).map(t=>`<tr><td>${t.day}</td><td>${t.time}</td><td>${t.courseCode}</td><td>${t.room}</td></tr>`).join('') || '<tr><td colspan="4" class="text-center text-t3">No timetable entries yet.</td></tr>';
    // Stats
    if(currentUser.role === 'student'){
      const [att, results, subs] = await Promise.all([
        CampusAPI.attendanceSummary(currentUser.id).catch(()=>({percentage:0})),
        CampusAPI.listResults({studentId:currentUser.id}).catch(()=>[]),
        CampusAPI.studentSubmissions(currentUser.id).catch(()=>[]),
      ]);
       document.getElementById('home-stats').innerHTML = `
         <div class="gc blue text-center"><div class="stat-v text-blue">${att.percentage}%</div><div class="text-xs text-t2 uppercase mt-3">Attendance</div></div>
         <div class="gc green text-center"><div class="stat-v text-green">${results.length}</div><div class="text-xs text-t2 uppercase mt-3">Results</div></div>
         <div class="gc gold text-center"><div class="stat-v text-gold">${exams.length}</div><div class="text-xs text-t2 uppercase mt-3">Exams Live</div></div>
         <div class="gc purple text-center"><div class="stat-v text-purple">${subs.length}</div><div class="text-xs text-t2 uppercase mt-3">Completed</div></div>
       `;
    } else {
      document.getElementById('home-stats').innerHTML = `
        <div class="gc blue text-center"><div class="stat-v text-blue">${exams.length}</div><div class="text-xs text-t2 uppercase mt-3">Exams Posted</div></div>
        <div class="gc green text-center"><div class="stat-v text-green">${notices.length}</div><div class="text-xs text-t2 uppercase mt-3">Notices</div></div>
      `;
    }
    // Upcoming calendar events
    const cal = await CampusAPI.listCalendar().catch(()=>[]);
    const upcoming = cal.filter(e => new Date(e.startDate) >= new Date()).slice(0,4);
    document.getElementById('home-upcoming').innerHTML = upcoming.length
      ? upcoming.map(e=>`<div class="py-05 border-b text-sm"><strong>${e.title}</strong><div class="text-072 text-t2">${e.startDate}${e.endDate&&e.endDate!==e.startDate?' – '+e.endDate:''}</div></div>`).join('')
      : '<div class="text-t3 text-sm">No upcoming events.</div>';
   } catch(err){ console.warn(err); console.error(err); }
}

// =====================================================================
// PAPI AI — Claude API (with KsTU system prompt)
// =====================================================================
const PAPI_SYSTEM = `You are Papi, the official AI academic assistant and tutor for Kumasi Technical University (KsTU) in Ghana. You have expert knowledge of all KsTU programmes: Engineering, Applied Sciences (Computer Technology, AI, Data Science), Business School, Creative Arts, Health Sciences, Built Environment, and Entrepreneurship.

Your abilities:
- Explain any academic concept clearly with step-by-step examples
- Create personalised study plans and exam preparation strategies based on the student's actual courses and results
- Help with assignments and problem-solving across all disciplines
- Provide career guidance specific to Ghana's job market (Vodafone, MTN, GRIDCo, Stanbic, Hubtel, etc.)
- Answer questions about KsTU campus life, procedures, and programmes

Be warm, encouraging, concise (under 200 words unless the question needs more), and always relevant to KsTU students in Ghana. Use relatable Ghanaian examples where helpful.`;

let papiHistory = [];

async function askPapi(prefill){
  const input = document.getElementById('ai-input');
  const msg = prefill || input.value.trim();
  if(!msg) return;
  input.value = '';
  const sendBtn = document.getElementById('ai-send-btn');
  sendBtn.disabled = true; sendBtn.textContent = '…';
  addAIMsg(msg, 'user');
  const thinking = addAIMsg('Papi is thinking…', 'ai thinking');
  papiHistory.push({ role:'user', content:msg });
  if(papiHistory.length > 20) papiHistory = papiHistory.slice(-20);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-6',
        max_tokens:1024,
        system:PAPI_SYSTEM,
        messages:papiHistory
      })
    });
    const data = await res.json();
    const reply = data.content?.[0]?.text;
    if(reply){
      thinking.textContent = reply;
      thinking.classList.remove('thinking');
      papiHistory.push({ role:'assistant', content:reply });
    } else {
      thinking.textContent = getPapiOffline(msg);
      thinking.classList.remove('thinking');
    }
  } catch(err){ console.warn(err);
    thinking.textContent = getPapiOffline(msg);
    thinking.classList.remove('thinking');
  }
  sendBtn.disabled = false; sendBtn.textContent = 'SEND';
  document.getElementById('ai-msgs').scrollTop = 9999;
}

function addAIMsg(text, cls){
  const msgs = document.getElementById('ai-msgs');
  const d = document.createElement('div');
  d.classList.add(cls.includes('user')?'ai-msg-user':'ai-msg-ai');
  if(cls.includes('thinking')) d.classList.add('ai-msg-thinking');
  d.textContent = text;
  msgs.appendChild(d); msgs.scrollTop = 9999;
  return d;
}

function getPapiOffline(msg){
  const m = msg.toLowerCase();
  if(m.includes('big o')||m.includes('algorithm')) return "Big O notation describes algorithm efficiency:\n• O(1) — constant (best)\n• O(log n) — logarithmic (binary search)\n• O(n) — linear (looping)\n• O(n²) — quadratic (nested loops)\n\nFor CPT 301, focus on identifying the dominant term. Would you like practice problems?";
  if(m.includes('gpa')) return "To improve your KsTU GPA:\n1. Attend all lectures — CA marks depend on it\n2. Start assignments early\n3. Form study groups\n4. Visit lecturers during office hours\n5. Use Papi AI daily for concept clarification\n\nWhich course are you struggling with?";
  if(m.includes('calculus')||m.includes('integration')) return "Integration basics for MAT 201:\n∫xⁿ dx = xⁿ⁺¹/(n+1) + C\n∫eˣ dx = eˣ + C\n\nKey techniques:\n• Substitution (u-sub)\n• Integration by parts: ∫u dv = uv - ∫v du\n\nAlways verify by differentiating your answer. Which technique do you need help with?";
  if(m.includes('career')||m.includes('job')) return "Top career opportunities for KsTU graduates in Ghana:\n• Tech: Vodafone, MTN, Hubtel, Rancard, Andela\n• Banking: Stanbic, GCB, Ecobank\n• Energy: GRIDCo, ECG, VRA\n• Health: KATH, Ghana Health Service\n\nBuild your GitHub portfolio and get AWS/Google certifications to stand out. Want help with your CV?";
  if(m.includes('machine learning')||m.includes('ai')) return "ML fundamentals for CPT 305:\n• Supervised: linear regression, decision trees, SVM\n• Unsupervised: K-means, PCA\n• Neural Networks: perceptrons → deep learning\n\nIn Python:\n```python\nfrom sklearn.linear_model import LinearRegression\nmodel = LinearRegression()\nmodel.fit(X_train, y_train)\n```\nWhat specific ML topic do you need help with?";
  return "Great question! I can help you with:\n📚 Any KsTU course concept\n📝 Exam preparation and past questions\n💼 Career advice in Ghana\n🗓 Study plans and time management\n\nCould you give me more detail? For example:\n- 'Explain [topic] from CPT 301'\n- 'Help me prepare for [exam]'\n- 'What career paths suit [my programme]'";
}

// =====================================================================
// NOTIFICATIONS
// =====================================================================
async function loadNotifications(){
  if(!currentUser) return;
  try {
    const notifs = await CampusAPI.getNotifications(currentUser.id);
    const unread = notifs.filter(n => !n.read);
    const badge = document.getElementById('notif-badge');
    badge.textContent = unread.length;
    badge.classList.toggle('show', unread.length > 0);
    const list = document.getElementById('notif-list');
    list.innerHTML = notifs.length ? notifs.slice(0,15).map(n=>`
      <div class="np-item ${n.read?'':'unread'}" onclick="markRead('${n.id}',this)">
        <div class="np-item-title">${n.title}</div>
        <div class="np-item-msg">${n.message}</div>
      </div>`).join('') : '<div class="p-1 text-center text-quiet text-sm">No notifications</div>';
  } catch(err){console.warn(err);}
}
async function markRead(id, el){
  await CampusAPI.markRead(id).catch(()=>{});
  el.classList.remove('unread');
  loadNotifications();
}
async function markAllRead(){
  const notifs = await CampusAPI.getNotifications(currentUser.id).catch(()=>[]);
  await Promise.all(notifs.filter(n=>!n.read).map(n=>CampusAPI.markRead(n.id).catch(()=>{})));
  loadNotifications();
}
function toggleNotifPanel(){
  document.getElementById('notif-panel').classList.toggle('open');
}
document.addEventListener('click', e => {
  if(!e.target.closest('#notif-panel') && !e.target.closest('.bell-btn'))
    document.getElementById('notif-panel').classList.remove('open');
});

// =====================================================================
// NOTICE TICKER
// =====================================================================
async function loadNoticeTicker(){
  try {
    const notices = await CampusAPI.listNotices();
    if(!notices.length) return;
    const ticker = document.getElementById('notice-ticker-inner');
    const txt = notices.map(n=>`📢 ${n.title}: ${n.body.slice(0,60)}`).join('   ·   ');
    ticker.textContent = txt + '   ·   ' + txt;
  } catch(err){console.warn(err);}
}

// =====================================================================
// VIRTUAL CLASSROOM
// =====================================================================
async function loadClassroom(){
  const isLec = currentUser.role !== 'student';
  const tools = document.getElementById('lec-classroom-tools');
  tools.style.display = isLec ? 'flex' : 'none';
  document.getElementById('vc-badge').textContent = isLec ? 'Lecturer View' : 'Student View';
  try {
    const [exams, assignments, materials] = await Promise.all([
      CampusAPI.listExams(),
      CampusAPI.listAssignments(),
      CampusAPI.listMaterials(),
    ]);
    let mySubs = [];
    if(!isLec) mySubs = await CampusAPI.studentSubmissions(currentUser.id).catch(()=>[]);
    // EXAMS
    const eg = document.getElementById('exams-grid');
    eg.innerHTML = exams.length
      ? exams.map(ex => {
          const submitted = mySubs.find(s => s.examId === ex.id);
          if(isLec){
            return `<div class="gc mb-75">
              <div class="text-base fw-600">${escAttr(ex.title)}</div>
              <div class="text-072 text-t2 mb-05">${escAttr(ex.courseCode)} · ${ex.durationMinutes}min · ${ex.totalPoints}pts</div>
              ${renderExamAction(ex, submitted, isLec)}
            </div>`;
          }
          if(submitted){
            examResultCache[submitted.id] = submitted;
            return `<div class="gc mb-75">
              <div class="text-base fw-600">${escAttr(ex.title)}</div>
              <div class="text-072 text-t2 mb-05">${escAttr(ex.courseCode)} · ${ex.durationMinutes}min · ${ex.totalPoints}pts</div>
              <span class="badge b-green">✓ ${submitted.percentage}%</span> <button class="btn-sm bs-blue" onclick="showResult('${submitted.id}')">View</button>
            </div>`;
          }
          return `<div class="gc mb-75">
            <div class="text-base fw-600">${escAttr(ex.title)}</div>
            <div class="text-072 text-t2 mb-05">${escAttr(ex.courseCode)} · ${ex.durationMinutes}min · ${ex.totalPoints}pts</div>
            <button class="btn-p btn-sm" onclick="startExam('${ex.id}')">Take Exam</button>
          </div>`;
        }).join('')
      : '<div class="text-quiet text-sm">No exams posted yet.</div>';
    // ASSIGNMENTS
    const al = document.getElementById('assignments-list');
    const assignSubs = isLec ? [] : await CampusAPI.studentSubmissions(currentUser.id).catch(()=>[]);
    al.innerHTML = assignments.length
      ? assignments.map(a => {
          const mySub = assignSubs.find(s => s.assignmentId === a.id);
          if(isLec){
            return `<div class="gc mb-75">
              <div class="text-base fw-600">${escAttr(a.title)}</div>
              <div class="text-072 text-t2 mb-4">${escAttr(a.courseCode)} · Due: ${new Date(a.deadline).toLocaleDateString()}</div>
              <div class="text-080 text-t2 mb-05">${escAttr(a.description || '')}</div>
              ${renderAssignmentAction(a, mySub, isLec)}
            </div>`;
          }
          if(mySub){
            const scoreText = mySub.score != null ? ` · ${mySub.score}/${a.maxScore}` : '';
            const feedbackHtml = mySub.feedback ? `<div class="text-072 text-t2 mt-3">Feedback: ${escAttr(mySub.feedback)}</div>` : '';
            return `<div class="gc mb-75">
              <div class="text-base fw-600">${escAttr(a.title)}</div>
              <div class="text-072 text-t2 mb-4">${escAttr(a.courseCode)} · Due: ${new Date(a.deadline).toLocaleDateString()}</div>
              <div class="text-080 text-t2 mb-05">${escAttr(a.description || '')}</div>
              <span class="badge b-green">✓ Submitted${scoreText}</span>${feedbackHtml}
            </div>`;
          }
          return `<div class="gc mb-75">
            <div class="text-base fw-600">${escAttr(a.title)}</div>
            <div class="text-072 text-t2 mb-4">${escAttr(a.courseCode)} · Due: ${new Date(a.deadline).toLocaleDateString()}</div>
            <div class="text-080 text-t2 mb-05">${escAttr(a.description || '')}</div>
            <button class="btn-p btn-sm" onclick="openSubmitAsgn('${a.id}','${escAttr(a.title)}','${escAttr(a.description || '')}')">Submit</button>
          </div>`;
        }).join('')
      : '<div class="text-quiet text-sm">No assignments posted yet.</div>';
    // MATERIALS
    const ml = document.getElementById('materials-list');
    ml.innerHTML = materials.length
      ? `<div class="gc"><div class="flex flex-col gap-05">${materials.map(m => renderMaterialRow(m, isLec)).join('')}</div></div>`
      : '<div class="text-quiet text-sm">No materials uploaded yet.</div>';
   } catch(err){ console.warn(err); console.error(err); }
}

// EXAM CREATE
function openExamModal(){ qCount=0; document.getElementById('ex-qblocks').innerHTML=''; document.getElementById('ex-title').value=''; document.getElementById('ex-course').value=''; document.getElementById('ex-dur').value='30'; document.getElementById('ex-msg').textContent=''; addQBlock(); document.getElementById('exam-modal').classList.add('open'); }
function addQBlock(){
  qCount++;
  const d = document.createElement('div');
  d.classList.add('qblock');
  d.id = 'qb'+qCount;
  d.innerHTML = `<div class="qblock-label">Question ${qCount}</div>
    <input class="fi2" placeholder="Question text" style="margin-bottom:0.4rem">
    ${[0,1,2,3].map(i=>`<div class="qblock-row"><input type="radio" name="c${qCount}" value="${i}" ${i===0?'checked':''}><input class="fi2 qblock-option-input" placeholder="Option ${String.fromCodePoint(65+i)}"></div>`).join('')}
    <div class="qblock-points"><span class="qblock-points-label">Points:</span><input class="fi2 qblock-points-input" type="number" value="10"></div>`;
  document.getElementById('ex-qblocks').appendChild(d);
}
async function submitExam(){
  const title = document.getElementById('ex-title').value.trim();
  const courseCode = document.getElementById('ex-course').value.trim();
  const dur = document.getElementById('ex-dur').value;
  const msg = document.getElementById('ex-msg');
  const blocks = document.querySelectorAll('[id^="qb"]');
  const questions = [];
  for(const b of blocks){
    const inputs = b.querySelectorAll('input');
    const text = inputs[0].value.trim();
    const opts = [inputs[1].value.trim(),inputs[2].value.trim(),inputs[3].value.trim(),inputs[4].value.trim()];
    const correct = Number(b.querySelector('input[type=radio]:checked')?.value||0);
    const pts = Number(inputs[5]?.value||10);
    if(!text||opts.some(o=>!o)){msg.style.color='#fca5a5';msg.textContent='Fill every question and all 4 options.';return;}
    questions.push({text,options:opts,correctIndex:correct,points:pts});
  }
  if(!title||!courseCode||!questions.length){msg.style.color='#fca5a5';msg.textContent='Title, course, and at least one question required.';return;}
  try {
    await CampusAPI.createExam({title,courseCode,lecturerId:currentUser.id,lecturerName:currentUser.name,durationMinutes:Number(dur),questions});
    closeM('exam-modal'); loadClassroom();
    await CampusAPI.postNotice({userId:'all',title:'New Exam: '+title,message:courseCode+' exam posted by '+currentUser.name,type:'exam'});
   } catch(err){ console.warn(err);msg.style.color='#fca5a5';msg.textContent=err.message;}
}
async function delExam(id){
  const confirmed = confirm('Delete exam?');
  if(!confirmed){ return; }
  await CampusAPI.deleteExam(id).catch(()=>{});
  loadClassroom();
}
async function viewSubs(id, title){
  document.getElementById('subs-title').textContent = 'Submissions — '+title;
  const subs = await CampusAPI.examSubmissions(id);
  const rows = subs.map(s => {
    const linkHtml = s.link ? `<a href="${escAttr(s.link)}" target="_blank" class="u-inline-35">Link</a>` : '—';
    const scoreHtml = s.score != null ? s.score : '—';
    return `<tr><td>${escAttr(s.studentName)}</td><td class="u-inline-105">${escAttr((s.response || '').slice(0,60))}</td><td>${linkHtml}</td><td>${scoreHtml}</td><td><button class="btn-sm bs-blue" onclick="gradeAsgn('${s.id}')">Grade</button></td></tr>`;
  }).join('');
  const tableHtml = `<table><thead><tr><th>Student</th><th>Response</th><th>Link</th><th>Score</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
  document.getElementById('subs-content').innerHTML = subs.length ? tableHtml : '<div class="u-inline-94">No submissions yet.</div>';
  document.getElementById('subs-modal').classList.add('open');
}
async function gradeAsgn(id){
  const score = prompt('Enter score:');
  if(score === null) return;
  try {
    await CampusAPI.gradeSubmission(id, {score: Number(score), feedback: ''});
  } catch(err) { alert(err.message); }
  closeM('subs-modal');
  loadClassroom();
}

// MATERIALS
function openMaterialModal(){ document.getElementById('mat-course').value=''; document.getElementById('mat-title').value=''; document.getElementById('mat-week').value=''; document.getElementById('mat-url').value=''; document.getElementById('mat-msg').textContent=''; document.getElementById('material-modal').classList.add('open'); }
async function submitMaterial(){
  const course=document.getElementById('mat-course').value.trim(), title=document.getElementById('mat-title').value.trim(), type=document.getElementById('mat-type').value, week=document.getElementById('mat-week').value.trim(), url=document.getElementById('mat-url').value.trim(), msg=document.getElementById('mat-msg');
  if(!course||!title||!url){msg.style.color='#fca5a5';msg.textContent='Course, title, and URL required.';return;}
   try { await CampusAPI.postMaterial({courseCode:course,title,type,week,url,lecturerId:currentUser.id}); closeM('material-modal'); loadClassroom(); } catch(err){ console.warn(err);msg.style.color='#fca5a5';msg.textContent=err.message;}
}
async function delMaterial(id){
  if(!confirm('Remove material?')) {
    return;
  }
  await CampusAPI.deleteMaterial(id).catch(()=>{});
  loadClassroom();
}

// =====================================================================
// ATTENDANCE
// =====================================================================
async function loadAttendanceScreen(){
  const isLec = currentUser.role !== 'student';
  document.getElementById('att-student-view').style.display = isLec ? 'none' : 'block';
  document.getElementById('att-lecturer-view').style.display = isLec ? 'block' : 'none';
  if(!isLec){
    try {
      const [summary, rows] = await Promise.all([CampusAPI.attendanceSummary(currentUser.id), CampusAPI.listAttendance({studentId:currentUser.id})]);
      document.getElementById('att-stats').innerHTML = `
        <div class="gc blue text-center"><div class="att-stat-value text-blue">${summary.percentage}%</div><div class="att-stat-label">Attendance %</div></div>
        <div class="gc green text-center"><div class="att-stat-value text-green">${summary.present}</div><div class="att-stat-label">Present</div></div>
        <div class="gc gold text-center"><div class="att-stat-value text-gold">${summary.late}</div><div class="att-stat-label">Late</div></div>
        <div class="gc red text-center"><div class="att-stat-value text-red">${summary.absent}</div><div class="att-stat-label">Absent</div></div>`;
      document.getElementById('att-history').innerHTML = rows.length ? rows.slice(0,30).map(r=>`<tr><td>${r.date}</td><td>${r.courseCode}</td><td><span class="badge ${attendanceBadgeClass(r.status)}">${r.status}</span></td></tr>`).join('') : '<tr><td colspan="3" class="table-empty-center">No attendance records yet.</td></tr>';
    } catch(err){console.warn(err);}
  } else {
    document.getElementById('att-date').value = new Date().toISOString().slice(0,10);
  }
}
function buildAttForm(){
  const names = document.getElementById('att-students').value.split(',').map(s=>s.trim()).filter(Boolean);
  const c = document.getElementById('att-form-rows');
  if(!names.length){ c.innerHTML=''; document.getElementById('att-submit-btn').style.display='none'; return; }
  c.innerHTML = '<div class="text-072 text-t2 mb-4">Mark each student:</div>' + names.map((n,i)=>`<div class="list-item-flex-between"><span class="text-sm">${n}</span><select id="ats${i}" class="fi2" style="padding:0.25rem 0.4rem;font-size:0.75rem;width:auto"><option value="present">Present</option><option value="late">Late</option><option value="absent">Absent</option></select></div>`).join('');
  document.getElementById('att-submit-btn').style.display='block';
  document.getElementById('att-submit-btn').dataset.names = JSON.stringify(names);
}
async function submitAttendance(){
  const course=document.getElementById('att-course').value.trim(), date=document.getElementById('att-date').value, names=JSON.parse(document.getElementById('att-submit-btn').dataset.names||'[]'), msg=document.getElementById('att-msg');
  if(!course||!date||!names.length){msg.style.color='#fca5a5';msg.textContent='Course, date, and students required.';return;}
  const records = names.map((n,i)=>({studentId:n.toLowerCase().replace(/\s+/g,'-'),studentName:n,status:document.getElementById('ats'+i).value}));
   try { await CampusAPI.submitAttendanceSession({courseCode:course,date,lecturerId:currentUser.id,records}); msg.style.color='#34d399'; msg.textContent='✅ Attendance saved for '+records.length+' students.'; } catch(err){ console.warn(err);msg.style.color='#fca5a5';msg.textContent=err.message;}
}
function generateAttQR(){
  const course = document.getElementById('att-course').value.trim() || 'COURSE';
  const date = document.getElementById('att-date').value || new Date().toISOString().slice(0,10);
  const code = 'ATT-'+course.replace(/\s+/g,'')+'-'+date;
  document.getElementById('att-qr-box').style.display='block';
  document.getElementById('att-qr-content').innerHTML = `<div style="font-family:monospace;font-size:0.55rem;word-break:break-all">${code}</div><div style="font-size:0.6rem;color:#666;margin-top:4px">Scan to mark attendance</div>`;
  document.getElementById('att-qr-code').textContent = 'Code: '+code+' · Expires in 15 min';
}

// =====================================================================
// RESULTS & GPA
// =====================================================================
const GRADE_POINTS = { A:4.0, B:3.0, C:2.0, D:1.0, F:0.0 };
async function loadResults(){
  const isLec = currentUser.role !== 'student';
  document.getElementById('results-student-view').style.display = isLec ? 'none' : 'block';
  document.getElementById('results-lec-view').style.display = isLec ? 'block' : 'none';
  try {
    if(!isLec){
      const results = await CampusAPI.listResults({studentId:currentUser.id});
      if(results.length){
        const totalPts = results.reduce((s,r)=>s+((GRADE_POINTS[r.grade]||0)*3),0);
        const totalCr = results.length*3;
        const gpa = totalCr ? (totalPts/totalCr).toFixed(2) : '0.00';
        const projected = Math.min(4.0, (Number.parseFloat(gpa)+0.15)).toFixed(2);
        document.getElementById('gpa-value').textContent = gpa;
        document.getElementById('cgpa-val').textContent = gpa;
        document.getElementById('pgpa-val').textContent = projected;
        document.getElementById('credits-val').textContent = totalCr;
        const pct = Number.parseFloat(gpa)/4.0;
        document.getElementById('gpa-ring-circle').style.strokeDashoffset = 289*(1-pct);
        const grades = {};
        results.forEach(r=>{ grades[r.grade]=(grades[r.grade]||0)+1; });
        const gradeOrder = { A: 0, B: 1, C: 2, D: 3, F: 4 };
        document.getElementById('grade-breakdown').innerHTML = Object.entries(grades).sort(([a],[b]) => (gradeOrder[a] ?? 99) - (gradeOrder[b] ?? 99)).map(([g,c])=>{
          const badgeClass = getGradeBadgeClassByLetter(g);
          const markerColor = getGradeMarkerColor(g);
          return `<div class="grade-row"><span class="badge ${badgeClass}">${g}</span><div class="grade-bar-wrap"><div class="prog-bar"><div class="prog-fill" style="width:${(c/results.length)*100}%;background:${markerColor}"></div></div></div><span class="grade-count">${c}</span></div>`;
        }).join('');
      }
      const resultRows = results.map(r => `<tr><td>${r.courseCode}</td><td>${r.caScore}</td><td>${r.examScore}</td><td>${r.total}</td><td><span class="badge ${getGradeBadgeClassByLetter(r.grade)}">${r.grade}</span></td></tr>`).join('');
      document.getElementById('results-tbody').innerHTML = results.length ? resultRows : '<tr><td colspan="5" class="u-inline-116">No results recorded yet.</td></tr>';
    } else {
      const results = await CampusAPI.listResults();
      const lecResultRows = results.map(r => {
return `<tr><td>${r.studentName||r.studentId}</td><td>${r.courseCode}</td><td>${r.caScore}</td><td>${r.examScore}</td><td>${r.total}</td><td><span class="badge ${getGradeBadgeClassByLetter(r.grade)}">${r.grade}</span></td></tr>`;
}).join("");
document.getElementById("results-lec-tbody").innerHTML = results.length ? lecResultRows : '<tr><td colspan="6" class="u-inline-116">No results yet.</td></tr>';
    }
   } catch(err){ console.warn(err); console.error(err); }
}

// =====================================================================
// TIMETABLE
// =====================================================================
async function loadTimetable(){
  const tbody = document.getElementById('tt-tbody');
  try {
    const rows = await CampusAPI.listTimetable();
    tbody.innerHTML = rows.length ? rows.map(t=>`<tr><td>${t.day}</td><td>${t.time}</td><td>${t.courseCode}</td><td>${t.room}</td><td>${t.lecturer||'—'}</td></tr>`).join('') : '<tr><td colspan="5" class="table-empty-center">No timetable entries yet.</td></tr>';
  } catch(err){ console.warn(err); tbody.innerHTML='<tr><td colspan="5" class="table-empty-center text-red">Error loading timetable</td></tr>'; }
}

// =====================================================================
// COURSE REGISTRATION
// =====================================================================
const AVAIL_COURSES = [
  {code:'CPT 301',name:'Data Structures & Algorithms',lecturer:'Dr. Mensah K.',credits:3},
  {code:'CPT 305',name:'AI & Machine Learning',lecturer:'Dr. Boateng A.',credits:3},
  {code:'MAT 201',name:'Calculus II',lecturer:'Mr. Asante C.',credits:3},
  {code:'DSC 201',name:'Statistics for Data Science',lecturer:'Dr. Osei-Bonsu',credits:3},
  {code:'CPT 201',name:'Object-Oriented Programming',lecturer:'Dr. Boateng A.',credits:3},
  {code:'EEE 301',name:'Power Systems Engineering',lecturer:'Dr. Asante B.',credits:3},
  {code:'FIN 201',name:'Commercial Banking & Finance',lecturer:'Dr. Sarfo E.',credits:3},
  {code:'MKT 301',name:'Digital Marketing',lecturer:'Dr. Amankwah P.',credits:3},
];
async function loadRegistration(){
  try {
    const myRegs = await CampusAPI.getRegistrations({studentId:currentUser.id,semester:'2025/2026 Sem 2'});
    const myCodes = new Set(myRegs.map(r=>r.courseCode));
    document.getElementById('avail-courses-list').innerHTML = AVAIL_COURSES.map(c=>`<div class="reg-item">
      <div><strong class="reg-item-title">${c.code}</strong> <span class="reg-item-sub">${c.name}</span><div class="text-070 text-t3">${c.lecturer} · ${c.credits} credits</div></div>
      ${myCodes.has(c.code) ? '<span class="badge b-green">✓ Registered</span>' : `<button class="btn-sm bs-blue" onclick="registerCourse('${c.code}','${c.name}')">Register</button>`}
    </div>`).join('');
    document.getElementById('my-reg-list').innerHTML = myRegs.length ? myRegs.map(r=>`<div class="reg-item"><div><strong class="reg-item-title">${r.courseCode}</strong><div class="reg-item-sub">${r.courseName}</div></div><button class="btn-sm bs-red" onclick="unregisterCourse('${r.id}')">Drop</button></div>`).join('') : '<div class="text-quiet text-sm">No courses registered yet.</div>';
   } catch(err){ console.warn(err); console.error(err); }
}
async function registerCourse(code, name){
  try { await CampusAPI.registerCourse({studentId:currentUser.id,studentName:currentUser.name,courseCode:code,courseName:name,semester:'2025/2026 Sem 2'}); loadRegistration();    } catch(err){ console.warn(err); alert(err.message); }
}
async function unregisterCourse(id){
  if(!confirm('Drop this course?')) return;
  await CampusAPI.unregisterCourse(id).catch(()=>{}); loadRegistration();
}

// =====================================================================
// FEES & PAYMENTS
// =====================================================================
async function loadFees(){
  try {
    const [feeStructures, payments] = await Promise.all([CampusAPI.listFeeStructures(), CampusAPI.getPayments(currentUser.id)]);
    const myFee = feeStructures.find(f => f.programme === currentUser.programme && f.level === currentUser.level) || feeStructures[0];
    const totalPaid = payments.filter(p=>p.status==='confirmed').reduce((s,p)=>s+p.amount,0);
    const pending = payments.filter(p=>p.status==='pending_confirmation').reduce((s,p)=>s+p.amount,0);
    const owed = myFee ? myFee.total - totalPaid : 0;
    const balanceColor = getBalanceColor(owed);
    document.getElementById('fee-summary').innerHTML = myFee ? `
      <div class="sh"><h2>My Fee Statement</h2><div class="sh-line"></div><span class="badge b-gold">${currentUser.level||'—'}</span></div>
      <div class="grid4 gap-05">
        <div class="text-center"><div class="stat-card-value text-blue">GHS ${myFee.total}</div><div class="stat-card-label">Total Due</div></div>
        <div class="text-center"><div class="stat-card-value text-green">GHS ${totalPaid}</div><div class="stat-card-label">Paid</div></div>
        <div class="text-center"><div class="stat-card-value text-gold">GHS ${pending}</div><div class="stat-card-label">Pending</div></div>
        <div class="text-center"><div class="stat-card-value" style="color:${balanceColor}">GHS ${Math.max(0,owed)}</div><div class="stat-card-label">Balance</div></div>
      </div>` : '<div class="text-quiet text-sm">No fee structure found for your programme. Contact admin.</div>';
    document.getElementById('payment-history').innerHTML = payments.length ? payments.map(p=>`<div class="reg-item"><div><strong class="reg-item-title">GHS ${p.amount}</strong> <span class="reg-item-sub">${p.method}</span><div class="text-070 text-t3">${p.reference||''} · ${new Date(p.createdAt).toLocaleDateString()}</div></div><span class="badge ${statusBadgeClass(p.status)}">${p.status==='pending_confirmation'?'Pending Confirmation':p.status}</span></div>`).join('') : '<div class="text-quiet text-sm">No payments recorded yet.</div>';
   } catch(err){ console.warn(err); console.error(err); }
}
async function submitPaymentReceipt(){
  const amount=document.getElementById('pay-amount').value, method=document.getElementById('pay-method').value, ref=document.getElementById('pay-ref').value.trim(), note=document.getElementById('pay-note').value.trim(), msg=document.getElementById('pay-msg');
  if(!amount){msg.style.color='#fca5a5';msg.textContent='Please enter the amount paid.';return;}
   try { await CampusAPI.submitReceipt(currentUser.id,{amount:Number(amount),method,reference:ref,receiptNote:note}); msg.style.color='#34d399'; msg.textContent='✅ Receipt submitted! Admin will confirm your payment within 24 hours.'; loadFees(); } catch(err){ console.warn(err);msg.style.color='#fca5a5';msg.textContent=err.message;}
}

// =====================================================================
// HOSTELS
// =====================================================================
async function loadHostels(){
  try {
    const [hostels, myApps] = await Promise.all([CampusAPI.listHostels(), CampusAPI.listHostelApplications({studentId:currentUser.id})]);
    const myApp = myApps[0];
    const statusEl = document.getElementById('hostel-app-status');
    if(myApp){
      const statusClass = getHostelStatusClass(myApp.status);
      statusEl.innerHTML = `<div class="gc ${statusClass}">
        <strong>Your Hostel Application:</strong> ${myApp.hostelName} — <span class="badge ${statusBadgeClass(myApp.status)}">${myApp.status}</span>
         ${myApp.roomNumber?`<div class="mt-3 text-base">Room: <strong class="text-green">${myApp.roomNumber}</strong></div>`:''}
      </div>`;
    } else { statusEl.innerHTML = ''; }
    document.getElementById('hostels-grid').innerHTML = hostels.map(h=>{
      const actionHtml = getHostelActionHtml(h, myApp);
      return `<div class="gc">
        <div class="sh"><h2 class="hostel-item-title">${h.name}</h2><div class="sh-line"></div><span class="badge ${h.occupied>=h.capacity?'b-red':'b-green'}">${h.occupied>=h.capacity?'Full':'Available'}</span></div>
        <div class="text-080 text-t2 mb-4">${h.type} · ${h.occupied}/${h.capacity} occupied</div>
        <div class="text-base text-green fw-600 mb-75">GHS ${h.feePerSemester}/semester</div>
        ${actionHtml}
      </div>`;
    }).join('');
   } catch(err){ console.warn(err); console.error(err); }
}
async function applyHostel(hostelId, hostelName){
  try { await CampusAPI.applyHostel({studentId:currentUser.id,studentName:currentUser.name,hostelId,hostelName,programme:currentUser.programme||'',level:currentUser.level||''}); loadHostels();    } catch(err){ console.warn(err); alert(err.message); }
}

// =====================================================================
// CAMPUS LOCATOR — Google Maps
// =====================================================================
let sharingLocation = false;

async function loadLocator(){
  await loadLiveLocations();
  loadBusyAreas();
  if(!mapInitialized) initMap();
}

function initMap(){
  mapInitialized = true;
  const mapContainer = document.getElementById('map-container');
  if(typeof google === 'undefined'){
    mapContainer.innerHTML = `<div class="map-fallback">
      <div class="map-fallback-icon">🗺</div>
      <div class="map-fallback-title">Google Maps requires an API key</div>
      <div class="map-fallback-desc">To enable the live campus map with Google Maps, add your Google Maps API key to the &lt;head&gt; of this file:<br><code style="background:rgba(255,255,255,0.1);padding:0.2rem 0.4rem;border-radius:4px;font-size:0.72rem">&lt;script src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY"&gt;&lt;/script&gt;</code></div>
      <div class="map-fallback-coords">KsTU coordinates: 6.6885°N, 1.6244°W</div>
      <div id="map-fallback-students" class="map-fallback-students"></div>
    </div>`;
    renderMapFallback();
    return;
  }
  googleMap = new google.maps.Map(mapContainer, {
    center:{lat:6.6885,lng:-1.6244},
    zoom:17,
    mapTypeId:'roadmap',
    styles:[{elementType:'geometry',stylers:[{color:'#1d2c4d'}]},{featureType:'water',elementType:'geometry',stylers:[{color:'#0e1626'}]},{elementType:'labels.text.fill',stylers:[{color:'#8ec3b9'}]}]
  });
  updateMapMarkers();
}

async function renderMapFallback(){
  const el = document.getElementById('map-fallback-students');
  if(!el) return;
  const locs = await CampusAPI.getLiveLocations().catch(()=>[]);
   el.innerHTML = locs.length ? '<div class="map-location-name" style="font-size:0.8rem;font-weight:600;margin-bottom:0.5rem">Students currently on campus:</div>' + locs.map(l=>`<div class="map-location-item"><div class="map-location-dot" style="background:#10b981"></div>${l.userName} — ${l.building||'On campus'}</div>`).join('') : '<div class="text-quiet text-sm">No other students sharing location right now.</div>';
}

async function updateMapMarkers(){
  if(!googleMap) return;
  const locs = await CampusAPI.getLiveLocations().catch(()=>[]);
  // Clear old markers
  Object.values(mapMarkers).forEach(m => m.setMap(null));
  mapMarkers = {};
  locs.forEach(l => {
    if(l.lat && l.lng){
      const marker = new google.maps.Marker({
        position:{lat:l.lat,lng:l.lng},
        map:googleMap,
        title:l.userName + ' (' + (l.building||'On campus') + ')',
        icon:{path:google.maps.SymbolPath.CIRCLE,scale:8,fillColor:l.userId===currentUser?.id?'#3b82f6':'#10b981',fillOpacity:1,strokeWeight:2,strokeColor:'#ffffff'}
      });
      mapMarkers[l.userId] = marker;
    }
  });
}

async function loadLiveLocations(){
  try {
    const locs = await CampusAPI.getLiveLocations();
    document.getElementById('loc-live-badge').textContent = locs.length + ' online';
    document.getElementById('loc-online-list').innerHTML = locs.length
      ? locs.map(l=>`<div class="map-location-item"><div class="map-location-dot" style="background:${l.userId===currentUser?.id?'#3b82f6':'#10b981'}"></div><div><strong>${l.userName}</strong> <span class="map-location-meta">${l.role}</span><div class="map-location-building">${l.building||'On campus'}</div></div><span class="map-location-live">● Live</span></div>`).join('')
      : '<div class="text-quiet text-sm">No one sharing right now.</div>';
  } catch(err){console.warn(err);}
}

function loadBusyAreas(){
  const areas = [
    {name:'Applied Sciences Block',count:12,color:'#ef4444'},
    {name:'Library',count:22,color:'#f59e0b'},
    {name:'Cafeteria',count:34,color:'#ef4444'},
    {name:'Engineering Block',count:9,color:'#3b82f6'},
    {name:'Business School',count:12,color:'#f59e0b'},
    {name:'Sports Field',count:18,color:'#10b981'},
  ];
  document.getElementById('loc-busy-areas').innerHTML = areas.map(a=>`<div class="map-busy-row"><span>${a.name}</span><span class="map-busy-count" style="color:${a.color}">${a.count} students</span></div>`).join('');
}

async function toggleLocationSharing(){
  const btn = document.getElementById('loc-toggle-btn');
  const status = document.getElementById('loc-share-status');
  if(sharingLocation){
    sharingLocation = false;
    clearInterval(locationInterval); locationInterval = null;
    await CampusAPI.stopSharing(currentUser.id).catch(()=>{});
    btn.textContent = 'Enable Sharing'; btn.className = 'btn-g';
    status.textContent = 'Currently not sharing';
    if(mapMarkers[currentUser.id]){ mapMarkers[currentUser.id].setMap(null); delete mapMarkers[currentUser.id]; }
    loadLiveLocations();
    return;
  }
  if(!navigator.geolocation){ alert('Geolocation is not supported by your browser.'); return; }
  navigator.geolocation.getCurrentPosition(async pos => {
    sharingLocation = true;
    btn.textContent = 'Stop Sharing'; btn.className = 'btn-r';
    status.textContent = '● Sharing live';
    sendLocationSnapshot();
    locationInterval = setInterval(sendLocationSnapshot, 15000);
  }, () => { alert('Location access denied. Please allow location access in your browser settings.'); });
}

function getBuildingName(lat, lng){
  // Rough KsTU building coordinates — returns building name based on proximity
  const buildings = [
    {name:'Applied Sciences Block',lat:6.6886,lng:-1.6243},
    {name:'Engineering Block',lat:6.6889,lng:-1.6245},
    {name:'Business School',lat:6.6882,lng:-1.6248},
    {name:'Library',lat:6.6884,lng:-1.6240},
    {name:'Main Block / Admin',lat:6.6880,lng:-1.6246},
    {name:'Cafeteria',lat:6.6883,lng:-1.6242},
    {name:'Hostel Block',lat:6.6891,lng:-1.6239},
    {name:'Sports Field',lat:6.6893,lng:-1.6241},
  ];
  let closest = null, minDist = Infinity;
  buildings.forEach(b => {
    const d = Math.hypot(lat-b.lat, lng-b.lng);
    if(d < minDist){ minDist=d; closest=b.name; }
  });
  return minDist < 0.002 ? closest : 'On campus';
}

// =====================================================================
// STUDENT ID CARD
// =====================================================================
function renderIDCard(){
  if(!currentUser) return;
  const initials = currentUser.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const avatarEl = document.getElementById('id-avatar');
  if(currentUser.passportDataUrl){
    avatarEl.innerHTML = `<img src="${escAttr(currentUser.passportDataUrl)}" alt="Passport">`;
  } else {
    avatarEl.textContent = initials;
  }
  document.getElementById('id-name').textContent = currentUser.name;
  document.getElementById('id-programme').textContent = currentUser.programme || currentUser.role;
  document.getElementById('id-studentid').textContent = currentUser.studentId || '—';
  document.getElementById('id-level').textContent = currentUser.level || '—';
  const removeBtn = document.getElementById('passport-remove-btn');
  if(removeBtn) removeBtn.style.display = currentUser.passportDataUrl ? 'inline-flex' : 'none';
  // Simple QR-like representation (text-based, no external lib needed)
  const profileUrl = `${location.origin}${location.pathname}?student=${currentUser.studentId || currentUser.id}`;
  document.getElementById('id-qr').innerHTML = `<div class="id-qr-text-static">${profileUrl}</div>`;
}
function printIDCard(){
  const card = document.getElementById('id-card-display').outerHTML;
  const w = window.open('', '_blank');
  if(!w) return;
  const html = `<!DOCTYPE html><html><head><title>Student ID — ${currentUser?.name}</title><style>body{margin:2rem;background:#fff;font-family:Georgia,sans-serif;display:flex;justify-content:center}.id-card{background:linear-gradient(135deg,#1e3a5f,#0d1b2e);border:2px solid #3b82f6;border-radius:16px;padding:1.5rem;max-width:320px;color:#fff;text-align:center}</style></head><body>${card}</body></html>`;
  w.document.documentElement.innerHTML = html;
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 200);
}

// =====================================================================
// COURSE CHAT
// =====================================================================
async function loadChat(){
  const sel = document.getElementById('chat-course-select');
  currentChatCourse = sel.value;
  if(!currentChatCourse){ document.getElementById('chat-box').style.display='none'; return; }
  document.getElementById('chat-box').style.display='block';
  document.getElementById('chat-course-label').textContent = currentChatCourse + ' — Course Chat';
  await renderChatMessages();
  clearInterval(chatInterval);
  chatInterval = setInterval(renderChatMessages, 5000);
}
async function renderChatMessages(){
  if(!currentChatCourse) return;
  try {
    const msgs = await CampusAPI.getChatMessages(currentChatCourse.replace(' ',''));
    const container = document.getElementById('chat-msgs');
    container.innerHTML = msgs.length ? msgs.map(m=>{
      const isMe = m.userId === currentUser.id;
      return `<div class="chat-msg ${isMe?'me':'other'}"><div class="sender">${isMe?'You':m.userName} · ${m.role}</div>${m.message}</div>`;
    }).join('') : '<div class="text-center text-quiet p-1 text-sm">No messages yet. Start the conversation!</div>';
    container.scrollTop = 9999;
  } catch(err){console.warn(err);}
}
async function sendChat(){
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if(!message || !currentChatCourse) return;
  input.value = '';
  await CampusAPI.sendChatMessage(currentChatCourse.replace(' ',''), {userId:currentUser.id,userName:currentUser.name,role:currentUser.role,message}).catch(()=>{});
  await renderChatMessages();
}

// =====================================================================
// CALENDAR
// =====================================================================
async function loadCalendar(){
  try {
    const events = await CampusAPI.listCalendar();
    const typeColors = {semester:'b-blue',exam:'b-red',holiday:'b-green',event:'b-gold'};
    document.getElementById('calendar-list').innerHTML = events.length
      ? events.map(e=>`<div class="gc calendar-event-item">
          <div class="calendar-date-chip"><div class="calendar-date-value">${e.startDate}</div>${e.endDate&&e.endDate!==e.startDate?`<div class="calendar-date-range">→ ${e.endDate}</div>`:''}</div>
          <div class="calendar-event-body"><strong class="calendar-event-title">${e.title}</strong><div class="calendar-event-meta"><span class="badge ${typeColors[e.type]||'b-blue'}">${e.type}</span></div></div>
        </div>`).join('')
      : '<div class="calendar-empty">No calendar events yet. Admin will publish the academic calendar here.</div>';
   } catch(err){ console.warn(err); console.error(err); }
}

// =====================================================================
// EXAM TAKING — implementations for handlers referenced by the UI
// =====================================================================
function escAttr(s){
  return String(s==null?'':s)
    .replaceAll('&','&amp;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;')
    .replaceAll('\u003C','&lt;')
    .replaceAll('\u003E','&gt;');
}
function escHtml(s){
  return String(s==null?'':s)
    .replaceAll('&','&amp;')
    .replaceAll('\u003C','&lt;')
    .replaceAll('\u003E','&gt;');
}
async function startExam(id){
  try{
    const ex = await CampusAPI.getExam(id);
    activeExam = ex; activeExamId = id;
    document.getElementById('te-title').textContent = ex.title;
    document.getElementById('te-questions').innerHTML = ex.questions.map((q,i)=>`
      <div class="gc mb-75">
        <div class="text-base fw-600 mb-4">${i+1}. ${escAttr(q.text)}</div>
        ${q.options.map((o,j)=>`<label class="exam-option-label"><input type="radio" name="eq${i}" value="${j}"> ${escAttr(o)}</label>`).join('')}
      </div>`).join('');
    document.getElementById('te-msg').textContent='';
    document.getElementById('take-modal').classList.add('open');
    if(examTimer) clearInterval(examTimer);
    examSeconds = Number(ex.durationMinutes||30)*60;
    updateExamTimer();
    examTimer = setInterval(updateExamTimer, 1000);
    document.getElementById('exam-timer-bar').style.display='block';
    document.getElementById('exam-timer-course').textContent = ex.courseCode;
  }catch(err){ console.warn(err); alert('Could not load exam: '+err.message); }
}
function updateExamTimer(){
  const m = Math.floor(examSeconds/60), s = examSeconds%60;
  const txt = document.getElementById('exam-timer-txt');
  if(txt) txt.textContent = m + ':' + String(s).padStart(2,'0');
  examSeconds--;
  if(examSeconds < 0){ clearInterval(examTimer); examTimer=null; submitExamAnswers(); }
}
function cancelExam(){
  if(examTimer){ clearInterval(examTimer); examTimer=null; }
  document.getElementById('exam-timer-bar').style.display='none';
  document.getElementById('take-modal').classList.remove('open');
}
async function submitExamAnswers(){
  if(!activeExamId) return;
  const answers = activeExam.questions.map((q,i)=>{
    const sel = document.querySelector(`input[name="eq${i}"]:checked`);
    return sel ? Number(sel.value) : -1;
  });
  const msg = document.getElementById('te-msg');
  if(answers.includes(-1)){ msg.style.color='#fca5a5'; msg.textContent='Please answer all questions before submitting.'; return; }
  try{
    const sub = await CampusAPI.submitExam(activeExamId, {studentId:currentUser.id,studentName:currentUser.name,answers});
    if(examTimer){ clearInterval(examTimer); examTimer=null; }
    document.getElementById('exam-timer-bar').style.display='none';
    closeM('take-modal');
    examResultCache[sub.id] = sub;
    showResult(sub.id);
  }catch(err){ console.warn(err); msg.style.color='#fca5a5'; msg.textContent=err.message; }
}
function showResult(id){
  const sub = examResultCache[id];
  if(!sub) return;
  const pct = sub?.percentage ?? 0;
  const toneClass = getResultToneClass(pct);
  const badgeClass = getResultBadgeClass(pct);
  const resultLabel = getResultLabel(pct);
  document.getElementById('er-content').innerHTML = `
    <div class="text-center mb-1">
      <div class="result-score ${toneClass}">${pct}%</div>
      <div class="badge ${badgeClass}">${resultLabel}</div>
    </div>
    <div class="text-base">Score: <strong>${sub?.score ?? '—'}</strong> / ${sub?.totalPoints ?? '—'} points</div>
    <div class="text-072 text-t2 mt-3">${escAttr(sub?.examTitle ?? 'Exam')} — submitted ${sub?.submittedAt ? new Date(sub.submittedAt).toLocaleString() : ''}</div>`;
  document.getElementById('exam-result-modal').classList.add('open');
}

// =====================================================================
// ASSIGNMENTS — implementations for handlers referenced by the UI
// =====================================================================
function openAssignmentModal(){
  document.getElementById('asgn-title').value='';
  document.getElementById('asgn-course').value='';
  document.getElementById('asgn-desc').value='';
  document.getElementById('asgn-deadline').value='';
  document.getElementById('asgn-score').value='100';
  document.getElementById('asgn-msg').textContent='';
  document.getElementById('assign-modal').classList.add('open');
}
async function submitAssignment(){
  const title=document.getElementById('asgn-title').value.trim();
  const courseCode=document.getElementById('asgn-course').value.trim();
  const desc=document.getElementById('asgn-desc').value.trim();
  const deadline=document.getElementById('asgn-deadline').value;
  const maxScore=document.getElementById('asgn-score').value;
  const msg=document.getElementById('asgn-msg');
  if(!title||!courseCode||!deadline){msg.style.color='#fca5a5';msg.textContent='Title, course, and deadline are required.';return;}
  try{
    await CampusAPI.createAssignment({title,courseCode,lecturerId:currentUser.id,lecturerName:currentUser.name,description:desc,deadline,maxScore:Number(maxScore||100)});
    closeM('assign-modal'); loadClassroom();
  }catch(err){ console.warn(err); msg.style.color='#fca5a5'; msg.textContent=err.message; }
}
function openSubmitAsgn(id, title, desc){
  activeSubmitAsgnId = id;
  document.getElementById('sa-title').textContent = 'Submit: ' + title;
  document.getElementById('sa-desc').innerHTML = desc ? escAttr(desc) : '<em>No description provided.</em>';
  document.getElementById('sa-response').value='';
  document.getElementById('sa-link').value='';
  document.getElementById('sa-msg').textContent='';
  document.getElementById('submit-asgn-modal').classList.add('open');
}
async function doSubmitAssignment(){
  const response=document.getElementById('sa-response').value.trim();
  const link=document.getElementById('sa-link').value.trim();
  const msg=document.getElementById('sa-msg');
  if(!response){msg.style.color='#fca5a5';msg.textContent='Please enter your response.';return;}
  try{
    await CampusAPI.submitAssignment(activeSubmitAsgnId, {studentId:currentUser.id,studentName:currentUser.name,response,link});
    closeM('submit-asgn-modal'); loadClassroom();
  }catch(err){ console.warn(err); msg.style.color='#fca5a5'; msg.textContent=err.message; }
}
async function viewAsgnSubs(id, title){
  document.getElementById('subs-title').textContent = 'Submissions — ' + title;
  try{
    const subs = await CampusAPI.getAssignmentSubmissions(id);
    const rows = subs.map(s => {
      const linkHtml = s.link ? `<a href="${escAttr(s.link)}" target="_blank" class="btn-sm bs-blue">Link</a>` : '—';
      const scoreHtml = s.score!=null ? s.score : '—';
      return `<tr><td>${escAttr(s.studentName)}</td><td class="submission-response">${escAttr((s.response||'').slice(0,60))}</td><td>${linkHtml}</td><td>${scoreHtml}</td><td><button class="btn-sm bs-blue" onclick="gradeAsgn('${s.id}')">Grade</button></td></tr>`;
    }).join('');
    document.getElementById('subs-content').innerHTML = subs.length
      ? `<table><thead><tr><th>Student</th><th>Response</th><th>Link</th><th>Score</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="u-inline-94">No submissions yet.</div>';
    document.getElementById('subs-modal').classList.add('open');
  }catch(err){ console.warn(err); document.getElementById('subs-content').textContent='Error loading submissions.'; }
}

// Init
function fileToDataUrl(file, maxWidth=400){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if(w > maxWidth){ h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function uploadPassport(event){
  const file = event.target.files && event.target.files[0];
  if(!file) return;
  const msg = document.getElementById('passport-msg');
  if(msg){ msg.style.color='#93c5fd'; msg.textContent='Uploading photo...'; }
  try{
    const dataUrl = await fileToDataUrl(file);
    const updated = await CampusAPI.updateUser(currentUser.id, { passportDataUrl: dataUrl });
    currentUser.passportDataUrl = updated.passportDataUrl || dataUrl;
    renderIDCard();
    const navText = document.getElementById('nav-av-text');
    const navImg = document.getElementById('nav-av-img');
    navImg.src = currentUser.passportDataUrl;
    navImg.style.display = 'block';
    if(navText) navText.style.display = 'none';
    if(msg){ msg.style.color='#047857'; msg.textContent='Photo updated!'; }
  }catch(err){
    console.warn(err);
    if(msg){ msg.style.color='#fca5a5'; msg.textContent='Upload failed: ' + err.message; }
  }
}
async function removePassport(){
  if(!confirm('Remove your passport photo?')) return;
  try{
    const updated = await CampusAPI.updateUser(currentUser.id, { passportDataUrl: null });
    currentUser.passportDataUrl = null;
    renderIDCard();
    const navText = document.getElementById('nav-av-text');
    const navImg = document.getElementById('nav-av-img');
    navImg.style.display = 'none';
    if(navText){ navText.style.display = 'flex'; navText.textContent = currentUser.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
    const removeBtn = document.getElementById('passport-remove-btn');
    if(removeBtn) removeBtn.style.display = 'none';
    const msg = document.getElementById('passport-msg');
    if(msg){ msg.style.color='#047857'; msg.textContent='Photo removed.'; }
  }catch(err){
    console.warn(err);
    const msg = document.getElementById('passport-msg');
    if(msg){ msg.style.color='#fca5a5'; msg.textContent='Failed to remove photo.'; }
  }
}
(async function init(){
  const params = new URLSearchParams(location.search);
  const studentId = params.get('student');
  if(studentId){
    if(currentUser){
      showScreen('idcard');
      return;
    }
    try{
      const user = await CampusAPI.getUserByStudentId(studentId);
      if(!user) throw new Error('Student not found');
      const initials = user.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
      const card = document.getElementById('public-id-card');
      const photoHtml = user.passportDataUrl
        ? `<div style="width:70px;height:70px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#06b6d4);margin:0 auto 0.75rem;display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:700;color:#fff;overflow:hidden"><img src="/api/users/${escAttr(user.id)}/photo" style="width:100%;height:100%;object-fit:cover;display:block" alt="Passport"></div>`
        : `<div style="width:70px;height:70px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#06b6d4);margin:0 auto 0.75rem;display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:700;color:#fff">${initials}</div>`;
      card.innerHTML = `
        <div style="background:linear-gradient(135deg,#1e3a5f,#0d1b2e);border:1px solid #3b82f6;border-radius:16px;padding:1.5rem;color:#fff;text-align:center;position:relative;overflow:hidden">
          <div style="position:absolute;right:-20px;top:10px;font-family:'Orbitron',sans-serif;font-size:4rem;color:rgba(59,130,246,0.08);transform:rotate(10deg)">KsTU</div>
          ${photoHtml}
          <div style="font-family:'Orbitron',sans-serif;font-size:1rem;font-weight:700;margin-bottom:0.4rem;color:#fff">${escHtml(user.name)}</div>
          <div style="font-size:0.75rem;color:#94a3b8;margin-bottom:0.875rem">${escHtml(user.programme || user.role)}</div>
          <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:#cbd5e1;margin-bottom:0.5rem">
            <div><div style="font-size:0.6rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Student ID</div><div style="font-weight:600;color:#f8fafc">${escHtml(user.studentId || '—')}</div></div>
            <div><div style="font-size:0.6rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Level</div><div style="font-weight:600;color:#f8fafc">${escHtml(user.level || '—')}</div></div>
          </div>
          <div style="font-size:0.6rem;color:#64748b;margin-top:0.75rem">Powered by CampusIQ · Papi</div>
        </div>
      `;
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('public-profile-screen').classList.remove('hidden');
    }catch(e){
      console.warn('Public profile load failed:', e);
    }
  }
})();

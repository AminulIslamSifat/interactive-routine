
const API = '';
const DAYS = ['Saturday','Sunday','Monday','Tuesday','Wednesday','Thursday','Friday'];
const DAYS_SHORT = ['Sat','Sun','Mon','Tue','Wed','Thu','Fri'];

let TEACHER_NAMES = {};

let config = null;
let currentView = 'routine';
let routineData = null;
let schedules = [];
let personalItems = [];
let calendarDate = new Date();
let personalEditMode = false;
let personalActiveDay = DAYS_SHORT[new Date().getDay() === 6 ? 0 : new Date().getDay() + 1];
let changeFlowStep = 0;
let changeFlowSem = null;
let changeFlowSection = null;
let previewRoutine = null;
let viewingPreview = false;
let scheduleUpdateInfo = null;

const $ = (sel) => document.querySelector(sel);
const refreshIcons = () => { if (window.lucide) lucide.createIcons(); };
const $$ = (sel) => [...document.querySelectorAll(sel)];

const sbTitle = $('#sbTitle');
const sbSubtitle = $('#sbSubtitle');
const sbBody = $('#sbBody');
const modalOverlay = $('#modalOverlay');
const modalContent = $('#modalContent');

let _iconTimer = null;
new MutationObserver(() => {
  clearTimeout(_iconTimer);
  _iconTimer = setTimeout(() => {
    if (document.querySelector('[data-lucide]')) refreshIcons();
  }, 50);
}).observe(document.body, { childList: true, subtree: true });

async function init() {

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') document.body.classList.add('light');

  TEACHER_NAMES = await api('/teachers.json') || {};
  config = await api('/api/config');
  if (!config || !config.roll) {
    showFirstLoginModal();
    return;
  }
  setupViews();
  await loadRoutine();
  renderSidebar();
  loadSchedules();
  loadPersonal();
}

async function api(url, opts = {}) {
  try {
    const res = await fetch(url, opts);
    return await res.json();
  } catch { return null; }
}

async function apiPost(url, data) {
  return api(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
}
async function apiPut(url, data) {
  return api(url, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
}
async function apiDel(url) {
  return api(url, { method: 'DELETE' });
}

function setupViews() {
  $$('.rail-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });
  $('#personalAddBtn').addEventListener('click', showAddPersonalModal);
}

function switchView(view) {
  currentView = view;
  document.body.dataset.view = view;
  $$('.rail-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  renderSidebar();
}

function renderSidebar() {
  changeFlowStep = 0;
  if (currentView === 'routine') renderRoutineSidebar();
  else if (currentView === 'schedule') renderScheduleSidebar();
  else if (currentView === 'personal') renderPersonalSidebar();
  else if (currentView === 'settings') renderSettingsView();
}

function renderRoutineSidebar() {

  if (viewingPreview) { viewingPreview = false; loadRoutine(); }
  sbTitle.textContent = 'Class Routine';
  sbSubtitle.textContent = config ? `${config.year}-${config.semester} • Section ${config.section}` : 'Not set';
  sbBody.innerHTML = '';
  if (routineData && routineData.slots && routineData.slots.length) {
    const codes = new Set();
    routineData.slots.forEach(s => {
      if (s.teacher) s.teacher.split('/').forEach(c => codes.add(c.trim()));
    });
    const seen = new Set();
    [...codes].sort().forEach(code => {
      if (seen.has(code)) return;
      seen.add(code);
      const fullName = TEACHER_NAMES[code] || code;
      const courses = [...new Set(
        routineData.slots.filter(s => s.teacher && s.teacher.split('/').map(c => c.trim()).includes(code)).map(s => s.course)
      )];
      const card = document.createElement('div');
      card.className = 'sb-card';
      card.innerHTML = `
        <div class="card-title">${esc(fullName)}</div>
        <div class="card-sub">${courses.map(esc).join(', ')}</div>
      `;
      sbBody.appendChild(card);
    });
  } else {
    sbBody.innerHTML = '<div class="empty-state"><p>No teacher data</p></div>';
  }
  let btn = document.getElementById('sbChangeBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'sbChangeBtn';
    btn.className = 'sb-btn';
    btn.style.cssText = 'flex-shrink:0;margin:0 10px 10px;width:calc(100% - 20px)';
    btn.innerHTML = '<i data-lucide="refresh-cw" class="ic-sm"></i> Change Section';
    btn.addEventListener('click', () => startChangeFlow());
    sbBody.parentElement.appendChild(btn);
  } else {
    btn.style.display = '';
  }
}

async function startChangeFlow() {
  changeFlowStep = 1;
  sbTitle.textContent = 'Change Section';
  sbSubtitle.textContent = 'Select semester';
  sbBody.innerHTML = '';
  const changeBtn = document.getElementById('sbChangeBtn');
  if (changeBtn) changeBtn.style.display = 'none';

  const index = await api('/api/routines/index');
  if (!index || Object.keys(index).length === 0) {
    sbBody.innerHTML = '<div class="empty-state"><p>No routines available</p></div>';
    return;
  }

  Object.keys(index).sort().forEach(key => {
    const [year, sem] = key.split('-');
    const semLabel = sem === '1' ? 'Odd' : 'Even';
    const card = document.createElement('div');
    card.className = 'sb-card';
    const isCurrent = config && `${config.year}` === year && `${config.semester}` === sem;
    card.innerHTML = `
      <div class="card-title">Year ${year} • ${semLabel}</div>
      <div class="card-sub">${index[key].length} section(s)${isCurrent ? ' • current' : ''}</div>
    `;
    card.addEventListener('click', () => showSectionsForSem(key, index[key]));
    sbBody.appendChild(card);
  });
  const back = document.createElement('button');
  back.className = 'sb-btn';
  back.textContent = '← Back';
  back.addEventListener('click', renderRoutineSidebar);
  sbBody.appendChild(back);
}

function showSectionsForSem(semKey, sections) {
  changeFlowStep = 2;
  changeFlowSem = semKey;
  sbTitle.textContent = 'Change Section';
  sbSubtitle.textContent = `Semester ${semKey} — pick section`;
  sbBody.innerHTML = '';

  sections.forEach(sec => {
    const card = document.createElement('div');
    card.className = 'sb-card';
    card.innerHTML = `<div class="card-title">Section ${sec}</div>`;
    card.addEventListener('click', () => previewSection(semKey, sec));
    sbBody.appendChild(card);
  });

  const back = document.createElement('button');
  back.className = 'sb-btn';
  back.textContent = '← Back';
  back.addEventListener('click', startChangeFlow);
  sbBody.appendChild(back);
}

async function previewSection(semKey, section) {
  changeFlowStep = 3;
  changeFlowSection = section;
  const [year, sem] = semKey.split('-');
  sbTitle.textContent = 'Preview';
  sbSubtitle.textContent = `${semKey} • Section ${section}`;
  sbBody.innerHTML = '<p style="font-size:12px;color:var(--muted);padding:8px">Loading...</p>';

  previewRoutine = await api(`/api/routine?year=${year}&sem=${sem}&section=${section}`);
  if (!previewRoutine) {
    sbBody.innerHTML = '<div class="empty-state"><p>Routine not found</p></div>';
    return;
  }
  viewingPreview = true;
  renderRoutineTable(previewRoutine);
  const pSemLabel = sem === '1' ? 'Odd' : 'Even';
  $('#routineSectionLabel').textContent = `Year ${year} • ${pSemLabel} • Section ${section} (preview)`;
  const days = previewRoutine.days || [];
  sbBody.innerHTML = '';
  days.forEach(day => {
    const card = document.createElement('div');
    card.className = 'sb-card';
    const courses = (previewRoutine.slots || [])
      .filter(s => s.day === day)
      .map(s => s.course).filter(Boolean);
    card.innerHTML = `
      <div class="card-title">${day}</div>
      <div class="card-sub">${courses.join(', ') || 'No classes'}</div>
    `;
    sbBody.appendChild(card);
  });
  const applyBtn = document.createElement('button');
  applyBtn.className = 'sb-btn';
  applyBtn.style.borderColor = 'var(--accent)';
  applyBtn.style.color = 'var(--accent)';
  applyBtn.innerHTML = '<i data-lucide="check" class="ic-sm"></i> Set as Default';
  applyBtn.addEventListener('click', () => applySectionChange(year, sem, section));
  sbBody.appendChild(applyBtn);

  const back = document.createElement('button');
  back.className = 'sb-btn';
  back.textContent = '← Back';
  back.addEventListener('click', () => showSectionsForSem(changeFlowSem, [section]));
  sbBody.appendChild(back);
}

async function applySectionChange(year, sem, section) {
  viewingPreview = false;
  config.year = year;
  config.semester = sem;
  config.section = section;
  await apiPut('/api/config', config);
  await loadRoutine();
  renderRoutineSidebar();
}

async function loadRoutine() {
  if (!config) return;
  const { year, semester, section } = config;
  routineData = await api(`/api/routine?year=${year}&sem=${semester}&section=${section}`);
  renderRoutineTable();
  const semLabel = semester === '1' ? 'Odd' : 'Even';
  $('#routineSectionLabel').textContent = `Year ${year} • ${semLabel} • Section ${section}`;
  checkRoutineUpdate();
}

async function checkRoutineUpdate() {
  const info = await api('/api/routines/check-update');
  scheduleUpdateInfo = info;
  renderUpdateButton();
}

function renderUpdateButton() {
  let btn = $('#routineUpdateBtn');
  if (scheduleUpdateInfo && scheduleUpdateInfo.hasUpdate) {
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'routineUpdateBtn';
      btn.className = 'btn btn-primary';
      btn.style.cssText = 'margin-left:12px;font-size:12px;padding:4px 12px;display:inline-flex;align-items:center;gap:6px';
      $('#routineSectionLabel').after(btn);
    }
    btn.innerHTML = '<i data-lucide="download" class="ic-sm"></i> Update Routine';
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Updating...';
      const res = await apiPost('/api/settings/refresh', { scheduleId: scheduleUpdateInfo.latest });
      if (res && res.message && !res.message.startsWith('Error')) {
        showToast('Routine updated!');
        await loadRoutine();
      } else {
        showToast(res?.message || 'Update failed');
        btn.disabled = false;
        renderUpdateButton();
      }
    };
    refreshIcons();
  } else if (btn) {
    btn.remove();
  }
}

function renderRoutineTable(data) {
  const body = $('#routineBody');
  const src = data || routineData;
  if (!src) {
    body.innerHTML = '<div class="empty-state"><p>No routine data available.<br>Use "Change Section" to pick one.</p></div>';
    return;
  }

  const { days = [], periods = [], slots = [] } = src;
  let html = '<table class="routine-table"><thead><tr><th></th>';
  periods.forEach(p => { html += `<th>${esc(p)}</th>`; });
  html += '</tr></thead><tbody>';

  days.forEach(day => {
    html += `<tr><td class="day-label">${esc(day)}</td>`;
    let pi = 0;
    while (pi < periods.length) {
      const slot = slots.find(s => s.day === day && s.period === pi);
      if (slot) {
        const span = slot.span || 1;
        html += `<td${span > 1 ? ` colspan="${span}"` : ''}>`;
        html += `<div class="course">${esc(slot.course)}</div>`;
        if (slot.teacher) html += `<div class="teacher">${esc(slot.teacher)}</div>`;
        if (slot.room) html += `<div class="teacher" style="opacity:0.6">${esc(slot.room)}</div>`;
        html += '</td>';
        pi += span;
      } else {
        html += '<td class="empty"></td>';
        pi++;
      }
    }
    html += '</tr>';
  });

  html += '</tbody></table>';
  body.innerHTML = html;
}

async function loadSchedules() {
  const y = calendarDate.getFullYear();
  const m = String(calendarDate.getMonth() + 1).padStart(2, '0');
  schedules = await api(`/api/schedule?month=${y}-${m}`) || [];
  if (new Date().getDate() > 20) {
    const next = new Date(y, calendarDate.getMonth() + 1, 1);
    const nm = String(next.getMonth() + 1).padStart(2, '0');
    const ny = next.getFullYear();
    const nextSchedules = await api(`/api/schedule?month=${ny}-${nm}`) || [];
    schedules = [...schedules, ...nextSchedules];
  }

  renderCalendar();
  if (currentView === 'schedule') renderScheduleSidebar();
}

function renderCalendar() {
  const y = calendarDate.getFullYear();
  const m = calendarDate.getMonth();
  $('#calTitle').textContent = new Date(y, m).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const grid = $('#calGrid');
  grid.innerHTML = '';
  const firstDay = new Date(y, m, 1);
  let startDow = firstDay.getDay();
  startDow = (startDow + 1) % 7;

  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  const todayStr = fmtDate(today);
  for (let i = 0; i < startDow; i++) {
    grid.innerHTML += '<div class="cal-cell other-month"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const daySchedules = schedules.filter(s => s.date === dateStr);
    const isToday = dateStr === todayStr;

    const cell = document.createElement('div');
    cell.className = `cal-cell${isToday ? ' today' : ''}${daySchedules.length ? ' has-event' : ''}`;
    cell.innerHTML = `
      <span class="day-num">${d}</span>
      ${daySchedules.length ? `<div class="dots">${daySchedules.map(() => '<span class="dot"></span>').join('')}</div>` : ''}
      ${daySchedules.length ? `<span class="event-label">${esc(daySchedules[0].title)}</span>` : ''}
    `;
    cell.addEventListener('click', () => showDaySchedule(dateStr, daySchedules));
    grid.appendChild(cell);
  }
  $('#calPrev').onclick = () => { calendarDate = new Date(y, m - 1, 1); loadSchedules(); };
  $('#calNext').onclick = () => { calendarDate = new Date(y, m + 1, 1); loadSchedules(); };
  $('#calToday').onclick = () => { calendarDate = new Date(); loadSchedules(); };
}

function showDaySchedule(dateStr, daySchedules) {
  if (!daySchedules.length) return;
  const dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  let html = `<h3>${dateLabel}</h3>`;
  daySchedules.forEach(s => {
    html += `
      <div class="schedule-card expanded" style="margin-top:10px">
        <div class="sc-time">${esc(s.time || '')}</div>
        <div class="sc-title">${esc(s.title)}</div>
        <div class="sc-content">${esc(s.content || '')}</div>
      </div>
    `;
  });
  html += `<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>`;

  showModal(html);
}

function renderScheduleSidebar() {
  sbTitle.textContent = 'Schedule';
  const now = new Date();
  sbSubtitle.textContent = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  sbBody.innerHTML = '';

  if (!schedules.length) {
    sbBody.innerHTML = '<div class="empty-state"><p>No schedules this month</p></div>';
    return;
  }

  schedules.sort((a, b) => a.date.localeCompare(b.date)).forEach(s => {
    const card = document.createElement('div');
    card.className = 'sb-card';
    const dateLabel = new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    card.innerHTML = `
      <div class="card-title">${esc(s.title)}</div>
      <div class="card-sub">${dateLabel} • ${esc(s.time || '')}</div>
    `;
    card.addEventListener('click', () => {

      const existing = card.querySelector('.card-content');
      if (existing) { existing.remove(); card.classList.remove('active'); }
      else {
        card.classList.add('active');
        const detail = document.createElement('div');
        detail.className = 'card-content';
        detail.style.cssText = 'margin-top:6px;font-size:11px;color:var(--text-dim)';
        detail.textContent = s.content || 'No details';
        card.appendChild(detail);
      }
    });
    sbBody.appendChild(card);
  });
}

async function loadPersonal() {
  const data = await api('/api/personal');
  personalItems = data?.items || [];
  renderPersonalView();
  if (currentView === 'personal') renderPersonalSidebar();
}

function renderPersonalSidebar() {
  sbTitle.textContent = 'Personal Routine';
  const today = new Date();
  sbSubtitle.textContent = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  sbBody.innerHTML = '';
  const dailyCard = document.createElement('div');
  dailyCard.className = `sb-card${personalActiveDay === 'Daily' ? ' active' : ''}`;
  dailyCard.innerHTML = '<div class="card-title"><i data-lucide="clipboard-list" class="ic-sm"></i> Daily</div><div class="card-sub">Every day items</div>';
  dailyCard.addEventListener('click', () => { personalActiveDay = 'Daily'; renderPersonalView(); renderPersonalSidebar(); });
  sbBody.appendChild(dailyCard);

  DAYS.forEach((day, i) => {
    const short = DAYS_SHORT[i];
    const isToday = today.getDay() === (i + 6) % 7;
    const items = getItemsForDay(short);
    const card = document.createElement('div');
    card.className = `sb-card${personalActiveDay === short ? ' active' : ''}`;
    card.innerHTML = `
      <div class="card-title">${isToday ? '● ' : ''}${day}</div>
      <div class="card-sub">${items.length} item(s)</div>
    `;
    card.addEventListener('click', () => { personalActiveDay = short; renderPersonalView(); renderPersonalSidebar(); });
    sbBody.appendChild(card);
  });

}

function getItemsForDay(dayShort) {
  return personalItems.filter(item => {
    const freq = item.frequency || ['daily'];
    return freq.includes('daily') || freq.includes(dayShort.toLowerCase());
  });
}

function renderPersonalView() {

  const tabs = $('#dayTabs');
  tabs.innerHTML = '';

  const allTabs = ['Daily', ...DAYS_SHORT];
  allTabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = `day-tab${personalActiveDay === tab ? ' active' : ''}`;
    btn.textContent = tab;
    btn.addEventListener('click', () => {
      personalActiveDay = tab;
      renderPersonalView();
      renderPersonalSidebar();
    });
    tabs.appendChild(btn);
  });
  const body = $('#personalBody');
  body.innerHTML = '';

  if (personalEditMode) {
    renderPersonalEdit(body);
    return;
  }

  let items;
  if (personalActiveDay === 'Daily') {
    items = personalItems.filter(i => (i.frequency || ['daily']).includes('daily'));
  } else {
    items = getItemsForDay(personalActiveDay);
  }

  if (!items.length) {
    body.innerHTML = '<div class="empty-state"><p>No items for this day</p></div>';
    return;
  }

  const todayStr = fmtDate(new Date());
  items.forEach(item => {
    const checked = item.checks?.[todayStr] || false;
    const el = document.createElement('div');
    el.className = `personal-item${checked ? ' checked' : ''}`;
    el.innerHTML = `
      <div class="check-circle" data-id="${item.id}">${checked ? '<i data-lucide="check" class="ic-sm"></i>' : ''}</div>
      <span class="item-title">${esc(item.title)}</span>
      ${item.duration ? `<span class="item-duration">${esc(item.duration)}</span>` : ''}
      <span class="item-freq">${formatFreq(item.frequency)}</span>
    `;
    el.querySelector('.check-circle').addEventListener('click', () => toggleCheck(item.id));
    body.appendChild(el);
  });
  $('#personalEditBtn').textContent = 'Edit';
  $('#personalEditBtn').onclick = () => {
    personalEditMode = true;
    renderPersonalView();
    $('#personalEditBtn').textContent = 'Done';
    $('#personalEditBtn').onclick = () => {
      personalEditMode = false;
      renderPersonalView();
    };
  };
}

function renderPersonalEdit(body) {
  body.innerHTML = '';

  const allTabs = ['Daily', ...DAYS_SHORT];

  let items = personalActiveDay === 'Daily'
    ? personalItems.filter(i => (i.frequency || ['daily']).includes('daily'))
    : getItemsForDay(personalActiveDay);

  if (!items.length) {
    body.innerHTML = '<div class="empty-state"><p>Nothing here. Use + Add to create one.</p></div>';
  }

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'personal-item';
    el.style.flexWrap = 'wrap';
    el.innerHTML = `
      <span class="item-title" style="flex:1">${esc(item.title)}</span>
      ${item.duration ? `<span class="item-duration">${esc(item.duration)}</span>` : ''}
      <span class="item-freq">${formatFreq(item.frequency)}</span>
      <button class="btn" style="padding:4px 10px;font-size:11px" data-edit="${item.id}">Edit</button>
      <button class="btn btn-danger" style="padding:4px 10px;font-size:11px" data-del="${item.id}"><i data-lucide="x" class="ic-sm"></i></button>
    `;
    el.querySelector('[data-edit]').addEventListener('click', () => showEditPersonalModal(item));
    el.querySelector('[data-del]').addEventListener('click', () => deletePersonalItem(item));
    body.appendChild(el);
  });
}

async function toggleCheck(id) {
  const item = personalItems.find(i => i.id === id);
  if (!item) return;
  const todayStr = fmtDate(new Date());
  if (!item.checks) item.checks = {};
  item.checks[todayStr] = !item.checks[todayStr];
  await apiPut(`/api/personal/items/${id}`, { checks: item.checks });
  renderPersonalView();
  renderPersonalSidebar();
}

function formatFreq(freq) {
  if (!freq || freq.includes('daily')) return 'Daily';
  return freq.map(f => f.charAt(0).toUpperCase() + f.slice(1, 3)).join('+');
}

function showAddPersonalModal() {
  let dayChecks = DAYS_SHORT.map(d => `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:8px"><input type="checkbox" value="${d.toLowerCase()}" style="width:auto"> ${d}</label>`).join('');

  showModal(`
    <h3>Add Item</h3>
    <label>Title</label>
    <input id="pTitle" placeholder="What to do...">
    <label>Duration (optional)</label>
    <input id="pDuration" placeholder="e.g. 1h, 30min">
    <label>Frequency</label>
    <div style="margin-top:6px">
      <label style="display:inline-flex;align-items:center;gap:4px;margin-right:12px"><input type="checkbox" id="pDaily" checked style="width:auto"> Daily</label>
    </div>
    <div id="pDayChecks" style="margin-top:8px;opacity:0.4;pointer-events:none">${dayChecks}</div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="pAddBtn">Add</button>
    </div>
  `);
  const dailyCb = $('#pDaily');
  const dayChecksEl = $('#pDayChecks');
  dailyCb.addEventListener('change', () => {
    dayChecksEl.style.opacity = dailyCb.checked ? '0.4' : '1';
    dayChecksEl.style.pointerEvents = dailyCb.checked ? 'none' : 'all';
  });

  $('#pAddBtn').addEventListener('click', async () => {
    const title = $('#pTitle').value.trim();
    if (!title) return;
    const duration = $('#pDuration').value.trim() || null;
    let frequency;
    if (dailyCb.checked) {
      frequency = ['daily'];
    } else {
      frequency = [...dayChecksEl.querySelectorAll('input:checked')].map(cb => cb.value);
      if (!frequency.length) frequency = ['daily'];
    }
    await apiPost('/api/personal/items', { title, duration, frequency, checks: {} });
    closeModal();
    await loadPersonal();
  });
}

function showEditPersonalModal(item) {
  const isDaily = (item.frequency || ['daily']).includes('daily');
  let dayChecks = DAYS_SHORT.map(d => {
    const checked = (item.frequency || []).includes(d.toLowerCase()) ? 'checked' : '';
    return `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:8px"><input type="checkbox" value="${d.toLowerCase()}" ${checked} style="width:auto"> ${d}</label>`;
  }).join('');

  showModal(`
    <h3>Edit Item</h3>
    <label>Title</label>
    <input id="eTitle" value="${esc(item.title)}">
    <label>Duration (optional)</label>
    <input id="eDuration" value="${esc(item.duration || '')}" placeholder="e.g. 1h">
    <label>Frequency</label>
    <div style="margin-top:6px">
      <label style="display:inline-flex;align-items:center;gap:4px"><input type="checkbox" id="eDaily" ${isDaily ? 'checked' : ''} style="width:auto"> Daily</label>
    </div>
    <div id="eDayChecks" style="margin-top:8px;${isDaily ? 'opacity:0.4;pointer-events:none' : ''}">${dayChecks}</div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="eSaveBtn">Save</button>
    </div>
  `);

  const dailyCb = $('#eDaily');
  const dayChecksEl = $('#eDayChecks');
  dailyCb.addEventListener('change', () => {
    dayChecksEl.style.opacity = dailyCb.checked ? '0.4' : '1';
    dayChecksEl.style.pointerEvents = dailyCb.checked ? 'none' : 'all';
  });

  $('#eSaveBtn').addEventListener('click', async () => {
    const title = $('#eTitle').value.trim();
    if (!title) return;
    const duration = $('#eDuration').value.trim() || null;
    let frequency;
    if (dailyCb.checked) {
      frequency = ['daily'];
    } else {
      frequency = [...dayChecksEl.querySelectorAll('input:checked')].map(cb => cb.value);
      if (!frequency.length) frequency = ['daily'];
    }
    if (personalActiveDay !== 'Daily' && isDaily) {
      closeModal();
      showScopeModal(item.id, { title, duration, frequency });
      return;
    }

    await apiPut(`/api/personal/items/${item.id}`, { title, duration, frequency });
    closeModal();
    await loadPersonal();
  });
}

function showScopeModal(itemId, changes) {
  showModal(`
    <h3>Apply Changes</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-top:8px">This item appears on multiple days. How should the change be applied?</p>
    <div class="modal-actions" style="margin-top:20px">
      <button class="btn" id="scopeDay">This Day Only</button>
      <button class="btn btn-primary" id="scopeAll">Universal (All Days)</button>
    </div>
  `);

  $('#scopeAll').addEventListener('click', async () => {
    await apiPut(`/api/personal/items/${itemId}`, changes);
    closeModal();
    await loadPersonal();
  });

  $('#scopeDay').addEventListener('click', async () => {

    const item = personalItems.find(i => i.id === itemId);
    if (item) {
      if (!item.overrides) item.overrides = {};
      item.overrides[personalActiveDay.toLowerCase()] = changes;
      await apiPut(`/api/personal/items/${itemId}`, { overrides: item.overrides });
    }
    closeModal();
    await loadPersonal();
  });
}

async function deletePersonalItem(item) {
  const isDaily = (item.frequency || ['daily']).includes('daily');
  if (isDaily && personalActiveDay !== 'Daily') {
    showDeleteScopeModal(item);
    return;
  }
  await apiDel(`/api/personal/items/${item.id}`);
  await loadPersonal();
}

function showDeleteScopeModal(item) {
  showModal(`
    <h3>Delete Item</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-top:8px">"${esc(item.title)}" is a recurring item. Delete everywhere or just this day?</p>
    <div class="modal-actions" style="margin-top:20px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn" id="delDay">This Day Only</button>
      <button class="btn btn-danger" id="delAll">Delete Everywhere</button>
    </div>
  `);

  $('#delAll').addEventListener('click', async () => {
    await apiDel(`/api/personal/items/${item.id}`);
    closeModal();
    await loadPersonal();
  });

  $('#delDay').addEventListener('click', async () => {

    const freq = (item.frequency || []).filter(f => f !== personalActiveDay.toLowerCase());
    if (!freq.length) { await apiDel(`/api/personal/items/${item.id}`); }
    else { await apiPut(`/api/personal/items/${item.id}`, { frequency: freq }); }
    closeModal();
    await loadPersonal();
  });
}

function showFirstLoginModal() {
  showModal(`
    <h3>Welcome! <i data-lucide="graduation-cap" class="ic-lg"></i></h3>
    <p style="font-size:13px;color:var(--text-dim);margin-top:4px">Let's set up your profile.</p>
    <label>Roll Number</label>
    <input id="cfgRoll" placeholder="e.g. 2022831058">
    <label>Year</label>
    <select id="cfgYear">
      <option value="1">1st Year</option>
      <option value="2" selected>2nd Year</option>
      <option value="3">3rd Year</option>
      <option value="4">4th Year</option>
    </select>
    <label>Semester</label>
    <select id="cfgSem">
      <option value="1" selected>1st Semester</option>
      <option value="2">2nd Semester</option>
    </select>
    <label>Section</label>
    <select id="cfgSection">
      <option value="A" selected>A</option>
      <option value="B">B</option>
      <option value="C">C</option>
    </select>
    <div class="modal-actions">
      <button class="btn btn-primary" id="cfgSave">Save & Continue</button>
    </div>
  `);

  $('#cfgSave').addEventListener('click', async () => {
    const roll = $('#cfgRoll').value.trim();
    if (!roll) return;
    config = {
      roll,
      year: $('#cfgYear').value,
      semester: $('#cfgSem').value,
      section: $('#cfgSection').value,
    };
    await apiPost('/api/config', config);
    closeModal();
    setupViews();
    loadRoutine();
    loadSchedules();
    loadPersonal();
  });
}

let settingsTab = 'general';

const SETTINGS_TABS = [
  { id: 'general', label: 'General', icon: '<i data-lucide="settings" class="ic-sm"></i>' },
  { id: 'appearance', label: 'Appearance', icon: '<i data-lucide="palette" class="ic-sm"></i>' },
  { id: 'routine', label: 'Routine', icon: '<i data-lucide="book-open" class="ic-sm"></i>' },
  { id: 'schedule', label: 'Schedule', icon: '<i data-lucide="calendar" class="ic-sm"></i>' },
  { id: 'personal', label: 'Personal', icon: '<i data-lucide="circle-check" class="ic-sm"></i>' },
];

let settingsMobileDrill = false;

function isMobile() { return window.innerWidth <= 768; }

function renderSettingsView() {
  const nav = $('#settingsNav');
  const sidebar = $('#viewSettings .sidebar');
  const mainArea = $('#viewSettings .main-area');
  nav.innerHTML = '';

  SETTINGS_TABS.forEach(tab => {
    const card = document.createElement('div');
    card.className = 'sb-card' + (settingsTab === tab.id ? ' active' : '');
    card.innerHTML = `<div class="card-title">${tab.icon} ${tab.label}</div>`;
    card.addEventListener('click', () => {
      settingsTab = tab.id;
      if (isMobile()) {
        settingsMobileDrill = true;
        sidebar.style.display = 'none';
        mainArea.style.display = 'flex';
        renderSettingsContent();
      } else {
        nav.querySelectorAll('.sb-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        renderSettingsContent();
      }
    });
    nav.appendChild(card);
  });

  if (isMobile()) {

    sidebar.style.display = 'flex';
    mainArea.style.display = 'none';
    settingsMobileDrill = false;
  } else {
    sidebar.style.display = '';
    mainArea.style.display = '';
    settingsMobileDrill = false;
    renderSettingsContent();
  }
}

function settingsBackToList() {
  settingsMobileDrill = false;
  const sidebar = $('#viewSettings .sidebar');
  const mainArea = $('#viewSettings .main-area');
  sidebar.style.display = 'flex';
  mainArea.style.display = 'none';
}

function renderSettingsContent() {
  const body = $('#settingsBody');
  if (isMobile() && settingsMobileDrill) {
    const tabLabel = SETTINGS_TABS.find(t => t.id === settingsTab)?.label || '';
    body.innerHTML = `
      <div class="settings-mobile-header">
        <button class="btn settings-back-btn" id="settingsBackBtn">← ${tabLabel}</button>
      </div>
      <div id="settingsContentInner"></div>
    `;
    $('#settingsBackBtn').addEventListener('click', settingsBackToList);

    const inner = $('#settingsContentInner');
    renderSettingsTabContent(inner);
    return;
  }

  renderSettingsTabContent(body);
}

function renderSettingsTabContent(container) {
  const q = (sel) => container.querySelector(sel);
  switch (settingsTab) {
    case 'general':
      container.innerHTML = `
        <h3 style="margin-bottom:16px">General</h3>
        <div class="sb-card" style="padding:16px">
          <div class="card-title"><i data-lucide="user" class="ic-sm"></i> Profile</div>
          <div class="card-sub" style="margin-bottom:12px">Your academic info</div>
          <label>Roll Number</label>
          <input id="setRoll" value="${esc(config?.roll || '')}" placeholder="e.g. 2022831058">
          <label>Year</label>
          <select id="setYear">
            <option value="1" ${config?.year==='1'?'selected':''}>1st Year</option>
            <option value="2" ${config?.year==='2'?'selected':''}>2nd Year</option>
            <option value="3" ${config?.year==='3'?'selected':''}>3rd Year</option>
            <option value="4" ${config?.year==='4'?'selected':''}>4th Year</option>
          </select>
          <label>Semester</label>
          <select id="setSem">
            <option value="1" ${config?.semester==='1'?'selected':''}>Odd (1st)</option>
            <option value="2" ${config?.semester==='2'?'selected':''}>Even (2nd)</option>
          </select>
          <label>Section</label>
          <select id="setSection">
            <option value="A" ${config?.section==='A'?'selected':''}>A</option>
            <option value="B" ${config?.section==='B'?'selected':''}>B</option>
            <option value="C" ${config?.section==='C'?'selected':''}>C</option>
          </select>
          <button class="btn btn-primary" style="margin-top:12px" id="setSaveProfile">Save</button>
        </div>
      `;
      q('#setSaveProfile').addEventListener('click', async () => {
        config.roll = q('#setRoll').value.trim();
        config.year = q('#setYear').value;
        config.semester = q('#setSem').value;
        config.section = q('#setSection').value;
        await apiPut('/api/config', config);
        await loadRoutine();
        showToast('Profile saved!');
      });
      break;

    case 'appearance':
      container.innerHTML = `
        <h3 style="margin-bottom:16px">Appearance</h3>
        <div class="sb-card" style="padding:16px">
          <div class="card-title"><i data-lucide="palette" class="ic-sm"></i> Theme</div>
          <div class="card-sub" style="margin-bottom:12px">Toggle dark/light mode</div>
          <button class="btn" id="setTheme">Toggle Dark/Light</button>
        </div>
      `;
      q('#setTheme').addEventListener('click', () => {
        document.body.classList.toggle('light');
        localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
      });
      break;

    case 'routine': {
      const prefs = JSON.parse(localStorage.getItem('routinePrefs') || '{}');
      container.innerHTML = `
        <h3 style="margin-bottom:16px">Routine Settings</h3>
        <div class="sb-card" style="padding:16px">
          <div class="card-title"><i data-lucide="eye" class="ic-sm"></i> Display</div>
          <label><input type="checkbox" id="rpHighlight" ${prefs.highlight !== false ? 'checked' : ''}> Highlight current period</label>
          <label><input type="checkbox" id="rpCompact" ${prefs.compact ? 'checked' : ''}> Compact table rows</label>
          <label><input type="checkbox" id="rpTeacher" ${prefs.showTeacher !== false ? 'checked' : ''}> Show teacher names</label>
          <button class="btn btn-primary" style="margin-top:12px" id="rpSave">Save</button>
        </div>
      `;
      q('#rpSave').addEventListener('click', () => {
        const p = {
          highlight: q('#rpHighlight').checked,
          compact: q('#rpCompact').checked,
          showTeacher: q('#rpTeacher').checked,
        };
        localStorage.setItem('routinePrefs', JSON.stringify(p));
        showToast('Routine preferences saved!');
        if (typeof loadRoutine === 'function') loadRoutine();
      });
      break;
    }

    case 'schedule': {
      const sprefs = JSON.parse(localStorage.getItem('schedulePrefs') || '{}');
      container.innerHTML = `
        <h3 style="margin-bottom:16px">Schedule Settings</h3>
        <div class="sb-card" style="padding:16px">
          <div class="card-title"><i data-lucide="database" class="ic-sm"></i> Data Source</div>
          <div class="card-sub" style="margin-bottom:8px">Schedule data comes from Phantom Bot API. Set a cookie below if required.</div>
          <label>Session Cookie (optional)</label>
          <input id="scCookie" type="password" placeholder="Paste cookie value" value="${esc(sprefs.cookie || '')}">
          <button class="btn" style="margin-top:8px" id="scSaveCookie">Save Cookie</button>
        </div>
        <div class="sb-card" style="padding:16px;margin-top:8px">
          <div class="card-title"><i data-lucide="refresh-cw" class="ic-sm"></i> Refresh</div>
          <div class="card-sub" style="margin-bottom:8px">Force re-fetch schedule from remote source.</div>
          <button class="btn" id="scRefresh">Refresh Now</button>
        </div>
      `;
      q('#scSaveCookie').addEventListener('click', async () => {
        const cookie = q('#scCookie').value.trim();
        await apiPost('/api/settings/cookie', { cookie });
        const s = JSON.parse(localStorage.getItem('schedulePrefs') || '{}');
        s.cookie = cookie;
        localStorage.setItem('schedulePrefs', JSON.stringify(s));
        showToast('Cookie saved!');
      });
      q('#scRefresh').addEventListener('click', async () => {
        q('#scRefresh').textContent = 'Refreshing...';
        q('#scRefresh').disabled = true;
        try {
          await apiPost('/api/settings/refresh', {});
          showToast('Schedule refreshed!');
        } catch { showToast('Refresh failed'); }
        q('#scRefresh').textContent = 'Refresh Now';
        q('#scRefresh').disabled = false;
      });
      break;
    }

    case 'personal': {
      const pprefs = JSON.parse(localStorage.getItem('personalPrefs') || '{}');
      const days = ['Saturday','Sunday','Monday','Tuesday','Wednesday','Thursday','Friday'];
      const dayOpts = days.map((d,i) => `<option value="${i}" ${pprefs.defaultDay == i ? 'selected' : ''}>${d}</option>`).join('');
      const sorts = [['time','By Time'],['created','By Created']];
      const sortOpts = sorts.map(([v,l]) => `<option value="${v}" ${pprefs.sort === v ? 'selected' : ''}>${l}</option>`).join('');
      container.innerHTML = `
        <h3 style="margin-bottom:16px">Personal Routine Settings</h3>
        <div class="sb-card" style="padding:16px">
          <div class="card-title"><i data-lucide="sliders" class="ic-sm"></i> Defaults</div>
          <label>Default Day Tab</label>
          <select id="ppDay">${dayOpts}</select>
          <label>Sort Order</label>
          <select id="ppSort">${sortOpts}</select>
          <label>Default Duration (minutes)</label>
          <input id="ppDuration" type="number" min="5" max="480" step="5" value="${pprefs.defaultDuration || 30}">
          <button class="btn btn-primary" style="margin-top:12px" id="ppSave">Save</button>
        </div>
      `;
      q('#ppSave').addEventListener('click', () => {
        const p = {
          defaultDay: parseInt(q('#ppDay').value),
          sort: q('#ppSort').value,
          defaultDuration: parseInt(q('#ppDuration').value) || 30,
        };
        localStorage.setItem('personalPrefs', JSON.stringify(p));
        showToast('Personal preferences saved!');
      });
      break;
    }
  }
  refreshIcons();
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:999';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function showModal(html) {
  modalContent.innerHTML = html;
  modalOverlay.classList.add('open');
}

function closeModal() {
  modalOverlay.classList.remove('open');
}

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

init();

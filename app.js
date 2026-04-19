/* ══════════════════════════════════════════
   SITELENS - app.js
══════════════════════════════════════════ */

// ── 전역 상태 ──────────────────────────────
let currentRole = null;
let currentCustomerId = null;
let currentCompanyCode = null;
let currentCompanyName = null;

let _unsubscribeOwnerCompanies = null;
let _unsubscribeOwnerStatus = null;
let _unsubscribeOwnerArchive = null;
let _unsubscribeCompanyStatus = null;
let _unsubscribeCompanyArchive = null;

const photos = { before: [], during: [], after: [] };
let ownerArchiveAll = [];
let companyArchiveAll = [];

// ── PWA 서비스워커 ────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js');
}

// ── JSZip 동적 로드 ───────────────────────
function loadJSZip() {
  return new Promise((resolve, reject) => {
    if (window.JSZip) { resolve(window.JSZip); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => resolve(window.JSZip);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── 유틸 ──────────────────────────────────
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

function showSection(id) {
  ["section-login","section-super","section-owner","section-company"].forEach(s => {
    document.getElementById(s).style.cssText = "display: none !important";
  });
  document.getElementById(id).style.cssText = "display: flex !important; flex-direction: column";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// 로딩 오버레이
function showLoading(msg = '처리 중...') {
  let el = document.getElementById('global-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'global-loading';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(13,27,42,0.85);z-index:9998;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;';
    el.innerHTML = '<div class="spinner"></div><p style="color:#f4a020;font-size:14px;font-family:var(--font-main)"></p>';
    document.body.appendChild(el);
  }
  el.querySelector('p').textContent = msg;
  el.style.display = 'flex';
}

function hideLoading() {
  const el = document.getElementById('global-loading');
  if (el) el.style.display = 'none';
}

// ── 로그인 ────────────────────────────────
async function handleLogin() {
  const code = document.getElementById('login-code').value.trim();
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  if (!code) { errEl.textContent = '코드를 입력하세요'; errEl.classList.remove('hidden'); return; }

  if (code === 'super2025') {
    currentRole = 'super';
    showSection('section-super');
    initSuper();
    return;
  }

  if (code.endsWith('-owner')) {
    const customerId = code.replace('-owner', '');
    showLoading('인증 중...');
    try {
      const snap = await window._get(window._firebaseRef(window._db, `customers/${customerId}`));
      if (!snap.exists()) { errEl.textContent = '등록되지 않은 고객사 코드입니다'; errEl.classList.remove('hidden'); return; }
      currentRole = 'owner';
      currentCustomerId = customerId;
      document.getElementById('owner-customer-name').textContent = snap.val().name || customerId;
      showSection('section-owner');
      initOwner();
    } finally { hideLoading(); }
    return;
  }

  if (/^C\d{8}$/.test(code)) {
    showLoading('인증 중...');
    try {
      const customersSnap = await window._get(window._firebaseRef(window._db, 'customers'));
      if (!customersSnap.exists()) { errEl.textContent = '등록되지 않은 업체 코드입니다'; errEl.classList.remove('hidden'); return; }
      let found = false;
      customersSnap.forEach(custSnap => {
        if (found) return;
        const companies = custSnap.val()?.companies || {};
        if (companies[code]) {
          found = true;
          currentRole = 'company';
          currentCustomerId = custSnap.key;
          currentCompanyCode = code;
          currentCompanyName = companies[code].name || code;
        }
      });
      if (!found) { errEl.textContent = '등록되지 않은 업체 코드입니다'; errEl.classList.remove('hidden'); return; }
      document.getElementById('company-name-header').textContent = currentCompanyName;
      showSection('section-company');
      initCompany();
    } finally { hideLoading(); }
    return;
  }

  errEl.textContent = '코드가 올바르지 않습니다';
  errEl.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-code')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  // 스피너 CSS 주입
  const style = document.createElement('style');
  style.textContent = `.spinner{width:36px;height:36px;border:3px solid rgba(244,160,32,0.2);border-top-color:#f4a020;border-radius:50%;animation:spin 0.7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`;
  document.head.appendChild(style);
});

// ── 로그아웃 ──────────────────────────────
function handleLogout() {
  [_unsubscribeOwnerCompanies, _unsubscribeOwnerStatus, _unsubscribeOwnerArchive,
   _unsubscribeCompanyStatus, _unsubscribeCompanyArchive].forEach(fn => { if (fn) fn(); });
  currentRole = null; currentCustomerId = null; currentCompanyCode = null; currentCompanyName = null;
  ownerArchiveAll = []; companyArchiveAll = [];
  Object.keys(photos).forEach(k => { photos[k] = []; });
  document.getElementById('login-code').value = '';
  document.getElementById('login-error').classList.add('hidden');
  resetPhotoUI();
  showSection('section-login');
}

// ══════════════════════════════════════════
// SUPER ADMIN
// ══════════════════════════════════════════
function initSuper() { loadCustomers(); }

async function createCustomer() {
  const name = document.getElementById('super-customer-name').value.trim();
  const id   = document.getElementById('super-customer-id').value.trim().toLowerCase();
  if (!name || !id) { showToast('고객사명과 ID를 모두 입력하세요'); return; }
  if (!/^[a-z0-9-]+$/.test(id)) { showToast('ID는 영문소문자, 숫자, 하이픈만 가능합니다'); return; }
  const snap = await window._get(window._firebaseRef(window._db, `customers/${id}`));
  if (snap.exists()) { showToast('이미 존재하는 ID입니다'); return; }
  await window._set(window._firebaseRef(window._db, `customers/${id}`), { name, createdAt: new Date().toISOString() });
  document.getElementById('super-customer-name').value = '';
  document.getElementById('super-customer-id').value = '';
  showToast(`✅ ${name} 생성 완료\n오너 코드: ${id}-owner`);
  loadCustomers();
}

async function loadCustomers() {
  const listEl = document.getElementById('super-customer-list');
  const snap = await window._get(window._firebaseRef(window._db, 'customers'));
  if (!snap.exists()) { listEl.innerHTML = '<p class="empty-msg">등록된 고객사가 없습니다</p>'; return; }
  let html = '';
  snap.forEach(child => {
    const d = child.val();
    html += `<div class="list-item">
      <div class="list-item-info">
        <span class="list-item-name">${d.name}</span>
        <span class="list-item-code">${child.key}-owner</span>
      </div>
      <button class="btn-icon-delete" onclick="deleteCustomer('${child.key}','${d.name}')">🗑</button>
    </div>`;
  });
  listEl.innerHTML = html;
}

async function deleteCustomer(id, name) {
  if (!confirm(`"${name}" 고객사와 모든 데이터를 삭제하시겠습니까?`)) return;
  await window._remove(window._firebaseRef(window._db, `customers/${id}`));
  try {
    const res = await window._listAll(window._storageRef(window._storage, id));
    for (const item of res.items) await window._deleteObject(item);
    for (const prefix of res.prefixes) {
      const sub = await window._listAll(prefix);
      for (const item of sub.items) await window._deleteObject(item);
    }
  } catch (e) {}
  showToast(`🗑 ${name} 삭제 완료`);
  loadCustomers();
}

// ══════════════════════════════════════════
// OWNER
// ══════════════════════════════════════════
function initOwner() { switchOwnerTab('companies'); }

function switchOwnerTab(tab) {
  ['companies','status','archive'].forEach(t => document.getElementById(`owner-tab-${t}`).classList.add('hidden'));
  document.getElementById(`owner-tab-${tab}`).classList.remove('hidden');
  document.querySelectorAll('#section-owner .tab-btn').forEach((b, i) => {
    b.classList.toggle('tab-active', ['companies','status','archive'][i] === tab);
  });
  if (tab === 'companies') listenOwnerCompanies();
  if (tab === 'status') listenOwnerStatus();
  if (tab === 'archive') listenOwnerArchive();
}

function listenOwnerCompanies() {
  if (_unsubscribeOwnerCompanies) _unsubscribeOwnerCompanies();
  _unsubscribeOwnerCompanies = window._onValue(
    window._firebaseRef(window._db, `customers/${currentCustomerId}/companies`),
    snap => renderOwnerCompanies(snap)
  );
}

function renderOwnerCompanies(snap) {
  const listEl = document.getElementById('owner-company-list');
  if (!snap.exists()) { listEl.innerHTML = '<p class="empty-msg">등록된 업체가 없습니다</p>'; return; }
  let html = '';
  snap.forEach(child => {
    const d = child.val();
    html += `<div class="list-item">
      <div class="list-item-info">
        <span class="list-item-name">${d.name}</span>
        <span class="list-item-code">${child.key}</span>
      </div>
      <button class="btn-icon-delete" onclick="deleteCompany('${child.key}','${d.name}')">🗑</button>
    </div>`;
  });
  listEl.innerHTML = html;
}

async function createCompany() {
  const name = document.getElementById('owner-company-name').value.trim();
  if (!name) { showToast('업체명을 입력하세요'); return; }
  const code = `C${Date.now().toString().slice(-8)}`;
  await window._set(window._firebaseRef(window._db, `customers/${currentCustomerId}/companies/${code}`), {
    name, createdAt: new Date().toISOString()
  });
  document.getElementById('owner-company-name').value = '';
  showToast(`✅ ${name}\n코드: ${code}`);
}

async function deleteCompany(code, name) {
  if (!confirm(`"${name}" 업체를 삭제하시겠습니까?`)) return;
  await window._remove(window._firebaseRef(window._db, `customers/${currentCustomerId}/companies/${code}`));
  await window._remove(window._firebaseRef(window._db, `customers/${currentCustomerId}/status/${code}`));
  showToast(`🗑 ${name} 삭제`);
}

function listenOwnerStatus() {
  if (_unsubscribeOwnerStatus) _unsubscribeOwnerStatus();
  _unsubscribeOwnerStatus = window._onValue(
    window._firebaseRef(window._db, `customers/${currentCustomerId}`),
    snap => {
      if (!snap.exists()) return;
      const d = snap.val();
      renderOwnerStatus(d.companies || {}, d.status || {});
    }
  );
}

function renderOwnerStatus(companies, statuses) {
  const listEl = document.getElementById('owner-status-list');
  const keys = Object.keys(companies);
  if (!keys.length) { listEl.innerHTML = '<p class="empty-msg">등록된 업체가 없습니다</p>'; return; }
  listEl.innerHTML = keys.map(code => {
    const comp = companies[code];
    const st = statuses[code] || {};
    const working = st.working === true;
    return `<div class="status-item">
      <div class="status-item-header">
        <span class="list-item-name">${comp.name}</span>
        <span class="${working ? 'status-dot-working' : 'status-dot-idle'}">${working ? '🟢 작업중' : '⚪ 대기중'}</span>
      </div>
      <div class="status-route ${st.route ? '' : 'empty'}">${st.route || '동선 미입력'}</div>
    </div>`;
  }).join('');
}

function listenOwnerArchive() {
  if (_unsubscribeOwnerArchive) _unsubscribeOwnerArchive();
  _unsubscribeOwnerArchive = window._onValue(
    window._firebaseRef(window._db, `customers/${currentCustomerId}/archives`),
    snap => {
      ownerArchiveAll = [];
      if (snap.exists()) {
        snap.forEach(compSnap => compSnap.forEach(archSnap => {
          ownerArchiveAll.push({ ...archSnap.val(), _archiveId: archSnap.key, _compCode: compSnap.key });
        }));
      }
      ownerArchiveAll.sort((a, b) => b.timestamp - a.timestamp);
      renderOwnerArchive(ownerArchiveAll);
    }
  );
}

function renderOwnerArchive(list) {
  const listEl = document.getElementById('owner-archive-list');
  if (!list.length) { listEl.innerHTML = '<p class="empty-msg">작업 내역이 없습니다</p>'; return; }
  listEl.innerHTML = list.map(item => {
    const pc = item.photoCount || {};
    const b = pc['전']||0, d = pc['중']||0, a = pc['후']||0;
    const safeStore = item.storeName.replace(/'/g, "\\'");
    return `<div class="archive-item">
      <div class="archive-item-header">
        <span class="archive-item-title">${item.storeName}</span>
        <span class="archive-item-date">${item.date}</span>
      </div>
      <div class="archive-company">${item.companyName || item.companyCode}</div>
      <div class="archive-item-meta">
        <span class="archive-badge ${b>0?'has-photos':''}">전 ${b}장</span>
        <span class="archive-badge ${d>0?'has-photos':''}">중 ${d}장</span>
        <span class="archive-badge ${a>0?'has-photos':''}">후 ${a}장</span>
      </div>
      <div class="archive-actions">
        <button class="btn-view-photos" onclick="viewArchivePhotos('${item._compCode}','${item._archiveId}','${safeStore}')">📂 보기</button>
        <button class="btn-view-photos btn-download-zip" onclick="downloadArchiveZip('${item._compCode}','${item._archiveId}','${safeStore}')">⬇ 다운로드</button>
        <button class="btn btn-sm btn-danger" onclick="deleteArchive('${item._compCode}','${item._archiveId}','${safeStore}')">삭제</button>
      </div>
    </div>`;
  }).join('');
}

function filterOwnerArchive() {
  const q = document.getElementById('owner-search').value.trim().toLowerCase();
  const d = document.getElementById('owner-date-filter').value;
  let list = ownerArchiveAll;
  if (q) list = list.filter(i => i.storeName.toLowerCase().includes(q));
  if (d) list = list.filter(i => i.date === d);
  renderOwnerArchive(list);
}

async function deleteArchive(compCode, archiveId, storeName) {
  if (!confirm(`"${storeName}" 작업 내역을 삭제하시겠습니까?`)) return;
  await window._remove(window._firebaseRef(window._db, `customers/${currentCustomerId}/archives/${compCode}/${archiveId}`));
  try {
    const base = `${currentCustomerId}/${compCode}/${archiveId}`;
    for (const phase of ['전','중','후']) {
      const res = await window._listAll(window._storageRef(window._storage, `${base}/${phase}`));
      for (const item of res.items) await window._deleteObject(item);
    }
  } catch (e) {}
  showToast('🗑 삭제 완료');
}

// ── ZIP 다운로드 ───────────────────────────
async function downloadArchiveZip(compCode, archiveId, storeName) {
  showLoading('ZIP 준비 중...');
  try {
    const JSZip = await loadJSZip();
    const base = `${currentCustomerId}/${compCode}/${archiveId}`;

    for (const phase of ['전','중','후']) {
      const phaseRef = window._storageRef(window._storage, `${base}/${phase}`);
      let res;
      try { res = await window._listAll(phaseRef); } catch (e) { continue; }
      if (!res.items.length) continue;

      showLoading(`${phase} 다운로드 중...`);
      const zip = new JSZip();
      const folder = zip.folder(`${storeName}_공사${phase}`);

      const urls = await Promise.all(res.items.map(item => window._getDownloadURL(item)));
      await Promise.all(urls.map(async (url, idx) => {
        const ext = url.includes('.jpg') ? 'jpg' : url.includes('.png') ? 'png' : 'jpg';
        const resp = await fetch(url);
        const blob = await resp.blob();
        folder.file(`${String(idx+1).padStart(3,'0')}.${ext}`, blob);
      }));

      const content = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = `${storeName}_공사${phase}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);

      // 파일 간 간격
      await new Promise(r => setTimeout(r, 500));
    }
    showToast('✅ 다운로드 완료 (전/중/후 각각 저장됨)');
  } catch (e) {
    console.error(e);
    showToast('⚠️ 다운로드 실패. 다시 시도해주세요.');
  } finally {
    hideLoading();
  }
}

// ══════════════════════════════════════════
// COMPANY
// ══════════════════════════════════════════
function initCompany() {
  switchCompanyTab('work');
  listenCompanyStatus();
}

function switchCompanyTab(tab) {
  ['work','archive'].forEach(t => document.getElementById(`company-tab-${t}`).classList.add('hidden'));
  document.getElementById(`company-tab-${tab}`).classList.remove('hidden');
  document.querySelectorAll('#section-company .tab-btn').forEach((b, i) => {
    b.classList.toggle('tab-active', ['work','archive'][i] === tab);
  });
  if (tab === 'archive') listenCompanyArchive();
}

function listenCompanyStatus() {
  if (_unsubscribeCompanyStatus) _unsubscribeCompanyStatus();
  _unsubscribeCompanyStatus = window._onValue(
    window._firebaseRef(window._db, `customers/${currentCustomerId}/status/${currentCompanyCode}`),
    snap => {
      if (!snap.exists()) return;
      const d = snap.val();
      document.getElementById('company-working-toggle').checked = d.working === true;
      updateWorkingUI(d.working === true);
      if (d.route) document.getElementById('company-route-input').value = d.route;
    }
  );
}

async function toggleWorking() {
  const working = document.getElementById('company-working-toggle').checked;
  await window._update(window._firebaseRef(window._db, `customers/${currentCustomerId}/status/${currentCompanyCode}`), {
    working, statusUpdated: new Date().toISOString()
  });
  updateWorkingUI(working);
}

function updateWorkingUI(working) {
  const txt = document.getElementById('company-status-text');
  txt.textContent = working ? '🟢 작업중' : '⚪ 대기중';
  txt.className = `status-text ${working ? 'status-working' : 'status-idle'}`;
}

async function saveRoute() {
  const route = document.getElementById('company-route-input').value.trim();
  await window._update(window._firebaseRef(window._db, `customers/${currentCustomerId}/status/${currentCompanyCode}`), {
    route, routeUpdated: new Date().toISOString()
  });
  showToast('✅ 동선 저장 완료');
}

// ── 사진 작업 ─────────────────────────────
let currentPhase = 'before';

function switchPhase(phase) {
  currentPhase = phase;
  ['before','during','after'].forEach(p => document.getElementById(`phase-${p}`).classList.toggle('hidden', p !== phase));
  document.querySelectorAll('.phase-btn').forEach((b, i) => {
    b.classList.toggle('phase-active', ['before','during','after'][i] === phase);
  });
}

function addPhotos(phase, input) {
  Array.from(input.files).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => { photos[phase].push({ file, dataUrl: e.target.result }); renderPhotoGrid(phase); };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function renderPhotoGrid(phase) {
  document.getElementById(`preview-${phase}`).innerHTML = photos[phase].map((p, i) => `
    <div class="photo-thumb">
      <img src="${p.dataUrl}" loading="lazy" />
      <button class="photo-delete" onclick="removePhoto('${phase}',${i})">✕</button>
    </div>`).join('');
  document.getElementById(`count-${phase}`).textContent = `${photos[phase].length}장`;
}

function removePhoto(phase, idx) { photos[phase].splice(idx, 1); renderPhotoGrid(phase); }

function clearPhase(phase) {
  const label = {before:'전',during:'중',after:'후'}[phase];
  if (!photos[phase].length) return;
  if (!confirm(`${label} 단계 사진 ${photos[phase].length}장을 모두 삭제하시겠습니까?`)) return;
  photos[phase] = []; renderPhotoGrid(phase);
}

function resetPhotoUI() {
  ['before','during','after'].forEach(p => {
    photos[p] = [];
    const g = document.getElementById(`preview-${p}`);
    const c = document.getElementById(`count-${p}`);
    if (g) g.innerHTML = '';
    if (c) c.textContent = '0장';
  });
}

async function completeWork() {
  const storeName = document.getElementById('company-store-name').value.trim();
  if (!storeName) { showToast('매장명을 입력하세요'); return; }
  const total = photos.before.length + photos.during.length + photos.after.length;
  if (total === 0) { showToast('업로드할 사진이 없습니다'); return; }

  const btn = document.getElementById('btn-complete');
  btn.disabled = true; btn.textContent = '업로드 중...';
  const progressWrap = document.getElementById('upload-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  progressWrap.classList.remove('hidden');

  const archiveId = `${today()}_${Date.now()}`;
  const base = `${currentCustomerId}/${currentCompanyCode}/${archiveId}`;
  let uploaded = 0;
  const photoCount = {'전':0,'중':0,'후':0};

  try {
    for (const {key,label} of [{key:'before',label:'전'},{key:'during',label:'중'},{key:'after',label:'후'}]) {
      for (const photo of photos[key]) {
        const ref = window._storageRef(window._storage, `${base}/${label}/${Date.now()}_${photo.file.name}`);
        await window._uploadBytes(ref, photo.file);
        uploaded++; photoCount[label]++;
        progressFill.style.width = Math.round((uploaded/total)*100)+'%';
        progressText.textContent = `업로드 중... ${uploaded}/${total}장`;
      }
    }
    await window._set(
      window._firebaseRef(window._db, `customers/${currentCustomerId}/archives/${currentCompanyCode}/${archiveId}`),
      { storeName, date: today(), timestamp: Date.now(), companyCode: currentCompanyCode, companyName: currentCompanyName, photoCount }
    );
    showToast(`✅ 저장 완료!\n전 ${photoCount['전']}장 / 중 ${photoCount['중']}장 / 후 ${photoCount['후']}장`);
    document.getElementById('company-store-name').value = '';
    resetPhotoUI(); switchPhase('before');
  } catch (err) {
    console.error(err); showToast('⚠️ 업로드 실패. 다시 시도해주세요.');
  } finally {
    btn.disabled = false; btn.textContent = '✅ 작업 완료 저장';
    progressWrap.classList.add('hidden'); progressFill.style.width = '0%';
  }
}

// ── 내 보관함 ─────────────────────────────
function listenCompanyArchive() {
  if (_unsubscribeCompanyArchive) _unsubscribeCompanyArchive();
  _unsubscribeCompanyArchive = window._onValue(
    window._firebaseRef(window._db, `customers/${currentCustomerId}/archives/${currentCompanyCode}`),
    snap => {
      companyArchiveAll = [];
      if (snap.exists()) snap.forEach(child => companyArchiveAll.push({ ...child.val(), _archiveId: child.key }));
      companyArchiveAll.sort((a, b) => b.timestamp - a.timestamp);
      renderCompanyArchive(companyArchiveAll);
    }
  );
}

function renderCompanyArchive(list) {
  const listEl = document.getElementById('company-archive-list');
  if (!list.length) { listEl.innerHTML = '<p class="empty-msg">작업 내역이 없습니다</p>'; return; }
  listEl.innerHTML = list.map(item => {
    const pc = item.photoCount || {};
    const b = pc['전']||0, d = pc['중']||0, a = pc['후']||0;
    const safeStore = item.storeName.replace(/'/g, "\\'");
    return `<div class="archive-item">
      <div class="archive-item-header">
        <span class="archive-item-title">${item.storeName}</span>
        <span class="archive-item-date">${item.date}</span>
      </div>
      <div class="archive-item-meta">
        <span class="archive-badge ${b>0?'has-photos':''}">전 ${b}장</span>
        <span class="archive-badge ${d>0?'has-photos':''}">중 ${d}장</span>
        <span class="archive-badge ${a>0?'has-photos':''}">후 ${a}장</span>
      </div>
      <div class="archive-actions">
        <button class="btn-view-photos" onclick="viewArchivePhotos('${currentCompanyCode}','${item._archiveId}','${safeStore}')">📂 보기</button>
        <button class="btn-view-photos btn-download-zip" onclick="downloadArchiveZip('${currentCompanyCode}','${item._archiveId}','${safeStore}')">⬇ 다운로드</button>
        <button class="btn btn-sm btn-danger" onclick="deleteMyArchive('${item._archiveId}','${safeStore}')">삭제</button>
      </div>
    </div>`;
  }).join('');
}

function filterCompanyArchive() {
  const q = document.getElementById('company-search').value.trim().toLowerCase();
  const d = document.getElementById('company-date-filter').value;
  let list = companyArchiveAll;
  if (q) list = list.filter(i => i.storeName.toLowerCase().includes(q));
  if (d) list = list.filter(i => i.date === d);
  renderCompanyArchive(list);
}

async function deleteMyArchive(archiveId, storeName) {
  if (!confirm(`"${storeName}" 작업 내역을 삭제하시겠습니까?`)) return;
  await window._remove(window._firebaseRef(window._db, `customers/${currentCustomerId}/archives/${currentCompanyCode}/${archiveId}`));
  try {
    const base = `${currentCustomerId}/${currentCompanyCode}/${archiveId}`;
    for (const phase of ['전','중','후']) {
      const res = await window._listAll(window._storageRef(window._storage, `${base}/${phase}`));
      for (const item of res.items) await window._deleteObject(item);
    }
  } catch (e) {}
  showToast('🗑 삭제 완료');
}

// ── 사진 보기 모달 ────────────────────────
async function viewArchivePhotos(compCode, archiveId, storeName) {
  const modal = document.getElementById('photo-modal');
  const titleEl = document.getElementById('modal-archive-title');
  const photosEl = document.getElementById('modal-photos');
  titleEl.textContent = storeName;
  photosEl.innerHTML = '<p class="empty-msg">사진 불러오는 중...</p>';
  modal.classList.remove('hidden');

  const base = `${currentCustomerId}/${compCode}/${archiveId}`;
  let html = '';
  for (const phase of ['전','중','후']) {
    try {
      const res = await window._listAll(window._storageRef(window._storage, `${base}/${phase}`));
      if (!res.items.length) continue;
      const urls = await Promise.all(res.items.map(item => window._getDownloadURL(item)));
      html += `<div>
        <div class="modal-phase-label">${phase} (${urls.length}장)</div>
        <div class="modal-grid">
          ${urls.map(url => `<img src="${url}" loading="lazy" onclick="window.open('${url}','_blank')" style="cursor:pointer" />`).join('')}
        </div>
      </div>`;
    } catch (e) {}
  }
  photosEl.innerHTML = html || '<p class="empty-msg">저장된 사진이 없습니다</p>';
}

function closePhotoModal() {
  document.getElementById('photo-modal').classList.add('hidden');
  document.getElementById('modal-photos').innerHTML = '';
}

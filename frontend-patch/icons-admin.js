// admin.js — Full MyJournal+ Admin Dashboard
// Features: KPIs, users CRUD actions, referrals, devices, in-app messages, FCM queue,
// premium/promos, feature flags, app slots, content meta, AI config, queues, audit, import/export

const firebaseConfig = {
  apiKey: "AIzaSyAtzbIZvFLQM65QhOwph0PFpO9vOYcYUdE",
  authDomain: "myjournal-plus.firebaseapp.com",
  projectId: "myjournal-plus",
  storageBucket: "myjournal-plus.firebasestorage.app",
  messagingSenderId: "288260274583",
  appId: "1:288260274583:web:9c40aafed9ab9fa30e6cd2",
  measurementId: "G-MXJ84MJGTR"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
let functions = null;
try { functions = firebase.functions(); } catch (e) { console.warn('Functions unavailable', e); }

let currentAdmin = null;
let usersCache = [];
let lastVisible = null;
let pageSize = 40;
let selectedUids = new Set();
let selectedUser = null;
let hasMore = false;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from((r || document).querySelectorAll(s));

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function formatDate(ts) {
  if (!ts) return '—';
  try {
    if (ts.toDate) return ts.toDate().toLocaleString();
    if (typeof ts === 'string' || typeof ts === 'number') return new Date(ts).toLocaleString();
  } catch (e) {}
  return '—';
}

async function logAdmin(action, details = {}) {
  try {
    await db.collection('admins').doc('activity').collection('logs').add({
      action,
      details,
      adminUid: currentAdmin?.uid || null,
      adminEmail: currentAdmin?.email || null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) { console.warn('logAdmin', e); }
}

// ---------- Auth ----------
async function verifyAdmin(user) {
  if (!user) return false;
  const snap = await db.collection('users').doc(user.uid).get();
  if (!snap.exists) return false;
  const roles = snap.data().roles || [];
  const isAdmin = Array.isArray(roles) ? roles.includes('admin') : !!snap.data().isAdmin;
  return isAdmin;
}

$('#btnAdminLogin').addEventListener('click', async () => {
  const email = ($('#adminEmail').value || '').trim();
  const password = ($('#adminPassword').value || '').trim();
  $('#loginError').textContent = '';
  if (!email || !password) { $('#loginError').textContent = 'Enter email and password'; return; }
  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const ok = await verifyAdmin(cred.user);
    if (!ok) {
      await auth.signOut();
      $('#loginError').textContent = 'Not an admin account';
      return;
    }
    currentAdmin = cred.user;
    enterApp();
  } catch (err) {
    $('#loginError').textContent = err.message || 'Sign-in failed';
  }
});

$('#btnSignOut').addEventListener('click', async () => {
  await logAdmin('sign_out');
  await auth.signOut();
  location.reload();
});

auth.onAuthStateChanged(async (u) => {
  if (!u) return;
  const ok = await verifyAdmin(u);
  if (!ok) return;
  currentAdmin = u;
  enterApp();
});

function enterApp() {
  $('#loginScreen').classList.add('hidden');
  $('#appShell').classList.add('ready');
  $('#adminIdentity').textContent = currentAdmin.email || currentAdmin.uid;
  loadOverview();
  loadUsers({ reset: true });
}

// ---------- Navigation ----------
const titles = {
  overview: 'Dashboard', users: 'Users', referrals: 'Referrals', devices: 'Devices',
  messages: 'In-app Messages', fcm: 'FCM Center', premium: 'Premium', promos: 'Promo Codes',
  features: 'Feature Flags', slots: 'App Slots', content: 'Content', ai: 'AI Insights',
  queues: 'Queues', logs: 'Audit Log', export: 'Import / Export'
};

$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const p = btn.dataset.panel;
    $$('.panel').forEach(x => x.classList.remove('active'));
    const panel = $('#panel-' + p);
    if (panel) panel.classList.add('active');
    $('#pageTitle').textContent = titles[p] || p;
    document.body.classList.remove('sidebar-open');
    if (p === 'overview') loadOverview();
    if (p === 'referrals') loadReferrals();
    if (p === 'devices') loadDevicesGlobal();
    if (p === 'fcm') loadFcmQueue();
    if (p === 'promos') loadPromos();
    if (p === 'features') loadFlags();
    if (p === 'slots') loadSlots();
    if (p === 'ai') loadAiConfig();
    if (p === 'queues') loadQueues();
    if (p === 'logs') loadLogs();
  });
});

$('#mobileMenuBtn')?.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
$('#btnRefreshAll').addEventListener('click', () => {
  loadOverview();
  loadUsers({ reset: true });
  toast('Refreshed');
});

// ---------- Overview / KPIs ----------
async function loadOverview() {
  try {
    const snap = await db.collection('users').limit(500).get();
    let total = 0, prem = 0, free = 0, new7 = 0, fcm = 0, refs = 0, susp = 0, pin = 0;
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    snap.forEach(doc => {
      total++;
      const d = doc.data();
      if (d.isPremium) prem++; else free++;
      if (d.suspended) susp++;
      if (d.pinEnabled) pin++;
      if (d.fcmTokens && d.fcmTokens.length) fcm++;
      refs += (d.referralCount || 0);
      let created = d.createdAt?.toDate?.() || (d.createdAt ? new Date(d.createdAt) : null);
      if (created && created.getTime() >= weekAgo) new7++;
    });
    $('#kpiTotal').textContent = total;
    $('#kpiPremium').textContent = prem;
    $('#kpiFree').textContent = free;
    $('#kpiNew7').textContent = new7;
    $('#kpiFcm').textContent = fcm;
    $('#kpiRef').textContent = refs;
    $('#kpiSusp').textContent = susp;
    $('#kpiPin').textContent = pin;

    const logs = await db.collection('admins').doc('activity').collection('logs')
      .orderBy('createdAt', 'desc').limit(20).get();
    const box = $('#overviewLog');
    if (logs.empty) { box.innerHTML = '<div class="empty">No activity yet</div>'; return; }
    box.innerHTML = logs.docs.map(d => {
      const x = d.data();
      return `<div class="log-line">${formatDate(x.createdAt)} · ${x.adminEmail || x.adminUid || '?'} · <b>${x.action}</b> ${JSON.stringify(x.details || {}).slice(0, 80)}</div>`;
    }).join('');
  } catch (e) {
    console.error(e);
    toast('Failed to load overview');
  }
}

// ---------- Users ----------
async function loadUsers({ reset = false } = {}) {
  try {
    if (reset) { lastVisible = null; usersCache = []; selectedUids.clear(); }
    let q = db.collection('users').orderBy('createdAt', 'desc').limit(pageSize);
    if (lastVisible) q = q.startAfter(lastVisible);
    const snap = await q.get();
    if (reset) usersCache = [];
    snap.forEach(doc => usersCache.push({ id: doc.id, data: doc.data() }));
    lastVisible = snap.docs.length ? snap.docs[snap.docs.length - 1] : lastVisible;
    hasMore = snap.docs.length === pageSize;
    $('#nextPage').disabled = !hasMore;
    $('#prevPage').disabled = true; // simplified pagination
    renderUsers();
  } catch (e) {
    console.error(e);
    toast('Failed to load users');
  }
}

function filteredUsers() {
  const q = ($('#userSearch').value || '').toLowerCase().trim();
  const f = $('#filterPremium').value;
  return usersCache.filter(u => {
    const d = u.data;
    if (q) {
      const hay = `${d.email || ''} ${d.username || ''} ${u.id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f === 'premium' && !d.isPremium) return false;
    if (f === 'free' && d.isPremium) return false;
    if (f === 'suspended' && !d.suspended) return false;
    if (f === 'hasFcm' && !(d.fcmTokens && d.fcmTokens.length)) return false;
    if (f === 'hasPin' && !d.pinEnabled) return false;
    return true;
  });
}

function renderUsers() {
  const list = filteredUsers();
  const tb = $('#usersTbody');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="7" class="empty">No users</td></tr>';
    $('#usersCount').textContent = '0 users';
    return;
  }
  tb.innerHTML = list.map(u => {
    const d = u.data;
    const status = d.suspended ? '<span class="pill susp">Suspended</span>' : (d.deleted ? '<span class="pill susp">Deleted</span>' : '<span class="pill ok">Active</span>');
    const prem = d.isPremium ? '<span class="pill prem">Premium</span>' : '<span class="pill free">Free</span>';
    return `<tr data-uid="${u.id}">
      <td><input type="checkbox" class="row-select" data-uid="${u.id}" ${selectedUids.has(u.id) ? 'checked' : ''} /></td>
      <td><div style="font-weight:600">${esc(d.username || '(no name)')}</div>
          <div class="small-muted">${esc(d.email || u.id)}</div></td>
      <td>${prem}</td>
      <td>${d.referralCount || 0}</td>
      <td class="small-muted">${formatDate(d.createdAt)}</td>
      <td>${status}</td>
      <td><button class="btn small select-user-btn" data-uid="${u.id}">Select</button></td>
    </tr>`;
  }).join('');
  $('#usersCount').textContent = `${list.length} shown / ${usersCache.length} loaded`;

  $$('.row-select').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedUids.add(cb.dataset.uid);
      else selectedUids.delete(cb.dataset.uid);
    });
  });
  $$('.select-user-btn').forEach(btn => {
    btn.addEventListener('click', () => selectUser(btn.dataset.uid));
  });
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function selectUser(uid) {
  selectedUser = usersCache.find(u => u.id === uid) || null;
  const area = $('#selectedUserArea');
  const controls = $('#selectedUserControls');
  if (!selectedUser) {
    area.textContent = 'User not in cache';
    controls.classList.add('hidden');
    controls.style.display = 'none';
    return;
  }
  const d = selectedUser.data;
  area.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px">${esc(d.username || '—')}</div>
    <div class="small-muted">${esc(d.email || '')}</div>
    <div class="small-muted" style="margin-top:6px">UID: <code style="font-size:11px">${uid}</code></div>
    <div style="margin-top:8px">${d.isPremium ? '<span class="pill prem">Premium</span>' : '<span class="pill free">Free</span>'}
      ${d.suspended ? ' <span class="pill susp">Suspended</span>' : ''}</div>
    <div class="small-muted" style="margin-top:8px">Referrals: ${d.referralCount || 0} · Devices: ${(d.devices || []).length} · FCM tokens: ${(d.fcmTokens || []).length}</div>`;
  controls.classList.remove('hidden');
  controls.style.display = 'flex';
}

$('#userSearch').addEventListener('input', renderUsers);
$('#filterPremium').addEventListener('change', renderUsers);
$('#btnRefreshUsers').addEventListener('click', () => loadUsers({ reset: true }));
$('#nextPage').addEventListener('click', () => loadUsers({ reset: false }));
$('#selectAllCheckbox').addEventListener('change', (e) => {
  const on = e.target.checked;
  filteredUsers().forEach(u => { if (on) selectedUids.add(u.id); else selectedUids.delete(u.id); });
  renderUsers();
});

// User actions
$('#btnViewUser').addEventListener('click', () => {
  if (!selectedUser) return;
  openUserModal(selectedUser);
});

function openUserModal(u) {
  const d = u.data;
  $('#modalTitle').textContent = d.username || d.email || u.id;
  const devices = (d.devices || []).map(dev => {
    const loc = dev.location || {};
    const locStr = loc.city || loc.country ? `${loc.city || ''} ${loc.country || ''}` : (loc.lat ? `${loc.lat}, ${loc.lng}` : 'n/a');
    return `<div class="device-row"><div><b>${esc(dev.label || 'Device')}</b><div class="small-muted">${esc(locStr)} · ${esc(String(dev.lastActive || ''))}</div></div>
      <button class="btn small danger force-dev" data-id="${esc(dev.deviceId || '')}">Force logout</button></div>`;
  }).join('') || '<div class="empty">No devices</div>';

  $('#modalBody').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
      <div><b>Email</b><div class="small-muted">${esc(d.email)}</div></div>
      <div><b>UID</b><div class="small-muted"><code>${u.id}</code></div></div>
      <div><b>Premium</b><div>${d.isPremium ? 'Yes' : 'No'} ${d.premiumSource ? '(' + esc(d.premiumSource) + ')' : ''}</div></div>
      <div><b>Roles</b><div class="small-muted">${esc((d.roles || []).join(', ') || '—')}</div></div>
      <div><b>Referral code</b><div class="small-muted">${esc(d.referralCode || '—')}</div></div>
      <div><b>Referral count</b><div>${d.referralCount || 0}</div></div>
      <div><b>Referred by</b><div class="small-muted">${esc(d.referredBy || '—')}</div></div>
      <div><b>PIN</b><div>${d.pinEnabled ? 'Enabled (' + esc(d.pinLockMode || 'immediate') + ')' : 'Off'}</div></div>
      <div><b>Theme</b><div class="small-muted">${esc(d.appTheme || 'default')} / ${esc(d.bgStyle || 'gradient')}</div></div>
      <div><b>Created</b><div class="small-muted">${formatDate(d.createdAt)}</div></div>
    </div>
    <h4 style="margin:18px 0 8px;font-size:14px">Devices</h4>
    ${devices}
    <h4 style="margin:18px 0 8px;font-size:14px">FCM tokens</h4>
    <div class="small-muted" style="word-break:break-all">${(d.fcmTokens || []).length ? (d.fcmTokens || []).map(t => esc(String(t).slice(0, 40) + '…')).join('<br>') : 'None'}</div>`;
  $('#userModal').classList.remove('hidden');

  $$('.force-dev').forEach(btn => {
    btn.addEventListener('click', async () => {
      const did = btn.dataset.id;
      if (!did || !confirm('Force logout this device?')) return;
      try {
        await db.collection('users').doc(u.id).set({
          forceLogoutDevices: firebase.firestore.FieldValue.arrayUnion(did)
        }, { merge: true });
        await logAdmin('force_logout_device', { target: u.id, deviceId: did });
        toast('Device logout queued');
      } catch (e) { toast('Failed'); }
    });
  });
}

$('#modalClose').addEventListener('click', () => $('#userModal').classList.add('hidden'));

$('#btnTogglePremium').addEventListener('click', async () => {
  if (!selectedUser) return;
  const newVal = !selectedUser.data.isPremium;
  if (!confirm(`${newVal ? 'Grant' : 'Revoke'} premium?`)) return;
  await db.collection('users').doc(selectedUser.id).update({
    isPremium: newVal,
    premiumSource: 'admin',
    premiumUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  selectedUser.data.isPremium = newVal;
  await logAdmin('toggle_premium', { target: selectedUser.id, newVal });
  toast(newVal ? 'Premium granted' : 'Premium revoked');
  renderUsers();
  selectUser(selectedUser.id);
});

$('#btnEditRoles').addEventListener('click', async () => {
  if (!selectedUser) return;
  const cur = (selectedUser.data.roles || []).join(', ');
  const next = prompt('Roles (comma-separated)', cur);
  if (next === null) return;
  const roles = next.split(',').map(x => x.trim()).filter(Boolean);
  await db.collection('users').doc(selectedUser.id).update({ roles });
  selectedUser.data.roles = roles;
  await logAdmin('edit_roles', { target: selectedUser.id, roles });
  toast('Roles updated');
});

$('#btnResetPin').addEventListener('click', async () => {
  if (!selectedUser || !confirm('Reset PIN for this user?')) return;
  await db.collection('users').doc(selectedUser.id).update({
    pinEnabled: false,
    pinHash: firebase.firestore.FieldValue.delete(),
    pinResetAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await logAdmin('reset_pin', { target: selectedUser.id });
  toast('PIN reset');
});

$('#btnForceLogoutAll').addEventListener('click', async () => {
  if (!selectedUser || !confirm('Force logout ALL devices for this user?')) return;
  const devices = selectedUser.data.devices || [];
  const ids = devices.map(d => d.deviceId).filter(Boolean);
  if (!ids.length) { toast('No devices recorded'); return; }
  await db.collection('users').doc(selectedUser.id).set({
    forceLogoutDevices: firebase.firestore.FieldValue.arrayUnion(...ids)
  }, { merge: true });
  await logAdmin('force_logout_all', { target: selectedUser.id, count: ids.length });
  toast('Force logout queued for all devices');
});

$('#btnCreateMessage').addEventListener('click', async () => {
  if (!selectedUser) return;
  const title = prompt('Message title', 'Message from MyJournal+');
  if (title === null) return;
  const body = prompt('Message body', '');
  if (body === null) return;
  await db.collection('users').doc(selectedUser.id).collection('messages').add({
    title, body, read: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    fromAdmin: currentAdmin.uid
  });
  await logAdmin('in_app_message', { target: selectedUser.id, title });
  toast('Message sent');
});

$('#btnSendResetEmail').addEventListener('click', async () => {
  if (!selectedUser?.data?.email) return toast('No email');
  try {
    await auth.sendPasswordResetEmail(selectedUser.data.email);
    await logAdmin('password_reset_email', { target: selectedUser.id });
    toast('Reset email sent');
  } catch (e) { toast(e.message || 'Failed'); }
});

$('#btnExportUser').addEventListener('click', async () => {
  if (!selectedUser) return;
  const uid = selectedUser.id;
  const entries = await db.collection('users').doc(uid).collection('entries').limit(500).get();
  const moods = await db.collection('users').doc(uid).collection('moods').limit(500).get().catch(() => ({ docs: [] }));
  const payload = {
    user: { id: uid, ...selectedUser.data },
    entries: entries.docs.map(d => ({ id: d.id, ...d.data() })),
    moods: moods.docs.map(d => ({ id: d.id, ...d.data() }))
  };
  downloadJson(`user-${uid}.json`, payload);
  await logAdmin('export_user', { target: uid });
  toast('Exported');
});

$('#btnSuspendUser').addEventListener('click', async () => {
  if (!selectedUser) return;
  const reason = prompt('Suspension reason', '') || '';
  await db.collection('users').doc(selectedUser.id).update({
    suspended: true, suspendedReason: reason,
    suspendedBy: currentAdmin.uid,
    suspendedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  selectedUser.data.suspended = true;
  await logAdmin('suspend_user', { target: selectedUser.id, reason });
  toast('User suspended');
  renderUsers(); selectUser(selectedUser.id);
});

$('#btnUnsuspendUser').addEventListener('click', async () => {
  if (!selectedUser) return;
  await db.collection('users').doc(selectedUser.id).update({
    suspended: firebase.firestore.FieldValue.delete(),
    suspendedReason: firebase.firestore.FieldValue.delete(),
    suspendedBy: firebase.firestore.FieldValue.delete(),
    suspendedAt: firebase.firestore.FieldValue.delete()
  });
  selectedUser.data.suspended = false;
  await logAdmin('unsuspend_user', { target: selectedUser.id });
  toast('User unsuspended');
  renderUsers(); selectUser(selectedUser.id);
});

$('#btnSoftDelete').addEventListener('click', async () => {
  if (!selectedUser || !confirm('Soft-delete this user?')) return;
  await db.collection('users').doc(selectedUser.id).update({
    deleted: true, deletedBy: currentAdmin.uid,
    deletedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await logAdmin('soft_delete', { target: selectedUser.id });
  toast('Soft deleted');
  loadUsers({ reset: true });
});

$('#btnHardDelete').addEventListener('click', async () => {
  if (!selectedUser || !confirm('Queue HARD delete (Auth + data)? Requires Cloud Function.')) return;
  await db.collection('admin_requests').add({
    type: 'hard_delete_user',
    targetUid: selectedUser.id,
    requestedBy: currentAdmin.uid,
    status: 'pending',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await logAdmin('request_hard_delete', { target: selectedUser.id });
  toast('Hard delete requested');
});

// Bulk
$('#bulkSuspendBtn').addEventListener('click', async () => {
  if (!selectedUids.size || !confirm(`Suspend ${selectedUids.size} users?`)) return;
  const batch = db.batch();
  selectedUids.forEach(uid => {
    batch.update(db.collection('users').doc(uid), {
      suspended: true, suspendedBy: currentAdmin.uid,
      suspendedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  });
  await batch.commit();
  await logAdmin('bulk_suspend', { count: selectedUids.size });
  toast('Suspended');
  loadUsers({ reset: true });
});

$('#bulkPremiumBtn').addEventListener('click', async () => {
  if (!selectedUids.size || !confirm(`Grant Premium to ${selectedUids.size} users?`)) return;
  const batch = db.batch();
  selectedUids.forEach(uid => {
    batch.update(db.collection('users').doc(uid), {
      isPremium: true, premiumSource: 'admin_bulk',
      premiumUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  });
  await batch.commit();
  await logAdmin('bulk_premium', { count: selectedUids.size });
  toast('Premium granted');
  loadUsers({ reset: true });
});

$('#bulkMessageBtn').addEventListener('click', async () => {
  if (!selectedUids.size) return toast('Select users first');
  const title = prompt('Title', 'Message from MyJournal+');
  if (title === null) return;
  const body = prompt('Body', '');
  if (body === null) return;
  let n = 0;
  for (const uid of selectedUids) {
    await db.collection('users').doc(uid).collection('messages').add({
      title, body, read: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      fromAdmin: currentAdmin.uid
    });
    n++;
  }
  await logAdmin('bulk_message', { count: n, title });
  toast(`Sent to ${n} users`);
});

// Create user modal
$('#openCreateUserBtn').addEventListener('click', () => $('#createUserModal').classList.remove('hidden'));
$('#createUserClose').addEventListener('click', () => $('#createUserModal').classList.add('hidden'));

$('#createUserQueueBtn').addEventListener('click', async () => {
  const email = ($('#newUserEmail').value || '').trim();
  const username = ($('#newUserUsername').value || '').trim();
  const password = ($('#newUserPassword').value || '').trim();
  if (!email) return toast('Email required');
  await db.collection('admin_requests').add({
    type: 'create_user',
    email, username, password: password || null,
    sendReset: !!$('#newUserSendReset').checked,
    requestedBy: currentAdmin.uid,
    status: 'pending',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  $('#createUserStatus').textContent = 'Queued in admin_requests';
  await logAdmin('queue_create_user', { email });
  toast('Create-user request queued');
});

$('#createUserBtn').addEventListener('click', async () => {
  const email = ($('#newUserEmail').value || '').trim();
  const username = ($('#newUserUsername').value || '').trim();
  const password = ($('#newUserPassword').value || '').trim();
  if (!email) return toast('Email required');
  if (!functions) { $('#createUserStatus').textContent = 'Functions not available — use Queue'; return; }
  try {
    const fn = functions.httpsCallable('adminCreateUser');
    const res = await fn({ email, username, password: password || undefined, sendReset: !!$('#newUserSendReset').checked });
    $('#createUserStatus').textContent = 'Created: ' + JSON.stringify(res.data);
    await logAdmin('create_user_callable', { email });
    toast('User created');
  } catch (e) {
    $('#createUserStatus').textContent = e.message || 'Callable failed';
  }
});

// ---------- Referrals ----------
async function loadReferrals() {
  const snap = await db.collection('users').orderBy('referralCount', 'desc').limit(50).get();
  const tb = $('#refsTbody');
  if (snap.empty) { tb.innerHTML = '<tr><td colspan="5" class="empty">None</td></tr>'; return; }
  tb.innerHTML = snap.docs.map(doc => {
    const d = doc.data();
    return `<tr>
      <td>${esc(d.username || d.email || doc.id)}</td>
      <td><code>${esc(d.referralCode || '—')}</code></td>
      <td>${d.referralCount || 0}</td>
      <td>${d.isPremium ? '<span class="pill prem">Yes</span>' : '<span class="pill free">No</span>'}</td>
      <td><button class="btn small grant-ref" data-uid="${doc.id}" data-count="${d.referralCount || 0}">Set count / unlock</button></td>
    </tr>`;
  }).join('');
  $$('.grant-ref').forEach(btn => {
    btn.addEventListener('click', async () => {
      const n = prompt('New referral count', btn.dataset.count);
      if (n === null) return;
      const count = parseInt(n, 10) || 0;
      const upd = { referralCount: count };
      if (count >= 3) { upd.isPremium = true; upd.premiumSource = 'referral_admin'; }
      await db.collection('users').doc(btn.dataset.uid).update(upd);
      await logAdmin('adjust_referral', { target: btn.dataset.uid, count });
      toast('Updated');
      loadReferrals();
    });
  });
}
$('#btnRefreshRefs')?.addEventListener('click', loadReferrals);

// ---------- Devices global ----------
async function loadDevicesGlobal() {
  const snap = await db.collection('users').limit(100).get();
  const rows = [];
  snap.forEach(doc => {
    const d = doc.data();
    (d.devices || []).forEach(dev => {
      rows.push({ uid: doc.id, user: d.username || d.email || doc.id, ...dev });
    });
  });
  rows.sort((a, b) => String(b.lastActive || '').localeCompare(String(a.lastActive || '')));
  const box = $('#devicesGlobalList');
  if (!rows.length) { box.innerHTML = '<div class="empty">No devices recorded</div>'; return; }
  box.innerHTML = rows.slice(0, 80).map(r => {
    const loc = r.location || {};
    const locStr = loc.city || loc.country ? `${loc.city || ''} ${loc.country || ''}` : 'n/a';
    return `<div class="device-row">
      <div><b>${esc(r.label || 'Device')}</b> · ${esc(r.user)}
        <div class="small-muted">${esc(locStr)} · ${esc(String(r.lastActive || ''))}</div></div>
      <button class="btn small danger g-force" data-uid="${r.uid}" data-id="${esc(r.deviceId || '')}">Logout</button>
    </div>`;
  }).join('');
  $$('.g-force').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!btn.dataset.id || !confirm('Force logout?')) return;
      await db.collection('users').doc(btn.dataset.uid).set({
        forceLogoutDevices: firebase.firestore.FieldValue.arrayUnion(btn.dataset.id)
      }, { merge: true });
      toast('Queued');
    });
  });
}
$('#btnRefreshDevices')?.addEventListener('click', loadDevicesGlobal);

// ---------- In-app messages ----------
$('#btnSendInApp').addEventListener('click', async () => {
  const title = ($('#msgTitle').value || '').trim();
  const body = ($('#msgBody').value || '').trim();
  const target = $('#msgTarget').value;
  if (!title || !body) return toast('Title and body required');
  let uids = [];
  if (target === 'selected') uids = [...selectedUids];
  else if (target === 'uids') uids = ($('#msgUids').value || '').split(',').map(s => s.trim()).filter(Boolean);
  else {
    const snap = await db.collection('users').limit(500).get();
    snap.forEach(doc => {
      const d = doc.data();
      if (target === 'premium' && !d.isPremium) return;
      if (target === 'free' && d.isPremium) return;
      uids.push(doc.id);
    });
  }
  if (!uids.length) return toast('No targets');
  $('#msgStatus').textContent = `Sending to ${uids.length}…`;
  let n = 0;
  for (const uid of uids) {
    await db.collection('users').doc(uid).collection('messages').add({
      title, body, read: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      fromAdmin: currentAdmin.uid
    });
    n++;
  }
  await logAdmin('broadcast_in_app', { count: n, title, target });
  $('#msgStatus').textContent = `Sent to ${n} users`;
  toast('Messages sent');
});

// ---------- FCM ----------
$('#sendFcmBtn').addEventListener('click', async () => {
  const title = ($('#fcmTitle').value || '').trim();
  const body = ($('#fcmBody').value || '').trim();
  if (!title || !body) return toast('Title and body required');
  const targetType = $('#fcmTargetType').value;
  const uids = ($('#fcmTargetUids').value || '').split(',').map(s => s.trim()).filter(Boolean);
  await db.collection('fcm_requests').add({
    title, body,
    image: ($('#fcmImage').value || '').trim() || null,
    targetType, targetUids: uids,
    status: 'pending',
    requestedBy: currentAdmin.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await logAdmin('queue_fcm', { title, targetType });
  $('#fcmStatus').textContent = 'Queued in fcm_requests';
  toast('FCM queued');
  loadFcmQueue();
});

$('#sendFcmFnBtn').addEventListener('click', async () => {
  if (!functions) return toast('Functions not available');
  try {
    const fn = functions.httpsCallable('adminSendFcm');
    const res = await fn({
      title: $('#fcmTitle').value,
      body: $('#fcmBody').value,
      targetType: $('#fcmTargetType').value,
      targetUids: ($('#fcmTargetUids').value || '').split(',').map(s => s.trim()).filter(Boolean),
      image: $('#fcmImage').value || null
    });
    $('#fcmStatus').textContent = JSON.stringify(res.data);
    toast('Callable invoked');
  } catch (e) {
    $('#fcmStatus').textContent = e.message || 'Failed';
  }
});

async function loadFcmQueue() {
  const snap = await db.collection('fcm_requests').orderBy('createdAt', 'desc').limit(20).get();
  const box = $('#fcmQueueList');
  if (snap.empty) { box.innerHTML = '<div class="empty">Empty</div>'; return; }
  box.innerHTML = snap.docs.map(d => {
    const x = d.data();
    return `<div class="log-line">${formatDate(x.createdAt)} · ${esc(x.status)} · ${esc(x.title)} → ${esc(x.targetType)}</div>`;
  }).join('');
}

// ---------- Premium tools ----------
async function resolveUid(input) {
  const v = (input || '').trim();
  if (!v) return null;
  if (!v.includes('@')) return v;
  const q = await db.collection('users').where('email', '==', v).limit(1).get();
  return q.empty ? null : q.docs[0].id;
}

$('#btnGrantPrem').addEventListener('click', async () => {
  const uid = await resolveUid($('#premUid').value);
  if (!uid) return toast('User not found');
  await db.collection('users').doc(uid).update({
    isPremium: true,
    premiumSource: 'admin',
    premiumReason: ($('#premReason').value || '').trim(),
    premiumUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await logAdmin('grant_premium', { target: uid });
  $('#premStatus').textContent = 'Premium granted to ' + uid;
  toast('Granted');
});

$('#btnRevokePrem').addEventListener('click', async () => {
  const uid = await resolveUid($('#premUid').value);
  if (!uid) return toast('User not found');
  await db.collection('users').doc(uid).update({
    isPremium: false,
    premiumSource: 'admin_revoke',
    premiumUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await logAdmin('revoke_premium', { target: uid });
  $('#premStatus').textContent = 'Premium revoked for ' + uid;
  toast('Revoked');
});

$('#btnAdjRef').addEventListener('click', async () => {
  const uid = ($('#refAdjUid').value || '').trim();
  const count = parseInt($('#refAdjCount').value, 10) || 0;
  if (!uid) return toast('UID required');
  const upd = { referralCount: count };
  if ($('#refAdjUnlock').checked && count >= 3) {
    upd.isPremium = true;
    upd.premiumSource = 'referral_admin';
  }
  await db.collection('users').doc(uid).update(upd);
  await logAdmin('adjust_referral', { target: uid, count });
  toast('Referral count updated');
});

// ---------- Promos ----------
$('#btnCreatePromo').addEventListener('click', async () => {
  const code = ($('#promoCode').value || '').trim().toUpperCase();
  if (!code) return toast('Code required');
  const maxUses = parseInt($('#promoMax').value, 10) || 0;
  const exp = $('#promoExp').value || null;
  await db.collection('promo_codes').doc(code).set({
    code, maxUses, usedCount: 0,
    expiresAt: exp || null,
    reward: 'premium',
    active: true,
    createdBy: currentAdmin.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await logAdmin('create_promo', { code });
  $('#promoStatus').textContent = 'Created ' + code;
  loadPromos();
});

async function loadPromos() {
  const snap = await db.collection('promo_codes').limit(50).get();
  const box = $('#promoList');
  if (snap.empty) { box.innerHTML = '<div class="empty">None</div>'; return; }
  box.innerHTML = snap.docs.map(d => {
    const x = d.data();
    return `<div class="device-row"><div><b>${esc(x.code)}</b> · used ${x.usedCount || 0}/${x.maxUses || '∞'}
      <div class="small-muted">${x.active ? 'Active' : 'Off'} · exp ${esc(x.expiresAt || '—')}</div></div>
      <button class="btn small danger promo-off" data-id="${d.id}">Disable</button></div>`;
  }).join('');
  $$('.promo-off').forEach(btn => {
    btn.addEventListener('click', async () => {
      await db.collection('promo_codes').doc(btn.dataset.id).update({ active: false });
      loadPromos();
    });
  });
}

// ---------- Feature flags ----------
async function loadFlags() {
  const snap = await db.collection('config').doc('features').get();
  const d = snap.exists ? snap.data() : {};
  $('#flagAi').checked = d.ai !== false;
  $('#flagMood').checked = d.mood !== false;
  $('#flagThemes').checked = d.themes !== false;
  $('#flagDevices').checked = d.devices !== false;
  $('#flagExport').checked = d.export !== false;
  $('#flagAds').checked = d.ads !== false;
  $('#flagMaint').checked = !!d.maintenance;
  $('#flagMaintMsg').value = d.maintenanceMessage || '';
}

$('#btnSaveFlags').addEventListener('click', async () => {
  const data = {
    ai: $('#flagAi').checked,
    mood: $('#flagMood').checked,
    themes: $('#flagThemes').checked,
    devices: $('#flagDevices').checked,
    export: $('#flagExport').checked,
    ads: $('#flagAds').checked,
    maintenance: $('#flagMaint').checked,
    maintenanceMessage: ($('#flagMaintMsg').value || '').trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentAdmin.uid
  };
  await db.collection('config').doc('features').set(data, { merge: true });
  await logAdmin('save_flags', data);
  $('#flagsStatus').textContent = 'Saved';
  toast('Flags saved');
});

// ---------- Slots ----------
async function loadSlots() {
  const snap = await db.collection('config').doc('slots').get();
  const d = snap.exists ? snap.data() : {};
  $('#slotHome').value = d.home || '';
  $('#slotSettings').value = d.settings || '';
}

$('#btnSaveSlots').addEventListener('click', async () => {
  await db.collection('config').doc('slots').set({
    home: $('#slotHome').value || '',
    settings: $('#slotSettings').value || '',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentAdmin.uid
  }, { merge: true });
  await logAdmin('save_slots');
  $('#slotsStatus').textContent = 'Published';
  toast('Slots published');
});

// ---------- Content meta ----------
$('#btnLoadEntries').addEventListener('click', async () => {
  const uid = ($('#contentUid').value || '').trim();
  const box = $('#entriesMetaList');
  box.textContent = 'Loading…';
  try {
    if (uid) {
      const snap = await db.collection('users').doc(uid).collection('entries').orderBy('updatedAt', 'desc').limit(30).get();
      if (snap.empty) { box.innerHTML = '<div class="empty">No entries</div>'; return; }
      box.innerHTML = snap.docs.map(d => {
        const x = d.data();
        return `<div class="log-line">${formatDate(x.updatedAt || x.createdAt)} · ${esc(x.title || '(untitled)')} · ${x.wordCount || '?'} words · <code>${d.id}</code></div>`;
      }).join('');
    } else {
      box.innerHTML = '<div class="empty">Enter a user UID to list their entry metadata</div>';
    }
  } catch (e) {
    box.innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>';
  }
});

// ---------- AI config ----------
async function loadAiConfig() {
  const snap = await db.collection('config').doc('ai').get();
  const d = snap.exists ? snap.data() : {};
  $('#aiBackendUrl').value = d.backendUrl || '';
  $('#aiNotes').value = d.notes || '';
}

$('#btnSaveAi').addEventListener('click', async () => {
  const backendUrl = ($('#aiBackendUrl').value || '').trim().replace(/\/$/, '');
  if (backendUrl && !/^https:\/\//i.test(backendUrl)) {
    $('#aiStatus').textContent = 'Use the full HTTPS backend URL, including /api/ai-insights.';
    return;
  }
  await db.collection('config').doc('ai').set({
    backendUrl,
    notes: ($('#aiNotes').value || '').trim(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentAdmin.uid
  }, { merge: true });
  await logAdmin('save_ai_config');
  $('#aiStatus').textContent = 'Saved. AI Insights will use the backend endpoint.';
  toast('AI config saved');
});

// ---------- Queues ----------
async function loadQueues() {
  const a = await db.collection('admin_requests').orderBy('createdAt', 'desc').limit(30).get();
  const f = await db.collection('fcm_requests').orderBy('createdAt', 'desc').limit(30).get();
  $('#adminReqList').innerHTML = a.empty ? '<div class="empty">Empty</div>' : a.docs.map(d => {
    const x = d.data();
    return `<div class="log-line">${formatDate(x.createdAt)} · ${esc(x.type)} · ${esc(x.status)} · ${esc(x.targetUid || x.email || '')}</div>`;
  }).join('');
  $('#fcmReqList').innerHTML = f.empty ? '<div class="empty">Empty</div>' : f.docs.map(d => {
    const x = d.data();
    return `<div class="log-line">${formatDate(x.createdAt)} · ${esc(x.status)} · ${esc(x.title)}</div>`;
  }).join('');
}
$('#btnRefreshQueues')?.addEventListener('click', loadQueues);

// ---------- Audit logs ----------
async function loadLogs() {
  const snap = await db.collection('admins').doc('activity').collection('logs')
    .orderBy('createdAt', 'desc').limit(100).get();
  const box = $('#auditLog');
  if (snap.empty) { box.innerHTML = '<div class="empty">No logs</div>'; return; }
  box.innerHTML = snap.docs.map(d => {
    const x = d.data();
    return `<div class="log-line">${formatDate(x.createdAt)} · ${esc(x.adminEmail || x.adminUid)} · <b>${esc(x.action)}</b> ${esc(JSON.stringify(x.details || {}).slice(0, 120))}</div>`;
  }).join('');
}
$('#btnRefreshLogs')?.addEventListener('click', loadLogs);

// ---------- Export / Import ----------
function downloadJson(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function downloadCsv(name, rows) {
  const blob = new Blob([rows], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

$('#btnExportAllUsers').addEventListener('click', async () => {
  const snap = await db.collection('users').limit(2000).get();
  let csv = 'uid,email,username,isPremium,referralCount,suspended,createdAt\n';
  snap.forEach(doc => {
    const d = doc.data();
    csv += `"${doc.id}","${(d.email || '').replace(/"/g, '')}","${(d.username || '').replace(/"/g, '')}",${!!d.isPremium},${d.referralCount || 0},${!!d.suspended},"${formatDate(d.createdAt)}"\n`;
  });
  downloadCsv('users.csv', csv);
  await logAdmin('export_all_users', { count: snap.size });
  toast('CSV downloaded');
});

$('#btnExportPremium').addEventListener('click', async () => {
  const snap = await db.collection('users').where('isPremium', '==', true).limit(1000).get();
  let csv = 'uid,email,username,premiumSource,referralCount\n';
  snap.forEach(doc => {
    const d = doc.data();
    csv += `"${doc.id}","${(d.email || '').replace(/"/g, '')}","${(d.username || '').replace(/"/g, '')}","${d.premiumSource || ''}",${d.referralCount || 0}\n`;
  });
  downloadCsv('premium-users.csv', csv);
  toast('Premium CSV downloaded');
});

$('#startImportBtn').addEventListener('click', async () => {
  const file = $('#importJsonFile').files?.[0];
  if (!file) return toast('Choose a JSON file');
  const text = await file.text();
  let arr;
  try { arr = JSON.parse(text); } catch (e) { return toast('Invalid JSON'); }
  if (!Array.isArray(arr)) return toast('JSON must be an array');
  $('#importStatus').textContent = `Importing ${arr.length}…`;
  let ok = 0;
  for (const item of arr) {
    try {
      const id = item.uid || item.id || db.collection('users').doc().id;
      const { entries, moods, uid, id: _id, ...userData } = item;
      await db.collection('users').doc(id).set({
        ...userData,
        importedAt: firebase.firestore.FieldValue.serverTimestamp(),
        importedBy: currentAdmin.uid
      }, { merge: true });
      if (Array.isArray(entries)) {
        for (const en of entries.slice(0, 50)) {
          const eid = en.id || db.collection('users').doc().id;
          await db.collection('users').doc(id).collection('entries').doc(eid).set(en, { merge: true });
        }
      }
      ok++;
    } catch (e) { console.warn(e); }
  }
  await logAdmin('import_users', { count: ok });
  $('#importStatus').textContent = `Imported ${ok}/${arr.length}`;
  toast('Import finished');
  loadUsers({ reset: true });
});

console.log('MyJournal+ Admin ready');

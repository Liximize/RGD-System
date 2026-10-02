(() => {
'use strict';

const $ = id => document.getElementById(id);
const FIELDS = ['enabled', 'channelId', 'mode', 'ping', 'ignoreBots', 'timestamp', 'content', 'title', 'description', 'color', 'footer', 'image', 'thumbnail', 'author', 'authorIcon', 'url'];
const BOOLS = new Set(['enabled', 'ping', 'ignoreBots', 'timestamp']);
const LIMITS = { content: 2000, title: 256, description: 4096, footer: 1000, author: 256 };
const KINDS = { welcome: 'Welcome', leave: 'Leave' };
const MODES = { text: 'Normal message', embed: 'Embed only', both: 'Normal + embed' };
const PLACEHOLDERS = [
  ['{user}', 'Mentions the member'],
  ['{username}', 'Discord username'],
  ['{displayName}', 'Server display name'],
  ['{userId}', 'Member ID'],
  ['{server}', 'Server name'],
  ['{memberCount}', 'Member count, including bots'],
  ['{avatar}', 'Member avatar URL'],
  ['{serverIcon}', 'Server icon URL']
];

const S = { data: null, view: 'overview', saved: {}, draft: {}, focus: null, busy: false, retry: null };

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opt = {}) {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opt });
  let j = {};
  try { j = await r.json(); } catch { /* empty body */ }
  if (!r.ok) {
    const e = new Error(j.error || 'Request failed.');
    e.status = r.status;
    if (r.status === 401 && url !== '/api/login') showLogin('Your session expired. Sign in again.');
    throw e;
  }
  return j;
}

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, type === 'bad' ? 6000 : 3200);
}

function toForm(c = {}) {
  const f = {};
  for (const k of FIELDS) {
    if (BOOLS.has(k)) f[k] = !!c[k];
    else if (k === 'channelId') f[k] = c[k] || '';
    else f[k] = String(c[k] ?? '');
  }
  return f;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isEditor = () => S.view === 'welcome' || S.view === 'leave';
const validHex = v => /^#[a-f\d]{6}$/i.test(v);

function readDOM() {
  const f = {};
  for (const k of FIELDS) { const e = $(k); f[k] = BOOLS.has(k) ? e.checked : e.value; }
  return f;
}
function writeDOM(f) {
  for (const k of FIELDS) { const e = $(k); if (BOOLS.has(k)) e.checked = !!f[k]; else e.value = f[k] ?? ''; }
  if (validHex(f.color)) $('colorPicker').value = f.color.toLowerCase();
  syncMode();
}
const current = kind => S.draft[kind] || S.saved[kind];
const dirty = kind => !!S.draft[kind] && !same(S.draft[kind], S.saved[kind]);

// ---------- views ----------
function showLogin(msg = '') {
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('loginError').textContent = msg;
}

function showView(view) {
  if (isEditor()) S.draft[S.view] = readDOM();
  S.view = view;
  document.querySelectorAll('.nav[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  $('view-overview').classList.toggle('hidden', view !== 'overview');
  $('view-editor').classList.toggle('hidden', view === 'overview');
  if (view === 'overview') {
    $('crumb').textContent = 'SERVER';
    $('pageTitle').textContent = 'Overview';
    renderOverview();
  } else {
    $('crumb').textContent = 'MESSAGES';
    $('pageTitle').textContent = KINDS[view] + ' message';
    S.draft[view] = S.draft[view] || { ...S.saved[view] };
    writeDOM(S.draft[view]);
    refresh();
  }
  window.scrollTo({ top: 0 });
}

function chName(id) {
  const c = S.data.channels.find(x => x.id === id);
  return c ? '# ' + c.name : (id ? 'Unavailable channel' : 'Not selected');
}

function renderOverview() {
  const d = S.data;
  $('st-server').textContent = d.guild.name;
  $('st-members').textContent = Number(d.preview.memberCount).toLocaleString();
  const active = ['welcome', 'leave'].filter(k => S.saved[k].enabled).length;
  $('st-active').textContent = active + ' of 2';
  $('ov-cards').innerHTML = ['welcome', 'leave'].map(k => {
    const c = S.saved[k];
    return `<div class="card sys">
      <div class="top-row"><h2>${KINDS[k]} message</h2><span class="pill ${c.enabled ? 'on' : ''}"><i></i>${c.enabled ? 'Enabled' : 'Disabled'}</span></div>
      <dl class="kv">
        <dt>Channel</dt><dd>${esc(chName(c.channelId))}</dd>
        <dt>Format</dt><dd>${esc(MODES[c.mode] || c.mode)}</dd>
        <dt>Member ping</dt><dd>${c.ping ? 'On' : 'Off'}</dd>
        <dt>Ignore bots</dt><dd>${c.ignoreBots ? 'On' : 'Off'}</dd>
      </dl>
      <div class="sys-actions">
        <button class="primary" data-edit="${k}">Edit message</button>
        <button class="secondary" data-toggle="${k}">${c.enabled ? 'Disable' : 'Enable'}</button>
      </div>
    </div>`;
  }).join('');
}

async function toggleKind(kind) {
  const next = !S.saved[kind].enabled;
  try {
    const r = await api('/api/' + kind, { method: 'PUT', body: JSON.stringify({ enabled: next }) });
    S.saved[kind] = toForm(r.config);
    if (S.draft[kind]) S.draft[kind].enabled = next;
    renderOverview(); refresh();
    toast(`${KINDS[kind]} message ${next ? 'enabled' : 'disabled'}.`, 'ok');
  } catch (e) { toast(e.message, 'bad'); }
}

// ---------- preview ----------
function md(src, links) {
  let s = esc(src);
  const blocks = [], inl = [];
  s = s.replace(/```(?:[a-z]+\n)?([\s\S]*?)```/gi, (m, c) => { blocks.push(c.replace(/^\n|\n$/g, '')); return '\u0002' + (blocks.length - 1) + '\u0002'; });
  s = s.replace(/`([^`\n]+)`/g, (m, c) => { inl.push(c); return '\u0003' + (inl.length - 1) + '\u0003'; });
  if (links) s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
  s = s.replace(/\*\*\*([^\n]+?)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*([^\n]+?)\*\*/g, '<b>$1</b>')
    .replace(/__([^\n]+?)__/g, '<u>$1</u>')
    .replace(/~~([^\n]+?)~~/g, '<s>$1</s>')
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/(^|[^_\w])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1<i>$2</i>')
    .replace(/\u0001([^\u0001]*)\u0001/g, '<span class="mention">$1</span>')
    .replace(/\n/g, '<br>');
  s = s.replace(/\u0003(\d+)\u0003/g, (m, i) => '<code>' + inl[i] + '</code>');
  s = s.replace(/\u0002(\d+)\u0002/g, (m, i) => '<pre><code>' + blocks[i] + '</code></pre>');
  return s;
}

function renderPreview(f) {
  const v = S.data.preview;
  const vars = { user: '\u0001@' + v.username + '\u0001', username: v.username, displayName: v.displayName, userId: '000000000000000000', server: v.server, memberCount: String(v.memberCount), avatar: v.avatar, serverIcon: v.serverIcon };
  const rep = s => String(s || '').replace(/\{(\w+)\}/g, (m, k) => Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m);
  const plain = s => rep(s).replace(/\u0001/g, '');
  const url = s => { const u = plain(s).trim(); return /^https?:\/\//i.test(u) ? u : ''; };
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const showText = f.mode !== 'embed', showEmbed = f.mode !== 'text';

  let html = `<img class="d-avatar" src="${esc(v.avatar)}" alt="" onerror="this.style.visibility='hidden'"><div class="d-body">
    <div class="d-head"><span class="d-name">${esc(v.displayName)}</span><span class="d-tag">APP</span><span class="d-time">Today at ${esc(time)}</span></div>`;

  if (showText) {
    const t = rep(f.content);
    html += t.trim() ? `<div class="d-text">${md(t, false)}</div>` : '<div class="e-empty">No message text</div>';
  }

  if (showEmbed) {
    const author = plain(f.author), title = plain(f.title), desc = rep(f.description), footer = plain(f.footer);
    const aIcon = url(f.authorIcon), thumb = url(f.thumbnail), img = url(f.image), link = url(f.url);
    const color = validHex(f.color) ? f.color : '#eb91ee';
    const hide = `onerror="this.style.display='none'"`;
    let inner = '';
    if (author) inner += `<div class="e-author">${aIcon ? `<img src="${esc(aIcon)}" alt="" referrerpolicy="no-referrer" ${hide}>` : ''}<span>${esc(author)}</span></div>`;
    if (title) inner += link ? `<a class="e-title link" href="${esc(link)}" target="_blank" rel="noreferrer noopener">${esc(title)}</a>` : `<div class="e-title">${esc(title)}</div>`;
    if (desc.trim()) inner += `<div class="e-desc">${md(desc, true)}</div>`;
    const grid = `<div class="e-grid"><div class="e-main">${inner}</div>${thumb ? `<img class="e-thumb" src="${esc(thumb)}" alt="" referrerpolicy="no-referrer" ${hide}>` : ''}</div>`;
    const foot = (footer || f.timestamp) ? `<div class="e-footer">${esc(footer)}${footer && f.timestamp ? ' \u2022 ' : ''}${f.timestamp ? 'Today at ' + esc(time) : ''}</div>` : '';
    const empty = !inner && !thumb && !img && !foot;
    html += `<div class="embed" style="border-left-color:${esc(color)}">${empty ? '<div class="e-empty">Embed is empty</div>' : grid}${img ? `<img class="e-image" src="${esc(img)}" alt="" referrerpolicy="no-referrer" ${hide}>` : ''}${foot}</div>`;
  }
  $('pv').innerHTML = html + '</div>';
}

// ---------- editor state ----------
function syncMode() {
  const m = $('mode').value || 'both';
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
}

function refresh() {
  if (!isEditor()) { updateDots(); return; }
  const kind = S.view, f = readDOM();
  $('enabledLabel').textContent = f.enabled ? 'Enabled' : 'Disabled';
  const usesText = f.mode !== 'embed', usesEmbed = f.mode !== 'text';
  $('card-text').classList.toggle('dim', !usesText);
  $('card-embed').classList.toggle('dim', !usesEmbed);
  $('card-media').classList.toggle('dim', !usesEmbed);
  $('note-text').textContent = usesText ? '' : 'Not used in this format';
  $('note-embed').textContent = usesEmbed ? '' : 'Not used in this format';
  for (const [k, lim] of Object.entries(LIMITS)) {
    const el = document.querySelector(`[data-count="${k}"]`);
    const n = f[k].length;
    el.textContent = `${n}/${lim}`;
    el.classList.toggle('over', n > lim);
  }
  const bad = f.color !== '' && !validHex(f.color);
  $('color').classList.toggle('invalid', bad);
  $('colorErr').textContent = bad ? 'Use a six-digit hex color, such as #eb91ee.' : '';
  renderPreview(f);
  const d = !same(f, S.saved[kind]);
  $('savebar').classList.toggle('dirty', d);
  $('saveStatus').querySelector('span').textContent = d ? 'Unsaved changes' : 'All changes saved';
  $('save').disabled = !d || S.busy;
  $('discard').disabled = !d || S.busy;
  $('test').disabled = S.busy;
  updateDots();
}

function onEdit() {
  if (!isEditor()) return;
  S.draft[S.view] = readDOM();
  refresh();
}

function updateDots() {
  for (const k of ['welcome', 'leave']) {
    const live = isEditor() && S.view === k ? !same(readDOM(), S.saved[k]) : dirty(k);
    document.querySelector(`[data-dot="${k}"]`).classList.toggle('hidden', !live);
  }
}

async function save() {
  if (!isEditor() || S.busy) return false;
  const kind = S.view, f = readDOM();
  if (!validHex(f.color)) { toast('Use a six-digit hex color, such as #eb91ee.', 'bad'); $('color').focus(); return false; }
  S.busy = true; refresh();
  try {
    const body = { ...f, channelId: f.channelId || null };
    const r = await api('/api/' + kind, { method: 'PUT', body: JSON.stringify(body) });
    S.saved[kind] = toForm(r.config);
    S.draft[kind] = { ...S.saved[kind] };
    toast(`${KINDS[kind]} message saved.`, 'ok');
    return true;
  } catch (e) {
    toast(e.message, 'bad');
    return false;
  } finally { S.busy = false; refresh(); }
}

async function sendTest() {
  if (!isEditor() || S.busy) return;
  const kind = S.view;
  if (!same(readDOM(), S.saved[kind]) && !(await save())) return;
  S.busy = true; refresh();
  try {
    const r = await api(`/api/${kind}/test`, { method: 'POST' });
    toast(r.message || 'Test message sent.', 'ok');
  } catch (e) { toast(e.message, 'bad'); }
  finally { S.busy = false; refresh(); }
}

function discard() {
  if (!isEditor()) return;
  S.draft[S.view] = { ...S.saved[S.view] };
  writeDOM(S.draft[S.view]);
  refresh();
  toast('Changes discarded.');
}

// ---------- boot ----------
function buildStatic() {
  $('ov-ph').innerHTML = PLACEHOLDERS.map(([p, d]) => `<div class="ph"><code>${esc(p)}</code><span>${esc(d)}</span></div>`).join('');
  $('chips').innerHTML = PLACEHOLDERS.map(([p]) => `<button type="button" class="chip" data-ph="${esc(p)}">${esc(p)}</button>`).join('');
}

function fillGuild() {
  const g = S.data.guild;
  $('guild').innerHTML = (g.icon ? `<img src="${esc(g.icon)}" alt="">` : `<span class="gi">${esc((g.name || '?').charAt(0).toUpperCase())}</span>`) + `<span>${esc(g.name)}</span>`;
  const opts = ['<option value="">Select a channel</option>'].concat(S.data.channels.map(c => `<option value="${esc(c.id)}"># ${esc(c.name)}</option>`));
  for (const k of ['welcome', 'leave']) {
    const id = S.data[k].channelId;
    if (id && !S.data.channels.some(c => c.id === id)) opts.push(`<option value="${esc(id)}">Unavailable channel</option>`);
  }
  $('channelId').innerHTML = opts.join('');
}

async function boot() {
  clearTimeout(S.retry);
  try {
    S.data = await api('/api/bootstrap');
  } catch (e) {
    if (e.status === 503) {
      showLogin('Waiting for the bot to connect to Discord...');
      S.retry = setTimeout(boot, 3000);
    } else if (e.status !== 401) showLogin(e.message);
    return;
  }
  S.saved = { welcome: toForm(S.data.welcome), leave: toForm(S.data.leave) };
  S.draft = {};
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  fillGuild();
  showView('overview');
}

// ---------- events ----------
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginBtn').disabled = true;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
    $('loginError').textContent = '';
    $('password').value = '';
    await boot();
  } catch (x) { $('loginError').textContent = x.message; }
  finally { $('loginBtn').disabled = false; }
});
$('pwToggle').addEventListener('click', () => {
  const show = $('password').type === 'password';
  $('password').type = show ? 'text' : 'password';
  $('pwToggle').textContent = show ? 'Hide' : 'Show';
});
$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  location.reload();
});

document.querySelectorAll('.nav[data-view]').forEach(n => n.addEventListener('click', () => showView(n.dataset.view)));

$('ov-cards').addEventListener('click', e => {
  const edit = e.target.closest('[data-edit]'), tog = e.target.closest('[data-toggle]');
  if (edit) showView(edit.dataset.edit);
  if (tog) toggleKind(tog.dataset.toggle);
});

$('view-editor').addEventListener('input', onEdit);
$('view-editor').addEventListener('change', onEdit);
$('view-editor').addEventListener('focusin', e => { if (e.target.matches('input[type=text],input:not([type]),textarea')) S.focus = e.target; });

document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => {
  $('mode').value = b.dataset.mode;
  syncMode();
  onEdit();
}));

$('colorPicker').addEventListener('input', () => { $('color').value = $('colorPicker').value; onEdit(); });
$('color').addEventListener('input', () => { if (validHex($('color').value)) $('colorPicker').value = $('color').value.toLowerCase(); });

$('chips').addEventListener('mousedown', e => { if (e.target.closest('.chip')) e.preventDefault(); });
$('chips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const el = S.focus;
  if (!el || !isEditor() || !document.body.contains(el) || el.id === 'color' || el.id === 'channelId') { toast('Click a text field first, then choose a placeholder.'); return; }
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
  el.focus();
  el.value = el.value.slice(0, a) + chip.dataset.ph + el.value.slice(b);
  const pos = a + chip.dataset.ph.length;
  el.setSelectionRange(pos, pos);
  onEdit();
});

$('save').addEventListener('click', save);
$('test').addEventListener('click', sendTest);
$('discard').addEventListener('click', discard);

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && isEditor()) { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', e => {
  if (['welcome', 'leave'].some(k => (isEditor() && S.view === k ? !same(readDOM(), S.saved[k]) : dirty(k)))) { e.preventDefault(); e.returnValue = ''; }
});

buildStatic();
boot();
})();

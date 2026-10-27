const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '.';
const DB_FILE = path.join(DATA_DIR, 'durzoc.json');

// ---------- JSON-БАЗА ----------
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { users: [], servers: [], channels: [], messages: [], nextId: { user: 1, server: 1, channel: 1, message: 1 } };
if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) { console.error('save:', e); }
  }, 200);
}
const COLORS = ['#5865f2','#eb459e','#ed4245','#faa61a','#57f287','#3ba55c','#f47fff'];

// ---------- HTTP ----------
const app = express();
const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: '*' } });
app.use(express.json({ limit: '1mb' }));

// ---------- СТАТИКА (всё inline) ----------
const HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>durzoc</title>
<style>__CSS__</style></head><body><div id="app"></div>
<script src="/socket.io/socket.io.js"></script><script>__JS__</script></body></html>`;

const CSS = String.raw`
*{box-sizing:border-box;margin:0}
body{height:100vh;background:#313338;color:#f2f3f5;font-family:system-ui,sans-serif;font-size:15px;overflow:hidden}
#app{height:100vh}input,button{font:inherit}
.auth{display:flex;height:100vh;align-items:center;justify-content:center}
.auth form{background:#2b2d31;padding:32px;border-radius:8px;width:360px}
.auth h1{margin-bottom:16px;font-size:22px}
.auth input{width:100%;padding:10px;margin-bottom:10px;background:#1e1f22;border:1px solid #1e1f22;border-radius:4px;color:#fff;outline:none}
.auth input:focus{border-color:#5865f2}
.auth button{width:100%;padding:11px;background:#5865f2;color:#fff;border:0;border-radius:4px;font-weight:600;cursor:pointer}
.auth button:hover{background:#4752c4}
.auth .err{color:#f23f42;font-size:13px;min-height:18px;margin-bottom:8px}
.auth .switch{text-align:center;margin-top:12px;color:#949ba4;font-size:14px}
.auth .switch a{color:#00a8fc;cursor:pointer}
.layout{display:grid;grid-template-columns:72px 240px 1fr;height:100vh}
.servers{background:#1e1f22;padding:12px 0;display:flex;flex-direction:column;align-items:center;gap:8px;overflow-y:auto}
.srv{width:48px;height:48px;border-radius:50%;border:0;background:#2b2d31;color:#fff;font-weight:700;cursor:pointer;transition:border-radius .15s}
.srv:hover,.srv.active{border-radius:16px;background:#5865f2}
.srv.add{color:#23a55a;font-size:24px}.srv.add:hover{background:#23a55a;color:#fff}
.channels{background:#2b2d31;display:flex;flex-direction:column}
.channels .head{padding:14px 16px;border-bottom:1px solid #1f2024;font-weight:600;font-size:15px}
.channels .list{flex:1;overflow-y:auto;padding:8px}
.channels .btn{width:100%;padding:8px 10px;background:transparent;border:0;color:#949ba4;text-align:left;border-radius:4px;cursor:pointer}
.channels .btn:hover{background:#35373c;color:#fff}
.channels .btn.active{background:#404249;color:#fff}
.channels .btn::before{content:'# ';opacity:.6}
.channels .add{padding:8px 10px;color:#949ba4;background:transparent;border:0;font-size:13px;cursor:pointer;text-align:left;width:100%}
.user{padding:8px 12px;background:#232428;display:flex;align-items:center;gap:8px}
.user .name{flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.user button{background:transparent;border:0;color:#949ba4;cursor:pointer;font-size:16px}
.user button:hover{color:#ed4245}
.chat{display:flex;flex-direction:column;background:#313338}
.chat .head{padding:12px 16px;border-bottom:1px solid #26272b;font-weight:600}
.chat .msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:2px}
.msg{display:flex;gap:12px;padding:4px 8px;border-radius:4px}
.msg:hover{background:#2e3035}
.av{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;flex-shrink:0;font-size:13px}
.msg .body{flex:1;min-width:0}
.msg .meta{display:flex;gap:8px;align-items:baseline;margin-bottom:2px}
.msg .author{font-weight:600;font-size:14px}
.msg .time{font-size:11px;color:#949ba4}
.msg .text{font-size:14px;line-height:1.4;word-wrap:break-word;white-space:pre-wrap}
.typing{height:18px;padding:0 16px;font-size:12px;color:#949ba4}
.composer{padding:12px 16px}
.composer .inner{display:flex;gap:8px;background:#383a40;border-radius:8px;padding:8px 14px}
.composer input{flex:1;background:transparent;border:0;color:#fff;outline:none;padding:6px 0}
.composer button{background:#5865f2;border:0;border-radius:4px;color:#fff;padding:6px 14px;font-weight:600;cursor:pointer}
.composer button:disabled{opacity:.5;cursor:not-allowed}
.empty{flex:1;display:flex;align-items:center;justify-content:center;color:#949ba4;padding:40px;text-align:center}
`;

const CLIENT_JS = String.raw`
const app = document.getElementById('app');
const state = { token: localStorage.getItem('dz_token'),
  user: JSON.parse(localStorage.getItem('dz_user') || 'null'),
  socket: null, servers: [], channels: [], messages: [],
  currentServer: null, currentChannel: null };
const api = (url, opts = {}) => {
  const h = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) h.Authorization = 'Bearer ' + state.token;
  return fetch(url, { ...opts, headers: h }).then(async r => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'error');
    return d;
  });
};
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const initials = n => (n || '?')[0].toUpperCase();
const fmt = ts => new Date(ts * 1000).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

function renderAuth(mode = 'login') {
  app.innerHTML = '<div class="auth"><form id="af"><h1>' +
    (mode === 'login' ? 'Вход в durzoc' : 'Регистрация') +
    '</h1><div class="err" id="err"></div>' +
    '<input id="u" placeholder="Имя" autocomplete="username">' +
    '<input id="p" type="password" placeholder="Пароль">' +
    '<button>' + (mode === 'login' ? 'Войти' : 'Создать') + '</button>' +
    '<div class="switch">' + (mode === 'login'
      ? 'Нет аккаунта? <a id="sw">Регистрация</a>'
      : 'Есть аккаунт? <a id="sw">Вход</a>') + '</div></form></div>';
  document.getElementById('sw').onclick = () => renderAuth(mode === 'login' ? 'reg' : 'login');
  document.getElementById('af').onsubmit = async e => {
    e.preventDefault();
    const username = document.getElementById('u').value.trim();
    const password = document.getElementById('p').value;
    try {
      const d = await api('/api/' + (mode === 'login' ? 'login' : 'register'),
        { method: 'POST', body: JSON.stringify({ username, password }) });
      state.token = d.token; state.user = d.user;
      localStorage.setItem('dz_token', d.token);
      localStorage.setItem('dz_user', JSON.stringify(d.user));
      enterApp();
    } catch (err) { document.getElementById('err').textContent = err.message; }
  };
}

async function enterApp() {
  state.servers = await api('/api/servers');
  if (state.socket) state.socket.disconnect();
  state.socket = io({ auth: { token: state.token } });
  state.socket.on('connect_error', logout);
  state.socket.on('message', m => {
    if (m.channel_id !== state.currentChannel) return;
    if (state.messages.some(x => x.id === m.id)) return;
    state.messages.push(m); appendMsg(m);
  });
  let tid;
  state.socket.on('typing', ({ username, channelId }) => {
    if (channelId !== state.currentChannel) return;
    const el = document.getElementById('typing'); if (!el) return;
    el.textContent = username + ' печатает...';
    clearTimeout(tid); tid = setTimeout(() => el.textContent = '', 2000);
  });
  renderLayout();
  if (state.servers.length) selectServer(state.servers[0].id);
}

function renderLayout() {
  app.innerHTML = '<div class="layout">' +
    '<div class="servers" id="servers"></div>' +
    '<div class="channels"><div class="head" id="srv-head">durzoc</div>' +
    '<div class="list" id="channel-list"></div>' +
    '<div class="user"><div class="av" style="background:#5865f2">' +
    initials(state.user.username) + '</div>' +
    '<div class="name">' + esc(state.user.username) + '</div>' +
    '<button id="logout">⏻</button></div></div>' +
    '<div class="chat" id="chat"><div class="empty">Выбери сервер</div></div></div>';
  document.getElementById('logout').onclick = logout;
  renderServers();
}

function renderServers() {
  const el = document.getElementById('servers');
  el.innerHTML = state.servers.map(s =>
    '<button class="srv ' + (s.id === state.currentServer ? 'active' : '') +
    '" data-id="' + s.id + '" title="' + esc(s.name) + '">' +
    esc(initials(s.name)) + '</button>').join('') +
    '<button class="srv add" id="add-srv">+</button>';
  el.querySelectorAll('.srv[data-id]').forEach(b =>
    b.onclick = () => selectServer(Number(b.dataset.id)));
  document.getElementById('add-srv').onclick = async () => {
    const name = prompt('Название сервера:'); if (!name) return;
    const s = await api('/api/servers', { method:'POST', body: JSON.stringify({ name }) });
    state.servers.push(s); renderServers(); selectServer(s.id);
  };
}

async function selectServer(id) {
  state.currentServer = id; state.currentChannel = null; state.messages = [];
  renderServers();
  const s = state.servers.find(x => x.id === id);
  document.getElementById('srv-head').textContent = s ? s.name : 'durzoc';
  state.channels = await api('/api/servers/' + id + '/channels');
  renderChannels();
  if (state.channels.length) selectChannel(state.channels[0].id);
  else document.getElementById('chat').innerHTML = '<div class="empty">Нет каналов</div>';
}

function renderChannels() {
  const el = document.getElementById('channel-list');
  el.innerHTML = state.channels.map(c =>
    '<button class="btn ' + (c.id === state.currentChannel ? 'active' : '') +
    '" data-id="' + c.id + '">' + esc(c.name) + '</button>').join('') +
    '<button class="add" id="add-ch">+ канал</button>';
  el.querySelectorAll('.btn').forEach(b =>
    b.onclick = () => selectChannel(Number(b.dataset.id)));
  document.getElementById('add-ch').onclick = async () => {
    const name = prompt('Название канала:'); if (!name) return;
    const c = await api('/api/servers/' + state.currentServer + '/channels',
      { method:'POST', body: JSON.stringify({ name }) });
    state.channels.push(c); renderChannels();
  };
}

async function selectChannel(id) {
  if (state.currentChannel) state.socket.emit('leave-channel', state.currentChannel);
  state.currentChannel = id; state.messages = [];
  renderChannels();
  state.socket.emit('join-channel', id);
  state.messages = await api('/api/channels/' + id + '/messages');
  renderChat();
}

function renderChat() {
  const ch = state.channels.find(c => c.id === state.currentChannel);
  if (!ch) return;
  document.getElementById('chat').innerHTML =
    '<div class="head"># ' + esc(ch.name) + '</div>' +
    '<div class="msgs" id="msgs"></div>' +
    '<div class="typing" id="typing"></div>' +
    '<div class="composer"><div class="inner">' +
    '<input id="msg-input" placeholder="Сообщение..." maxlength="4000" autocomplete="off">' +
    '<button id="send" disabled>→</button></div></div>';
  state.messages.forEach(appendMsg);
  const inp = document.getElementById('msg-input');
  const btn = document.getElementById('send');
  inp.oninput = () => {
    btn.disabled = !inp.value.trim();
    if (inp.value.trim()) state.socket.emit('typing', { channelId: state.currentChannel });
  };
  const send = () => {
    const content = inp.value.trim(); if (!content) return;
    inp.value = ''; btn.disabled = true;
    state.socket.emit('message', { channelId: state.currentChannel, content });
  };
  btn.onclick = send;
  inp.onkeydown = e => { if (e.key === 'Enter') send(); };
  inp.focus();
}

function appendMsg(m) {
  const el = document.getElementById('msgs'); if (!el) return;
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = '<div class="av" style="background:' + esc(m.avatar_color || '#5865f2') + '">' +
    initials(m.username) + '</div><div class="body"><div class="meta">' +
    '<span class="author">' + esc(m.username) + '</span>' +
    '<span class="time">' + fmt(m.created_at) + '</span></div>' +
    '<div class="text">' + esc(m.content) + '</div></div>';
  el.appendChild(div); el.scrollTop = el.scrollHeight;
}

function logout() {
  localStorage.clear();
  state.token = null; state.user = null;
  if (state.socket) state.socket.disconnect();
  renderAuth('login');
}

if (state.token && state.user) enterApp().catch(logout);
else renderAuth('login');
`;

app.get('/', (_req, res) => res.type('html').send(
  HTML.replace('__CSS__', CSS).replace('__JS__', CLIENT_JS)
));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---------- API ----------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'заполни поля' });
  if (username.length < 3 || password.length < 4)
    return res.status(400).json({ error: 'имя ≥ 3, пароль ≥ 4' });
  if (db.users.find(u => u.username === username))
    return res.status(409).json({ error: 'имя уже занято' });
  const user = { id: db.nextId.user++, username,
    password: bcrypt.hashSync(password, 10),
    color: COLORS[Math.floor(Math.random() * COLORS.length)] };
  db.users.push(user); save();
  const pub = { id: user.id, username: user.username };
  res.json({ token: jwt.sign(pub, JWT_SECRET), user: pub });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.users.find(x => x.username === username);
  if (!u || !bcrypt.compareSync(password, u.password))
    return res.status(401).json({ error: 'неверные данные' });
  const pub = { id: u.id, username: u.username };
  res.json({ token: jwt.sign(pub, JWT_SECRET), user: pub });
});

function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'unauthorized' }); }
}

app.get('/api/servers', auth, (_req, res) => res.json(db.servers));

app.post('/api/servers', auth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'нужно имя' });
  const s = { id: db.nextId.server++, name, owner: req.user.id };
  db.servers.push(s);
  db.channels.push({ id: db.nextId.channel++, server: s.id, name: 'general' });
  save();
  res.json(s);
});

app.get('/api/servers/:id/channels', auth, (req, res) => {
  res.json(db.channels.filter(c => c.server === Number(req.params.id)));
});

app.post('/api/servers/:id/channels', auth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'нужно имя' });
  const c = { id: db.nextId.channel++, server: Number(req.params.id), name };
  db.channels.push(c); save();
  res.json(c);
});

app.get('/api/channels/:id/messages', auth, (req, res) => {
  const cid = Number(req.params.id);
  const rows = db.messages.filter(m => m.channel === cid).slice(-50).map(m => {
    const u = db.users.find(x => x.id === m.user);
    return { id: m.id, content: m.content, created_at: m.created_at,
      user_id: m.user, username: u ? u.username : '?',
      avatar_color: u ? u.color : '#5865f2' };
  });
  res.json(rows);
});

// ---------- SOCKET.IO ----------
io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth.token, JWT_SECRET); next(); }
  catch { next(new Error('unauthorized')); }
});

io.on('connection', socket => {
  const u = socket.user;
  socket.on('join-channel', id => socket.join('ch:' + id));
  socket.on('leave-channel', id => socket.leave('ch:' + id));
  socket.on('message', ({ channelId, content }, ack) => {
    content = (content || '').trim();
    if (!content || content.length > 4000) return ack?.({ error: 'пусто' });
    const me = db.users.find(x => x.id === u.id);
    const msg = { id: db.nextId.message++, channel: channelId, user: u.id,
      content, created_at: Math.floor(Date.now() / 1000) };
    db.messages.push(msg);
    if (db.messages.length > 5000) db.messages = db.messages.slice(-5000);
    save();
    io.to('ch:' + channelId).emit('message', {
      id: msg.id, channel_id: channelId, content,
      user_id: u.id, username: u.username,
      avatar_color: me ? me.color : '#5865f2',
      created_at: msg.created_at
    });
    ack?.({ ok: true });
  });
  socket.on('typing', ({ channelId }) => {
    socket.to('ch:' + channelId).emit('typing', { username: u.username, channelId });
  });
});

srv.listen(PORT, '0.0.0.0', () => console.log('durzoc на порту ' + PORT));

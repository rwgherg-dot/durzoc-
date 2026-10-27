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
let db = { users: [], servers: [], channels: [], messages: [],
  nextId: { user: 1, server: 1, channel: 1, message: 1 } };
if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); }
    catch (e) { console.error('save:', e); }
  }, 200);
}
const COLORS = ['#5865f2','#eb459e','#ed4245','#faa61a','#57f287','#3ba55c','#f47fff'];

// ---------- HTTP ----------
const app = express();
const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: '*' } });
app.use(express.json({ limit: '1mb' }));

// ---------- СТАТИКА ----------
const INDEX_HTML = path.join(__dirname, 'index.html');
app.get('/', (_req, res) => res.sendFile(INDEX_HTML));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---------- АУТЕНТИФИКАЦИЯ ----------
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

// ---------- СЕРВЕРЫ / КАНАЛЫ ----------
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

// ---------- СООБЩЕНИЯ ----------
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

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

const WORLD_W = 4000, WORLD_H = 4000;
const TICK_RATE = 30;
const FOOD_COUNT = 500;
const FOOD_COLORS = ['#ff6b6b','#ffd93d','#4ecdc4','#c44dff','#ff9f1c','#7CFFB2','#ff5fa2'];

const FOOD_TYPES = {
  normal:  { points: 1, growLen: 2, growW: 0.3 },
  bonus:   { points: 3, growLen: 5, growW: 0.6 },
  golden:  { points: 8, growLen: 6, growW: 1.0 },
  wide:    { points: 2, growLen: 1, growW: 1.5 }
};

const SKINS = [
  { id: 'classic',  name: 'Классик',  color: '#7CFFB2', rarity: 'common' },
  { id: 'ember',    name: 'Уголёк',   color: '#ff6b6b', rarity: 'common' },
  { id: 'sun',      name: 'Солнце',   color: '#ffd93d', rarity: 'common' },
  { id: 'mint',     name: 'Мята',     color: '#4ecdc4', rarity: 'common' },
  { id: 'violet',   name: 'Фиалка',   color: '#c44dff', rarity: 'rare' },
  { id: 'orange',   name: 'Апельсин', color: '#ff9f1c', rarity: 'rare' },
  { id: 'pink',     name: 'Роза',     color: '#ff5fa2', rarity: 'rare' },
  { id: 'ice',      name: 'Лёд',      color: '#a0e9ff', rarity: 'rare' },
  { id: 'toxic',    name: 'Токсин',   color: '#a8ff3e', rarity: 'epic' },
  { id: 'blood',    name: 'Кровь',    color: '#b3001b', rarity: 'epic' },
  { id: 'void',     name: 'Пустота',  color: '#2d0a4e', rarity: 'legendary' },
  { id: 'gold',     name: 'Золото',   color: '#ffcc00', rarity: 'legendary' }
];

const CASES = [
  { id: 'common',    name: 'Обычный кейс',      price: 100,  chances: { common: 0.70, rare: 0.25, epic: 0.045, legendary: 0.005 } },
  { id: 'rare',      name: 'Редкий кейс',       price: 300,  chances: { common: 0.30, rare: 0.50, epic: 0.18,  legendary: 0.02  } },
  { id: 'legendary', name: 'Легендарный кейс',  price: 1000, chances: { common: 0.00, rare: 0.20, epic: 0.55,  legendary: 0.25  } }
];

const profiles = {};

function getProfile(name) {
  if (!name) return null;
  if (!profiles[name]) {
    const isAdmin = name.toLowerCase() === 'admin worms';
    profiles[name] = {
      name,
      coins: isAdmin ? 999999 : 500,
      skins: isAdmin ? SKINS.map(s => s.id) : ['classic'],
      activeSkin: 'classic',
      isAdmin,
      kills: 0,
      deaths: 0
    };
  }
  return profiles[name];
}

function skinColor(id) {
  const s = SKINS.find(x => x.id === id);
  return s ? s.color : '#7CFFB2';
}

function rollCase(caseId) {
  const c = CASES.find(x => x.id === caseId);
  if (!c) return 'classic';
  const r = Math.random();
  let acc = 0, chosen = 'common';
  for (const rarity of ['common','rare','epic','legendary']) {
    acc += c.chances[rarity] || 0;
    if (r <= acc) { chosen = rarity; break; }
  }
  const pool = SKINS.filter(s => s.rarity === chosen);
  if (!pool.length) return 'classic';
  return pool[Math.floor(Math.random() * pool.length)].id;
}

let foods = [];
let worms = {};
let rooms = {};
let nextWormId = 1;

function rand(min, max) { return min + Math.random() * (max - min); }
function randi(min, max) { return Math.floor(rand(min, max + 1)); }

function makeFood() {
  const r = Math.random();
  let type = 'normal';
  if (r < 0.05) type = 'golden';
  else if (r < 0.15) type = 'bonus';
  else if (r < 0.25) type = 'wide';
  return {
    id: Math.random().toString(36).slice(2),
    x: rand(20, WORLD_W - 20),
    y: rand(20, WORLD_H - 20),
    r: type === 'golden' ? 8 : (type === 'bonus' ? 6 : 4 + Math.random() * 3),
    type,
    color: FOOD_COLORS[randi(0, FOOD_COLORS.length - 1)],
    pulse: Math.random() * Math.PI * 2
  };
}

function initFood() {
  foods = [];
  for (let i = 0; i < FOOD_COUNT; i++) foods.push(makeFood());
}
initFood();

function makeWorm(name, color) {
  const id = 'w' + (nextWormId++);
  const w = {
    id, name: name || 'Игрок',
    color: color || '#7CFFB2',
    x: rand(200, WORLD_W - 200),
    y: rand(200, WORLD_H - 200),
    angle: Math.random() * Math.PI * 2,
    targetAngle: 0,
    baseSpeed: 160,
    speed: 160,
    radius: 14,
    length: 25,
    gap: 8,
    segments: [],
    score: 0,
    alive: true,
    boosting: false,
    boostFuel: 100,
    room: null,
    kills: 0,
    skin: 'classic'
  };
  w.targetAngle = w.angle;
  for (let i = 0; i < w.length; i++) {
    w.segments.push({ x: w.x - Math.cos(w.angle) * i * w.gap, y: w.y - Math.sin(w.angle) * i * w.gap });
  }
  return w;
}

function normAng(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

function updateWorm(w, dt) {
  if (!w.alive) return;
  const diff = normAng(w.targetAngle - w.angle);
  const maxTurn = 6.0 * dt;
  w.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));

  let speed = w.baseSpeed;
  if (w.boosting && w.boostFuel > 0) {
    speed *= 1.9;
    w.boostFuel = Math.max(0, w.boostFuel - 40 * dt);
    if (w.length > 15) w.length = Math.max(15, w.length - 3 * dt);
  } else {
    w.boostFuel = Math.min(100, w.boostFuel + 15 * dt);
  }
  w.speed = speed;

  w.x += Math.cos(w.angle) * speed * dt;
  w.y += Math.sin(w.angle) * speed * dt;

  if (w.x < w.radius) { w.x = w.radius; w.angle = Math.PI - w.angle; w.targetAngle = w.angle; }
  if (w.x > WORLD_W - w.radius) { w.x = WORLD_W - w.radius; w.angle = Math.PI - w.angle; w.targetAngle = w.angle; }
  if (w.y < w.radius) { w.y = w.radius; w.angle = -w.angle; w.targetAngle = w.angle; }
  if (w.y > WORLD_H - w.radius) { w.y = WORLD_H - w.radius; w.angle = -w.angle; w.targetAngle = w.angle; }

  w.segments.unshift({ x: w.x, y: w.y });
  const targetLen = Math.floor(w.length);
  while (w.segments.length > targetLen) w.segments.pop();
  while (w.segments.length < targetLen) {
    const last = w.segments[w.segments.length - 1] || { x: w.x, y: w.y };
    w.segments.push({ x: last.x, y: last.y });
  }
}

function eatCheck(w) {
  for (let i = foods.length - 1; i >= 0; i--) {
    const f = foods[i];
    const dx = f.x - w.x, dy = f.y - w.y;
    const rr = w.radius + f.r + 6;
    if (dx * dx + dy * dy < rr * rr) {
      const cfg = FOOD_TYPES[f.type];
      w.score += cfg.points;
      w.length = Math.min(400, w.length + cfg.growLen);
      w.radius = Math.min(45, w.radius + cfg.growW);
      w.boostFuel = Math.min(100, w.boostFuel + (f.type === 'golden' ? 30 : 10));
      foods[i] = makeFood();
    }
  }
}

function checkCollisions() {
  const list = Object.values(worms).filter(w => w.alive);
  for (let a = 0; a < list.length; a++) {
    const w = list[a];
    if (!w.alive) continue;
    for (let b = 0; b < list.length; b++) {
      if (a === b) continue;
      const o = list[b];
      if (!o.alive) continue;
      if (w.room !== o.room) continue;
      for (let s = 4; s < o.segments.length; s += 2) {
        const seg = o.segments[s];
        const dx = seg.x - w.x, dy = seg.y - w.y;
        const rr = w.radius + o.radius - 6;
        if (dx * dx + dy * dy < rr * rr) {
          w.alive = false;
          o.kills++;
          o.score += Math.floor(w.score * 0.3);
          const profO = getProfile(o.name); if (profO) profO.kills++;
          const profW = getProfile(w.name); if (profW) profW.deaths++;
          for (let k = 0; k < w.segments.length; k += 3) {
            const seg = w.segments[k];
            const nf = makeFood();
            nf.x = seg.x + rand(-10, 10);
            nf.y = seg.y + rand(-10, 10);
            nf.color = w.color;
            nf.type = 'bonus';
            foods.push(nf);
          }
          break;
        }
      }
      if (!w.alive) break;
    }
  }
}

const clients = new Map();

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || !msg.t) return;

    if (msg.t === 'profile') {
      const prof = getProfile(String(msg.name || '').slice(0, 16));
      if (!prof) return;
      ws.send(JSON.stringify({
        t: 'profile',
        name: prof.name, coins: prof.coins, skins: prof.skins,
        activeSkin: prof.activeSkin, isAdmin: prof.isAdmin,
        kills: prof.kills, deaths: prof.deaths,
        allSkins: SKINS, cases: CASES
      }));
      return;
    }

    if (msg.t === 'openCase') {
      const prof = getProfile(String(msg.name || '').slice(0, 16));
      if (!prof) return;
      const c = CASES.find(x => x.id === msg.caseId);
      if (!c) return;
      if (prof.coins < c.price) {
        ws.send(JSON.stringify({ t: 'caseResult', error: 'Недостаточно монет', coins: prof.coins, skins: prof.skins }));
        return;
      }
      prof.coins -= c.price;
      const skinId = rollCase(c.id);
      const alreadyOwned = prof.skins.includes(skinId);
      if (!alreadyOwned) prof.skins.push(skinId);
      let refund = 0;
      if (alreadyOwned) {
        const sk = SKINS.find(s => s.id === skinId);
        refund = sk.rarity === 'legendary' ? 500 : sk.rarity === 'epic' ? 200 : 50;
        prof.coins += refund;
      }
      ws.send(JSON.stringify({
        t: 'caseResult', skinId, alreadyOwned, refund,
        coins: prof.coins, skins: prof.skins
      }));
      return;
    }

    if (msg.t === 'setSkin') {
      const prof = getProfile(String(msg.name || '').slice(0, 16));
      if (!prof || !prof.skins.includes(msg.skinId)) return;
      prof.activeSkin = msg.skinId;
      const w = worms[msg.wormId];
      if (w) { w.color = skinColor(msg.skinId); w.skin = msg.skinId; }
      ws.send(JSON.stringify({ t: 'skinSet', activeSkin: msg.skinId }));
      return;
    }

    if (msg.t === 'join') {
      const roomCode = String(msg.room || 'default').toUpperCase().slice(0, 6);
      const name = String(msg.name || 'Игрок').slice(0, 16);
      const prof = getProfile(name);
      const skinId = prof ? prof.activeSkin : 'classic';
      const w = makeWorm(name, skinColor(skinId));
      w.skin = skinId;
      w.room = roomCode;
      worms[w.id] = w;
      clients.set(ws, { wormId: w.id, roomCode, name });
      if (!rooms[roomCode]) rooms[roomCode] = new Set();
      rooms[roomCode].add(w.id);
      ws.send(JSON.stringify({ t: 'joined', id: w.id, room: roomCode, world: { w: WORLD_W, h: WORLD_H } }));
      return;
    }

    if (msg.t === 'input') {
      const c = clients.get(ws);
      if (!c) return;
      const w = worms[c.wormId];
      if (!w || !w.alive) return;
      if (typeof msg.angle === 'number') w.targetAngle = msg.angle;
      w.boosting = !!msg.boost;
      return;
    }

    if (msg.t === 'respawn') {
      const c = clients.get(ws);
      if (!c) return;
      const old = worms[c.wormId];
      if (!old) return;
      const prof = getProfile(old.name);
      const skinId = prof ? prof.activeSkin : 'classic';
      const w = makeWorm(old.name, skinColor(skinId));
      w.skin = skinId;
      w.room = old.room;
      delete worms[old.id];
      worms[w.id] = w;
      clients.set(ws, { wormId: w.id, roomCode: old.room, name: old.name });
      if (rooms[old.room]) {
        rooms[old.room].delete(old.id);
        rooms[old.room].add(w.id);
      }
      ws.send(JSON.stringify({ t: 'respawned', id: w.id }));
      return;
    }
  });

  ws.on('close', () => {
    const c = clients.get(ws);
    if (c) {
      delete worms[c.wormId];
      if (rooms[c.roomCode]) rooms[c.roomCode].delete(c.wormId);
    }
    clients.delete(ws);
  });
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;

  for (const id in worms) {
    const w = worms[id];
    if (w.alive) { updateWorm(w, dt); eatCheck(w); }
  }
  checkCollisions();

  const roomStates = {};
  for (const code in rooms) {
    const list = [];
    rooms[code].forEach(id => {
      const w = worms[id];
      if (!w) return;
      list.push({
        id: w.id, name: w.name, color: w.color,
        x: Math.round(w.x), y: Math.round(w.y),
        angle: Math.round(w.angle * 1000) / 1000,
        score: w.score, alive: w.alive,
        radius: Math.round(w.radius * 10) / 10,
        boosting: w.boosting, kills: w.kills,
        segments: w.segments.slice(0, 80).map(s => [Math.round(s.x), Math.round(s.y)])
      });
    });
    roomStates[code] = list;
  }

  const foodPayload = foods.map(f => [Math.round(f.x), Math.round(f.y), Math.round(f.r*10)/10, f.color, f.type]);

  clients.forEach((c, ws) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const myWorm = worms[c.wormId];
    const state = {
      t: 'state',
      me: myWorm ? {
        id: myWorm.id, x: Math.round(myWorm.x), y: Math.round(myWorm.y),
        angle: myWorm.angle, score: myWorm.score, alive: myWorm.alive,
        radius: myWorm.radius, boosting: myWorm.boosting,
        boostFuel: Math.round(myWorm.boostFuel),
        kills: myWorm.kills, length: myWorm.length,
        color: myWorm.color,
        segments: myWorm.segments.slice(0, 80).map(s => [Math.round(s.x), Math.round(s.y)])
      } : null,
      worms: (roomStates[c.roomCode] || []).filter(w => w.id !== c.wormId),
      food: foodPayload,
      world: { w: WORLD_W, h: WORLD_H }
    };
    try { ws.send(JSON.stringify(state)); } catch (e) {}
  });
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log('Worms server on port ' + PORT);
});

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

const WORLD_W = 5000, WORLD_H = 5000;
const TICK_RATE = 30;
const FOOD_COUNT = 600;
const FOOD_COLORS = ['#ff6b6b','#ffd93d','#4ecdc4','#c44dff','#ff9f1c','#7CFFB2','#ff5fa2'];

const FOOD_TYPES = {
  normal:  { points: 1, growLen: 2, growW: 0.3 },
  bonus:   { points: 3, growLen: 5, growW: 0.6 },
  golden:  { points: 8, growLen: 6, growW: 1.0 },
  wide:    { points: 2, growLen: 1, growW: 1.5 }
};

const SKINS = [
  { id:'classic', name:'Классик', rarity:'common', pattern:'solid',    c1:'#7CFFB2', c2:'#4ecca3' },
  { id:'ember',   name:'Уголёк',  rarity:'common', pattern:'gradient', c1:'#ff6b6b', c2:'#b3001b' },
  { id:'sun',     name:'Солнце',  rarity:'common', pattern:'stripes',  c1:'#ffd93d', c2:'#ff9f1c' },
  { id:'mint',    name:'Мята',    rarity:'common', pattern:'dots',     c1:'#4ecdc4', c2:'#2e8b6f' },
  { id:'violet',  name:'Фиалка',  rarity:'rare',   pattern:'gradient', c1:'#c44dff', c2:'#6b1a8f' },
  { id:'orange',  name:'Апельсин',rarity:'rare',   pattern:'stripes',  c1:'#ff9f1c', c2:'#c46b00' },
  { id:'pink',    name:'Роза',    rarity:'rare',   pattern:'dots',     c1:'#ff5fa2', c2:'#a83265' },
  { id:'ice',     name:'Лёд',     rarity:'rare',   pattern:'gradient', c1:'#a0e9ff', c2:'#4a9bc4' },
  { id:'toxic',   name:'Токсин',  rarity:'epic',   pattern:'stripes',  c1:'#a8ff3e', c2:'#5a991e' },
  { id:'blood',   name:'Кровь',   rarity:'epic',   pattern:'dots',     c1:'#ff2e4d', c2:'#8f0018' },
  { id:'void',    name:'Пустота', rarity:'legendary',pattern:'gradient',c1:'#5a2a8e', c2:'#120524' },
  { id:'gold',    name:'Золото',  rarity:'legendary',pattern:'stripes',c1:'#ffcc00', c2:'#a87800' }
];

const CASES = [
  { id:'common',    name:'Обычный',     price:100,  chances:{ common:0.70, rare:0.25, epic:0.045, legendary:0.005 } },
  { id:'rare',      name:'Редкий',      price:300,  chances:{ common:0.30, rare:0.50, epic:0.18,  legendary:0.02  } },
  { id:'legendary', name:'Легендарный', price:1000, chances:{ common:0.00, rare:0.20, epic:0.55,  legendary:0.25  } }
];

const profiles = {};

function createProfile(name, password, isAdmin) {
  if (profiles[name]) return null;
  profiles[name] = {
    name, password: password || '',
    coins: isAdmin ? 999999 : 500,
    skins: isAdmin ? SKINS.map(s => s.id) : ['classic'],
    activeSkin: 'classic',
    isAdmin: !!isAdmin,
    kills: 0, deaths: 0,
    registeredAt: Date.now()
  };
  return profiles[name];
}
function getProfile(name){ return name ? (profiles[name]||null) : null; }
if (!profiles['admin worms']) createProfile('admin worms', 'admin123', true);

function skinColor(id){ const s = SKINS.find(x => x.id === id); return s ? s.c1 : '#7CFFB2'; }
function skinById(id){ return SKINS.find(x => x.id === id) || SKINS[0]; }

function rollCase(caseId){
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
  return pool[Math.floor(Math.random()*pool.length)].id;
}

let foods = [];
let worms = {};
let nextWormId = 1;

function rand(min, max){ return min + Math.random()*(max-min); }
function randi(min, max){ return Math.floor(rand(min, max+1)); }

function makeFood(){
  const r = Math.random();
  let type = 'normal';
  if (r < 0.05) type = 'golden';
  else if (r < 0.15) type = 'bonus';
  else if (r < 0.25) type = 'wide';
  return {
    id: Math.random().toString(36).slice(2),
    x: rand(20, WORLD_W-20), y: rand(20, WORLD_H-20),
    r: type==='golden'?8:(type==='bonus'?6:4+Math.random()*3),
    type, color: FOOD_COLORS[randi(0, FOOD_COLORS.length-1)],
    pulse: Math.random()*Math.PI*2
  };
}
function initFood(){ foods=[]; for (let i=0;i<FOOD_COUNT;i++) foods.push(makeFood()); }
initFood();

function makeWorm(name, skinId){
  const id = 'w' + (nextWormId++);
  const skin = skinById(skinId);
  const w = {
    id, name: name || 'Игрок', skin: skin.id, color: skin.c1,
    x: rand(200, WORLD_W-200), y: rand(200, WORLD_H-200),
    angle: Math.random()*Math.PI*2, targetAngle: 0,
    baseSpeed: 160, speed: 160, radius: 14, length: 25, gap: 8,
    segments: [], score: 0, alive: true, boosting: false, boostFuel: 100,
    kills: 0
  };
  w.targetAngle = w.angle;
  for (let i=0;i<w.length;i++) w.segments.push({ x: w.x - Math.cos(w.angle)*i*w.gap, y: w.y - Math.sin(w.angle)*i*w.gap });
  return w;
}

function normAng(a){ while(a>Math.PI)a-=Math.PI*2; while(a<-Math.PI)a+=Math.PI*2; return a; }

function updateWorm(w, dt){
  if (!w.alive) return;
  const diff = normAng(w.targetAngle - w.angle);
  // Скорость поворота зависит от размера — большой червь поворачивает медленнее
  const maxTurn = (7.5 - Math.min(2, w.radius * 0.04)) * dt;
  w.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));

  let speed = w.baseSpeed;
  if (w.boosting && w.boostFuel > 0){
    speed *= 1.9;
    w.boostFuel = Math.max(0, w.boostFuel - 40*dt);
    if (w.length > 15) w.length = Math.max(15, w.length - 3*dt);
  } else {
    w.boostFuel = Math.min(100, w.boostFuel + 15*dt);
  }
  // Чем больше радиус — тем медленнее
  speed *= 1 / (1 + (w.radius - 14) * 0.02);
  w.speed = speed;

  w.x += Math.cos(w.angle) * speed * dt;
  w.y += Math.sin(w.angle) * speed * dt;

  if (w.x < w.radius){ w.x = w.radius; w.angle = Math.PI - w.angle; w.targetAngle = w.angle; }
  if (w.x > WORLD_W - w.radius){ w.x = WORLD_W - w.radius; w.angle = Math.PI - w.angle; w.targetAngle = w.angle; }
  if (w.y < w.radius){ w.y = w.radius; w.angle = -w.angle; w.targetAngle = w.angle; }
  if (w.y > WORLD_H - w.radius){ w.y = WORLD_H - w.radius; w.angle = -w.angle; w.targetAngle = w.angle; }

  // Подгоняем длину сегментов
  const targetLen = Math.floor(w.length);
  while (w.segments.length > targetLen) w.segments.pop();
  while (w.segments.length < targetLen){
    const last = w.segments[w.segments.length-1] || { x: w.x, y: w.y };
    w.segments.push({ x: last.x, y: last.y });
  }

  // === Физика цепочки ===
  // Голова — это сегмент 0
  w.segments[0].x = w.x;
  w.segments[0].y = w.y;

  // Каждый следующий сегмент тянется за предыдущим на расстояние gap
  const gap = w.gap;
  for (let i = 1; i < w.segments.length; i++){
    const prev = w.segments[i-1];
    const cur = w.segments[i];
    let dx = cur.x - prev.x;
    let dy = cur.y - prev.y;
    let dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 0.001){
      dx = -Math.cos(w.angle);
      dy = -Math.sin(w.angle);
      dist = 1;
    }
    const targetX = prev.x + (dx/dist) * gap;
    const targetY = prev.y + (dy/dist) * gap;
    // Плавное подтягивание — «резиновая» плавность
    cur.x += (targetX - cur.x) * 0.8;
    cur.y += (targetY - cur.y) * 0.8;
  }
}

function eatCheck(w){
  for (let i=foods.length-1;i>=0;i--){
    const f = foods[i];
    const dx = f.x-w.x, dy = f.y-w.y;
    const rr = w.radius + f.r + 6;
    if (dx*dx+dy*dy < rr*rr){
      const cfg = FOOD_TYPES[f.type];
      w.score += cfg.points;
      w.length = Math.min(400, w.length + cfg.growLen);
      w.radius = Math.min(45, w.radius + cfg.growW);
      w.boostFuel = Math.min(100, w.boostFuel + (f.type==='golden'?30:10));
      foods[i] = makeFood();
    }
  }
}

function checkCollisions(){
  const list = Object.values(worms).filter(w => w.alive);
  for (let a=0;a<list.length;a++){
    const w = list[a];
    if (!w.alive) continue;
    for (let b=0;b<list.length;b++){
      if (a===b) continue;
      const o = list[b];
      if (!o.alive) continue;
      for (let s=4;s<o.segments.length;s+=2){
        const seg = o.segments[s];
        const dx = seg.x-w.x, dy = seg.y-w.y;
        const rr = w.radius + o.radius - 6;
        if (dx*dx+dy*dy < rr*rr){
          w.alive = false;
          o.kills++; o.score += Math.floor(w.score*0.3);
          const po = getProfile(o.name); if (po) po.kills++;
          const pw = getProfile(w.name); if (pw) pw.deaths++;
          for (let k=0;k<w.segments.length;k+=3){
            const seg = w.segments[k];
            const nf = makeFood();
            nf.x = seg.x+rand(-10,10); nf.y = seg.y+rand(-10,10);
            nf.color = w.color; nf.type = 'bonus';
            foods.push(nf);
          }
          break;
        }
      }
      if (!w.alive) break;
    }
  }
}

function sendProfile(ws, name){
  const prof = getProfile(name);
  if (!prof) return;
  ws.send(JSON.stringify({
    t:'profile',
    name: prof.name, coins: prof.coins, skins: prof.skins,
    activeSkin: prof.activeSkin, isAdmin: prof.isAdmin,
    kills: prof.kills, deaths: prof.deaths,
    allSkins: SKINS, cases: CASES
  }));
}

function leaderboard(){
  const arr = [];
  for (const name in profiles){
    const p = profiles[name];
    arr.push({ name:p.name, kills:p.kills, deaths:p.deaths, isAdmin:p.isAdmin });
  }
  arr.sort((a,b)=>b.kills-a.kills);
  return arr.slice(0,20);
}

const clients = new Map();

wss.on('connection', (ws) => {
  try { ws.send(JSON.stringify({ t:'leaderboard', list: leaderboard() })); } catch(e){}

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch(e){ return; }
    if (!msg || !msg.t) return;

    if (msg.t === 'ping'){
      ws.send(JSON.stringify({ t: 'pong', ts: msg.ts }));
      return;
    }

    if (msg.t === 'register'){
      const name = String(msg.name||'').trim().slice(0,16);
      const pass = String(msg.password||'').slice(0,40);
      if (name.length < 2){ ws.send(JSON.stringify({ t:'authError', message:'Имя от 2 символов' })); return; }
      if (pass.length < 4){ ws.send(JSON.stringify({ t:'authError', message:'Пароль от 4 символов' })); return; }
      if (profiles[name]){ ws.send(JSON.stringify({ t:'authError', message:'Имя уже занято' })); return; }
      createProfile(name, pass, false);
      ws.send(JSON.stringify({ t:'authOk', name }));
      sendProfile(ws, name);
      broadcastLeaderboard();
      return;
    }

    if (msg.t === 'login'){
      const name = String(msg.name||'').trim().slice(0,16);
      const pass = String(msg.password||'').slice(0,40);
      const prof = getProfile(name);
      if (!prof){ ws.send(JSON.stringify({ t:'authError', message:'Игрок не найден' })); return; }
      if (prof.password !== pass){ ws.send(JSON.stringify({ t:'authError', message:'Неверный пароль' })); return; }
      ws.send(JSON.stringify({ t:'authOk', name }));
      sendProfile(ws, name);
      return;
    }

    if (msg.t === 'changePassword'){
      const prof = getProfile(String(msg.name||'').slice(0,16));
      if (!prof) return;
      if (prof.password !== String(msg.oldPassword||'')){ ws.send(JSON.stringify({ t:'pwdError', message:'Старый пароль неверный' })); return; }
      const np = String(msg.newPassword||'');
      if (np.length < 4){ ws.send(JSON.stringify({ t:'pwdError', message:'Новый пароль от 4 символов' })); return; }
      prof.password = np;
      ws.send(JSON.stringify({ t:'pwdOk' }));
      return;
    }

    if (msg.t === 'profile'){ sendProfile(ws, String(msg.name||'').slice(0,16)); return; }

    if (msg.t === 'openCase'){
      const prof = getProfile(String(msg.name||'').slice(0,16));
      if (!prof) return;
      const c = CASES.find(x => x.id === msg.caseId);
      if (!c) return;
      if (prof.coins < c.price){ ws.send(JSON.stringify({ t:'caseResult', error:'Недостаточно монет', coins:prof.coins, skins:prof.skins })); return; }
      prof.coins -= c.price;
      const skinId = rollCase(c.id);
      const alreadyOwned = prof.skins.includes(skinId);
      if (!alreadyOwned) prof.skins.push(skinId);
      let refund = 0;
      if (alreadyOwned){
        const sk = SKINS.find(s => s.id === skinId);
        refund = sk.rarity==='legendary'?500:sk.rarity==='epic'?200:50;
        prof.coins += refund;
      }
      ws.send(JSON.stringify({ t:'caseResult', skinId, alreadyOwned, refund, coins:prof.coins, skins:prof.skins }));
      return;
    }

    if (msg.t === 'setSkin'){
      const prof = getProfile(String(msg.name||'').slice(0,16));
      if (!prof || !prof.skins.includes(msg.skinId)) return;
      prof.activeSkin = msg.skinId;
      const w = worms[msg.wormId];
      if (w){ w.skin = msg.skinId; w.color = skinColor(msg.skinId); }
      ws.send(JSON.stringify({ t:'skinSet', activeSkin: msg.skinId }));
      return;
    }

    if (msg.t === 'join'){
      const name = String(msg.name||'Игрок').slice(0,16);
      const prof = getProfile(name);
      if (!prof){ ws.send(JSON.stringify({ t:'error', message:'Сначала войдите' })); return; }
      const w = makeWorm(name, prof.activeSkin);
      worms[w.id] = w;
      clients.set(ws, { wormId: w.id, name });
      ws.send(JSON.stringify({ t:'joined', id:w.id, world:{ w:WORLD_W, h:WORLD_H } }));
      broadcastLeaderboard();
      return;
    }

    if (msg.t === 'input'){
      const c = clients.get(ws);
      if (!c) return;
      const w = worms[c.wormId];
      if (!w || !w.alive) return;
      if (typeof msg.angle === 'number') w.targetAngle = msg.angle;
      w.boosting = !!msg.boost;
      return;
    }

    if (msg.t === 'respawn'){
      const c = clients.get(ws);
      if (!c) return;
      const old = worms[c.wormId];
      if (!old) return;
      const prof = getProfile(old.name);
      const skinId = prof ? prof.activeSkin : 'classic';
      const w = makeWorm(old.name, skinId);
      delete worms[old.id];
      worms[w.id] = w;
      clients.set(ws, { wormId: w.id, name: old.name });
      ws.send(JSON.stringify({ t:'respawned', id: w.id }));
      broadcastLeaderboard();
      return;
    }
  });

  ws.on('close', () => {
    const c = clients.get(ws);
    if (c){ delete worms[c.wormId]; }
    clients.delete(ws);
    broadcastLeaderboard();
  });
});

function broadcastLeaderboard(){
  const payload = JSON.stringify({ t:'leaderboard', list: leaderboard() });
  clients.forEach((c, ws) => {
    if (ws.readyState === WebSocket.OPEN){ try { ws.send(payload); } catch(e){} }
  });
}

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now-lastTick)/1000);
  lastTick = now;
  for (const id in worms){
    const w = worms[id];
    if (w.alive){ updateWorm(w, dt); eatCheck(w); }
  }
  checkCollisions();

  const wormList = [];
  for (const id in worms){
    const w = worms[id];
    wormList.push({
      id: w.id, name: w.name, skin: w.skin, color: w.color,
      x: Math.round(w.x*10)/10, y: Math.round(w.y*10)/10,
      angle: Math.round(w.angle*1000)/1000,
      score: w.score, alive: w.alive,
      radius: Math.round(w.radius*10)/10,
      boosting: w.boosting, kills: w.kills,
      segments: w.segments.slice(0,80).map(s => [Math.round(s.x*10)/10, Math.round(s.y*10)/10])
    });
  }
  const foodPayload = foods.map(f => [Math.round(f.x), Math.round(f.y), Math.round(f.r*10)/10, f.color, f.type]);

  clients.forEach((c, ws) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const myWorm = worms[c.wormId];
    const state = {
      t:'state',
      me: myWorm ? {
        id: myWorm.id, x: Math.round(myWorm.x*10)/10, y: Math.round(myWorm.y*10)/10,
        angle: myWorm.angle, score: myWorm.score, alive: myWorm.alive,
        radius: myWorm.radius, boosting: myWorm.boosting,
        boostFuel: Math.round(myWorm.boostFuel),
        kills: myWorm.kills, length: myWorm.length,
        skin: myWorm.skin, color: myWorm.color,
        segments: myWorm.segments.slice(0,80).map(s => [Math.round(s.x*10)/10, Math.round(s.y*10)/10])
      } : null,
      worms: wormList.filter(w => w.id !== c.wormId),
      food: foodPayload,
      world: { w: WORLD_W, h: WORLD_H }
    };
    try { ws.send(JSON.stringify(state)); } catch(e){}
  });
}, 1000/TICK_RATE);

server.listen(PORT, () => console.log('Worms server on port ' + PORT));

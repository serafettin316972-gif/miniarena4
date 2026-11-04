'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = '0.0.0.0';
const START_PORT = Number(process.env.PORT || 10000);
let ACTIVE_PORT = START_PORT;
const WORLD = { width: 960, height: 600 };
const MAX_PLAYERS = 4;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let ROOM_CODE = null;
function makeRoomCode() { return Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join(''); }
const COLORS = ['#42e8d5', '#ffbd4a', '#a98bff', '#ff6c91'];
const MODES = {
  tank: { title: 'Tank Savaşı', short: 'TANK', description: 'Tankını sür, nişan al ve rakiplerini vur.', duration: 90, target: 10, action: 'ATEŞ ET', key: 'SPACE', accent: '#ffbd4a' },
  sumo: { title: 'Sumo Güreş', short: 'GÜREŞ', description: 'Rakiplerini arenanın dışına it. Son anda güç hamleni kullan!', duration: 75, target: 5, action: 'GÜÇLÜ İTİŞ', key: 'SPACE', accent: '#ff6c91' },
  push: { title: 'İtişme Arenası', short: 'İTİŞME', description: 'Merkez platformunu ele geçir, rakiplerini uzak tut.', duration: 60, target: 30, action: 'ŞOK DALGASI', key: 'SPACE', accent: '#42e8d5' },
  soccer: { title: 'Top Kapmaca', short: 'TOP', description: 'Topa yaklaş, yönünü belirle ve rakibinin kalesine gönder.', duration: 90, target: 5, action: 'ŞUT ÇEK', key: 'SPACE', accent: '#76b8ff' },
  gems: { title: 'Elmas Avı', short: 'ELMAS', description: 'Haritada beliren elmasları kap. En hızlı toplayan kazanır.', duration: 75, target: 15, action: 'DEPAR', key: 'SPACE', accent: '#b18cff' },
  survival: { title: 'Hayatta Kal', short: 'HAYATTA KAL', description: 'Üzerine gelen enerji toplarından kaç. Hayatta kaldıkça puan kazan.', duration: 75, target: 999, action: 'KAÇIŞ', key: 'SPACE', accent: '#ff875e' },
};
const MODE_IDS = Object.keys(MODES);

const players = new Map();
let hostId = null;
let modeId = 'tank';
let phase = 'lobby';
let roundEndsAt = null;
let countdownEndsAt = null;
let resultText = '';
let roundNumber = 1;
let bullets = [];
let gems = [];
let hazards = [];
let ball = null;
let lastTick = Date.now();
let lastSurvivalPoint = 0;

function random(min, max) { return min + Math.random() * (max - min); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function cleanName(value) {
  return String(value || 'Oyuncu').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 14) || 'Oyuncu';
}
function makeGem() {
  return { id: crypto.randomUUID(), x: random(70, WORLD.width - 70), y: random(70, WORLD.height - 70), kind: Math.random() < .16 ? 'bonus' : 'normal', pulse: random(0, Math.PI * 2) };
}
function makeHazard() {
  const angle = random(0, Math.PI * 2), speed = random(65, 125);
  return { id: crypto.randomUUID(), x: random(60, WORLD.width - 60), y: random(60, WORLD.height - 60), vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: random(15, 23), phase: random(0, Math.PI * 2) };
}
function spawnFor(slot) {
  const points = [
    { x: 165, y: 150, a: .2 },
    { x: 795, y: 150, a: 2.9 },
    { x: 165, y: 450, a: -.2 },
    { x: 795, y: 450, a: -2.9 },
  ];
  return points[slot % 4];
}
function resetPlayer(p) {
  const s = spawnFor(p.slot);
  p.x = s.x + random(-18, 18); p.y = s.y + random(-18, 18);
  p.vx = 0; p.vy = 0; p.angle = s.a;
  p.hp = 3; p.lives = 3; p.alive = true; p.respawnAt = 0;
  p.invulnerableUntil = Date.now() + 1200;
  p.powerUntil = 0; p.controlMs = 0; p.score = 0; p.kos = 0; p.deaths = 0;
  p.input = { x: 0, y: 0, action: false }; p.actionWasDown = false; p.actionReadyAt = 0;
}
function createPlayer(name) {
  const slot = [0, 1, 2, 3].find(n => ![...players.values()].some(p => p.slot === n));
  if (slot === undefined) return null;
  const id = crypto.randomUUID();
  const p = { id, slot, name: cleanName(name), color: COLORS[slot], x: 0, y: 0, vx: 0, vy: 0, angle: 0, score: 0, hp: 3, lives: 3, alive: true, respawnAt: 0, invulnerableUntil: 0, powerUntil: 0, controlMs: 0, kos: 0, deaths: 0, lastHitBy: null, input: { x: 0, y: 0, action: false }, actionWasDown: false, actionReadyAt: 0, lastSeen: Date.now(), lastInputAt: Date.now() };
  resetPlayer(p);
  players.set(id, p);
  if (!hostId) hostId = id;
  return { token: id, player: { id, name: p.name, color: p.color }, isHost: id === hostId };
}
function resetWorld() {
  bullets = [];
  gems = [];
  hazards = [];
  ball = null;
  for (const p of players.values()) resetPlayer(p);
  if (modeId === 'gems') for (let i = 0; i < 18; i++) gems.push(makeGem());
  if (modeId === 'survival') for (let i = 0; i < 8; i++) hazards.push(makeHazard());
  if (modeId === 'soccer') ball = { x: WORLD.width / 2, y: WORLD.height / 2, vx: 0, vy: 0, lastKickBy: null, spin: 0 };
  lastSurvivalPoint = Date.now();
}
function changePhaseToLobby() {
  phase = 'lobby'; roundEndsAt = null; countdownEndsAt = null; resultText = '';
  bullets = []; gems = []; hazards = []; ball = null;
  for (const p of players.values()) resetPlayer(p);
}
function beginCountdown() {
  if (players.size < 2) return { error: 'Başlamak için en az 2 oyuncu gerekli.' };
  if (phase === 'running' || phase === 'countdown') return { error: 'Tur zaten başladı.' };
  resetWorld();
  phase = 'countdown';
  countdownEndsAt = Date.now() + 3200;
  resultText = '';
  return { ok: true };
}
function finishRound(reason) {
  const list = [...players.values()];
  if (!list.length) resultText = 'Tur sona erdi.';
  else {
    const ordered = [...list].sort((a, b) => b.score - a.score || b.kos - a.kos);
    const top = ordered[0];
    const tied = ordered.filter(p => p.score === top.score);
    resultText = tied.length > 1 ? `Berabere! ${top.score} puan` : `${top.name} kazandı! ${top.score} puan`;
  }
  if (reason === 'target') resultText += ' · Hedefe ilk ulaşan!';
  phase = 'finished'; roundEndsAt = null; countdownEndsAt = null;
}
function checkTarget() {
  const m = MODES[modeId];
  if (m.target >= 999) return;
  const winner = [...players.values()].find(p => p.score >= m.target);
  if (winner) finishRound('target');
}
function actionReady(p, now) {
  const down = Boolean(p.input.action);
  const pressed = down && !p.actionWasDown;
  p.actionWasDown = down;
  if (pressed && now >= p.actionReadyAt && p.alive) return true;
  return false;
}
function keepInBounds(p, margin = 22) {
  if (p.x < margin) { p.x = margin; p.vx = Math.abs(p.vx) * .25; }
  if (p.x > WORLD.width - margin) { p.x = WORLD.width - margin; p.vx = -Math.abs(p.vx) * .25; }
  if (p.y < margin) { p.y = margin; p.vy = Math.abs(p.vy) * .25; }
  if (p.y > WORLD.height - margin) { p.y = WORLD.height - margin; p.vy = -Math.abs(p.vy) * .25; }
}
function movePlayer(p, dt, speed, acceleration = 10) {
  if (!p.alive || Date.now() < p.invulnerableUntil) return;
  const ix = Number(p.input.x) || 0, iy = Number(p.input.y) || 0;
  const len = Math.hypot(ix, iy);
  const nx = len > 0 ? ix / len : 0, ny = len > 0 ? iy / len : 0;
  if (len > 0.08) p.angle = Math.atan2(ny, nx);
  const targetVx = nx * speed, targetVy = ny * speed;
  const blend = Math.min(1, acceleration * dt);
  p.vx += (targetVx - p.vx) * blend;
  p.vy += (targetVy - p.vy) * blend;
  if (len < .08) { p.vx *= Math.pow(.045, dt); p.vy *= Math.pow(.045, dt); }
  p.x += p.vx * dt; p.y += p.vy * dt;
}
function respawnPlayers(now) {
  for (const p of players.values()) {
    if (!p.alive && p.respawnAt && now >= p.respawnAt && p.lives > 0) {
      const slot = p.slot; const s = spawnFor(slot);
      p.x = s.x + random(-28, 28); p.y = s.y + random(-28, 28);
      p.vx = 0; p.vy = 0; p.alive = true; p.hp = 3; p.respawnAt = 0; p.invulnerableUntil = now + 1600;
    }
  }
}
function collidePlayers(pushScale = 1) {
  const list = [...players.values()].filter(p => p.alive);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    let dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy) || .001;
    const min = 43;
    if (d >= min) continue;
    const nx = dx / d, ny = dy / d, overlap = min - d;
    a.x -= nx * overlap * .5; a.y -= ny * overlap * .5;
    b.x += nx * overlap * .5; b.y += ny * overlap * .5;
    let strength = (115 + (a.powerUntil > Date.now() ? 250 : 0) + (b.powerUntil > Date.now() ? 250 : 0)) * pushScale;
    a.vx -= nx * strength * .08; a.vy -= ny * strength * .08;
    b.vx += nx * strength * .08; b.vy += ny * strength * .08;
    const now = Date.now();
    if (a.powerUntil > now && b.invulnerableUntil < now) { b.vx += nx * 250; b.vy += ny * 250; b.lastHitBy = a.id; }
    if (b.powerUntil > now && a.invulnerableUntil < now) { a.vx -= nx * 250; a.vy -= ny * 250; a.lastHitBy = b.id; }
  }
}
function dropOut(p, now) {
  if (!p.alive) return;
  p.alive = false; p.deaths++; p.lives = Math.max(0, p.lives - 1); p.respawnAt = p.lives > 0 ? now + 1500 : 0;
  const attacker = p.lastHitBy && players.get(p.lastHitBy);
  if (attacker && attacker.id !== p.id) { attacker.score++; attacker.kos++; }
  p.lastHitBy = null;
}
function tickTank(dt, now) {
  for (const p of players.values()) {
    movePlayer(p, dt, 205, 12); keepInBounds(p);
    if (actionReady(p, now)) {
      p.actionReadyAt = now + 520;
      const speed = 520;
      bullets.push({ id: crypto.randomUUID(), owner: p.id, x: p.x + Math.cos(p.angle) * 29, y: p.y + Math.sin(p.angle) * 29, vx: Math.cos(p.angle) * speed, vy: Math.sin(p.angle) * speed, life: 1.45, r: 7 });
    }
  }
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.life <= 0 || b.x < 0 || b.x > WORLD.width || b.y < 0 || b.y > WORLD.height) { bullets.splice(i, 1); continue; }
    for (const p of players.values()) {
      if (p.id === b.owner || !p.alive || now < p.invulnerableUntil) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y) < 25) {
        p.hp--; p.vx += b.vx * .16; p.vy += b.vy * .16; p.lastHitBy = b.owner;
        if (p.hp <= 0) {
          const attacker = players.get(b.owner); if (attacker) { attacker.score++; attacker.kos++; }
          p.deaths++; p.hp = 3; p.x = spawnFor(p.slot).x; p.y = spawnFor(p.slot).y; p.vx = 0; p.vy = 0; p.invulnerableUntil = now + 2200;
        }
        bullets.splice(i, 1); break;
      }
    }
  }
}
function tickSumo(dt, now) {
  for (const p of players.values()) {
    if (p.lives <= 0) { p.alive = false; continue; }
    movePlayer(p, dt, 190, 9);
    if (actionReady(p, now)) { p.actionReadyAt = now + 1850; p.powerUntil = now + 380; }
  }
  collidePlayers(1.25);
  const cx = WORLD.width / 2, cy = WORLD.height / 2, radius = 251;
  for (const p of players.values()) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d > radius + 21) dropOut(p, now);
    else {
      // Soft radial resistance keeps the fight centered without making ring-outs impossible.
      if (d > radius - 25) { const k = (d - (radius - 25)) / 46; p.vx -= ((p.x - cx) / (d || 1)) * 190 * k * dt; p.vy -= ((p.y - cy) / (d || 1)) * 190 * k * dt; }
    }
  }
  respawnPlayers(now);
}
function tickPush(dt, now) {
  for (const p of players.values()) {
    movePlayer(p, dt, 220, 12); keepInBounds(p);
    if (actionReady(p, now)) {
      p.actionReadyAt = now + 2450; p.powerUntil = now + 260;
      for (const other of players.values()) {
        if (other.id === p.id || !other.alive) continue;
        const dx = other.x - p.x, dy = other.y - p.y, d = Math.hypot(dx, dy);
        if (d < 155 && d > 0) { const force = 680 * (1 - d / 155); other.vx += dx / d * force; other.vy += dy / d * force; other.lastHitBy = p.id; }
      }
    }
  }
  collidePlayers(.95);
  const cx = WORLD.width / 2, cy = WORLD.height / 2, r = 112;
  for (const p of players.values()) if (p.alive && Math.hypot(p.x - cx, p.y - cy) < r) p.controlMs += dt * 1000;
  for (const p of players.values()) {
    const points = Math.floor(p.controlMs / 1000);
    if (points > p.score) p.score = points;
  }
}
function tickSoccer(dt, now) {
  for (const p of players.values()) {
    movePlayer(p, dt, 225, 11); keepInBounds(p, 30);
    if (actionReady(p, now)) {
      p.actionReadyAt = now + 580;
      const dx = ball.x - p.x, dy = ball.y - p.y, d = Math.hypot(dx, dy);
      if (d < 90) {
        let ax = Math.cos(p.angle), ay = Math.sin(p.angle);
        if (Math.hypot(p.input.x, p.input.y) < .1 && d > 1) { ax = dx / d; ay = dy / d; }
        ball.vx += ax * 620; ball.vy += ay * 620; ball.lastKickBy = p.id;
      }
    }
  }
  collidePlayers(.55);
  ball.x += ball.vx * dt; ball.y += ball.vy * dt;
  const damp = Math.pow(.32, dt); ball.vx *= damp; ball.vy *= damp; ball.spin += dt * 5;
  const goalHalf = 88;
  let scoring = null, conceded = null;
  // Four goals; shooting into someone else's goal gives the last kicker a point.
  if (ball.x < 15 && Math.abs(ball.y - WORLD.height / 2) < goalHalf) { conceded = 0; scoring = ball.lastKickBy; }
  else if (ball.x > WORLD.width - 15 && Math.abs(ball.y - WORLD.height / 2) < goalHalf) { conceded = 1; scoring = ball.lastKickBy; }
  else if (ball.y < 15 && Math.abs(ball.x - WORLD.width / 2) < goalHalf) { conceded = 2; scoring = ball.lastKickBy; }
  else if (ball.y > WORLD.height - 15 && Math.abs(ball.x - WORLD.width / 2) < goalHalf) { conceded = 3; scoring = ball.lastKickBy; }
  if (conceded !== null) {
    const shooter = scoring && players.get(scoring);
    const goalkeeper = [...players.values()].find(p => p.slot === conceded);
    if (shooter) shooter.score += shooter === goalkeeper ? -1 : 1;
    ball.x = WORLD.width / 2; ball.y = WORLD.height / 2; ball.vx = 0; ball.vy = 0; ball.lastKickBy = null;
  }
  if (ball.x < 16 || ball.x > WORLD.width - 16) { ball.vx *= -.7; ball.x = clamp(ball.x, 16, WORLD.width - 16); }
  if (ball.y < 16 || ball.y > WORLD.height - 16) { ball.vy *= -.7; ball.y = clamp(ball.y, 16, WORLD.height - 16); }
}
function tickGems(dt, now) {
  for (const p of players.values()) {
    const dash = p.powerUntil > now;
    movePlayer(p, dt, dash ? 350 : 205, 12); keepInBounds(p);
    if (actionReady(p, now)) { p.actionReadyAt = now + 1550; p.powerUntil = now + 360; }
  }
  for (let i = gems.length - 1; i >= 0; i--) {
    const g = gems[i];
    for (const p of players.values()) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - g.x, p.y - g.y) < 29) {
        p.score += g.kind === 'bonus' ? 3 : 1;
        gems.splice(i, 1); gems.push(makeGem()); break;
      }
    }
  }
}
function tickSurvival(dt, now) {
  for (const p of players.values()) {
    if (!p.alive) continue;
    movePlayer(p, dt, p.powerUntil > now ? 345 : 210, 12); keepInBounds(p);
    if (actionReady(p, now)) { p.actionReadyAt = now + 1700; p.powerUntil = now + 420; }
  }
  for (const h of hazards) {
    h.x += h.vx * dt; h.y += h.vy * dt; h.phase += dt * 4;
    if (h.x < h.r || h.x > WORLD.width - h.r) h.vx *= -1;
    if (h.y < h.r || h.y > WORLD.height - h.r) h.vy *= -1;
    h.x = clamp(h.x, h.r, WORLD.width - h.r); h.y = clamp(h.y, h.r, WORLD.height - h.r);
    for (const p of players.values()) {
      if (!p.alive || now < p.invulnerableUntil) continue;
      if (Math.hypot(p.x - h.x, p.y - h.y) < h.r + 17) {
        p.lives--; p.deaths++; p.invulnerableUntil = now + 1700;
        p.vx += (p.x - h.x) * 4; p.vy += (p.y - h.y) * 4;
        if (p.lives <= 0) p.alive = false;
        else { const s = spawnFor(p.slot); p.x = s.x; p.y = s.y; }
      }
    }
  }
  if (now - lastSurvivalPoint >= 1000) {
    lastSurvivalPoint = now;
    for (const p of players.values()) if (p.alive) p.score++;
  }
}
function tick() {
  const now = Date.now();
  const dt = Math.min(.05, Math.max(0, (now - lastTick) / 1000));
  lastTick = now;
  for (const [id, p] of players) {
    if (now - p.lastSeen > 20000) {
      players.delete(id);
      if (hostId === id) hostId = players.size ? players.keys().next().value : null;
    }
    if (now - p.lastInputAt > 500) p.input = { x: 0, y: 0, action: false };
  }
  if (!players.size && ROOM_CODE) { ROOM_CODE = null; changePhaseToLobby(); }
  if (phase === 'countdown') {
    if (players.size < 2) { phase = 'lobby'; countdownEndsAt = null; resultText = 'Başlamak için en az 2 oyuncu gerekli.'; }
    else if (now >= countdownEndsAt) { phase = 'running'; roundEndsAt = now + MODES[modeId].duration * 1000; }
    return;
  }
  if (phase !== 'running') return;
  if (modeId === 'tank') tickTank(dt, now);
  else if (modeId === 'sumo') tickSumo(dt, now);
  else if (modeId === 'push') tickPush(dt, now);
  else if (modeId === 'soccer') tickSoccer(dt, now);
  else if (modeId === 'gems') tickGems(dt, now);
  else if (modeId === 'survival') tickSurvival(dt, now);
  if (phase !== 'running') return;
  checkTarget();
  if (phase === 'running' && now >= roundEndsAt) finishRound('time');
}
function publicState(req) {
  const token = req.headers['x-player-token'];
  const self = token ? players.get(String(token)) : null;
  const now = Date.now();
  return {
    world: WORLD, roomCode: self ? ROOM_CODE : null, mode: modeId, modes: MODES, phase,
    timeLeft: phase === 'running' ? Math.max(0, roundEndsAt - now) : 0,
    countdown: phase === 'countdown' ? Math.max(0, countdownEndsAt - now) : 0,
    resultText, roundNumber, maxPlayers: MAX_PLAYERS, playersCount: players.size,
    hostId, selfId: self ? self.id : null, isHost: Boolean(self && self.id === hostId),
    players: [...players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, slot: p.slot, x: p.x, y: p.y, angle: p.angle, vx: p.vx, vy: p.vy, score: p.score, hp: p.hp, lives: p.lives, alive: p.alive, power: p.powerUntil > now, controlMs: p.controlMs, isHost: p.id === hostId, invulnerable: p.invulnerableUntil > now })),
    bullets: bullets.map(b => ({ x: b.x, y: b.y, r: b.r })),
    gems: gems.map(g => ({ x: g.x, y: g.y, kind: g.kind, pulse: g.pulse })),
    hazards: hazards.map(h => ({ x: h.x, y: h.y, r: h.r, phase: h.phase })),
    ball: ball ? { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, spin: ball.spin } : null,
  };
}
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 12000) { reject(new Error('İstek çok büyük.')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Geçersiz istek.')); } });
    req.on('error', reject);
  });
}
function getPlayer(req) {
  const token = req.headers['x-player-token'];
  const p = token ? players.get(String(token)) : null;
  if (p) p.lastSeen = Date.now();
  return p;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/') {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length, 'Cache-Control': 'no-store' });
    return res.end(html);
  }
  if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true, mode: 'online', roomActive: Boolean(ROOM_CODE) });
  if (req.method === 'GET' && url.pathname === '/api/state') return sendJson(res, 200, publicState(req));
  if (req.method === 'POST' && url.pathname === '/api/create-room') {
    try {
      const body = await readBody(req);
      if (ROOM_CODE && players.size > 0) return sendJson(res, 409, { error: 'Şu anda açık bir oda var. Arkadaşların davet koduyla katılsın.' });
      ROOM_CODE = makeRoomCode(); modeId = 'tank'; roundNumber = 1; changePhaseToLobby();
      const created = createPlayer(body.name);
      if (!created) { ROOM_CODE = null; return sendJson(res, 409, { error: 'Oda oluşturulamadı.' }); }
      return sendJson(res, 201, { ...created, code: ROOM_CODE });
    } catch (error) { return sendJson(res, 400, { error: error.message || 'Oda oluşturulamadı.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/join') {
    try {
      const body = await readBody(req);
      if (!ROOM_CODE) return sendJson(res, 404, { error: 'Henüz açık bir oda yok. Önce bir oyuncu oda oluşturmalı.' });
      if (String(body.code || '').trim().toUpperCase() !== ROOM_CODE) return sendJson(res, 403, { error: 'Davet kodu yanlış. Oda sahibinden güncel kodu iste.' });
      if (players.size >= MAX_PLAYERS) return sendJson(res, 409, { error: 'Oda dolu. En fazla 4 kişi oynayabilir.' });
      const created = createPlayer(body.name);
      if (!created) return sendJson(res, 409, { error: 'Oda dolu. En fazla 4 kişi oynayabilir.' });
      return sendJson(res, 201, created);
    } catch (error) { return sendJson(res, 400, { error: error.message || 'Oyuncu eklenemedi.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/rejoin') {
    try {
      const body = await readBody(req);
      const p = players.get(String(body.token || ''));
      if (!p) return sendJson(res, 404, { error: 'Oyuncu oturumu bulunamadı. Yeniden katıl.' });
      p.lastSeen = Date.now(); p.lastInputAt = Date.now();
      return sendJson(res, 200, { ok: true, player: { id: p.id, name: p.name, color: p.color }, isHost: p.id === hostId });
    } catch (error) { return sendJson(res, 400, { error: error.message || 'Oturum yenilenemedi.' }); }
  }
  if (req.method === 'POST' && ['/api/input', '/api/frame'].includes(url.pathname)) {
    const p = getPlayer(req); if (!p) return sendJson(res, 401, { error: 'Oyuncu oturumu bulunamadı. Yeniden katıl.' });
    try {
      const body = await readBody(req);
      p.input = { x: clamp(Number(body.x) || 0, -1, 1), y: clamp(Number(body.y) || 0, -1, 1), action: Boolean(body.action) };
      p.lastInputAt = Date.now(); return sendJson(res, 200, url.pathname === '/api/frame' ? publicState(req) : { ok: true });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/host/mode') {
    const p = getPlayer(req); if (!p || p.id !== hostId) return sendJson(res, 403, { error: 'Modu yalnızca oda sahibi seçebilir.' });
    if (!['lobby', 'finished'].includes(phase)) return sendJson(res, 409, { error: 'Tur sürerken mod değiştirilemez.' });
    try {
      const body = await readBody(req); if (!MODES[body.mode]) return sendJson(res, 400, { error: 'Geçersiz oyun modu.' });
      modeId = body.mode; changePhaseToLobby(); roundNumber++; return sendJson(res, 200, { ok: true });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/host/start') {
    const p = getPlayer(req); if (!p || p.id !== hostId) return sendJson(res, 403, { error: 'Oyunu yalnızca oda sahibi başlatabilir.' });
    if (phase === 'finished') changePhaseToLobby();
    if (phase !== 'lobby') return sendJson(res, 409, { error: 'Oyun şu anda başlatılamaz.' });
    const result = beginCountdown(); return sendJson(res, result.error ? 409 : 200, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/host/lobby') {
    const p = getPlayer(req); if (!p || p.id !== hostId) return sendJson(res, 403, { error: 'Bu işlemi yalnızca oda sahibi yapabilir.' });
    changePhaseToLobby(); return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/leave') {
    const p = getPlayer(req);
    if (p) {
      players.delete(p.id);
      if (hostId === p.id) hostId = players.size ? players.keys().next().value : null;
    }
    if (!players.size) { ROOM_CODE = null; changePhaseToLobby(); }
    if (players.size < 2 && ['countdown', 'running'].includes(phase)) changePhaseToLobby();
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 404, { error: 'Bulunamadı.' });
});

setInterval(tick, 1000 / 30);
function listen(port) {
  ACTIVE_PORT = port;
  const onError = error => {
    server.removeListener('listening', onListening);
    if (error.code === 'EADDRINUSE' && port < START_PORT + 20) { console.log(`Port ${port} kullanımda, ${port + 1} deneniyor...`); listen(port + 1); return; }
    console.error('Sunucu başlatılamadı:', error.message); process.exitCode = 1;
  };
  const onListening = () => {
    server.removeListener('error', onError);
    console.log('\n  ========================================================');
    console.log('             MINI ARENA 4 - ONLINE');
    console.log('  ========================================================\n');
    console.log('  SUNUCU HAZIR. ODA KODU SİTEDE OLUŞTURULUR.');
    console.log('  Site üzerinden ODA OLUŞTUR butonuna basınca');
    console.log('  yeni 6 karakterli davet kodu ekranda gösterilir.');
    console.log(`\n  PORT: ${ACTIVE_PORT}`);
    if (process.env.RENDER_EXTERNAL_URL) console.log(`  ONLINE SITE: ${process.env.RENDER_EXTERNAL_URL}`);
    console.log('  En fazla 4 oyuncu. Tek seferde bir aktif oda.\n');
  };
  server.once('error', onError); server.once('listening', onListening); server.listen(port, HOST);
}
listen(START_PORT);
function shutdown() { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 1200).unref(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

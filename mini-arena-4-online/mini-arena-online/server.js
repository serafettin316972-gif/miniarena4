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
  tank: { title: 'Tank Savaşı', short: 'TANK', description: 'Tankını sür, siperleri kullan ve rakiplerini vur.', duration: 90, target: 15, action: 'ATEŞ ET', key: 'SPACE', accent: '#ffbd4a' },
  sumo: { title: 'Sumo Güreş', short: 'GÜREŞ', description: 'Daralan ringde rakiplerini dışarı gönder. İki hakkın var!', duration: 75, target: 8, action: 'GÜÇLÜ İTİŞ', key: 'SPACE', accent: '#ff6c91' },
  push: { title: 'İtişme Arenası', short: 'İTİŞME', description: 'Küçülen merkez alanını ele geçir, rakiplerini şok dalgasıyla savur.', duration: 60, target: 45, action: 'ŞOK DALGASI', key: 'SPACE', accent: '#42e8d5' },
  soccer: { title: 'Top Kapmaca', short: 'TOP', description: 'Dört küçük kaleden birine daha isabetli şutlar gönder.', duration: 90, target: 8, action: 'ŞUT ÇEK', key: 'SPACE', accent: '#76b8ff' },
  gems: { title: 'Elmas Avı', short: 'ELMAS', description: 'Daha az çıkan elmasları kap. Altın elmaslar 3 puan!', duration: 75, target: 23, action: 'DEPAR', key: 'SPACE', accent: '#b18cff' },
  survival: { title: 'Meteor Yağmuru', short: 'HAYATTA KAL', description: 'Meteor dalgalarından kaç, avcı meteordan sıyrıl ve can kristallerini topla.', duration: 90, target: 999, action: 'KALKAN DEPARI', key: 'SPACE', accent: '#ff875e' },
  hotpotato: { title: 'Bomba Pasla', short: 'BOMBA', description: 'Bomba sende patlamadan SPACE ile yakındaki rakibe pasla. Patlayan oyuncu can kaybeder!', duration: 75, target: 6, action: 'BOMBA PASLA', key: 'SPACE', accent: '#ff5b62' },
  floor: { title: 'Çöken Zemin', short: 'ZEMİN', description: 'Üzerinde durduğun karo çatlayıp çöker. Sürekli hareket et, boşluğa düşme!', duration: 80, target: 15, action: 'ZIPLA', key: 'SPACE', accent: '#70d6ff' },
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
let survivalLoot = [];
let survivalNextHazardAt = 0;
let survivalNextLootAt = 0;
let survivalStartedAt = 0;
let survivalHunterSpawned = false;
let survivalWave = 1;
let bombHolderId = null;
let bombExplodesAt = 0;
const FLOOR_COLS = 12, FLOOR_ROWS = 8;
let floorTiles = [];
let floorScoreAt = 0;

function random(min, max) { return min + Math.random() * (max - min); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function cleanName(value) {
  return String(value || 'Oyuncu').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 14) || 'Oyuncu';
}
function makeGem() {
  return { id: crypto.randomUUID(), x: random(70, WORLD.width - 70), y: random(70, WORLD.height - 70), kind: Math.random() < .16 ? 'bonus' : 'normal', pulse: random(0, Math.PI * 2) };
}
function makeHazard(hunter = false, multiplier = 1) {
  const angle = random(0, Math.PI * 2), speed = (hunter ? random(118, 145) : random(98, 188)) * multiplier;
  return { id: crypto.randomUUID(), x: random(70, WORLD.width - 70), y: random(70, WORLD.height - 70), vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: hunter ? 29 : random(16, 24), phase: random(0, Math.PI * 2), hunter };
}
function makeSurvivalLoot() {
  return { id: crypto.randomUUID(), x: random(80, WORLD.width - 80), y: random(80, WORLD.height - 80) };
}
function makeFloor() {
  floorTiles = [];
  for (let row = 0; row < FLOOR_ROWS; row++) for (let col = 0; col < FLOOR_COLS; col++) {
    floorTiles.push({ col, row, alive: true, crackAt: 0 });
  }
}
function floorIndexAt(x, y) {
  const col = clamp(Math.floor(x / (WORLD.width / FLOOR_COLS)), 0, FLOOR_COLS - 1);
  const row = clamp(Math.floor(y / (WORLD.height / FLOOR_ROWS)), 0, FLOOR_ROWS - 1);
  return row * FLOOR_COLS + col;
}
function randomSafeFloorSpot() {
  const safe = floorTiles.filter(tile => tile.alive);
  if (!safe.length) return null;
  const tile = safe[Math.floor(Math.random() * safe.length)];
  return { x: (tile.col + .5) * (WORLD.width / FLOOR_COLS), y: (tile.row + .5) * (WORLD.height / FLOOR_ROWS) };
}
function spawnFor(slot) {
  if (modeId === 'sumo') {
    const sumoPoints = [
      { x: 480, y: 430, a: -Math.PI/2 },
      { x: 650, y: 300, a: Math.PI },
      { x: 480, y: 170, a: Math.PI/2 },
      { x: 310, y: 300, a: 0 },
    ];
    return sumoPoints[slot % 4];
  }
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
function cleanSkin(value) { return ['tooth', 'hair', 'pink', 'ghost', 'alien', 'wizard'].includes(value) ? value : 'tooth'; }
function createPlayer(name, skin) {
  const slot = [0, 1, 2, 3].find(n => ![...players.values()].some(p => p.slot === n));
  if (slot === undefined) return null;
  const id = crypto.randomUUID();
  const p = { id, slot, name: cleanName(name), skin: cleanSkin(skin), color: COLORS[slot], x: 0, y: 0, vx: 0, vy: 0, angle: 0, score: 0, hp: 3, lives: 3, alive: true, respawnAt: 0, invulnerableUntil: 0, powerUntil: 0, controlMs: 0, kos: 0, deaths: 0, lastHitBy: null, input: { x: 0, y: 0, action: false }, actionWasDown: false, actionReadyAt: 0, lastSeen: Date.now(), lastInputAt: Date.now() };
  resetPlayer(p);
  players.set(id, p);
  if (!hostId) hostId = id;
  return { token: id, player: { id, name: p.name, color: p.color, skin: p.skin }, isHost: id === hostId };
}
function resetWorld() {
  bullets = [];
  gems = [];
  hazards = [];
  survivalLoot = [];
  floorTiles = [];
  ball = null;
  bombHolderId = null;
  bombExplodesAt = 0;
  const now = Date.now();
  for (const p of players.values()) {
    resetPlayer(p);
    if (modeId === 'tank') p.hp = 2;
    if (['sumo', 'survival', 'hotpotato', 'floor'].includes(modeId)) p.lives = 2;
  }
  if (modeId === 'gems') for (let i = 0; i < 14; i++) gems.push(makeGem());
  if (modeId === 'survival') {
    for (let i = 0; i < 12; i++) hazards.push(makeHazard(false, 1));
    survivalStartedAt = now; survivalNextHazardAt = now + 5200; survivalNextLootAt = now + 4200;
    survivalHunterSpawned = false; survivalWave = 1;
  }
  if (modeId === 'soccer') ball = { x: WORLD.width / 2, y: WORLD.height / 2, vx: 0, vy: 0, lastKickBy: null, spin: 0 };
  if (modeId === 'hotpotato') {
    const alive = [...players.values()].filter(p => p.alive);
    bombHolderId = alive[Math.floor(Math.random() * alive.length)]?.id || null;
    bombExplodesAt = now + 7200;
  }
  if (modeId === 'floor') { makeFloor(); floorScoreAt = now + 1800; }
  lastSurvivalPoint = now;
}
function changePhaseToLobby() {
  phase = 'lobby'; roundEndsAt = null; countdownEndsAt = null; resultText = '';
  bullets = []; gems = []; hazards = []; survivalLoot = []; floorTiles = []; ball = null;
  bombHolderId = null; bombExplodesAt = 0;
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
  if (reason === 'last') resultText += ' · Son kalan kazandı!';
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
      p.actionReadyAt = now + 570;
      const speed = 570;
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
          p.deaths++; p.hp = 2; p.x = spawnFor(p.slot).x; p.y = spawnFor(p.slot).y; p.vx = 0; p.vy = 0; p.invulnerableUntil = now + 2200;
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
  const cx = WORLD.width / 2, cy = WORLD.height / 2, radius = 236;
  for (const p of players.values()) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d > radius + 21) dropOut(p, now);
    else {
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
  const cx = WORLD.width / 2, cy = WORLD.height / 2, r = 94;
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
  const goalHalf = 70;
  let scoring = null, conceded = null;
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
    if (actionReady(p, now)) { p.actionReadyAt = now + 1750; p.powerUntil = now + 330; }
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
  survivalWave = 1 + Math.floor((now - survivalStartedAt) / 15000);
  for (const p of players.values()) {
    if (!p.alive) continue;
    movePlayer(p, dt, p.powerUntil > now ? 370 : 220, 13); keepInBounds(p);
    if (actionReady(p, now)) {
      p.actionReadyAt = now + 1850; p.powerUntil = now + 430;
    }
  }
  if (now >= survivalNextHazardAt && hazards.length < 18) {
    const multiplier = 1 + Math.min(.35, (survivalWave - 1) * .06);
    hazards.push(makeHazard(false, multiplier));
    survivalNextHazardAt = now + Math.max(3400, 5600 - survivalWave * 180);
  }
  if (!survivalHunterSpawned && now - survivalStartedAt >= 20000) {
    hazards.push(makeHazard(true, 1)); survivalHunterSpawned = true;
  }
  for (const h of hazards) {
    if (h.hunter) {
      let target = null, best = Infinity;
      for (const p of players.values()) if (p.alive) {
        const d2 = (p.x - h.x) ** 2 + (p.y - h.y) ** 2;
        if (d2 < best) { best = d2; target = p; }
      }
      if (target) {
        const dx = target.x - h.x, dy = target.y - h.y, d = Math.hypot(dx, dy) || 1, speed = 138 + Math.min(35, survivalWave * 3);
        h.vx += (dx / d * speed - h.vx) * Math.min(1, dt * 1.8);
        h.vy += (dy / d * speed - h.vy) * Math.min(1, dt * 1.8);
      }
    }
    h.x += h.vx * dt; h.y += h.vy * dt; h.phase += dt * 4;
    if (h.x < h.r || h.x > WORLD.width - h.r) h.vx *= -1;
    if (h.y < h.r || h.y > WORLD.height - h.r) h.vy *= -1;
    h.x = clamp(h.x, h.r, WORLD.width - h.r); h.y = clamp(h.y, h.r, WORLD.height - h.r);
    for (const p of players.values()) {
      if (!p.alive || now < p.invulnerableUntil || p.powerUntil > now) continue;
      if (Math.hypot(p.x - h.x, p.y - h.y) < h.r + 17) {
        p.lives--; p.deaths++; p.invulnerableUntil = now + 1450;
        p.vx += (p.x - h.x) * 4; p.vy += (p.y - h.y) * 4;
        if (p.lives <= 0) p.alive = false;
        else { const s = spawnFor(p.slot); p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0; }
      }
    }
  }
  if (now >= survivalNextLootAt && survivalLoot.length < 2) {
    survivalLoot.push(makeSurvivalLoot()); survivalNextLootAt = now + 8500;
  }
  for (let i = survivalLoot.length - 1; i >= 0; i--) {
    const loot = survivalLoot[i];
    for (const p of players.values()) if (p.alive && Math.hypot(p.x - loot.x, p.y - loot.y) < 31) {
      p.score += 4; p.lives = Math.min(2, p.lives + 1); survivalLoot.splice(i, 1); break;
    }
  }
  if (now - lastSurvivalPoint >= 1000) {
    lastSurvivalPoint = now;
    for (const p of players.values()) if (p.alive) p.score++;
  }
}
function tickHotPotato(dt, now) {
  for (const p of players.values()) {
    if (!p.alive) continue;
    movePlayer(p, dt, p.powerUntil > now ? 300 : 220, 12); keepInBounds(p);
    if (actionReady(p, now)) {
      p.actionReadyAt = now + 720;
      if (p.id === bombHolderId) {
        let nearest = null, nearestDistance = 145;
        for (const other of players.values()) if (other.alive && other.id !== p.id) {
          const d = Math.hypot(other.x - p.x, other.y - p.y);
          if (d < nearestDistance) { nearestDistance = d; nearest = other; }
        }
        if (nearest) { bombHolderId = nearest.id; p.score++; p.powerUntil = now + 180; }
        else { p.powerUntil = now + 280; p.vx += Math.cos(p.angle) * 150; p.vy += Math.sin(p.angle) * 150; }
      } else { p.powerUntil = now + 220; }
    }
  }
  let holder = players.get(bombHolderId);
  if (!holder || !holder.alive) {
    const alive = [...players.values()].filter(p => p.alive);
    bombHolderId = alive.length ? alive[Math.floor(Math.random() * alive.length)].id : null;
    bombExplodesAt = now + 6200;
  }
  if (bombHolderId && now >= bombExplodesAt) {
    const victim = players.get(bombHolderId);
    if (victim && victim.alive) {
      victim.lives--; victim.deaths++; victim.invulnerableUntil = now + 1300;
      if (victim.lives <= 0) victim.alive = false;
      else { const s = spawnFor(victim.slot); victim.x = s.x; victim.y = s.y; victim.vx = 0; victim.vy = 0; }
      for (const p of players.values()) if (p.alive && p.id !== victim.id) p.score++;
    }
    const alive = [...players.values()].filter(p => p.alive);
    bombHolderId = alive.length ? alive[Math.floor(Math.random() * alive.length)].id : null;
    bombExplodesAt = now + random(5300, 7200);
  }
}
function loseFloorLife(p, now) {
  p.lives--; p.deaths++; p.invulnerableUntil = now + 850;
  if (p.lives <= 0) { p.alive = false; return; }
  const spot = randomSafeFloorSpot();
  if (!spot) { p.alive = false; p.lives = 0; return; }
  p.x = spot.x; p.y = spot.y; p.vx = 0; p.vy = 0;
  const tile = floorTiles[floorIndexAt(p.x, p.y)];
  if (tile) tile.crackAt = 0;
}
function tickFloor(dt, now) {
  for (const p of players.values()) {
    if (!p.alive) continue;
    movePlayer(p, dt, p.powerUntil > now ? 360 : 235, 13); keepInBounds(p, 12);
    if (actionReady(p, now)) { p.actionReadyAt = now + 1450; p.powerUntil = now + 260; }
    const tile = floorTiles[floorIndexAt(p.x, p.y)];
    if (!tile || !tile.alive) { loseFloorLife(p, now); continue; }
    if (!tile.crackAt) tile.crackAt = now + 680;
  }
  for (const tile of floorTiles) if (tile.alive && tile.crackAt && now >= tile.crackAt) {
    tile.alive = false;
    for (const p of players.values()) if (p.alive && floorIndexAt(p.x, p.y) === tile.row * FLOOR_COLS + tile.col) loseFloorLife(p, now);
  }
  if (now >= floorScoreAt) {
    floorScoreAt = now + 1800;
    for (const p of players.values()) if (p.alive) p.score++;
  }
}
function finishIfLastAlive() {
  const alive = [...players.values()].filter(p => p.alive);
  if (alive.length <= 1 && players.size >= 2) finishRound('last');
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
  else if (modeId === 'hotpotato') tickHotPotato(dt, now);
  else if (modeId === 'floor') tickFloor(dt, now);
  if (phase !== 'running') return;
  if (['sumo', 'survival', 'hotpotato', 'floor'].includes(modeId)) finishIfLastAlive();
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
    players: [...players.values()].map(p => ({ id: p.id, name: p.name, skin: p.skin, color: p.color, slot: p.slot, x: p.x, y: p.y, angle: p.angle, vx: p.vx, vy: p.vy, score: p.score, hp: p.hp, lives: p.lives, alive: p.alive, power: p.powerUntil > now, cooldownLeft: Math.max(0, p.actionReadyAt - now), controlMs: p.controlMs, isHost: p.id === hostId, invulnerable: p.invulnerableUntil > now })),
    bullets: bullets.map(b => ({ x: b.x, y: b.y, r: b.r })),
    gems: gems.map(g => ({ x: g.x, y: g.y, kind: g.kind, pulse: g.pulse })),
    hazards: hazards.map(h => ({ x: h.x, y: h.y, r: h.r, phase: h.phase, hunter: Boolean(h.hunter) })),
    survivalLoot: survivalLoot.map(o => ({ x: o.x, y: o.y })),
    survivalWave,
    bombHolderId: modeId === 'hotpotato' ? bombHolderId : null,
    bombTimeLeft: modeId === 'hotpotato' ? Math.max(0, bombExplodesAt - now) : 0,
    floorTiles: modeId === 'floor' ? floorTiles.map(t => ({ col: t.col, row: t.row, alive: t.alive, crackIn: t.crackAt ? Math.max(0, t.crackAt - now) : 0 })) : [],
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
      const created = createPlayer(body.name, body.skin);
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
      const created = createPlayer(body.name, body.skin);
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
      return sendJson(res, 200, { ok: true, player: { id: p.id, name: p.name, color: p.color, skin: p.skin }, isHost: p.id === hostId });
    } catch (error) { return sendJson(res, 400, { error: error.message || 'Oturum yenilenemedi.' }); }
  }
  if (req.method === 'POST' && ['/api/input', '/api/frame'].includes(url.pathname)) {
    const p = getPlayer(req); if (!p) return sendJson(res, 401, { error: 'Oyuncu oturumu bulunamadı. Yeniden katıl.' });
    try {
      const body = await readBody(req);
      p.input = { x: clamp(Number(body.x) || 0, -1, 1), y: clamp(Number(body.y) || 0, -1, 1), action: Boolean(body.action) };
      if (body.skin !== undefined) p.skin = cleanSkin(body.skin);
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
  if (req.method === 'POST' && url.pathname === '/api/host/finish') {
    const p = getPlayer(req);
    if (!p || p.id !== hostId) return sendJson(res, 403, { error: 'Turu yalnızca oda sahibi bitirebilir.' });
    if (!['running', 'countdown'].includes(phase)) return sendJson(res, 409, { error: 'Şu anda bitirilecek bir tur yok.' });
    finishRound('manual');
    return sendJson(res, 200, { ok: true });
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
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

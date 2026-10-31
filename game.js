'use strict';

/* ================================================================ Setup */

const canvas = document.getElementById('game');
let ctx = canvas.getContext('2d');

const bg = document.createElement('canvas');
const bgCtx = bg.getContext('2d');
let craterSprite = null;
let flashSprite = null;

const el = {
  score: document.getElementById('score'),
  wave: document.getElementById('wave'),
  ammo: document.getElementById('ammo'),
  ammoStat: document.getElementById('ammoStat'),
  overlay: document.getElementById('overlay'),
  startCard: document.getElementById('startCard'),
  pauseCard: document.getElementById('pauseCard'),
  startBtn: document.getElementById('startBtn'),
  resumeBtn: document.getElementById('resumeBtn'),
  restartBtn: document.getElementById('restartBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  soundBtn: document.getElementById('soundBtn'),
  bombBtn: document.getElementById('bombBtn'),
};

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h, r) {
    const rr = Math.min(typeof r === 'number' ? r : 0, w / 2, h / 2);
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
    return this;
  };
}

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

const view = { w: 0, h: 0, groundY: 0, dpr: 1, scale: 1 };

const plane = {
  x: 0, y: 0, vx: 0, vy: 0, angle: 0, prop: 0,
};

const g = {
  state: 'menu',           // menu | playing | paused
  time: 0,
  score: 0,
  wave: 0,
  started: false,
  shake: 0,
  flash: 0,
  ammo: 24,
  maxAmmo: 24,
  dropCd: 0,
  regen: 0,
  bombs: [],
  targets: [],
  particles: [],
  flashes: [],
  rings: [],
  craters: [],
  popups: [],
  clouds: [],
  birds: [],
  decor: [],
  banner: { title: '', sub: '', life: 0, max: 1 },
  waveTimer: 0,
  aiming: false,
  aimX: 0,
  aimY: 0,
  aimOffset: 0,
  pointerId: null,
  bombHeld: false,
  muted: false,
  touch: false,
  quality: 1,
};

const perf = { frames: 0, elapsed: 0, wait: 0 };
let forcedQuality = false;

const keys = new Set();

/* =============================================================== Audio */

let audio = null;
let master = null;
let noiseBuf = null;

function ensureAudio() {
  if (audio) {
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    return;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = new AC();
    master = audio.createGain();
    master.gain.value = g.muted ? 0 : 0.5;
    master.connect(audio.destination);
    noiseBuf = audio.createBuffer(1, Math.floor(audio.sampleRate * 1.5), audio.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch (_) {
    audio = null;
  }
}

function setMuted(muted) {
  g.muted = muted;
  el.soundBtn.classList.toggle('muted', muted);
  el.soundBtn.setAttribute('aria-label', muted ? 'Sesi aç' : 'Sesi kapat');
  el.soundBtn.title = muted ? 'Ses (M)' : 'Ses (M)';
  if (audio && master) {
    const t = audio.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(muted ? 0 : 0.5, t + 0.12);
  }
  try { localStorage.setItem('gokavci.muted', muted ? '1' : '0'); } catch (_) {}
}

function playBoom(power = 1) {
  if (!audio || !noiseBuf || g.muted) return;
  const t = audio.currentTime;
  const src = audio.createBufferSource();
  src.buffer = noiseBuf;
  const lp = audio.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1400, t);
  lp.frequency.exponentialRampToValueAtTime(90, t + 0.7);
  const gain = audio.createGain();
  const vol = Math.min(0.55, 0.16 + 0.2 * power);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.75 + 0.35 * power);
  src.connect(lp);
  lp.connect(gain);
  gain.connect(master);
  src.start(t);
  src.stop(t + 1.5);

  const osc = audio.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(130, t);
  osc.frequency.exponentialRampToValueAtTime(36, t + 0.38);
  const og = audio.createGain();
  og.gain.setValueAtTime(vol * 0.85, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  osc.connect(og);
  og.connect(master);
  osc.start(t);
  osc.stop(t + 0.5);
}

function playDrop() {
  if (!audio || g.muted) return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1050, t);
  osc.frequency.exponentialRampToValueAtTime(230, t + 0.42);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.045, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t);
  osc.stop(t + 0.48);
}

function playPing(freq = 520, vol = 0.05, dur = 0.09, type = 'sine') {
  if (!audio || g.muted) return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.72, t + dur);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/* ============================================================ Scenery */

function makeCloudSprite(lobes) {
  const W = 160;
  const H = 112;
  const S = 2;
  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = H * S;
  const x = c.getContext('2d');
  x.scale(S, S);
  x.translate(W / 2, H / 2);

  x.fillStyle = 'rgba(168,208,232,0.55)';
  for (const l of lobes) {
    x.beginPath();
    x.arc(l.dx + 3, l.dy + 5, l.r, 0, TAU);
    x.fill();
  }
  x.beginPath();
  x.ellipse(3, 13, 46, 16, 0, 0, TAU);
  x.fill();

  x.fillStyle = 'rgba(255,255,255,0.96)';
  for (const l of lobes) {
    x.beginPath();
    x.arc(l.dx, l.dy, l.r, 0, TAU);
    x.fill();
  }
  x.beginPath();
  x.ellipse(0, 8, 46, 16, 0, 0, TAU);
  x.fill();

  return c;
}

function makeClouds() {
  g.clouds = [];
  const count = Math.max(4, Math.round(view.w / 230) + 2);
  for (let i = 0; i < count; i++) {
    const lobes = [];
    const n = 3 + ((Math.random() * 3) | 0);
    for (let j = 0; j < n; j++) {
      lobes.push({
        dx: (j - (n - 1) / 2) * rand(16, 25),
        dy: rand(-9, 4),
        r: rand(15, 29),
      });
    }
    g.clouds.push({
      x: rand(-120, view.w + 120),
      y: rand(view.h * 0.06, view.groundY * 0.68),
      s: rand(0.55, 1.3),
      speed: rand(5, 15),
      alpha: rand(0.55, 0.9),
      sprite: makeCloudSprite(lobes),
    });
  }

  g.birds = [];
  const birds = Math.round(view.w / 520) + 1;
  for (let i = 0; i < birds; i++) {
    g.birds.push({
      x: rand(0, view.w),
      y: rand(view.h * 0.12, view.groundY * 0.6),
      s: rand(0.7, 1.2),
      speed: rand(12, 24),
      phase: rand(0, TAU),
    });
  }
}

function makeDecor() {
  g.decor = [];
  const groundH = view.h - view.groundY;

  const treeCount = clamp(Math.round(view.w / 170), 3, 10);
  for (let i = 0; i < treeCount; i++) {
    g.decor.push({
      kind: 'tree',
      x: rand(view.w * 0.02, view.w * 0.98),
      y: view.groundY + rand(2, Math.min(34, groundH * 0.3)),
      s: rand(0.65, 1.25),
      tone: rand(0, 1),
    });
  }

  const rockCount = clamp(Math.round(view.w / 260), 2, 6);
  for (let i = 0; i < rockCount; i++) {
    g.decor.push({
      kind: 'rock',
      x: rand(0, view.w),
      y: view.groundY + rand(14, Math.max(20, groundH * 0.7)),
      s: rand(0.6, 1.3),
    });
  }

  const tuftCount = clamp(Math.round(view.w / 22), 26, 70);
  for (let i = 0; i < tuftCount; i++) {
    g.decor.push({
      kind: 'tuft',
      x: rand(0, view.w),
      y: view.groundY + rand(4, Math.max(10, groundH - 6)),
      s: rand(0.6, 1.4),
    });
  }

  g.decor.sort((a, b) => a.y - b.y);
}

function buildBackground() {
  bg.width = Math.round(view.w * view.dpr);
  bg.height = Math.round(view.h * view.dpr);
  const prev = ctx;
  ctx = bgCtx;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);
  drawSkyBase();
  drawHills();
  drawGround();
  drawDecor();
  ctx = prev;
}

function makeCraterSprite() {
  const W = 160;
  const H = 80;
  const S = 2;
  const cv = document.createElement('canvas');
  cv.width = W * S;
  cv.height = H * S;
  const c = cv.getContext('2d');
  c.scale(S, S);
  c.translate(W / 2, H / 2);

  c.save();
  c.scale(1, 0.42);
  c.beginPath();
  c.arc(0, 0, 70, 0, TAU);
  c.fillStyle = 'rgba(43,32,18,0.8)';
  c.fill();
  c.beginPath();
  c.arc(0, 0, 48, 0, TAU);
  c.fillStyle = 'rgba(26,19,11,0.9)';
  c.fill();
  c.beginPath();
  c.arc(0, 0, 69, 0, TAU);
  c.strokeStyle = 'rgba(140,170,80,0.55)';
  c.lineWidth = 3;
  c.stroke();
  c.restore();

  c.fillStyle = 'rgba(75,56,30,0.55)';
  const debris = [
    [-62, 2, 5], [48, 4, 4], [-34, 10, 3.5], [62, -2, 3], [18, 12, 4.5], [-76, -1, 2.5],
  ];
  for (const [dx, dy, r] of debris) {
    c.beginPath();
    c.ellipse(dx, dy, r, r * 0.5, 0, 0, TAU);
    c.fill();
  }
  return cv;
}

function makeFlashSprite() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d');
  const grd = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,250,220,0.95)');
  grd.addColorStop(0.4, 'rgba(255,196,90,0.6)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  c.fillStyle = grd;
  c.beginPath();
  c.arc(S / 2, S / 2, S / 2, 0, TAU);
  c.fill();
  return cv;
}

function applyResolution() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2) * g.quality;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  buildBackground();
}

/* ============================================================== Sizing */

function resize() {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(280, rect.width || window.innerWidth);
  const h = Math.max(280, rect.height || window.innerHeight);

  view.w = w;
  view.h = h;
  view.groundY = Math.round(h * 0.54);
  view.scale = clamp(Math.min(w / 1120, h / 780), 0.62, 1.18);

  makeClouds();
  makeDecor();

  plane.x = clamp(plane.x || w * 0.26, 60, w - 60);
  plane.y = clamp(plane.y || view.groundY * 0.42, 50, view.groundY - 100 * view.scale);

  for (const t of g.targets) {
    t.x = clamp(t.x, 40, view.w - 40);
    t.baseY = view.groundY + 3;
  }

  applyResolution();
  g.banner.life = 0;
}

/* ================================================================ Game */

const TARGETS = {
  bunker: { w: 72, h: 46, hp: 3, score: 150, name: 'sığınak' },
  tank:   { w: 64, h: 34, hp: 2, score: 120, name: 'tank' },
  radar:  { w: 50, h: 62, hp: 2, score: 180, name: 'radar' },
  fuel:   { w: 46, h: 52, hp: 1, score: 220, name: 'yakıt' },
};

function targetScale() {
  return clamp(view.w / 1080, 0.72, 1.06);
}

function targetVS(t) {
  return t.s * view.scale * 1.12;
}

function makeTarget(type, x) {
  const def = TARGETS[type];
  return {
    type,
    x,
    baseY: view.groundY + 3,
    w: def.w,
    h: def.h,
    hp: def.hp,
    maxHp: def.hp,
    score: def.score,
    dead: false,
    flash: 0,
    seed: rand(0, 10),
    s: targetScale(),
  };
}

function seedMenuTargets() {
  g.targets = [];
  const count = clamp(Math.round(view.w / 300), 2, 4);
  const margin = view.w * 0.14;
  const span = view.w - margin * 2;
  const types = ['bunker', 'tank', 'radar', 'fuel'];
  for (let i = 0; i < count; i++) {
    g.targets.push(makeTarget(types[i % types.length], margin + span * (i + 0.5) / count));
  }
}

function spawnWave() {
  g.wave += 1;
  g.targets = [];

  const maxCount = clamp(Math.floor(view.w / 108), 3, 9);
  const count = clamp(1 + g.wave, 3, maxCount);
  const margin = clamp(view.w * 0.085, 42, 112);
  const span = view.w - margin * 2;
  const gap = span / count;

  const pool = g.wave < 2
    ? ['bunker', 'tank']
    : g.wave < 4
      ? ['bunker', 'tank', 'radar', 'fuel']
      : ['bunker', 'tank', 'radar', 'fuel', 'tank', 'bunker'];

  for (let i = 0; i < count; i++) {
    let type = pick(pool);
    if (i === 0) type = 'bunker';
    const x = margin + gap * (i + 0.5) + rand(-gap * 0.16, gap * 0.16);
    g.targets.push(makeTarget(type, x));
  }

  g.ammo = g.maxAmmo;
  g.regen = 0;
  setBanner(`DALGA ${g.wave}`, 'KIRMIZI ÜSLERİ VUR', 2.0);
  updateHud();
}

function setBanner(title, sub, dur = 1.8) {
  g.banner = { title, sub, life: dur, max: dur };
}

function updateHud() {
  el.score.textContent = String(g.score).padStart(4, '0');
  el.wave.textContent = String(Math.max(1, g.wave)).padStart(2, '0');
  el.ammo.textContent = String(g.ammo);
  el.ammoStat.classList.toggle('empty', g.ammo === 0);
  el.bombBtn.classList.toggle('is-empty', g.ammo === 0);
}

function startGame() {
  ensureAudio();
  g.state = 'playing';
  g.started = true;
  g.score = 0;
  g.wave = 0;
  g.bombs = [];
  g.particles = [];
  g.flashes = [];
  g.rings = [];
  g.craters = [];
  g.popups = [];
  g.targets = [];
  g.waveTimer = 0;
  g.shake = 0;
  g.flash = 0;
  g.ammo = g.maxAmmo;
  g.regen = 0;
  g.dropCd = 0;
  g.bombHeld = false;
  g.aiming = false;
  g.pointerId = null;
  plane.x = view.w * 0.26;
  plane.y = view.groundY * 0.4;
  plane.vx = 0;
  plane.vy = 0;
  plane.angle = 0;

  hideOverlay();
  spawnWave();
  updateHud();
  playPing(660, 0.06, 0.12, 'triangle');
}

function togglePause() {
  if (g.state === 'playing') {
    g.state = 'paused';
    g.bombHeld = false;
    g.aiming = false;
    el.bombBtn.classList.remove('is-down');
    showOverlay('pause');
    playPing(320, 0.04, 0.08);
  } else if (g.state === 'paused') {
    g.state = 'playing';
    hideOverlay();
    ensureAudio();
    playPing(520, 0.04, 0.08);
  }
}

function showOverlay(which) {
  el.overlay.classList.remove('hidden');
  el.startCard.classList.toggle('hidden', which !== 'start');
  el.pauseCard.classList.toggle('hidden', which !== 'pause');
  el.pauseBtn.style.display = which === 'start' ? 'none' : '';
}

function hideOverlay() {
  el.overlay.classList.add('hidden');
  el.pauseBtn.style.display = '';
}

/* ============================================================== Plane */

function tryDrop() {
  if (g.state !== 'playing' || g.dropCd > 0 || g.ammo <= 0) return;
  g.dropCd = 0.3;
  g.ammo -= 1;
  const s = view.scale;
  g.bombs.push({
    x: plane.x + 1 * s,
    y: plane.y + 19 * s,
    vx: plane.vx * 0.36 + rand(-6, 6),
    vy: 105,
    r: 6 * s,
    rot: 0,
    seed: rand(0, 10),
    trail: 0,
  });
  playDrop();
  updateHud();
}

function updatePlane(dt) {
  const s = view.scale;
  const maxX = clamp(view.w * 0.52, 300, 560);
  const maxY = clamp(view.h * 0.42, 230, 360);

  let tx = 0;
  let ty = 0;

  if (g.aiming) {
    const px = clamp(g.aimX, 48, view.w - 48);
    const py = clamp(g.aimY - g.aimOffset, 52, view.groundY - 100 * s);
    const dx = px - plane.x;
    const dy = py - plane.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 5) {
      const speed = Math.min(maxX * 1.15, dist * 4.2);
      tx = (dx / dist) * speed;
      ty = (dy / dist) * speed;
    }
  } else {
    let kx = 0;
    let ky = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) kx -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) kx += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) ky -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) ky += 1;
    if (kx || ky) {
      const len = Math.hypot(kx, ky);
      tx = (kx / len) * maxX;
      ty = (ky / len) * maxY;
    }
  }

  const response = Math.min(1, dt * (g.aiming ? 9 : 7.5));
  plane.vx += (tx - plane.vx) * response;
  plane.vy += (ty - plane.vy) * response;

  plane.x += plane.vx * dt;
  plane.y += plane.vy * dt;

  const mx = 70 * s;
  const top = 52 * s + 16;
  const bottom = view.groundY - 100 * s;

  if (plane.x < mx) { plane.x = mx; plane.vx = Math.max(0, plane.vx); }
  if (plane.x > view.w - mx) { plane.x = view.w - mx; plane.vx = Math.min(0, plane.vx); }
  if (plane.y < top) { plane.y = top; plane.vy = Math.max(0, plane.vy); }
  if (plane.y > bottom) { plane.y = bottom; plane.vy = Math.min(0, plane.vy); }

  const targetAngle = clamp(plane.vy / 720, -0.22, 0.22);
  plane.angle = lerp(plane.angle, targetAngle, Math.min(1, dt * 6));
  plane.prop += dt * 38;
}

function updateIdlePlane(dt) {
  if (g.state === 'menu') {
    plane.x = view.w * 0.24 + Math.sin(g.time * 0.5) * Math.min(24, view.w * 0.02);
    plane.y = view.groundY * 0.42 + Math.sin(g.time * 1.15) * 5;
    plane.angle = Math.sin(g.time * 0.9) * 0.025;
    plane.vx = 0;
    plane.vy = 0;
  }
  plane.prop += dt * 20;
}

/* ============================================================== Bombs */

function updateBombs(dt) {
  for (let i = g.bombs.length - 1; i >= 0; i--) {
    const b = g.bombs[i];
    const prevY = b.y;
    b.vy += 660 * dt;
    b.vx *= 1 - Math.min(1, 0.35 * dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.rot = Math.atan2(b.vx, b.vy);

    b.trail -= dt;
    if (b.trail <= 0) {
      b.trail = 0.06;
      addParticle({
        kind: 'trail',
        x: b.x + rand(-2, 2),
        y: b.y - 8 * view.scale,
        vx: rand(-6, 6),
        vy: rand(-4, 10),
        life: rand(0.25, 0.5),
        max: 0.5,
        size: rand(2, 4.5) * view.scale,
        grav: -10,
        drag: 1.5,
        color: 'rgba(240,248,255,0.55)',
      });
    }

    let consumed = false;

    for (const t of g.targets) {
      if (t.dead) continue;
      const vs = targetVS(t);
      const top = t.baseY - t.h * vs;
      const half = t.w * vs * 0.55;
      if (
        b.x > t.x - half &&
        b.x < t.x + half &&
        b.y + b.r >= top &&
        prevY - b.r <= t.baseY + 4
      ) {
        explode(b.x, Math.min(b.y, top + 10), 0.85, true);
        hitTarget(t, 1);
        g.bombs.splice(i, 1);
        consumed = true;
        break;
      }
    }
    if (consumed) continue;

    if (b.y + b.r >= view.groundY) {
      explode(b.x, view.groundY, 1, true);
      g.bombs.splice(i, 1);
      continue;
    }

    if (b.x < -30 || b.x > view.w + 30) g.bombs.splice(i, 1);
  }
}

function hitTarget(t, dmg, chain = 0) {
  if (t.dead) return;
  t.hp -= dmg;
  t.flash = 0.17;

  if (t.hp <= 0) {
    t.dead = true;
    const vs = targetVS(t);
    g.score += t.score;
    addPopup(t.x, t.baseY - t.h * vs - 18, `+${t.score}`, '#ffe6a1');
    const power = t.type === 'fuel' ? 1.75 : 1.35;
    explode(t.x, t.baseY - t.h * vs * 0.5, power, false);
    playBoom(power);

    if (t.type === 'fuel' && chain < 2) {
      for (const other of g.targets) {
        if (other === t || other.dead) continue;
        if (Math.abs(other.x - t.x) < 118 * view.scale) {
          setTimeout(() => {
            if (g.state === 'playing' && g.targets.includes(other) && !other.dead) {
              hitTarget(other, 1, chain + 1);
            }
          }, 110 + Math.random() * 80);
        }
      }
    }
    updateHud();
  } else {
    playPing(240, 0.045, 0.09, 'square');
  }
}

/* ========================================================== Explosions */

function addParticle(p) {
  if (g.particles.length > 320) g.particles.shift();
  g.particles.push(p);
}

function explode(x, y, power, ground) {
  const s = view.scale;
  const scale = clamp(s, 0.72, 1.15);

  g.shake = Math.min(22, g.shake + 5 * power * scale);
  g.flash = Math.min(0.24, g.flash + 0.035 * power);

  g.flashes.push({ x, y, r: (26 + 14 * power) * scale, life: 0.2, max: 0.2 });
  g.rings.push({ x, y, r: 6, maxR: (42 + 26 * power) * scale, life: 0.42, max: 0.42 });

  const fireCount = Math.round(10 + 10 * power);
  const upBias = ground ? -Math.PI : -Math.PI * 0.92;

  for (let i = 0; i < fireCount; i++) {
    const a = rand(upBias, ground ? 0 : -0.08) + rand(-0.2, 0.2);
    const sp = rand(50, 90 + 190 * power) * scale;
    addParticle({
      kind: 'fire',
      x: x + rand(-3, 3),
      y: y + rand(-3, 3),
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: rand(0.28, 0.72),
      max: 0.72,
      size: rand(3, 7.5) * power * scale,
      grav: 260,
      drag: 1.6,
      add: true,
      color: pick(['#fff4b8', '#ffd166', '#ff9e3d', '#ff6b2c']),
    });
  }

  const smokeCount = Math.round(6 + 5 * power);
  for (let i = 0; i < smokeCount; i++) {
    addParticle({
      kind: 'smoke',
      x: x + rand(-12, 12) * scale,
      y: y + rand(-12, 6) * scale,
      vx: rand(-26, 26) * scale,
      vy: rand(-60, -18) * scale,
      life: rand(0.9, 1.9),
      max: 1.9,
      size: rand(7, 15) * scale,
      grav: -18,
      drag: 0.7,
      grow: rand(12, 26) * scale,
      color: pick(['#5e5a54', '#6e695f', '#7d776b']),
    });
  }

  if (ground) {
    const dirtCount = Math.round(10 + 8 * power);
    for (let i = 0; i < dirtCount; i++) {
      addParticle({
        kind: 'dirt',
        x: x + rand(-6, 6),
        y: y - rand(0, 5),
        vx: rand(-130, 130) * scale,
        vy: rand(-230, -60) * scale,
        life: rand(0.5, 1.0),
        max: 1.0,
        size: rand(2, 5.5) * scale,
        grav: 720,
        drag: 0.5,
        color: pick(['#4d7a32', '#6b8f3f', '#7a5c3a', '#3f5f2a', '#8a6a42']),
      });
    }
  }

  for (let i = 0; i < 6; i++) {
    const a = rand(-Math.PI, 0);
    const sp = rand(160, 380) * scale;
    addParticle({
      kind: 'spark',
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: rand(0.18, 0.42),
      max: 0.42,
      size: rand(1.4, 2.6) * scale,
      grav: 480,
      drag: 0.9,
      add: true,
      color: '#ffe9a8',
    });
  }

  const craterR = (17 + 15 * power) * scale;
  g.craters.push({ x, r: craterR, seed: rand(0, 10) });
  if (g.craters.length > 48) g.craters.shift();

  playBoom(power);
}

function addPopup(x, y, text, color) {
  g.popups.push({ x, y, text, color, life: 0.95, max: 0.95 });
}

function updateParticles(dt) {
  for (let i = g.particles.length - 1; i >= 0; i--) {
    const p = g.particles[i];
    p.life -= dt;
    if (p.life <= 0) { g.particles.splice(i, 1); continue; }
    p.vx -= p.vx * Math.min(1, (p.drag || 0) * dt);
    p.vy -= p.vy * Math.min(1, (p.drag || 0) * dt);
    p.vy += (p.grav || 0) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.grow) p.size += p.grow * dt;
  }

  for (let i = g.flashes.length - 1; i >= 0; i--) {
    g.flashes[i].life -= dt;
    if (g.flashes[i].life <= 0) g.flashes.splice(i, 1);
  }
  for (let i = g.rings.length - 1; i >= 0; i--) {
    const r = g.rings[i];
    r.life -= dt;
    r.r = lerp(r.r, r.maxR, Math.min(1, dt * 11));
    if (r.life <= 0) g.rings.splice(i, 1);
  }
  for (let i = g.popups.length - 1; i >= 0; i--) {
    const p = g.popups[i];
    p.life -= dt;
    p.y -= 26 * dt;
    if (p.life <= 0) g.popups.splice(i, 1);
  }

  for (const t of g.targets) {
    if (t.flash > 0) t.flash = Math.max(0, t.flash - dt);
  }
}

function updateClouds(dt) {
  for (const c of g.clouds) {
    c.x -= c.speed * dt;
    if (c.x < -180) {
      c.x = view.w + 160;
      c.y = rand(view.h * 0.06, view.groundY * 0.68);
    }
  }
  for (const b of g.birds) {
    b.x += b.speed * dt;
    b.y += Math.sin(g.time * 1.4 + b.phase) * 3 * dt;
    if (b.x > view.w + 30) b.x = -30;
  }
}

/* ================================================================ Wave */

function updateWave(dt) {
  if (g.waveTimer > 0) {
    g.waveTimer -= dt;
    if (g.waveTimer <= 0) {
      g.waveTimer = 0;
      spawnWave();
    }
    return;
  }

  if (g.targets.length && g.targets.every((t) => t.dead)) {
    g.waveTimer = 2.3;
    const bonus = 200 + g.wave * 25;
    g.score += bonus;
    addPopup(view.w / 2, view.groundY - 110, `TEMİZ! +${bonus}`, '#b9ff8a');
    setBanner('DALGA TEMİZ', `+${bonus} bonus · sıradaki dalga geliyor`, 2.1);
    g.ammo = g.maxAmmo;
    updateHud();
    playPing(660, 0.06, 0.12, 'triangle');
    setTimeout(() => playPing(880, 0.05, 0.16, 'triangle'), 120);
  }
}

function updatePlay(dt) {
  g.dropCd = Math.max(0, g.dropCd - dt);

  if (g.ammo < g.maxAmmo) {
    g.regen += dt;
    if (g.regen >= 1.9) {
      g.regen -= 1.9;
      g.ammo += 1;
      updateHud();
    }
  } else {
    g.regen = 0;
  }

  updatePlane(dt);

  if (keys.has('Space') || keys.has('KeyJ') || g.bombHeld) tryDrop();

  updateBombs(dt);
  updateParticles(dt);
  updateWave(dt);
}

/* ============================================================== Render */

function render() {
  const w = view.w;
  const h = view.h;
  const groundY = view.groundY;

  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

  ctx.save();
  if (g.shake > 0.2) {
    ctx.translate(rand(-g.shake, g.shake) * 0.5, rand(-g.shake, g.shake) * 0.5);
  }

  if (g.shake > 0.2) {
    ctx.drawImage(bg, -16, -16, w + 32, h + 32);
  } else {
    ctx.drawImage(bg, 0, 0, w, h);
  }

  drawClouds();
  drawCraters();
  drawTargets();
  drawGroundShadows();
  drawAimSight();
  drawBombs();
  drawPlane();
  drawEffects();
  drawPopups();
  drawBanner();

  ctx.restore();

  if (g.flash > 0.004) {
    ctx.fillStyle = `rgba(255,246,214,${g.flash})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawSkyBase() {
  const w = view.w;
  const groundY = view.groundY;

  const sky = ctx.createLinearGradient(0, -20, 0, groundY + 30);
  sky.addColorStop(0, '#2b86cd');
  sky.addColorStop(0.5, '#63b8e9');
  sky.addColorStop(0.82, '#a9dcf5');
  sky.addColorStop(1, '#e1f5ff');
  ctx.fillStyle = sky;
  ctx.fillRect(-40, -40, w + 80, groundY + 60);

  // Sun
  const sx = w * 0.79;
  const sy = view.h * 0.15;
  const sr = clamp(Math.min(w, view.h) * 0.05, 22, 54);
  const glow = ctx.createRadialGradient(sx, sy, sr * 0.3, sx, sy, sr * 3.6);
  glow.addColorStop(0, 'rgba(255,248,205,0.85)');
  glow.addColorStop(0.35, 'rgba(255,238,170,0.28)');
  glow.addColorStop(1, 'rgba(255,238,170,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, sr * 3.6, 0, TAU);
  ctx.fill();

  ctx.fillStyle = '#fff7cf';
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, TAU);
  ctx.fill();

  // Horizon haze
  const haze = ctx.createLinearGradient(0, groundY - 90, 0, groundY + 8);
  haze.addColorStop(0, 'rgba(235,250,255,0)');
  haze.addColorStop(1, 'rgba(235,250,255,0.55)');
  ctx.fillStyle = haze;
  ctx.fillRect(-40, groundY - 90, w + 80, 98);
}

function drawClouds() {
  for (const c of g.clouds) {
    const cw = 160 * c.s;
    const ch = 112 * c.s;
    ctx.globalAlpha = c.alpha;
    ctx.drawImage(c.sprite, c.x - cw / 2, c.y - ch / 2, cw, ch);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(30,64,92,0.45)';
  ctx.lineWidth = 1.6;
  for (const b of g.birds) {
    const flap = Math.sin(g.time * 6 + b.phase) * 3;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(b.s, b.s);
    ctx.beginPath();
    ctx.moveTo(-7, flap);
    ctx.quadraticCurveTo(-3, -3 + flap, 0, 0);
    ctx.quadraticCurveTo(3, -3 + flap, 7, flap);
    ctx.stroke();
    ctx.restore();
  }
}

function drawHills() {
  const w = view.w;
  const groundY = view.groundY;

  // Far hills
  ctx.fillStyle = '#4f8b5d';
  ctx.beginPath();
  ctx.moveTo(-30, groundY + 20);
  for (let x = -30; x <= w + 40; x += 18) {
    const y = groundY - 34 - Math.sin(x * 0.0042 + 1.2) * 20 - Math.sin(x * 0.011 + 2) * 7;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w + 40, groundY + 20);
  ctx.closePath();
  ctx.fill();

  // Near hills
  ctx.fillStyle = '#3f7c4c';
  ctx.beginPath();
  ctx.moveTo(-30, groundY + 25);
  for (let x = -30; x <= w + 40; x += 16) {
    const y = groundY - 16 - Math.sin(x * 0.006 + 4.1) * 13 - Math.sin(x * 0.015) * 5;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w + 40, groundY + 25);
  ctx.closePath();
  ctx.fill();

  // Tiny distant treeline
  ctx.fillStyle = 'rgba(31,76,45,0.55)';
  const step = 26;
  for (let x = -10; x < w + 20; x += step) {
    const hh = 8 + ((Math.sin(x * 1.7) + 1) / 2) * 10;
    ctx.beginPath();
    ctx.arc(x, groundY - 8 - hh * 0.4, hh * 0.5, 0, TAU);
    ctx.fill();
  }
}

function drawGround() {
  const w = view.w;
  const h = view.h;
  const groundY = view.groundY;

  const soil = ctx.createLinearGradient(0, groundY, 0, h);
  soil.addColorStop(0, '#7cc44e');
  soil.addColorStop(0.1, '#63ad3d');
  soil.addColorStop(0.45, '#4a8f30');
  soil.addColorStop(0.8, '#387125');
  soil.addColorStop(1, '#2a571d');
  ctx.fillStyle = soil;
  ctx.fillRect(-40, groundY, w + 80, h - groundY + 50);

  // Lighter grass edge
  ctx.fillStyle = '#8bd05a';
  ctx.beginPath();
  ctx.moveTo(-40, groundY + 2);
  for (let x = -40; x <= w + 40; x += 12) {
    const y = groundY + 2 + Math.sin(x * 0.05) * 1.6 + Math.sin(x * 0.13) * 0.8;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w + 40, groundY + 12);
  ctx.lineTo(-40, groundY + 12);
  ctx.closePath();
  ctx.fill();

  // Field rows
  ctx.strokeStyle = 'rgba(35,86,28,0.22)';
  ctx.lineWidth = 2;
  const rows = 6;
  for (let i = 1; i <= rows; i++) {
    const t = i / (rows + 1);
    const y = groundY + (h - groundY) * t;
    ctx.beginPath();
    for (let x = -20; x <= w + 20; x += 26) {
      const yy = y + Math.sin(x * 0.01 + i) * 5 + Math.sin(x * 0.031 + i * 2) * 2;
      if (x === -20) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  // Speckles
  ctx.fillStyle = 'rgba(32,74,26,0.18)';
  for (let i = 0; i < 26; i++) {
    const x = (i * 97.3) % w;
    const y = groundY + 16 + ((i * 53.7) % Math.max(20, h - groundY - 20));
    ctx.beginPath();
    ctx.ellipse(x, y, 2.4, 1.3, 0.3, 0, TAU);
    ctx.fill();
  }
}

function drawCraters() {
  if (!craterSprite) return;
  for (const c of g.craters) {
    const dw = c.r * 2;
    const dh = c.r * 2 * 0.5;
    ctx.drawImage(craterSprite, c.x - dw / 2, view.groundY + 3 - dh / 2, dw, dh);
  }
}

function drawDecor() {
  for (const d of g.decor) {
    if (d.kind === 'tree') drawTree(d);
    else if (d.kind === 'rock') drawRock(d);
    else drawTuft(d);
  }
}

function drawTree(d) {
  const s = d.s * view.scale;
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(20,55,25,0.25)';
  ctx.beginPath();
  ctx.ellipse(3, 2, 17, 4.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#5b4325';
  ctx.fillRect(-2.5, -18, 5, 19);
  const dark = d.tone > 0.5 ? '#2f6d2e' : '#357a33';
  const light = d.tone > 0.5 ? '#3f8a3a' : '#4a9a42';
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(-7, -26, 12, 0, TAU);
  ctx.arc(7, -28, 13, 0, TAU);
  ctx.arc(0, -38, 12, 0, TAU);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(-2, -34, 9, 0, TAU);
  ctx.arc(7, -30, 7, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawRock(d) {
  const s = d.s * view.scale;
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.scale(s, s);
  ctx.fillStyle = '#6f7a6a';
  ctx.beginPath();
  ctx.ellipse(0, 0, 8, 5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#8b9584';
  ctx.beginPath();
  ctx.ellipse(-2, -2, 5, 3, -0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawTuft(d) {
  const s = d.s * view.scale;
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.scale(s, s);
  ctx.strokeStyle = d.y > view.groundY + 60 ? 'rgba(45,105,35,0.65)' : 'rgba(112,170,64,0.75)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-3, -5, -5, -8);
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(0, -6, 1, -10);
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(3, -5, 5, -7);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------- Targets */

function drawTargets() {
  for (const t of g.targets) {
    if (t.dead) drawRubble(t);
    else drawTarget(t);
  }
}

function drawTarget(t) {
  const s = targetVS(t);
  ctx.save();
  ctx.translate(t.x, t.baseY);
  ctx.scale(s, s);

  ctx.fillStyle = 'rgba(20,55,25,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 2, t.w * 0.55, 6, 0, 0, TAU);
  ctx.fill();

  if (t.type === 'bunker') drawBunker(t);
  else if (t.type === 'tank') drawTank(t);
  else if (t.type === 'radar') drawRadar(t);
  else drawFuel(t);

  if (t.flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = t.flash / 0.17;
    const grd = ctx.createRadialGradient(0, -t.h * 0.5, 2, 0, -t.h * 0.5, t.w);
    grd.addColorStop(0, 'rgba(255,245,210,0.85)');
    grd.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, -t.h * 0.5, t.w, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  if (t.hp < t.maxHp) {
    const bw = Math.max(34, 44 * s);
    const bh = 6;
    const bx = t.x - bw / 2;
    const by = t.baseY - t.h * s - 28;
    const ratio = clamp(t.hp / t.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(8,24,18,0.78)';
    ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    ctx.fillStyle = ratio > 0.5 ? '#ffb347' : '#ff5a45';
    ctx.fillRect(bx, by, bw * ratio, bh);
    ctx.strokeStyle = 'rgba(255,244,220,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 1.5, by - 1.5, bw + 3, bh + 3);
  }
}

function drawFlag(x, y, size = 1) {
  const sway = Math.sin(g.time * 3 + x * 0.1) * 1.6;
  ctx.strokeStyle = '#3f463c';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 18 * size);
  ctx.stroke();
  ctx.fillStyle = '#e6382f';
  ctx.beginPath();
  ctx.moveTo(x, y - 18 * size);
  ctx.lineTo(x + 15 * size, y - 14 * size + sway);
  ctx.lineTo(x, y - 9 * size);
  ctx.closePath();
  ctx.fill();
}

function drawBunker(t) {
  const w = 72;
  const h = 46;

  ctx.fillStyle = '#7b7d70';
  ctx.beginPath();
  ctx.moveTo(-w / 2, -2);
  ctx.lineTo(-w / 2 + 4, -h);
  ctx.lineTo(w / 2 - 4, -h);
  ctx.lineTo(w / 2, -2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#4c5147';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(70,74,64,0.55)';
  ctx.lineWidth = 1.2;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 14, -4);
    ctx.lineTo(i * 14 + 1, -h + 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#4c5147';
  ctx.fillRect(-w / 2 - 4, -h - 7, w + 8, 8);
  ctx.fillStyle = '#393f3a';
  ctx.fillRect(-w / 2 - 4, -h - 7, w + 8, 3);

  ctx.fillStyle = '#222824';
  ctx.fillRect(-24, -h + 12, 25, 8);
  ctx.fillStyle = '#3c423b';
  ctx.fillRect(w / 2 - 22, -27, 15, 25);
  ctx.fillStyle = '#616659';
  ctx.fillRect(w / 2 - 24, -29, 19, 3);

  ctx.fillStyle = '#8d8a72';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.ellipse(-30 + i * 15, -3, 8, 4.5, 0, 0, TAU);
    ctx.fill();
  }

  drawFlag(16, -h - 7, 0.8);
}

function drawTank(t) {
  const w = 64;

  ctx.fillStyle = '#3d443b';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -13, w, 14, 7);
  ctx.fill();
  ctx.fillStyle = '#242a25';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(-22 + i * 14.5, -6, 4.2, 0, TAU);
    ctx.fill();
  }

  ctx.fillStyle = '#5c6b43';
  ctx.beginPath();
  ctx.roundRect(-w / 2 + 3, -25, w - 6, 12, 4);
  ctx.fill();

  ctx.fillStyle = '#4d5b39';
  ctx.beginPath();
  ctx.roundRect(-15, -37, 31, 13, 5);
  ctx.fill();

  ctx.fillStyle = '#596842';
  ctx.fillRect(14, -34, 26, 4);
  ctx.fillStyle = '#39402f';
  ctx.fillRect(38, -35, 4, 6);

  ctx.fillStyle = '#9aab74';
  ctx.beginPath();
  ctx.roundRect(-12, -39, 22, 4, 2);
  ctx.fill();

  drawFlag(-24, -25, 0.55);

  ctx.fillStyle = '#e6382f';
  ctx.beginPath();
  ctx.arc(3, -30, 4.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#fff4dc';
  ctx.beginPath();
  ctx.arc(3, -30, 1.9, 0, TAU);
  ctx.fill();
}

function drawRadar(t) {
  ctx.fillStyle = '#6c715f';
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.lineTo(-9, -14);
  ctx.lineTo(9, -14);
  ctx.lineTo(16, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#8c9079';
  ctx.fillRect(-2.5, -46, 5, 33);

  ctx.save();
  ctx.translate(0, -46);
  ctx.rotate(-0.55 + Math.sin(g.time * 2.2 + t.seed) * 0.12);
  ctx.fillStyle = '#b8bda6';
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 8, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#8f947f';
  ctx.beginPath();
  ctx.ellipse(0, 2, 18, 5.5, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#5e6354';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(0, 15);
  ctx.stroke();
  ctx.restore();

  const blink = 0.45 + 0.55 * Math.abs(Math.sin(g.time * 3 + t.seed));
  ctx.fillStyle = `rgba(255,72,54,${blink})`;
  ctx.beginPath();
  ctx.arc(0, -48, 3.4, 0, TAU);
  ctx.fill();

  ctx.fillStyle = '#58604e';
  ctx.fillRect(-10, -12, 20, 9);
}

function drawFuel(t) {
  const tanks = [
    { x: -11, w: 18, h: 40, y: -40 },
    { x: 11, w: 15, h: 30, y: -30 },
  ];
  for (const tk of tanks) {
    ctx.fillStyle = '#b65a3c';
    ctx.beginPath();
    ctx.roundRect(tk.x - tk.w / 2, tk.y, tk.w, tk.h, 5);
    ctx.fill();
    ctx.fillStyle = '#d17a55';
    ctx.beginPath();
    ctx.roundRect(tk.x - tk.w / 2 + 2, tk.y + 2, tk.w - 4, tk.h - 5, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,236,196,0.85)';
    ctx.fillRect(tk.x - tk.w / 2 + 1, tk.y + tk.h * 0.42, tk.w - 2, 4);
    ctx.fillStyle = '#6e3a29';
    ctx.beginPath();
    ctx.ellipse(tk.x, tk.y + tk.h - 1, tk.w * 0.5, 2.6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(90,52,40,0.55)';
    ctx.beginPath();
    ctx.arc(tk.x + 3, tk.y + 6, 4, 0, TAU);
    ctx.fill();
  }

  ctx.fillStyle = '#5c6352';
  ctx.fillRect(-15, -4, 30, 4);

  const wob = Math.sin(g.time * 4 + t.seed) * 0.4;
  ctx.save();
  ctx.translate(0, -47);
  ctx.rotate(wob);
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(7, 5);
  ctx.lineTo(-7, 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#40260f';
  ctx.font = '900 8px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('!', 0, 3.5);
  ctx.restore();

  drawFlag(-22, -20, 0.5);
}

function drawRubble(t) {
  const s = t.s * view.scale * 1.1;
  ctx.save();
  ctx.translate(t.x, t.baseY);
  ctx.scale(s, s);

  ctx.fillStyle = 'rgba(20,50,24,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 34, 6, 0, 0, TAU);
  ctx.fill();

  ctx.fillStyle = '#5c5340';
  ctx.beginPath();
  ctx.moveTo(-32, 0);
  ctx.quadraticCurveTo(-18, -18, -2, -9);
  ctx.quadraticCurveTo(14, -22, 30, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#77705c';
  ctx.beginPath();
  ctx.moveTo(-14, -4);
  ctx.lineTo(-6, -16);
  ctx.lineTo(4, -8);
  ctx.lineTo(-2, -2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8e876f';
  ctx.fillRect(8, -10, 12, 5);
  ctx.fillStyle = '#3f473b';
  ctx.fillRect(-24, -6, 11, 5);

  ctx.strokeStyle = '#3c4438';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(13, -8);
  ctx.lineTo(20, -23);
  ctx.stroke();
  ctx.fillStyle = 'rgba(230,56,47,0.5)';
  ctx.beginPath();
  ctx.moveTo(20, -23);
  ctx.lineTo(29, -20);
  ctx.lineTo(20, -16);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/* ------------------------------------------------------------- Shadows */

function drawGroundShadows() {
  const groundY = view.groundY;
  const s = view.scale;
  const alt = clamp((groundY - plane.y) / groundY, 0, 1);

  ctx.save();
  ctx.fillStyle = `rgba(18,50,26,${0.22 * (1 - alt * 0.55)})`;
  ctx.beginPath();
  ctx.ellipse(plane.x, groundY + 6, 62 * s * (1 - alt * 0.3), 9 * s, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  for (const b of g.bombs) {
    const t = clamp((groundY - b.y) / Math.max(1, groundY - plane.y), 0, 1);
    ctx.fillStyle = `rgba(18,50,26,${0.15 + 0.1 * t})`;
    ctx.beginPath();
    ctx.ellipse(b.x, groundY + 5, 9 * s, 3 * s, 0, 0, TAU);
    ctx.fill();
  }
}

function drawAimSight() {
  if (g.state !== 'playing') return;
  const groundY = view.groundY;

  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.strokeStyle = '#f7f2df';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  ctx.moveTo(plane.x + 1 * view.scale, plane.y + 24 * view.scale);
  ctx.lineTo(plane.x + 1 * view.scale, groundY - 4);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#ff9e3d';
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.ellipse(plane.x + 1 * view.scale, groundY + 4, 12 * view.scale, 4 * view.scale, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();

  if (g.aiming) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#fff4dc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(g.aimX, g.aimY, 16, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(g.aimX - 23, g.aimY);
    ctx.lineTo(g.aimX - 9, g.aimY);
    ctx.moveTo(g.aimX + 9, g.aimY);
    ctx.lineTo(g.aimX + 23, g.aimY);
    ctx.stroke();
    ctx.restore();
  }
}

/* --------------------------------------------------------------- Plane */

function drawPlane() {
  const s = view.scale;

  ctx.save();
  ctx.translate(plane.x, plane.y);
  ctx.rotate(plane.angle);
  ctx.scale(s, s);

  // Tail fin
  ctx.fillStyle = '#5c7444';
  ctx.beginPath();
  ctx.moveTo(-54, 6);
  ctx.quadraticCurveTo(-68, -30, -74, -40);
  ctx.lineTo(-57, -40);
  ctx.quadraticCurveTo(-46, -12, -38, 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3c5230';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#e6382f';
  ctx.beginPath();
  ctx.moveTo(-73, -39);
  ctx.lineTo(-57, -40);
  ctx.lineTo(-61, -30);
  ctx.lineTo(-71, -29);
  ctx.closePath();
  ctx.fill();

  // Horizontal stabilizer
  ctx.fillStyle = '#5a7042';
  ctx.beginPath();
  ctx.moveTo(-52, 2);
  ctx.lineTo(-78, 9);
  ctx.lineTo(-52, 13);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3c5230';
  ctx.stroke();

  // Low wing
  const wing = ctx.createLinearGradient(0, 4, 0, 28);
  wing.addColorStop(0, '#647c4a');
  wing.addColorStop(1, '#465d36');
  ctx.fillStyle = wing;
  ctx.beginPath();
  ctx.moveTo(-16, 4);
  ctx.lineTo(26, 3);
  ctx.quadraticCurveTo(30, 22, 18, 28);
  ctx.lineTo(-6, 24);
  ctx.quadraticCurveTo(-14, 14, -16, 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#35482a';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Wing stripe
  ctx.strokeStyle = 'rgba(255,244,220,0.7)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-8, 21);
  ctx.lineTo(20, 22);
  ctx.stroke();

  // Bomb under the wing
  if (g.ammo > 0 && g.state !== 'menu') {
    ctx.save();
    ctx.translate(15, 27);
    ctx.rotate(0.06);
    ctx.fillStyle = '#454e56';
    ctx.beginPath();
    ctx.roundRect(-3.2, -7, 6.4, 13, 3);
    ctx.fill();
    ctx.fillStyle = '#333a40';
    ctx.beginPath();
    ctx.moveTo(-5.5, -5);
    ctx.lineTo(-7, -10);
    ctx.lineTo(0, -7);
    ctx.lineTo(7, -10);
    ctx.lineTo(5.5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff7a3d';
    ctx.fillRect(-3.2, -1, 6.4, 2);
    ctx.restore();
  }

  // Fuselage
  const body = ctx.createLinearGradient(0, -22, 0, 20);
  body.addColorStop(0, '#a6b57e');
  body.addColorStop(0.45, '#84975f');
  body.addColorStop(1, '#5a7142');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-64, 0);
  ctx.bezierCurveTo(-62, -14, -34, -22, 4, -21);
  ctx.bezierCurveTo(34, -20, 56, -13, 66, -2);
  ctx.bezierCurveTo(58, 11, 32, 18, -4, 17);
  ctx.bezierCurveTo(-38, 16, -60, 9, -64, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3c5230';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Cream belly
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,244,220,0.55)';
  ctx.beginPath();
  ctx.ellipse(-2, 16, 56, 14, -0.02, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Top highlight
  ctx.strokeStyle = 'rgba(255,255,235,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-48, -10);
  ctx.quadraticCurveTo(-10, -21, 46, -12);
  ctx.stroke();

  // Panel lines
  ctx.strokeStyle = 'rgba(54,74,40,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-30, -15);
  ctx.lineTo(-34, 8);
  ctx.moveTo(-6, -19);
  ctx.lineTo(-10, 12);
  ctx.stroke();

  // Cockpit
  const glass = ctx.createLinearGradient(0, -32, 0, -10);
  glass.addColorStop(0, '#d8f6ff');
  glass.addColorStop(1, '#6ec3e8');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.moveTo(-8, -16);
  ctx.quadraticCurveTo(2, -34, 19, -27);
  ctx.quadraticCurveTo(24, -24, 20, -14);
  ctx.quadraticCurveTo(4, -12, -8, -16);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#38503a';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Pilot
  ctx.fillStyle = '#e8bb87';
  ctx.beginPath();
  ctx.arc(5, -19, 4.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#4e5c3c';
  ctx.beginPath();
  ctx.arc(4.4, -21.4, 3.8, Math.PI * 1.05, Math.PI * 2.05);
  ctx.fill();
  ctx.fillStyle = '#26301e';
  ctx.beginPath();
  ctx.arc(7.2, -19.4, 0.9, 0, TAU);
  ctx.fill();

  // Glass shine
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-2, -25);
  ctx.quadraticCurveTo(4, -31, 12, -28);
  ctx.stroke();

  // Roundel
  ctx.fillStyle = '#e6382f';
  ctx.beginPath();
  ctx.arc(-24, 1, 6.6, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#fff4dc';
  ctx.beginPath();
  ctx.arc(-24, 1, 4.3, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e6382f';
  ctx.beginPath();
  ctx.arc(-24, 1, 2.1, 0, TAU);
  ctx.fill();

  // Exhaust
  ctx.fillStyle = '#4a4f44';
  ctx.fillRect(18, 12, 9, 4);
  ctx.fillStyle = '#2e332b';
  ctx.fillRect(25, 12, 3, 4);

  // Nose cowl
  ctx.fillStyle = '#3c4a34';
  ctx.beginPath();
  ctx.ellipse(61, -1, 12, 15, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e6382f';
  ctx.beginPath();
  ctx.ellipse(61, -1, 8, 12, 0, 0, TAU);
  ctx.fill();

  // Propeller
  const spin = plane.prop;
  ctx.save();
  ctx.translate(72, -1);
  ctx.fillStyle = 'rgba(235,248,255,0.16)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 6, 31, 0, 0, TAU);
  ctx.fill();
  const bladeA = Math.sin(spin * 1.6) * 0.22;
  ctx.strokeStyle = 'rgba(38,44,34,0.65)';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.lineTo(Math.sin(spin * 1.6) * 3, -30);
  ctx.moveTo(0, 4);
  ctx.lineTo(Math.sin(spin * 1.6 + Math.PI) * 3, 30);
  ctx.stroke();
  ctx.fillStyle = '#2c3526';
  ctx.beginPath();
  ctx.ellipse(0, 0, 4.6, 5.5 + bladeA, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Spinner tip
  ctx.fillStyle = '#ff7a3d';
  ctx.beginPath();
  ctx.arc(75, -1, 2.4, 0, TAU);
  ctx.fill();

  ctx.restore();
}

function drawBombs() {
  const s = view.scale;
  for (const b of g.bombs) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);
    ctx.scale(s, s);

    ctx.fillStyle = '#363f47';
    ctx.beginPath();
    ctx.moveTo(-6, -8);
    ctx.lineTo(-9, -13);
    ctx.lineTo(0, -9);
    ctx.lineTo(9, -13);
    ctx.lineTo(6, -8);
    ctx.closePath();
    ctx.fill();

    const body = ctx.createLinearGradient(-4, 0, 4, 0);
    body.addColorStop(0, '#606b74');
    body.addColorStop(0.5, '#4a545d');
    body.addColorStop(1, '#353d44');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(-4, -10, 8, 17, 3.6);
    ctx.fill();

    ctx.fillStyle = '#ff7a3d';
    ctx.fillRect(-4, -2, 8, 2.6);

    ctx.fillStyle = '#20262b';
    ctx.beginPath();
    ctx.arc(0, 7, 3.4, 0, TAU);
    ctx.fill();

    ctx.restore();
  }
}

/* ------------------------------------------------------------- Effects */

function drawEffects() {
  if (flashSprite) {
    for (const f of g.flashes) {
      const a = clamp(f.life / f.max, 0, 1);
      const R = f.r * (1.4 - a * 0.3) * 1.15;
      ctx.globalAlpha = a;
      ctx.drawImage(flashSprite, f.x - R, f.y - R, R * 2, R * 2);
    }
    ctx.globalAlpha = 1;
  }

  for (const r of g.rings) {
    const a = clamp(r.life / r.max, 0, 1);
    ctx.strokeStyle = `rgba(255,240,200,${a * 0.7})`;
    ctx.lineWidth = 1 + 3 * a;
    ctx.beginPath();
    ctx.ellipse(r.x, r.y, r.r, r.r * 0.42, 0, 0, TAU);
    ctx.stroke();
  }

  for (const p of g.particles) {
    const a = clamp(p.life / p.max, 0, 1);
    if (p.kind === 'smoke') {
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (p.kind === 'fire' || p.kind === 'spark' || p.kind === 'trail') {
      ctx.globalCompositeOperation = p.add || p.kind === 'trail' ? 'lighter' : 'source-over';
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

function drawPopups() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of g.popups) {
    const a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = '900 18px "Trebuchet MS", Verdana, sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(12,34,24,0.7)';
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.restore();
}

function drawBanner() {
  if (g.banner.life <= 0) return;
  const b = g.banner;
  const t = b.life / b.max;
  const inT = clamp((1 - t) / 0.18, 0, 1);
  const outT = clamp(t / 0.25, 0, 1);
  const a = Math.min(inT, outT);
  const scale = 0.94 + inT * 0.06;

  const cx = view.w / 2;
  const cy = view.h * 0.33;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  const titleSize = clamp(view.w * 0.058, 28, 58);
  ctx.font = `900 ${titleSize}px "Trebuchet MS", Verdana, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(b.title).width;

  ctx.fillStyle = 'rgba(9,28,42,0.72)';
  ctx.beginPath();
  const padX = 34;
  const bh = titleSize * 1.3;
  ctx.moveTo(-tw / 2 - padX + 10, -bh / 2);
  ctx.lineTo(tw / 2 + padX, -bh / 2);
  ctx.lineTo(tw / 2 + padX - 10, bh / 2);
  ctx.lineTo(-tw / 2 - padX, bh / 2);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,207,122,0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#fff4dc';
  ctx.fillText(b.title, 0, 1);

  if (b.sub) {
    ctx.font = `800 ${clamp(view.w * 0.016, 10, 15)}px "Trebuchet MS", Verdana, sans-serif`;
    ctx.fillStyle = '#ffcf7a';
    ctx.fillText(b.sub, 0, bh / 2 + 20);
  }
  ctx.restore();
}

/* ============================================================== Inputs */

function aimFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  g.aimX = e.clientX - rect.left;
  g.aimY = e.clientY - rect.top;
  g.aimOffset = e.pointerType === 'mouse' ? 0 : 62 * view.scale;
}

canvas.addEventListener('pointerdown', (e) => {
  if (g.state !== 'playing') return;
  ensureAudio();
  g.aiming = true;
  g.pointerId = e.pointerId;
  aimFromEvent(e);
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});

canvas.addEventListener('pointermove', (e) => {
  if (!g.aiming || e.pointerId !== g.pointerId) return;
  aimFromEvent(e);
});

function endAim(e) {
  if (e && g.pointerId !== null && e.pointerId !== g.pointerId) return;
  g.aiming = false;
  g.pointerId = null;
}

canvas.addEventListener('pointerup', endAim);
canvas.addEventListener('pointercancel', endAim);
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && g.aiming) endAim(e);
});

window.addEventListener('keydown', (e) => {
  const blocked = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  if (blocked.includes(e.code)) e.preventDefault();

  if (g.state === 'menu' && (e.code === 'Enter' || e.code === 'Space')) {
    startGame();
    return;
  }

  if (e.code === 'Space' || e.code === 'KeyJ') {
    if (!e.repeat) ensureAudio();
    keys.add(e.code);
    return;
  }

  keys.add(e.code);

  if (e.repeat) return;

  if (e.code === 'KeyP' || e.code === 'Escape') {
    e.preventDefault();
    if (g.state === 'playing' || g.state === 'paused') togglePause();
    return;
  }
  if (e.code === 'KeyM') {
    ensureAudio();
    setMuted(!g.muted);
    return;
  }
  if (e.code === 'Enter' && !el.overlay.classList.contains('hidden')) {
    if (g.state === 'menu') startGame();
    else if (g.state === 'paused') togglePause();
  }
});

window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

window.addEventListener('blur', () => {
  keys.clear();
  g.bombHeld = false;
  g.aiming = false;
  el.bombBtn.classList.remove('is-down');
  if (g.state === 'playing') togglePause();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    keys.clear();
    g.bombHeld = false;
    g.aiming = false;
    if (g.state === 'playing') togglePause();
  }
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Bomb button (touch)
function bombPress(e) {
  e.preventDefault();
  if (g.state !== 'playing') return;
  ensureAudio();
  g.bombHeld = true;
  el.bombBtn.classList.add('is-down');
  try { el.bombBtn.setPointerCapture(e.pointerId); } catch (_) {}
  tryDrop();
}
function bombRelease() {
  g.bombHeld = false;
  el.bombBtn.classList.remove('is-down');
}
el.bombBtn.addEventListener('pointerdown', bombPress);
el.bombBtn.addEventListener('pointerup', bombRelease);
el.bombBtn.addEventListener('pointercancel', bombRelease);
el.bombBtn.addEventListener('lostpointercapture', bombRelease);

// UI
el.startBtn.addEventListener('click', startGame);
el.resumeBtn.addEventListener('click', () => { if (g.state === 'paused') togglePause(); });
el.restartBtn.addEventListener('click', startGame);
el.pauseBtn.addEventListener('click', () => {
  if (g.state === 'playing' || g.state === 'paused') togglePause();
});
el.soundBtn.addEventListener('click', () => {
  ensureAudio();
  setMuted(!g.muted);
});

/* ================================================================ Loop */

let last = performance.now();

function update(dt) {
  g.time += dt;
  updateClouds(dt);

  if (g.state === 'menu') updateIdlePlane(dt);
  if (g.state === 'playing') updatePlay(dt);

  g.shake *= Math.exp(-7 * dt);
  if (g.shake < 0.15) g.shake = 0;
  g.flash *= Math.exp(-5.5 * dt);
  if (g.flash < 0.004) g.flash = 0;

  if (g.banner.life > 0) g.banner.life = Math.max(0, g.banner.life - dt);
}

function tuneQuality(rawDt) {
  if (forcedQuality) return;
  if (g.state !== 'playing') {
    perf.frames = 0;
    perf.elapsed = 0;
    perf.wait = 0;
    return;
  }
  if (perf.wait > 0) {
    perf.wait -= Math.min(0.2, rawDt);
    return;
  }

  perf.frames += 1;
  perf.elapsed += Math.min(0.2, rawDt);
  if (perf.elapsed < 1.3) return;

  const fps = perf.frames / perf.elapsed;
  perf.frames = 0;
  perf.elapsed = 0;

  if (fps < 34 && g.quality > 0.6) {
    g.quality = Math.max(0.6, Math.round((g.quality - 0.18) * 100) / 100);
    applyResolution();
    perf.wait = 1.2;
  } else if (fps > 58 && g.quality < 1) {
    g.quality = Math.min(1, Math.round((g.quality + 0.1) * 100) / 100);
    applyResolution();
    perf.wait = 1.2;
  }
}

function loop(now) {
  const rawDt = Math.max(0.001, (now - last) / 1000);
  const dt = Math.min(0.05, rawDt);
  last = now;
  update(dt);
  render();
  tuneQuality(rawDt);
  requestAnimationFrame(loop);
}

/* ================================================================ Boot */

function boot() {
  try { g.muted = localStorage.getItem('gokavci.muted') === '1'; } catch (_) {}

  const qParam = new URLSearchParams(window.location.search).get('quality');
  if (qParam !== null) {
    const q = parseFloat(qParam);
    if (Number.isFinite(q)) {
      g.quality = clamp(q, 0.5, 1);
      forcedQuality = true;
    }
  }

  setMuted(g.muted);

  craterSprite = makeCraterSprite();
  flashSprite = makeFlashSprite();

  resize();
  seedMenuTargets();
  updateHud();
  showOverlay('start');

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
  }

  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(loop);
  });
}

boot();

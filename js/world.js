/* eslint-disable no-unused-vars */

import { rollChoices, rarityColor } from "./content.js";

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function norm(x, y) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l, l };
}
function rand(a = 0, b = 1) { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }
function pickWeighted(map) {
  const entries = Object.entries(map || {});
  let sum = 0;
  for (const [,w] of entries) sum += Math.max(0, +w || 0);
  if (sum <= 0) return null;
  let r = Math.random() * sum;
  for (const [k,w] of entries) {
    r -= Math.max(0, +w || 0);
    if (r <= 0) return k;
  }
  return entries[entries.length-1]?.[0] || null;
}
function now() { return performance.now(); }

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[m]));
}


// localStorage meta
const META_KEY = "PIXEL_DUNGEON_META_V3";

function defaultMeta() {
  return {
    bestWave: 0,
    bestScore: 0,
    unlockedWeapons: ["pistol"],
    lastDiff: "normal",
    lastWeapon: "pistol",
    settings: { sfxVol: 0.60, shake: 0.70 },
    tutorialSeen: false,
  };
}
function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    return { ...defaultMeta(), ...m, settings: { ...defaultMeta().settings, ...(m.settings || {}) } };
  } catch { return null; }
}
function saveMeta(meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {}
}

function diffProfile(key) {
  const k = String(key || "normal");
  if (k === "easy") return { key: "easy", enemyHpMult: 0.90, enemyDmgMult: 0.90, spawnIntervalMult: 1.10, scoreMult: 0.90, label: "Easy", desc: "입문자용. 적이 약하고 스폰이 느립니다." };
  // NOTE: user request: even Hard felt too easy -> harder scaling
  if (k === "hard") return { key: "hard", enemyHpMult: 1.75, enemyDmgMult: 1.55, spawnIntervalMult: 0.65, scoreMult: 1.35, label: "Hard", desc: "숙련자용(강화). 적이 매우 강하고 스폰이 매우 빠릅니다." };
  return { key: "normal", enemyHpMult: 1.0, enemyDmgMult: 1.0, spawnIntervalMult: 1.0, scoreMult: 1.0, label: "Normal", desc: "밸런스형. 기본 추천." };
}

// asset helpers (module-relative)
function assetURL(rel) {
  try {
    return new URL(rel, import.meta.url).toString();
  } catch {
    return rel;
  }
}
function loadImg(rel) {
  const img = new Image();
  img.src = assetURL(rel);
  return img;
}
function canDrawImg(img) {
  return img && img.complete && img.naturalWidth > 0;
}
function drawSprite(ctx, img, x, y, w, h, alpha = 1) {
  if (!canDrawImg(img)) return false;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
  ctx.restore();
  return true;
}

/* =========================
   Input / Camera / Audio
   ========================= */
class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false, right: false };
    this._bind(canvas);
  }
  _bind(canvas) {
    window.addEventListener("keydown", (e) => {
      if (["Tab"].includes(e.key)) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
    }, { passive: false });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));

    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
      this.mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
    });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  k(k) { return this.keys.has(String(k).toLowerCase()); }
}

class Camera {
  constructor() {
    this.shake = 0;
    this.shakeDecay = 7;
    this.mult = 1.0;
  }
  kick(a) { this.shake = Math.min(18, this.shake + a); }
  update(dt) { this.shake = Math.max(0, this.shake - this.shakeDecay * dt * 60); }
  apply(ctx) {
    const s = this.shake * this.mult;
    if (s <= 0.01) return;
    const ox = (Math.random() - 0.5) * s;
    const oy = (Math.random() - 0.5) * s;
    ctx.translate(ox, oy);
  }
}

class AudioBus {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this._last = new Map();
  }
  _ensure() {
    if (this.enabled) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      this.enabled = true;
    } catch {}
  }
  resume() {
    this._ensure();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }
  setVolume(v) {
    if (!this.enabled) return;
    this.master.gain.value = clamp(v, 0, 1);
  }
  // tiny synth beep - throttled
  play(name, freq = 440, dur = 0.06, type = "square", gain = 0.10, minGap = 0.03) {
    this._ensure();
    if (!this.enabled || !this.ctx) return;

    const t = this.ctx.currentTime;
    const last = this._last.get(name) || 0;
    if (t - last < minGap) return;
    this._last.set(name, t);

    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = 0;
    o.connect(g);
    g.connect(this.master);

    const a = 0.001;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    o.start(t);
    o.stop(t + dur + 0.02);
  }
}

/* =========================
   FX / UI floaters
   ========================= */
class Particle {
  constructor(x, y, vx, vy, life, size, col = "rgba(255,246,232,.85)") {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life;
    this.t = 0;
    this.size = size;
    this.col = col;
  }
  update(dt) {
    this.t += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= Math.pow(0.03, dt);
    this.vy *= Math.pow(0.03, dt);
  }
  get dead() { return this.t >= this.life; }
  draw(ctx) {
    const a = 1 - (this.t / this.life);
    ctx.globalAlpha = a;
    ctx.fillStyle = this.col;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
class Floater {
  constructor(x, y, text, life = 0.75, col = "rgba(255,246,232,.92)") {
    this.x = x; this.y = y;
    this.text = text;
    this.life = life;
    this.t = 0;
    this.vy = -44;
    this.col = col;
  }
  update(dt) { this.t += dt; this.y += this.vy * dt; }
  get dead() { return this.t >= this.life; }
  draw(ctx) {
    const a = 1 - (this.t / this.life);
    ctx.globalAlpha = a;
    ctx.fillStyle = this.col;
    ctx.font = "900 14px ui-monospace, monospace";
    ctx.fillText(this.text, this.x, this.y);
    ctx.globalAlpha = 1;
  }
}

/* =========================
   Pickups
   ========================= */
class Pickup {
  constructor(type, x, y, value = 10) {
    this.type = type;
    this.x = x; this.y = y;
    this.vx = rand(-90, 90);
    this.vy = rand(-90, 90);
    this.value = value;
    this.r = (type === "xp") ? 7 : 9;
    this.t = 0;
    this.life = 18;
    this.magnetR = (type === "xp") ? 170 : 150;
    this.magnetK = (type === "xp") ? 560 : 520;
  }
  get dead() { return this.t >= this.life; }
  update(game, dt) {
    this.t += dt;
    this.vx *= Math.pow(0.10, dt);
    this.vy *= Math.pow(0.10, dt);

    const bob = Math.sin((game.time * 2.4) + (this.x + this.y) * 0.01) * 2.0;

    const p = game.player;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;

    const mm = (p.stats?.magnetMult || 1);
    const mr = this.magnetR * mm;
    const mk = this.magnetK * mm;

    if (d < mr) {
      const pull = (1 - d / mr);
      this.vx += (dx / d) * mk * pull * dt;
      this.vy += (dy / d) * mk * pull * dt;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt + bob * dt * 0.9;

    if (d < p.r + this.r + 2) {
      this.apply(game);
      this.t = this.life;
    }
  }
  apply(game) {
    const p = game.player;
    if (this.type === "xp") {
      p.addXP(game, this.value);
      const shown = Math.floor(this.value * (p.stats?.xpMult || 1));
      game.floaters.push(new Floater(this.x + rand(-6, 6), this.y - 14, `+${shown} XP`, 0.7, "rgba(122,168,255,.95)"));
      game.audio.play("xp", 740, 0.05, "square", 0.05, 0.03);
      return;
    }
    if (this.type === "hp") {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + this.value);
      const got = Math.max(0, Math.round(p.hp - before));
      game.floaters.push(new Floater(this.x + rand(-6, 6), this.y - 14, `+${got} HP`, 0.7, "rgba(127,226,122,.95)"));
      game.audio.play("hp", 320, 0.07, "triangle", 0.06, 0.04);
      return;
    }
    if (this.type === "sh") {
      const before = p.sh;
      p.sh = Math.min(p.maxSh, p.sh + this.value);
      const got = Math.max(0, Math.round(p.sh - before));
      game.floaters.push(new Floater(this.x + rand(-6, 6), this.y - 14, `+${got} SH`, 0.7, "rgba(255,210,122,.95)"));
      game.audio.play("sh", 520, 0.06, "triangle", 0.06, 0.04);
      return;
    }
  }
  draw(ctx) {
    const blink = 0.65 + 0.35 * Math.sin((this.t * 4.0) + (this.x + this.y) * 0.03);

    if (this.type === "xp") ctx.fillStyle = `rgba(122,168,255,${0.85 * blink})`;
    if (this.type === "hp") ctx.fillStyle = `rgba(127,226,122,${0.85 * blink})`;
    if (this.type === "sh") ctx.fillStyle = `rgba(255,210,122,${0.85 * blink})`;

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r + 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/* =========================
   Combat entities
   ========================= */
class Bullet {
  constructor(x, y, vx, vy, dmg, pierce = 0, r = 4, owner = "player", opts = null) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.dmg = dmg;
    this.pierce = pierce;
    this.r = r;
    this.owner = owner;
    this.opts = opts || {};
    this.t = 0;
    this.life = (this.opts && typeof this.opts.life === "number")
      ? this.opts.life
      : (this.opts?.bolt ? 2.2 : 1.6);
  }
  update(dt) {
    this.t += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
  get dead() { return this.t >= this.life; }
  draw(ctx) {
    ctx.fillStyle = this.opts?.bolt ? "rgba(210,177,106,.92)" : "rgba(255,246,232,.92)";
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

class BeamFX {
  constructor(ax, ay, bx, by, width, t = 0.09) {
    this.ax = ax; this.ay = ay;
    this.bx = bx; this.by = by;
    this.width = width;
    this.t = t;
  }
  update(dt) { this.t -= dt; }
  get dead() { return this.t <= 0; }
  draw(ctx) {
    const a = clamp(this.t / 0.09, 0, 1);
    ctx.globalAlpha = a;
    ctx.strokeStyle = `rgba(122,168,255,${0.85 * a})`;
    ctx.lineWidth = this.width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(this.ax, this.ay);
    ctx.lineTo(this.bx, this.by);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/* =========================
   Enemy
   ========================= */
class Enemy {
  constructor(kind, x, y, wave) {
    this.kind = kind;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.t = 0;
    this.hitFlash = 0;

    const bonus = Math.max(0, wave - 5);

    if (kind === "chaser") {
      this.r = 16;
      this.maxHp = 80 + wave * 9 + bonus * 12;
      this.touch = 12;
      this.speed = 120 + wave * 3.0 + bonus * 2.0;
    } else if (kind === "charger") {
      this.r = 18;
      this.maxHp = 110 + wave * 12 + bonus * 16;
      this.touch = 16;
      this.speed = 98 + wave * 2.2 + bonus * 1.2;
      this.chargeCd = rand(1.2, 2.2);
      this.chargeT = 0;
    } else if (kind === "gunner") {
      this.r = 17;
      this.maxHp = 100 + wave * 10 + bonus * 14;
      this.touch = 12;
      this.speed = 92 + wave * 1.8 + bonus * 0.8;
      this.shootCd = rand(0.55, 0.90);
    } else if (kind === "bomber") {
      this.r = 18;
      this.maxHp = 95 + wave * 9 + bonus * 13;
      this.touch = 14;
      this.speed = 112 + wave * 2.4 + bonus * 1.2;
      this.fuse = rand(2.4, 3.6);
    } else if (kind === "boss2") {
      this.r = 38;
      this.maxHp = 1800 + wave * 190 + bonus * 260;
      this.touch = 26;
      this.speed = 76 + wave * 1.6;
      this.phase = 0;
      this.ringCd = 1.25;
      this.summonCd = 2.8;
      this.teleCd = 4.2;
      this.shootCd = 0.45;
      // telegraph preps
      this.ringPrep = 0;
      this.shootPrep = 0;
      this.telePrep = 0;
      this.summonPrep = 0;
      this._ringBase = 0;
      this._teleTarget = null;
      this._aim = null;
    } else { // boss
      this.r = 34;
      this.maxHp = 1100 + wave * 160 + bonus * 200;
      this.touch = 22;
      this.speed = 72 + wave * 1.5;
      this.phase = 0;
      this.shootCd = 0.65;
      this.slamCd = rand(2.4, 3.6);
      this.slamPrep = 0;
      this.shootPrep = 0;
      this._aim = null;
      // legacy var (unused but kept)
      this.chargeCd = 2.2;
    }

    this.hp = this.maxHp;
  }

  hit(game, dmg, srcWeapon = null) {
    let final = dmg;
    const w = String(srcWeapon || "");
    if (w) {
      const k = this.kind;
        // Weapon situational multipliers: encourages switching (Step8 tuning)
  const mult = (() => {
    // Bosses: crossbow best single-target, shotgun poor vs thick HP
    if (k === "boss" || k === "boss2") {
      if (w === "shotgun") return 0.55;
      if (w === "pistol") return 0.85;
      if (w === "rail") return 0.75;
      if (w === "crossbow") return 1.25;
    }
    // Gunners: dangerous at range -> crossbow/rail are better, shotgun struggles
    if (k === "gunner") {
      if (w === "pistol") return 0.75;
      if (w === "shotgun") return 0.55;
      if (w === "rail") return 1.10;
      if (w === "crossbow") return 1.20;
    }
    // Bombers: rail is good at popping groups safely
    if (k === "bomber") {
      if (w === "rail") return 1.10;
      if (w === "shotgun") return 0.80;
      if (w === "crossbow") return 0.95;
    }
    // Chargers: shotgun is the "panic" weapon, rail can miss value
    if (k === "charger") {
      if (w === "shotgun") return 1.20;
      if (w === "rail") return 0.80;
      if (w === "crossbow") return 1.05;
    }
    // Chasers (default melee swarm): shotgun shines, rail is less efficient
    if (k === "chaser") {
      if (w === "shotgun") return 1.15;
      if (w === "rail") return 0.85;
      if (w === "crossbow") return 0.95;
    }
    return 1;
  })();
  final = Math.max(1, Math.floor(final * mult));
}

    this.hp -= final;
    this.hitFlash = 0.10;
    if (this.hp <= 0) game.killEnemy(this);
  }

  update(game, dt) {
    this.t += dt;
    this.hitFlash -= dt;

    const p = game.player;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;

    if (this.kind === "chaser") {
      this.vx = lerp(this.vx, nx * this.speed, clamp(8 * dt, 0, 1));
      this.vy = lerp(this.vy, ny * this.speed, clamp(8 * dt, 0, 1));
    }

    if (this.kind === "charger") {
      this.chargeCd -= dt;
      if (this.chargeT > 0) {
        this.chargeT -= dt;
        this.vx = nx * (this.speed * 3.0);
        this.vy = ny * (this.speed * 3.0);
      } else {
        this.vx = lerp(this.vx, nx * this.speed, clamp(6 * dt, 0, 1));
        this.vy = lerp(this.vy, ny * this.speed, clamp(6 * dt, 0, 1));
        if (this.chargeCd <= 0 && d < 520) {
          this.chargeT = 0.28;
          this.chargeCd = rand(1.4, 2.6);
          game.audio.play("charge", 220, 0.08, "sawtooth", 0.06, 0.15);
        }
      }
    }

    if (this.kind === "gunner") {
      // keep some distance
      const want = clamp((d - 260) / 120, -1, 1);
      const mx = nx * want * this.speed;
      const my = ny * want * this.speed;
      this.vx = lerp(this.vx, mx, clamp(7 * dt, 0, 1));
      this.vy = lerp(this.vy, my, clamp(7 * dt, 0, 1));

      this.shootCd -= dt;
      if (this.shootCd <= 0 && d < 540) {
        this.shootCd = rand(0.85, 1.25);
        const sp = 360;
        const bx = this.x + nx * (this.r + 6);
        const by = this.y + ny * (this.r + 6);
        const dmg = Math.floor(10 * (game.diff?.enemyDmgMult || 1));
        game.enemyBullets.push(new Bullet(bx, by, nx * sp, ny * sp, dmg, 0, 4.2, "enemy"));
        game.audio.play("enemyShot", 340, 0.05, "square", 0.05, 0.08);
      }
    }

    if (this.kind === "bomber") {
      this.vx = lerp(this.vx, nx * this.speed, clamp(6.5 * dt, 0, 1));
      this.vy = lerp(this.vy, ny * this.speed, clamp(6.5 * dt, 0, 1));
      this.fuse -= dt;
      if (this.fuse <= 0 || d < this.r + p.r + 10) {
        // explode
        const R = 110;
        for (const e of game.enemies) {
          if (e === this) continue;
          const dd = Math.hypot(e.x - this.x, e.y - this.y);
          if (dd < R) e.hit(game, 55, 'rail');
        }
        if (d < R) game.damagePlayer(24);
        game.spawnHit(this.x, this.y, 30);
        game.floaters.push(new Floater(this.x - 18, this.y - 24, "BOOM!", 0.8, "rgba(255,111,111,.95)"));
        game.audio.play("boom", 120, 0.10, "sawtooth", 0.10, 0.15);
        game.killEnemy(this, true);
        return;
      }
    }

    if (this.kind === "boss") {
      // Approach player
      if (d > 120) {
        this.vx = (dx / d) * this.speed;
        this.vy = (dy / d) * this.speed;
      } else {
        this.vx *= 0.88;
        this.vy *= 0.88;
      }

      // slam telegraph -> slam
      if (this.slamPrep > 0) {
        this.slamPrep -= dt;
        if (this.slamPrep <= 0) {
          // slam
          game.camera.kick(10);
          game.audio.play("slam", 140, 0.12, "square", 0.08, 0.10);
          for (let i = 0; i < 22; i++) {
            const a = rand(0, Math.PI * 2);
            const sp = rand(80, 220);
            game.particles.push(new Particle(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.7, rand(2.0, 3.4), "rgba(210,177,106,.88)"));
          }
          // damage wave
          if (d < 170) game.player.hit(game, 28);
          this.slamCd = rand(5.2, 6.8);
        }
      } else {
        this.slamCd -= dt;
        if (this.slamCd <= 0 && d < 170) {
          this.slamPrep = 0.55;
          // warning circle
          (game.telegraphs || (game.telegraphs = [])).push(new TelegraphCircleFX(this.x, this.y, 170, 0.55, "rgba(255,111,111,.80)"));
          // lock a bit
          this.vx *= 0.4; this.vy *= 0.4;
        }
      }

      // shoot telegraph -> shoot
      if (this.shootPrep > 0) {
        this.shootPrep -= dt;
        if (this.shootPrep <= 0 && this._aim) {
          const ang = this._aim;
          const shots = 3;
          for (let i = 0; i < shots; i++) {
            const a = ang + (i - 1) * 0.12;
            const vx = Math.cos(a) * 340;
            const vy = Math.sin(a) * 340;
            game.enemyBullets.push(new Bullet(this.x, this.y, vx, vy, 16, 0, 6, "enemy", { life: 1.4 }));
          }
          game.audio.play("bossShot", 210, 0.08, "square", 0.06, 0.05);
          this.shootCd = rand(0.95, 1.35);
          this._aim = null;
        }
      } else {
        this.shootCd -= dt;
        if (this.shootCd <= 0 && d < 620) {
          this._aim = Math.atan2(dy, dx);
          const len = 520;
          const bx = this.x + Math.cos(this._aim) * len;
          const by = this.y + Math.sin(this._aim) * len;
          (game.telegraphs || (game.telegraphs = [])).push(new TelegraphLineFX(this.x, this.y, bx, by, 6, 0.35, "rgba(255,111,111,.95)"));
          this.shootPrep = 0.35;
        }
      }

      this.x += this.vx * dt;
      this.y += this.vy * dt;
      return;
    }


    if (this.kind === "boss2") {
      // FINAL BOSS (telegraphed): ring + bolts + summon + blink
      // keep some distance and strafe around player
      const desired = clamp((d - 320) / 220, -1, 1);
      const wob = Math.sin(this.t * 0.9) * 0.9;
      const tx = nx * this.speed * desired + (-ny) * this.speed * 0.85 * wob;
      const ty = ny * this.speed * desired + (nx) * this.speed * 0.85 * wob;
      this.vx = lerp(this.vx, tx, clamp(4.2 * dt, 0, 1));
      this.vy = lerp(this.vy, ty, clamp(4.2 * dt, 0, 1));

      // ring telegraph -> ring
      if (this.ringPrep > 0) {
        this.ringPrep -= dt;
        if (this.ringPrep <= 0) {
          const n = 10;
          const base = this._ringBase;
          for (let i = 0; i < n; i++) {
            const a = base + (i / n) * Math.PI * 2;
            const vx = Math.cos(a) * 360;
            const vy = Math.sin(a) * 360;
            const dmg = Math.floor(14 * (game.diff?.enemyDmgMult || 1));
            game.enemyBullets.push(new Bullet(this.x, this.y, vx, vy, dmg, 0, 4.4, "enemy"));
          }
          game.audio.play("bossRing", 180, 0.09, "triangle", 0.08, 0.12);
          this.ringCd = 1.05;
        }
      } else {
        this.ringCd -= dt;
        if (this.ringCd <= 0) {
          this._ringBase = Math.atan2(dy, dx);
          (game.telegraphs || (game.telegraphs = [])).push(new TelegraphCircleFX(this.x, this.y, 160, 0.50, "rgba(255,111,111,.65)"));
          this.ringPrep = 0.50;
          this.ringCd = 999;
        }
      }

      // bolts telegraph -> bolts
      if (this.shootPrep > 0) {
        this.shootPrep -= dt;
        if (this.shootPrep <= 0 && this._aim !== null) {
          const a = this._aim;
          for (let i = -1; i <= 1; i += 2) {
            const aa = a + i * 0.08;
            const vx = Math.cos(aa) * 520;
            const vy = Math.sin(aa) * 520;
            const dmg = Math.floor(17 * (game.diff?.enemyDmgMult || 1));
            game.enemyBullets.push(new Bullet(this.x, this.y, vx, vy, dmg, 0, 5.0, "enemy"));
          }
          this._aim = null;
          this.shootCd = 0.55;
        }
      } else {
        this.shootCd -= dt;
        if (this.shootCd <= 0 && d < 720) {
          this._aim = Math.atan2(dy, dx);
          const len = 640;
          const bx = this.x + Math.cos(this._aim) * len;
          const by = this.y + Math.sin(this._aim) * len;
          (game.telegraphs || (game.telegraphs = [])).push(new TelegraphLineFX(this.x, this.y, bx, by, 5, 0.32, "rgba(255,111,111,.95)"));
          const bx2 = this.x + Math.cos(this._aim + 0.08) * len;
          const by2 = this.y + Math.sin(this._aim + 0.08) * len;
          (game.telegraphs || (game.telegraphs = [])).push(new TelegraphLineFX(this.x, this.y, bx2, by2, 4, 0.32, "rgba(255,111,111,.70)"));
          this.shootPrep = 0.32;
          this.shootCd = 999;
        }
      }

      // summon telegraph -> summon
      if (this.summonPrep > 0) {
        this.summonPrep -= dt;
        if (this.summonPrep <= 0) {
          for (let i = 0; i < 2; i++) {
            const a = rand(0, Math.PI * 2);
            const rx = this.x + Math.cos(a) * rand(46, 78);
            const ry = this.y + Math.sin(a) * rand(46, 78);
            game.spawnEnemyAt("chaser", rx, ry);
          }
          game.floaters.push(new Floater(this.x - 42, this.y - this.r - 24, "SUMMON", 0.75, "rgba(210,177,106,.95)"));
          this.summonCd = 2.65;
        }
      } else {
        this.summonCd -= dt;
        if (this.summonCd <= 0) {
          (game.telegraphs || (game.telegraphs = [])).push(new TelegraphCircleFX(this.x, this.y, 120, 0.45, "rgba(210,177,106,.55)"));
          this.summonPrep = 0.45;
          this.summonCd = 999;
        }
      }

      // teleport telegraph destination -> blink
      if (this.telePrep > 0) {
        this.telePrep -= dt;
        if (this.telePrep <= 0 && this._teleTarget) {
          const { fx, fy } = this._teleTarget;
          game.spawnHit(this.x, this.y, 26);
          this.x = fx; this.y = fy;
          this.vx = 0; this.vy = 0;
          game.spawnHit(this.x, this.y, 26);
          game.audio.play("tele", 720, 0.07, "sine", 0.05, 0.08);
          this._teleTarget = null;
          this.teleCd = 4.6;
        }
      } else {
        this.teleCd -= dt;
        if (this.teleCd <= 0) {
          // blink behind player (safe within arena)
          const a = Math.atan2(-dy, -dx);
          const nx2 = Math.cos(a), ny2 = Math.sin(a);
          const tx2 = p.x + nx2 * 260;
          const ty2 = p.y + ny2 * 260;
          const ar2 = game.arena;
          const ddx2 = tx2 - ar2.x, ddy2 = ty2 - ar2.y;
          const dist2 = Math.hypot(ddx2, ddy2) || 1;
          const limit2 = ar2.r - this.r - 10;
          const fx = dist2 > limit2 ? (ar2.x + ddx2 / dist2 * limit2) : tx2;
          const fy = dist2 > limit2 ? (ar2.y + ddy2 / dist2 * limit2) : ty2;

          (game.telegraphs || (game.telegraphs = [])).push(new TelegraphCircleFX(fx, fy, 28, 0.45, "rgba(255,210,122,.70)"));
          this._teleTarget = { fx, fy };
          this.telePrep = 0.45;
          this.teleCd = 999;
        }
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // arena clamp
    const ar = game.arena;
    const ddx = this.x - ar.x;
    const ddy = this.y - ar.y;
    const dist = Math.hypot(ddx, ddy) || 1;
    const limit = ar.r - this.r - 6;
    if (dist > limit) {
      this.x = ar.x + (ddx / dist) * limit;
      this.y = ar.y + (ddy / dist) * limit;
      this.vx *= 0.3;
      this.vy *= 0.3;
    }
  }

  draw(ctx, game) {
    const hpT = clamp(this.hp / this.maxHp, 0, 1);

    // body
    let base = "rgba(180,160,120,.92)";
    let edge = "rgba(0,0,0,.70)";
    if (this.kind === "chaser") base = "rgba(205,186,146,.92)";
    if (this.kind === "charger") base = "rgba(255,210,122,.92)";
    if (this.kind === "gunner") base = "rgba(122,168,255,.92)";
    if (this.kind === "bomber") base = "rgba(255,111,111,.90)";
    if (this.kind === "boss") base = "rgba(210,177,106,.95)";
    if (this.kind === "boss2") base = "rgba(107,74,134,.94)";

    if (this.hitFlash > 0) base = "rgba(255,246,232,.98)";

    // sprite-first
    const key = (this.kind === "boss" ? "boss" : (this.kind === "boss2" ? "boss2" : this.kind));
    const img = game?.assets?.sprite?.[key];
    const scale = (this.kind === "boss" || this.kind === "boss2") ? 2.6 : 2.2;
    const used = drawSprite(ctx, img, this.x, this.y, this.r * scale, this.r * scale, this.hitFlash > 0 ? 0.85 : 1);

    if (!used) {
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = edge;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // hp bar
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(this.x - this.r, this.y - this.r - 12, this.r * 2, 6);
    ctx.fillStyle = "rgba(127,226,122,.85)";
    ctx.fillRect(this.x - this.r, this.y - this.r - 12, this.r * 2 * hpT, 6);
    ctx.globalAlpha = 1;
  }
}

/* =========================
   Player
   ========================= */
class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = 15;

    this.maxHp = 120;
    this.hp = this.maxHp;

    this.maxSh = 60;
    this.sh = this.maxSh;

    this.speed = 190;
    this.accel = 12.0;

    this.stats = {
      damage: 16,
      // fireRate is a multiplier (x1.00 = baseline)
      fireRate: 1.0,
      bulletSpeed: 500,
      spread: 0.035,
      pierce: 0,
      bulletSize: 4.2,

      critChance: 0.05,
      critMult: 1.50,

      magnetMult: 1.0,
      xpMult: 1.0,
      dashCdMult: 1.0,

      // skill cooldown multiplier (Aegis)
      skillCdMult: 1.0,
      // Aegis duration (seconds)
      aegisDur: 2.0,

      pellets: 4,
      shotgunSpread: 0.25,
      railWidth: 9,

      // orbiting orbs
      orbs: 0,
    };

    // weapons
    this.weapons = new Set(["pistol"]);
    this.weapon = "pistol";

    // dash / iframes / aegis / cooldowns
    this.dashCd = 0;
    this.dashCdMax = 5;
    this.dashTime = 0;
    // short i-frames used by dash / getting hit
    this.iframes = 0;
    // Aegis (RMB) true invulnerability duration
    this.aegis = 0;
    // visual-only flash when damaged (separate from Aegis)
    this.hurtFlash = 0;

    this.aegisCd = 0;
    this.aegisCdMax = 30;

    this.xp = 0;
    this.level = 1;
    this.score = 0;

    this._shootCd = 0;
  }

  hasWeapon(name) { return this.weapons.has(String(name)); }
  // returns true only when it was newly unlocked
  unlockWeapon(name) {
    const k = String(name);
    const had = this.weapons.has(k);
    this.weapons.add(k);
    return !had;
  }
  setWeapon(name) {
    const n = String(name);
    if (this.weapons.has(n)) this.weapon = n;
  }
  weaponLabel() {
    if (this.weapon === "pistol") return "Pistol(1)";
    if (this.weapon === "shotgun") return "Shotgun(2)";
    if (this.weapon === "rail") return "Rail Beam(3)";
    if (this.weapon === "crossbow") return "Crossbow(4)";
    return this.weapon;
  }

  xpNeed() {
    return Math.floor(55 + this.level * 28 + Math.pow(this.level, 1.22) * 10);
  }

  addXP(game, v) {
    const gain = Math.floor(v * (this.stats?.xpMult || 1));
    this.xp += gain;
    while (this.xp >= this.xpNeed()) {
      this.xp -= this.xpNeed();
      this.level += 1;
      game.openLevelUp();
    }
  }

  update(game, dt) {
    const inp = game.input;

    // weapon switch
    if (inp.k("1")) this.setWeapon("pistol");
    if (inp.k("2")) this.setWeapon("shotgun");
    if (inp.k("3")) this.setWeapon("rail");
    if (inp.k("4")) this.setWeapon("crossbow");

    // dash (base 5s cooldown; upgrades reduce)
    const wantDash = inp.k("shift") && this.dashCd <= 0 && this.dashTime <= 0;
    if (wantDash) {
      this.dashTime = 0.18;
      this.dashCdMax = 5.0 * (this.stats?.dashCdMult || 1);
      this.dashCd = this.dashCdMax;
      this.iframes = Math.max(this.iframes, 0.18);
      game.camera.kick(10);
      game.audio.play("dash", 180, 0.07, "sawtooth", 0.07, 0.12);
      for (let i = 0; i < 18; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(160, 360);
        game.particles.push(new Particle(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.35, rand(1.6, 2.6), "rgba(255,210,122,.85)"));
      }
    }
    this.dashCd = Math.max(0, this.dashCd - dt);

    // movement
    let mx = 0, my = 0;
    if (inp.k("w")) my -= 1;
    if (inp.k("s")) my += 1;
    if (inp.k("a")) mx -= 1;
    if (inp.k("d")) mx += 1;

    const m = norm(mx, my);
    const targetSpeed = this.dashTime > 0 ? (this.speed * 2.8) : this.speed;

    this.vx = lerp(this.vx, m.x * targetSpeed, clamp(this.accel * dt, 0, 1));
    this.vy = lerp(this.vy, m.y * targetSpeed, clamp(this.accel * dt, 0, 1));

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // arena clamp
    const ar = game.arena;
    const dx = this.x - ar.x;
    const dy = this.y - ar.y;
    const d = Math.hypot(dx, dy) || 1;
    const limit = ar.r - this.r - 6;
    if (d > limit) {
      this.x = ar.x + (dx / d) * limit;
      this.y = ar.y + (dy / d) * limit;
      this.vx *= 0.55;
      this.vy *= 0.55;
    }

    this.dashTime -= dt;
    this.iframes = Math.max(0, this.iframes - dt);
    this.aegis = Math.max(0, this.aegis - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);

    // aim (world coords)
    const aimx = game.input.mouse.x + (this.x - game.cx);
    const aimy = game.input.mouse.y + (this.y - game.cy);
    const adx = aimx - this.x;
    const ady = aimy - this.y;
    const a = Math.atan2(ady, adx);

    // shooting
    const wantShoot = game.input.mouse.down || inp.k(" ");
    this._shootCd -= dt;
    if (wantShoot && this._shootCd <= 0) {
      this._shootCd = this.fireInterval();
      this.shoot(game, a);
    }

    // skill: Aegis (right click) - 2s invulnerability, 30s cooldown (upgrades reduce)
    this.aegisCd = Math.max(0, this.aegisCd - dt);
    if (game.input.mouse.right && this.aegisCd <= 0 && !game.overlayOpen) {
      const dur = Math.max(0.2, (this.stats?.aegisDur || 2.0));
      this.aegis = Math.max(this.aegis, dur);
      this.aegisCdMax = 30.0 * (this.stats?.skillCdMult || 1);
      this.aegisCd = this.aegisCdMax;
      game.camera.kick(7);
      game.audio.play("aegis", 260, 0.09, "triangle", 0.07, 0.10);
      for (let i = 0; i < 28; i++) {
        const ang = rand(0, Math.PI * 2);
        const sp = rand(90, 260);
        game.particles.push(new Particle(this.x, this.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.55, rand(1.6, 2.6), "rgba(255,246,232,.85)"));
      }
    }

    // orbs
    if ((this.stats.orbs || 0) > 0) {
      game.updateOrbs(this, dt);
    }
  }

  fireInterval() {
  const st = this.stats;
  const fr = Math.max(0.1, st.fireRate || 1);
  // Step8 balance pass:
  // - pistol: baseline
  // - shotgun: close-range burst (slower)
  // - rail: line clear (slowest)
  // - crossbow: boss DPS (slow)
  if (this.weapon === "shotgun") return 0.90 / fr;
  if (this.weapon === "crossbow") return 0.86 / (fr * (st.xbowRate || 1));
  if (this.weapon === "rail") return 1.25 / fr;
  return 0.22 / fr; // pistol default
}

  shoot(game, ang) {
    const st = this.stats;
    const dmgBase = st.damage;
    const speed = st.bulletSpeed;
    const spread = st.spread;
    const pierce = Math.floor(st.pierce);
    const r = st.bulletSize;

    const crit = (Math.random() < (st.critChance || 0));
    const dmg = Math.floor(dmgBase * (crit ? (st.critMult || 1.5) : 1));

    if (this.weapon === "pistol") {
      const a = ang + rand(-spread, spread);
      const vx = Math.cos(a) * speed;
      const vy = Math.sin(a) * speed;
      game.bullets.push(new Bullet(this.x, this.y, vx, vy, dmg, pierce, r, "player", { weapon: this.weapon }));
      game.audio.play("shot", 520, 0.04, "square", 0.05, 0.02);
      if (crit) game.audio.play("crit", 860, 0.05, "triangle", 0.05, 0.05);
      return;
    }

    if (this.weapon === "shotgun") {
      // Close-range burst: pellets disappear fast so it's weak at long range
      const pellets = Math.max(4, Math.floor(st.pellets || 5));
      const sp = st.shotgunSpread || 0.24;
      for (let i = 0; i < pellets; i++) {
        const a = ang + rand(-sp, sp);
        const vx = Math.cos(a) * (speed * rand(0.78, 0.92));
        const vy = Math.sin(a) * (speed * rand(0.78, 0.92));
        game.bullets.push(new Bullet(this.x, this.y, vx, vy, Math.floor(dmg * 0.38), pierce, r * 0.90, "player", { life: 0.55, weapon: this.weapon }));
      }
      game.audio.play("shotgun", 260, 0.06, "square", 0.08, 0.06);
      return;
    }

    if (this.weapon === "crossbow") {
      const bolts = clamp(Math.floor(st.xbowBolts ?? 1), 1, 3);
      const extraPierce = Math.floor(st.xbowPierce ?? 0);
      const boltPierce = pierce + extraPierce;
      const sp = Math.max(0.02, spread * 0.55);
      for (let i = 0; i < bolts; i++) {
        const a = ang + rand(-sp, sp) + (i - (bolts - 1) / 2) * 0.05;
        const vx = Math.cos(a) * (speed * 1.02);
        const vy = Math.sin(a) * (speed * 1.02);
        // High single-target, slow rate: good vs bosses, not a room sweeper
        game.bullets.push(new Bullet(this.x, this.y, vx, vy, Math.floor(dmg * 1.10), boltPierce, r * 1.05, "player", { bolt: true, life: 2.0, weapon: this.weapon }));
      }
      game.camera.kick(3);
      game.audio.play("crossbow", 330, 0.07, "sawtooth", 0.06, 0.06);
      return;
    }

    if (this.weapon === "rail") {
      // instant beam damage on line
      const len = 660;
      const bx = this.x + Math.cos(ang) * len;
      const by = this.y + Math.sin(ang) * len;
      const width = Math.max(6, st.railWidth || 10);

      // damage enemies close to the beam
      for (const e of game.enemies) {
        const distSq = distToSegmentSq(e.x, e.y, this.x, this.y, bx, by);
        if (distSq < (e.r + width) * (e.r + width)) {
          // Line clear (slow): reduced per-hit multiplier to prevent being OP
          e.hit(game, Math.floor(dmg * 0.85));
        }
      }

      // beam FX: core + afterimage
      game.beams.push(new BeamFX(this.x, this.y, bx, by, width, 0.11));
      game.beams.push(new BeamFX(this.x, this.y, bx, by, width * 1.7, 0.18));
      game.camera.kick(5);
      game.audio.play("rail", 980, 0.07, "triangle", 0.07, 0.10);
      return;
    }
  }

  draw(ctx, game) {
    // body (sprite-first)
    // visuals: Aegis (gold/white) and Hit flash (red) are distinct
    const alpha = (this.aegis > 0.01) ? 0.85 : (this.hurtFlash > 0.01 ? 0.90 : 1);
    const used = drawSprite(ctx, game?.assets?.sprite?.player, this.x, this.y, this.r * 3.0, this.r * 3.0, alpha);
    if (!used) {
      ctx.fillStyle = "rgba(255,246,232,.92)";
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(0,0,0,.75)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Aegis ring (gold/white)
    if (this.aegis > 0.01) {
      const pulse = 0.5 + 0.5 * Math.sin((performance.now() || 0) * 0.01);
      ctx.globalAlpha = 0.70;
      ctx.strokeStyle = `rgba(255,210,122,${0.85 - pulse * 0.25})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 10 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Hit flash ring (red) - separate from Aegis
    if (this.hurtFlash > 0.01 && this.aegis <= 0.01) {
      const a = clamp(this.hurtFlash / 0.20, 0, 1);
      ctx.globalAlpha = 0.85 * a;
      ctx.strokeStyle = "rgba(255,111,111,.95)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

function distToSegmentSq(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const ab2 = abx * abx + aby * aby || 1;
  let t = (apx * abx + apy * aby) / ab2;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t, cy = ay + aby * t;
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy;
}

/* =========================
   Game
   ========================= */
const MAX_WAVE = 10;

// Spawn plans (non-boss waves). Boss waves are 5 and 10.
// Goal: make later waves meaningfully harder and enforce weapon switching.
const WAVE_PLAN = {
  1: { count: 14, rate: 0.22, weights: { chaser: 10 } },
  2: { count: 18, rate: 0.21, weights: { chaser: 10, charger: 3 } },
  3: { count: 22, rate: 0.20, weights: { chaser: 9, charger: 5, gunner: 2 } },
  4: { count: 26, rate: 0.19, weights: { chaser: 7, charger: 5, gunner: 4, bomber: 2 } },
  6: { count: 30, rate: 0.18, weights: { chaser: 5, charger: 6, gunner: 5, bomber: 4 } },
  7: { count: 34, rate: 0.17, weights: { chaser: 4, charger: 6, gunner: 6, bomber: 6 } },
  8: { count: 38, rate: 0.16, weights: { chaser: 3, charger: 6, gunner: 7, bomber: 7 } },
  9: { count: 42, rate: 0.15, weights: { chaser: 2, charger: 6, gunner: 8, bomber: 8 } },
};

function isBossWaveN(w) { return (w === 5 || w === 10); }
function getWaveConfig(w, diff) {
  if (isBossWaveN(w)) return null;
  const base = WAVE_PLAN[w] || WAVE_PLAN[1];
  const spawnIntervalMult = (diff?.spawnIntervalMult || 1);
  return {
    count: Math.floor(base.count * (diff?.key === "easy" ? 0.92 : (diff?.key === "hard" ? 1.22 : 1.0))),
    rate: Math.max(0.065, base.rate * spawnIntervalMult),
    weights: base.weights,
  };
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this._resize();
    window.addEventListener("resize", () => this._resize());

    this.input = new Input(canvas);
    this.camera = new Camera();
    this.audio = new AudioBus();

    // pixel sprite pack (optional fallbacks)
    this.assets = {
      ui: {
        pistol: loadImg("../assets/ui/icon_pistol.png"),
        shotgun: loadImg("../assets/ui/icon_shotgun.png"),
        rail: loadImg("../assets/ui/icon_rail.png"),
        crossbow: loadImg("../assets/ui/icon_crossbow.png"),
      },
      sprite: {
        player: loadImg("../assets/sprites/player.png"),
        chaser: loadImg("../assets/sprites/enemy_chaser.png"),
        charger: loadImg("../assets/sprites/enemy_charger.png"),
        gunner: loadImg("../assets/sprites/enemy_gunner.png"),
        bomber: loadImg("../assets/sprites/enemy_bomber.png"),
        boss: loadImg("../assets/sprites/boss1.png"),
        boss2: loadImg("../assets/sprites/boss2.png"),
        xp: loadImg("../assets/sprites/pickup_xp.png"),
        hp: loadImg("../assets/sprites/pickup_hp.png"),
        sh: loadImg("../assets/sprites/pickup_sh.png"),
      }
    };

    this.cx = this.canvas.width / 2;
    this.cy = this.canvas.height / 2;

    this.time = 0;
    this.last = now();
    this.fps = 0;

    this.ui = null;
    this.buildPeekOpen = false;

    this.meta = loadMeta() || defaultMeta();
    this.diff = diffProfile(this.meta.lastDiff);

	  // meta 저장을 매 프레임 하지 않도록(성능/수명) - 누적 후 주기적으로 저장
	  this._metaDirty = false;
	  this._metaSaveAcc = 0;

    this.reset();
    this._bindGlobalKeys();
  }

	// 무기 해금/중요 이벤트를 화면에 깔끔하게 표시
	notifyWeaponUnlocked(weaponKey) {
	  const name = String(weaponKey);
	  const label = (name === "shotgun") ? "SHOTGUN" : (name === "rail") ? "RAIL BEAM" : (name === "crossbow") ? "CROSSBOW" : name.toUpperCase();
	  this.floaters.push(new Floater(this.player.x, this.player.y - 28, `UNLOCKED: ${label}`, 1.0, "rgba(122,168,255,.95)"));
	  this.camera.kick(6);
	  this.audio.play("unlock", 680, 0.08, "triangle", 0.07, 0.10);
	}

  bindUI(ui) {
    this.ui = ui;

    // overlay buttons
    ui.btnResume.addEventListener("click", () => this.closeOverlay());
    ui.btnRestart.addEventListener("click", () => { this.reset(); this.openMenu(); });

	    // full reset (clear progress)
	    const confirmOverlay = ui.confirmOverlay || ui.confirm;
	    if (ui.btnReset && confirmOverlay && ui.confirmYes && ui.confirmNo) {
      const openConfirm = () => {
        this.audio.resume();
	        confirmOverlay.hidden = false;
        this.audio.play("click", 240, 0.06, "square", 0.03, 0.04);
      };
      const closeConfirm = () => {
	        confirmOverlay.hidden = true;
      };
      ui.btnReset.addEventListener("click", openConfirm);
      ui.confirmNo.addEventListener("click", () => { closeConfirm(); this.audio.play("click", 220, 0.05, "square", 0.03, 0.04); });
	      confirmOverlay.addEventListener("click", (e) => {
	        if (e.target === confirmOverlay) closeConfirm();
      });
      ui.confirmYes.addEventListener("click", () => {
        // wipe meta and reload for a clean slate
        localStorage.removeItem(META_KEY);
        location.reload();
      });
    }

    // in-game weapon HUD (click to switch)
    if (ui.hudWeapons) {
      ui.hudWeapons.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-weapon]");
        if (!b) return;
        const w = b.dataset.weapon;
        this.audio.resume();
        if (!this.player.weapons.has(w)) {
          this.audio.play("locked", 140, 0.08, "square", 0.05, 0.08);
          return;
        }
        this.player.setWeapon(w);
        this.meta.lastWeapon = w;
	        this._metaDirty = true;
        this.audio.play("pick", 520, 0.05, "triangle", 0.05, 0.05);
      });
    }

    if (ui.btnStart) {
      ui.btnStart.onclick = () => {
        this.audio.resume();
        if (!this.meta.tutorialSeen) {
          this.openTutorial();
        } else {
          this.startRun();
        }
      };
      this._startHandler = ui.btnStart.onclick;
    }

    // difficulty pills
    if (ui.diffPills) {
      ui.diffPills.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-diff]");
        if (!b) return;
        this.setDifficulty(b.dataset.diff);
      });
    }

    // settings
    if (ui.volRange) {
      ui.volRange.addEventListener("input", () => {
        const v = clamp(parseFloat(ui.volRange.value) / 100, 0, 1);
        this.meta.settings.sfxVol = v;
        if (ui.volText) ui.volText.textContent = String(Math.round(v * 100));
        this.audio.setVolume(v);
        saveMeta(this.meta);
      });
    }
    if (ui.shakeRange) {
      ui.shakeRange.addEventListener("input", () => {
        const v = clamp(parseFloat(ui.shakeRange.value) / 100, 0, 1);
        this.meta.settings.shake = v;
        if (ui.shakeText) ui.shakeText.textContent = String(Math.round(v * 100));
        this.camera.mult = v;
        saveMeta(this.meta);
      });
    }
  }

  _bindGlobalKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.overlayOpen) {
          // tutorial/menu/dead/pause -> close only when meaningful
          if (this.overlayMode === "menu") return;
          if (this.overlayMode === "tutorial") return;
          if (this.overlayMode === "levelup") return;
          this.closeOverlay();
        } else {
          this.openPause();
        }
      }
if (e.key === "Tab") {
  // Quick build peek while playing (does not pause)
  e.preventDefault();
  if (this.overlayOpen) return;
  this.toggleBuildPeek();
}
    });
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.cx = w / 2;
    this.cy = h / 2;
  }

  reset() {
    this.arena = { x: this.cx, y: this.cy, r: Math.min(this.cx, this.cy) * 0.95 };

    this.player = new Player(this.arena.x, this.arena.y);

    // apply persistent unlocks
    for (const w of (this.meta.unlockedWeapons || ["pistol"])) this.player.unlockWeapon(w);
    this.player.setWeapon(this.meta.lastWeapon || "pistol");

    // in-game weapon HUD buttons
    this._renderWeaponHud();

    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.beams = [];
    this.particles = [];
    this.floaters = [];
    this.pickups = [];

    this.orbState = { list: [], cd: 0 };

    this.build = {
      upgrades: [],
      byKey: Object.create(null),
      rarityCounts: { common: 0, rare: 0, epic: 0 },
      total: 0,
    };

    this.wave = 1;
    this.waveCfg = getWaveConfig(this.wave, this.diff);
    this.toSpawn = this.waveCfg ? this.waveCfg.count : 0;
    this.spawnTimer = 0;
    this.spawnRate = this.waveCfg ? this.waveCfg.rate : (0.22 * (this.diff?.spawnIntervalMult || 1));

    // wave / boss banner timers
    this.bannerTimer = 0;
    this.bannerMain = "";
    this.bannerSub = "";

    // boss-wave guard (prevents immediate respawn on same frame as boss death)
    this.bossSpawned = false;

    this.overlayOpen = false;
    this.overlayMode = "pause";
    this.pendingChoices = [];

    // sync settings
    this.audio.setVolume(this.meta.settings?.sfxVol ?? 0.6);
    this.camera.mult = this.meta.settings?.shake ?? 0.7;

    this._uiTick(0);
  }

  openMenu() {
    this.overlayOpen = true;
    if (this.ui?.waveBanner) { this.ui.waveBanner.classList.add("hidden"); this.ui.waveBanner.setAttribute("aria-hidden","true"); }
    this.overlayMode = "menu";
    this._renderOverlay({
      title: "PIXEL DUNGEON",
      desc: "난이도·무기·설정 선택 후 시작하세요.",
      choices: []
    });
  }

  setDifficulty(key) {
    this.diff = diffProfile(key);
    this.meta.lastDiff = this.diff.key;
    saveMeta(this.meta);

    if (this.ui?.diffPills) {
      this.ui.diffPills.querySelectorAll(".pill").forEach(p => p.classList.toggle("is-active", p.dataset.diff === this.diff.key));
    }
    if (this.ui?.diffDesc) this.ui.diffDesc.textContent = this.diff.desc;

    this._renderMenuMeta();
  }

  setStartWeapon(w) {
    const n = String(w);
    if (!(this.meta.unlockedWeapons || []).includes(n)) return;
    this.meta.lastWeapon = n;
    saveMeta(this.meta);
    this._renderMenuMeta();
  }

  startRun() {
    this.reset(); // reset with current diff + weapons + settings
    this.showBanner(`WAVE ${this.wave}/${MAX_WAVE}`, isBossWaveN(this.wave) ? "BOSS" : "SURVIVE");
    this.overlayOpen = false;
    this.ui?.overlay?.classList.add("hidden");
    this.ui?.overlay?.setAttribute("aria-hidden", "true");
  }

  openTutorial() {
    this.overlayOpen = true;
    this.overlayMode = "tutorial";

    this._renderOverlay({
      title: "How to play",
      desc: "딱 15초만 보면 바로 시작 가능!",
      choices: []
    });

    // show tutorial content + replace Start button text
    if (!this.ui?.tutorialArea) return;
    this.ui.tutorialArea.classList.add("is-show");
    this.ui.tutorialArea.innerHTML = `
      <div class="tutGrid">
        <div class="tutCard">
          <div class="t">이동 & 회피</div>
          <div class="d">WASD로 이동 · Shift로 대시(무적 짧게) · 적에게 닿으면 피해</div>
        </div>
        <div class="tutCard">
          <div class="t">공격</div>
          <div class="d">마우스로 조준 · 클릭/스페이스로 발사 · 1/2/3/4로 무기 전환</div>
        </div>
        <div class="tutCard">
          <div class="t">스킬: Aegis</div>
          <div class="d">우클릭으로 2초 무적(30초 쿨, 업그레이드로 감소). 대시도 업그레이드로 쿨 감소</div>
        </div>
        <div class="tutCard">
          <div class="t">성장</div>
          <div class="d">XP(파란 구슬) 획득 → 레벨업 → 업그레이드 카드 1개 선택</div>
        </div>
      </div>
      <div class="menuSmall" style="margin-top:10px;">
        목표: 최대한 오래 생존해서 Wave와 Score 기록을 갱신하세요.
      </div>
    `;

    // button behavior: Start -> continue
    if (this.ui?.btnStart) {
      this.ui.btnStart.textContent = "이해했어! 시작";
      this.ui.btnStart.style.display = "inline-block";
      this.ui.btnStart.onclick = () => {
        this.meta.tutorialSeen = true;
        saveMeta(this.meta);
        // restore click binding to default
        this.ui.btnStart.onclick = this._startHandler || null;
        this.ui.btnStart.textContent = "시작";
        this.ui.tutorialArea.classList.remove("is-show");
        this.startRun();
      };
    }
  }

  openPause() {
    this.overlayOpen = true;
    if (this.ui?.waveBanner) { this.ui.waveBanner.classList.add("hidden"); this.ui.waveBanner.setAttribute("aria-hidden","true"); }
    this.overlayMode = "pause";
    this._renderOverlay({ title: "Paused", desc: "Esc로 닫거나 계속하기를 누르세요.", choices: [] });
  }

  openDead() {
    if (this.overlayOpen && this.overlayMode === "dead") return;
    this.overlayOpen = true;
    if (this.ui?.waveBanner) { this.ui.waveBanner.classList.add("hidden"); this.ui.waveBanner.setAttribute("aria-hidden","true"); }
    this.overlayMode = "dead";
    this._renderOverlay({
      title: "Game Over",
      desc: `Wave ${this.wave}/${MAX_WAVE} · Score ${this.player.score} · 레벨 ${this.player.level}`,
      choices: []
    });
  }

  openWin() {
    if (this.overlayOpen && this.overlayMode === "win") return;
    this.overlayOpen = true;
    if (this.ui?.waveBanner) { this.ui.waveBanner.classList.add("hidden"); this.ui.waveBanner.setAttribute("aria-hidden","true"); }
    this.overlayMode = "win";

    // persist unlocks + best records
    this._syncUnlockToMeta();
    if (this.player.score > (this.meta.bestScore || 0)) this.meta.bestScore = this.player.score;
    if (MAX_WAVE > (this.meta.bestWave || 0)) this.meta.bestWave = MAX_WAVE;
    saveMeta(this.meta);
    this._renderMenuMeta();

    this._renderOverlay({
      title: "VICTORY!",
      desc: `Wave ${MAX_WAVE}/${MAX_WAVE} Clear · Score ${this.player.score} · 레벨 ${this.player.level}`,
      choices: []
    });
    this.audio.play("victory", 520, 0.14, "triangle", 0.10, 0.28);
  }

  openLevelUp() {
    this.overlayOpen = true;
    this.overlayMode = "levelup";
    const picks = rollChoices(this, 3);
    this.pendingChoices = picks;
    this._renderOverlay({ title: "Level Up!", desc: "업그레이드 1개를 선택하세요.", choices: picks });
    this.audio.play("levelup", 760, 0.10, "triangle", 0.09, 0.20);
  }

  closeOverlay() {
    if (!this.ui) return;
    if (this.overlayMode === "levelup") return; // must choose
    this.overlayOpen = false;

    this.ui.overlay.classList.add("hidden");
    this.ui.overlay.setAttribute("aria-hidden", "true");
    if (this.ui.cards) this.ui.cards.innerHTML = "";
    if (this.ui.tutorialArea) {
      this.ui.tutorialArea.classList.remove("is-show");
      this.ui.tutorialArea.innerHTML = "";
    }
  }

  _renderOverlay({ title, desc, choices }) {
    if (!this.ui) return;
    // overlay takes focus -> hide quick build peek
    if (this.buildPeekOpen) this.toggleBuildPeek(false);

    this.ui.overlayTitle.textContent = title;
    this.ui.overlayDesc.textContent = desc;

    const showCards = (this.overlayMode === "levelup");
    const showMenu = (this.overlayMode === "menu");
    const showTutorial = (this.overlayMode === "tutorial");
    const showBuild = (!showCards && !showMenu && !showTutorial);

    // menu visible only on menu/tutorial
    if (this.ui.menuArea) this.ui.menuArea.style.display = (showMenu || showTutorial) ? "" : "none";

    // tutorial area toggled in openTutorial()
    if (this.ui.tutorialArea && !showTutorial) {
      this.ui.tutorialArea.classList.remove("is-show");
      this.ui.tutorialArea.innerHTML = "";
    }

    // cards
    if (this.ui.cards) {
      this.ui.cards.classList.toggle("is-show", showCards);
      this.ui.cards.style.display = showCards ? "" : "none";
      this.ui.cards.innerHTML = "";
    }

    // build summary
    if (this.ui.buildSummary) {
      this.ui.buildSummary.classList.toggle("is-show", showBuild);
      if (showBuild) this._renderBuildSummary();
      else this.ui.buildSummary.innerHTML = "";
    }

    // buttons
    if (this.ui.btnStart) this.ui.btnStart.style.display = (showMenu || showTutorial) ? "inline-block" : "none";
    if (this.ui.btnResume) this.ui.btnResume.style.display = (this.overlayMode === "pause") ? "inline-block" : "none";
    if (this.ui.btnRestart) this.ui.btnRestart.style.display = (this.overlayMode === "pause" || this.overlayMode === "dead" || this.overlayMode === "win") ? "inline-block" : "none";

    // fill menu meta
    if (showMenu || showTutorial) this._renderMenuMeta();

    // build cards
    if (showCards && choices && choices.length) {
      for (const u of choices) {
        const el = document.createElement("div");
        el.className = "card";
        const rar = String(u.rarity || "common");
        const c = rarityColor(rar);
        el.style.outlineColor = c;
        el.innerHTML = `
          <div class="rar"><span class="pip" style="background:${c}"></span><span>${rar.toUpperCase()}</span></div>
          <div class="t">${u.title}</div>
          <div class="d">${u.desc}</div>
          <div class="tag">${u.tag || ""}</div>
        `;
        el.addEventListener("click", () => {
          if (typeof u.apply === "function") u.apply(this.player, this);
          this._recordUpgrade(u);
          // persist weapon unlocks
          this._syncUnlockToMeta();
          // close levelup
          this.overlayOpen = false;
          this.ui.overlay.classList.add("hidden");
          this.ui.overlay.setAttribute("aria-hidden", "true");
          this.ui.cards.innerHTML = "";
        });
        this.ui.cards.appendChild(el);
      }
    }

    // show overlay
    this.ui.overlay.classList.remove("hidden");
    this.ui.overlay.setAttribute("aria-hidden", "false");

    // sync settings UI
    if (this.ui.volRange) {
      const v = Math.round((this.meta.settings?.sfxVol ?? 0.6) * 100);
      this.ui.volRange.value = String(v);
      if (this.ui.volText) this.ui.volText.textContent = String(v);
    }
    if (this.ui.shakeRange) {
      const v = Math.round((this.meta.settings?.shake ?? 0.7) * 100);
      this.ui.shakeRange.value = String(v);
      if (this.ui.shakeText) this.ui.shakeText.textContent = String(v);
    }
  }

  _recordUpgrade(u) {
    if (!this.build) {
      this.build = { upgrades: [], byKey: Object.create(null), rarityCounts: { common: 0, rare: 0, epic: 0 }, total: 0 };
    }
    const b = this.build;
    if (!b.upgrades) b.upgrades = [];
    if (!b.byKey) b.byKey = Object.create(null);
    if (!b.rarityCounts) b.rarityCounts = { common: 0, rare: 0, epic: 0 };

    b.total = (b.total || 0) + 1;
    const key = String(u.key || "");
    const rar = String(u.rarity || "common");

    // per-upgrade level count
    if (!b.byKey[key]) {
      b.byKey[key] = { title: u.title, rarity: rar, count: 0 };
    }
    b.byKey[key].count += 1;
    const lv = b.byKey[key].count;

    // rarity count
    if (b.rarityCounts[rar] != null) b.rarityCounts[rar] += 1;

    // record pick order + Lv
    b.upgrades.push({
      idx: b.total,
      key,
      title: u.title,
      desc: u.desc,
      tag: u.tag,
      rarity: rar,
      lv,
    });

    if (this.buildPeekOpen) this._renderBuildPeek();
  }


toggleBuildPeek(force = null) {
  if (!this.ui?.buildPeek) return;
  const next = (force == null) ? !this.buildPeekOpen : !!force;
  this.buildPeekOpen = next;

  this.ui.buildPeek.classList.toggle("hidden", !next);
  this.ui.buildPeek.setAttribute("aria-hidden", next ? "false" : "true");
  if (next) this._renderBuildPeek();
}

_renderBuildPeek() {
  if (!this.ui?.buildPeek) return;

  const p = this.player;
  const b = this.build || {};
  const ups = Array.isArray(b.upgrades) ? b.upgrades : [];
  const recent = ups.slice(-6).reverse();

  if (!recent.length) {
    this.ui.buildPeek.innerHTML = `
      <div class="rowTop">
        <div class="ttl">Build</div>
        <div class="hint">Tab: 닫기</div>
      </div>
      <div class="list">
        <div class="up"><div class="left"><div class="idx">-</div><div class="name">아직 업그레이드 없음</div></div><div class="lv">Lv 0</div></div>
      </div>
    `;
    return;
  }

  const rows = recent.map(u => {
    const rar = String(u.rarity || "common");
    const c = rarityColor(rar);
    const idx = String(u.idx ?? "");
    const title = escapeHTML(u.title || "");
    const lv = String(u.lv ?? 1);
    return `
      <div class="up">
        <div class="left">
          <div class="idx">#${idx}</div>
          <div class="name">${title}</div>
        </div>
        <div class="lv" title="${rar.toUpperCase()}" style="border-color:${c}; box-shadow:0 0 0 1px rgba(0,0,0,.18) inset;">
          Lv ${lv}
        </div>
      </div>
    `;
  }).join("");

  this.ui.buildPeek.innerHTML = `
    <div class="rowTop">
      <div class="ttl">Build · ${escapeHTML(p.weaponLabel())}</div>
      <div class="hint">Tab: 닫기</div>
    </div>
    <div class="list">${rows}</div>
  `;
}

  _syncUnlockToMeta() {
    // if player got shotgun/rail, persist
    const list = new Set(this.meta.unlockedWeapons || ["pistol"]);
    for (const w of this.player.weapons) list.add(w);
    this.meta.unlockedWeapons = Array.from(list);
    saveMeta(this.meta);
    this._renderMenuMeta();
    this._renderWeaponHud();
  }

  _renderMenuMeta() {
    if (!this.ui) return;

    if (this.ui.bestWaveText) this.ui.bestWaveText.textContent = String(this.meta.bestWave || 0);
    if (this.ui.bestScoreText) this.ui.bestScoreText.textContent = String(this.meta.bestScore || 0);

    // diff desc
    if (this.ui.diffDesc) this.ui.diffDesc.textContent = this.diff.desc;

    // weapon pills
    if (this.ui.weaponPills) {
      const unlocked = new Set(this.meta.unlockedWeapons || ["pistol"]);
      const all = [
        { k: "pistol", label: "Pistol (1)", icon: "./assets/ui/icon_pistol.svg" },
        { k: "shotgun", label: "Shotgun (2)", icon: "./assets/ui/icon_shotgun.svg" },
        { k: "rail", label: "Rail (3)", icon: "./assets/ui/icon_rail.svg" },
        { k: "crossbow", label: "Crossbow (4)", icon: "./assets/ui/icon_crossbow.svg" },
      ];
      this.ui.weaponPills.innerHTML = "";
      for (const it of all) {
        const b = document.createElement("button");
        b.className = "pill";
        if (it.k === (this.meta.lastWeapon || "pistol")) b.classList.add("is-active");
        if (!unlocked.has(it.k)) b.classList.add("is-locked");
        b.type = "button";
        b.innerHTML = `
          <img class="pillIcon" src="${it.icon}" alt="" />
          <span class="pillText">${unlocked.has(it.k) ? it.label : `${it.label} (Locked)`}</span>
        `;
        b.addEventListener("click", () => {
          this.audio.resume();
          if (!unlocked.has(it.k)) {
            this.audio.play("locked", 140, 0.08, "square", 0.05, 0.08);
            if (this.ui.weaponDesc) this.ui.weaponDesc.textContent = "Locked: 게임 중 업그레이드에서 무기 해금을 먼저 얻어야 해요.";
            return;
          }
          this.setStartWeapon(it.k);
          this.audio.play("pick", 520, 0.05, "triangle", 0.05, 0.05);
          if (this.ui.weaponDesc) this.ui.weaponDesc.textContent = `${it.label} 로 시작합니다. 게임 중에도 1/2/3/4로 전환 가능.`;
        });
        this.ui.weaponPills.appendChild(b);
      }
    }

    // unlock row
    if (this.ui.unlockRow) {
      const unlocked = new Set(this.meta.unlockedWeapons || ["pistol"]);
      const chips = [
        { k: "pistol", label: "Pistol" },
        { k: "shotgun", label: "Shotgun" },
        { k: "rail", label: "Rail Beam" },
        { k: "crossbow", label: "Crossbow" },
      ];
      this.ui.unlockRow.innerHTML = chips.map(c => {
        const ok = unlocked.has(c.k);
        return `
          <div class="unlockChip ${ok ? "" : "is-locked"}">
            <span class="unlockDot"></span>
            <span>${c.label}</span>
          </div>
        `;
      }).join("");
    }

    // diff active pill
    if (this.ui.diffPills) {
      this.ui.diffPills.querySelectorAll(".pill").forEach(p => p.classList.toggle("is-active", p.dataset.diff === this.diff.key));
    }
  }

  _renderWeaponHud() {
    if (!this.ui?.hudWeapons) return;

    const all = [
      { k: "pistol", label: "1", icon: "./assets/ui/icon_pistol.svg" },
      { k: "shotgun", label: "2", icon: "./assets/ui/icon_shotgun.svg" },
      { k: "rail", label: "3", icon: "./assets/ui/icon_rail.svg" },
      { k: "crossbow", label: "4", icon: "./assets/ui/icon_crossbow.svg" },
    ];

    this.ui.hudWeapons.innerHTML = all.map(w => {
      return `
        <button class="wBtn" type="button" data-weapon="${w.k}" aria-label="${w.k}" title="${w.k.toUpperCase()} (${w.label})">
          <img src="${w.icon}" alt="" />
          <span class="kbd">${w.label}</span>
        </button>
      `;
    }).join("");
  }

  _renderBuildSummary() {
    if (!this.ui?.buildSummary) return;

    const p = this.player;
    const st = p.stats || {};
    const ups = (this.build?.upgrades || []);
    const weapons = Array.from(p.weapons || []).map(w => {
      if (w === "pistol") return "Pistol(1)";
      if (w === "shotgun") return "Shotgun(2)";
      if (w === "rail") return "Rail(3)";
      if (w === "crossbow") return "Crossbow(4)";
      return w;
    }).join(", ");

    const fmt = (n) => (Math.round(n * 100) / 100).toString();
    const pct = (n) => `${Math.round(n * 100)}%`;

    const rc = this.build?.rarityCounts || { common: 0, rare: 0, epic: 0 };

    this.ui.buildSummary.innerHTML = `
      <div class="box">
        <h3>현재 빌드</h3>
        <div class="kv">
          <div class="k">Weapon</div><div class="v">${p.weaponLabel()}</div>
          <div class="k">Unlocked</div><div class="v">${weapons || "-"}</div>
          <div class="k">Damage</div><div class="v">${fmt(st.damage ?? 0)}</div>
          <div class="k">Fire Rate</div><div class="v">x${fmt(st.fireRate ?? 1)}</div>
          <div class="k">Crit</div><div class="v">${pct(st.critChance ?? 0)}</div>
          <div class="k">Crit Mult</div><div class="v">x${fmt(st.critMult ?? 0)}</div>
          <div class="k">Pierce</div><div class="v">${Math.floor(st.pierce ?? 0)}</div>
          <div class="k">XP Mult</div><div class="v">x${fmt(st.xpMult ?? 1)}</div>
          <div class="k">Magnet</div><div class="v">x${fmt(st.magnetMult ?? 1)}</div>
          <div class="k">Dash CD</div><div class="v">${fmt(5 * (st.dashCdMult ?? 1))}s</div>
          <div class="k">Aegis CD</div><div class="v">${fmt(30 * (st.skillCdMult ?? 1))}s</div>
          <div class="k">Aegis Dur</div><div class="v">${fmt(st.aegisDur ?? 2)}s</div>
          <div class="k">Orbs</div><div class="v">${Math.floor(st.orbs ?? 0)}</div>
        </div>
      </div>
      <div class="box">
        <h3>선택한 업그레이드 (${ups.length})</h3>
        <div class="menuSmall">Common ${rc.common} · Rare ${rc.rare} · Epic ${rc.epic}</div>
        <div class="upList">
          ${ups.length ? ups.map(it => {
            const c = rarityColor(String(it.rarity || "common"));
            return `
              <div class="upItem">
                <span class="upDot" style="background:${c}"></span>
                <div class="upMeta">
                  <div class="name">#${String(it.idx).padStart(2, "0")} · ${it.title} <span class="chip">Lv ${it.lv}</span></div>
                  <div class="sub">${it.desc || ""}</div>
                  <span class="chip">${it.tag || "Upgrade"}</span>
                </div>
              </div>
            `;
          }).join("") : `<div class="menuSmall">아직 업그레이드를 선택하지 않았어요. (레벨업을 하면 카드가 뜹니다)</div>`}
        </div>
      </div>
    `;
  }

  showBanner(main, sub = "", t = 1.35) {
    if (!this.ui?.waveBanner) return;
    this.bannerTimer = Math.max(this.bannerTimer, t);
    this.bannerMain = String(main || "");
    this.bannerSub = String(sub || "");
    this.ui.waveBanner.innerHTML = `<div class="main">${escapeHTML(this.bannerMain)}</div>` +
      (this.bannerSub ? `<div class="sub">${escapeHTML(this.bannerSub)}</div>` : "");
    this.ui.waveBanner.classList.remove("hidden");
    this.ui.waveBanner.setAttribute("aria-hidden", "false");
  }

  start() {
    const loop = () => {
      const t = now();
      let dt = (t - this.last) / 1000;
      this.last = t;
      dt = Math.min(0.033, dt);

      if (!this.overlayOpen) {
        this.update(dt);
        this.draw();
      } else {
        this.draw(true);
      }

      this.fps = lerp(this.fps, 1 / dt, 0.08);
      if (this.ui?.fpsText) this.ui.fpsText.textContent = String(Math.round(this.fps));

      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  update(dt) {
    this.time += dt;
    this.camera.update(dt);

    // wave banner timer
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0 && this.ui?.waveBanner) {
        this.ui.waveBanner.classList.add("hidden");
        this.ui.waveBanner.setAttribute("aria-hidden", "true");
      }
    }


    // beams
    for (const b of this.beams) b.update(dt);
    this.beams = this.beams.filter(b => !b.dead);

    // spawn logic
    this.spawnTimer += dt;

    const isBossWave = (this.wave === 5 || this.wave === 10);
    if (isBossWave) {
      const hasBoss = this.enemies.some(e => (e.kind === "boss" || e.kind === "boss2"));
      if (!this.bossSpawned && !hasBoss) {
        const kind = (this.wave === MAX_WAVE ? "boss2" : "boss");
        this.spawnBoss(kind);
        this.bossSpawned = true;
      }
      this.spawnTimer = 0;
      this.toSpawn = 0;
    } else {
      while (this.spawnTimer >= this.spawnRate && this.toSpawn > 0) {
        this.spawnTimer -= this.spawnRate;
        this.toSpawn -= 1;
        this.spawnEnemy();
      }
    }

    this.player.update(this, dt);

    for (const b of this.bullets) b.update(dt);
    this.bullets = this.bullets.filter(b => !b.dead);

    for (const b of this.enemyBullets) b.update(dt);
    this.enemyBullets = this.enemyBullets.filter(b => !b.dead);

    for (const e of this.enemies) e.update(this, dt);

    for (const it of this.pickups) it.update(this, dt);
    this.pickups = this.pickups.filter(it => !it.dead);

    for (const p of this.particles) p.update(dt);
    this.particles = this.particles.filter(p => !p.dead);

    for (const f of this.floaters) f.update(dt);
    this.floaters = this.floaters.filter(f => !f.dead);

    this.handleCollisions();

    // wave clear (after collisions, so boss death is recognized immediately)
    if (!isBossWave) {
      if (this.toSpawn <= 0 && this.enemies.length === 0) {
        this.nextWave();
      }
    } else {
      const hasBoss = this.enemies.some(e => (e.kind === "boss" || e.kind === "boss2"));
      if (this.bossSpawned && !hasBoss) {
        if (this.wave >= MAX_WAVE) this.openWin();
        else {
          this.nextWave();
        }
      }
    }

    this._uiTick(dt);

	    // throttle meta save
	    this._metaSaveAcc += dt;
	    if (this._metaDirty && this._metaSaveAcc >= 0.75) {
	      saveMeta(this.meta);
	      this._metaDirty = false;
	      this._metaSaveAcc = 0;
	    }

    if (this.player.hp <= 0) this.openDead();
  }

  nextWave() {
    if (this.wave >= MAX_WAVE) return;
    this.wave += 1;

    // boss spawn is handled on demand when wave hits 5/10
    this.bossSpawned = false;

    this.waveCfg = getWaveConfig(this.wave, this.diff);
    if (this.waveCfg) {
      this.toSpawn = this.waveCfg.count;
      this.spawnRate = this.waveCfg.rate;
    } else {
      this.toSpawn = 0;
      this.spawnRate = Math.max(0.065, 0.14 * (this.diff?.spawnIntervalMult || 1));
    }

    this.player.sh = Math.min(this.player.maxSh, this.player.sh + 16);

    const bannerSub = isBossWaveN(this.wave) ? (this.wave === MAX_WAVE ? "FINAL BOSS" : "BOSS WAVE") : "SURVIVE";
    this.showBanner(`WAVE ${this.wave}/${MAX_WAVE}`, bannerSub);

    // subtle in-world floater
    this.floaters.push(new Floater(this.player.x - 34, this.player.y - 36, `WAVE ${this.wave}/${MAX_WAVE}`, 0.9, "rgba(210,177,106,.95)"));
    this.audio.play("wave", 240, 0.08, "triangle", 0.06, 0.12);
  }

  spawnEnemy() {
    const a = rand(0, Math.PI * 2);
    const dist = rand(this.arena.r * 0.65, this.arena.r * 0.95);
    const x = this.arena.x + Math.cos(a) * dist;
    const y = this.arena.y + Math.sin(a) * dist;

    const w = this.wave;

    // Use wave plan weights to shape encounters (weapon switching + difficulty curve)
    const weights = (this.waveCfg && this.waveCfg.weights) ? this.waveCfg.weights : { chaser: 10 };
    const kind = pickWeighted(weights) || "chaser";

    const e = new Enemy(kind, x, y, this.wave);

    const hpM = (this.diff?.enemyHpMult || 1);
    const dmM = (this.diff?.enemyDmgMult || 1);
    e.maxHp = Math.floor(e.maxHp * hpM);
    e.hp = e.maxHp;
    e.touch = Math.floor(e.touch * dmM);

    this.enemies.push(e);

    // hard 난이도 + 후반: 가끔 추가 스폰
    if ((this.diff?.key === "hard") && w >= 6 && Math.random() < 0.22) {
      const ex = x + rand(-36, 36);
      const ey = y + rand(-36, 36);
      this.spawnEnemyAt("chaser", ex, ey);
    }
  }

  spawnEnemyAt(kind, x, y) {
    const e = new Enemy(kind, x, y, this.wave);
    const hpM = (this.diff?.enemyHpMult || 1);
    const dmM = (this.diff?.enemyDmgMult || 1);
    e.maxHp = Math.floor(e.maxHp * hpM);
    e.hp = e.maxHp;
    e.touch = Math.floor(e.touch * dmM);
    this.enemies.push(e);
    return e;
  }

  spawnBoss(kind = "boss") {
    const a = rand(0, Math.PI * 2);
    const dist = this.arena.r * 0.72;
    const x = this.arena.x + Math.cos(a) * dist;
    const y = this.arena.y + Math.sin(a) * dist;

    const b = new Enemy(kind, x, y, this.wave);
    b.maxHp = Math.floor(b.maxHp * (this.diff?.enemyHpMult || 1));
    b.hp = b.maxHp;
    b.touch = Math.floor(b.touch * (this.diff?.enemyDmgMult || 1));
    this.enemies.push(b);

    const text = (kind === "boss2") ? "FINAL BOSS" : "BOSS WAVE";
    this.showBanner(text, kind === "boss2" ? "FINALE" : "DANGER", 1.6);
    const col = (kind === "boss2") ? "rgba(210,177,106,.95)" : "rgba(255,210,122,.95)";
    this.floaters.push(new Floater(this.player.x - 62, this.player.y - 42, text, 1.2, col));
    this.audio.play(kind === "boss2" ? "boss2" : "boss", kind === "boss2" ? 220 : 140, 0.12, "sawtooth", 0.10, 0.20);
  }

  _spawnPickupsOnKill(x, y, kind) {
    const isBoss = (kind === "boss" || kind === "boss2");
    const xpTotal =
      kind === "chaser" ? 12 :
      kind === "charger" ? 18 :
      kind === "gunner" ? 16 :
      kind === "bomber" ? 16 :
      (kind === "boss2" ? 180 : 120);

    const count = isBoss ? randi(10, 14) : randi(1, 4);
    let left = xpTotal;
    for (let i = 0; i < count; i++) {
      const v = (i === count - 1) ? left : Math.max(3, Math.round(xpTotal / count + rand(-2, 2)));
      left -= v;
      this.pickups.push(new Pickup("xp", x + rand(-10, 10), y + rand(-10, 10), v));
    }

    const hpP = isBoss ? 0.55 : 0.09;
    const shP = isBoss ? 0.60 : 0.11;
    if (Math.random() < hpP) this.pickups.push(new Pickup("hp", x + rand(-14, 14), y + rand(-14, 14), isBoss ? 45 : 18));
    if (Math.random() < shP) this.pickups.push(new Pickup("sh", x + rand(-14, 14), y + rand(-14, 14), isBoss ? 42 : 16));
  }

  killEnemy(enemy, silent = false) {
    const idx = this.enemies.indexOf(enemy);
    if (idx >= 0) this.enemies.splice(idx, 1);

    if (!silent) {
      const score =
        enemy.kind === "chaser" ? 10 :
        enemy.kind === "charger" ? 18 :
        enemy.kind === "gunner" ? 16 :
        enemy.kind === "bomber" ? 16 :
        220;
      const mult = (this.diff?.scoreMult || 1);
      this.player.score += Math.floor(score * mult);
    }

    this._spawnPickupsOnKill(enemy.x, enemy.y, enemy.kind);
    this.spawnHit(enemy.x, enemy.y, enemy.kind === "boss" ? 44 : 22);
    this.audio.play("hit", 460, 0.03, "square", 0.04, 0.01);
  }

  spawnHit(x, y, count = 12) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(120, 360);
      this.particles.push(new Particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.12, 0.28), rand(1.1, 2.2)));
    }
  }

  damagePlayer(dmg) {
    const p = this.player;
    // Aegis gives true invulnerability; dash/hit i-frames prevent rapid multi-hits
    if (p.aegis > 0 || p.iframes > 0) return;

    let left = dmg;
    if (p.sh > 0) {
      const take = Math.min(p.sh, left);
      p.sh -= take;
      left -= take;
    }
    if (left > 0) p.hp -= left;

    p.iframes = 0.22;
    p.hurtFlash = 0.20;
    this.camera.kick(8);
    this.audio.play("hurt", 180, 0.08, "square", 0.08, 0.10);

    for (let i = 0; i < 16; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(140, 420);
      this.particles.push(new Particle(p.x, p.y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.22, 0.42), rand(1.4, 2.8), "rgba(255,111,111,.85)"));
    }
    this.floaters.push(new Floater(p.x + rand(-6, 6), p.y - 22, `-${dmg}`, 0.7, "rgba(255,111,111,.95)"));
  }

  handleCollisions() {
    // player bullets vs enemies
    for (const b of this.bullets) {
      if (b.owner !== "player") continue;
      for (const e of this.enemies) {
        const d = Math.hypot(e.x - b.x, e.y - b.y);
        if (d < e.r + b.r) {
          e.hit(this, b.dmg, b.opts?.weapon);
          this.camera.kick(2.2);
          if (b.pierce > 0) b.pierce -= 1;
          else { b.t = b.life; break; }
        }
      }
    }

    // enemy bullets vs player
    for (const b of this.enemyBullets) {
      const p = this.player;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < p.r + b.r) {
        this.damagePlayer(b.dmg);
        b.t = b.life;
      }
    }

    // enemy touch
    for (const e of this.enemies) {
      const p = this.player;
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d < p.r + e.r) {
        this.damagePlayer(e.touch);
      }
    }
  }

  castNova(player) {
    const dmg = Math.floor(48 * (player.stats.novaDmg || 1));
    const R = 160;
    let hits = 0;
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < R) { e.hit(this, dmg, 'nova'); hits++; }
    }
    this.spawnHit(player.x, player.y, 24);
    this.camera.kick(7);
    this.floaters.push(new Floater(player.x - 22, player.y - 40, `NOVA x${hits}`, 0.8, "rgba(122,168,255,.95)"));
    this.audio.play("nova", 620, 0.10, "triangle", 0.10, 0.20);
  }

  updateOrbs(player, dt) {
    const n = Math.floor(player.stats.orbs || 0);
    if (n <= 0) { this.orbState.list = []; return; }

    // ensure orb list size
    while (this.orbState.list.length < n) this.orbState.list.push({ a: rand(0, Math.PI * 2) });
    this.orbState.list = this.orbState.list.slice(0, n);

    const rad = 44;
    const spd = 1.7;
    this.orbState.cd -= dt;

    for (let i = 0; i < this.orbState.list.length; i++) {
      const o = this.orbState.list[i];
      o.a += dt * spd;
      const x = player.x + Math.cos(o.a + i * (Math.PI * 2 / n)) * rad;
      const y = player.y + Math.sin(o.a + i * (Math.PI * 2 / n)) * rad;
      o.x = x; o.y = y;
    }

    // orb auto hit
    if (this.orbState.cd <= 0) {
      this.orbState.cd = 0.28;
      const orbDmg = Math.floor((player.stats.damage || 20) * 0.55);
      for (const o of this.orbState.list) {
        // find nearest enemy
        let best = null;
        let bd = 1e9;
        for (const e of this.enemies) {
          const d = Math.hypot(e.x - o.x, e.y - o.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best && bd < 160) {
          best.hit(this, orbDmg, 'orb');
          this.spawnHit(o.x, o.y, 6);
          this.audio.play("orb", 760, 0.03, "square", 0.04, 0.03);
        }
      }
    }
  }

  _uiTick(dt) {
    if (!this.ui) return;

    const p = this.player;
    const hpT = clamp(p.hp / p.maxHp, 0, 1);
    if (this.ui.hpFill) this.ui.hpFill.style.width = `${hpT * 100}%`;
    if (this.ui.hpText) this.ui.hpText.textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;

    const shT = clamp(p.sh / p.maxSh, 0, 1);
    if (this.ui.shFill) this.ui.shFill.style.width = `${shT * 100}%`;
    if (this.ui.shText) this.ui.shText.textContent = `${Math.ceil(p.sh)}/${p.maxSh}`;

    const need = p.xpNeed();
    const xpT = clamp(p.xp / need, 0, 1);
    if (this.ui.xpFill) this.ui.xpFill.style.width = `${xpT * 100}%`;
    if (this.ui.xpText) this.ui.xpText.textContent = `${Math.floor(p.xp)}/${need}`;

    if (this.ui.waveText) this.ui.waveText.textContent = `${this.wave}/${MAX_WAVE}`;
    if (this.ui.lvlText) this.ui.lvlText.textContent = String(p.level);
    if (this.ui.scoreText) this.ui.scoreText.textContent = String(p.score);

    // cooldown HUD (skills)
	    if (this.ui.dashCdFill && this.ui.dashCdText) {
      const max = Math.max(0.001, p.dashCdMax || (5 * (p.stats?.dashCdMult ?? 1)));
      const t = clamp(1 - (p.dashCd / max), 0, 1);
      this.ui.dashCdFill.style.width = `${t * 100}%`;
	      this.ui.dashCdText.textContent = (p.dashCd > 0.05) ? `${p.dashCd.toFixed(1)}s` : "READY";
	      if (this.ui.skillDash) {
	        this.ui.skillDash.classList.toggle("is-ready", p.dashCd <= 0.05);
	      }
    }
    if (this.ui.aegisCdFill && this.ui.aegisCdText) {
      const max = Math.max(0.001, p.aegisCdMax || (30 * (p.stats?.skillCdMult ?? 1)));
      const t = clamp(1 - (p.aegisCd / max), 0, 1);
      this.ui.aegisCdFill.style.width = `${t * 100}%`;
	      if (p.aegis > 0.01) {
	        this.ui.aegisCdText.textContent = `ACTIVE ${p.aegis.toFixed(1)}s`;
	      } else {
	        this.ui.aegisCdText.textContent = (p.aegisCd > 0.05) ? `${p.aegisCd.toFixed(1)}s` : "READY";
	      }
	      if (this.ui.skillAegis) {
	        this.ui.skillAegis.classList.toggle("is-active", p.aegis > 0.01);
	        this.ui.skillAegis.classList.toggle("is-ready", p.aegisCd <= 0.05 && p.aegis <= 0.01);
	      }
    }

    // weapon HUD highlight (no reflow)
    if (this.ui.hudWeapons) {
      this.ui.hudWeapons.querySelectorAll("button[data-weapon]").forEach(btn => {
        const w = btn.dataset.weapon;
        btn.classList.toggle("is-active", w === p.weapon);
        btn.classList.toggle("is-locked", !(p.weapons && p.weapons.has(w)));
      });
    }



    // boss HP HUD
    if (this.ui?.bossBar && this.ui?.bossFill && this.ui?.bossName && this.ui?.bossHpText) {
      const boss = this.enemies.find(e => (e.kind === "boss" || e.kind === "boss2"));
      if (boss) {
        this.ui.bossBar.classList.remove("hidden");
        const t = clamp(boss.hp / boss.maxHp, 0, 1);
        this.ui.bossFill.style.width = `${t * 100}%`;
        this.ui.bossName.textContent = (boss.kind === "boss2") ? "FINAL BOSS" : "BOSS";
        this.ui.bossHpText.textContent = `${Math.ceil(boss.hp)}/${boss.maxHp}`;
      } else {
        this.ui.bossBar.classList.add("hidden");
      }
    }
    // update records live
	    const prevScore = this.meta.bestScore || 0;
	    const prevWave = this.meta.bestWave || 0;
	    if (p.score > prevScore) { this.meta.bestScore = p.score; this._metaDirty = true; }
	    if (this.wave > prevWave) { this.meta.bestWave = this.wave; this._metaDirty = true; }
  }

  draw(dim = false) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(20,14,10,1)";
    ctx.fillRect(0, 0, w, h);

    // pixel tile ground
    const step = 64;
    ctx.save();
    ctx.globalAlpha = 0.18;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const odd = ((x / step + y / step) % 2) === 0;
        ctx.fillStyle = odd ? "rgba(255,246,232,.05)" : "rgba(0,0,0,.08)";
        ctx.fillRect(x, y, step, step);
      }
    }
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "rgba(255,224,170,.10)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.restore();

    // world transform: player centered
    ctx.save();
    ctx.translate(this.cx - this.player.x, this.cy - this.player.y);
    this.camera.apply(ctx);

    // arena ring
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.arena.x, this.arena.y, this.arena.r, 0, Math.PI * 2);
    ctx.stroke();

    // pickups behind
    for (const it of this.pickups) it.draw(ctx);

    // particles behind
    for (const p of this.particles) p.draw(ctx);

    // enemies
    for (const e of this.enemies) e.draw(ctx, this);

    // bullets
    for (const b of this.bullets) b.draw(ctx);
    for (const b of this.enemyBullets) {
      ctx.fillStyle = "rgba(255,111,111,.92)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // beams
    for (const b of this.beams) b.draw(ctx);

    // orbs
    if (this.orbState?.list?.length) {
      for (const o of this.orbState.list) {
        ctx.fillStyle = "rgba(122,168,255,.85)";
        ctx.beginPath();
        ctx.arc(o.x, o.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.65)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(o.x, o.y, 8.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // player
    this.player.draw(ctx, this);

    // floaters top
    for (const f of this.floaters) f.draw(ctx);

    ctx.restore();

    if (dim) {
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.fillRect(0, 0, w, h);
    }
  }
}

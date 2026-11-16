/* E-Paper Buddy — ANIMATION SCENES
 *
 * How you actually animate e-paper:
 *   1. two 1-bit buffers (prev/next) — the panel needs both to compute a delta
 *   2. dirty-rectangle partial refresh — only the changed bounding box is driven
 *   3. a refresh escalation chain PARTIAL -> FULL — ghosts accumulate until a
 *      full waveform clears them, and that flash is the price of animation
 *
 * The panel is a real 2.9" 296x128 SSD1680-class part, which does support
 * partial refresh. The constraint is time, not capability: ~0.4 s per partial.
 */

const W = 296, H = 128;

/* ---------------- framebuffer ---------------- */
class FB {
  constructor(w, h) { this.w = w; this.h = h; this.buf = new Uint8Array(w * h); }
  clear() { this.buf.fill(0); }
  px(x, y, v = 1) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.buf[y * this.w + x] = v;
  }
  rect(x, y, w, h, v = 1) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, v);
  }
  disc(cx, cy, r, v = 1) {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++)
      if (i * i + j * j <= r * r + r) this.px(cx + i, cy + j, v);
  }
  line(x0, y0, x1, y1, v = 1) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, guard = 0;
    for (;;) {
      this.px(x0, y0, v);
      if ((x0 === x1 && y0 === y1) || ++guard > 4000) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}

/* ---------------- sprites (1-bit, drawn as bit patterns) ---------------- */
const FISH = [
  '01111100',
  '11111110',
  '00101011',
  '11111110',
  '01111100',
];
const FISH_SMALL = ['011110', '111111', '010110', '111111', '011110'];

/* A fish drawn from primitives: on a 296px panel an 8px bitmap sprite is
   invisible, so the body is an ellipse and the tail a filled wedge. */
function drawFish(fb, x, y, size, dir = 1, v = 1) {
  const rx = size, ry = Math.max(3, Math.round(size * 0.62));
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) fb.px(x + dx * dir, y + dy, v);
    }
  }
  // tail wedge
  const tx = x - rx * dir;
  for (let i = 1; i <= Math.round(ry * 1.15); i++) {
    const ty = y - i, by = y + i, px = tx - i * 0.55 * dir;
    for (let k = 0; k <= Math.abs(px - tx); k++) fb.px(tx - k * dir, ty, v);
    for (let k = 0; k <= Math.abs(px - tx); k++) fb.px(tx - k * dir, by, v);
  }
  // dorsal fin
  for (let i = 0; i <= Math.round(rx * 0.5); i++) fb.px(x + i * dir, y - ry - Math.round(ry * 0.35), v);
  // eye (punched white so the head reads)
  fb.px(x + Math.round(rx * 0.5) * dir, y - 1, 0);
  fb.px(x + Math.round(rx * 0.5) * dir + 1, y - 1, 0);
}

function blit(fb, rows, x, y, flip, v = 1) {
  const h = rows.length, w = rows[0].length;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (rows[j][i] !== '1') continue;
      fb.px(x + (flip ? w - 1 - i : i), y + j, v);
    }
  }
}

/* ---------------- scenes ---------------- */
class Aquarium {
  constructor() { this.name = 'aquarium'; this.reset(); }
  reset() {
    this.fish = [
      { x: 90, y: 52, vx: 2.0, phase: 0, big: true, dir: 1 },
      { x: 210, y: 84, vx: -1.5, phase: 2.1, big: false, dir: -1 },
    ];
    this.bubbles = Array.from({ length: 10 }, () => ({
      x: 20 + Math.random() * 250, y: Math.random() * H,
      v: 1 + Math.random() * 1.4, big: Math.random() > 0.6,
    }));
    this.t = 0;
  }
  step() {
    this.t++;
    for (const f of this.fish) {
      f.x += f.vx;
      f.y += Math.sin((this.t + f.phase * 10) / 9) * 0.8;
      const margin = (f.big ? 18 : 12) + 10;
      if (f.x > W - margin) { f.x = W - margin; f.vx *= -1; f.dir = -1; }
      if (f.x < margin) { f.x = margin; f.vx *= -1; f.dir = 1; }
      f.y = Math.max(24, Math.min(H - 34, f.y));
    }
    for (const b of this.bubbles) {
      b.y -= b.v;
      b.x += Math.sin(b.y / 7) * 0.4;
      if (b.y < 8) { b.y = H - 20; b.x = 20 + Math.random() * 250; }
    }
  }
  draw(fb) {
    // waterline + sea floor
    fb.line(0, 10, W - 1, 10, 1);
    for (let x = 0; x < W; x += 4) fb.px(x, 10 - (x % 8 === 0 ? 1 : 0), 1);
    for (let x = 0; x < W; x += 3) fb.px(x, H - 16 + ((x * 7) % 4), 1);

    // seaweed, swaying with a sine offset per blade
    for (let b = 0; b < 7; b++) {
      const baseX = 14 + b * 42;
      for (let y = 0; y < 34; y++) {
        const sway = Math.sin((this.t / 6) + b + y / 9) * (y / 9);
        fb.px(baseX + sway, H - 18 - y, 1);
        if (y > 6 && y < 26) fb.px(baseX + sway + 1, H - 18 - y, 1);
      }
    }

    for (const b of this.bubbles) fb.disc(b.x, b.y, b.big ? 2 : 1, 1);
    for (const f of this.fish) drawFish(fb, f.x, f.y, f.big ? 17 : 11, f.dir);
    // a couple of plants on the floor line
    for (let i = 0; i < 5; i++) {
      const x = 60 + i * 40, hh = 4 + ((i * 5) % 6);
      fb.line(x, H - 2, x + 2, H - 2 - hh, 1);
      fb.line(x + 2, H - 2, x + 1, H - 2 - hh, 1);
    }
  }
}

class Butterflies {
  constructor() { this.name = 'butterflies'; this.reset(); }
  reset() {
    this.bugs = [
      { cx: 80, cy: 50, r: 46, sp: 0.055, ph: 0, flap: 0 },
      { cx: 210, cy: 78, r: 32, sp: -0.075, ph: 2.2, flap: 1 },
    ];
    this.t = 0;
  }
  step() { this.t++; }
  draw(fb) {
    // flower bed along the bottom
    for (let i = 0; i < 6; i++) {
      const x = 24 + i * 48, y = H - 12;
      fb.line(x, H - 1, x, y, 1);
      fb.disc(x, y - 3, 2, 1);
      fb.px(x, y - 3, 0);
    }
    for (const b of this.bugs) {
      const a = this.t * b.sp + b.ph;
      const x = b.cx + Math.cos(a) * b.r;
      const y = b.cy + Math.sin(a * 1.7) * b.r * 0.55;
      const open = Math.sin(this.t * 0.55 + b.flap * 2) > 0;
      // body
      fb.line(x, y, x, y + 4, 1);
      fb.px(x, y - 1, 1);
      // antennae
      fb.px(x - 1, y - 2, 1); fb.px(x + 1, y - 2, 1);
      if (open) {
        // wings up
        fb.line(x - 1, y, x - 6, y - 3, 1);
        fb.line(x - 1, y + 1, x - 7, y + 1, 1);
        fb.line(x - 1, y + 2, x - 5, y + 4, 1);
        fb.line(x + 1, y, x + 6, y - 3, 1);
        fb.line(x + 1, y + 1, x + 7, y + 1, 1);
        fb.line(x + 1, y + 2, x + 5, y + 4, 1);
      } else {
        // wings folded
        fb.line(x - 1, y + 1, x - 4, y + 4, 1);
        fb.line(x + 1, y + 1, x + 4, y + 4, 1);
        fb.line(x - 1, y, x - 3, y - 1, 1);
        fb.line(x + 1, y, x + 3, y - 1, 1);
      }
    }
  }
}


/* ---------------- ASCII tank ----------------
 * Characters, not sprites. A 5x7 glyph in an 8x8 cell gives 37x16 cells on
 * this panel, which is how the reel does it: the fish is five glyphs, a bubble
 * is one, and the seaweed is a column of brackets that alternate as they sway.
 * It reads as a tank because the eye fills in the water.
 */
const GLYPHS = {
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  'o': ['00000','00000','01110','10001','10001','01110','00000'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  '(': ['00110','01000','10000','10000','10000','01000','00110'],
  ')': ['01100','00010','00001','00001','00001','00010','01100'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '_': ['00000','00000','00000','00000','00000','00000','11111'],
  '>': ['10000','11000','11100','11110','11100','11000','10000'],
  '<': ['00001','00011','00111','01111','00111','00011','00001'],
  '~': ['00000','00000','01001','10110','01001','00000','00000'],
  '\\u00b0': ['00000','01100','10010','10010','01100','00000','00000'],
};

const CELLW = 5, CELLH = 8;           // advance 5 = no gap, glyphs touch as in the reel

function drawText(fb, str, col, row) {
  for (let ci = 0; ci < str.length; ci++) {
    const g = GLYPHS[str[ci]];
    if (!g) continue;
    const ox = col * CELLW + ci * CELLW;
    const oy = row * CELLH;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (g[y][x] === '1') fb.px(ox + x, oy + y + 1, 1);
      }
    }
  }
}

class AsciiTank {
  constructor() { this.name = 'ascii tank'; this.reset(); }
  reset() {
    this.fish = { col: 14, row: 6, dir: 1, bob: 0 };
    this.grass = [3, 53];
    this.bubbles = Array.from({ length: 7 }, (_, i) => ({
      col: 4 + Math.random() * 28,
      row: 4 + Math.random() * 10,
      speed: i % 3 === 0 ? 2 : 3,       // steps per cell
      tick: i,
      big: i % 4 === 0,
    }));
    this.t = 0;
  }
  step() {
    this.t++;
    // fish: one cell sideways every 3 frames, bobbing on a slow sine
    if (this.t % 3 === 0) {
      this.fish.col += this.fish.dir;
      if (this.fish.col > 48) { this.fish.col = 48; this.fish.dir = -1; }
      if (this.fish.col < 1) { this.fish.col = 1; this.fish.dir = 1; }
    }
    this.fish.bob = Math.sin(this.t / 5) * 1.2;
    // bubbles rise one cell every few frames, then restart at the floor
    for (const b of this.bubbles) {
      b.tick++;
      if (b.tick % b.speed === 0) {
        b.row -= 1;
        if (b.row < 1) { b.row = 13 + Math.random() * 2; b.col = 3 + Math.random() * 30; }
      }
    }
  }
  draw(fb) {
    // seaweed: a column of brackets that alternate, which is what reads as sway
    for (const gx of this.grass) {
      for (let r = 6; r <= 14; r++) {
        const flip = (Math.floor(this.t / 3) + r + gx) % 2 === 0;
        drawText(fb, flip ? '(' : ')', gx, r);
      }
    }
    // bubbles
    for (const b of this.bubbles) {
      drawText(fb, b.big ? 'O' : 'o', Math.round(b.col), Math.round(b.row));
    }
    // one fish, five glyphs wide, facing its direction of travel
    const f = this.fish;
    const row = Math.round(f.row + f.bob);
    if (f.dir > 0) drawText(fb, '-(\u00b0)>', f.col, row);
    else drawText(fb, '<(\u00b0)-', f.col, row);
  }
}

/* ---------------- panel ---------------- */
const canvas = document.getElementById('epd');
const ctx = canvas.getContext('2d');
const img = ctx.createImageData(W, H);
const PAPER = [244, 243, 238];
const INK = [20, 19, 15];
const GHOST = [176, 172, 162];      // what unstabilised pixels look like

const prev = new FB(W, H);
const next = new FB(W, H);
const ghost = new Uint8Array(W * H); // toggle count per pixel since last full

const el = (id) => document.getElementById(id);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const scenes = [new AsciiTank(), new Aquarium(), new Butterflies()];
let sceneIdx = 0;
let playing = false;
let frame = 0;
let partialsSinceFull = 0;
let totalRefresh = 0;
let showWindow = true;
let busy = false;
let dirty = { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };

const PARTIAL_MS = 400;
const FULL_MS = 2400;
const AUTO_FULL_AFTER = 10;         // the escalation chain: ghosts force a clean

/* ---- render one frame of the active scene into `next` ---- */
function composeScene() {
  next.clear();
  scenes[sceneIdx].draw(next);
}

/* ---- diff the two buffers -> dirty rectangle ---- */
function computeDirty() {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (prev.buf[i] !== next.buf[i]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;                       // nothing changed
  return { x0, y0, x1, y1 };
}

/* ---- paint, with ghost residue and an optional dirty-window overlay ---- */
function paint(d, invert = false) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let c = next.buf[i] ? INK : PAPER;
      if (!next.buf[i] && ghost[i] >= 2) c = GHOST;   // unstabilised ink left behind
      if (invert) c = next.buf[i] ? PAPER : INK;
      const p = i * 4;
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (showWindow && d && !invert) {
    ctx.save();
    ctx.strokeStyle = 'rgba(138,59,42,.85)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(d.x0 - 0.5, d.y0 - 0.5, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
    ctx.restore();
  }
}

function flood(light) {
  const c = light ? PAPER : INK;
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ---- refresh routines ---- */
async function fullRefresh(reason) {
  if (busy) return;
  busy = true;
  el('mode').textContent = 'full';
  canvas.classList.add('refreshing');
  setPower(true, 20000, 'full waveform: invert cycle, ~20 mA for 2.4 s');
  flood(false); await wait(230);
  flood(true); await wait(360);
  paint(dirty, true); await wait(220);
  flood(true); await wait(200);
  ghost.fill(0);
  paint(null, false);
  canvas.classList.remove('refreshing');
  busy = false;
  partialsSinceFull = 0;
  totalRefresh++;
  el('ms').textContent = '~' + FULL_MS + ' ms';
  el('count').textContent = totalRefresh;
  setPower(false, 9, 'the image holds with no power at all — that is the only free part');
  log(`full · ~${FULL_MS} ms · ${reason}`);
  telemetry();
}

async function partialFrame() {
  if (busy) return;
  const d = computeDirty();
  if (!d) { return; }                            // static frame costs nothing
  busy = true;
  dirty = d;
  el('mode').textContent = 'partial';
  setPower(true, 15000, 'driving only the dirty window — no flash, some ghosting');

  // toggle bookkeeping: a pixel that changed twice since a full refresh ghosts
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (prev.buf[i] !== next.buf[i] && ghost[i] < 4) ghost[i]++;
    }
  }
  prev.buf.set(next.buf);

  paint(d, false);
  await wait(80);
  canvas.classList.remove('refreshing');
  busy = false;
  partialsSinceFull++;
  totalRefresh++;
  el('ms').textContent = '~' + PARTIAL_MS + ' ms';
  el('count').textContent = totalRefresh;
  const bw = d.x1 - d.x0 + 1, bh = d.y1 - d.y0 + 1;
  el('dirty').textContent = `${bw}×${bh}`;
  setPower(false, 9, 'the image holds with no power at all — that is the only free part');
  telemetry();
  if (partialsSinceFull >= AUTO_FULL_AFTER) {
    await fullRefresh('ghost cleanup (10 partials)');
  }
}

/* ---- the animation loop ---- */
const FPS = 3;                     // ~0.4s refresh means ~2.5 fps ceiling; 3 is optimistic
let timer = null;

async function tick() {
  if (!playing) return;
  scenes[sceneIdx].step();
  frame++;
  composeScene();
  await partialFrame();
  if (playing) timer = setTimeout(tick, 1000 / FPS);
}

function setPlaying(on) {
  playing = on;
  el('play').textContent = on ? 'Pause' : 'Play';
  if (timer) { clearTimeout(timer); timer = null; }
  if (on) tick();
}

/* ---- power ---- */
function setPower(awake, microamps, note) {
  el('pw-state').textContent = awake ? 'refreshing' : 'asleep';
  el('pw-draw').textContent = awake ? `${(microamps / 1000).toFixed(0)} mA` : `${microamps} µA`;
  el('pw-note').textContent = note;
  el('pw-bar').style.width = awake ? '100%' : '2%';
  el('pw-bar').style.background = awake ? 'var(--accent)' : 'var(--ink)';
}

/* ---- readouts ---- */
let logLines = 0;
function log(msg) {
  const s = document.createElement('span');
  s.innerHTML = `<b>${String(totalRefresh).padStart(2, '0')}</b> ${msg}`;
  el('log').prepend(s);
  if (++logLines > 4) el('log').lastElementChild.remove();
}

function telemetry() {
  let g = 0;
  for (let i = 0; i < ghost.length; i++) if (ghost[i] >= 2) g++;
  const pct = (g / (W * H)) * 100;
  el('ghost').textContent = pct.toFixed(1) + '%';
  el('ghost').classList.toggle('warn', pct > 8);
  el('since').textContent = partialsSinceFull;
  // continuous animation destroys the battery argument — say so with a number
  const duty = PARTIAL_MS / (1000 / FPS);
  const avgMA = 15000 * Math.min(duty, 1) / 1000 + 0.009;
  const hours = 500 / Math.max(avgMA, 0.01);
  el('runtime').textContent = playing
    ? `~${hours.toFixed(0)} h of animation`
    : 'weeks, idle';
}

/* ---- controls ---- */
el('play').addEventListener('click', () => setPlaying(!playing));
el('stepBtn').addEventListener('click', async () => {
  scenes[sceneIdx].step(); frame++; composeScene(); await partialFrame();
});
el('fullBtn').addEventListener('click', () => fullRefresh('manual'));
el('switch').addEventListener('click', async () => {
  setPlaying(false);
  sceneIdx = (sceneIdx + 1) % scenes.length;
  scenes[sceneIdx].reset();
  el('scene').textContent = scenes[sceneIdx].name;
  frame = 0;
  composeScene();
  await fullRefresh('scene change');
});
el('window').addEventListener('change', (e) => {
  showWindow = e.target.checked;
  paint(dirty, false);
});
canvas.addEventListener('pointerdown', () => setPlaying(!playing));

/* ---- boot ---- */
(async function boot() {
  el('scene').textContent = scenes[sceneIdx].name;
  composeScene();
  prev.buf.set(next.buf);
  flood(true); await wait(120);
  paint(next.buf.some(v => v) ? { x0: 0, y0: 0, x1: W - 1, y1: H - 1 } : null, true);
  await wait(200);
  paint(null, false);
  totalRefresh = 1;
  el('mode').textContent = 'full';
  el('ms').textContent = '~' + FULL_MS + ' ms';
  el('count').textContent = '1';
  setPower(false, 9, 'the image holds with no power at all — that is the only free part');
  log('boot · full refresh · clear panel');
  telemetry();
})();

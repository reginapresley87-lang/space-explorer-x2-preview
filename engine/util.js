// Deterministic hashing, RNG, names and colour helpers (original code).
export const TAU = Math.PI * 2, D2R = Math.PI / 180;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// 32-bit hash of any mix of integers / strings (murmur3-style finaliser).
export function hash(...parts) {
  let h = 0x9e3779b9 ^ parts.length;
  for (const p of parts) {
    if (typeof p === 'string') { for (let i = 0; i < p.length; i++) { h = Math.imul(h ^ p.charCodeAt(i), 0x85ebca6b); h ^= h >>> 13; } }
    else { let v = Math.floor(p) | 0; h = Math.imul(h ^ v, 0xcc9e2d51); h = (h << 15) | (h >>> 17); h = Math.imul(h, 0x1b873593); h ^= h >>> 16; }
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
// mulberry32
export function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.gauss = () => { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  return r;
}

// ---------- names ----------
const ON = ['k', 'v', 'th', 'z', 'r', 'm', 'n', 's', 'l', 'd', 'qu', 'x', 'y', 'b', 'c', 'sh', 'tr', 'gl', 'pr', 'h', 'f', 'dr', 'ph', 'st'];
const NU = ['a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'ia', 'ou', 'y', 'au', 'io'];
const CO = ['', '', 'n', 'r', 'l', 's', 'th', 'x', 'm', 'nd', 'rk', 'st', 'v', 'sh'];
export function word(r, syl = 2 + Math.floor(r() * 2)) {
  let s = '';
  for (let i = 0; i < syl; i++) s += (i === 0 || r() < 0.7 ? r.pick(ON) : '') + r.pick(NU) + (i === syl - 1 || r() < 0.35 ? r.pick(CO) : '');
  return s[0].toUpperCase() + s.slice(1);
}
const CATS = ['SX', 'HXR', 'Ostra', 'VKS', 'Tarn', 'Lumen', 'ZQ'];
export function starName(seed) {
  const r = rng(seed ^ 0x51ed);
  if (r() < 0.32) return word(r) + (r() < 0.25 ? ' ' + word(r, 2) : '');
  return `${r.pick(CATS)} ${1000 + Math.floor(r() * 8999)}-${String(Math.floor(r() * 999)).padStart(3, '0')}`;
}
export function galaxyName(seed, type) {
  const r = rng(seed ^ 0x6a1);
  if (r() < 0.45) return word(r, 3) + (type === 'elliptical' ? ' Ellipse' : type === 'irregular' ? ' Cloud' : ' Galaxy');
  return `SXG ${String(Math.floor(r() * 9999)).padStart(4, '0')}${r() < 0.5 ? '+' : '-'}${String(Math.floor(r() * 90)).padStart(2, '0')}`;
}
export const LETTERS = 'bcdefghijklmnop';
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

// ---------- colour ----------
// Black-body temperature (K) -> linear-ish sRGB [0..1] (Tanner Helland-style fit).
// Blackbody colour: Planck spectrum integrated against analytic CIE 1931 colour-matching functions
// (Wyman, Sloan & Shirley 2013 fit), converted XYZ -> linear sRGB and normalised so the brightest channel is 1.
// Returns LINEAR RGB (the renderer works in linear HDR and tone-maps at the end).
const bbCache = new Map();
const g_ = (x, m, s1, s2) => { const t = (x - m) / (x < m ? s1 : s2); return Math.exp(-0.5 * t * t); };
export function blackbody(T) {
  T = Math.max(800, Math.min(60000, T)); const key = Math.round(T / 25);
  let c = bbCache.get(key); if (c) return c.slice();
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const lm = l * 1e-9, B = 1 / (Math.pow(lm, 5) * (Math.exp(1.4388e-2 / (lm * T)) - 1));
    X += B * (1.056 * g_(l, 599.8, 37.9, 31.0) + 0.362 * g_(l, 442.0, 16.0, 26.7) - 0.065 * g_(l, 501.1, 20.4, 26.2));
    Y += B * (0.821 * g_(l, 568.8, 46.9, 40.5) + 0.286 * g_(l, 530.9, 16.3, 31.1));
    Z += B * (1.217 * g_(l, 437.0, 11.8, 36.0) + 0.681 * g_(l, 459.0, 26.0, 13.8));
  }
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, gg = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  r = Math.max(r, 0); gg = Math.max(gg, 0); b = Math.max(b, 0); const m = Math.max(r, gg, b) || 1;
  c = [r / m, gg / m, b / m]; bbCache.set(key, c); return c.slice();
}
export const tempColor = blackbody;   // linear RGB
export const toSRGB = c => c.map(v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
// galactic (l, b) in degrees -> unit vector in our galaxy frame (x right, y = north galactic pole, -z toward the centre)
export function galDir(l, b) {
  l *= D2R; b *= D2R;
  return [-Math.cos(b) * Math.sin(l), Math.sin(b), -Math.cos(b) * Math.cos(l)];
}
export function fmtDist(ly) {
  const au = ly * 63241.1;
  if (ly >= 1e9) return (ly / 1e9).toFixed(2) + ' Gly';
  if (ly >= 1e6) return (ly / 1e6).toFixed(ly >= 1e7 ? 0 : 2) + ' Mly';
  if (ly >= 1e3) return (ly / 1e3).toFixed(ly >= 1e4 ? 0 : 1) + ' kly';
  if (ly >= 0.1) return ly.toFixed(ly >= 10 ? 0 : 2) + ' ly';
  if (au >= 0.1) return au.toFixed(au >= 10 ? 0 : 2) + ' AU';
  return Math.round(au * 1.496e8).toLocaleString('en-US') + ' km';
}

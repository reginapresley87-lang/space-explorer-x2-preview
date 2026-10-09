// Procedural, original textures generated at runtime on <canvas>. No image assets.
import * as THREE from './vendor/three.module.min.js';

// ---------- seeded RNG + 3D gradient noise ----------
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
export function makeNoise(seed) {
  const r = rng(seed), p = new Uint8Array(512), perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const G = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const g = (h, x, y, z) => { const v = G[h % 12]; return v[0] * x + v[1] * y + v[2] * z; };
  return function (x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[xi] + yi, AA = p[A] + zi, AB = p[A + 1] + zi, B = p[xi + 1] + yi, BA = p[B] + zi, BB = p[B + 1] + zi;
    const l = (a, b, t) => a + t * (b - a);
    return l(
      l(l(g(p[AA], x, y, z), g(p[BA], x - 1, y, z), u), l(g(p[AB], x, y - 1, z), g(p[BB], x - 1, y - 1, z), u), v),
      l(l(g(p[AA + 1], x, y, z - 1), g(p[BA + 1], x - 1, y, z - 1), u), l(g(p[AB + 1], x, y - 1, z - 1), g(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  };
}
export function fbm(n, x, y, z, oct = 5, lac = 2, gain = 0.5) {
  let a = 1, f = 1, s = 0, t = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f, z * f); t += a; a *= gain; f *= lac; }
  return s / t; // ~[-0.7,0.7]
}
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// Render an equirectangular texture: fn(x,y,z,lat,lon) -> [r,g,b] or [r,g,b,a]
function equirect(w, h, fn, alpha = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI, cl = Math.cos(lat), y = Math.sin(lat);
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * 2 * Math.PI;
      const x = cl * Math.cos(lon), z = -cl * Math.sin(lon);
      const col = fn(x, y, z, lat, lon), k = (j * w + i) * 4;
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = alpha ? col[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 2;
  return t;
}

function craters(seed, count, minR, maxR) {
  const r = rng(seed), list = [];
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const rad = minR + Math.pow(r(), 3) * (maxR - minR);
    list.push([s * Math.cos(th), u, s * Math.sin(th), rad, Math.cos(rad * 1.3)]);
  }
  return (x, y, z) => { // returns height offset
    let hgt = 0;
    for (const c of list) {
      const dt = x * c[0] + y * c[1] + z * c[2];
      if (dt < c[4]) continue;
      const a = Math.acos(Math.min(1, dt)) / c[3];
      if (a < 1) hgt -= 0.55 * (1 - a * a); else if (a < 1.3) hgt += 0.35 * (1 - (a - 1) / 0.3);
    }
    return hgt;
  };
}

// ---------- body generators ----------
function rocky(seed, base, dark, opts = {}) {
  const n = makeNoise(seed), cr = craters(seed + 7, opts.craters ?? 70, 0.02, opts.maxCrater ?? 0.25);
  const A = hex(base), B = hex(dark), M = opts.maria ? hex(opts.maria) : null;
  return (x, y, z) => {
    let v = 0.5 + fbm(n, x * 3, y * 3, z * 3, 5) * 0.9;
    v += cr(x, y, z) * 0.35;
    let c = mix(B, A, clamp(v));
    if (M) { const m = fbm(n, x * 1.4 + 9, y * 1.4, z * 1.4, 4); c = mix(c, M, smooth(0.05, 0.2, m) * 0.85); }
    return c;
  };
}

const GEN = {
  ice: s => rocky(s, 0xeceef2, 0x9ea4ac, { craters: 90, maxCrater: 0.22 }),
  icegray: s => rocky(s, 0xc9c5c0, 0x77726c, { craters: 70 }),
  darkice: s => rocky(s, 0x9c9894, 0x4e4b48, { craters: 80 }),
  dark: s => rocky(s, 0x6e6258, 0x2c2622, { craters: 60, maxCrater: 0.35 }),
  gray: s => rocky(s, 0x9a948c, 0x4a4640, { craters: 50, maxCrater: 0.3 }),
  red: s => rocky(s, 0xb86a48, 0x5a2c1c, { craters: 40, maxCrater: 0.3 }),
  hyperion: s => rocky(s, 0xd2bc94, 0x4e3e2a, { craters: 220, maxCrater: 0.16 }),
  iapetus: s => { const n = makeNoise(s), r = rocky(s, 0xe6e2da, 0x8c8780, { craters: 70 });
    return (x, y, z) => { const c = r(x, y, z), k = smooth(0.15, -0.25, x + fbm(n, x * 3, y * 3, z * 3, 3) * 0.4) * smooth(0.95, 0.6, Math.abs(y));
      return mix(c, hex(0x2a1e16), k * 0.92); }; },
  miranda: s => { const n = makeNoise(s), r = rocky(s, 0xd2d4d8, 0x7c7f84, { craters: 50 });
    return (x, y, z) => { const c = r(x, y, z), v = Math.sin(fbm(n, x * 2, y * 2, z * 2, 3) * 40);
      return mix(c, hex(0x6a6c70), smooth(0.6, 0.95, v) * 0.6); }; },
  pluto: s => { const n = makeNoise(s), cr = craters(s + 5, 30, 0.02, 0.12); return (x, y, z, lat, lon) => {
    let c = mix(hex(0xb88a62), hex(0xe8d2b4), clamp(0.5 + fbm(n, x * 3, y * 3, z * 3, 5) + cr(x, y, z) * 0.2));
    c = mix(c, hex(0x4a2618), smooth(0.35, 0.1, Math.abs(lat + 0.1 + fbm(n, x * 2, y * 2, z * 2, 3) * 0.3)) * smooth(-0.2, 0.3, Math.cos(lon - 4.0)) * 0.85);
    let dl = Math.atan2(Math.sin(lon - 3.0), Math.cos(lon - 3.0));
    const heart = Math.min(((dl + 0.25) / 0.38) ** 2 + ((lat - 0.32) / 0.35) ** 2, ((dl - 0.3) / 0.3) ** 2 + ((lat - 0.2) / 0.32) ** 2);
    c = mix(c, hex(0xf6efe6), smooth(1.15, 0.8, heart + fbm(n, x * 6, y * 6, z * 6, 3) * 0.5));
    return c; }; },
  charon: s => { const r = rocky(s, 0xb4b0ac, 0x5e5a56, { craters: 70 }); return (x, y, z, lat) => mix(r(x, y, z), hex(0x6e3020), smooth(1.0, 1.35, lat) * 0.8); },
  sun: s => { const n = makeNoise(s); return (x, y, z) => {
    const v = fbm(n, x * 6, y * 6, z * 6, 5) * 0.5 + 0.5, g = fbm(n, x * 22, y * 22, z * 22, 2) * 0.5 + 0.5;
    const t = clamp(v * 0.75 + g * 0.35);
    return mix(hex(0xff7a10), hex(0xfff2b0), t); }; },
  mercury: s => rocky(s, 0xb3aba0, 0x5e5853, { craters: 110 }),
  moon: s => rocky(s, 0xcfcac2, 0x6a6762, { craters: 90, maria: 0x4e4c4a }),
  callisto: s => rocky(s, 0x8a7b68, 0x3b342c, { craters: 160, maxCrater: 0.12 }),
  ganymede: s => { const n = makeNoise(s), r = rocky(s, 0xb2a796, 0x5b5145, { craters: 60 });
    return (x, y, z) => { const c = r(x, y, z), m = fbm(n, x * 2, y * 2 + 4, z * 2, 4);
      return mix(c, hex(0x4a4036), smooth(0.0, 0.15, m) * 0.7); }; },
  venus: s => { const n = makeNoise(s); return (x, y, z) => {
    const w = fbm(n, x * 2, y * 2, z * 2, 4);
    const v = 0.5 + 0.5 * Math.sin(y * 9 + w * 6) * 0.4 + fbm(n, x * 4 + w, y * 8, z * 4, 4) * 0.6;
    return mix(hex(0xb8894a), hex(0xf2dca8), clamp(v)); }; },
  earth: s => { const n = makeNoise(s); return (x, y, z, lat) => {
    const h = fbm(n, x * 1.8, y * 1.8, z * 1.8, 6) + 0.08 * fbm(n, x * 9, y * 9, z * 9, 3);
    const al = Math.abs(lat);
    let c;
    if (h < 0.04) { const d = clamp((0.04 - h) * 4); c = mix(hex(0x2f6fa8), hex(0x0b2a5c), d); }
    else {
      const hh = clamp((h - 0.04) * 3), dry = fbm(n, x * 3 + 5, y * 3, z * 3, 4);
      const desert = smooth(0.12, 0.42, 1 - Math.abs(al - 0.42) * 3) * smooth(-0.05, 0.15, dry);
      c = mix(hex(0x3d7a35), hex(0x6b5b3a), hh);
      c = mix(c, hex(0xcdb27a), desert * 0.9);
    }
    const ice = smooth(1.15, 1.3, al + fbm(n, x * 5, y * 5, z * 5, 3) * 0.25);
    return mix(c, hex(0xf2f6fa), ice); }; },
  earthClouds: s => { const n = makeNoise(s); return (x, y, z, lat) => {
    const w = fbm(n, x * 2, y * 2, z * 2, 3);
    const v = fbm(n, x * 3 + w * 2, y * 6 + w, z * 3, 5) + 0.1 * Math.cos(lat * 6);
    const a = smooth(0.0, 0.35, v) * 255; return [255, 255, 255, a]; }; },
  mars: s => { const n = makeNoise(s), cr = craters(s + 3, 40, 0.02, 0.15); return (x, y, z, lat) => {
    const v = fbm(n, x * 2.2, y * 2.2, z * 2.2, 6) + cr(x, y, z) * 0.12;
    let c = mix(hex(0xc1602e), hex(0xe0a070), clamp(0.5 + v));
    c = mix(c, hex(0x5a2c1a), smooth(0.05, 0.25, fbm(n, x * 1.3 + 7, y * 1.3, z * 1.3, 4)) * 0.75);
    const cap = smooth(1.28, 1.38, Math.abs(lat) + fbm(n, x * 6, y * 6, z * 6, 2) * 0.15);
    return mix(c, hex(0xf4efe8), cap); }; },
  gas: (s, palette, opts = {}) => { const n = makeNoise(s), P = palette.map(hex); return (x, y, z, lat, lon) => {
    const turb = fbm(n, x * 3, y * 3, z * 3, 5) * (opts.turb ?? 0.18);
    let b = y * (opts.bands ?? 7) + turb + fbm(n, x * 0.7, y * 9, z * 0.7, 3) * 0.6;
    let t = (Math.sin(b * Math.PI) * 0.5 + 0.5);
    const idx = ((Math.floor(b) % P.length) + P.length) % P.length;
    let c = mix(P[idx], P[(idx + 1) % P.length], smooth(0.2, 0.8, b - Math.floor(b)));
    c = mix(c, [255, 255, 255], (1 - t) * (opts.light ?? 0.08));
    if (opts.spot) { // a big oval storm
      const [sl, sn, sw, sh, sc] = opts.spot;
      let dl = lon - sn; dl = Math.atan2(Math.sin(dl), Math.cos(dl));
      const e = (dl / sw) ** 2 + ((lat - sl) / sh) ** 2 + turb * 2;
      if (e < 1.3) c = mix(c, hex(sc), smooth(1.3, 0.5, e) * 0.85);
    }
    return c; }; },
  io: s => { const n = makeNoise(s), r = rng(s), spots = Array.from({ length: 50 }, () => {
      const u = r() * 2 - 1, th = r() * 6.283, q = Math.sqrt(1 - u * u); return [q * Math.cos(th), u, q * Math.sin(th), 0.02 + r() * 0.07, r()]; });
    return (x, y, z) => {
      let c = mix(hex(0xd9c24a), hex(0xf3ecb0), clamp(0.5 + fbm(n, x * 3, y * 3, z * 3, 5)));
      c = mix(c, hex(0xb7652a), smooth(0.08, 0.3, fbm(n, x * 2 + 3, y * 2, z * 2, 4)) * 0.7);
      for (const p of spots) { const a = Math.acos(clamp(x * p[0] + y * p[1] + z * p[2], -1, 1)) / p[3];
        if (a < 1) c = mix(c, p[4] > 0.5 ? hex(0x2a1a10) : hex(0xa8341c), (1 - a) * 0.9);
        else if (a < 2.5 && p[4] > 0.7) c = mix(c, hex(0xc0502a), (1 - (a - 1) / 1.5) * 0.35); }
      return c; }; },
  europa: s => { const n = makeNoise(s); return (x, y, z) => {
    let c = mix(hex(0xd8cfc0), hex(0xf5f1ea), clamp(0.5 + fbm(n, x * 3, y * 3, z * 3, 4)));
    const l1 = Math.abs(fbm(n, x * 4, y * 4, z * 4, 4)), l2 = Math.abs(fbm(n, x * 9 + 2, y * 9, z * 9, 3));
    c = mix(c, hex(0x8a5a3a), smooth(0.03, 0.0, l1) * 0.8 + smooth(0.02, 0.0, l2) * 0.5);
    return c; }; },
  enceladus: s => rocky(s, 0xf4f6f8, 0xbfc7cf, { craters: 50, maxCrater: 0.12 }),
  titan: s => { const n = makeNoise(s); return (x, y, z) => {
    const v = 0.5 + fbm(n, x * 2, y * 5, z * 2, 4) * 0.5;
    return mix(hex(0xb7792c), hex(0xe2b45a), clamp(v)); }; },
  triton: s => { const n = makeNoise(s); return (x, y, z, lat) => {
    let c = mix(hex(0xb7a39a), hex(0xeadbd2), clamp(0.5 + fbm(n, x * 4, y * 4, z * 4, 5)));
    c = mix(c, hex(0xd9a99a), smooth(-0.2, -0.6, lat) * 0.6);
    return c; }; },
};

export function bodyTexture(kind, seed, w = 512, h = 256) {
  let fn;
  switch (kind) {
    case 'jupiter': fn = GEN.gas(seed, [0xd9c3a3, 0xa0704a, 0xe8dcc8, 0xb98a5e, 0xc9b08c, 0x8f6446], { bands: 9, turb: 0.22, spot: [-0.39, 1.2, 0.22, 0.1, 0xc0583a] }); break;
    case 'saturn': fn = GEN.gas(seed, [0xe3d2a6, 0xc9ae78, 0xd9c08a, 0xbfa06a], { bands: 8, turb: 0.1, light: 0.05 }); break;
    case 'uranus': fn = GEN.gas(seed, [0xa9e1e6, 0x9bd6dd, 0xb3e6ea], { bands: 4, turb: 0.05, light: 0.04 }); break;
    case 'neptune': fn = GEN.gas(seed, [0x3f63d8, 0x2f4fb8, 0x5277e6, 0x3a5cc8], { bands: 5, turb: 0.15, light: 0.1, spot: [-0.35, 2.5, 0.2, 0.09, 0x1a2a70] }); break;
    default: fn = GEN[kind](seed);
  }
  return equirect(w, h, fn, kind === 'earthClouds');
}

// Saturn ring: 1D radial strip (u = inner->outer), with alpha.
export function ringTexture(seed) {
  const n = makeNoise(seed), W = 1024, c = document.createElement('canvas'); c.width = W; c.height = 4;
  const ctx = c.getContext('2d'), img = ctx.createImageData(W, 4);
  const inner = 1.24, outer = 2.27;
  for (let i = 0; i < W; i++) {
    const r = inner + (i / (W - 1)) * (outer - inner);
    let a;
    if (r < 1.53) a = 0.18 + 0.1 * smooth(1.24, 1.53, r);           // C ring
    else if (r < 1.95) a = 0.75 + 0.2 * smooth(1.53, 1.75, r);       // B ring
    else if (r < 2.03) a = 0.05;                                      // Cassini division
    else if (r < 2.27) a = 0.55;                                      // A ring
    if (Math.abs(r - 2.214) < 0.006) a = 0.08;                        // Encke gap
    a *= 0.75 + 0.5 * (n(r * 40, 0.5, 0.5) * 0.5 + 0.5);
    a = clamp(a) * smooth(2.27, 2.2, r) ** 0.2;
    const col = mix(hex(0x8c7a62), hex(0xe9dcc0), clamp(a * 1.2));
    for (let j = 0; j < 4; j++) { const k = (j * W + i) * 4; img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = a * 255; }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function glowTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d'), g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Milky Way + faint star dust backdrop (equirectangular, galactic band tilted).
export function skyTexture(seed, w = 1024, h = 512) {
  const n = makeNoise(seed);
  // galactic plane normal, tilted ~60deg vs ecliptic (like the real sky)
  const nx = 0, ny = Math.cos(1.05), nz = Math.sin(1.05);
  const tex = equirect(w, h, (x, y, z) => {
    const d = x * nx + y * ny + z * nz;                 // distance from galactic plane
    const core = Math.max(0, x * 0.8 + (y * nz - z * ny) * 0.6); // brighter toward a "core" direction
    const cloud = fbm(n, x * 3, y * 3, z * 3, 6) * 0.5 + 0.5;
    const dust = fbm(n, x * 7 + 3, y * 7, z * 7, 4);
    let band = Math.exp(-(d * d) / (0.035 + 0.06 * core)) * (0.35 + 0.65 * cloud);
    band *= 1 - smooth(0.05, 0.3, dust) * smooth(0.2, 0.0, Math.abs(d)) * 0.8; // dark lane
    band *= 0.55 + 0.9 * core;
    const neb = smooth(0.25, 0.5, fbm(n, x * 1.5 + 11, y * 1.5, z * 1.5, 4)) * 0.18;
    let c = [4 + band * 135 + neb * 60, 6 + band * 120 + neb * 20, 14 + band * 115 + neb * 90];
    return c.map(v => clamp(v, 0, 255));
  });
  return tex;
}

// Tileable ground detail texture for surface views (seamless via 4-corner blending).
export function groundTexture(colA, colB, seed, size = 256) {
  const n = makeNoise(seed), A = hex(colA), B = hex(colB);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size), d = img.data, S = 6;
  const f = (x, y) => fbm(n, x, y, 0.5, 5) + 0.35 * fbm(n, x * 4 + 9, y * 4, 3.3, 3);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size, x = u * S, y = v * S;
    const val = f(x, y) * (1 - u) * (1 - v) + f(x - S, y) * u * (1 - v) + f(x, y - S) * (1 - u) * v + f(x - S, y - S) * u * v;
    const c2 = mix(B, A, clamp(0.5 + val * 1.4)), k = (j * size + i) * 4;
    d[k] = c2[0]; d[k + 1] = c2[1]; d[k + 2] = c2[2]; d[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// Planet terrain height field on the unit sphere (metres). Pure JS, no three.js: shared by the main thread
// (collision / altitude) and the tile worker (geometry), so both always agree. Original code.
const F = Math.fround, floor = Math.floor;
const fract = x => x - floor(x);
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- port of the GPU value noise in engine/shaders.js (float32-rounded) ----------
// used for the procedural ocean worlds' land mask so the coastline matches the orbital shader
function h3g(x, y, z) {
  x = fract(F(x * F(0.1031))); y = fract(F(y * F(0.1030))); z = fract(F(z * F(0.0973)));
  const d = F(F(x * F(y + F(33.33))) + F(y * F(x + F(33.33))) + F(z * F(z + F(33.33))));
  x = F(x + d); y = F(y + d); z = F(z + d);
  return fract(F(F(x + y) * z));
}
function vnG(x, y, z) {
  const ix = floor(x), iy = floor(y), iz = floor(z); let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = h3g(ix, iy, iz), b = h3g(ix + 1, iy, iz), c = h3g(ix, iy + 1, iz), d = h3g(ix + 1, iy + 1, iz);
  const e = h3g(ix, iy, iz + 1), f = h3g(ix + 1, iy, iz + 1), g = h3g(ix, iy + 1, iz + 1), h = h3g(ix + 1, iy + 1, iz + 1);
  const l0 = a + (b - a) * fx, l1 = c + (d - c) * fx, l2 = e + (f - e) * fx, l3 = g + (h - g) * fx;
  const m0 = l0 + (l1 - l0) * fy, m1 = l2 + (l3 - l2) * fy;
  return m0 + (m1 - m0) * fz;
}
function fbmNG(x, y, z, n, octMax) {
  let a = 0.5, s = 0, w = 0;
  for (let i = 0; i < octMax; i++) { const k = Math.min(1, Math.max(0, n - i)); if (k <= 0) break; s += a * vnG(x, y, z) * k; w += a * k; x = x * 2.03 + 1.7; y = y * 2.03 + 9.2; z = z * 2.03 + 3.1; a *= 0.5; }
  return s / Math.max(w, 1e-3);
}
// the shader's continent field for uType == 1 (ocean): cont - uSea  (> 0 = land)
export function oceanCont(dx, dy, dz, P) {
  const qx = dx * 2.1 + P.seedV[0], qy = dy * 2.1 + P.seedV[1], qz = dz * 2.1 + P.seedV[2];
  const warp = fbmNG(qx * 0.9 + 7, qy * 0.9 + 7, qz * 0.9 + 7, 4, P.octMax);
  return fbmNG(qx * 1.15 + warp * 0.9, qy * 1.15 + warp * 0.9, qz * 1.15 + warp * 0.9, P.octMax, P.octMax) - P.sea;
}

// ---------- fast double-precision value noise for the relief ----------
function hash3(i, j, k, s) {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x1b873593) ^ s;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z, s) {
  const ix = floor(x), iy = floor(y), iz = floor(z); let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10); fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10); fz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash3(ix, iy, iz, s), b = hash3(ix + 1, iy, iz, s), c = hash3(ix, iy + 1, iz, s), d = hash3(ix + 1, iy + 1, iz, s);
  const e = hash3(ix, iy, iz + 1, s), f = hash3(ix + 1, iy, iz + 1, s), g = hash3(ix, iy + 1, iz + 1, s), h = hash3(ix + 1, iy + 1, iz + 1, s);
  const l0 = a + (b - a) * fx, l1 = c + (d - c) * fx, l2 = e + (f - e) * fx, l3 = g + (h - g) * fx;
  const m0 = l0 + (l1 - l0) * fy, m1 = l2 + (l3 - l2) * fy;
  return m0 + (m1 - m0) * fz;
}
// a fixed rotation between octaves hides the lattice
const RX = [0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64];
function fbm(x, y, z, oct, gain, s) {
  let a = 1, t = 0, sum = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * vnoise(x, y, z, s + i * 1013); t += a; a *= gain;
    const nx = (RX[0] * x + RX[1] * y + RX[2] * z) * 2.02, ny = (RX[3] * x + RX[4] * y + RX[5] * z) * 2.02, nz = (RX[6] * x + RX[7] * y + RX[8] * z) * 2.02;
    x = nx + 17.3; y = ny + 3.9; z = nz + 11.1;
  }
  return sum / t;
}
function ridged(x, y, z, oct, s) {
  let a = 0.5, w = 1, t = 0, sum = 0;
  for (let i = 0; i < oct; i++) {
    let r = 1 - Math.abs(vnoise(x, y, z, s + i * 733) * 2 - 1); r *= r; sum += r * a * w; t += a; w = Math.min(1, Math.max(0, r * 1.8)); a *= 0.5;
    const nx = (RX[0] * x + RX[1] * y + RX[2] * z) * 2.07, ny = (RX[3] * x + RX[4] * y + RX[5] * z) * 2.07, nz = (RX[6] * x + RX[7] * y + RX[8] * z) * 2.07;
    x = nx + 5.1; y = ny + 1.3; z = nz + 7.7;
  }
  return sum / t;
}
// craters: one candidate per 3D cell (centre jittered so a crater never crosses into a neighbour cell)
function craterLayer(x, y, z, cell, s, dens, depth) {
  const ix = floor(x / cell), iy = floor(y / cell), iz = floor(z / cell);
  if (hash3(ix, iy, iz, s) > dens) return 0;
  const cx = (ix + 0.3 + 0.4 * hash3(ix, iy, iz, s + 1)) * cell, cy = (iy + 0.3 + 0.4 * hash3(ix, iy, iz, s + 2)) * cell, cz = (iz + 0.3 + 0.4 * hash3(ix, iy, iz, s + 3)) * cell;
  const r = cell * (0.07 + 0.11 * hash3(ix, iy, iz, s + 4) ** 2);
  const d = Math.hypot(x - cx, y - cy, z - cz) / r; if (d > 1.7) return 0;
  return ((d < 1 ? d * d - 1 : 0) * 0.9 + Math.exp(-(d - 1) * (d - 1) * 12) * 0.25) * r * depth;
}
// bilinear lookup of an equirectangular grey map (same uv convention as THREE.SphereGeometry / uvOf in shaders.js)
function sampleMap(M, dx, dy, dz) {
  let phi = Math.atan2(dz, -dx); if (phi < 0) phi += Math.PI * 2;
  const u = phi / (Math.PI * 2) * M.w - 0.5, v = Math.acos(Math.max(-1, Math.min(1, dy))) / Math.PI * M.h - 0.5;
  const x0 = floor(u), y0 = Math.max(0, Math.min(M.h - 1, floor(v))), y1 = Math.min(M.h - 1, y0 + 1), tx = u - x0, ty = Math.max(0, Math.min(1, v - y0));
  const xa = ((x0 % M.w) + M.w) % M.w, xb = (xa + 1) % M.w, D = M.data;
  const a = D[y0 * M.w + xa], b = D[y0 * M.w + xb], c = D[y1 * M.w + xa], d = D[y1 * M.w + xb];
  return ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty) / 255;
}

// ---------- the height field ----------
// P: { R (m), seed, type, craters, dunes, ridges, rough, ocean: 'tex' | 'proc' | null, lum?, sea?, seedV, octMax }
// returns height in metres; sets out.sea = depth below sea level (0 on land) when the world has an ocean
export function heightAt(dx, dy, dz, P, out) {
  const R = P.R, x = dx * R, y = dy * R, z = dz * R, s = P.seed | 0, rough = P.rough ?? 1;
  const Lc = Math.min(R * 0.3, 2.0e6), Lm = Math.min(R * 0.05, 2.4e5);
  const c = fbm(x / Lc, y / Lc, z / Lc, 4, 0.5, s) - 0.5;
  let h = c * 2600 * rough;
  const mask = sm(-0.06, 0.22, c + (P.ridges - 0.5) * 0.25);
  const m = ridged(x / Lm, y / Lm, z / Lm, 7, s + 101);
  h += m * m * mask * 7000 * P.ridges * rough;
  // hills and small-scale relief down to ~2 m
  const hill = fbm(x / 5200, y / 5200, z / 5200, 12, 0.5, s + 202) - 0.5;
  h += hill * 520 * rough;
  if (P.craters > 0) {
    const k = P.craters;
    h += craterLayer(x, y, z, Math.min(R * 0.08, 3.2e5), s + 11, 0.55, 0.12) * k;
    h += craterLayer(x, y, z, 26000, s + 12, 0.6, 0.18) * k;
    h += craterLayer(x, y, z, 3300, s + 13, 0.65, 0.2) * k;
    h += craterLayer(x, y, z, 420, s + 14, 0.7, 0.22) * k;
    h += craterLayer(x, y, z, 55, s + 15, 0.7, 0.22) * k;
  }
  if (P.dunes > 0) {
    const ph = (x * 0.8 + y * 0.35 + z * 0.49) / 95 + 3 * vnoise(x / 600, y / 600, z / 600, s + 303);
    h += Math.pow(1 - Math.abs(Math.sin(ph)), 1.6) * 14 * P.dunes * sm(400, -200, h);
  }
  if (P.lum) h += (sampleMap(P.lum, dx, dy, dz) - P.lum.mean) * (P.lumAmp ?? 5000);
  if (out) out.sea = 0;
  if (P.ocean === 'lava') { h += 300; if (h < 0 && out) out.sea = -h; return h; }   // lava lakes below the -300 m level
  if (P.ocean && (P.ocean !== 'tex' || P.seaMap)) {   // (Earth: until the sea mask is loaded the ground is plain land)
    let e;
    if (P.ocean === 'tex' && P.seaMap) e = (0.5 - sampleMap(P.seaMap, dx, dy, dz)) * 0.12 + (fbm(x / 9000, y / 9000, z / 9000, 6, 0.5, s + 404) - 0.5) * 0.035;
    else e = oceanCont(dx, dy, dz, P) + (fbm(x / 9000, y / 9000, z / 9000, 6, 0.5, s + 404) - 0.5) * 0.01;
    const land = sm(0, 0.02, e);
    h = e * 26000 + (h + 900) * land * 0.9 + hill * 60 * (1 - land);
    if (h < 0 && out) out.sea = -h;
  }
  return h;
}
// cube-sphere face mapping (equal-angle): face f, a, b in [-1, 1] -> unit vector
export function faceDir(f, a, b, out) {
  const u = Math.tan(a * Math.PI / 4), v = Math.tan(b * Math.PI / 4);
  let x, y, z;
  switch (f) {
    case 0: x = 1; y = v; z = -u; break;
    case 1: x = -1; y = v; z = u; break;
    case 2: x = u; y = 1; z = -v; break;
    case 3: x = u; y = -1; z = v; break;
    case 4: x = u; y = v; z = 1; break;
    default: x = -u; y = v; z = -1;
  }
  const l = Math.hypot(x, y, z); out[0] = x / l; out[1] = y / l; out[2] = z / l; return out;
}

// ---------- tile builder (runs in the worker) ----------
// returns typed arrays: positions relative to the tile centre (m), normals, unit directions, detail coords (m, relative to anchor), sea depth
export function buildTile(T, P) {
  const S = T.seg, N = 1 << T.level, size = 2 / N, a0 = -1 + T.x * size, b0 = -1 + T.y * size, R = P.R;
  const W = S + 3, H = new Float64Array(W * W), PX = new Float64Array(W * W * 3), SEA = new Float32Array(W * W), d = [0, 0, 0], o = { sea: 0 };
  for (let i = 0; i < W; i++) for (let j = 0; j < W; j++) {
    faceDir(T.face, a0 + (j - 1) / S * size, b0 + (i - 1) / S * size, d);
    const h = heightAt(d[0], d[1], d[2], P, o), k = i * W + j, hh = P.ocean ? Math.max(h, 0) : h, r = R + hh;
    H[k] = h; SEA[k] = o.sea; PX[k * 3] = d[0] * r; PX[k * 3 + 1] = d[1] * r; PX[k * 3 + 2] = d[2] * r;
  }
  faceDir(T.face, a0 + size / 2, b0 + size / 2, d);
  const C = [d[0] * R, d[1] * R, d[2] * R];
  const V = (S + 1) * (S + 1), E = 4 * (S + 1), NV = V + E;
  const pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3), obj = new Float32Array(NV * 3), det = new Float32Array(NV * 3), sea = new Float32Array(NV);
  let hmin = 1e9, hmax = -1e9, rad = 0;
  const put = (vi, k, drop) => {
    const px = PX[k * 3], py = PX[k * 3 + 1], pz = PX[k * 3 + 2], l = Math.hypot(px, py, pz), ux = px / l, uy = py / l, uz = pz / l;
    const qx = px - ux * drop, qy = py - uy * drop, qz = pz - uz * drop;
    pos[vi * 3] = qx - C[0]; pos[vi * 3 + 1] = qy - C[1]; pos[vi * 3 + 2] = qz - C[2];
    obj[vi * 3] = ux; obj[vi * 3 + 1] = uy; obj[vi * 3 + 2] = uz;
    det[vi * 3] = px - T.anchor[0]; det[vi * 3 + 1] = py - T.anchor[1]; det[vi * 3 + 2] = pz - T.anchor[2];
    sea[vi] = SEA[k] > 0 ? 1 : 0;
    // normal from the 4 neighbours (central differences on the bordered grid)
    const i = (k / W) | 0, j = k % W, kl = i * W + j - 1, kr = i * W + j + 1, kd = (i - 1) * W + j, ku = (i + 1) * W + j;
    const ax = PX[kr * 3] - PX[kl * 3], ay = PX[kr * 3 + 1] - PX[kl * 3 + 1], az = PX[kr * 3 + 2] - PX[kl * 3 + 2];
    const bx = PX[ku * 3] - PX[kd * 3], by = PX[ku * 3 + 1] - PX[kd * 3 + 1], bz = PX[ku * 3 + 2] - PX[kd * 3 + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl; if (nx * ux + ny * uy + nz * uz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nor[vi * 3] = nx; nor[vi * 3 + 1] = ny; nor[vi * 3 + 2] = nz;
    const rr = Math.hypot(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]); if (rr > rad) rad = rr;
  };
  for (let i = 0; i <= S; i++) for (let j = 0; j <= S; j++) { const k = (i + 1) * W + (j + 1); put(i * (S + 1) + j, k, 0); const h = P.ocean ? Math.max(H[k], 0) : H[k]; /* bounds of the drawn surface (sea level, not the sea floor) */ if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
  // skirts: copies of the edge vertices pushed down (hide cracks between neighbouring levels)
  const skirt = R * size * 0.012 + 3; let vi = V;
  for (let j = 0; j <= S; j++) put(vi++, 1 * W + (j + 1), skirt);
  for (let j = 0; j <= S; j++) put(vi++, (S + 1) * W + (j + 1), skirt);
  for (let i = 0; i <= S; i++) put(vi++, (i + 1) * W + 1, skirt);
  for (let i = 0; i <= S; i++) put(vi++, (i + 1) * W + (S + 1), skirt);
  return { pos, nor, obj, det, sea, C, rad, hmin, hmax };
}
// shared index buffer for a tile with S segments (+ skirts); flip = reverse winding
export function tileIndex(S, flip) {
  const V = (S + 1) * (S + 1), idx = [];
  const tri = (a, b, c) => flip ? idx.push(a, c, b) : idx.push(a, b, c);
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) { const a = i * (S + 1) + j, b = a + 1, c = a + S + 1, d = c + 1; tri(a, c, b); tri(b, c, d); }
  const e0 = V, e1 = V + (S + 1), e2 = V + 2 * (S + 1), e3 = V + 3 * (S + 1);
  for (let j = 0; j < S; j++) {
    const t0 = j, t1 = j + 1; tri(t0, t1, e0 + j); tri(t1, e0 + j + 1, e0 + j);                                  // bottom row (i = 0)
    const b0 = S * (S + 1) + j, b1 = b0 + 1; tri(b0, e1 + j, b1); tri(b1, e1 + j, e1 + j + 1);                     // top row (i = S)
    const l0 = j * (S + 1), l1 = (j + 1) * (S + 1); tri(l0, e2 + j, l1); tri(l1, e2 + j, e2 + j + 1);              // left column
    const r0 = j * (S + 1) + S, r1 = (j + 1) * (S + 1) + S; tri(r0, r1, e3 + j); tri(r1, e3 + j + 1, e3 + j);      // right column
  }
  return idx;
}

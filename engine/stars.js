// Star level: deterministic octree-like sector streaming of stars inside the current galaxy.
// Level k uses bigger sectors and only the intrinsically brighter classes, so far-away bright stars
// are present without generating billions of dim ones (implied by the galaxy particle cloud).
import * as THREE from '../scene/vendor/three.module.min.js';
import { hash, rng, starName, tempColor, clamp } from './util.js';
import { densityAt, MAX_DENSITY, SOL_GPOS } from './universe.js';

export const LEVELS = [
  { size: 12, rad: 2, cap: 40, classes: [['M', 0.0028], ['K', 0.0004], ['WD', 0.0004]] },
  { size: 36, rad: 2, cap: 40, classes: [['G', 0.0003], ['F', 0.00012]] },
  { size: 100, rad: 1, cap: 110, classes: [['A', 0.00003], ['KIII', 0.000025], ['NS', 1.6e-6], ['BH', 1.1e-6]] },
  { size: 400, rad: 1, cap: 110, classes: [['B', 1e-6], ['MIII', 4e-7]] },
  { size: 1600, rad: 1, cap: 110, classes: [['O', 1.2e-8], ['SG', 7e-9]] },
];

export const CLASS_INFO = {
  O: 'Blue giant (O-type)', B: 'Blue-white star (B-type)', A: 'White star (A-type)', F: 'Yellow-white star (F-type)', G: 'Yellow dwarf (G-type)',
  K: 'Orange dwarf (K-type)', M: 'Red dwarf (M-type)', KIII: 'Orange giant (K III)', MIII: 'Red giant (M III)', SG: 'Supergiant',
  WD: 'White dwarf', NS: 'Neutron star', BH: 'Black hole',
};

// physical properties of a star of class cls (deterministic from r)
export function starProps(cls, r) {
  let T, M, R, L;
  const ms = (t0, t1, m0, m1) => { const k = r(); T = t0 + (t1 - t0) * k; M = m0 + (m1 - m0) * (k * 0.8 + r() * 0.2); R = Math.pow(M, M > 1 ? 0.57 : 0.85); };
  switch (cls) {
    case 'O': ms(30000, 45000, 16, 60); R = 6 + r() * 9; break;
    case 'B': ms(10000, 30000, 2.1, 16); break;
    case 'A': ms(7500, 10000, 1.4, 2.1); break;
    case 'F': ms(6000, 7500, 1.04, 1.4); break;
    case 'G': ms(5300, 6000, 0.8, 1.04); break;
    case 'K': ms(3900, 5300, 0.45, 0.8); break;
    case 'M': ms(2400, 3800, 0.08, 0.45); break;
    case 'KIII': T = 3900 + r() * 900; R = 10 + r() * 30; M = 1 + r() * 2; break;
    case 'MIII': T = 3200 + r() * 600; R = 40 + r() * 110; M = 1 + r() * 4; break;
    case 'SG': if (r() < 0.6) { T = 3400 + r() * 800; R = 300 + r() * 600; } else { T = 12000 + r() * 13000; R = 30 + r() * 50; } M = 10 + r() * 15; break;
    case 'WD': T = 5000 + Math.pow(r(), 2) * 30000; R = 0.008 + r() * 0.006; M = 0.5 + r() * 0.6; break;
    case 'NS': T = 600000; R = 1.7e-5; M = 1.3 + r() * 0.7; break;
    case 'BH': T = 0; M = 5 + Math.pow(r(), 2) * 25; R = M * 2.95 / 695700; break;
  }
  L = cls === 'BH' ? 0 : cls === 'NS' ? 0.002 : R * R * Math.pow(T / 5772, 4);
  const absMag = cls === 'BH' ? 14 : cls === 'NS' ? 11 : 4.83 - 2.5 * Math.log10(L);
  const color = cls === 'BH' ? [0.55, 0.45, 0.9] : cls === 'NS' ? [0.7, 0.8, 1] : tempColor(T);
  return { T, M, R, L, absMag, color };
}
export function spectral(cls, T) {
  if (cls === 'WD') return 'DA' + clamp(Math.round(50400 / T), 1, 9);
  if (cls === 'NS' || cls === 'BH') return '–';
  const bands = { O: [30000, 50000], B: [10000, 30000], A: [7500, 10000], F: [6000, 7500], G: [5200, 6000], K: [3700, 5200], M: [2400, 3700] };
  let L = cls[0], lum = 'V';
  if (cls === 'KIII') { L = 'K'; lum = 'III'; } if (cls === 'MIII') { L = 'M'; lum = 'III'; }
  if (cls === 'SG') { L = T > 10000 ? 'B' : T > 7500 ? 'A' : T > 5200 ? 'G' : T > 3700 ? 'K' : 'M'; lum = 'Ia'; }
  const b = bands[L] || [2400, 50000];
  return L + clamp(Math.round((b[1] - T) / (b[1] - b[0]) * 9), 0, 9) + lum;
}

// ---------- real stars in the Milky Way ----------
const at = (l, b, d) => { const v = new THREE.Vector3(...(rad => [-Math.cos(b * rad) * Math.sin(l * rad), Math.sin(b * rad), -Math.cos(b * rad) * Math.cos(l * rad)])(Math.PI / 180)); return v.multiplyScalar(d).add(SOL_GPOS); };
const real = (id, name, gpos, cls, T, R, L, extra = {}) => ({ id, name, gpos, cls, T, R, L, M: extra.M || 1, real: true, absMag: extra.absMag ?? 4.83 - 2.5 * Math.log10(L), color: extra.color || tempColor(T), seed: hash(id), level: -1, ...extra });
export const REAL_STARS = [
  real('sol', 'Sun', SOL_GPOS.clone(), 'G', 5772, 1, 1, { M: 1, sub: 'G2V' }),
  real('alphacen', 'Alpha Centauri', at(315.73, -0.68, 4.37), 'G', 5790, 1.22, 2.0, { M: 1.1, sub: 'G2V + K1V' }),
  real('proxima', 'Proxima Centauri', at(313.94, -1.93, 4.246), 'M', 3042, 0.154, 0.0017, { M: 0.122, sub: 'M5.5Ve' }),
  real('sirius', 'Sirius', at(227.23, -8.89, 8.6), 'A', 9940, 1.71, 25.4, { M: 2.06, sub: 'A1V + DA2' }),
  real('betelgeuse', 'Betelgeuse', at(199.79, -8.96, 548), 'SG', 3600, 764, 126000, { M: 18, sub: 'M1-2 Ia-ab' }),
  real('trappist1', 'TRAPPIST-1', at(69.71, -56.64, 40.66), 'M', 2566, 0.119, 0.00055, { M: 0.09, sub: 'M8V' }),
  real('sgra', 'Sagittarius A*', new THREE.Vector3(0, 0, 0), 'BH', 0, 0.087, 0, { M: 4.3e6, absMag: 4, color: [0.9, 0.6, 0.4], sub: 'supermassive black hole' }),
];

// ---------- sector generation ----------
const cache = new Map();
export function sectorStars(g, seed, L, sx, sy, sz) {
  const key = `${g.id}|${L}|${sx}|${sy}|${sz}`;
  let s = cache.get(key); if (s) return s;
  const lv = LEVELS[L], S = lv.size, r = rng(hash(seed, g.seed, L, sx, sy, sz));
  const x0 = sx * S, y0 = sy * S, z0 = sz * S;
  let dmax = 0;
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++) dmax = Math.max(dmax, densityAt(g, x0 + S * i / 2, y0 + S * j / 2, z0 + S * k / 2));
  dmax = Math.min(MAX_DENSITY, dmax * 1.3 + 0.002);
  const tot = lv.classes.reduce((a, c) => a + c[1], 0), vol = S * S * S;
  let lam = tot * vol * dmax, thin = 1;
  if (lam > lv.cap) { thin = lv.cap / lam; lam = lv.cap; }
  const n = Math.floor(lam + r()), out = [];
  const isMW = g.id === 'mw';
  for (let i = 0; i < n; i++) {
    const px = x0 + r() * S, py = y0 + r() * S, pz = z0 + r() * S, acc = r(), pick = r() * tot;
    if (acc * dmax > densityAt(g, px, py, pz)) continue;
    let cls = lv.classes[0][0], a = 0; for (const c of lv.classes) { a += c[1]; if (pick <= a) { cls = c[0]; break; } }
    const gpos = new THREE.Vector3(px, py, pz);
    if (gpos.length() < 2) continue;    // galactic core is reserved for the central black hole
    if (isMW && (gpos.distanceTo(SOL_GPOS) < 4.5 || REAL_STARS.some(s => s.gpos.distanceTo(gpos) < 0.5))) continue;
    const sseed = hash(seed, g.seed, L, sx, sy, sz, i, 7);
    const pr = starProps(cls, rng(sseed));
    out.push({ id: `${g.id}/s:${L}:${sx}:${sy}:${sz}:${i}`, galId: g.id, level: L, i, gpos, cls, seed: sseed, ...pr, thin });
  }
  s = { key, L, stars: out };
  cache.set(key, s);
  if (cache.size > 4000) cache.delete(cache.keys().next().value);
  return s;
}
export function starName_(st) { return st.name || (st.name = starName(st.seed)); }
export function starById(galaxy, seed, id) {
  const m = /\/s:(\d):(-?\d+):(-?\d+):(-?\d+):(\d+)$/.exec(id); if (!m || !galaxy) return null;
  const s = sectorStars(galaxy, seed, +m[1], +m[2], +m[3], +m[4]);
  const st = s.stars.find(x => x.i === +m[5]) || null;
  if (st) starName_(st);
  return st;
}

// ---------- renderer ----------
const VS = `uniform float uMagLim, uPR, uFadeR, uAlpha; uniform vec3 uHide;
  attribute vec3 color; attribute float absMag; varying vec3 vC; varying float vA;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.);
    float d = max(length(mv.xyz), 1e-6);
    float m = absMag + 5. * log2(d / 32.616) * 0.30103;
    float I = exp2(-1.3288 * (m - uMagLim));
    float a = clamp(I, 0., 1.) * uAlpha * smoothstep(uFadeR, uFadeR * 0.7, d);
    if (distance(position, uHide) < 2e-3) a = 0.;
    float s = (1.6 + 1.3 * log(1. + max(I - 1., 0.))) * uPR;   // bright stars: small hot core (HDR) + bloom, not big discs
    gl_PointSize = min(s, 18. * uPR); vC = color; vA = a * clamp(sqrt(max(I, 1.)), 1., 6.);
    gl_Position = projectionMatrix * mv;
    if (a < 0.004) gl_Position = vec4(2., 2., 2., 1.);
  }`;
const FS = `varying vec3 vC; varying float vA;
  void main(){ float r = length(gl_PointCoord - .5) * 2.; float f = (exp(-r * r * 9.) + exp(-r * 3.2) * .3) * (1. - smoothstep(.8, 1., r));
    gl_FragColor = vec4(vC * f * vA, 1.); }`;

export class StarField {
  constructor(seed, quality = 1) {
    this.seed = seed; this.group = new THREE.Group(); this.galaxy = null; this.quality = quality;
    this.levels = LEVELS.map((lv, L) => {
      const cap = Math.ceil(Math.pow(2 * lv.rad + 1, 3) * lv.cap * 1.05);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('absMag', new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
      geo.setDrawRange(0, 0);
      const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uMagLim: { value: 7.5 }, uPR: { value: 1 }, uFadeR: { value: lv.size * (lv.rad + 0.5) }, uAlpha: { value: 1 }, uHide: { value: new THREE.Vector3(1e9, 0, 0) } } });
      const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; this.group.add(pts);
      return { L, lv, cap, pts, geo, mat, origin: new THREE.Vector3(), center: null, stars: [], dirty: false };
    });
    // the real stars (Milky Way only) – a tiny fixed buffer
    const geo = new THREE.BufferGeometry(), n = REAL_STARS.length;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(REAL_STARS.flatMap(s => s.color)), 3));
    geo.setAttribute('absMag', new THREE.BufferAttribute(new Float32Array(REAL_STARS.map(s => s.absMag)), 1));
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uMagLim: { value: 7.5 }, uPR: { value: 1 }, uFadeR: { value: 1e6 }, uAlpha: { value: 1 }, uHide: { value: new THREE.Vector3(1e9, 0, 0) } } });
    this.real = { pts: new THREE.Points(geo, mat), geo, mat, origin: new THREE.Vector3() };
    this.real.pts.frustumCulled = false; this.group.add(this.real.pts);
    this.mats = [...this.levels.map(l => l.mat), mat];
  }
  setGalaxy(g) {
    if (g === this.galaxy) return;
    this.galaxy = g;
    for (const l of this.levels) { l.center = null; l.stars = []; l.geo.setDrawRange(0, 0); }
    this.real.pts.visible = !!g && g.id === 'mw';
  }
  // camG: camera in galaxy-local ly. Generates missing sectors within a time budget.
  update(camG, budgetMs = 4) {
    const g = this.galaxy; if (!g) return;
    const t0 = performance.now();
    for (const l of this.levels) {
      const S = l.lv.size, R = Math.max(1, Math.round(l.lv.rad * (this.quality < 1 && l.L < 2 ? 0.5 : 1)));
      const cx = Math.floor(camG.x / S), cy = Math.floor(camG.y / S), cz = Math.floor(camG.z / S);
      const key = `${cx}|${cy}|${cz}`;
      if (l.center === key && !l.pending) continue;
      let missing = false; const sectors = [];
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) {
        const ck = `${g.id}|${l.L}|${cx + i}|${cy + j}|${cz + k}`;
        if (performance.now() - t0 > budgetMs && !cache.has(ck)) { missing = true; continue; }
        sectors.push(sectorStars(g, this.seed, l.L, cx + i, cy + j, cz + k));
      }
      l.pending = missing; l.center = key;
      l.origin.set((cx + 0.5) * S, (cy + 0.5) * S, (cz + 0.5) * S);
      const pos = l.geo.attributes.position.array, col = l.geo.attributes.color.array, mag = l.geo.attributes.absMag.array;
      let n = 0; l.stars = [];
      for (const s of sectors) for (const st of s.stars) {
        if (n >= l.cap) break;
        pos[n * 3] = st.gpos.x - l.origin.x; pos[n * 3 + 1] = st.gpos.y - l.origin.y; pos[n * 3 + 2] = st.gpos.z - l.origin.z;
        col[n * 3] = st.color[0]; col[n * 3 + 1] = st.color[1]; col[n * 3 + 2] = st.color[2]; mag[n] = st.absMag; l.stars.push(st); n++;
      }
      l.geo.setDrawRange(0, n);
      for (const a of ['position', 'color', 'absMag']) { l.geo.attributes[a].needsUpdate = true; }
      l.mat.uniforms.uFadeR.value = S * (R + 0.5);
    }
  }
  // place the levels relative to the camera (camera at origin, galaxy orientation q)
  place(camG, q, hideGpos) {
    for (const l of this.levels) {
      l.pts.position.copy(l.origin).sub(camG).applyQuaternion(q); l.pts.quaternion.copy(q);
      l.mat.uniforms.uHide.value.copy(hideGpos || l.origin).sub(l.origin); if (!hideGpos) l.mat.uniforms.uHide.value.set(1e9, 0, 0);
    }
    const r = this.real, p = r.geo.attributes.position;
    REAL_STARS.forEach((s, i) => p.setXYZ(i, s.gpos.x - camG.x, s.gpos.y - camG.y, s.gpos.z - camG.z)); p.needsUpdate = true;
    r.pts.quaternion.copy(q); r.pts.position.set(0, 0, 0);
    if (hideGpos) r.mat.uniforms.uHide.value.copy(hideGpos).sub(camG); else r.mat.uniforms.uHide.value.set(1e9, 0, 0);
  }
  setUniform(name, v) { for (const m of this.mats) m.uniforms[name].value = v; }
  *all() { for (const l of this.levels) yield* l.stars; if (this.galaxy && this.galaxy.id === 'mw') yield* REAL_STARS; }
  count() { return this.levels.reduce((a, l) => a + l.stars.length, 0); }
}

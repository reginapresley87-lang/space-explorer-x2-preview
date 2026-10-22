// Seamless planet terrain: cube-sphere quadtree LOD streamed from a worker, drawn with the body's own orbital
// material (TERRAIN variant), so a planet looks the same from orbit and on the way down. Original code.
import * as THREE from '../scene/vendor/three.module.min.js?v=20261014b';
import { heightAt, tileIndex } from './terrain_height.js?v=20261014b';

const QSET = { low: { seg: 16, k: 1.15, minSp: 3.5, workers: 1 }, medium: { seg: 24, k: 1.35, minSp: 2.2, workers: 2 }, high: { seg: 32, k: 1.6, minSp: 1.5, workers: 2 }, ultra: { seg: 48, k: 2.1, minSp: 0.9, workers: 3 } };
export const TERRAIN_LAYER = 1;

// ---------- material: the orbital shader + ground detail, slope rock, flat sea, aerial haze ----------
const TERRAIN_VS = `attribute vec3 aObj, aDet; attribute float aSea; uniform float uMPerSu;
varying vec3 vObj, vN, vW, vDet; varying vec2 vUv; varying float vSea, vDistM;
void main(){ vObj = aObj; vUv = vec2(0.); vDet = aDet; vSea = aSea; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
  vDistM = length(w.xyz - cameraPosition) * uMPerSu; gl_Position = projectionMatrix * viewMatrix * w; }`;
const PARS = `
const float uNightGlow = .1;   // night-side moonlight strength
varying vec3 vDet; varying float vSea, vDistM; uniform float uMPerSu, uHazeK, uHazeTau, uHazeH, uCamH, uRm; uniform vec3 uHaze;
float tDet(vec3 p){ return vn(p / 3.1) * .22 + vn(p / 11.) * .3 + vn(p / 47.) * .26 + vn(p / 230.) * .22; }
vec3 terrAlbedo(vec3 col, vec3 N, vec3 up){
  float fd = smoothstep(2500., 20., vDistM), ff = smoothstep(90000., 3000., vDistM);
  float slope = 1. - dot(N, up);
  vec3 rock = col * .62 + vec3(.035);
  col = mix(col, rock, smoothstep(.22, .45, slope) * ff * (1. - step(.5, vSea)));
  return col * mix(1., .6 + .8 * tDet(vDet), fd * .85);
}
vec3 terrBump(vec3 N){
  float fd = smoothstep(600., 5., vDistM); if (fd <= 0.) return N;
  float hb = (vn(vDet / 1.3) * .12 + vn(vDet / 4.7) * .45 + vn(vDet / 19.) * 1.4) * fd / uMPerSu;
  vec3 dpx = dFdx(vW), dpy = dFdy(vW); float dhx = dFdx(hb), dhy = dFdy(hb);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx); float det = dot(dpx, r1); if (abs(det) < 1e-36) return N;
  return normalize(abs(det) * N - sign(det) * (dhx * r1 + dhy * r2));
}
// aerial perspective: optical depth of an exponential atmosphere along the camera->ground segment
vec3 terrHaze(vec3 o){
  if (uHazeK <= 0.) return o;
  float hf = max(length(vW - uPC) * uMPerSu - uRm, 0.), hc = max(uCamH, 0.), dh = hc - hf;
  float a = exp(-hf / uHazeH), b = exp(-hc / uHazeH);
  float od = 2.2 * uHazeTau * vDistM * (abs(dh) > 1. ? (a - b) / dh : a / uHazeH);   // x2.2: blue-weighted in-scatter
  return mix(o, uHaze, (1. - exp(-od)) * uHazeK); }
vec2 terrUv(vec3 p){ float phi = atan(p.z, -p.x) / 6.28318; float uA = fract(phi), uB = fract(phi + .5) - .5;
  float u = fwidth(uA) <= fwidth(uB) + 1e-6 ? uA : uB; return vec2(u, 1. - acos(clamp(p.y, -1., 1.)) / 3.14159); }
`;
function must(src, a, b) { if (!src.includes(a)) throw new Error('[terrain] shader patch failed: ' + a.slice(0, 40)); return src.replace(a, b); }
function terrainFS(src, tex) {
  if (tex) {
    src = must(src, 'void main(){\n  vec3 col = texture2D(uMap, vUv).rgb;', PARS + 'void main(){\n  vec2 tUv = terrUv(normalize(vObj)); vec3 col = texture2D(uMap, tUv).rgb;');
    src = must(src, 'L1 = normalize(uS1 - vW);\n', 'L1 = normalize(uS1 - vW);\n  vec3 tUp = normalize(vW - uPC); float tWater = step(.5, vSea); col = terrAlbedo(col, N, tUp); if (tWater > .5) N = tUp; else N = terrBump(N);\n');
    src = must(src, 'float w = texture2D(uSpec, vUv).r;', 'float w = tWater;');
    src = must(src, 'texture2D(uNight, vUv)', 'texture2D(uNight, tUv)');
    src = must(src, 'if (uHasSpec > 0.) {', 'if (tWater > .5) o += uHaze * uHazeK * (.3 + .7 * pow(1. - max(dot(N, V), 0.), 5.));   // sea: sky reflection\n  if (uHasSpec > 0. || tWater > .5) {');
  } else {
    src = must(src, 'void main(){', PARS + 'void main(){');
    src = must(src, 'land = smoothstep(uSea, uSea + .008, cont);', 'land = smoothstep(uSea, uSea + .008, cont); land = 1. - step(.5, vSea);');
    src = must(src, '  vec3 N = N0;\n  if (relief > 0.) N = bumpN(N0, vW, h * relief * uPRad);',
      '  vec3 tUp = normalize(vW - uPC); col = terrAlbedo(col, N0, tUp);\n  vec3 N = N0; float rk = smoothstep(3000., 300000., vDistM); if (relief > 0. && rk > 0.) N = bumpN(N0, vW, h * relief * uPRad * rk);\n  float tLava = 0.; if (vSea > .5) { N = tUp; N0 = tUp; if (uType > 1.5 && uType < 2.5) tLava = 1.; else water = 1.; } else N = terrBump(N);');
    // lava worlds: molten lakes in the lowlands (smooth, animated, emissive) + red glow bounced onto the crust
    src = must(src, 'o += emis * (uType == 1. ? night : 1.);', `o += emis * (uType == 1. ? night : 1.);
  if (uType > 1.5 && uType < 2.5) {
    float fine = smoothstep(4000., 300., vDistM);
    float ln = vn(vDet / 60. + uTime * .03) * .6 + vn(vDet / 13. - uTime * .05) * .25 * fine + vn(vDet / 300.) * .15 + (1. - fine) * .12;
    float crust = smoothstep(.5, .78, ln) * .9;
    vec3 hot = mix(vec3(1., .22, .02), vec3(1., .62, .22), ln) * (3.5 + .8 * sin(uTime * 1.3 + ln * 8.));
    o = mix(o, hot * (1. - crust) + col * .06 * crust, tLava);
    float near = smoothstep(20000., 0., vDistM);
    float crack = (1. - smoothstep(.015, .05, abs(vn(vDet / 22.) - .5))) * smoothstep(.35, .6, vn(vDet / 140. + 3.)) * smoothstep(6000., 200., vDistM);   // glowing cracks in the crust
    o += (col * vec3(1., .35, .12) * .6 + vec3(.05, .012, .003)) * (1. - tLava) * near;   // red light from the lava lakes / cracks on the crust (day or night)
    o += vec3(1., .3, .05) * 1.6 * crack * (1. - tLava);
  }`);
  }
  const i = src.lastIndexOf('gl_FragColor = vec4(o, 1.);'); if (i < 0) throw new Error('[terrain] no output');
  return src.slice(0, i) + 'gl_FragColor = vec4(terrHaze(o) + (col * .8 + .2) * vec3(.55, .65, 1.) * uNightGlow * (1. - smoothstep(-.3, .05, dot(tUp, L))), 1.);   // + faint cool moonlight on the night side (after the haze)' + src.slice(i + 'gl_FragColor = vec4(o, 1.);'.length);
}
const matCache = new WeakMap();
function terrainMaterial(base, isTex, mPerSu) {
  let m = matCache.get(base); if (m) return m;
  const extra = { uMPerSu: { value: mPerSu }, uHazeK: { value: 0 }, uHazeTau: { value: 0 }, uHazeH: { value: 1e4 }, uCamH: { value: 0 }, uRm: { value: 0 }, uHaze: { value: new THREE.Vector3() }, uPCt: { value: new THREE.Vector3() } };
  m = new THREE.ShaderMaterial({ defines: { ...(base.defines || {}), TERRAIN: 1 }, uniforms: Object.assign({}, base.uniforms, extra),
    vertexShader: TERRAIN_VS, fragmentShader: terrainFS(base.fragmentShader, isTex), side: THREE.DoubleSide });
  m.extensions = { derivatives: true };
  matCache.set(base, m); return m;
}

// ---------- grey maps from loaded textures (macro relief from the albedo, Earth sea mask from the specular map) ----------
const greyCache = new WeakMap();   // img -> {key: map}: the maps only depend on the (cached) texture image, so re-entering a world is free
function greyMap(img, w = 512, h = 256) {
  let e = greyCache.get(img); if (!e) { e = {}; greyCache.set(img, e); }
  const k = w + 'x' + h; if (!e[k]) { const m = greyMap0(img, w, h); if (m) e[k] = m; return m; }
  return e[k];
}
function greyMap0(img, w, h) {
  try {
    const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h); let sum = 0;
    for (let i = 0; i < w * h; i++) { const v = Math.round(px[i * 4] * 0.3 + px[i * 4 + 1] * 0.55 + px[i * 4 + 2] * 0.15); data[i] = v; sum += v; }
    // light blur (3 passes of a box) so texture noise does not become spikes
    const tmp = new Uint8Array(w * h);
    for (let pass = 0; pass < 2; pass++) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -1; k <= 1; k++) s += data[y * w + (x + k + w) % w]; tmp[y * w + x] = s / 3; }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -1; k <= 1; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]; data[y * w + x] = s / 3; } }
    return { w, h, data, mean: sum / (w * h) / 255 };
  } catch (e) { console.warn('[terrain] map read failed', e); return null; }
}
const realImg = t => t && t.image && (t.image.width || 0) > 16 ? t.image : null;

// terrain look per body (relief only; colour comes from the orbital material)
const SOL = { mercury: { craters: 1, ridges: 0.5, lumAmp: 2500 }, venus: { ridges: 0.35, rough: 0.8, lumAmp: 0 }, earth: { ridges: 0.7, ocean: 'tex', lumAmp: 0 },
  moon: { craters: 1, rough: 0.8, ridges: 0.3, lumAmp: 3500 }, mars: { dunes: 0.6, craters: 0.35, ridges: 0.6, lumAmp: 4000 }, io: { ridges: 0.3, lumAmp: 1500 },
  europa: { ridges: 0.15, rough: 0.4, craters: 0.15, lumAmp: 600 }, ganymede: { craters: 0.7, lumAmp: 2000 }, callisto: { craters: 1, lumAmp: 2000 }, titan: { dunes: 0.5, ridges: 0.25, lumAmp: 1500 },
  pluto: { craters: 0.5, lumAmp: 2000 }, charon: { craters: 0.8 } };

let workers = null, nextId = 1; const pending = new Map();
function getWorkers(n) {
  if (workers) return workers;
  workers = [];
  for (let i = 0; i < n; i++) {
    try { const w = new Worker(new URL('./terrain_worker.js?v=20261014b', import.meta.url), { type: 'module' }); w.onmessage = e => { const cb = pending.get(e.data.id); if (cb) { pending.delete(e.data.id); cb(e.data); } }; w.load = 0; workers.push(w); }
    catch (e) { console.warn('[terrain] worker unavailable', e); }
  }
  return workers;
}

// it: system-view item (b, tilt, mesh, r); returns a terrain object or null for bodies without ground
export function createTerrain(it, opts = {}) {
  const b = it.b; if (!b || !b.landable) return null;
  const qs = QSET[opts.quality] || QSET.medium, SEG = qs.seg, R = b.radiusKm * 1000, mPerSu = R / it.r;
  const isTex = !!(it.mesh.material.uniforms && it.mesh.material.uniforms.uMap);
  const key = (it.sysId || '') + '#' + b.key + ':' + Math.random().toString(36).slice(2, 7);
  const base = it.mesh.material, mat = terrainMaterial(base, isTex, mPerSu);
  const P = { R, seed: (b.seed || hashStr(b.key)) % 100000, type: b.type, craters: b.atmo ? 0 : 0.8, dunes: b.type === 'desert' ? 1 : 0, ridges: b.type === 'ice' ? 0.25 : b.type === 'desert' ? 0.4 : 0.6,
    rough: b.type === 'desert' ? 0.7 : 1, octMax: opts.octMax || 7, ocean: null };
  if (b.sol) Object.assign(P, { craters: b.atmo ? 0 : 0.8 }, SOL[b.key] || {});
  else if (b.type === 'ocean') { const u = base.uniforms; Object.assign(P, { ocean: 'proc', seedV: u.uSeed.value.toArray(), sea: u.uSea.value }); }
  else if (b.type === 'lava') Object.assign(P, { ridges: 0.5, ocean: 'lava' });   // lowlands filled with molten lava (flat, glowing)
  const maxLevel = Math.max(4, Math.floor(Math.log2((Math.PI / 2 * R) / (SEG * qs.minSp))));
  const group = new THREE.Group(); group.name = 'terrain:' + b.key; it.tilt.add(group);
  const idx = new THREE.BufferAttribute(new Uint16Array(tileIndex(SEG, true)), 1);
  const tiles = new Map(); let frame = 0, gen = 0, anchor = [0, 0, 0], anchorSet = false, ready = false, disposed = false, inflight = 0, sent = false;
  const W = getWorkers(qs.workers);
  // maps (macro relief / sea mask) are filled in once the textures are loaded; tiles built before that are rebuilt
  let mapsVersion = 0;
  function tryMaps() {
    if (!b.sol) return true;
    const u = base.uniforms, need = P.lumAmp > 0, img = realImg(u.uMap && u.uMap.value);
    if (P.ocean === 'tex' && !P.seaMap) { const s = realImg(u.uSpec && u.uSpec.value); if (s) { P.seaMap = greyMap(s, 1024, 512); mapsVersion++; } else return false; }
    if (need && !P.lum) { if (img) { P.lum = greyMap(img); mapsVersion++; } else return false; }
    return true;
  }
  let mapsOk = tryMaps(), waitFrames = 0;
  const post = () => { for (const w of W) w.postMessage({ type: 'body', key, P }); sent = true; };
  const tkey = (f, l, x, y) => f + '/' + l + '/' + x + '/' + y;
  const dirTmp = [0, 0, 0];
  function request(t) {
    if (t.req || !W.length) return; t.req = true; inflight++;
    const w = W.reduce((a, c) => c.load < a.load ? c : a, W[0]); w.load++;
    const id = nextId++, g = gen, mv = mapsVersion;
    pending.set(id, r => {
      w.load--; inflight--; t.req = false; if (disposed || r.failed) return;
      const geo = new THREE.BufferGeometry(); geo.setIndex(idx);
      geo.setAttribute('position', new THREE.BufferAttribute(r.pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(r.nor, 3));
      geo.setAttribute('aObj', new THREE.BufferAttribute(r.obj, 3)); geo.setAttribute('aDet', new THREE.BufferAttribute(r.det, 3)); geo.setAttribute('aSea', new THREE.BufferAttribute(r.sea, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), r.rad * 1.02);
      const m = new THREE.Mesh(geo, mat); m.position.set(r.C[0] / mPerSu, r.C[1] / mPerSu, r.C[2] / mPerSu); m.scale.setScalar(1 / mPerSu);
      m.layers.set(TERRAIN_LAYER); m.visible = false; m.matrixAutoUpdate = false; m.updateMatrix();
      if (t.mesh) { t.mesh.geometry.dispose(); group.remove(t.mesh); }
      t.mesh = m; t.C = r.C; t.gen = g; t.mv = mv; t.hmin = r.hmin; t.hmax = r.hmax; group.add(m);
    });
    w.postMessage({ type: 'tile', key, id, T: { face: t.f, level: t.l, x: t.x, y: t.y, seg: SEG, anchor } });
  }
  function node(f, l, x, y) {
    const k = tkey(f, l, x, y); let t = tiles.get(k);
    if (!t) {
      const N = 1 << l, s = 2 / N; faceDirJS(f, -1 + (x + 0.5) * s, -1 + (y + 0.5) * s, dirTmp);
      t = { k, f, l, x, y, dir: dirTmp.slice(), size: Math.PI / 2 * R / N, used: 0, mesh: null, req: false, gen: -1, hmin: -9000, hmax: 9000 }; tiles.set(k, t);
    }
    return t;
  }
  const roots = []; for (let f = 0; f < 6; f++) roots.push(node(f, 0, 0, 0));
  const draw = [], want = [];
  let camDist = 0, camDir = [0, 0, 1], horizon = Math.PI, deepest = 0, deepestSpacing = 1e9;
  function visit(t, cx, cy, cz) {
    t.used = frame;
    const ang = Math.acos(Math.max(-1, Math.min(1, t.dir[0] * camDir[0] + t.dir[1] * camDir[1] + t.dir[2] * camDir[2])));
    const angR = t.size / R * 0.75;
    if (t.l > 0 && ang - angR > horizon) return;                 // behind the horizon
    if (!t.mesh) { if (!t.req) { t.prio = 0; want.push(t); } return; }
    if (!t.req && (t.mv !== mapsVersion || (t.gen !== gen && t.near))) { t.prio = 0; want.push(t); }   // rebuild in place (old mesh stays until the new one arrives)
    const rc = R + (t.hmin + t.hmax) / 2, px = t.dir[0] * rc - cx, py = t.dir[1] * rc - cy, pz = t.dir[2] * rc - cz;
    const d = Math.max(0, Math.hypot(px, py, pz) - t.size * 0.5 - (t.hmax - t.hmin) / 2);
    t.near = d < 12000;
    if (t.l < maxLevel && d < t.size * qs.k) {
      const kids = [node(t.f, t.l + 1, t.x * 2, t.y * 2), node(t.f, t.l + 1, t.x * 2 + 1, t.y * 2), node(t.f, t.l + 1, t.x * 2, t.y * 2 + 1), node(t.f, t.l + 1, t.x * 2 + 1, t.y * 2 + 1)];
      if (kids.every(c => c.mesh)) { for (const c of kids) visit(c, cx, cy, cz); return; }
      for (const c of kids) { c.used = frame; if (!c.req && !c.mesh) { c.prio = d; want.push(c); } }
    }
    draw.push(t);
    if (d < 1 && t.l > deepest) { deepest = t.l; deepestSpacing = t.size / SEG; }
  }
  // radius of the drawn mesh along a unit direction (0 if nothing is drawn there)
  function meshR(dx, dy, dz) {
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz); let f, u, v;
    if (ax >= ay && ax >= az) { if (dx > 0) { f = 0; u = -dz / ax; v = dy / ax; } else { f = 1; u = dz / ax; v = dy / ax; } }
    else if (ay >= az) { if (dy > 0) { f = 2; u = dx / ay; v = -dz / ay; } else { f = 3; u = dx / ay; v = dz / ay; } }
    else { if (dz > 0) { f = 4; u = dx / az; v = dy / az; } else { f = 5; u = -dx / az; v = dy / az; } }
    const a = Math.atan(u) * 4 / Math.PI, bb = Math.atan(v) * 4 / Math.PI;
    let best = null;
    for (let l = 0; l <= maxLevel; l++) {
      const N = 1 << l, x = Math.min(N - 1, Math.floor((a + 1) / 2 * N)), y = Math.min(N - 1, Math.floor((bb + 1) / 2 * N)), t = tiles.get(tkey(f, l, x, y));
      if (!t) break; if (t.mesh && t.mesh.visible && t.C) best = t;
    }
    if (!best) return 0;
    api.lastSp = best.size / SEG;   // vertex spacing of the drawn tile here (used for the camera clearance)
    const N = 1 << best.l, size = 2 / N, gx = Math.max(0, Math.min(SEG - 1e-9, ((a + 1) - best.x * size) / size * SEG)), gy = Math.max(0, Math.min(SEG - 1e-9, ((bb + 1) - best.y * size) / size * SEG));
    const j = Math.floor(gx), i = Math.floor(gy), fx = gx - j, fy = gy - i, p = best.mesh.geometry.attributes.position.array, C = best.C;
    const rv = k => Math.hypot(p[k * 3] + C[0], p[k * 3 + 1] + C[1], p[k * 3 + 2] + C[2]), S1 = SEG + 1;
    const r00 = rv(i * S1 + j), r01 = rv(i * S1 + j + 1), r10 = rv((i + 1) * S1 + j), r11 = rv((i + 1) * S1 + j + 1);
    const tw = r00 - r01 - r10 + r11; return r00 + (r01 - r00) * fx + (r10 - r00) * fy + tw * fx * fy + Math.abs(tw) * 0.25;   // bilinear + bound on the triangle-split difference
  }
  const api = {
    it, group, mPerSu, R, P, get ready() { return ready; }, get tileCount() { return draw.length; }, get spacing() { return deepestSpacing; },
    // camera position in the body frame (metres); returns nothing
    update(cx, cy, cz) {
      if (disposed) return; frame++;
      if (!mapsOk && (++waitFrames % 20 === 0 || waitFrames > 600)) { mapsOk = tryMaps() || waitFrames > 600; if (mapsOk && sent) post(); }
      if (!sent && (mapsOk || waitFrames > 600)) post();
      if (!sent) return;
      const D = Math.hypot(cx, cy, cz); camDist = D; camDir = [cx / D, cy / D, cz / D];
      const lo = R - 12000, hi = R + 12000; horizon = (D > lo ? Math.acos(Math.min(1, lo / D)) : 0) + Math.acos(lo / hi);
      // detail-coordinate anchor near the camera (float32 precision for the ground detail)
      const alt = D - R;
      if (alt < 400e3) { const ax = camDir[0] * R, ay = camDir[1] * R, az = camDir[2] * R;
        if (!anchorSet || Math.hypot(ax - anchor[0], ay - anchor[1], az - anchor[2]) > 700e3) { anchor = [Math.round(ax / 1000) * 1000, Math.round(ay / 1000) * 1000, Math.round(az / 1000) * 1000]; anchorSet = true; gen++; } }
      draw.length = 0; want.length = 0; deepest = 0; deepestSpacing = 1e9;
      for (const r of roots) visit(r, cx, cy, cz);
      ready = roots.every(r => r.mesh);
      for (const t of tiles.values()) if (t.mesh) t.mesh.visible = false;
      if (ready) for (const t of draw) t.mesh.visible = true;
      // requests: coarse + near first
      want.sort((p, q) => p.l - q.l || (p.prio || 0) - (q.prio || 0));
      const cap = W.length * 3;
      for (const t of want) { if (inflight >= cap) break; request(t); }
      // evict tiles not visited for a while (never the roots, never anything visited this frame)
      if (tiles.size > 700) for (const [k, t] of tiles) { if (t.l > 0 && frame - t.used > 90 && !t.req) { if (t.mesh) { t.mesh.geometry.dispose(); group.remove(t.mesh); } tiles.delete(k); } }
    },
    heightAt(dx, dy, dz, out) { return heightAt(dx, dy, dz, P, out); },
    // ground radius under a unit direction: the higher of the exact height field and the triangle mesh actually drawn there
    // (coarse tiles still loading can sit above the true surface; the camera must never end up under the visible ground)
    surfaceR(dx, dy, dz) { const h = heightAt(dx, dy, dz, P); return Math.max(R + (P.ocean ? Math.max(h, 0) : h), meshR(dx, dy, dz)); },
    meshR: (dx, dy, dz) => meshR(dx, dy, dz),
    // k: 0..1 fade, tau: vertical optical depth of the whole column, H: scale height (m), camH: camera altitude (m), pc: planet centre (camera-relative, Su)
    setHaze(k, tau, H, camH, col, pc) { const u = mat.uniforms; u.uHazeK.value = k; u.uHazeTau.value = tau; u.uHazeH.value = H; u.uCamH.value = camH; u.uRm.value = R; u.uMPerSu.value = mPerSu; if (col) u.uHaze.value.copy(col); if (pc) u.uPCt.value.copy(pc); },
    dispose() {
      disposed = true; for (const t of tiles.values()) if (t.mesh) t.mesh.geometry.dispose(); tiles.clear(); group.removeFromParent();
      for (const w of W) w.postMessage({ type: 'drop', key }); it.mesh.visible = true; if (it.atmo) { it.atmo.layers.set(0); if (it.atmo.material.side !== THREE.FrontSide) { it.atmo.material.side = THREE.FrontSide; it.atmo.material.needsUpdate = true; } }
    },
  };
  return api;
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function faceDirJS(f, a, b, out) {
  const u = Math.tan(a * Math.PI / 4), v = Math.tan(b * Math.PI / 4); let x, y, z;
  switch (f) { case 0: x = 1; y = v; z = -u; break; case 1: x = -1; y = v; z = u; break; case 2: x = u; y = 1; z = -v; break; case 3: x = u; y = -1; z = v; break; case 4: x = u; y = v; z = 1; break; default: x = -u; y = v; z = -1; }
  const l = Math.hypot(x, y, z); out[0] = x / l; out[1] = y / l; out[2] = z / l; return out;
}

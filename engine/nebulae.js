// Nebulae: real (Orion, Carina, Eagle, Lagoon, Helix) + procedural emission / planetary nebulae in the Milky Way's arms.
// Rendered as ray-marched volumes (emission: H-alpha / O III, absorption: dust) in the star-field pass (ly units).
import * as THREE from '../scene/vendor/three.module.min.js';
import { NOISE } from './shaders.js';
import { hash, rng, galDir, word, clamp } from './util.js';
import { SOL_GPOS, densityAt } from './universe.js';

const at = (l, b, d) => new THREE.Vector3(...galDir(l, b)).multiplyScalar(d).add(SOL_GPOS);
export const REAL_NEBULAE = [
  { id: 'neb:orion', name: 'Orion Nebula', type: 'emission', gpos: at(209.01, -19.38, 1344), R: 12, seed: 42, fact: 'M42: the nearest large star-forming region, 1,344 light-years away, lit by the young Trapezium stars.' },
  { id: 'neb:carina', name: 'Carina Nebula', type: 'emission', gpos: at(287.6, -0.63, 7500), R: 115, seed: 77, fact: 'One of the largest emission nebulae in the sky, home of the hypergiant Eta Carinae.' },
  { id: 'neb:eagle', name: 'Eagle Nebula', type: 'emission', gpos: at(16.95, 0.79, 5700), R: 35, seed: 16, fact: 'M16, famous for the "Pillars of Creation" – columns of dust and gas where stars are forming.' },
  { id: 'neb:lagoon', name: 'Lagoon Nebula', type: 'emission', gpos: at(6.0, -1.2, 4100), R: 55, seed: 8, fact: 'M8: a giant interstellar cloud in Sagittarius with a dark "lagoon" lane across it.' },
  { id: 'neb:helix', name: 'Helix Nebula', type: 'planetary', gpos: at(36.16, -57.12, 655), R: 1.4, seed: 7293, fact: 'A planetary nebula: the expelled outer layers of a dying Sun-like star, 655 light-years away.' },
].map(n => ({ ...n, real: true, rot: rotFor(n.seed) }));
function rotFor(seed) { const r = rng(hash(seed, 'rot')); return new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6.28, r() * 6.28, r() * 6.28)); }

export const NEB_SECTOR = 3000;
const cache = new Map();
export function nebulaSector(g, seed, sx, sy, sz) {
  const key = `${g.id}|${sx}|${sy}|${sz}`; let s = cache.get(key); if (s) return s;
  const r = rng(hash(seed, 'neb', g.id, sx, sy, sz)), out = [];
  if (g.type === 'spiral' || g.type === 'barred') {
    const c = new THREE.Vector3(sx + 0.5, sy + 0.5, sz + 0.5).multiplyScalar(NEB_SECTOR);
    const dens = Math.abs(c.y) < NEB_SECTOR ? densityAt(g, c.x, 0, c.z) : 0;
    const n = r() < clamp(dens * 0.35, 0, 0.85) ? (r() < 0.3 ? 2 : 1) : 0;
    for (let i = 0; i < n; i++) {
      const planetary = r() < 0.18;
      const p = new THREE.Vector3(sx + r(), 0, sz + r()).multiplyScalar(NEB_SECTOR); p.y = r.gauss() * (planetary ? 400 : 120);
      if (Math.floor(p.y / NEB_SECTOR) !== sy) continue;
      if (p.distanceTo(SOL_GPOS) < 300) continue;
      const ns = hash(seed, 'nebs', g.id, sx, sy, sz, i), nr = rng(ns);
      const w = word(nr); const name = w[0].toUpperCase() + w.slice(1) + (planetary ? ' Planetary Nebula' : ' Nebula');
      out.push({ id: `${g.id}/n:${sx}:${sy}:${sz}:${i}`, name, type: planetary ? 'planetary' : 'emission', gpos: p, R: planetary ? r.range(0.4, 2) : r.range(14, 90), seed: ns % 100000, rot: rotFor(ns), galId: g.id });
    }
  }
  s = { key, nebulae: out }; cache.set(key, s); if (cache.size > 3000) cache.delete(cache.keys().next().value); return s;
}
export function nebulaById(g, seed, id) {
  const real = REAL_NEBULAE.find(n => n.id === id); if (real) return real;
  const m = /\/n:(-?\d+):(-?\d+):(-?\d+):(\d+)$/.exec(id); if (!m || !g) return null;
  return nebulaSector(g, seed, +m[1], +m[2], +m[3]).nebulae.find(n => n.id === id) || null;
}
export function nebulaeNear(g, seed, camG, rad = 2) {
  if (!g) return [];
  const out = g.id === 'mw' ? [...REAL_NEBULAE] : [];
  const cx = Math.floor(camG.x / NEB_SECTOR), cy = Math.floor(camG.y / NEB_SECTOR), cz = Math.floor(camG.z / NEB_SECTOR);
  for (let i = -rad; i <= rad; i++) for (let j = -1; j <= 1; j++) for (let k = -rad; k <= rad; k++) out.push(...nebulaSector(g, seed, cx + i, cy + j, cz + k).nebulae);
  return out;
}

const NEB_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const NEB_FS = NOISE + `
#ifndef NEB_N
#define NEB_N 24
#endif
uniform vec3 uC, uSeed; uniform mat3 uRot; uniform float uRad, uI, uType, uOct; varying vec3 vW;
vec2 rs(vec3 o, vec3 d){ float b = dot(o, d), c = dot(o, o) - 1., h = b * b - c; if (h < 0.) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h); }
void main(){
  vec3 o = uRot * ((cameraPosition - uC) / uRad), d = normalize(uRot * normalize(vW - cameraPosition));
  vec2 t = rs(o, d); if (t.y < 0.) discard; float t0 = max(t.x, 0.), ds = (t.y - t0) / float(NEB_N);
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 L = vec3(0.); float T = 1.;
  for (int i = 0; i < NEB_N; i++) {
    vec3 p = o + d * (t0 + (float(i) + jit) * ds); float r = length(p);
    vec3 w = vec3(fbmN(p * 1.7 + uSeed, 3.), fbmN(p * 1.7 + uSeed + 5.2, 3.), fbmN(p * 1.7 + uSeed + 9.7, 3.)) - .5;
    vec3 q = p + w * .95;
    float dens, dust; vec3 em;
    if (uType < .5) {     // emission: a cavity blown by the central cluster, bright rims, dark pillars
      float n = fbmN(q * 2.3 + uSeed, uOct);
      dens = smoothstep(.38, .72, n) * smoothstep(1., .55, r) * (.35 + smoothstep(.15, .6, r));
      dust = smoothstep(.55, .8, fbmN(q * 3.4 + uSeed + 7., uOct)) * smoothstep(1., .45, r) * 1.6;
      em = mix(vec3(.25, .9, .85), vec3(1., .16, .28), smoothstep(.15, .55, r + (n - .5) * .3)) * dens;
      em += vec3(.4, .55, 1.) * .25 * exp(-r * r * 9.);   // reflection glow around the young stars
    } else {              // planetary: a thin, knotty shell
      float n = fbmN(q * 4. + uSeed, uOct);
      dens = exp(-pow((r - .62 + (n - .5) * .2) / .12, 2.)) * (.5 + n);
      dust = 0.;
      em = mix(vec3(.25, .85, .9), vec3(1., .2, .3), smoothstep(.5, .75, r)) * dens + vec3(.3, .7, 1.) * exp(-r * r * 30.) * .4;
    }
    L += em * T * ds; T *= exp(-(dust * 2.2 + dens * .25) * ds);
    if (T < .02) break;
  }
  gl_FragColor = vec4(L * uI, T);
}`;
export class NebulaField {
  constructor(quality = 'medium') {
    this.group = new THREE.Group(); this.pool = []; this.geo = new THREE.SphereGeometry(1, 24, 16); this.setQuality(quality);
  }
  setQuality(q) { this.q = q; for (const m of this.pool) { m.material.dispose(); m.removeFromParent(); } this.pool = []; }
  mk() {
    const q = this.q;
    const mat = new THREE.ShaderMaterial({ defines: { NEB_N: q === 'high' ? 40 : q === 'medium' ? 22 : 12, OCT_MAX: 5 }, side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      uniforms: { uC: { value: new THREE.Vector3() }, uSeed: { value: new THREE.Vector3() }, uRot: { value: new THREE.Matrix3() }, uRad: { value: 1 }, uI: { value: 0.05 }, uType: { value: 0 }, uOct: { value: q === 'high' ? 5 : q === 'medium' ? 4 : 3 } },
      vertexShader: NEB_VS, fragmentShader: NEB_FS });
    const m = new THREE.Mesh(this.geo, mat); m.frustumCulled = false; m.renderOrder = 5; this.group.add(m); this.pool.push(m); return m;
  }
  // list: nebulae to consider; camG: camera (galaxy ly); q: galaxy orientation; viewH: px; focal
  update(list, camG, q, focal) {
    const vis = [];
    for (const n of list) { const d = n.gpos.distanceTo(camG), ang = n.R / Math.max(d, 1e-6); const px = ang * focal; if (px > 3 && d < 40000) vis.push({ n, d, px }); }
    vis.sort((a, b) => b.px - a.px); vis.length = Math.min(vis.length, 10);
    while (this.pool.length < vis.length) this.mk();
    const m4 = new THREE.Matrix4();
    this.pool.forEach((m, i) => {
      const v = vis[i]; m.visible = !!v; if (!v) return;
      const u = m.material.uniforms, n = v.n;
      m.position.copy(n.gpos).sub(camG).applyQuaternion(q); m.scale.setScalar(n.R); m.updateMatrixWorld();
      u.uC.value.copy(m.position); u.uRad.value = n.R; u.uType.value = n.type === 'planetary' ? 1 : 0;
      u.uSeed.value.set(n.seed % 97 * 0.37, n.seed % 89 * 0.21, n.seed % 83 * 0.53);
      u.uRot.value.setFromMatrix4(m4.makeRotationFromQuaternion(q.clone().multiply(n.rot).invert()));
      u.uI.value = (n.type === 'planetary' ? 2.5 : 0.55) * clamp((v.px - 3) / 20, 0, 1) * (n.real ? 1.4 : 1);
    });
  }
}

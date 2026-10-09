// Universe (galaxy impostors + cosmic web), galaxy particle clouds (layered sprites) and the in-galaxy sky
// (ray-marched from the same analytic star + dust density the star streamer uses). Linear HDR output.
import * as THREE from '../scene/vendor/three.module.min.js';
import { NOISE } from './shaders.js';
import { REAL_GALAXIES, universeSector, farSector, U_SECTOR, U_FAR, galaxyParticles } from './universe.js';

const TYPE_N = { spiral: 0, barred: 1, elliptical: 2, irregular: 3 };
const MLY = 1e6;
const toLin = c => c.map(v => Math.pow(v, 2.2));

// face-on look of a disk galaxy (uv in units of R): yellow bulge, blue arms with knots, pink HII regions, dust lanes
export const GALAXY_LOOK = `
vec3 galaxyLook(vec2 uv, float type, float seed, vec3 armCol, vec3 coreCol, out float alpha){
  float r = length(uv), th = atan(uv.y, uv.x);
  float arms = 2. + floor(fract(seed * 7.13) * 2.), pitch = .22 + fract(seed * 3.7) * .3;
  float n1 = fbm(vec3(uv * 7., seed * 9.)), n2 = vn(vec3(uv * 28., seed * 5.));
  float ph = arms * (th - log(r + .02) / pitch) + seed * 6.28 + (n1 - .5) * 2.4;   // noisy phase: ragged, branching arms
  float s = cos(ph) * .5 + .5, sd = cos(ph + .55 + (n2 - .5) * .8) * .5 + .5;
  float disk = exp(-r * 4.2) * smoothstep(1.05, .55, r);
  float bulge = exp(-pow(r / .05, .9)) * 1.1 + exp(-r * 14.) * .3;
  float bar = type > .5 ? exp(-pow(uv.x * 3.4, 2.) - pow(uv.y * 15., 2.)) * .9 : 0.;
  float armM = pow(s, 2.2) * smoothstep(.04, .18, r) * (.55 + .9 * smoothstep(.3, .7, n1));
  float knots = armM * smoothstep(.55, .9, n2) * 1.4;
  float hii = armM * pow(max(vn(vec3(uv * 55., seed * 3.)), 0.), 9.) * 18.;
  float dust = pow(sd, 6.) * smoothstep(.06, .2, r) * smoothstep(1., .5, r) * (.55 + .7 * n1);
  vec3 c = coreCol * (bulge + bar) * 1.3 + mix(coreCol * .7 + .15, armCol, .65) * disk * (.35 + .9 * armM * (.6 + .6 * n1)) + armCol * disk * knots + vec3(1., .3, .55) * disk * hii;
  c *= 1. - clamp(dust * .85, 0., .9) * (1. - smoothstep(.0, .08, bulge * .1));
  alpha = clamp(disk * 4. + bulge, 0., 1.);
  return c;
}`;

export class UniverseView {
  constructor(seed) {
    this.seed = seed; this.group = new THREE.Group(); this.center = null; this.galaxies = [...REAL_GALAXIES]; this.origin = new THREE.Vector3();
    const CAP = 6000; this.cap = CAP;
    const base = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.setAttribute('position', base.attributes.position);
    const A = (n, k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(CAP * k), k); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.att = { pos: A('iPos', 3), e1: A('iE1', 3), e2: A('iE2', 3), r: A('iR', 1), type: A('iType', 1), col: A('iCol', 3), core: A('iCore', 3), seed: A('iSeed', 1), alpha: A('iAlpha', 1) };
    g.instanceCount = 0; this.geo = g;
    this.mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uFar: { value: 2.6e7 / MLY }, uGain: { value: 0.5 } },
      vertexShader: `attribute vec3 iPos, iE1, iE2, iCol, iCore; attribute float iR, iType, iSeed, iAlpha; uniform float uFar;
        varying vec2 vUv; varying vec3 vCol, vCore; varying float vType, vSeed, vA;
        void main(){
          vec4 mvc = modelViewMatrix * vec4(iPos, 1.); float d = length(mvc.xyz);
          vec4 mv;
          if (iType > 1.5 && iType < 2.5) { mv = mvc; mv.xy += position.xy * iR * 1.1; }
          else mv = modelViewMatrix * vec4(iPos + (iE1 * position.x + iE2 * position.y) * iR * 1.15, 1.);
          gl_Position = projectionMatrix * mv;
          vUv = position.xy * 1.15; vCol = pow(iCol, vec3(2.2)); vCore = pow(iCore, vec3(2.2)); vType = iType; vSeed = iSeed;
          float px = iR / d * projectionMatrix[1][1] * 400.;
          vA = iAlpha * smoothstep(uFar, uFar * .75, d) * clamp(px / 3., 0., 1.) * smoothstep(0., iR * .8, d);
        }`,
      fragmentShader: NOISE + GALAXY_LOOK + `uniform float uGain; varying vec2 vUv; varying vec3 vCol, vCore; varying float vType, vSeed, vA;
        void main(){
          float r = length(vUv); if (r > 1.15 || vA < .002) discard;
          vec3 c; float al;
          if (vType < 1.5) c = galaxyLook(vUv, vType, vSeed, vCol, vCore, al);
          else if (vType < 2.5) { float I = exp(-7.67 * (pow(r / .18, .25) - 1.)) * .02 * smoothstep(1.1, .4, r); c = vCore * min(I, 3.); }
          else { float n = fbm(vec3(vUv * 3., vSeed * 3.)), k = vn(vec3(vUv * 20., vSeed));
            c = (vCol * smoothstep(.45, .75, n) * exp(-r * 2.5) * 1.3 + vec3(1., .35, .6) * pow(k, 8.) * smoothstep(.5, .7, n) * 3.) * smoothstep(1.1, .6, r); }
          gl_FragColor = vec4(c * vA * uGain, 1.);
        }` });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.group.add(this.mesh);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 3 + 40000 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(CAP * 3 + 40000 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('rad', new THREE.BufferAttribute(new Float32Array(CAP + 40000), 1).setUsage(THREE.DynamicDrawUsage));
    pg.setDrawRange(0, 0); this.pgeo = pg;
    this.pmat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPR: { value: 1 }, uWeb: { value: 1 }, uHide: { value: new THREE.Vector3(1e9, 0, 0) }, uHide2: { value: new THREE.Vector3(1e9, 0, 0) } },
      vertexShader: `attribute vec3 color; attribute float rad; uniform float uPR, uWeb; uniform vec3 uHide, uHide2; varying vec3 vC; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); float d = length(mv.xyz);
          float px = rad / d * projectionMatrix[1][1] * 400.;
          vA = (rad > 0. ? clamp(1.5 - px / 3., 0., 1.) * clamp(px * 6., .15, 1.) : smoothstep(15., 40., d) * .9 * uWeb) * smoothstep(3000., 1500., d);
          if (distance(position, uHide) < 1e-4 || distance(position, uHide2) < 1e-4) vA = 0.;
          vC = pow(color, vec3(2.2)) * .6; gl_Position = projectionMatrix * mv; gl_PointSize = (rad > 0. ? 2. : 2.6) * uPR; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord - .5) * 2.; if (r > 1.) discard; gl_FragColor = vec4(vC * vA * (1. - r * r), 1.); }` });
    this.points = new THREE.Points(pg, this.pmat); this.points.frustumCulled = false; this.group.add(this.points);
    this.far = [];
  }
  update(camUni) {
    const cx = Math.floor(camUni.x / U_SECTOR), cy = Math.floor(camUni.y / U_SECTOR), cz = Math.floor(camUni.z / U_SECTOR);
    const fx = Math.floor(camUni.x / U_FAR), fy = Math.floor(camUni.y / U_FAR), fz = Math.floor(camUni.z / U_FAR);
    const key = `${cx}|${cy}|${cz}|${fx}|${fy}|${fz}`;
    if (key === this.center) return false;
    this.center = key;
    this.origin.set((cx + 0.5) * U_SECTOR, (cy + 0.5) * U_SECTOR, (cz + 0.5) * U_SECTOR);
    const list = [...REAL_GALAXIES];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) list.push(...universeSector(this.seed, cx + i, cy + j, cz + k).galaxies);
    this.galaxies = list.slice(0, this.cap);
    const a = this.att, o = this.origin, e = new THREE.Vector3();
    this.index = new Map();
    this.galaxies.forEach((g, n) => {
      this.index.set(g.id, n);
      a.pos.setXYZ(n, (g.center.x - o.x) / MLY, (g.center.y - o.y) / MLY, (g.center.z - o.z) / MLY);
      e.set(1, 0, 0).applyQuaternion(g.q); a.e1.setXYZ(n, e.x, e.y, e.z);
      e.set(0, 0, 1).applyQuaternion(g.q); a.e2.setXYZ(n, e.x, e.y, e.z);
      a.r.setX(n, g.R / MLY); a.type.setX(n, TYPE_N[g.type]); a.col.setXYZ(n, ...g.armCol); a.core.setXYZ(n, ...g.coreCol);
      a.seed.setX(n, (g.seed % 1000) / 1000); a.alpha.setX(n, g.type === 'elliptical' ? 0.9 : 1);
    });
    for (const k in a) a[k].needsUpdate = true;
    this.geo.instanceCount = this.galaxies.length;
    const P = this.pgeo.attributes.position, C = this.pgeo.attributes.color, R = this.pgeo.attributes.rad;
    let n = 0;
    for (const g of this.galaxies) { P.setXYZ(n, (g.center.x - o.x) / MLY, (g.center.y - o.y) / MLY, (g.center.z - o.z) / MLY); C.setXYZ(n, ...g.coreCol.map(v => v * 0.8)); R.setX(n, g.R / MLY); n++; }
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) for (const p of farSector(this.seed, fx + i, fy + j, fz + k)) {
      if (n >= P.count) break;
      P.setXYZ(n, (p.x - o.x) / MLY, (p.y - o.y) / MLY, (p.z - o.z) / MLY); const t = (Math.abs(p.x * 7 + p.y) % 1000) / 1000; C.setXYZ(n, 0.8 + t * 0.2, 0.85, 1 - t * 0.25); R.setX(n, 0); n++;
    }
    this.pgeo.setDrawRange(0, n); P.needsUpdate = C.needsUpdate = R.needsUpdate = true;
    return true;
  }
  setAlpha(id, a) {
    const n = this.index && this.index.get(id); if (n == null) return;
    const g = this.galaxies[n], v = (g.type === 'elliptical' ? 0.9 : 1) * a;
    if (Math.abs(this.att.alpha.getX(n) - v) > 1e-3) { this.att.alpha.setX(n, v); this.att.alpha.needsUpdate = true; }
  }
  place(camUni) { this.group.position.copy(this.origin).sub(camUni).divideScalar(MLY); }
  hideDots(ids) {
    const hs = [this.pmat.uniforms.uHide.value, this.pmat.uniforms.uHide2.value];
    hs.forEach(h => h.set(1e9, 0, 0));
    ids.slice(0, 2).forEach((id, i) => { const n = this.index && this.index.get(id); if (n != null) { const g = this.galaxies[n]; hs[i].copy(g.center).sub(this.origin).divideScalar(MLY); } });
  }
}

// ---------- galaxy particle cloud (kly units): diffuse glow sprites + stars + dust + HII knots + face-on impostor ----------
const CLOUD_VS = `attribute vec3 color; attribute float size; uniform float uViewH, uNear0, uNear1, uAlpha, uMaxPx, uSizeK; varying vec3 vC; varying float vA;
  void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); float d = max(-mv.z, 1e-5);
    float px = size * uSizeK * projectionMatrix[1][1] * .5 * uViewH / d;
    float a = uAlpha * smoothstep(uNear0, uNear1, length(mv.xyz));
    if (px < 1.5) { a *= px * px / 2.25; px = 1.5; }
    if (px > uMaxPx) { a *= uMaxPx / px; px = uMaxPx; }
    gl_PointSize = px; vC = color; vA = a; gl_Position = projectionMatrix * mv; if (a < .002) gl_Position = vec4(2., 2., 2., 1.); }`;
export function createGalaxyCloud(g, N) {
  const d = galaxyParticles(g, N);
  const group = new THREE.Group();
  const U = () => ({ uSizeK: { value: 1 }, uGain: { value: 0.22 }, uViewH: { value: 800 }, uNear0: { value: 0 }, uNear1: { value: 1e-4 }, uAlpha: { value: 1 }, uMaxPx: { value: 64 } });
  const mats = [];
  const mk = (pos, col, size, kind, order) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    if (col) {   // linearise + boost saturation (population colours: blue young arms, yellow old bulge, pink HII)
      const lc = new Float32Array(col.length);
      for (let i = 0; i < col.length; i += 3) { const r = Math.pow(col[i], 2.2), g = Math.pow(col[i + 1], 2.2), b = Math.pow(col[i + 2], 2.2), l = r * 0.2126 + g * 0.7152 + b * 0.0722;
        lc[i] = Math.max(0, l + (r - l) * 1.9); lc[i + 1] = Math.max(0, l + (g - l) * 1.9); lc[i + 2] = Math.max(0, l + (b - l) * 1.9); }
      geo.setAttribute('color', new THREE.BufferAttribute(lc, 3)); }
    const dust = kind === 'dust';
    const mat = new THREE.ShaderMaterial({ uniforms: U(), transparent: true, depthWrite: false, depthTest: false,
      blending: dust ? THREE.NormalBlending : THREE.AdditiveBlending,
      vertexShader: dust ? CLOUD_VS.replace('attribute vec3 color;', '').replace('vC = color;', 'vC = vec3(0.);') : CLOUD_VS,
      fragmentShader: dust ? `varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord - .5) * 2.; if (r > 1.) discard; gl_FragColor = vec4(.012, .008, .006, vA * .11 * (1. - r * r) * (1. - r * r)); }`
        : kind === 'glow' ? `uniform float uGain; varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord - .5) * 2.; if (r > 1.) discard; float f = exp(-r * r * 3.) * (1. - r * r); gl_FragColor = vec4(vC * f * vA * uGain * .25, 1.); }`
        : `uniform float uGain; varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord - .5) * 2.; if (r > 1.) discard; float f = exp(-r * r * 4.) * (1. - r); gl_FragColor = vec4(vC * f * vA * uGain, 1.); }` });
    const p = new THREE.Points(geo, mat); p.frustumCulled = false; p.renderOrder = order; group.add(p); mats.push(mat); return p;
  };
  // split: first 12% of particles become large soft "glow" sprites (unresolved starlight), the rest stars
  const ng = Math.floor(N * 0.12);
  const gsize = d.size.slice(0, ng).map(s => s * 3.2);
  const glow = mk(d.pos.slice(0, ng * 3), d.col.slice(0, ng * 3), gsize, 'glow', 1);
  const stars = mk(d.pos.slice(ng * 3), d.col.slice(ng * 3), d.size.slice(ng), 'stars', 2);
  // dust: spread each absorbing sprite off its lane and make it larger + fainter, so lanes read as soft dark clouds
  // rather than thin black spiral lines
  let dust = null;
  if (d.dsize.length) {
    const n = d.dsize.length, dp = new Float32Array(n * 3), ds = new Float32Array(n);
    let h = (g.seed | 0) * 2654435761 >>> 0; const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(6.2831853 * rnd());
    for (let i = 0; i < n; i++) { const s = d.dsize[i]; ds[i] = s * 2.6;
      dp[i * 3] = d.dpos[i * 3] + gauss() * s * 0.9; dp[i * 3 + 1] = d.dpos[i * 3 + 1] + gauss() * s * 0.12; dp[i * 3 + 2] = d.dpos[i * 3 + 2] + gauss() * s * 0.9; }
    dust = mk(dp, null, ds, 'dust', 3);
  }
  // face-on impostor plane for disk galaxies (smooth unresolved light under the particles)
  let imp = null;
  if (g.type === 'spiral' || g.type === 'barred') {
    const R = g.R / 1000;
    const im = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uAlpha: { value: 1 }, uSeed: { value: (g.seed % 1000) / 1000 }, uType: { value: TYPE_N[g.type] }, uArm: { value: new THREE.Vector3(...toLin(g.armCol)) }, uCore: { value: new THREE.Vector3(...toLin(g.coreCol)) }, uGain: { value: 0.08 }, uEdge: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: NOISE + GALAXY_LOOK + `uniform float uAlpha, uSeed, uType, uGain, uEdge; uniform vec3 uArm, uCore; varying vec2 vUv;
        void main(){ float al; vec3 c = galaxyLook(vUv, uType, uSeed, uArm, uCore, al); if (length(vUv) > 1.1) discard; gl_FragColor = vec4(c * uAlpha * uGain * uEdge * 1.8, 1.); }` });
    imp = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), im); imp.geometry.rotateX(-Math.PI / 2); imp.scale.setScalar(R); imp.renderOrder = 0; group.add(imp);
    // the impostor's spiral phase is procedural; align roughly with the particle arms
    imp.rotation.y = -(g.armPhase || 0); mats.push(im);
  }
  return {
    g, group, count: N + (d.dsize.length || 0), imp,
    set(name, v) { for (const m of mats) if (m.uniforms[name]) m.uniforms[name].value = v; },
    dispose() { group.removeFromParent(); for (const o of [glow, stars, dust, imp]) if (o) { o.geometry.dispose(); o.material.dispose(); } },
  };
}

// ---------- in-galaxy sky: ray-march the analytic galaxy (stars = emission, dust = absorption) into a cube map ----------
// Shares the density model with universe.js densityRaw (exponential disk, log-spiral arms, bulge, bar).
const SKY_FS = NOISE + `
#ifndef SKY_N
#define SKY_N 48
#endif
uniform vec3 uCam; uniform mat3 uQi; uniform float uR, uHr, uHz, uRb, uBar, uPhase, uTanP, uArms, uGain, uDustK, uOct;
varying vec3 vD;
float armProx(float rr, float th, float sh){ float n = uArms, step = 6.2831853 / n;
  float ta = uPhase + log(max(rr, uR * .04) / (uR * .1)) / uTanP + sh; float d = mod(th - ta, step); if (d > step * .5) d -= step;
  float w = uR * .035 + rr * .07, l = d * rr; return exp(-(l * l) / (w * w)); }
void main(){
  vec3 d = normalize(uQi * normalize(vD)); vec3 L = vec3(0.); float tau = 0.;
  float t0 = 120., t1 = uR * 2.4, k = log(t1 / t0);
  float jit = fract(sin(dot(vD.xy + vD.z, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i < SKY_N; i++) {
    float a = t0 * exp(k * (float(i) + jit) / float(SKY_N)), b = t0 * exp(k * (float(i) + 1. + jit) / float(SKY_N)), ds = b - a;
    vec3 x = uCam + d * a; float rr = length(x.xz), th = atan(x.z, x.x), ay = abs(x.y);
    if (rr > uR * 1.4 && ay > uHz * 6.) continue;
    float prox = armProx(rr, th, 0.), dprox = armProx(rr, th, -.12);
    float disk = exp(-rr / uHr) * exp(-ay / uHz) * (rr < uR * 1.05 ? 1. : exp(-(rr - uR * 1.05) / (uR * .05)));
    float r3 = rr * rr + x.y * x.y * 2.5;
    float bulge = 2.2 * exp(-r3 / (uRb * uRb));
    float bar = 0.; if (uBar > 0.) { float c = cos(uPhase), s = sin(uPhase), bx = x.x * c + x.z * s, bz = -x.x * s + x.z * c; bar = 1.2 * exp(-(bx * bx) / (uBar * uBar) - (bz * bz + x.y * x.y * 4.) / (uBar * uBar * .08)); }
    float clump = .55 + .9 * vn(x / 420.);
    vec3 j = disk * (vec3(1., .93, .85) * .35 + vec3(.75, .85, 1.) * 1.3 * prox) * clump + (bulge + bar) * vec3(1., .78, .52);
    j += vec3(1., .3, .5) * disk * prox * pow(vn(x / 160. + 7.), 6.) * 3.;      // HII regions along the arms
    float dn = exp(-rr / (uHr * 1.3)) * exp(-ay / (uHz * .3)) * (.25 + 1.4 * dprox);
    dn *= smoothstep(.25, .75, fbmN(x / 900., uOct)) * 1.6 + .15;
    L += j * exp(-tau) * ds; tau += dn * ds * uDustK;
    if (tau > 9.) break;
  }
  gl_FragColor = vec4(L * uGain, 1.);
}`;
export function createGalaxySky(renderer, size, useHalf, quality) {
  const type = useHalf ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const rts = [new THREE.WebGLCubeRenderTarget(size, { type }), new THREE.WebGLCubeRenderTarget(size, { type })];
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthTest: false, depthWrite: false, defines: { SKY_N: quality === 'high' ? 80 : quality === 'medium' ? 56 : 36, OCT_MAX: 6 },
    uniforms: { uCam: { value: new THREE.Vector3() }, uQi: { value: new THREE.Matrix3() }, uR: { value: 1 }, uHr: { value: 1 }, uHz: { value: 1 }, uRb: { value: 1 }, uBar: { value: 0 }, uPhase: { value: 0 },
      uTanP: { value: 1 }, uArms: { value: 4 }, uGain: { value: 2.2e-5 }, uDustK: { value: 7e-4 }, uOct: { value: quality === 'low' ? 3 : quality === 'medium' ? 4 : 6 } },
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`, fragmentShader: SKY_FS });
  const scene = new THREE.Scene(); const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat); box.frustumCulled = false; scene.add(box);
  // the six cube cameras (WebGL convention, as THREE.CubeCamera)
  const cc = new THREE.CubeCamera(0.1, 10, rts[0]); cc.coordinateSystem = renderer.coordinateSystem; cc.updateCoordinateSystem(); cc.updateMatrixWorld(true);
  const cams = cc.children;
  let front = 0, face = -1, job = null;
  const sky = {
    texture: () => rts[front].texture, ready: false, busy: () => face >= 0,
    // start a refresh (rendered one face per frame into the back buffer, then swapped)
    request(g, camGal) {
      const u = mat.uniforms; u.uCam.value.copy(camGal); u.uQi.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(g.qi));
      u.uR.value = g.R; u.uHr.value = g.hr; u.uHz.value = g.hz; u.uRb.value = g.rb; u.uBar.value = g.bar || 0; u.uPhase.value = g.armPhase; u.uTanP.value = Math.tan(g.pitch); u.uArms.value = g.arms;
      job = { g, at: camGal.clone() }; face = 0;
    },
    step(all = false) {
      if (face < 0) return false;
      const prevAuto = renderer.autoClear; renderer.autoClear = true;
      do { renderer.setRenderTarget(rts[1 - front], face); renderer.render(scene, cams[face]); face++; } while (all && face < 6);
      renderer.autoClear = prevAuto; renderer.setRenderTarget(null);
      if (face >= 6) { face = -1; front = 1 - front; sky.ready = true; sky.at = job.at; sky.g = job.g; return true; }
      return false;
    },
    dispose() { rts.forEach(r => r.dispose()); mat.dispose(); },
  };
  return sky;
}

// sky box showing a cube texture (used while inside a galaxy)
export function createSkyBox(cubeTex) {
  const m = new THREE.ShaderMaterial({ uniforms: { uMap: { value: cubeTex }, uAlpha: { value: 1 }, uLin: { value: 0 } }, side: THREE.BackSide, depthWrite: false, depthTest: false, transparent: true, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vD; void main(){ vD = (modelMatrix * vec4(position, 0.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.)).xyz, 1.); }`,
    fragmentShader: `uniform samplerCube uMap; uniform float uAlpha; varying vec3 vD; void main(){ gl_FragColor = vec4(textureCube(uMap, normalize(vD)).rgb * uAlpha, 1.); }` });
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), m); box.frustumCulled = false; return box;
}

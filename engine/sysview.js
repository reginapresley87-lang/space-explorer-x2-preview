// Renders one star system. Bodies are positioned camera-relative in double precision (JS) every frame so the same
// code works for the compressed layout and for true scale. Everything outputs linear HDR (see engine/post.js).
import * as THREE from '../scene/vendor/three.module.min.js?v=20261014b';
import { bodyTexture, ringTexture, glowTexture } from '../scene/textures.js?v=20261014b';
import { PLANET_VS, PLANET_FS, TEX_VS, TEX_FS, CLOUD_FS, ATMO_VS, ATMO_FS, STAR_VS, STAR_FS, CORONA_VS, CORONA_FS, RING_VS, RING_FS, DISK_VS, DISK_FS } from './shaders.js?v=20261014b';
import { bodyPosition } from './sysgen.js?v=20261014b';

const TYPE_ID = { rocky: 0, ocean: 1, lava: 2, ice: 3, desert: 4, gas: 5, icegiant: 5 };
const LOD = [new THREE.SphereGeometry(1, 14, 10), new THREE.SphereGeometry(1, 32, 22), new THREE.SphereGeometry(1, 64, 44), new THREE.SphereGeometry(1, 128, 88)];
const D2R = Math.PI / 180; export const SPIN = 0.02;
export const QDEF = {
  low: { OCT_MAX: 5, ATMO_NV: 6, ATMO_NL: 2 },
  medium: { OCT_MAX: 7, ATMO_NV: 10, ATMO_NL: 3, CRATERS: 1, CLOUD_SHADOW: 1 },
  high: { OCT_MAX: 8, ATMO_NV: 16, ATMO_NL: 4, CRATERS: 1, CLOUD_SHADOW: 1 },
  ultra: { OCT_MAX: 9, ATMO_NV: 24, ATMO_NL: 6, CRATERS: 1, CLOUD_SHADOW: 1 },
};
let GLOW_SOFT = null;
const REAL_TEX = { mercury: 'mercury_2k.jpg', venus: 'venus_atmosphere_2k.jpg', earth: 'earth_day_2k.jpg', moon: 'moon_2k.jpg', mars: 'mars_2k.jpg', jupiter: 'jupiter_2k.jpg', saturn: 'saturn_2k.jpg', uranus: 'uranus_2k.jpg', neptune: 'neptune_2k.jpg' };
const texCache = {};
export const uploadQueue = [];   // loaded image textures: the main loop uploads one per frame (renderer.initTexture) before first use
const loader = new THREE.TextureLoader();
function loadReal(file, ok, fail, linear = false) {
  const key = file + (linear ? ':lin' : '');
  if (!texCache[key]) texCache[key] = new Promise((res, rej) => loader.load(new URL('../scene/textures/' + file, import.meta.url).href, t => { t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 4; uploadQueue.push(t); res(t); }, undefined, rej));
  texCache[key].then(ok, () => { console.warn('[SE2] texture missing, using procedural:', file); fail && fail(); });
}
export const texQueue = [];   // procedural canvas textures, one per frame (main loop drains it)

function ringGeo(inner, outer, seg = 128) {
  const g = new THREE.RingGeometry(inner, outer, seg, 2), p = g.attributes.position, uv = g.attributes.uv, v = new THREE.Vector3();
  for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k); uv.setXY(k, (v.length() - inner) / (outer - inner), (k % (seg + 1)) / seg); }
  return g;
}
const lin = hex => new THREE.Color(hex);   // hex is sRGB -> THREE.Color stores linear

// ---- atmosphere presets: vertical optical depths (Earth Rayleigh = 0.046/0.108/0.265 at 680/550/440 nm), scale heights and
// shell top in planet radii (scale heights are ~3x exaggerated, optical depth preserved, so the limb reads at a glance)
const EARTH_TR = [0.046, 0.108, 0.265];
export function atmoParams(b) {
  if (!b.atmo) return null;
  let P = { tR: 1, tM: 0.04, mc: [1, 1, 1], g: 0.76, HR: 0.004, HM: 0.0012, top: 0.03, tint: 0 };
  const S = {
    earth: { tR: 1, tM: 0.035, oz: 1.5 }, venus: { tR: 4, tM: 6, mc: [1, 0.82, 0.55], g: 0.7, HR: 0.012, HM: 0.01, top: 0.06 },
    mars: { tR: 0.03, tM: 0.35, mc: [1, 0.62, 0.4], g: 0.65, HM: 0.004 }, titan: { tR: 1.2, tM: 5, mc: [1, 0.6, 0.22], g: 0.65, HR: 0.02, HM: 0.02, top: 0.12 },
    jupiter: { tR: 0.05, tM: 0.22, mc: [1, 0.9, 0.75], g: 0.6, HR: 0.01, HM: 0.006, top: 0.04 }, saturn: { tR: 0.05, tM: 0.25, mc: [1, 0.92, 0.75], g: 0.6, HR: 0.01, HM: 0.006, top: 0.04 },
    uranus: { tR: 1.1, tM: 0.25, mc: [0.7, 0.95, 1], g: 0.6, HR: 0.012, HM: 0.006, top: 0.045 }, neptune: { tR: 1.3, tM: 0.25, mc: [0.6, 0.8, 1], g: 0.6, HR: 0.012, HM: 0.006, top: 0.045 },
    pluto: { tR: 0.02, tM: 0.03, mc: [0.6, 0.75, 1], top: 0.03 },
  };
  if (b.sol) Object.assign(P, S[b.key] || { tR: 0.3, tM: 0.1 });
  else Object.assign(P, {
    ocean: { tR: 1, tM: 0.04, oz: 1.5 }, desert: { tR: 0.35, tM: 0.3, mc: 'atmo', g: 0.68, HM: 0.003 }, rocky: { tR: 0.5, tM: 0.1, tint: 0.7 },
    lava: { tR: 0.8, tM: 1.2, mc: [1, 0.55, 0.3], g: 0.7, HM: 0.004 }, ice: { tR: 0.3, tM: 0.05, tint: 0.5 },
    gas: { tR: 0.25, tM: 0.4, mc: 'atmo', g: 0.6, HR: 0.01, HM: 0.006, top: 0.04 }, icegiant: { tR: 1.2, tM: 0.25, mc: 'atmo', g: 0.6, HR: 0.012, HM: 0.006, top: 0.045 },
  }[b.type] || {});
  const ac = lin(b.atmo), acn = [ac.r, ac.g, ac.b].map(v => v / Math.max(ac.r, ac.g, ac.b, 1e-3));
  if (P.mc === 'atmo') P.mc = acn;
  const avg = (acn[0] + acn[1] + acn[2]) / 3;
  const tauR = EARTH_TR.map((t, i) => t * P.tR * (1 - P.tint + P.tint * acn[i] / avg));
  const oz = P.oz ? [0.0114, 0.033, 0.0015].map(t => t * P.oz) : [0, 0, 0];   // Chappuis-band ozone absorption (Earth-like air only)
  return { tauR, tauM: P.tM, betaR: tauR.map(t => t / P.HR), betaO: oz.map(t => t / P.HR), tauO: oz, betaM: P.tM / P.HM, mc: P.mc, g: P.g, HR: P.HR, HM: P.HM, top: P.top,
    tau: tauR.map((t, i) => t + P.tM * 1.1 + oz[i]) };
}

export function createSystemView(sys, opts = {}) {
  const qname = opts.quality || 'medium', DEF = QDEF[qname];
  if (!GLOW_SOFT) GLOW_SOFT = glowTexture([[0, 'rgba(255,255,255,0.55)'], [0.3, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)']]);
  sys.bodyMap = Object.fromEntries([...sys.stars, ...sys.bodies].map(b => [b.key, b]));
  const group = new THREE.Group(); group.name = 'system:' + sys.id;
  const starU = { uS0: { value: new THREE.Vector3() }, uS0c: { value: new THREE.Vector3(1, 1, 1) }, uS1: { value: new THREE.Vector3(1e9, 0, 0) }, uS1c: { value: new THREE.Vector3() }, uAmb: { value: 0.0012 } };
  const time = { value: 0 };
  const items = [], pickables = [], disposables = [];
  const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); disposables.push(mat); return m; };
  const shader = (o) => { const m = new THREE.ShaderMaterial(Object.assign({ defines: { ...DEF } }, o)); m.extensions = { derivatives: true }; return m; };

  // ---------- stars ----------
  sys.stars.forEach((s, si) => {
    const node = new THREE.Group(); group.add(node);
    const it = { b: s, node, r: s.radiusSu, world: new THREE.Vector3(), wpos: new THREE.Vector3(), star: true };
    const col = new THREE.Color(...s.color);
    if (s.cls === 'BH') {
      const rH = s.radiusSu;
      it.mesh = mk(new THREE.SphereGeometry(rH, 48, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      const disk = mk(ringGeo(rH * 1.7, rH * 7.5, 160), new THREE.ShaderMaterial({ vertexShader: DISK_VS, fragmentShader: DISK_FS, uniforms: { uTime: time }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      disk.rotation.x = -Math.PI / 2 + 0.25; node.add(disk); it.disk = disk;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_SOFT, color: new THREE.Color(1, 0.55, 0.25).multiplyScalar(1.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 }));
      halo.scale.setScalar(rH * 16); node.add(halo); disposables.push(halo.material);
      it.lens = rH; it.r = rH; it.lum = 0;
    } else {
      const hot = Math.pow(s.T / 5772, 1.2);
      const I = (s.cls === 'NS' ? 60 : s.cls === 'WD' ? 40 : 22) * Math.min(4, Math.max(0.5, hot));
      it.mesh = mk(LOD[3], new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: { uColor: { value: col.clone() }, uTime: time, uI: { value: I },
        uGran: { value: s.R > 30 ? 9 : s.R > 3 ? 22 : 55 }, uSpots: { value: s.T < 6500 && s.cls !== 'WD' ? 1 : 0 }, uDetail: { value: 1 } } }));
      it.mesh.scale.setScalar(s.radiusSu);
      const K = s.cls === 'NS' ? 30 : s.cls === 'WD' ? 14 : s.R > 30 ? 2.5 : 6;
      const corona = mk(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: CORONA_VS, fragmentShader: CORONA_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: col.clone().lerp(new THREE.Color(1, 1, 1), 0.3) }, uI: { value: I * (s.R > 30 ? 0.05 : 0.12) }, uTime: time, uK: { value: K }, uSize: { value: s.radiusSu * K } } }));
      corona.frustumCulled = false; node.add(corona); it.corona = corona;
      it.I = I; it.lum = s.L;
    }
    node.add(it.mesh); it.mesh.userData.item = it; pickables.push(it.mesh);
    if (s.cls === 'NS') {   // pulsar beams
      const beams = new THREE.Group(), bm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.8, 1.6), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      disposables.push(bm);
      for (const sgn of [1, -1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(1.2, 40, 24, 1, true), bm); c.position.y = sgn * 20; c.rotation.x = sgn > 0 ? Math.PI : 0; beams.add(c); }
      beams.rotation.z = 0.5; beams.scale.setScalar(s.radiusSu / 0.05); node.add(beams); it.beams = beams;
    }
    it.col = col;
    items.push(it);
  });

  // ---------- planets & moons ----------
  const markerList = [];
  sys.bodies.forEach((b, bi) => {
    const node = new THREE.Group(), tilt = new THREE.Group(); tilt.rotation.z = (b.tilt || 0) * D2R; node.add(tilt); group.add(node);
    const it = { b, node, tilt, r: b.radiusSu, world: new THREE.Vector3(), wpos: new THREE.Vector3() };
    const A = atmoParams(b);
    const common = { ...starU, uPC: { value: it.wpos }, uPRad: { value: b.radiusSu }, uTau: { value: new THREE.Vector3(...(A ? A.tau : [0, 0, 0])) },
      uRingN: { value: new THREE.Vector3(0, 1, 0) }, uRing: { value: new THREE.Vector2(0, 0) }, uRingSeed: { value: b.rings ? (b.rings.seed || 3) : 0 } };
    it.U = common;
    let mat;
    if (b.sol) {
      const U = { ...common, uMap: { value: null }, uNight: { value: null }, uSpec: { value: null }, uClouds: { value: null }, uHasNight: { value: 0 }, uHasSpec: { value: 0 }, uHasClouds: { value: 0 },
        uToCloud: { value: new THREE.Matrix3() }, uSunObj: { value: new THREE.Vector3(1, 0, 0) }, uLimb: { value: b.key === 'jupiter' || b.key === 'saturn' || b.key === 'uranus' || b.key === 'neptune' ? 1 : 0 } };
      mat = shader({ vertexShader: TEX_VS, fragmentShader: TEX_FS, uniforms: U });
      const setMap = t => { U.uMap.value = t; };
      U.uMap.value = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255]), 1, 1); U.uMap.value.needsUpdate = true;
      const procedural = () => { if (it.real) return; const t = bodyTexture(b.tex, 1000 + bi * 77, b.kind === 'moon' ? 256 : 512, b.kind === 'moon' ? 128 : 256); t.colorSpace = THREE.SRGBColorSpace; setMap(t); };
      if (REAL_TEX[b.tex]) loadReal(REAL_TEX[b.tex], t => { it.real = true; setMap(t); }, () => texQueue.push(procedural));
      else texQueue.push(procedural);
      if (b.key === 'earth') {
        it.texU = U;
        loadReal('earth_night_2k.jpg', t => { U.uNight.value = t; U.uHasNight.value = 1; });
        loadReal('earth_specular_1k.jpg', t => { U.uSpec.value = t; U.uHasSpec.value = 1; }, null, true);
        const cm = shader({ vertexShader: TEX_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
          uniforms: { ...common, uClouds: { value: null }, uTex: { value: 1 }, uOct: { value: 4 }, uCloud: { value: 1 }, uTime: time, uSeed: { value: new THREE.Vector3() } } });
        cm.visible = false;
        it.clouds = mk(LOD[2], cm); it.clouds.scale.setScalar(b.radiusSu * 1.006); it.clouds.renderOrder = 1; tilt.add(it.clouds);
        loadReal('earth_clouds_2k.jpg', t => { cm.uniforms.uClouds.value = t; cm.visible = true; U.uClouds.value = t; U.uHasClouds.value = 1; }, null, true);
      }
    } else {
      const P = b.palette.map(c => lin(c));
      const sr = b.seed % 1000;
      const seedV = new THREE.Vector3(sr * 0.137 % 50, sr * 0.071 % 50, sr * 0.293 % 50);
      const city = b.type === 'ocean' && b.tempK > 255 && b.tempK < 315 && (b.seed % 7) < 3 ? 1.2 : 0;
      mat = shader({ vertexShader: PLANET_VS, fragmentShader: PLANET_FS, uniforms: { ...common, uTime: time,
        uType: { value: TYPE_ID[b.type] ?? 0 }, uSeed: { value: seedV }, uOct: { value: 4 }, uTempK: { value: b.tempK || 280 }, uCity: { value: city }, uAirless: { value: b.atmo ? 0 : 1 },
        uRelief: { value: b.type === 'gas' || b.type === 'icegiant' ? 0 : 0.018 }, uCloudInv: { value: new THREE.Matrix3() },
        uC1: { value: P[0] }, uC2: { value: P[1] }, uC3: { value: P[2] }, uC4: { value: P[3] }, uSea: { value: b.sea ?? 0.5 }, uIce: { value: b.ice ?? 1.2 },
        uCloud: { value: b.clouds || 0 }, uBands: { value: b.bands || 6 }, uTurb: { value: b.turb ?? 0.5 }, uStorm: { value: b.storm ?? -2 } } });
      it.city = city;
      if (b.clouds > 0) {
        const cm = shader({ vertexShader: TEX_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
          uniforms: { ...common, uClouds: { value: null }, uTex: { value: 0 }, uOct: { value: 4 }, uCloud: { value: b.clouds }, uTime: time, uSeed: { value: seedV } } });
        it.clouds = mk(LOD[2], cm); it.clouds.scale.setScalar(b.radiusSu * 1.008); it.clouds.renderOrder = 1; tilt.add(it.clouds);
      }
    }
    it.mesh = mk(LOD[1], mat); it.mesh.scale.setScalar(b.radiusSu); it.mesh.userData.item = it; tilt.add(it.mesh); pickables.push(it.mesh);
    if (A) {
      const am = new THREE.ShaderMaterial({ defines: { ...DEF }, vertexShader: ATMO_VS, fragmentShader: ATMO_FS, transparent: true, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
        uniforms: { uPC: { value: it.wpos }, uS0: starU.uS0, uS0c: starU.uS0c, uPRad: { value: b.radiusSu }, uTop: { value: A.top }, uHR: { value: A.HR }, uHM: { value: A.HM }, uG: { value: A.g },
          uBR: { value: new THREE.Vector3(...A.betaR) }, uBM: { value: new THREE.Vector3(A.betaM, A.betaM, A.betaM) }, uMieCol: { value: new THREE.Vector3(...A.mc) }, uOz: { value: new THREE.Vector3(...A.betaO) }, uSunI: { value: 4 }, uIn: { value: 0 } } });
      const a = mk(LOD[2], am); a.scale.setScalar(b.radiusSu * (1 + A.top) * 1.002); a.renderOrder = 2; a.frustumCulled = false; tilt.add(a); it.atmo = a; it.A = A;
    }
    if (b.rings) {
      const inner = b.radiusSu * b.rings.inner, outer = b.radiusSu * b.rings.outer, g = ringGeo(inner, outer);
      const rm = new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: { uColor: { value: lin(b.rings.color || 0xd8c8a8) }, uS0: starU.uS0, uS0c: starU.uS0c, uPC: { value: it.wpos }, uPRad: { value: b.radiusSu }, uSeed: { value: b.rings.seed || 3 }, uTex: { value: 0 }, uMap: { value: null } } });
      if (b.rings.sol) loadReal('saturn_ring_1k.png', t => { rm.uniforms.uMap.value = t; rm.uniforms.uTex.value = 1; }, () => texQueue.push(() => { const t = ringTexture(77); t.colorSpace = THREE.SRGBColorSpace; rm.uniforms.uMap.value = t; rm.uniforms.uTex.value = 1; }));
      it.rings = mk(g, rm); it.rings.rotation.x = -Math.PI / 2; it.rings.renderOrder = 3; it.rings.userData.item = it; tilt.add(it.rings); pickables.push(it.rings);
      common.uRing.value.set(inner, outer);
    }
    if (b.kind === 'planet') markerList.push(it);
    items.push(it);
  });

  // ---------- orbit lines & markers ----------
  const lines = new THREE.Group(); group.add(lines);
  const ringLine = (rad, color, op) => {
    const pts = []; for (let k = 0; k <= 256; k++) { const a = k / 256 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * rad, 0, -Math.sin(a) * rad)); }
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }); disposables.push(m);
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m);
  };
  for (const it of items) {
    const b = it.b;
    if (b.kind === 'planet') { const l = ringLine(b.orbitSu, 0x2a5aa0, 0.3); l.rotation.x = -(b.incl || 0) * D2R; lines.add(l); it.line = l; }
    if (b.kind === 'moon') { const l = ringLine(b.orbitSu, 0x4a70a0, 0.18); l.rotation.x = -((b.incl || 0) * D2R + (b.irr ? 0.4 : 0)); lines.add(l); it.line = l; it.moonLine = true; }
  }
  const mGeo = new THREE.BufferGeometry();
  mGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, markerList.length) * 3), 3));
  mGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(markerList.flatMap(it => lin(it.b.atmo || (it.b.palette ? it.b.palette[0] : 0xcccccc)).toArray())), 3));
  const markerMat = new THREE.ShaderMaterial({ uniforms: { uPR: { value: 1 }, uNear: { value: 6 } }, transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 color; varying vec3 vC; varying float vF; uniform float uPR, uNear;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.); vF = smoothstep(uNear, uNear * 5., -mv.z); gl_Position = projectionMatrix * mv; gl_PointSize = 9. * uPR; }`,
    fragmentShader: `varying vec3 vC; varying float vF; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .38, d) - smoothstep(.3, .18, d) * .85; gl_FragColor = vec4(vC * .6, a * vF * .8); }` });
  const markers = new THREE.Points(mGeo, markerMat); markers.frustumCulled = false; group.add(markers); disposables.push(markerMat);

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), m3 = new THREE.Matrix3(), m3b = new THREE.Matrix3(), m4 = new THREE.Matrix4(), qtmp = new THREE.Quaternion();
  const view = {
    sys, group, items, pickables, markers, markerMat, lines,
    itemByKey: k => items.find(it => it.b.key === k),
    // days: simulated days; camLocal: camera in system-local su; focalPx: projection scale (px per unit at distance 1)
    update(days, camLocal, focalPx, dt) {
      time.value += dt;
      for (const it of items) {
        bodyPosition(sys, it.b, days, it.world);
        it.node.position.copy(it.world).sub(camLocal);      // camera-relative, computed in double precision
        const b = it.b;
        const d = Math.max(1e-12, camLocal.distanceTo(it.world)), px = it.r / d * focalPx; it.px = px; it.dist = d;
        if (it.star) {
          if (it.beams) it.beams.rotation.y += dt * 6; if (it.disk) it.disk.rotation.z += dt * 0.05;
          if (it.mesh.material.uniforms && it.mesh.material.uniforms.uDetail) it.mesh.material.uniforms.uDetail.value = px < 40 ? 0 : px < 400 ? 1 : 2;
          continue;
        }
        if (b.locked && b.kind === 'moon') { const p = sys.bodyMap[b.parent]; tmp.copy(items.find(x => x.b === p).world).sub(it.world); it.mesh.rotation.y = Math.atan2(tmp.x, tmp.z) - Math.PI / 2; }
        else if (b.dayHours) it.mesh.rotation.y = (days * 24 / b.dayHours) * Math.PI * 2 * SPIN % (Math.PI * 2);
        if (it.clouds) it.clouds.rotation.y = it.mesh.rotation.y * 1.15 + time.value * 0.002;
        const lod = px < 10 ? 0 : px < 90 ? 1 : px < 420 ? 2 : 3;
        if (it.mesh.geometry !== LOD[lod]) { it.mesh.geometry = LOD[lod]; if (it.clouds) it.clouds.geometry = LOD[Math.max(1, lod)]; if (it.atmo) it.atmo.geometry = LOD[Math.max(1, lod)]; }
        const oct = Math.max(2, Math.min(DEF.OCT_MAX, Math.log2(Math.max(px, 1) / 4.2) + 1.5));
        const u = it.mesh.material.uniforms; if (u.uOct) u.uOct.value = oct;
        if (it.clouds) it.clouds.material.uniforms.uOct.value = Math.min(oct, 6);
        if (it.atmo) { const inside = d < it.r * (1 + it.A.top) * 1.01; const m = it.atmo.material; m.side = inside ? THREE.BackSide : THREE.FrontSide; m.depthTest = !inside; it.atmo.visible = px > 1.5; }
      }
      lines.position.copy(camLocal).negate();
      for (const it of items) if (it.moonLine) {
        const p = items.find(x => x.b.key === it.b.parent);
        it.line.position.copy(p.world); it.line.visible = camLocal.distanceTo(p.world) < p.b.moonExtent * 5 + 25 * (sys.realScale ? 0.01 : 1);
      }
      const mp = markers.geometry.attributes.position; markerList.forEach((it, i) => mp.setXYZ(i, it.world.x - camLocal.x, it.world.y - camLocal.y, it.world.z - camLocal.z)); mp.needsUpdate = true;
    },
    // world-space (camera-relative) uniforms – call after the group's world matrices are current
    updateLights() {
      group.updateMatrixWorld(true);
      const s = items.filter(i => i.star);
      for (const it of items) it.node.getWorldPosition(it.wpos);
      const w0 = s[0].wpos, c0 = s[0].col;
      starU.uS0.value.copy(w0);
      starU.uS0c.value.set(c0.r, c0.g, c0.b).lerp(tmp2.set(1, 1, 1), 0.3);
      if (s[0].b.cls === 'BH') starU.uS0c.value.set(1, 0.7, 0.45).multiplyScalar(0.35);
      if (s[1]) { starU.uS1.value.copy(s[1].wpos); const c1 = s[1].col; starU.uS1c.value.set(c1.r, c1.g, c1.b).lerp(tmp2.set(1, 1, 1), 0.3).multiplyScalar(Math.min(1, Math.sqrt(s[1].b.L / Math.max(s[0].b.L, 1e-6)))); }
      for (const it of items) {
        if (it.star || !it.U) continue;
        if (it.rings) it.U.uRingN.value.set(0, 1, 0).applyQuaternion(it.tilt.getWorldQuaternion(qtmp));
        const u = it.mesh.material.uniforms;
        if (it.clouds && u.uCloudInv) { m3.setFromMatrix4(it.clouds.matrixWorld); u.uCloudInv.value.copy(m3).invert(); }   // world dir -> cloud object space (scale cancels by normalisation)
        if (u.uSunObj) {
          m3.setFromMatrix4(it.mesh.matrixWorld); m3b.copy(m3).invert();
          u.uSunObj.value.copy(starU.uS0.value).sub(it.wpos).applyMatrix3(m3b).normalize();
          if (it.clouds) { const mc = new THREE.Matrix3().setFromMatrix4(it.clouds.matrixWorld).invert(); u.uToCloud.value.copy(mc.multiply(m3)); }
        }
      }
    },
    setPR(pr) { markerMat.uniforms.uPR.value = pr; },
    dispose() {
      group.removeFromParent();
      group.traverse(o => { if (o.geometry && !LOD.includes(o.geometry)) o.geometry.dispose(); });
      for (const m of disposables) m.dispose();
    },
  };
  return view;
}

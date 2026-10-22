// Space Explorer X 2 – engine. Seamless multi-scale renderer + navigation; exposes window.SE2 (see README.md).
import * as THREE from '../scene/vendor/three.module.min.js?v=20261014b';
import { createJoystick } from '../scene/joystick.js?v=20261014b';
import { createSurface } from '../scene/surface.js?v=20261022c';
import { hash, rng, clamp, TAU, D2R, fmtDist, starName, smooth } from './util.js?v=20261014b';
import { REAL_GALAXIES, galaxyById, galaxyTypeLabel, densityAt, SOL_GPOS, LOCAL_VOID } from './universe.js?v=20261014b';
import { StarField, REAL_STARS, starById, starName_, sectorStars, LEVELS, CLASS_INFO } from './stars.js?v=20261014b';
import { systemFor, LY_PER_SU as K, bodyPosition, TYPE_LABEL, REARTH_KM, RSUN_KM, setRealScale, isRealScale, AU_SU } from './sysgen.js?v=20261014b';
import { createSystemView, texQueue, uploadQueue, atmoParams, SPIN, QDEF } from './sysview.js?v=20261014b';
import { createTerrain, TERRAIN_LAYER } from './terrain.js?v=20261014b';
import { createGasInterior, GAS_LAYERS, GAS_FADE } from './gasdeck.js?v=20261014b';
import { UniverseView, createGalaxyCloud, createSkyBox, createGalaxySky } from './views.js?v=20261014b';
import { createPost } from './post.js?v=20261014b';
import { NebulaField, REAL_NEBULAE, nebulaById, nebulaeNear } from './nebulae.js?v=20261014b';

const LAND_MS = 2500, MAX_ORBIT = 3e9, J2000 = Date.UTC(2000, 0, 1, 12);
const GAS_SCALE = { low: 0.33, medium: 0.45, high: 0.6, ultra: 0.8 };
const QUALITY = { low: { cloud: 22000, stars: 0.5, maxPR: 1.25, sky: 128, flare: 0 }, medium: { cloud: 40000, stars: 1, maxPR: 1.75, sky: 192, flare: 0 }, high: { cloud: 70000, stars: 1, maxPR: 2, sky: 320, flare: 1 },
  ultra: { cloud: 110000, stars: 1.6, maxPR: 4, sky: 512, flare: 1.2 } };   // ultra: desktop / strong GPUs only, never auto-selected (pixel ratio still capped by devicePixelRatio)
// realistic lens: ~70 deg diagonal field of view (like a phone's main camera), whatever the screen shape
const fovFor = aspect => 2 * Math.atan(Math.tan(35 * Math.PI / 180) / Math.sqrt(1 + aspect * aspect)) * 180 / Math.PI;
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3), easeIn = t => t * t * t;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), Y = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Vector3();
const sph = (d, phi, th, out) => out.set(d * Math.sin(phi) * Math.sin(th), d * Math.cos(phi), d * Math.sin(phi) * Math.cos(th));
const ev = (name, detail) => dispatchEvent(new CustomEvent(name, { detail }));

export async function init(opts = {}) {
  const params = new URLSearchParams(location.search);
  const SEED = (opts.seed ?? parseInt(params.get('seed'), 10)) || 1;
  let qName = opts.quality || params.get('quality') || ((navigator.deviceMemory || 4) <= 2 ? 'low' : 'medium');
  let Q = QUALITY[qName] || QUALITY.medium;
  const host = opts.container || document.body;

  // ---------- renderer ----------
  const canvas = document.createElement('canvas'); canvas.id = 'se-canvas';
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none', zIndex: '0' });
  host.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
  let maxPR = Math.min(window.devicePixelRatio || 1, Q.maxPR), pixelRatio = Math.min(maxPR, 1.5);
  renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.autoClear = false; renderer.setClearColor(0x000000, 1);
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
  const post = createPost(renderer); post.setTier(qName);
  const uniScene = new THREE.Scene(), galScene = new THREE.Scene(), starScene = new THREE.Scene(), sysScene = new THREE.Scene();

  // ---------- universe / galaxy / stars ----------
  const uni = new UniverseView(SEED); uniScene.add(uni.group);
  const stars = new StarField(SEED, Q.stars); starScene.add(stars.group);
  const galCache = new Map();
  const getGalaxy = id => { if (!id) return null; if (galCache.has(id)) return galCache.get(id); const g = galaxyById(SEED, id); if (g) galCache.set(id, g); return g; };
  const resolveStar = id => { const gid = id.split('/s:')[0]; return starById(getGalaxy(gid), SEED, id); };
  const getSystem = id => { const s = systemFor(id, resolveStar, getGalaxy); if (s) prepSystem(s); return s; };
  function prepSystem(s) {
    if (s.q) return;
    s.gpos = new THREE.Vector3().copy(s.gpos);
    s.bodyMap = Object.fromEntries([...s.stars, ...s.bodies].map(b => [b.key, b]));
    if (s.id === 'sol') {   // ecliptic orientation in galactic coordinates (NEP l=96.38 b=29.81, equinox l=96.34 b=-60.19)
      const d = (l, b) => new THREE.Vector3(-Math.cos(b * D2R) * Math.sin(l * D2R), Math.sin(b * D2R), -Math.cos(b * D2R) * Math.cos(l * D2R));
      const x = d(96.34, -60.19), y = d(96.38, 29.81), z = new THREE.Vector3().crossVectors(x, y);
      s.q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    } else { const r = rng(hash(s.id, 'q')); s.q = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 1.2, r() * TAU, (r() - 0.5) * 1.2)); }
    s.gal = getGalaxy(s.galId);
    s.uq = s.gal.q.clone().multiply(s.q); s.uqi = s.uq.clone().invert();
  }

  // ---------- hierarchical location: {gal, sys, p}  (sys: su in system frame; gal: ly galaxy frame; else universe ly) ----------
  const galOf = l => l.sys ? l.sys.gal : l.gal;
  function toUni(l, out = V()) {
    if (l.sys) return out.copy(l.p).multiplyScalar(K).applyQuaternion(l.sys.q).add(l.sys.gpos).applyQuaternion(l.sys.gal.q).add(l.sys.gal.center);
    if (l.gal) return out.copy(l.p).applyQuaternion(l.gal.q).add(l.gal.center);
    return out.copy(l.p);
  }
  function toGal(l, g, out = V()) {
    if (l.sys && l.sys.gal === g) return out.copy(l.p).multiplyScalar(K).applyQuaternion(l.sys.q).add(l.sys.gpos);
    if (l.gal === g && !l.sys) return out.copy(l.p);
    return toUni(l, out).sub(g.center).applyQuaternion(g.qi);
  }
  function toSys(l, s, out = V()) {
    if (l.sys === s) return out.copy(l.p);
    return toGal(l, s.gal, out).sub(s.gpos).applyQuaternion(s.q.clone().invert()).divideScalar(K);
  }
  const t1 = V(), t2 = V(), t3 = V();
  function delta(a, b, out = V()) {   // b - a, universe axes, ly
    if (a.sys && a.sys === b.sys) return out.copy(b.p).sub(a.p).multiplyScalar(K).applyQuaternion(a.sys.uq);
    const ga = galOf(a);
    if (ga && ga === galOf(b)) return toGal(b, ga, out).sub(toGal(a, ga, t3)).applyQuaternion(ga.q);
    return toUni(b, out).sub(toUni(a, t3));
  }
  function addDelta(l, d) {
    const o = { gal: l.gal, sys: l.sys, p: l.p.clone() };
    if (o.sys) o.p.add(t1.copy(d).applyQuaternion(o.sys.uqi).divideScalar(K));
    else if (o.gal) o.p.add(t1.copy(d).applyQuaternion(o.gal.qi));
    else o.p.add(d);
    return rehome(o);
  }
  const pinned = new Set();     // systems that may be entered even if their star is not streamed yet (flight targets)
  function rehome(l, allowEnter = true) {
    for (let guard = 0; guard < 4; guard++) {
      if (l.sys) {
        if (l.p.length() * K > l.sys.enterLy * 1.3) { const g = l.sys.gal; l = { gal: g, sys: null, p: toGal(l, g) }; continue; }
        return l;
      }
      if (l.gal) {
        const g = l.gal, r = l.p.length();
        const other = nearGalaxy(toUni(l, t2), g);
        if (r > g.R * 3.3 || (other && other.d / other.g.R < r / g.R)) { l = { gal: null, sys: null, p: toUni(l) }; continue; }
        if (allowEnter) { const s = nearSystem(g, l.p); if (s) { l = { gal: null, sys: s, p: toSys(l, s) }; continue; } }
        return l;
      }
      const ng = nearGalaxy(l.p);
      if (ng && ng.d < ng.g.R * 3) { l = { gal: ng.g, sys: null, p: l.p.clone().sub(ng.g.center).applyQuaternion(ng.g.qi) }; continue; }
      return l;
    }
    return l;
  }
  function nearGalaxy(pu, except) {
    let best = null;
    for (const g of uni.galaxies) { if (g === except) continue; const d = pu.distanceTo(g.center); if (d < g.R * 3 && (!best || d / g.R < best.d / best.g.R)) best = { g, d }; }
    return best;
  }
  function nearSystem(g, p) {
    const ENTER = 0.05; let best = null, bd = ENTER;
    if (p.length() < 0.06) return getSystem(g.id === 'mw' ? 'sgra' : g.id + '/core');
    if (stars.galaxy === g) for (const st of stars.all()) { const d = st.gpos.distanceTo(p); if (d < bd) { bd = d; best = st; } }
    for (const sid of pinned) { const s = getSystem(sid); if (s && s.gal === g) { const d = s.gpos.distanceTo(p); if (d < Math.max(bd, s.enterLy)) { bd = d; best = { id: sid }; } } }
    if (!best) return null;
    if (best.cls && !best.real) starName_(best);
    return getSystem(best.id);
  }

  // ---------- camera state ----------
  const cam = { loc: null, q: new THREE.Quaternion() };
  let mode = 'orbit', focus = null, selected = null, flight = null, timeSpeed = 1, boost = 1;
  let simDays = (Date.now() - J2000) / 86400000;
  const orb = { theta: 0.5, phi: 1.25, dist: 1 }, cur = { theta: 0.5, phi: 1.25, ld: 0 };
  const fly = { input: V(), vel: V(), speed: 0 }; let passT = null;
  // ---------- seamless planet flight state ----------
  const SEAMLESS = () => window.X2_SEAMLESS !== false;
  let terr = null, attach = null, orbSpin = null, tiCache = null, fd = null;   // fd: fly-down autopilot

  // ---------- entities ----------
  const entCache = new Map();
  function entity(id) {
    if (!id) return null;
    if (entCache.has(id)) return entCache.get(id);
    let e = null;
    const g0 = getGalaxy(id);
    const neb = (id.startsWith('neb:') || id.includes('/n:')) ? nebulaById(getGalaxy(id.startsWith('neb:') ? 'mw' : id.split('/n:')[0]), SEED, id) : null;
    if (neb) {
      const gN = getGalaxy(neb.galId || 'mw');
      e = { id, kind: 'nebula', name: neb.name, n: neb, g: gN, frameQ: gN.q, radiusLy: neb.R, viewLy: neb.R * 3.2, minLy: neb.R * 0.05, loc: () => ({ gal: gN, sys: null, p: neb.gpos.clone() }) };
    } else if (g0 && !id.includes('/') && !id.includes('#')) {
      e = { id, kind: 'galaxy', name: g0.name, g: g0, frameQ: g0.q, radiusLy: g0.R * 0.04, viewLy: g0.R * 2.5, minLy: g0.R * 0.03,
        loc: () => ({ gal: g0, sys: null, p: new THREE.Vector3() }) };
    } else {
      let sid = id, key = null;
      if (id.includes('#')) [sid, key] = id.split('#');
      const s = getSystem(sid);
      if (!s) return null;
      const b = key ? s.bodyMap[key] : s.stars[0];
      if (!b) return null;
      const r = b.radiusSu * (b.cls === 'BH' ? 1 : 1);
      const view = b.kind === 'star' ? (b.cls === 'BH' ? r * 14 : Math.max(r * 5, s.realScale ? r * 5 : 6)) : r * (b.rings ? 5.5 : 3.6);
      e = { id: s.id + '#' + b.key, kind: b.kind === 'star' ? (b.cls === 'BH' ? 'blackhole' : 'star') : b.kind, name: b.name, sys: s, b, frameQ: s.uq,
        radiusLy: r * K, viewLy: view * K, minLy: r * (b.kind === 'star' ? 1.4 : 1.25) * K,
        loc: () => ({ gal: null, sys: s, p: bodyPosition(s, b, simDays, new THREE.Vector3()) }) };
      if (key == null) entCache.set(id, e);
      id = e.id;
    }
    entCache.set(id, e);
    return e;
  }

  // ---------- views ----------
  const clouds = new Map();      // galaxy id -> cloud
  let gsky = createGalaxySky(renderer, Q.sky, post.hdr, qName), skyT = 0;
  const skyBox = createSkyBox(gsky.texture()); skyBox.visible = false; galScene.add(skyBox);
  const faded = new Set();
  // galaxy cloud particles are built in a worker as soon as a galaxy is within ~4.5 R (the cloud only fades in inside 3 R)
  const cloudPre = new Map(); let gWorker = null;
  try { gWorker = new Worker(new URL('./galaxy_worker.js?v=20261014b', import.meta.url), { type: 'module' });
    gWorker.onmessage = e => { const j = cloudPre.get(e.data.id); if (j) { if (e.data.d) { j.d = e.data.d; j.state = 'ready'; } else { j.state = 'failed'; } } };
    gWorker.onerror = () => { gWorker = null; for (const j of cloudPre.values()) if (j.state === 'busy') j.state = 'failed'; }; } catch (e) { gWorker = null; }
  const cloudN = gg => Math.round(Q.cloud * (gg.R < 10000 ? 0.4 : 1));
  function prefetchCloud(gg) {
    if (!gWorker || clouds.has(gg.id) || cloudPre.has(gg.id)) return;
    const plain = {}; for (const k of ['R', 'armCol', 'armPhase', 'arms', 'ax', 'bar', 'clumps', 'coreCol', 'hr', 'hz', 'pitch', 'rb', 'seed', 'type']) if (gg[k] !== undefined) plain[k] = gg[k];
    try { gWorker.postMessage({ id: gg.id, g: JSON.parse(JSON.stringify(plain)), N: cloudN(gg) }); cloudPre.set(gg.id, { state: 'busy', N: cloudN(gg) }); } catch (e) {}
    if (cloudPre.size > 6) for (const [k, j] of cloudPre) if (j.state !== 'busy') { cloudPre.delete(k); break; }
  }
  const nebField = new NebulaField(qName);   // drawn by nebField.render() (own low-res pass)
  nebField.warm(renderer, camera);
  const views = new Map();       // system id -> view
  let activeView = null;
  function rebuildViews() { if (terr) { terr.dispose(); terr = null; attach = null; } for (const [k, v] of views) { v.dispose(); views.delete(k); } activeView = null; }
  // ---------- shader program keeper ----------
  // three.js frees a GL program as soon as the last material using it is disposed; system views / galaxy clouds are disposed and
  // re-created as you fly between systems, nebulae and galaxies, and every re-creation re-linked the same shaders (the 0.4-0.8 s
  // hitches entering/leaving nebulae and galaxies). One never-disposed clone per distinct shader keeps each program alive.
  const keepMats = new Map(), keepScene = new THREE.Scene(), keepSeen = new WeakMap();
  function keepPrograms(root, compile = true) {
    let added = 0;
    root.traverse(o => { const m = o.material; if (!m || Array.isArray(m) || !(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      const sk = (m.vertexShader || '').length + ':' + (m.fragmentShader || '').length; if (keepSeen.get(m) === sk) return; keepSeen.set(m, sk);
      const key = m.type + '|' + (m.vertexShader || '') + '|' + (m.fragmentShader || '') + '|' + JSON.stringify(m.defines || {}) + '|' + o.type + '|' + !!m.vertexColors + '|' + !!m.map;
      if (keepMats.has(key)) return;
      const mc = m.clone(), c = o.isSprite ? new THREE.Sprite(mc) : new o.constructor(o.geometry, mc); c.frustumCulled = false; c.visible = true; keepMats.set(key, c); keepScene.add(c); added++; });
    if (added && compile) { const rt = renderer.getRenderTarget(); try { post.begin(); renderer.compile(keepScene, camera); } catch (e) {} renderer.setRenderTarget(rt); }   // compiled for the HDR target (same program key as the real draw)
    if (added && compile) finishLinks();
    for (const c of [...keepScene.children]) keepScene.remove(c);   // the materials stay referenced in keepMats (never disposed)
    return added;
  }
  // three.js finishes linking (status / info-log / uniform lookup) lazily on a program's first draw, which on some GPUs is where the
  // real cost is; do it now for every kept program so the first real draw is free
  function finishLinks() { for (const c of keepScene.children) { try { const pr = renderer.properties.get(c.material).currentProgram; if (pr && !pr.__fin) { pr.__fin = 1; pr.getUniforms(); pr.getAttributes(); } } catch (e) {} } }
  async function keepProgramsAsync(root) {   // startup prewarm: parallel compile where KHR_parallel_shader_compile exists
    root.traverse(o => { if (o.material && !Array.isArray(o.material)) o.visible = true; });
    const n = keepPrograms(root, false); if (!n) return 0;
    for (const c of keepMats.values()) keepScene.add(c);
    const rt = renderer.getRenderTarget(); try { post.begin(); const pr = renderer.compileAsync ? renderer.compileAsync(keepScene, camera) : renderer.compile(keepScene, camera); renderer.setRenderTarget(rt); await pr; finishLinks(); } catch (e) {} renderer.setRenderTarget(rt);
    for (const c of [...keepScene.children]) keepScene.remove(c);
    return n;
  }
  function viewFor(s) {
    let v = views.get(s.id);
    if (!v) { v = createSystemView(s, { quality: qName }); views.set(s.id, v); sysScene.add(v.group); v.setPR(pixelRatio); keepPrograms(v.group);
      if (views.size > 3) { for (const [k, ov] of views) if (ov !== v && ov !== activeView) { if (terr && terr.view === ov) { terr.dispose(); terr = null; attach = null; } ov.dispose(); views.delete(k); break; } } }
    return v;
  }

  // ---------- surface ----------
  const surf = createSurface({ renderer, quality: qName });
  let active = 'space', landing = null, landTimer = 0, surfEnt = null; const surfDir = V(), surfInput = V();
  const fade = document.createElement('div');
  Object.assign(fade.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '1', opacity: '0', background: '#000' });
  host.appendChild(fade);
  const setFade = (o, c) => { fade.style.opacity = String(clamp(o, 0, 1)); if (c != null) fade.style.background = '#' + new THREE.Color(c).getHexString(); };
  const GROUND = { ice: [0xe8eaee, 0x9aa0a8], icegray: [0xc8c4c0, 0x76716b], darkice: [0x9a9692, 0x4c4946], dark: [0x6e6258, 0x2c2622], gray: [0x9a948c, 0x4a4640],
    red: [0xb06a48, 0x5a2c1c], hyperion: [0xd0ba92, 0x4e3e2a], iapetus: [0xe6e2da, 0x3a2e26], miranda: [0xd0d2d6, 0x6a6c70], io: [0xe0c850, 0x9a5a24],
    europa: [0xf0ebe0, 0xa07850], ganymede: [0xb0a594, 0x5a5045], callisto: [0x8a7b68, 0x3b342c], enceladus: [0xf6f8fa, 0xc0c8d0], triton: [0xe6d6cc, 0xa89088],
    moon: [0xa8a49e, 0x5a5652], mercury: [0x9a9188, 0x4e4842], charon: [0xb0aca8, 0x5a5652], pluto: [0xd8c0a0, 0x7a5a40] };
  const PRESET = {
    mercury: { craters: 1, ridges: 0.5 },
    venus: { ground: [0x9a6e38, 0x4a3014], ridges: 0.3, rocks: 0.6 },
    earth: { ground: [0x8a7a58, 0x4e4632], veg: 0x3c5a26, rock: 0x6a625a, rocks: 0.5, water: { color: 0x0a3a5a, level: -40 }, snowLine: 1700 },
    moon: { craters: 1, rough: 0.8, ridges: 0.3 },
    mars: { ground: [0xc0683c, 0x6e3620], dunes: 0.6, craters: 0.35, ridges: 0.6 },
    titan: { ground: [0x8a6430, 0x45301a], ridges: 0.2, dunes: 0.5 },
    pluto: { craters: 0.5 }, io: { ridges: 0.25 }, europa: { ridges: 0.15, rough: 0.5, craters: 0.2 },
    callisto: { craters: 1 }, ganymede: { craters: 0.7 }, charon: { craters: 0.8 },
  };
  function surfaceSpec(e, o = {}) {
    const s = e.sys, b = e.b, v = viewFor(s);
    const star = s.stars[0], au = b.au ?? (b.parent && s.bodyMap[b.parent].au) ?? 1;
    const sc = star.cls === 'BH' ? [1, 0.6, 0.3] : new THREE.Color(...star.color).lerp(new THREE.Color(1, 1, 1), 0.3).toArray();
    const A = atmoParams(b);
    const sunAngle = star.cls === 'BH' ? 0 : clamp(star.R * RSUN_KM / (au * 1.496e8), 0.0012, 0.35);
    let spec = { seed: b.seed || hash(b.key), atmo: A, sunColor: sc, sunAngle, sunLight: star.cls === 'BH' ? 0.25 : 1, radiusM: b.radiusKm * 1000, type: b.type };
    if (b.sol) {
      const p = PRESET[b.key] || {};
      Object.assign(spec, { seed: hash(b.key), ground: GROUND[b.tex] || GROUND.gray, craters: A ? 0 : 0.8 }, p);
    } else {
      const P = b.palette, airless = !A;
      Object.assign(spec, { ground: [P[0], P[1]], rock: P[2], ridges: b.type === 'ice' ? 0.25 : b.type === 'desert' ? 0.4 : 0.6, rough: b.type === 'desert' ? 0.7 : 1,
        rocks: b.type === 'desert' ? 0.5 : 1, craters: airless && b.type !== 'lava' ? 1 : 0, dunes: b.type === 'desert' ? 1 : 0 });
      if (b.type === 'ocean') Object.assign(spec, { ground: [0x9a8a64, 0x5a5038], veg: P[0], rock: 0x5e5850, water: { color: P[2], level: -40 }, snowLine: 1500 + (b.tempK - 288) * 60 });
      if (b.type === 'lava') Object.assign(spec, { ground: [0x5a3a2c, 0x24160f], rock: 0x2a1a14, lava: { color: P[2], level: -70 } });   // brighter crust (lava light: surface.js uGlow)
      if (b.type === 'ice') spec.snowLine = -1e9;
    }
    // what hangs in the sky: parent planet for moons, largest moon for planets
    let other = null, ang = 0;
    if (b.kind === 'moon') { other = s.bodyMap[b.parent]; ang = clamp(2 * Math.atan(other.radiusKm / (b.km || other.radiusKm * 20)) / D2R, 6, 32); }
    else { const ms = s.bodies.filter(m => m.parent === b.key).sort((x, y) => y.radiusKm - x.radiusKm); if (ms[0]) { other = ms[0]; ang = clamp(2 * Math.atan(other.radiusKm / other.km) / D2R, 2.5, 8); if (b.key === 'earth') ang = 1.0; } }
    if (other) { const it = v.itemByKey(other.key), u = it.mesh.material.uniforms || {};
      const map = u.uMap && u.uMap.value && u.uMap.value.image && u.uMap.value.image.width > 1 ? u.uMap.value : null;
      const ringMap = it.rings && it.rings.material.uniforms && it.rings.material.uniforms.uTex.value ? it.rings.material.uniforms.uMap.value : null;
      spec.skyBody = { map, color: other.palette ? other.palette[0] : 0xbbbbbb, ang, elev: 0.2, azim: -0.5, ringMap, tilt: (other.tilt || 0) * D2R * 0.3 }; }
    // local time of day from the real geometry (direction to the star at the landing point); dusk if on the night side
    const P = e.loc().p, starP = bodyPosition(s, star, simDays, V());
    let elev = Math.asin(clamp(surfDir.dot(V().copy(starP).sub(P).normalize()), -1, 1)) / D2R;
    if (elev < 4) elev = 4 + (hash(b.id, 'dusk') % 50) / 10;
    spec.sunElev = o.sunElevation ?? Math.min(elev, 72); spec.sunAz = o.sunAzimuth ?? -40;
    return spec;
  }

  // ---------- helpers ----------
  const camUni = V(), camGal = V();
  let camSys = V();
  function nearestDistLy() {
    const l = cam.loc; nearestDistLy.r = 0;
    if (l.sys && activeView) {
      let d = Infinity;
      for (const it of activeView.items) {
        let di;
        if (terr && it === terr.it) { const ti = terrInfo(); di = ti ? Math.max(ti.alt, 0.5) / ti.mPerSu : camSys.distanceTo(it.world) - it.r; }
        else if (it.star || !it.b.radiusKm) di = camSys.distanceTo(it.world) - it.r;
        else di = l.p.distanceTo(bodyPosition(l.sys, it.b, simDays, V())) - it.r * (isGiant(it.b) ? gasDeck(it.b) : 1);   // camera and body both at this frame   // this frame's position: it.world lags a frame (planets move far per frame)
        if (di < d) { d = di; nearestDistLy.r = it.r * K; }
      }
      return Math.max(d, 1e-11) * K;
    }
    const g = galOf(l);
    if (g) {
      let d = Infinity;
      if (stars.galaxy === g && g.id === stars.galaxy.id) { if (frameNo % 6 === 0 || nearestDistLy.cache == null) { for (const st of stars.all()) d = Math.min(d, st.gpos.distanceTo(camGal)); nearestDistLy.cache = d; } else d = nearestDistLy.cache; }
      const r = camGal.length();
      if (r > g.R * 1.1) d = Math.max(Math.min(d, r - g.R), r - g.R);
      return Math.max(d, 0.01);
    }
    let d = Infinity; for (const gg of uni.galaxies) d = Math.min(d, camUni.distanceTo(gg.center) - gg.R);
    return Math.max(d, 1000);
  }
  const lookQ = (dir, up, out = new THREE.Quaternion()) => out.setFromRotationMatrix(new THREE.Matrix4().lookAt(ZERO, dir, up));
  function setMode(m) { if (m !== mode) { mode = m; ev('se2:modechange', { mode }); } }
  function focusLoc() { return focus.loc(); }
  function distanceText() {
    if (!focus) return '';
    const dLy = delta(cam.loc, focus.loc()).length();
    if (focus.b && cam.loc.sys === focus.sys) {
      const rSu = focus.b.radiusSu, dSu = dLy / K, km = focus.b.kind === 'star' ? focus.b.R * RSUN_KM : focus.b.radiusKm;
      if (dSu < rSu * 60) return Math.round(Math.max(0, dSu / rSu - 1) * km).toLocaleString('en-US') + ' km above';
      const au = focus.sys.realScale ? dSu / AU_SU : dSu > 16 ? Math.pow((dSu - 16) / 26, 1 / 0.6) : dSu / 16 * 0.01;
      return (au < 0.1 ? au.toFixed(3) : au.toFixed(au < 10 ? 2 : 0)) + ' AU';
    }
    return fmtDist(dLy);
  }

  // ---------- body frames / terrain helpers (seamless flight) ----------
  // system-frame rotation of a body's surface frame (= sysview tilt group * spinning mesh)
  function bodySpin(s, b, days) {
    if (b.locked && b.kind === 'moon') { const pw = bodyPosition(s, s.bodyMap[b.parent], days, V()), w = bodyPosition(s, b, days, V()); pw.sub(w); return Math.atan2(pw.x, pw.z) - Math.PI / 2; }
    return b.dayHours ? (days * 24 / b.dayHours) * Math.PI * 2 * SPIN % (Math.PI * 2) : 0;
  }
  function bodyRot(s, b, days) { return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (b.tilt || 0) * D2R).multiply(new THREE.Quaternion().setFromAxisAngle(Y, bodySpin(s, b, days))); }
  const isGiant = b => !!(b && (b.type === 'gas' || b.type === 'icegiant') && b.radiusKm);
  const gasDeck = b => isGiant(b) ? 1 + (GAS_LAYERS.floor + 300) / (b.radiusKm * 1000) : 1;   // flight floor: 300 m above the deep cloud deck (no solid ground)
  // altitude above the terrain under the camera (metres); cached per frame and camera position
  function terrInfo() {
    if (!terr || !cam.loc.sys || cam.loc.sys !== terr.sys) return null;
    const p = cam.loc.p;
    if (tiCache && tiCache.f === frameNo && tiCache.x === p.x && tiCache.y === p.y && tiCache.z === p.z) return tiCache.v;
    const s = terr.sys, b = terr.it.b, bw = bodyPosition(s, b, simDays, V()), qB = bodyRot(s, b, simDays);
    const v = V().copy(p).sub(bw), Dsu = v.length() || 1e-12, loc = v.clone().applyQuaternion(qB.clone().invert()).divideScalar(Dsu);
    const surfR = terr.surfaceR(loc.x, loc.y, loc.z), D = Dsu * terr.mPerSu;
    const out = { alt: D - surfR, D, surfR, bw, qB, dirSys: v.divideScalar(Dsu), mPerSu: terr.mPerSu, R: terr.R };
    tiCache = { f: frameNo, x: p.x, y: p.y, z: p.z, v: out }; return out;
  }
  const clearance = () => 1.7 + (terr ? Math.min((terr.lastSp || terr.spacing) * 0.02, 1.5) : 0);   // eye height + small margin (the ground height already comes from the drawn mesh itself)   // eye height + margin for the drawn tile's coarseness under us
  function pushOutOfGround(ti) {   // returns true if the camera had to be lifted
    if (!ti) return false; const c = clearance(); if (ti.alt >= c) return false;
    cam.loc.p.copy(ti.bw).addScaledVector(ti.dirSys, (ti.surfR + c) / ti.mPerSu); tiCache = null; return true;
  }

  // ---------- flights ----------
  function startFlight(e, opts = {}) {
    exitSurfaceNow();
    const T = e.loc(), startLoc = cam.loc;
    // final viewing direction (frame-local): approach side blended toward the star's day side
    const away = delta(T, startLoc).applyQuaternion(e.frameQ.clone().invert());
    let dirF = away.clone().normalize();
    if (e.kind === 'planet' || e.kind === 'moon') {
      const toStar = V().copy(T.p).negate().normalize();
      dirF = away.clone().setY(0).normalize().multiplyScalar(0.8).add(toStar.setY(0).normalize().multiplyScalar(1.6));
      if (dirF.lengthSq() < 1e-8) dirF.set(1, 0, 0);
      dirF.normalize();
    }
    const theta1 = Math.atan2(dirF.x, dirF.z) + (e.kind === 'galaxy' ? 0 : 0.35), phi1 = e.kind === 'galaxy' ? 0.85 : opts.phi ?? 1.2;
    const dist1 = opts.dist ?? e.viewLy;
    const F = sph(dist1, phi1, theta1, V()).applyQuaternion(e.frameQ);
    const D = delta(startLoc, T).add(F), L = D.length();
    const a = Math.max(nearestDistLy() * 0.5, L * 1e-12, 1e-9), b = Math.max(dist1 * 0.5, 1e-9);
    const dur = opts.dur ?? clamp(1.4 + 0.2 * (Math.log10(1 + L / a) + Math.log10(1 + L / b)), 1.4, 9);
    flight = { e, S: { ...startLoc, p: startLoc.p.clone() }, F, theta1, phi1, dist1, a, b, t: 0, dur, q0: cam.q.clone(), last: null };
    if (e.sys) pinned.add(e.sys.id);
    fly.input.set(0, 0, 0); fly.vel.set(0, 0, 0);
    setMode('flight');
  }
  function updateFlight(dt) {
    const f = flight; f.t += dt / f.dur; const t = Math.min(1, f.t), u = easeInOut(t);
    const T = f.e.loc(), D = delta(f.S, T).add(f.F), L = D.length(), Dn = D.clone().divideScalar(L || 1);
    const prev = cam.loc;
    if (L < 4 * (f.a + f.b)) cam.loc = addDelta(T, f.F.clone().sub(D.clone().multiplyScalar(1 - u)));
    else if (u <= 0.5) { const k = L / (2 * f.a); const ds = (L / 2) * (Math.pow(k, 2 * u) - 1) / (k - 1); cam.loc = addDelta(f.S, Dn.clone().multiplyScalar(ds)); }
    else { const k = L / (2 * f.b); const dd = (L / 2) * (Math.pow(k, 2 * (1 - u)) - 1) / (k - 1); cam.loc = addDelta(T, f.F.clone().sub(Dn.clone().multiplyScalar(dd))); }
    fly.speed = prev ? delta(prev, cam.loc).length() / Math.max(dt, 1e-3) : 0;
    const look = delta(cam.loc, T); if (look.lengthSq() < 1e-40) look.copy(f.F).negate();
    const up = Y.clone().applyQuaternion(f.e.frameQ);
    const ql = lookQ(look.normalize(), up);
    cam.q.copy(f.q0).slerp(ql, easeInOut(Math.min(1, t / 0.3)));
    if (t >= 1) {
      focus = f.e; orb.theta = cur.theta = f.theta1; orb.phi = cur.phi = f.phi1; orb.dist = f.dist1; cur.ld = Math.log(f.dist1); orbSpin = null;
      flight = null; setMode('orbit'); fly.speed = 0;
      discover(focus); ev('se2:arrived', { id: focus.id, name: focus.name });
    }
  }

  // ---------- per-frame camera ----------
  const fwd = V(), right = V(), upv = V();
  function updateCamera(dt) {
    if (mode === 'flight') return updateFlight(dt);
    if (mode === 'orbit' && fd && focus === fd.e) { attach = null; setMode('free'); }
    if (mode === 'orbit') {
      if (attach && focus && attach.b !== focus.b) attach = null;   // jumped to another body: drop the old frame lock (altitude readout kept Saturn at the Sun)
      const k = 1 - Math.exp(-dt * 8);
      cur.theta += (orb.theta - cur.theta) * k; cur.phi += (orb.phi - cur.phi) * k; cur.ld += (Math.log(orb.dist) - cur.ld) * k;
      const off = sph(Math.exp(cur.ld), cur.phi, cur.theta, V()).applyQuaternion(focus.frameQ), up = Y.clone().applyQuaternion(focus.frameQ);
      // landable bodies: the orbit turns with the planet's spin, so the ground below never drifts sideways
      if (focus.b && focus.b.landable && focus.sys && SEAMLESS()) {
        const a = bodySpin(focus.sys, focus.b, simDays);
        if (!orbSpin || orbSpin.e !== focus) orbSpin = { e: focus, a0: a };
        const axis = Y.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), (focus.b.tilt || 0) * D2R).applyQuaternion(focus.sys.uq);
        off.applyAxisAngle(axis, a - orbSpin.a0); up.applyAxisAngle(axis, a - orbSpin.a0);
      }
      cam.loc = addDelta(focusLoc(), off);
      lookQ(off.clone().negate().normalize(), up, cam.q);
      if (terr && focus.b === terr.it.b && pushOutOfGround(terrInfo())) {   // zoomed into a mountain: sit on top of it
        const dl = delta(focusLoc(), cam.loc).length(); orb.dist = Math.max(orb.dist, dl); cur.ld = Math.log(dl);
      }
      return;
    }
    if (mode === 'free') {
      // co-move with the planet we are close to (orbit + spin): a hovering camera stays over the same spot
      if (attach) {
        if (cam.loc.sys !== attach.s) attach = null;
        else {   // express the camera (incl. any look/zoom input since last frame) in last frame's body frame, then re-place it in this frame's
          const s = attach.s, qBi = attach.qB.clone().invert(), local = V().copy(cam.loc.p).sub(attach.bw).applyQuaternion(qBi), qL = qBi.multiply(s.uqi).multiply(cam.q);
          const bw = bodyPosition(s, attach.b, simDays, V()), qB = attach.spin ? bodyRot(s, attach.b, simDays) : new THREE.Quaternion();
          cam.loc.p.copy(local).applyQuaternion(qB).add(bw); cam.q.copy(s.uq).multiply(qB).multiply(qL).normalize(); tiCache = null; }
      }
      if (fd) flyDownStep(dt);
      let near = nearestDistLy();
      const ti0 = terrInfo(); if (ti0 && ti0.alt < 2e4) near = Math.max(near, 5 / ti0.mPerSu * K);   // never slower than ~5 m/s (x boost) near the ground
      const gMPerSu = gasState && gasState.h < GAS_FADE[0] ? gasState.it.b.radiusKm * 1000 / gasState.it.r : 0; if (gMPerSu) near = Math.max(near, 5 / gMPerSu * K);
      // speed follows the distance to the nearest thing, times the boost; capped per scale so a big boost can't fling you out of the universe
      const speed = Math.min(clamp(near * 0.9, 1e-13, 5e8) * boost, cam.loc.sys ? Infinity : cam.loc.gal ? 3000 : 3e6);
      fly.dbg = { near, speed, input: fly.input.toArray(), dt };
      fly.vel.lerp(V().copy(fly.input).multiplyScalar(speed), 1 - Math.exp(-dt * 5));
      // ENGINE BRAKE (Space Engine style), independent of the boost: inside a system the speed is limited by the distance to the nearest
      // body's surface: ~2 x altitude per second within 50 radii, opening up quadratically beyond (full boost again far from bodies).
      // On top of that one frame may never move more than 40% of that distance, so no frame can jump past or into a body.
      if (cam.loc.sys && nearestDistLy.r > 0) {
        const R = nearestDistLy.r; let lim = near * 2 * Math.max(1, (near / (50 * R)) ** 2);
        // close pass (< 20 radii): for 8 s afterwards the speed stays capped at 40 radii/s, so a near miss can't fling you out of the system
        if (near < 20 * R) passT = { t: performance.now(), R };
        if (passT && performance.now() - passT.t < 8000) lim = Math.min(lim, 40 * passT.R); else passT = null;
        const stepMax = 0.4 * near / Math.max(dt, 1e-4);
        const vmax = Math.min(lim, stepMax), vl = fly.vel.length();
        fly.braking = vl > vmax * 1.001 && fly.input.lengthSq() > 0; if (vl > vmax) fly.vel.multiplyScalar(vmax / vl);
        fly.dbg.lim = vmax;
      } else fly.braking = false;
      // aim assist (boost > 10, flying forward): if a planet/moon within 1500 radii is within ~20 deg (35 deg inside 150 radii, 46 deg for the selected/focused body) of the heading, the view turns
      // toward it (stronger closer and the more boost) so an off-centre or drifting target is still met instead of overshot
      if (boost > 10 && fly.input.z > 0.3 && cam.loc.sys && activeView && !fd) {
        const s = cam.loc.sys, f0 = V(0, 0, -1).applyQuaternion(cam.q); let tgt = null, tb = Infinity;
        for (const it of activeView.items) { if (it.star || !it.b.radiusKm) continue;
          const rel = bodyPosition(s, it.b, simDays, V()).sub(cam.loc.p), dR = rel.length() / it.r; if (dR > 1500 || dR < 1.3) continue;
          rel.applyQuaternion(s.uq).normalize(); const ang = Math.acos(clamp(rel.dot(f0), -1, 1)); const isPref = (selected && selected.b === it.b) || (focus && focus.b === it.b); if (ang > (isPref ? 0.8 : dR < 150 ? 0.61 : 0.35)) continue;
          const sc = (ang + 0.05 * Math.log10(dR)) * (it.b.kind === 'moon' && dR > 20 ? 3 : 1) * (isPref ? 0.3 : 1); if (sc < tb) { tb = sc; tgt = { dir: rel, ang }; } }
        if (tgt && tgt.ang > 1e-4) { const k = (1 - Math.exp(-dt * 2.5)) * clamp(Math.log10(boost) / 3, 0.3, 1);
          const qd = new THREE.Quaternion().setFromUnitVectors(f0, tgt.dir), qk = new THREE.Quaternion().slerp(qd, k);
          cam.q.premultiply(qk).normalize(); fly.vel.multiplyScalar(1 - k * 0.5 * tgt.ang / 0.61); }
      }
      fwd.set(0, 0, -1).applyQuaternion(cam.q); right.set(1, 0, 0).applyQuaternion(cam.q); upv.set(0, 1, 0).applyQuaternion(cam.q);
      const d = V().addScaledVector(right, fly.vel.x * dt).addScaledVector(upv, fly.vel.y * dt).addScaledVector(fwd, fly.vel.z * dt);
      // skim assist: near the ground, flying level (pitch within ~15 deg) holds altitude instead of slowly climbing / sinking
      const upH = ti0 && ti0.alt < 5000 ? ti0.dirSys.clone() : gasState && gasState.h < GAS_LAYERS.ammonia ? V().copy(camSys).sub(gasState.it.world).normalize() : null;
      if (upH && cam.loc.sys) { const U = upH.applyQuaternion(cam.loc.sys.uq), fz = fwd.dot(U);
        if (Math.abs(fz) < 0.3) d.addScaledVector(U, -fz * fly.vel.z * dt * smooth(0.3, 0.2, Math.abs(fz))); }   // full hold within ~11 deg of level, fades out by ~17 deg
      cam.loc = addDelta(cam.loc, d);
      fly.speed = fly.vel.length();
      { const tv = terrInfo(); fly.mps = tv && tv.alt < tv.R * 4 ? fly.speed / K * tv.mPerSu : null; if (fly.mps == null && gMPerSu) fly.mps = fly.speed / K * gMPerSu; if (fly.mps != null) fly.speed = fly.mps / 9.4607e15; }   // near a terrain world: report true m/s (as ly/s) instead of compressed-scale speed
      if (cam.loc.sys && activeView) for (const it of activeView.items) {   // keep out of bodies (terrain worlds: collision with the ground below)
        if (terr && it === terr.it) continue;
        const w = it.star || !it.b.radiusKm ? it.world : bodyPosition(cam.loc.sys, it.b, simDays, V());   // this frame's position (it.world is last frame's: planets move km per frame)
        const v = V().copy(cam.loc.p).sub(w), m = it.r * (it.star ? 1.06 : isGiant(it.b) ? gasDeck(it.b) : 1.06); if (v.length() < m) cam.loc.p.copy(w).addScaledVector(v.normalize(), m);
      }
      tiCache = null;
      const ti = terrInfo();
      if (ti) {
        pushOutOfGround(ti);
        // level the horizon as we come down: camera "up" turns toward the local vertical
        const k = clamp(1.2 - ti.alt / ti.R * 2, 0, 1);
        if (k > 0) {
          const upU = ti.dirSys.clone().applyQuaternion(cam.loc.sys.uq), f = V().set(0, 0, -1).applyQuaternion(cam.q), u = V().set(0, 1, 0).applyQuaternion(cam.q);
          const want = upU.clone().addScaledVector(f, -f.dot(upU));
          if (want.lengthSq() > 1e-6) { want.normalize(); let ang = Math.acos(clamp(u.dot(want), -1, 1)); if (V().crossVectors(u, want).dot(f) < 0) ang = -ang;
            cam.q.premultiply(new THREE.Quaternion().setFromAxisAngle(f, ang * k * (1 - Math.exp(-dt * 2.5)))).normalize(); }
        }
      }
      updateLock();
    }
  }
  // ---------- moving frame lock (manual free flight and fly-down) ----------
  // Inside a body's sphere of influence the camera co-moves with its orbit, so flying toward a planet always closes in (in the compressed
  // layout planets cover several radii per second). Within ~5 radii it also turns with the planet's spin: the ground below stays put.
  // sphere of influence (system units): under 0.4 x its orbit and under 0.45 x the current distance to any neighbour of the same rank
  // (planets vs planets/star, moons vs their parent and sibling moons), so neighbouring spheres never overlap in the compressed layout
  function soiOf(it, s, pos) {
    const b = it.b; let lim = Math.min((b.orbitSu || 40 * it.r) * 0.4, 80 * it.r), w = pos.get(it);
    for (const o of activeView.items) {
      if (o === it) continue;
      const ob = o.b, rank = o.star || ob.kind === 'planet' ? 'p' : ob.parent;
      const mine = b.kind === 'planet' ? 'p' : b.parent;
      if (!(rank === mine || (b.kind === 'moon' && ob.key === b.parent))) continue;
      lim = Math.min(lim, 0.45 * w.distanceTo(pos.get(o) || o.world));
    }
    return Math.max(lim, 6 * it.r);
  }
  function updateLock() {
    const s = cam.loc.sys; if (!s || !activeView || !SEAMLESS()) { attach = null; return; }
    const pos = new Map(); for (const it of activeView.items) pos.set(it, it.star || !it.b.radiusKm ? it.world : bodyPosition(s, it.b, simDays, V()));
    let best = null, bd = Infinity;
    const pref = [fd && fd.e.b, attach && attach.b, selected && selected.b, focus && focus.b];
    for (const it of activeView.items) {
      if (it.star || !it.b.radiusKm) continue;
      const w = pos.get(it), d = cam.loc.p.distanceTo(w), dR = d / it.r;
      const keep = attach && attach.b === it.b ? 1.15 : 1;   // hysteresis for the body we're already locked to
      if (d > soiOf(it, s, pos) * keep) continue;
      // rank: inside several spheres (a moon inside its planet's) -> the smaller sphere wins; a preferred body (target / current lock /
      // selected / focused) wins over a neighbour unless we're within 3 radii of that neighbour
      const score = dR / keep * (pref.includes(it.b) ? 0.2 : 1) * (dR < 3 ? 0.05 : 1);
      if (score < bd) { bd = score; best = { it, w, dR }; }
    }
    if (!best) { attach = null; return; }
    const same = attach && attach.b === best.it.b, spin = best.dR < 5 || (same && attach.spin && best.dR < 6);
    attach = { s, b: best.it.b, bw: best.w, qB: spin ? bodyRot(s, best.it.b, simDays) : new THREE.Quaternion(), spin, dR: best.dR };
  }

  // ---------- fly-down autopilot: from wherever we are to a few metres above the ground (or the cloud deck) of body e ----------
  const FD_TIME = 0.05;
  function flyDownStart(id) {
    let e = typeof id === 'object' ? id : entity(id);
    if (!e && typeof id === 'string') { const r = search(id).find(x => x.kind === 'planet' || x.kind === 'moon') || search(id)[0]; e = r && entity(r.id); }
    if (!e || !e.b || !e.sys || (e.kind !== 'planet' && e.kind !== 'moon')) { console.warn('[SE2] flyDown: not a planet or moon', id); return false; }
    exitSurfaceNow(); selected = e; discover(e);
    fd = { e, t: 0 };
    const near = cam.loc.sys === e.sys && activeView && delta(cam.loc, e.loc()).length() < e.radiusLy * 30;
    if (near) { focus = e; attach = null; flight = null; setMode('free'); }
    else startFlight(e);
    ev('se2:flydown', { id: e.id, name: e.name });
    return true;
  }
  function flyDownStep(dt) {
    const e = fd.e, s = e.sys; if (cam.loc.sys !== s) { fd = null; return; }
    // descent clock: real elapsed time (up to 0.4 s), so slow devices whose frames hit the 0.1 s cap don't crawl down in slow motion
    const nowT = performance.now(); if (fd.last) dt = clamp((nowT - fd.last) / 1000, dt, 0.4); fd.last = nowT;
    fd.t += dt;
    const ti = terrInfo(), onTerr = ti && terr.it.b === e.b;
    const bw = onTerr ? ti.bw : bodyPosition(s, e.b, simDays, V());
    // co-move with the target (fast inner planets cover many radii per second): without this the descent can never catch up
    if (fd.bw && !(attach && attach.b === e.b)) { cam.loc.p.add(V().copy(bw).sub(fd.bw)); tiCache = null; }
    fd.bw = bw.clone();
    const v = V().copy(cam.loc.p).sub(bw), Dsu = v.length() || 1e-12, dir = v.clone().divideScalar(Dsu);
    const Rm = e.b.radiusKm * 1000, mPerSu = Rm / e.b.radiusSu;
    // while still high, swing round to the day side so we arrive in daylight
    const star = activeView && activeView.items.find(x => x.star);
    if (star && Dsu * mPerSu - Rm > 30e3) {
      // aim ahead of the sun by the spin still to come during the rest of the descent, so we touch down near local noon
      const h0 = Dsu * mPerSu - Rm, tLeft = (h0 > 2e5 ? Math.log(h0 / 2e5) / 1.1 : 0) + Math.log(Math.min(h0, 2e5) / 2000) / 0.8 + Math.log(2000 / 5) / 1.0;
      let dS = bodySpin(s, e.b, simDays + 0.01) - bodySpin(s, e.b, simDays); if (dS > Math.PI) dS -= 2 * Math.PI; if (dS < -Math.PI) dS += 2 * Math.PI;
      const lead = clamp(dS / 0.01 * timeSpeed * FD_TIME * tLeft, -2.6, 2.6), axis = Y.clone().applyQuaternion(bodyRot(s, e.b, simDays));
      const sd = V().copy(star.world).sub(bw).normalize().applyAxisAngle(axis, -lead), c = dir.dot(sd); fd.dbg = { c, lead, tLeft };
      if (c < 0.85) { const ax = V().crossVectors(dir, sd); if (ax.lengthSq() < 1e-10) ax.set(0, 1, 0).cross(dir); ax.normalize();
        dir.applyAxisAngle(ax, Math.min(Math.acos(clamp(c, -1, 1)) - Math.acos(0.85), 0.9 * dt)).normalize(); }
    }
    const surfR = onTerr ? ti.surfR : Rm * gasDeck(e.b), alt = Dsu * mPerSu - surfR;
    const target = !e.b.landable ? 1200 : onTerr && terr.ready ? clearance() + 0.3 : 2000;     // metres above the ground (just over the collision clearance) / cloud deck
    // altitude decays exponentially (fast high up, gentle near the ground: the terrain detail has time to stream in)
    // low down: quicker decay plus a minimum sink rate (~6 m/s) that only eases off over the last few metres, so touchdown never creeps
    const rate = alt > 2e5 ? 1.1 : alt > 2000 ? 0.8 : 1.0, gap = alt - target;
    const na = target + gap * Math.exp(-rate * dt) - (gap > 0 ? Math.min(gap, 6 * smooth(0, 6, gap) * dt + 0.3 * dt) : 0);
    cam.loc.p.copy(bw).addScaledVector(dir, (surfR + na) / mPerSu); tiCache = null;
    // attitude: look down while high, turn to the horizon near the ground (roll levelled by the free-flight code)
    const U = dir.clone().applyQuaternion(s.uq), f = V(0, 0, -1).applyQuaternion(cam.q);
    let t = f.clone().addScaledVector(U, -f.dot(U)); if (t.lengthSq() < 1e-6) t = V(1, 0, 0).applyQuaternion(cam.q).cross(U).negate(); t.normalize();
    const pitch = -Math.PI / 2 + 0.06 + (Math.PI / 2 - 0.06 - 0.1) * smooth(30000, 150, na);   // ends ~6 deg below the horizon
    const want = t.multiplyScalar(Math.cos(pitch)).addScaledVector(U, Math.sin(pitch)).normalize();
    cam.q.slerp(lookQ(want, U), 1 - Math.exp(-dt * 2.5));
    if (fly.input.lengthSq() > 0) { fd = null; return; }            // any stick / key input takes over at once
    fly.vel.set(0, 0, 0);
    // arrived: at the target height, or no longer getting lower (the ground clearance holds us up) for ~1.5 s, or a generous timeout
    if (na < (fd.best ?? Infinity) - 0.25) { fd.best = na; fd.still = 0; } else fd.still = (fd.still || 0) + dt;
    const settled = !e.b.landable || (onTerr && terr.ready);   // rocky: only once the real ground is under us
    const arrived = settled && (Math.abs(na - target) < Math.max(1.5, target * 0.2) || (alt < 3000 && fd.still > 1.0));
    if (arrived || fd.t > 120) { const done = e; fd = null; ev('se2:flydown-done', { id: done.id, name: done.name, landed: !!done.b.landable && arrived, deck: !done.b.landable && arrived }); }
  }
  function enterFree() {
    if (mode === 'free') return;
    flight = null; attach = null; setMode('free');
  }

  // ---------- landing ----------
  function canLand(id) { const e = entity(id); return !!(e && e.b && e.b.landable); }
  function land(id, lo = {}) {
    const e = id ? entity(id) : focus;
    if (!e || !e.b || !e.b.landable || ['landing', 'takeoff', 'surface'].includes(mode)) return false;
    if (focus !== e || mode !== 'orbit') {
      goTo(e.id);
      const once = ev2 => { if (ev2.detail.id === e.id) { removeEventListener('se2:arrived', once); land(e.id, lo); } };
      addEventListener('se2:arrived', once); return true;
    }
    const tCall = performance.now(), T = e.loc();
    surfEnt = e; surfDir.copy(cam.loc.sys === e.sys ? cam.loc.p : toSys(cam.loc, e.sys)).sub(T.p).normalize();
    const spec = surfaceSpec(e, lo); surf.enter(spec); surfInput.set(0, 0, 0); fly.input.set(0, 0, 0);
    landing = { kind: 'land', e, t0: tCall, d0: Math.exp(cur.ld) / K, color: surf.fadeColor() };
    setMode('landing'); discover(e);
    landTimer = setTimeout(() => { landing = null; active = 'surface'; setFade(0); setMode('surface'); ev('se2:landed', { id: e.id, name: e.name }); }, Math.max(0, LAND_MS - (performance.now() - tCall)));
    return true;
  }
  function takeOff() {
    if (mode !== 'surface' || !surfEnt) return false;
    const sp = surf.spec;
    landing = { kind: 'takeoff', e: surfEnt, t0: performance.now(), h0: surf.state.hover, color: surf.fadeColor() };
    setMode('takeoff'); landTimer = setTimeout(() => finishTakeoff(surfEnt), LAND_MS);
    return true;
  }
  function orbitFromSurf(e) {
    orbSpin = null;
    focus = e; orb.dist = e.viewLy; cur.ld = Math.log(orb.dist);
    orb.theta = cur.theta = Math.atan2(surfDir.x, surfDir.z); orb.phi = cur.phi = clamp(Math.acos(clamp(surfDir.y, -1, 1)), 0.08, Math.PI - 0.08);
  }
  function finishTakeoff(e) {
    clearTimeout(landTimer); landing = null; active = 'space'; setFade(0); orbitFromSurf(e); surfEnt = null; setMode('orbit'); ev('se2:tookoff', { id: e.id, name: e.name });
  }
  function exitSurfaceNow() {
    if (!['landing', 'takeoff', 'surface'].includes(mode)) return;
    const e = surfEnt || (landing && landing.e); clearTimeout(landTimer); landing = null; active = 'space'; setFade(0);
    if (e) { orbitFromSurf(e); updateCamera(0); } surfEnt = null; setMode('orbit'); if (e) ev('se2:tookoff', { id: e.id, name: e.name });
  }
  function updateLanding(dt) {
    const L = landing, T = LAND_MS / 1000;
    if (mode === 'surface') { surf.update(dt, surfInput); return; }
    if (!L) return;
    const t = Math.min(T, (performance.now() - L.t0) / 1000), e = L.e, P = e.loc(), r = e.b.radiusSu;
    const place = d => { cam.loc = { gal: null, sys: e.sys, p: P.p.clone().addScaledVector(surfDir, d) }; lookQ(V().copy(surfDir).negate().applyQuaternion(e.sys.uq), Y.clone().applyQuaternion(e.sys.uq), cam.q); };
    if (L.kind === 'land') {
      const SW = 1.6;
      if (t < SW) { active = 'space'; place(L.d0 + (r * 1.012 - L.d0) * easeIn(t / SW)); setFade((t - 1.2) / 0.4, L.color); surf.warmup(8); }   // build the landing-spot terrain while we dive in
      else { active = 'surface'; const k = (t - SW) / (T - SW); surf.update(dt, surfInput.set(0, 0, 0), 160 * (1 - easeOut(k)), -1.05 + (surf.state.pitch + 1.05) * easeOut(k)); setFade(1 - (t - SW) / 0.35, L.color); }
    } else {
      const SW = 0.8;
      if (t < SW) { active = 'surface'; const k = easeIn(t / SW); surf.update(dt, surfInput.set(0, 0, 0), L.h0 + 260 * k, surf.state.pitch + (0.9 - surf.state.pitch) * k); setFade((t - 0.5) / 0.3, L.color); }
      else { active = 'space'; const k = easeOut((t - SW) / (T - SW)); place(r * 1.03 + (e.viewLy / K - r * 1.03) * k); setFade(1 - (t - SW) / 0.3, L.color); }
    }
  }

  // ---------- discoveries & bookmarks ----------
  const LS = (k, d) => { try { return JSON.parse(localStorage.getItem('se2:' + k)) ?? d; } catch { return d; } };
  let showOrbits = params.has('orbits') || LS('orbits', false) === true;   // orbit lines: off by default (clean sky)
  const saveLS = (k, v) => { try { localStorage.setItem('se2:' + k, JSON.stringify(v)); } catch {} };
  let discovered = LS('discovered:' + SEED, {}), bookmarks = LS('bookmarks', []);
  function isProcedural(e) { return e && (e.kind === 'nebula' ? !e.n.real : e.kind === 'galaxy' ? !e.g.real : !(e.sys && e.sys.real)); }
  function discover(e) {
    if (!e || !isProcedural(e) || discovered[e.id]) return;
    discovered[e.id] = { name: e.name, t: Date.now() }; saveLS('discovered:' + SEED, discovered); ev('se2:discovered', { id: e.id, name: e.name });
  }

  // ---------- info ----------
  const fmt = (v, d = 2) => v == null || !isFinite(v) ? '–' : Math.abs(v) >= 1e5 ? Math.round(v).toLocaleString('en-US') : (+v.toPrecision(Math.max(1, d + 1))).toLocaleString('en-US');
  let factsP = null, facts = [];
  function info(id) {
    const e = typeof id === 'object' ? id : entity(id); if (!e) return null;
    const out = { id: e.id, name: e.name, kind: e.kind, real: !isProcedural(e), procedural: isProcedural(e), discovered: !!discovered[e.id], canLand: !!(e.b && e.b.landable), rows: [], children: [], parent: null };
    if (e.kind === 'nebula') {
      const n = e.n; out.type = n.type === 'planetary' ? 'Planetary nebula' : 'Emission nebula (star-forming region)';
      out.rows.push(['Type', out.type], ['Diameter', fmtDist(n.R * 2)]);
      if (e.g.id === 'mw') out.rows.push(['From the Sun', fmtDist(n.gpos.distanceTo(SOL_GPOS))]);
      out.fact = n.fact || null; out.parent = { id: e.g.id, name: e.g.name }; return out;
    }
    if (e.kind === 'galaxy') {
      const g = e.g; out.type = galaxyTypeLabel(g);
      out.rows.push(['Type', out.type], ['Diameter', fmtDist(g.R * 2)], ['Stars', '~' + fmt(Math.pow(g.R / 1000, 2) * (g.type === 'elliptical' ? 1.2e8 : 6e7), 1)], ['From Milky Way', g.id === 'mw' ? 'home' : fmtDist(g.center.length())]);
      out.fact = g.fact || null;
      out.children.push({ id: g.id === 'mw' ? 'sgra' : g.id + '/core', name: g.id === 'mw' ? 'Sagittarius A*' : 'Central black hole' });
      if (g.id === 'mw') out.children.push({ id: 'sol#earth', name: 'Earth' }, { id: 'sol', name: 'Sun' });
      return out;
    }
    const s = e.sys, b = e.b;
    out.system = { id: s.id, name: s.name };
    if (e.kind === 'star' || e.kind === 'blackhole') {
      out.type = b.label + (b.sub && b.sub !== '–' && e.kind !== 'blackhole' ? ' · ' + b.sub : '');
      if (e.kind === 'blackhole') out.rows.push(['Mass', fmt(b.M, 2) + ' Suns'], ['Event horizon', fmt(b.M * 2.95, 2) + ' km radius']);
      else out.rows.push(['Temperature', fmt(b.T, 3) + ' K'], ['Radius', b.R < 0.05 ? fmt(b.R * RSUN_KM, 2) + ' km' : fmt(b.R, 2) + ' × Sun'], ['Mass', fmt(b.M, 2) + ' × Sun'], ['Luminosity', fmt(b.L, 2) + ' × Sun']);
      if (s.stars.length > 1) out.rows.push(['System', 'Binary star']);
      out.rows.push(['Planets', String(s.bodies.filter(x => x.kind === 'planet').length)]);
      if (s.gal.id === 'mw') out.rows.push(['From the Sun', s.id === 'sol' ? '8.3 light-minutes from Earth' : fmtDist(s.gpos.distanceTo(SOL_GPOS))]);
      else out.rows.push(['Galaxy', s.gal.name]);
      for (const st of s.stars) if (st !== b) out.children.push({ id: st.id, name: st.name });
      for (const p of s.bodies.filter(x => x.kind === 'planet')) out.children.push({ id: p.id, name: p.name });
      out.parent = { id: s.gal.id, name: s.gal.name };
    } else {
      out.type = b.label || TYPE_LABEL[b.type];
      out.rows.push(['Radius', fmt(b.radiusKm, 3) + ' km' + (b.kind === 'planet' ? ` (${fmt(b.radiusKm / REARTH_KM, 2)} × Earth)` : '')]);
      if (b.massE) out.rows.push(['Mass', fmt(b.massE, 2) + ' × Earth']);
      out.rows.push(['Gravity', fmt(b.gravity, 2) + ' g'], ['Temperature', `${Math.round(b.tempK)} K (${Math.round(b.tempK - 273.15)} °C)`]);
      if (b.au) out.rows.push(['Orbit', fmt(b.au, 3) + ' AU · year ' + (b.periodDays < 2000 ? fmt(b.periodDays, 3) + ' days' : fmt(b.periodDays / 365.25, 3) + ' years')]);
      const moons = s.bodies.filter(x => x.parent === b.key);
      if (b.kind === 'planet') out.rows.push(['Moons', String(b.sol ? (facts.find(f => f.name === b.name)?.moons ?? moons.length) : moons.length) + (b.rings ? ' · rings' : '')]);
      if (b.atmo && !b.sol) out.rows.push(['Atmosphere', b.type === 'gas' || b.type === 'icegiant' ? 'deep H₂/He' : b.type === 'ocean' ? 'N₂/O₂-like, clouds' : 'thin']);
      for (const m of moons) out.children.push({ id: m.id, name: m.name });
      out.parent = b.parent ? { id: s.bodyMap[b.parent].id, name: s.bodyMap[b.parent].name } : { id: s.stars[0].id, name: s.stars[0].name };
    }
    const f = facts.find(x => x.name === b.name);
    out.fact = b.fact || (b.sol && f ? f.fact : null) || (e.kind === 'star' && s.stars[0] === b && s.fact) || null;
    return out;
  }

  // ---------- search ----------
  function searchIndex() {
    const out = [];
    for (const g of REAL_GALAXIES) out.push({ id: g.id, name: g.name, kind: 'galaxy' });
    out.push({ id: 'sgra', name: 'Sagittarius A*', kind: 'blackhole', alias: 'sgr a black hole milky way centre center' });
    for (const st of REAL_STARS) { if (st.id === 'sgra') continue; const s = getSystem(st.id); for (const x of [...s.stars, ...s.bodies]) out.push({ id: x.id, name: x.name, kind: x.kind, alias: st.id === 'sol' ? 'solar system' : st.name }); }
    out.push({ id: 'sol#sun', name: 'Sol', kind: 'star', alias: 'sun home star' });
    for (const n of REAL_NEBULAE) out.push({ id: n.id, name: n.name, kind: 'nebula', alias: 'nebula ' + (n.type === 'planetary' ? 'planetary' : 'm42 m16 m8 pillars') });
    for (const bm of bookmarks) out.push({ id: bm.id, name: bm.name, kind: 'bookmark' });
    for (const [id, d] of Object.entries(discovered)) out.push({ id, name: d.name, kind: 'discovered' });
    return out;
  }
  function search(q) {
    q = String(q || '').trim().toLowerCase(); if (!q) return [];
    if (entity(q.includes('#') || q.includes('/') || q.startsWith('g:') ? q : '___') && (q.includes('#') || q.includes('/'))) return [{ id: q, name: entity(q).name, kind: entity(q).kind }];
    const res = [], seen = new Set();
    for (const it of searchIndex()) {
      const n = it.name.toLowerCase(), a = (it.alias || '').toLowerCase();
      const score = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : a.includes(q) ? 3 : 9;
      if (score < 9 && !seen.has(it.id)) { seen.add(it.id); res.push({ ...it, score }); }
    }
    return res.sort((a, b) => a.score - b.score || a.name.length - b.name.length).slice(0, 12).map(({ score, alias, ...r }) => r);
  }

  // ---------- random procedural planet (deterministic per seed + n) ----------
  // random landable world: each press picks a new random spot across the galaxy (sometimes another known galaxy), never one of the recent picks
  let randomN = 0; const recentRand = [];
  function randomPlanet(o = {}) {
    const det = o.n != null, n = det ? o.n : randomN++, salt = det ? 0 : (Math.random() * 1e9) | 0;
    const here = galOf(cam.loc);
    let g = getGalaxy(o.galaxy) || (o.from === 'here' && here) || here || getGalaxy('mw');
    const r0 = rng(hash(SEED, 'randg', n, salt));
    if (!o.galaxy && !det && r0() < 0.2) { const others = REAL_GALAXIES.filter(x => x.id !== g.id && x.R); const og = others.length && getGalaxy(others[Math.floor(r0() * others.length)].id); if (og) g = og; }
    for (let k = 0; k < 400; k++) {
      const r = rng(hash(SEED, 'rand', n, k, salt)), L = r() < 0.7 ? 1 : 0, S = LEVELS[L].size;
      let base;
      if (o.from === 'near' && here) base = toGal(cam.loc, here);   // old behaviour on request: around the camera
      else { const rr = (g.R || 30000) * (0.08 + 0.6 * Math.sqrt(r())), a = r() * Math.PI * 2; base = V(Math.cos(a) * rr, (r() - 0.5) * 200, Math.sin(a) * rr); }
      const span = o.from === 'near' ? 6 : 2;
      const sx = Math.floor(base.x / S) + r.int(-span, span), sy = Math.floor(base.y / S) + r.int(-1, 1), sz = Math.floor(base.z / S) + r.int(-span, span);
      const list = sectorStars(g, SEED, L, sx, sy, sz).stars; if (!list.length) continue;
      const st = list[Math.floor(r() * list.length)]; starName_(st);
      const s = getSystem(st.id); if (!s) continue;
      const cands = s.bodies.filter(b => b.landable && b.kind === 'planet' && (!o.type || b.type === o.type) && !recentRand.includes(b.id) && !recentRand.includes(s.id));
      if (!cands.length) continue;
      const id = cands[Math.floor(r() * cands.length)].id;
      if (!det) { recentRand.push(id, s.id); while (recentRand.length > 40) recentRand.shift(); }
      return id;
    }
    return null;
  }

  // ---------- picking & labels ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), pv = V();
  function project(rel) {   // rel: camera-relative vector in universe axes (any unit)
    pv.copy(rel).applyQuaternion(cam.q.clone().invert());
    if (pv.z >= 0) return null;
    pv.applyMatrix4(camera.projectionMatrix);
    return { x: (pv.x + 1) / 2 * innerWidth, y: (1 - pv.y) / 2 * innerHeight, on: Math.abs(pv.x) < 1.05 && Math.abs(pv.y) < 1.05 };
  }
  function candidates() {
    const list = [];
    if (active === 'surface') return list;
    if (cam.loc.sys && activeView) {
      const s = cam.loc.sys, distStar = camSys.length();
      for (const it of activeView.items) {
        const b = it.b; if (b.kind === 'moon') { const p = activeView.itemByKey(b.parent); if (camSys.distanceTo(p.world) > p.b.moonExtent * 6 + 30 && focus?.b?.key !== b.parent && focus?.b !== b) continue; }
        const rel = V().copy(it.world).sub(camSys).applyQuaternion(s.uq);
        list.push({ id: b.id, name: b.name, kind: b.kind === 'star' ? (b.cls === 'BH' ? 'blackhole' : 'star') : b.kind, rel, pri: b.kind === 'star' ? 3 : b.kind === 'planet' ? 2 : 1, px: it.px || 0 });
      }
    }
    const g = galOf(cam.loc);
    if (g && stars.galaxy === g && stars.group.visible) {
      const hide = cam.loc.sys ? cam.loc.sys.id : null;
      for (const st of stars.all()) {
        if (st.id === hide) continue;
        const d = st.gpos.distanceTo(camGal); if (d < 1e-9) continue;
        const m = st.absMag + 5 * Math.log10(d / 32.616);
        if (m > (st.real ? 8 : 7.2)) continue;
        list.push({ id: st.real ? st.id : st.id, name: st.real ? st.name : null, star: st, kind: st.cls === 'BH' ? 'blackhole' : 'star', rel: V().copy(st.gpos).sub(camGal).applyQuaternion(g.q), pri: st.real ? 2.5 : 0.5 - m * 0.01, mag: m });
      }
    }
    if (g && stars.group.visible && !cam.loc.sys) for (const n of nebulaeNear(g, SEED, camGal)) {
      const rel = V().copy(n.gpos).sub(camGal), d = rel.length(), ang = n.R / Math.max(d, 1e-6);
      if (!n.real && ang < 0.02) continue; if (n.real && d > 12000) continue;
      list.push({ id: n.id, name: n.name, kind: 'nebula', rel: rel.applyQuaternion(g.q), pri: n.real ? 2.2 : 1.2 });
    }
    const insideGal = g && camGal.length() < g.R * 1.5;
    for (const gg of uni.galaxies) {
      if (gg === g && insideGal) continue;
      if (insideGal && !gg.real && !(selected && selected.id === gg.id)) continue;
      const rel = V().copy(gg.center).sub(camUni), d = rel.length();
      if (d > 2.6e7 && !gg.real) continue;
      list.push({ id: gg.id, name: gg.name, kind: 'galaxy', rel, pri: gg.real ? 2 : 1, ang: gg.R / d });
    }
    return list;
  }
  function pick(x, y) {
    if (active === 'surface' || mode === 'landing' || mode === 'takeoff') return null;
    if (cam.loc.sys && activeView) {
      ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
      setSysCamera(); ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(activeView.pickables, false)[0];
      if (hit) return hit.object.userData.item.b.id;
    }
    let best = null, bd = 34;
    for (const c of candidates()) {
      const p = project(c.rel); if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y) - c.pri * 4;
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    if (best.star && !best.star.real) starName_(best.star);
    return best.kind === 'galaxy' || best.id.includes('#') ? best.id : (entity(best.id) || {}).id || null;
  }
  function screenPos(id) {
    const e = entity(id); if (!e) return null;
    const rel = delta(cam.loc, e.loc()), p = project(rel);
    return p ? { x: p.x, y: p.y, visible: p.on } : { x: -1, y: -1, visible: false };
  }
  function labels() {
    if (active === 'surface' || mode === 'landing' || mode === 'takeoff') return [];
    if (gasState && gasState.h < GAS_LAYERS.haze) return [];   // inside a giant's haze: far stars / galaxies can't be seen through it
    const out = [], taken = [];
    let nStar = 0;
    const cs = candidates().filter(c => c.kind === 'galaxy' ? (c.ang > 0.01 || c.pri > 1.5) : c.star ? (c.star.real ? c.mag < 6 : c.mag < 0.5 && nStar++ < 5) : c.kind !== 'moon' || c.px > 3)
      .sort((a, b) => b.pri - a.pri);
    const selId = selected && selected.id;
    if (selected && !cs.some(c => c.id === selId)) cs.unshift({ id: selId, name: selected.name, kind: selected.kind, rel: delta(cam.loc, selected.loc()), pri: 9 });
    for (const c of cs) {
      const p = project(c.rel); if (!p || !p.on) continue;
      if (c.id !== selId && taken.some(t => Math.abs(t.x - p.x) < 70 && Math.abs(t.y - p.y) < 16)) continue;
      if (c.star && !c.star.real) starName_(c.star);
      const name = c.name || (c.star && c.star.name) || c.id;
      const id = c.star && !c.star.real ? c.star.id : c.id;
      taken.push(p); out.push({ id, name, kind: c.kind, x: Math.round(p.x), y: Math.round(p.y), selected: c.id === selId || id === selId });
      if (out.length >= 14) break;
    }
    return out;
  }

  // ---------- lens (black holes) ----------
  const rtBG = new THREE.WebGLRenderTarget(4, 4, { type: post.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType });
  const lensMat = new THREE.ShaderMaterial({ uniforms: { uMap: { value: rtBG.texture }, uC: { value: new THREE.Vector2() }, uR: { value: 0 }, uAsp: { value: 1 } }, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec2 uC; uniform float uR, uAsp; varying vec2 vUv;
      void main(){ vec2 p = (vUv - uC) * vec2(uAsp, 1.); float r = length(p);
        float defl = uR * uR * 2.6 / max(r, 1e-4);
        vec2 q = p - normalize(p) * defl; vec2 uv = uC + q / vec2(uAsp, 1.);
        vec3 c = texture2D(uMap, uv).rgb;
        if (r < uR * 1.02) c = vec3(0.);
        c += vec3(1., .78, .5) * exp(-pow((r - uR * 1.6) / (uR * .05), 2.)) * .9;
        gl_FragColor = vec4(c, 1.); }` });
  const lensScene = new THREE.Scene(); const lensQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lensMat); lensQuad.frustumCulled = false; lensScene.add(lensQuad);
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---------- seamless terrain lifecycle (one terrain world at a time: the nearest landable body within 8 radii) ----------
  const hazeCol = V(), SKY_LAYER = 2;
  function updateTerrain() {
    const s = cam.loc.sys;
    if (!activeView || !s) { if (terr) { terr.dispose(); terr = null; attach = null; } return; }
    let best = null, bd = 8;
    for (const it of activeView.items) { if (it.star || !it.b.landable) continue; const d = camSys.distanceTo(it.world) / it.r; if (d < bd) { bd = d; best = it; } }
    if (terr && (terr.view !== activeView || !activeView.items.includes(terr.it) || camSys.distanceTo(terr.it.world) / terr.it.r > 10 || (best && best !== terr.it && camSys.distanceTo(terr.it.world) / terr.it.r > bd * 1.5))) { terr.dispose(); terr = null; attach = null; tiCache = null; }
    if (!terr && best) { terr = createTerrain(best, { quality: qName, octMax: (QDEF[qName] || QDEF.medium).OCT_MAX }); if (terr) { terr.view = activeView; terr.sys = s; } }
    if (!terr) return;
    const it = terr.it;
    terr.group.rotation.y = it.mesh.rotation.y;
    const qB = it.tilt.quaternion.clone().multiply(it.mesh.quaternion).invert();
    const v = V().copy(camSys).sub(it.world).applyQuaternion(qB).multiplyScalar(terr.mPerSu);
    terr.update(v.x, v.y, v.z);
    const dR = camSys.distanceTo(it.world) / it.r, show = terr.ready && dR < 6;
    it.mesh.visible = !show; terr.group.visible = show;
    const map = it.mesh.material.uniforms && it.mesh.material.uniforms.uMap && it.mesh.material.uniforms.uMap.value;
    if (show && map && map.wrapS !== THREE.RepeatWrapping) { map.wrapS = THREE.RepeatWrapping; map.needsUpdate = true; }
    // atmosphere: from inside it is drawn first (it becomes the sky) and the terrain shader adds the aerial perspective
    let hk = 0;
    if (it.atmo) {
      const A = it.A, top = 1 + A.top, inside = show && dR < top * 1.01, m = it.atmo.material;
      it.atmo.layers.set(inside ? SKY_LAYER : 0); terr.skyInside = inside;
      if (m.uniforms.uIn) m.uniforms.uIn.value = inside ? smooth(top, 1 + A.top * 0.6, dR) : 0;
      const side = inside ? THREE.BackSide : THREE.FrontSide; if (m.side !== side) { m.side = side; m.needsUpdate = true; }   // from inside the shell only its far side faces us
      if (inside) {
        hk = smooth(top, top - A.top * 0.6, dR);
        const tauR = (A.tauR[0] + A.tauR[1] + A.tauR[2]) / 3, tau = tauR + A.tauM * 0.5, Rm = terr.R;
        const star = activeView.items.find(x => x.star), up = V().copy(camSys).sub(it.world).normalize();
        const e = star ? up.dot(V().copy(star.world).sub(it.world).normalize()) : 0.5;
        const br = A.betaR, bm = Math.max(br[0], br[1], br[2]) || 1, mie = A.tauM / (A.tauM + tauR + 1e-6), mc = A.mc;
        hazeCol.set(br[0] / bm * (1 - mie) + mc[0] * mie, br[1] / bm * (1 - mie) + mc[1] * mie, br[2] / bm * (1 - mie) + mc[2] * mie).multiplyScalar(0.03 + 0.55 * smooth(-0.12, 0.35, e));
        terr.setHaze(hk, tau, Math.max(A.HR * Rm, 500), (dR * it.r) * terr.mPerSu - Rm, hazeCol, it.wpos);
      }
    }
    if (!hk) terr.setHaze(0, 0, 1e4, 0, null, null);
  }

  // ---------- true-size sky near a world ----------
  // The default (compressed) layout inflates bodies against their orbits: standing on Earth, Venus or the Moon would fill a large part of the
  // sky. Close to the world we fly over, every other body is pushed out along its line of sight until its apparent size is its true one.
  function trueDistKm(s, A, B) {   // rough true distance between bodies A (the world we are at) and B
    const map = s.bodyMap || {}, par = b => b.kind === 'moon' ? map[b.parent] : null;
    const pA = par(A) || A, AU_KM = 1.495979e8;
    if (B.kind === 'star' || B.cls) return (pA.au || 1) * AU_KM;
    if (par(B) === A) return B.km || A.radiusKm * 30;
    if (par(A) === B) return A.km || B.radiusKm * 30;
    if (par(A) && par(A) === par(B)) return Math.max(Math.abs((A.km || 0) - (B.km || 0)), (A.km || 0) * 0.5, A.radiusKm * 10);
    const pB = par(B) || B, sun = activeView.items.find(x => x.star);
    if (!sun) return Math.abs((pB.au || 1) - (pA.au || 1)) * AU_KM + 1;
    const ia = activeView.items.find(x => x.b === pA), ib = activeView.items.find(x => x.b === pB);
    if (!ia || !ib) return Math.abs((pB.au || 1) - (pA.au || 1)) * AU_KM + 1;
    const da = V().copy(ia.world).sub(sun.world).normalize().multiplyScalar(pA.au || 1), db = V().copy(ib.world).sub(sun.world).normalize().multiplyScalar(pB.au || 1);
    return Math.max(da.distanceTo(db), 0.01) * AU_KM;
  }
  function trueSky(s) {
    const T = terr && terr.view === activeView ? terr.it : null;
    for (const it of activeView.items) it.skyF = 1;
    if (!T || s.realScale) return;
    const dR = camSys.distanceTo(T.world) / T.r, w = smooth(8, 2.5, dR);
    if (w <= 0) return;
    for (const it of activeView.items) {
      if (it === T) continue;
      const rel = V().copy(it.world).sub(camSys), d = rel.length(); if (d < 1e-12) continue;
      const Rkm = it.star ? (it.b.R || 1) * RSUN_KM : it.b.radiusKm; if (!Rkm) continue;
      const realAng = Rkm / trueDistKm(s, T.b, it.b), dispAng = it.r / d;
      if (!(realAng < dispAng)) continue;
      let f = Math.pow(realAng / dispAng, w); f = Math.max(f, d / (sysFar * 0.85));   // stay inside the far plane
      if (f >= 1) continue;
      it.skyF = f; it.node.position.copy(rel).divideScalar(f);   // node position is system-local, camera-relative
    }
  }

  // ---------- inside a gas giant ----------
  const gasIn = createGasInterior(); let gasState = null; gasIn.setScale(GAS_SCALE[qName] || 0.45);
  function updateGas() {
    gasState = null; gasIn.U.uAlpha.value = 0;
    const s = cam.loc.sys; if (!s || !activeView || !SEAMLESS()) return;
    let g = null, gh = Infinity;
    for (const it of activeView.items) { if (it.star || !isGiant(it.b)) continue; const Rm = it.b.radiusKm * 1000, h = camSys.distanceTo(it.world) / it.r * Rm - Rm; if (h < gh) { gh = h; g = it; } }
    if (!g || gh > GAS_FADE[0]) return;
    const b = g.b, bw = bodyPosition(s, b, simDays, V()), qB = bodyRot(s, b, simDays);
    const v = V().copy(cam.loc.p).sub(bw), upSys = v.clone().normalize();
    const camB = upSys.clone().applyQuaternion(qB.clone().invert());
    const toB = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(s.uq.clone().multiply(qB).invert()));
    const star = activeView.items.find(x => x.star);
    const sun = star ? V().copy(star.world).sub(camSys).normalize().applyQuaternion(s.uq) : V(0, 1, 0);
    const sc = star && star.col ? V(star.col.r, star.col.g, star.col.b).lerp(V(1, 1, 1), 0.3) : V(1, 1, 1);
    const alpha = smooth(GAS_FADE[0], GAS_FADE[1], gh);
    gasIn.set(g, { h: gh, up: upSys.applyQuaternion(s.uq), camB, toB, sun, sunC: sc, alpha });
    gasState = { it: g, h: gh, alpha };
  }

  // ---------- render ----------
  let frameNo = 0, last = performance.now(), acc = 0, frames = 0, fps = 60, scale = '', lastStats = {};
  function resize() { camera.aspect = surf.camera.aspect = innerWidth / innerHeight; camera.fov = surf.camera.fov = fovFor(camera.aspect); camera.updateProjectionMatrix(); surf.camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight, false); post.setSize(innerWidth * pixelRatio, innerHeight * pixelRatio); }
  addEventListener('resize', resize); resize();
  function setPR(pr) { pixelRatio = pr; renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight, false); post.setSize(innerWidth * pr, innerHeight * pr); stars.setUniform('uPR', pr); uni.pmat.uniforms.uPR.value = pr; for (const v of views.values()) v.setPR(pr); }
  setPR(pixelRatio);
  function setCam(near, far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); camera.position.set(0, 0, 0); camera.quaternion.copy(cam.q); camera.updateMatrixWorld(); }
  let sysNear = 0.01, sysFar = 2e5;
  function setSysCamera() { setCam(sysNear, sysFar); }

  function computeScale() {
    if (active === 'surface' || mode === 'surface') return 'surface';
    const l = cam.loc;
    if (l.sys) {
      if (activeView) for (const it of activeView.items) if (!it.star && camSys.distanceTo(it.world) < it.r * 12) return 'planet';
      return 'system';
    }
    const g = galOf(l);
    if (g && camGal.length() < g.R * 1.15 && Math.abs(camGal.y) < g.R * 0.25) return camGal.length() < 1 ? 'system' : 'stars';
    if (g) return 'galaxy';
    return 'universe';
  }

  // NaN guard: remember the last finite camera; if anything ever poisons it, step back instead of rendering NaN forever
  let goodCam = null;
  const badCam = () => !cam.loc || !isFinite(cam.loc.p.x + cam.loc.p.y + cam.loc.p.z) || !isFinite(cam.q.x + cam.q.y + cam.q.z + cam.q.w) || !isFinite(orb.dist + cur.ld + cur.theta + cur.phi);
  function recoverCam(hard) {
    if (!isFinite(orb.dist) || orb.dist <= 0) orb.dist = focus ? focus.viewLy : 1; if (!isFinite(cur.ld)) cur.ld = Math.log(orb.dist);
    if (!isFinite(orb.theta)) orb.theta = 0.5; if (!isFinite(orb.phi)) orb.phi = 1.25; if (!isFinite(cur.theta)) cur.theta = orb.theta; if (!isFinite(cur.phi)) cur.phi = orb.phi;
    if (!isFinite(simDays)) simDays = 0; if (!isFinite(timeSpeed)) timeSpeed = 1;
    fly.vel.set(0, 0, 0); fly.input.set(0, 0, 0); attach = null; fd = null; flight = null;
    if (goodCam && !hard) { cam.loc = { gal: goodCam.gal, sys: goodCam.sys, p: goodCam.p.clone() }; cam.q.copy(goodCam.q); }
    else { cam.q.identity(); cam.loc = focus ? addDelta(focus.loc(), sph(orb.dist, orb.phi, orb.theta, V()).applyQuaternion(focus.frameQ)) : rehome({ gal: null, sys: null, p: V() }); }
    if (badCam()) { cam.q.identity(); cam.loc = rehome({ gal: null, sys: null, p: V() }); }
    if (mode !== 'orbit' && mode !== 'free') setMode(focus ? 'orbit' : 'free');
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; frameNo++;
    if (badCam()) { console.warn('[SE2] camera became invalid; recovered'); recoverCam(false); }
    if (texQueue.length) texQueue.shift()();
    if (uploadQueue.length) { try { renderer.initTexture(uploadQueue.shift()); } catch (e) {} }
    if (frameNo % 30 === 0) { if (activeView) keepPrograms(activeView.group); if (terr && terr.group) keepPrograms(terr.group); if (active === 'surface' && surf.scene) keepPrograms(surf.scene); }   // materials added/changed after creation (textures, rings, terrain tiles)
    // near a world (and during fly-down) the clock slows to 5%: at the default 1 day/s the day/night line would otherwise sweep past every few seconds
    const nearK = attach && attach.spin && attach.dR != null ? smooth(1.6, 1.08, attach.dR) : 0;
    simDays += timeSpeed * dt * (fd ? FD_TIME : 1 - (1 - FD_TIME) * nearK);   // the fly-down autopilot slows the clock so the day/night line doesn't sweep past during the descent
    if (['landing', 'takeoff', 'surface'].includes(mode)) updateLanding(dt); else updateCamera(dt);
    if (badCam()) recoverCam(false); else goodCam = { gal: cam.loc.gal, sys: cam.loc.sys, p: cam.loc.p.clone(), q: cam.q.clone() };
    if (!cam.loc.sys && !cam.loc.gal && cam.loc.p.length() > MAX_ORBIT) cam.loc.p.setLength(MAX_ORBIT);   // edge of the universe

    // derived camera coordinates
    toUni(cam.loc, camUni);
    const g = galOf(cam.loc);
    if (g) toGal(cam.loc, g, camGal);
    // system view
    const s = cam.loc.sys;
    if (s) { camSys.copy(cam.loc.p); const v = viewFor(s); if (activeView !== v) { if (activeView) activeView.group.visible = false; activeView = v; v.group.visible = true; ev('se2:system', { id: s.id, name: s.name }); } }
    else if (activeView) { activeView.group.visible = false; activeView = null; }
    for (const v of views.values()) v.group.visible = v === activeView;

    renderer.info.autoReset = false;
    post.begin(); renderer.clear();
    const lights = [];   // glare / diffraction spikes / flare sources: {x, y (px), I, size, color}
    const focalPx = innerHeight / 2 / Math.tan(camera.fov * D2R / 2);
    if (active === 'surface') {
      renderer.render(surf.scene, surf.camera);
      const si = surf.sunInfo();
      if (si && si.vis > 0) { const p = si.dir.clone().project(surf.camera);
        if (p.z < 1 && Math.abs(p.x) < 1.4 && Math.abs(p.y) < 1.4) { const k = (si.color.x + si.color.y + si.color.z) / 3;
          lights.push({ x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, I: Math.min(2, Math.sqrt(k) * 1.5) * si.vis, size: 60, color: si.color.clone().normalize().multiplyScalar(1.4) }); } }
    } else {
      // --- universe
      uni.update(camUni);
      // --- galaxy clouds: up to two nearest galaxies within 3R
      if (frameNo % 10 === 0) for (const gg of uni.galaxies) { if (camUni.distanceTo(gg.center) < gg.R * 4.5) prefetchCloud(gg); }
      const near = uni.galaxies.map(gg => ({ gg, d: camUni.distanceTo(gg.center) })).filter(x => x.d < x.gg.R * 3.2).sort((a, b) => a.d / a.gg.R - b.d / b.gg.R).slice(0, 2);
      if (g && !near.some(n => n.gg === g)) near.unshift({ gg: g, d: camGal.length() });
      // galaxy clouds are cached (hidden) rather than rebuilt every time we cross 3.2 R: building one is ~70k particles of CPU work
      for (const [id, c] of clouds) if (!near.some(n => n.gg.id === id)) c.group.visible = false; else c.used = now;
      if (clouds.size > 4) { const old = [...clouds].filter(([id]) => !near.some(n => n.gg.id === id)).sort((a, b) => (a[1].used || 0) - (b[1].used || 0));
        while (clouds.size > 4 && old.length) { const [id, c] = old.shift(); c.dispose(); clouds.delete(id); } }
      for (const id of faded) uni.setAlpha(id, 1); faded.clear();
      const hidden = [];
      skyBox.visible = false;
      for (const { gg, d } of near) {
        let c = clouds.get(gg.id);
        if (!c) {
          const j = cloudPre.get(gg.id), wNow = clamp((gg.R * 3.0 - d) / (gg.R * 1.2), 0, 1);
          if (j && j.state === 'busy' && wNow < 0.05) continue;   // still invisible: wait for the worker
          c = createGalaxyCloud(gg, cloudN(gg), j && j.state === 'ready' && j.N === cloudN(gg) ? j.d : null); cloudPre.delete(gg.id);
          clouds.set(gg.id, c); galScene.add(c.group); keepPrograms(c.group); }
        const w = clamp((gg.R * 3.0 - d) / (gg.R * 1.2), 0, 1);
        uni.setAlpha(gg.id, 1 - w); faded.add(gg.id); if (w > 0.5) hidden.push(gg.id);
        const rel = gg === g ? V().copy(camGal).negate().applyQuaternion(gg.q) : V().copy(gg.center).sub(camUni);
        c.group.position.copy(rel).divideScalar(1000); c.group.quaternion.copy(gg.q);
        const inside = gg === g && camGal.length() < gg.R * 1.25;
        c.set('uAlpha', w); c.set('uNear0', inside ? 0.3 : 0); c.set('uNear1', inside ? 1.4 : 1e-4);
        c.set('uViewH', renderer.domElement.height); c.set('uMaxPx', 48 * pixelRatio); c.set('uGain', 0.28);
        if (c.imp) { const lp = V().copy(rel).negate().applyQuaternion(gg.qi); const sn = Math.abs(lp.y) / Math.max(lp.length(), 1e-9); c.imp.material.uniforms.uEdge.value = (sn < 0.1 ? 0 : Math.min(1, (sn - 0.1) / 0.35)) * (inside ? 0 : 1); c.imp.visible = qName !== 'low' && c.imp.material.uniforms.uEdge.value > 0; }
        c.group.visible = true;
        const spiral = gg.type === 'spiral' || gg.type === 'barred';
        // the low-res ray-marched sky cube is only needed when the camera is really IN the disk; above/below it (or near the rim)
        // the directly drawn cloud is sharper (the cube looked blocky from e.g. 45 kly above the Milky Way)
        let inDisk = false;
        if (inside) { const lp = V().copy(rel).negate().applyQuaternion(gg.qi); inDisk = Math.hypot(lp.x, lp.z) < gg.R * 1.05 && Math.abs(lp.y) < gg.R * 0.12; }
        if (inDisk && spiral && !params.has('nocube')) {
          // the sky from inside: ray-marched star + dust density (refreshed after moving, one cube face per frame)
          // first fill is spread over 6 frames too (rendering all faces at once was a 100+ ms spike); until it's done the cloud stays up
          if ((!gsky.ready || gsky.g !== gg) && !(gsky.busy() && gsky.job() === gg)) { gsky.request(gg, camGal); skyT = now; }
          else if (!gsky.busy() && gsky.at.distanceTo(camGal) > 30 && now - skyT > 700 && fly.speed < 20000) { gsky.request(gg, camGal); skyT = now; }
          if (gsky.busy()) gsky.step();
          post.begin();
          if (gsky.ready && gsky.g === gg) {
            skyBox.material.uniforms.uMap.value = gsky.texture();
            c.group.visible = false; skyBox.visible = true; skyBox.material.uniforms.uAlpha.value = w;
          }
        }
      }
      uni.hideDots(hidden);
      uni.pmat.uniforms.uWeb.value = g ? clamp((camGal.length() / g.R - 1.3) / 3, 0, 1) : 1;
      // --- stars + nebulae
      const inGal = g && camGal.length() < g.R * 1.6;
      stars.setGalaxy(inGal ? g : null); stars.group.visible = !!inGal;
      if (inGal) {
        stars.update(camGal, 4);
        stars.place(camGal, g.q, s ? s.gpos : null);
        stars.setUniform('uAlpha', clamp((g.R * 1.6 - camGal.length()) / (g.R * 0.4), 0, 1));
        nebField.update(nebulaeNear(g, SEED, camGal), camGal, g.q, focalPx);
        nebField.group.visible = true;
        // bright stars get glare + spikes
        if (!activeView || !cam.loc.sys) {
          const cand = [];
          for (const st of stars.all()) { const d = st.gpos.distanceTo(camGal); if (d < 1e-6) continue; const m = st.absMag + 5 * Math.log10(d / 32.616); if (m < 1.2) cand.push({ st, m, d }); }
          cand.sort((p, q) => p.m - q.m);
          for (const c of cand.slice(0, 3)) { const p = project(V().copy(c.st.gpos).sub(camGal).applyQuaternion(g.q)); if (!p || !p.on) continue;
            const I = Math.min(1.6, Math.pow(10, -0.4 * (c.m - 1.2)) * 0.25); lights.push({ x: p.x, y: p.y, I, size: 10 + 22 * I, color: new THREE.Vector3(...c.st.color) }); }
        }
      } else nebField.group.visible = false;
      // --- system
      let lens = null;
      if (activeView) {
        activeView.group.quaternion.copy(s.uq); activeView.group.position.set(0, 0, 0);
        const focal = focalPx;
        activeView.update(simDays, camSys, focal, dt);
        updateTerrain(); updateGas();
        let nd = Infinity; for (const it of activeView.items) nd = Math.min(nd, camSys.distanceTo(it.world) - it.r * (it.atmo ? 1.04 : 1));
        sysNear = clamp(nd * 0.3, s.realScale ? 1e-11 : 1e-4, 2); sysFar = Math.max(50, (s.extentSu || 100) * 4, camSys.length() * 3);
        trueSky(s);
        const fadeK = clamp((s.enterLy * 1.25 - camSys.length() * K) / (s.enterLy * 0.6), 0, 1);
        activeView.lines.visible = showOrbits && fadeK > 0.02; activeView.lines.children.forEach(l => l.material.opacity = (l.userData.op ??= l.material.opacity) * fadeK);
        activeView.markerMat.uniforms.uNear.value = 6;
        const bh = activeView.items.find(it => it.lens);
        if (bh) { setCam(sysNear, sysFar); const p = project(V().copy(bh.world).sub(camSys).applyQuaternion(s.uq));
          const dd = camSys.distanceTo(bh.world), rpx = bh.r / dd * focal;
          if (p && rpx > 0.8 && p.x > -innerWidth && p.x < innerWidth * 2 && p.y > -innerHeight && p.y < innerHeight * 2) lens = { x: p.x / innerWidth, y: 1 - p.y / innerHeight, r: rpx / innerHeight }; }
        // star glare (occluded by bodies in front)
        for (const it of activeView.items) {
          if (!it.star || it.lens) continue;
          const rel = V().copy(it.world).sub(camSys), d = rel.length(), dir = rel.clone().divideScalar(d);
          let vis = 1;
          for (const o of activeView.items) { if (o === it) continue; const oc = V().copy(o.world).sub(camSys), t = oc.dot(dir); if (t <= 0 || t > d) continue;
            const miss = oc.addScaledVector(dir, -t).length(), rr = o.r * (o.atmo ? 1.02 : 1); if (miss < rr) { vis = 0; break; } vis = Math.min(vis, clamp((miss - rr) / (rr * 0.08 + 1e-12), 0, 1)); }
          if (vis <= 0) continue;
          const p = project(rel.applyQuaternion(s.uq)); if (!p || p.x < -innerWidth * 0.3 || p.x > innerWidth * 1.3 || p.y < -innerHeight * 0.3 || p.y > innerHeight * 1.3) continue;
          const ang = it.r / d * (it.skyF || 1), Lf = Math.pow(Math.max(it.b.L, 1e-4), 0.2);
          const I = clamp(Lf * Math.sqrt(ang) * 3.2, 0.06, 2.6) * vis;
          lights.push({ x: p.x, y: p.y, I, size: clamp(ang * focal * 1.2 + 30 * I, 10, 160), color: new THREE.Vector3(it.col.r, it.col.g, it.col.b) });
        }
      }
      // --- draw (into the HDR target)
      const drawBG = () => {
        setCam(1e-5, 4e4); uni.place(camUni); renderer.render(uniScene, camera);
        setCam(1e-3, 2e4); renderer.render(galScene, camera);
        if (stars.group.visible) { setCam(1e-5, 1e5); renderer.render(starScene, camera); nebField.render(renderer, camera); }
      };
      if (lens) {
        const w = renderer.domElement.width, h = renderer.domElement.height;
        if (rtBG.width !== w || rtBG.height !== h) rtBG.setSize(w, h);
        renderer.setRenderTarget(rtBG); renderer.clear(); drawBG(); post.begin();
        lensMat.uniforms.uC.value.set(lens.x, lens.y); lensMat.uniforms.uR.value = lens.r; lensMat.uniforms.uAsp.value = innerWidth / innerHeight;
        renderer.render(lensScene, orthoCam);
      } else drawBG();
      if (activeView) {
        renderer.clearDepth(); setSysCamera();
        activeView.updateLights();
        camera.layers.enable(TERRAIN_LAYER);
        const ti = terr && terr.group.visible ? terrInfo() : null;
        if (ti && terr.skyInside) {   // inside the air: the atmosphere shell is the sky, drawn first on its own (no depth test)
          // tight near/far around the shell's far side: a ~0.5 m near plane against a system-sized far plane pushes it past float depth precision (clipped away)
          const tA = terr.it.A ? terr.it.A.top : 0.02, shellSu = terr.it.r * (1 + tA) * 1.002;
          camera.layers.set(SKY_LAYER); setCam(Math.max(1e-12, Math.max(shellSu - ti.D / ti.mPerSu, 1e-9) * 0.3), shellSu * 2.5); renderer.render(sysScene, camera);
          camera.layers.set(0); camera.layers.enable(TERRAIN_LAYER);
        }
        if (ti) {
          // near the ground: two depth ranges (far: everything; near: terrain only) so 24-bit depth covers 0.3 m .. 1e9 m
          const nearM = clamp(ti.alt * 0.35, 0.25, 1e7), splitM = nearM * 25000, nearSu = nearM / ti.mPerSu, splitSu = splitM / ti.mPerSu;
          if (splitSu < sysFar) {
            setCam(splitSu * 0.97, sysFar); renderer.render(sysScene, camera);
            renderer.clearDepth(); setCam(nearSu, splitSu); renderer.render(sysScene, camera);
          } else { setCam(Math.min(sysNear, nearSu), sysFar); renderer.render(sysScene, camera); }
        } else renderer.render(sysScene, camera);
        camera.layers.set(0);
        if (gasState) { gasIn.render(renderer, camera); if (gasState.h < GAS_LAYERS.ammonia) lights.length = 0; }
      }
    }
    // post: lights -> uniforms, bloom, exposure, tone mapping
    lights.sort((p, q) => q.I - p.I);
    const prs = renderer.getPixelRatio();
    for (let i = 0; i < 4; i++) { const L = lights[i], u = post.lights[i];
      if (!L) { u.set(0, 0, 0, 0); continue; }
      u.set(L.x / innerWidth, 1 - L.y / innerHeight, L.I, L.size * prs); post.lightColors[i].copy(L.color); }
    post.uniforms.uFlare.value = Q.flare ?? 1;
    post.end(dt, now / 1000);
    // scale-change event
    const sc = computeScale(); if (sc !== scale) { scale = sc; ev('se2:scalechange', { scale }); }
    // adaptive resolution
    frames++; acc += dt;
    if (acc >= 1.2) {
      fps = frames / acc; frames = 0; acc = 0;
      const minPR = qName === 'ultra' ? Math.min(1, maxPR) : 0.6;
      if (fps < 38 && pixelRatio > minPR) setPR(Math.max(minPR, pixelRatio - 0.2));
      else if (fps > 57 && pixelRatio < maxPR) setPR(Math.min(maxPR, pixelRatio + 0.1));
    }
    lastStats = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, points: renderer.info.render.points }; renderer.info.reset();
    requestAnimationFrame(frame);
  }

  // ---------- start at Earth ----------
  try { facts = await (await fetch(new URL('../planets.json', import.meta.url))).json(); } catch { console.warn('[SE2] planets.json not loaded'); }
  const startId = opts.start || params.get('at') || 'sol#earth';
  focus = entity(startId) || entity('sol#earth');
  orb.dist = focus.viewLy * (focus.kind === 'galaxy' ? 1 : 1.6); cur.ld = Math.log(orb.dist);
  cam.loc = rehome({ gal: null, sys: null, p: V() });
  cam.loc = addDelta(focusLoc(), sph(orb.dist, cur.phi, cur.theta, V()).applyQuaternion(focus.frameQ));
  selected = focus;
  updateCamera(0);
  requestAnimationFrame(frame);
  // startup shader prewarm (renderer.compileAsync): one real + one procedural system view and the galaxy cloud shaders, so the first
  // nebula / galaxy / system transition doesn't link programs mid-flight. Temporary objects are disposed; their programs stay kept.
  setTimeout(async () => {
    try {
      const tmp = [];
      const sp = [...stars.all()].find(st => !st.real && st.id); const ps = sp && getSystem(sp.id);
      for (const sy of [getSystem('sol'), ps]) if (sy && !views.has(sy.id)) { const v = createSystemView(sy, { quality: qName }); tmp.push(v); await keepProgramsAsync(v.group); }
      for (const gg of [uni.galaxies.find(x => x.type === 'spiral' || x.type === 'barred'), uni.galaxies.find(x => x.type === 'elliptical'), uni.galaxies.find(x => !x.real)]) if (gg) { const c = createGalaxyCloud(gg, 600); tmp.push(c); await keepProgramsAsync(c.group); }
      for (const t of tmp) t.dispose();
      window.__se2Prewarm = keepMats.size;
    } catch (e) { console.warn('[SE2] prewarm', e); }
  }, 2500);

  // ---------- public API ----------
  let joystick = null;
  function goTo(id, o = {}) {
    const e = typeof id === 'object' ? id : entity(id) || entity((search(id)[0] || {}).id);
    if (!e) { console.warn('[SE2] unknown target', id); return false; }
    selected = e; ev('se2:selected', { id: e.id, name: e.name, info: info(e) });
    fd = null; startFlight(e, o); return true;
  }
  const SE2 = {
    version: '2.0.0-preview', seed: SEED,
    goTo, select(id) { const e = entity(id); if (!e) return false; selected = e; discover(e); ev('se2:selected', { id: e.id, name: e.name, info: info(e) }); return true; },
    home() { if (badCam()) recoverCam(true); return goTo('sol#earth'); },
    getInfo: info, search, randomPlanet,
    getSelected: () => selected ? selected.id : null, getFocus: () => focus ? focus.id : null,
    zoom(delta) {
      delta = Number(delta) || 0;
      if (['landing', 'takeoff', 'surface', 'flight'].includes(mode)) return;
      if (mode === 'free') { const n = nearestDistLy(); cam.loc = addDelta(cam.loc, V(0, 0, -1).applyQuaternion(cam.q).multiplyScalar(n * clamp(delta, -1, 0.9))); return; }
      if (focus.b && focus.b.landable && SEAMLESS()) {   // seamless: zoom by altitude, all the way down to the ground
        const r = focus.radiusLy, lyPerM = r / (focus.b.radiusKm * 1000);
        orb.dist = r + clamp((orb.dist - r) * Math.exp(-delta), 3 * lyPerM, MAX_ORBIT); return;
      }
      orb.dist = clamp(orb.dist * Math.exp(-delta), focus.minLy, MAX_ORBIT);
    },
    setZoom(ly, instant) { ly = Number(ly); if (mode !== 'orbit' || !focus || !isFinite(ly) || ly <= 0) return false; orb.dist = clamp(ly, focus.b && focus.b.landable && SEAMLESS() ? focus.radiusLy * (1 + 3 / (focus.b.radiusKm * 1000)) : focus.minLy, MAX_ORBIT); if (instant) cur.ld = Math.log(orb.dist); return orb.dist; },
    getZoom: () => mode === 'orbit' ? Math.exp(cur.ld) : null,
    look(dx, dy) {
      dx = Number(dx) || 0; dy = Number(dy) || 0;
      if (mode === 'surface') return surf.look(dx, dy);
      if (mode === 'free') { cam.q.multiply(new THREE.Quaternion().setFromAxisAngle(Y, -dx * 0.004)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy * 0.004)); return; }
      if (mode !== 'orbit') return;
      orb.theta -= dx * 0.006; orb.phi = clamp(orb.phi - dy * 0.006, 0.05, Math.PI - 0.05);
    },
    // 🔄 Orbit button in free flight: circle the locked body around its pole (orbit mode keeps using look()); dtMs = frame time
    orbitAround(dtMs = 16) {
      if (mode === 'orbit') { this.look(-(+dtMs || 0) * 0.06, 0); return true; }
      if (mode !== 'free' || !attach || fd || !cam.loc.sys) return false;
      const s = cam.loc.sys, qB = bodyRot(s, attach.b, simDays), axis = Y.clone().applyQuaternion(qB).normalize();
      const R = new THREE.Quaternion().setFromAxisAngle(axis, (+dtMs || 0) * 0.06 * 0.006 * 0.5);
      const bw = bodyPosition(s, attach.b, simDays, V());
      cam.loc.p.sub(bw).applyQuaternion(R).add(bw);
      cam.q.premultiply(s.uq.clone().multiply(R).multiply(s.uqi)).normalize(); tiCache = null;
      return true;
    },
    fly(x = 0, y = 0, z = 0) {
      const v = [clamp(+x || 0, -1, 1), clamp(+y || 0, -1, 1), clamp(+z || 0, -1, 1)];
      if (mode === 'surface') { surfInput.set(...v); return; }
      if (mode === 'landing' || mode === 'takeoff') return;
      fly.input.set(...v); if (fly.input.lengthSq() > 0) { fd = null; enterFree(); }
    },
    flyDown: id => flyDownStart(id ?? (selected && selected.id) ?? (focus && focus.id)), cancelFlyDown() { fd = null; }, isFlyingDown: () => !!fd,
    setBoost(k) { k = Number(k); boost = clamp(isFinite(k) && k > 0 ? k : 1, 1, 1e5);
      const el = typeof document !== 'undefined' && document.getElementById('x2-boost');   // keep the ⚡ button label in step with API changes
      if (el) { el.textContent = '⚡' + (boost >= 1000 ? +(boost / 1000).toPrecision(3) + 'k' : +boost.toPrecision(3)) + '×'; el.classList.toggle('on', boost > 1); }
      ev('se2:boost', { boost }); return boost; }, getBoost: () => boost, engineBrake: true, isBraking: () => mode === 'free' && !!fly.braking,
    land, takeOff, canLand,
    // nearest body + metres above its surface (scale-consistent with the drawn radius, works in compressed and real scale)
    getAltitude() {
      if (active === 'surface' && (surfEnt || landing?.e)) { const e = surfEnt || landing.e, c = surf.camera.position;
        return { name: e.name, id: e.id, meters: Math.max(0, surf.state.hover ?? (c.y - surf.height(c.x, c.z))), surface: true, atmosphere: !!e.b.atmo, kind: 'rocky' }; }
      if (!cam.loc.sys || !activeView) return null;
      const s = cam.loc.sys, eid = b => s.id + '#' + b.key;
      const hasAir = it => !!(it.atmo || (it.b && it.b.atmo)), kindOf = it => it.star ? 'star' : isGiant(it.b) ? 'gas' : 'rocky';
      const ti = terrInfo();
      const focIt = !fd && mode === 'orbit' && focus && focus.b && focus.sys === s ? activeView.items.find(x => x.b === focus.b) : null;
      const focusOther = focIt && terr && focIt.b !== terr.it.b && ti && ti.alt > terr.R * 2;   // orbiting Earth: don't report the Moon's terrain just because it's nearer in the compressed layout
      if (ti && terr && !focusOther) { let other = false; if (!(fd && fd.e.b === terr.it.b)) for (const it of activeView.items) if (it !== terr.it && camSys.distanceTo(it.world) - it.r < ti.alt / ti.mPerSu && camSys.distanceTo(it.world) < it.r * 3) other = true;
        if (!other) { const it = terr.it, top = it.A ? (it.A.top || 0) * terr.R : 0;
          return { name: it.b.name, id: eid(it.b), meters: Math.max(0, ti.alt), surface: false, terrain: true, atmosphere: hasAir(it) && ti.D - terr.R < top, kind: 'rocky' }; } }
      const wp = new Map(); const W = it => { let w = wp.get(it); if (!w) { w = it.star || !it.b.radiusKm ? it.world : bodyPosition(s, it.b, simDays, V()); wp.set(it, w); } return w; };   // this frame's positions (it.world can be stale for bodies not drawn)
      let best = null, bd = Infinity;
      for (const it of activeView.items) { const d = cam.loc.p.distanceTo(W(it)) - it.r * (it.star ? 1 : gasDeck(it.b)); if (d < bd) { bd = d; best = it; } }
      // prefer the body we are "at" over small neighbours: fly-down target, else the focused / selected body or the planet whose
      // neighbourhood we are in, unless we are really close to the other body (within 3 of its radii)
      const dOf = it => cam.loc.p.distanceTo(W(it)) - it.r * (it.star ? 1 : gasDeck(it.b));
      const near3 = it => it && cam.loc.p.distanceTo(W(it)) < it.r * 3;
      let pref = fd ? activeView.items.find(x => x.b === fd.e.b) : attach && attach.s === s ? activeView.items.find(x => x.b === attach.b) : null;   // fly-down target, else the body whose moving frame we're locked to
      if (!pref) for (const e of [focus, selected]) { if (!e || !e.b || e.sys !== s) continue; const it = activeView.items.find(x => x.b === e.b); if (it && cam.loc.p.distanceTo(W(it)) < it.r * 40) { pref = it; break; } }
      if (!pref && best && !best.star && best.b.parent && !near3(best)) { const pb = s.bodyMap[best.b.parent], it = pb && activeView.items.find(x => x.b === pb); if (it && cam.loc.p.distanceTo(W(it)) < it.r * 40) pref = it; }
      if (pref && pref !== best && (fd || !near3(best))) { best = pref; bd = dOf(pref); }
      if (!best) return null;
      const b = best.b, rKm = b.radiusKm ?? (b.R ? b.R * RSUN_KM : null), meters = rKm ? Math.max(0, bd / best.r * rKm * 1000) : bd * K * 9.4607e15;
      const top = best.A ? (best.A.top || 0) * rKm * 1000 : 0;
      return { name: b.name, id: best.star ? (b.id || null) : eid(b), meters, surface: false, atmosphere: !best.star && hasAir(best) && meters < top + (1 - gasDeck(b)) * rKm * 1000, kind: kindOf(best) };
    },
    getSurface: () => ['surface', 'landing', 'takeoff'].includes(mode) ? { id: (surfEnt || landing?.e)?.id, name: (surfEnt || landing?.e)?.name, altitude: surf.state.hover, position: surf.state.pos.toArray() } : null,
    pick, screenPos, getLabels: labels,
    getState() {
      const g = galOf(cam.loc);
      return { mode, scale, galaxy: g ? { id: g.id, name: g.name } : null, system: cam.loc.sys ? { id: cam.loc.sys.id, name: cam.loc.sys.name } : null,
        focus: focus ? focus.id : null, selected: selected ? selected.id : null, distanceLy: focus ? delta(cam.loc, focus.loc()).length() : null, distanceText: distanceText(),
        speedLyps: fly.speed, speedMps: mode === 'free' ? fly.mps ?? null : null, frame: cam.loc.sys ? 'system' : g ? 'galaxy' : 'universe', position: camUni.toArray(), galacticPosition: g ? camGal.toArray() : null, boost };
    },
    getSystem(id) { const s = getSystem(String(id).split('#')[0]); if (!s) return null;
      return { id: s.id, name: s.name, real: !!s.real, stars: s.stars.map(b => ({ id: b.id, name: b.name, cls: b.cls, sub: b.sub, T: Math.round(b.T), R: +b.R.toPrecision(4) })),
        bodies: s.bodies.map(b => ({ id: b.id, name: b.name, kind: b.kind, type: b.type, parent: b.parent ? s.bodyMap[b.parent].id : null, radiusKm: Math.round(b.radiusKm), tempK: Math.round(b.tempK), gravity: +(+b.gravity).toFixed(3), au: b.au ? +b.au.toPrecision(4) : null, rings: !!b.rings, landable: b.landable })) }; },
    nearbyStars(n = 10) {   // deterministic: generated directly from the sectors around the camera (not the streaming state)
      const g = galOf(cam.loc); if (!g) return [];
      const out = [];
      for (let L = 0; L < 3; L++) { const S = LEVELS[L].size; const c = V().copy(camGal).divideScalar(S).floor();
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) for (const st of sectorStars(g, SEED, L, c.x + i, c.y + j, c.z + k).stars) out.push(st); }
      if (g.id === 'mw') out.push(...REAL_STARS);
      return out.map(st => ({ st, d: st.gpos.distanceTo(camGal) })).sort((a, b) => a.d - b.d).slice(0, n)
        .map(({ st, d }) => { if (!st.real) starName_(st); return { id: st.id, name: st.name, cls: st.cls, distanceLy: +d.toFixed(4) }; });
    },
    getBookmarks: () => bookmarks.slice(),
    addBookmark(id) { const e = entity(id || (selected && selected.id)); if (!e) return false; if (!bookmarks.some(b => b.id === e.id)) { bookmarks.push({ id: e.id, name: e.name, kind: e.kind }); saveLS('bookmarks', bookmarks); ev('se2:bookmarks', { bookmarks }); } return true; },
    removeBookmark(id) { bookmarks = bookmarks.filter(b => b.id !== id); saveLS('bookmarks', bookmarks); ev('se2:bookmarks', { bookmarks }); return true; },
    getDiscoveries: () => Object.entries(discovered).map(([id, d]) => ({ id, ...d })),
    setTimeSpeed(x) { x = Number(x); timeSpeed = isFinite(x) ? clamp(x, -1e5, 1e5) : timeSpeed; return timeSpeed; }, getTimeSpeed: () => timeSpeed,
    getDate: () => new Date(J2000 + simDays * 86400000),
    setQuality(name) {
      if (!QUALITY[name]) return false; qName = name; Q = QUALITY[name]; maxPR = Math.min(window.devicePixelRatio || 1, Q.maxPR); stars.quality = Q.stars; for (const l of stars.levels) l.center = null;
      for (const [id, c] of clouds) { c.dispose(); clouds.delete(id); }
      gsky.dispose(); gsky = createGalaxySky(renderer, Q.sky, post.hdr, qName);
      post.setTier(qName); nebField.setQuality(qName); gasIn.setScale(GAS_SCALE[qName] || 0.45); surf.setQuality(qName); rebuildViews();
      if (pixelRatio > maxPR || name === 'ultra') setPR(maxPR); return true; },
    setRealScale(on) {
      on = !!on; if (on === isRealScale()) return on;
      if (['landing', 'takeoff', 'surface'].includes(mode)) exitSurfaceNow();
      if (mode === 'flight') { flight = null; setMode('orbit'); }
      const oldR = focus && focus.b ? focus.radiusLy : null;
      setRealScale(on); entCache.clear(); rebuildViews();
      if (focus) { focus = entity(focus.id) || focus; if (oldR && focus.radiusLy) { orb.dist = Math.max(focus.minLy * 1.05, orb.dist * focus.radiusLy / oldR); cur.ld = Math.log(orb.dist); } }
      if (selected) selected = entity(selected.id) || selected;
      if (mode === 'free' && cam.loc.sys && focus && focus.sys === cam.loc.sys) { mode = 'orbit'; ev('se2:modechange', { mode }); }
      ev('se2:realscale', { on }); return on; },
    getRealScale: () => isRealScale(),
    setOrbits(on) { showOrbits = !!on; saveLS('orbits', showOrbits); ev('se2:orbits', { on: showOrbits }); return showOrbits; },
    getOrbits: () => showOrbits,
    setSunElevation(deg, az) { return mode === 'surface' ? surf.setSun(+deg, az == null ? undefined : +az) : false; },
    getQuality: () => qName,
    getStats: () => ({ fps: Math.round(fps * 10) / 10, pixelRatio: +pixelRatio.toFixed(2), drawCalls: lastStats.calls, triangles: lastStats.triangles, points: lastStats.points,
      tier: qName, pixelRatio, maxPixelRatio: maxPR, msaa: post.samples ? post.samples() : 0, hdr: post.hdr, realScale: isRealScale(), terrainTiles: active === 'surface' ? surf.tileCount : terr && terr.group.visible ? terr.tileCount : 0, starsLoaded: stars.count(), galaxiesLoaded: uni.galaxies.length, cloudParticles: [...clouds.values()].reduce((a, c) => a + c.count, 0), systemViews: views.size, texturesPending: texQueue.length, quality: qName, mode, scale }),
    getMode: () => mode, getScale: () => scale,
    enableJoystick(on = true) { if (on && !joystick) joystick = createJoystick(SE2); if (!on && joystick) { joystick.destroy(); joystick = null; } return !!joystick; },
    fmtDist,
    _debug: { THREE, renderer, post, cam, entity, getSystem, stars, uni, views, clouds, skyBox, uniScene, galScene, starScene, sysScene, surf, nebField, gsky: () => gsky, terrain: () => terr, terrInfo: () => terrInfo(), fd: () => fd, lockInfo: () => attach && { b: attach.b.name, spin: !!attach.spin }, local: () => attach && V().copy(cam.loc.p).sub(attach.bw).applyQuaternion(attach.qB.clone().invert()).toArray(), vel: () => fly.vel.toArray(), fly: () => fly.dbg, pitch: () => { const s = cam.loc.sys, g = gasState && gasState.it, ti = terrInfo(); const up = ti ? ti.dirSys.clone() : g ? V().copy(cam.loc.p).sub(bodyPosition(s, g.b, simDays, V())).normalize() : null; if (!up || !s) return null; up.applyQuaternion(s.uq); return Math.asin(clamp(V(0, 0, -1).applyQuaternion(cam.q).dot(up), -1, 1)) / D2R; }, near: () => nearestDistLy() / K, boost: () => boost, gas: () => gasState && { r: gasState.it.r, rk: gasState.it.b.radiusKm, h: gasState.h, alpha: gasIn.U.uAlpha.value, H: gasIn.U.uH.value, sunE: gasIn.U.uUp.value.dot(gasIn.U.uSun.value) } },
  };
  window.SE2 = SE2;
  ev('se2:ready', { seed: SEED });
  return SE2;
}

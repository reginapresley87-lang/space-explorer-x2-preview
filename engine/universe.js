// Universe level: real Local Group galaxies + procedural galaxies streamed per sector,
// galaxy density fields (used by the star streamer) and galaxy particle clouds.
import * as THREE from '../scene/vendor/three.module.min.js?v=20261014b';
import { hash, rng, galaxyName, galDir, TAU, D2R, clamp } from './util.js?v=20261014b';

export const SOL_GPOS = new THREE.Vector3(0, 55, 26000);     // Sun in the Milky Way frame (ly)
export const U_SECTOR = 1e7;      // 10 Mly sectors (selectable galaxies)
export const U_FAR = 8e7;         // 80 Mly sectors (background cosmic web, points only)
export const LOCAL_VOID = 4e6;    // no procedural galaxies inside 4 Mly of the Milky Way

const Y = new THREE.Vector3(0, 1, 0);
function qFromNormal(n) { return new THREE.Quaternion().setFromUnitVectors(Y, n.clone().normalize()); }
function qRandom(r) { const u = r() * 2 - 1, t = r() * TAU, s = Math.sqrt(1 - u * u); return qFromNormal(new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t))).multiply(new THREE.Quaternion().setFromAxisAngle(Y, r() * TAU)); }
function inclinedTo(los, incDeg, spin) {
  const l = new THREE.Vector3(...los).normalize();
  const perp = new THREE.Vector3().crossVectors(l, Y).normalize();
  const n = l.clone().applyAxisAngle(perp, incDeg * D2R);
  return qFromNormal(n).multiply(new THREE.Quaternion().setFromAxisAngle(Y, spin));
}

function finishGalaxy(g) {
  const r = rng(g.seed ^ 0x77);
  g.R = g.R || 30000;
  if (g.type === 'spiral' || g.type === 'barred') {
    g.arms = g.arms || (r() < 0.6 ? 2 : r() < 0.7 ? 4 : 3);
    g.pitch = (g.pitch || r.range(10, 24)) * D2R;
    g.hr = g.R * (g.hrK || 0.19); g.hz = g.R * 0.022; g.rb = g.R * (g.rbK || r.range(0.05, 0.1));
    g.bar = g.type === 'barred' ? g.R * (g.barK || r.range(0.12, 0.22)) : 0;
    g.armPhase = g.armPhase ?? r() * TAU;
    g.armCol = g.armCol || [0.75, 0.85, 1.0]; g.coreCol = g.coreCol || [1.0, 0.82, 0.58];
  } else if (g.type === 'elliptical') {
    g.ax = g.ax || [1, r.range(0.55, 1), r.range(0.45, 0.95)];
    g.coreCol = g.coreCol || [1.0, 0.8, 0.6]; g.armCol = g.coreCol;
  } else {
    g.clumps = Array.from({ length: 4 + Math.floor(r() * 5) }, () => [r.gauss() * g.R * 0.35, r.gauss() * g.R * 0.12, r.gauss() * g.R * 0.35, g.R * r.range(0.12, 0.35), r.range(0.4, 1)]);
    g.armCol = g.armCol || [0.7, 0.8, 1.0]; g.coreCol = g.coreCol || [0.9, 0.85, 0.95];
  }
  g.norm = 1; g.norm = g.type === 'irregular' ? 0.25 : (densityRaw(g, 0.5 * g.R, 0, 0, true) || 1);
  g.qi = g.q.clone().invert();
  return g;
}

export const REAL_GALAXIES = (() => {
  const at = (l, b, d) => new THREE.Vector3(...galDir(l, b)).multiplyScalar(d).add(SOL_GPOS);
  const list = [
    { id: 'mw', name: 'Milky Way', real: true, type: 'barred', center: new THREE.Vector3(0, 0, 0), q: new THREE.Quaternion(), R: 52000, arms: 4, pitch: 12.5, seed: 1001, armPhase: 0.2, barK: 0.17, rbK: 0.065, hrK: 0.17,
      fact: 'Our home: a barred spiral of 100–400 billion stars, about 100,000 light-years across.' },
    { id: 'm31', name: 'Andromeda Galaxy', real: true, type: 'spiral', center: at(121.17, -21.57, 2.54e6), R: 110000, arms: 2, pitch: 9, seed: 1031, fact: 'The nearest big spiral, 2.5 million light-years away, with about a trillion stars. It will merge with the Milky Way in ~4.5 billion years.' },
    { id: 'm33', name: 'Triangulum Galaxy', real: true, type: 'spiral', center: at(133.61, -31.33, 2.73e6), R: 30000, arms: 2, pitch: 18, seed: 1033, fact: 'The third-largest member of the Local Group, about 40 billion stars.' },
    { id: 'lmc', name: 'Large Magellanic Cloud', real: true, type: 'irregular', center: at(280.47, -32.89, 163000), R: 7000, seed: 1101, fact: 'A satellite galaxy of the Milky Way, visible to the naked eye from the southern hemisphere.' },
    { id: 'smc', name: 'Small Magellanic Cloud', real: true, type: 'irregular', center: at(302.8, -44.3, 203000), R: 3500, seed: 1102, fact: 'A dwarf irregular galaxy orbiting the Milky Way, about 200,000 light-years away.' },
  ];
  const los = g => g.center.clone().sub(SOL_GPOS).normalize().toArray();
  for (const g of list) if (!g.q) g.q = inclinedTo(los(g), g.id === 'm31' ? 77 : g.id === 'm33' ? 54 : 35, g.seed);
  const out = list.map(finishGalaxy);
  out[0].norm *= densityRaw(out[0], SOL_GPOS.x, SOL_GPOS.y, SOL_GPOS.z);   // Milky Way: density 1 at the Sun
  return out;
})();

// ---------- density (galaxy-local ly, normalised so ~1 at half radius / the Sun) ----------
function armProx(g, rr, th) {
  const n = g.arms, step = TAU / n;
  const ta = g.armPhase + Math.log(Math.max(rr, g.R * 0.04) / (g.R * 0.1)) / Math.tan(g.pitch);
  let d = ((th - ta) % step + step) % step; if (d > step / 2) d -= step;
  const w = g.R * 0.035 + rr * 0.07, lin = d * rr;
  return Math.exp(-(lin * lin) / (w * w));
}
function densityRaw(g, x, y, z, noArm) {
  if (g.type === 'spiral' || g.type === 'barred') {
    const rr = Math.hypot(x, z), th = Math.atan2(z, x);
    const prox = noArm ? 0.5 : armProx(g, rr, th);
    let d = Math.exp(-rr / g.hr) * Math.exp(-Math.abs(y) / g.hz) * (0.35 + 1.3 * prox) * (rr < g.R * 1.05 ? 1 : Math.exp(-(rr - g.R * 1.05) / (g.R * 0.05)));
    const r3 = x * x + y * y * 2.5 + z * z;
    d += 2.2 * Math.exp(-r3 / (g.rb * g.rb));
    if (g.bar) { const c = Math.cos(g.armPhase), s = Math.sin(g.armPhase), bx = x * c + z * s, bz = -x * s + z * c;
      d += 1.2 * Math.exp(-(bx * bx) / (g.bar * g.bar) - (bz * bz + y * y * 4) / (g.bar * g.bar * 0.08)); }
    d += 0.004 * Math.exp(-Math.sqrt(x * x + y * y + z * z) / (g.R * 0.4));
    return d / g.norm;
  }
  if (g.type === 'elliptical') {
    const s = Math.sqrt((x / g.ax[0]) ** 2 + (y / g.ax[2]) ** 2 + (z / g.ax[1]) ** 2);
    return Math.exp(-s / (0.15 * g.R)) / g.norm;
  }
  let d = 0;
  for (const c of g.clumps) d += c[4] * Math.exp(-((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2) / (c[3] * c[3]));
  return d / g.norm;
}
export const MAX_DENSITY = 25;
export function densityAt(g, x, y, z) { return Math.min(MAX_DENSITY, densityRaw(g, x, y, z)); }

// ---------- procedural galaxies per 10 Mly sector ----------
const sectorCache = new Map();
export function universeSector(seed, sx, sy, sz) {
  const key = `${sx}:${sy}:${sz}`;
  let s = sectorCache.get(key);
  if (s) return s;
  const r = rng(hash(seed, 77, sx, sy, sz)), out = [];
  const base = new THREE.Vector3(sx, sy, sz).multiplyScalar(U_SECTOR);
  const n = Math.floor(r.range(1, 4.5));
  const cluster = r() < 0.22 ? { c: new THREE.Vector3(r(), r(), r()).multiplyScalar(U_SECTOR).add(base), n: r.int(12, 55), s: r.range(0.8e6, 2.2e6) } : null;
  const total = n + (cluster ? cluster.n : 0);
  for (let i = 0; i < total; i++) {
    const gs = hash(seed, 78, sx, sy, sz, i), gr = rng(gs);
    const inCl = i >= n;
    const center = inCl ? new THREE.Vector3(gr.gauss(), gr.gauss(), gr.gauss()).multiplyScalar(cluster.s).add(cluster.c)
      : new THREE.Vector3(gr(), gr(), gr()).multiplyScalar(U_SECTOR).add(base);
    if (center.length() < LOCAL_VOID) continue;
    const t = gr();
    const type = inCl ? (t < 0.5 ? 'elliptical' : t < 0.85 ? 'spiral' : t < 0.95 ? 'barred' : 'irregular')
      : (t < 0.45 ? 'spiral' : t < 0.7 ? 'barred' : t < 0.85 ? 'elliptical' : 'irregular');
    const R = type === 'irregular' ? gr.range(4000, 18000) : type === 'elliptical' ? gr.range(12000, inCl && i === n ? 220000 : 90000) : gr.range(18000, 90000);
    const hue = gr();
    const g = finishGalaxy({ id: `g:${sx}:${sy}:${sz}:${i}`, seed: gs, type, center, R, q: qRandom(gr),
      armCol: type === 'irregular' ? [0.65, 0.78, 1] : [0.7 + hue * 0.2, 0.82, 1], coreCol: [1, 0.78 + hue * 0.12, 0.5 + hue * 0.2] });
    g.name = galaxyName(gs, type);
    out.push(g);
  }
  s = { key, galaxies: out };
  sectorCache.set(key, s);
  if (sectorCache.size > 600) sectorCache.delete(sectorCache.keys().next().value);
  return s;
}
function webNodes(seed, sx, sy, sz) {
  const r = rng(hash(seed, 92, sx, sy, sz)), n = r.int(1, 3), out = [];
  for (let i = 0; i < n; i++) out.push({ p: new THREE.Vector3(sx + 0.15 + r() * 0.7, sy + 0.15 + r() * 0.7, sz + 0.15 + r() * 0.7).multiplyScalar(U_FAR), m: r.int(30, 110) });
  return out;
}
export function farSector(seed, sx, sy, sz) {
  // background "cosmic web": clusters at nodes + filaments to the nodes of neighbouring sectors (points only, deterministic)
  const r = rng(hash(seed, 91, sx, sy, sz)), pts = [], nodes = webNodes(seed, sx, sy, sz);
  const g = () => new THREE.Vector3(r.gauss(), r.gauss(), r.gauss());
  for (const nd of nodes) for (let k = 0; k < nd.m; k++) pts.push(nd.p.clone().add(g().multiplyScalar(2.2e6 + 2e6 * r())));
  for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1]]) {
    const nb = webNodes(seed, sx + dx, sy + dy, sz + dz); if (!nb.length) continue;
    const a = nodes[0], b = nb[Math.floor(r() * nb.length)];
    if (r() < 0.35) continue;
    const n = r.int(25, 70);
    for (let k = 0; k < n; k++) pts.push(a.p.clone().lerp(b.p, r()).add(g().multiplyScalar(2.5e6)));
  }
  for (let k = 0; k < 15; k++) pts.push(new THREE.Vector3(r(), r(), r()).multiplyScalar(U_FAR).add(new THREE.Vector3(sx, sy, sz).multiplyScalar(U_FAR)));
  return pts.filter(p => p.length() > U_SECTOR * 3);   // the near field is covered by real/selectable galaxies
}
export function galaxyById(seed, id) {
  const real = REAL_GALAXIES.find(g => g.id === id); if (real) return real;
  const m = /^g:(-?\d+):(-?\d+):(-?\d+):(\d+)$/.exec(id); if (!m) return null;
  return universeSector(seed, +m[1], +m[2], +m[3]).galaxies.find(g => g.id === id) || null;
}
export function galaxyTypeLabel(g) {
  return { spiral: 'Spiral galaxy', barred: 'Barred spiral galaxy', elliptical: 'Elliptical galaxy', irregular: 'Irregular galaxy' }[g.type];
}

// ---------- particle cloud (galaxy-local, kly units) ----------
export function galaxyParticles(g, N) {
  const r = rng(g.seed ^ 0xabc), Nd = Math.floor(N * 0.3);
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
  const dpos = new Float32Array(Nd * 3), dsize = new Float32Array(Nd);
  const R = g.R / 1000, put = (i, x, y, z, c, s, a) => { pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; col[i * 3] = c[0] * a; col[i * 3 + 1] = c[1] * a; col[i * 3 + 2] = c[2] * a; size[i] = s; };
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const white = [1, 0.95, 0.88], pink = [1, 0.45, 0.65];
  if (g.type === 'spiral' || g.type === 'barred') {
    const hr = g.hr / 1000, hz = g.hz / 1000, rb = g.rb / 1000, bar = g.bar / 1000, n = g.arms;
    for (let i = 0; i < N; i++) {
      const u = r();
      if (u < 0.16) { const s = rb * 1.1; put(i, r.gauss() * s, r.gauss() * s * 0.55, r.gauss() * s, mixc(g.coreCol, white, r() * 0.3), R * r.range(0.03, 0.06), 1.0); continue; }
      if (bar && u < 0.24) { const t = (r() * 2 - 1) * bar, w = r.gauss() * bar * 0.18, c = Math.cos(g.armPhase), s = Math.sin(g.armPhase);
        put(i, t * c - w * s, r.gauss() * hz * 1.5, t * s + w * c, g.coreCol, R * r.range(0.025, 0.045), 0.9); continue; }
      let rr = -hr * Math.log(1 - r() * (1 - Math.exp(-R * 1.05 / hr)));
      if (rr < rb * 0.7) rr += rb * 0.7;
      const arm = r() < 0.72;
      let th;
      if (arm) { const k = Math.floor(r() * n); th = g.armPhase + k * TAU / n + Math.log(Math.max(rr, R * 0.04) / (R * 0.1)) / Math.tan(g.pitch) + r.gauss() * (0.1 + 0.05 * R / Math.max(rr, 1)) * 0.9; }
      else th = r() * TAU;
      const y = r.gauss() * hz * (arm ? 0.8 : 1.4);
      const young = arm && r() < 0.5, hii = arm && r() < 0.05;
      const c = hii ? pink : young ? mixc(g.armCol, white, r() * 0.4) : mixc(white, g.coreCol, r() * 0.6);
      put(i, rr * Math.cos(th), y, rr * Math.sin(th), c, R * (hii ? r.range(0.008, 0.016) : r.range(0.016, 0.034)), hii ? 1.6 : arm ? 0.85 : 0.6);
    }
    for (let i = 0; i < Nd; i++) {
      const rr = rb * 2.2 + (-hr * Math.log(1 - r() * (1 - Math.exp(-R / hr)))), k = Math.floor(r() * n);
      const th = g.armPhase + k * TAU / n + Math.log(Math.max(rr, R * 0.04) / (R * 0.1)) / Math.tan(g.pitch) - 0.09 + r.gauss() * 0.06;
      dpos.set([rr * Math.cos(th), r.gauss() * hz * 0.35, rr * Math.sin(th)], i * 3); dsize[i] = R * r.range(0.014, 0.034);
    }
  } else if (g.type === 'elliptical') {
    for (let i = 0; i < N; i++) {
      const s = -0.15 * R * Math.log(1 - r() * 0.995) * 0.9, u = r() * 2 - 1, t = r() * TAU, q = Math.sqrt(1 - u * u);
      put(i, s * q * Math.cos(t) * g.ax[0], s * u * g.ax[2], s * q * Math.sin(t) * g.ax[1], mixc(g.coreCol, white, r() * 0.35), R * r.range(0.03, 0.07), 0.9);
    }
  } else {
    for (let i = 0; i < N; i++) {
      const c = g.clumps[Math.floor(r() * g.clumps.length)], s = c[3] / 1000;
      const blue = r() < 0.6;
      put(i, c[0] / 1000 + r.gauss() * s, c[1] / 1000 + r.gauss() * s * 0.6, c[2] / 1000 + r.gauss() * s, blue ? g.armCol : r() < 0.06 ? pink : white, R * r.range(0.02, 0.05), blue ? 1 : 0.7);
    }
  }
  return { pos, col, size, dpos: dpos.subarray(0, (g.type === 'spiral' || g.type === 'barred') ? Nd * 3 : 0), dsize: dsize.subarray(0, (g.type === 'spiral' || g.type === 'barred') ? Nd : 0) };
}

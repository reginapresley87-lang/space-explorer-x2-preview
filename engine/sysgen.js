// Star-system generation (pure data, deterministic). Procedural systems from a star record,
// plus the real systems: Sol (from v1's bodies), Alpha Centauri, Proxima, Sirius, Betelgeuse, TRAPPIST-1, Sgr A*.
import { hash, rng, clamp, LETTERS, ROMAN, tempColor, word } from './util.js';
import { starProps, spectral, CLASS_INFO, REAL_STARS } from './stars.js';
import { BODIES as CORE } from '../scene/bodies.js';
import { EXTRA } from '../scene/bodies_extra.js';

export const LY_PER_SU = 2.5e-5;           // 1 system unit = 2.5e-5 ly (systems use v1's compressed scale)
export const RSUN_KM = 695700, REARTH_KM = 6371;
export const bodyRadiusSu = km => Math.max(0.12, 0.35 * Math.sqrt(km / 1000));
export const starRadiusSu = (Rsun, cls) => cls === 'BH' ? 0 : cls === 'NS' ? 0.3 : Math.max(0.5, 6 * Math.sqrt(Rsun));
export const solOrbit = au => 16 + 26 * Math.pow(au, 0.6);
const moonF = ratio => ratio <= 60 ? 1.6 + 0.55 * Math.sqrt(ratio) : 1.6 + 0.55 * Math.sqrt(60) + 1.5 * Math.log(ratio / 60);

export const TYPE_LABEL = { rocky: 'Rocky planet', ocean: 'Ocean world', lava: 'Lava world', ice: 'Ice world', desert: 'Desert world', gas: 'Gas giant', icegiant: 'Ice giant' };
const MOON_LABEL = { rocky: 'Rocky moon', ocean: 'Ocean moon', lava: 'Volcanic moon', ice: 'Icy moon', desert: 'Dusty moon' };
const hsl = (h, s, l) => { h = ((h % 1) + 1) % 1; const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
function palette(type, r) {
  const j = (h, s, l, dh = 0.04) => hsl(h + (r() - 0.5) * dh, clamp(s + (r() - 0.5) * 0.2, 0, 1), clamp(l + (r() - 0.5) * 0.12, 0, 1));
  switch (type) {
    case 'rocky': { const h = r.pick([0.06, 0.08, 0.1, 0.03, 0.0, 0.55, 0.12]); return [j(h, 0.25, 0.55), j(h, 0.2, 0.25), j(h + 0.05, 0.3, 0.4), j(h, 0.1, 0.7)]; }
    case 'ocean': { const g = r() < 0.75; return [g ? j(0.27, 0.45, 0.32, 0.12) : j(0.08, 0.4, 0.4), j(0.09, 0.3, 0.45), j(r.pick([0.58, 0.6, 0.53, 0.5]), 0.7, 0.32), j(0, 0, 0.9)]; }
    case 'lava': return [j(0.02, 0.2, 0.18), j(0.0, 0.1, 0.08), j(r.pick([0.04, 0.07, 0.02]), 1, 0.55), j(0, 0, 0)];
    case 'ice': { const h = r.pick([0.55, 0.58, 0.5, 0.08]); return [j(h, 0.25, 0.9), j(h, 0.3, 0.68), j(h + 0.02, 0.5, 0.5), j(0, 0, 1)]; }
    case 'desert': { const h = r.pick([0.08, 0.1, 0.06, 0.03, 0.12]); return [j(h, 0.55, 0.65), j(h, 0.45, 0.4), j(h - 0.02, 0.5, 0.5), j(0, 0, 0.9)]; }
    case 'gas': { const h = r.pick([0.08, 0.07, 0.1, 0.05, 0.55, 0.0, 0.13]); return [j(h, 0.45, 0.75), j(h + 0.02, 0.5, 0.45), j(h - 0.03, 0.35, 0.6), j(h + 0.5, 0.4, 0.5)]; }
    default: { const h = r.pick([0.5, 0.53, 0.6, 0.62]); return [j(h, 0.5, 0.7), j(h + 0.03, 0.55, 0.55), j(h - 0.02, 0.4, 0.8), j(h, 0.5, 0.4)]; }
  }
}
const hex = c => (Math.round(clamp(c[0], 0, 1) * 255) << 16) | (Math.round(clamp(c[1], 0, 1) * 255) << 8) | Math.round(clamp(c[2], 0, 1) * 255);

function visualFor(type, r, tempK) {
  const v = { palette: palette(type, r), sea: 0.5, ice: 1.2, clouds: 0, bands: 7, turb: 0.5, atmo: null, atmoK: 1.2 };
  if (type === 'ocean') { v.sea = r.range(0.45, 0.62); v.clouds = r.range(0.3, 0.75); v.ice = tempK < 250 ? r.range(0.55, 0.75) : r.range(0.8, 0.95); v.atmo = 0x7ab8ff; }
  if (type === 'desert') { v.ice = tempK < 260 ? r.range(0.75, 0.9) : 1.5; if (r() < 0.6) v.atmo = 0xffc890; v.clouds = r() < 0.3 ? 0.15 : 0; }
  if (type === 'rocky' && r() < 0.35) { v.atmo = hex(hsl(r(), 0.4, 0.7)); v.atmoK = 0.7; }
  if (type === 'lava') { v.atmo = r() < 0.5 ? 0xff8040 : null; }
  if (type === 'ice' && r() < 0.3) { v.atmo = 0xa8d8ff; v.atmoK = 0.6; }
  if (type === 'gas') { v.bands = r.range(5, 12); v.turb = r.range(0.3, 1); v.atmo = hex(v.palette[0]); v.atmoK = 0.5; v.storm = r() < 0.5 ? r.range(-0.5, 0.5) : null; }
  if (type === 'icegiant') { v.bands = r.range(2, 5); v.turb = r.range(0.1, 0.35); v.atmo = hex(v.palette[0]); v.atmoK = 0.8; }
  v.palette = v.palette.map(hex);
  return v;
}

function finishBody(b) {
  b.radiusSu = bodyRadiusSu(b.radiusKm);
  if (b.gravity == null) b.gravity = b.massE / Math.pow(b.radiusKm / REARTH_KM, 2);
  b.landable = !['gas', 'icegiant', 'star'].includes(b.type) && b.kind !== 'star';
  return b;
}

// ---------- procedural ----------
export function proceduralSystem(st, gal) {
  const r = rng(hash(st.seed, 0x5157));
  const sys = { id: st.id, name: st.name, galId: gal.id, gpos: st.gpos.clone(), real: false, procedural: true, stars: [], bodies: [], seed: st.seed };
  const A = { key: 'A', kind: 'star', name: st.name, cls: st.cls, T: st.T, R: st.R, M: st.M, L: st.L, color: st.color, absMag: st.absMag, sub: spectral(st.cls, st.T) };
  sys.stars.push(A);
  const ms = 'OBAFGKM'.includes(st.cls) && st.cls.length === 1;
  if (ms && r() < ({ O: 0.6, B: 0.5, A: 0.45, F: 0.45, G: 0.4, K: 0.33, M: 0.25 }[st.cls])) {
    const q = r.range(0.25, 0.95), M = st.M * q;
    const cls = M > 16 ? 'O' : M > 2.1 ? 'B' : M > 1.4 ? 'A' : M > 1.04 ? 'F' : M > 0.8 ? 'G' : M > 0.45 ? 'K' : 'M';
    const p = starProps(cls, rng(hash(st.seed, 0xb2)));
    sys.stars.push({ key: 'B', kind: 'star', name: st.name + ' B', cls, ...p, M, sub: spectral(cls, p.T) });
    A.name = st.name + ' A'; sys.binarySepAU = r.range(0.04, 0.4) * Math.sqrt(st.M);
  }
  const Ltot = sys.stars.reduce((a, s) => a + s.L, 0) || 1e-4, Mtot = sys.stars.reduce((a, s) => a + s.M, 0);
  let nP;
  if (st.cls === 'BH') nP = r() < 0.3 ? 1 : 0;
  else if (st.cls === 'NS') nP = r.int(0, 3);
  else if (st.cls === 'WD') nP = r.int(0, 3);
  else if (['KIII', 'MIII', 'SG'].includes(st.cls)) nP = r.int(0, 4);
  else nP = st.cls === 'M' ? r.int(1, 6) : 'OB'.includes(st.cls) ? r.int(0, 4) : r.int(2, 9);
  const Lh = Math.max(Ltot, 1e-4);
  let a = clamp(0.1 * Math.sqrt(Lh), 0.01, 3) * r.range(0.5, 1.4);
  if (sys.binarySepAU) a = Math.max(a, sys.binarySepAU * 3.5);
  if (['KIII', 'MIII', 'SG'].includes(st.cls)) a = Math.max(a, st.R * 0.00465 * 4);
  const snow = 2.7 * Math.sqrt(Lh);
  for (let i = 0; i < nP; i++) {
    const T = st.cls === 'BH' ? 40 : 278 * Math.pow(Lh, 0.25) / Math.sqrt(a);
    let type;
    const u = r();
    if (a > snow) type = u < 0.5 ? 'gas' : u < 0.75 ? 'icegiant' : 'ice';
    else if (a < 0.1 && u < 0.08) type = 'gas';
    else if (T > 900) type = u < 0.7 ? 'lava' : 'rocky';
    else if (T > 400) type = u < 0.5 ? 'desert' : u < 0.85 ? 'rocky' : 'lava';
    else if (T > 230) type = u < 0.42 ? 'ocean' : u < 0.7 ? 'rocky' : 'desert';
    else if (T > 150) type = u < 0.45 ? 'ice' : u < 0.8 ? 'rocky' : 'ocean';
    else type = u < 0.7 ? 'ice' : 'rocky';
    if (['WD', 'NS', 'BH'].includes(st.cls) && (type === 'ocean')) type = 'ice';
    let Re, massE;
    if (type === 'gas') { Re = r.range(6, 13); massE = r.range(40, 1200) * (Re / 11) ** 0.3; }
    else if (type === 'icegiant') { Re = r.range(3.2, 4.6); massE = r.range(10, 22); }
    else if (type === 'ocean') { Re = r.range(0.7, 2.1); massE = Math.pow(Re, 3.2) * r.range(0.6, 0.9); }
    else if (type === 'ice') { Re = r.range(0.2, 1.3); massE = Math.pow(Re, 3) * r.range(0.35, 0.6); }
    else { Re = r.range(0.3, 1.7); massE = Math.pow(Re, 3.4) * r.range(0.8, 1.2); }
    const key = 'p' + (i + 1), letter = LETTERS[i];
    const v = visualFor(type, r, T);
    const b = finishBody({ key, kind: 'planet', parent: null, type, label: TYPE_LABEL[type], name: st.name + ' ' + letter, radiusKm: Re * REARTH_KM, massE, tempK: Math.round(T * (v.atmo && type !== 'gas' ? 1.08 : 1)),
      au: a, periodDays: 365.25 * Math.sqrt(a ** 3 / Math.max(Mtot, 0.05)), L0: r() * 360, incl: r.range(-3, 3), tilt: r.range(0, 35), dayHours: r.range(8, 60) * (r() < 0.1 ? -1 : 1),
      seed: hash(st.seed, i, 0x9a), ...v, procedural: true });
    if ((type === 'gas' && r() < 0.42) || (type === 'icegiant' && r() < 0.3) || (type !== 'gas' && type !== 'icegiant' && r() < 0.04))
      b.rings = { inner: r.range(1.25, 1.5), outer: r.range(1.9, 2.6), color: hex(hsl(r.range(0.05, 0.12), 0.25, r.range(0.6, 0.8))), seed: r() * 100 };
    sys.bodies.push(b);
    const nM = type === 'gas' ? r.int(1, 5) : type === 'icegiant' ? r.int(1, 3) : r() < 0.35 ? r.int(1, 2) : 0;
    let mk = 0;
    for (let k = 0; k < nM; k++) {
      const Tm = T * 0.95, mt = Tm > 600 ? 'lava' : (type === 'gas' && k === 0 && r() < 0.3) ? 'lava' : Tm > 240 ? r.pick(['rocky', 'desert', 'rocky']) : r.pick(['ice', 'ice', 'rocky']);
      const mR = type === 'gas' || type === 'icegiant' ? r.range(0.08, 0.45) : r.range(0.05, 0.3);
      const mv = visualFor(mt, r, Tm); mv.atmo = mt === 'ice' && r() < 0.2 ? 0xffb860 : null; mv.clouds = 0;
      const dist = b.radiusKm * r.range(4, 40) * (1 + k * 0.6);
      sys.bodies.push(finishBody({ key: `${key}m${++mk}`, kind: 'moon', parent: key, type: mt, label: MOON_LABEL[mt], name: `${b.name} ${ROMAN[k]}`, radiusKm: mR * REARTH_KM,
        massE: Math.pow(mR, 3) * 0.6, tempK: Math.round(Tm), km: dist, periodDays: r.range(0.8, 30), phase: r() * 6.283, incl: r.range(-8, 8), seed: hash(st.seed, i, k, 0x3c), ...mv, procedural: true, locked: true }));
    }
    a *= r.range(1.45, 2.1);
  }
  return layout(sys);
}

// supermassive black hole at a galaxy centre
export function coreSystem(gal) {
  const r = rng(hash(gal.seed, 0xc0));
  const M = gal.id === 'mw' ? 4.3e6 : Math.round(Math.pow(10, 6 + r() * 3) * (gal.R / 50000));
  const name = gal.id === 'mw' ? 'Sagittarius A*' : `${gal.name} core`;
  const sys = { id: gal.id === 'mw' ? 'sgra' : gal.id + '/core', name, galId: gal.id, gpos: { x: 0, y: 0, z: 0 }, real: gal.id === 'mw', stars: [], bodies: [], seed: gal.seed,
    procedural: gal.id !== 'mw' };
  sys.stars.push({ key: 'A', kind: 'star', name, cls: 'BH', T: 0, M, R: M * 2.95 / RSUN_KM, L: 0, color: [1, 0.6, 0.3], sub: 'supermassive black hole', supermassive: true,
    fact: gal.id === 'mw' ? 'The 4.3-million-solar-mass black hole at the centre of the Milky Way, imaged by the Event Horizon Telescope in 2022.' : null });
  return layout(sys);
}

// ---------- real systems ----------
const realStar = id => REAL_STARS.find(s => s.id === id);
const SOL_FACTS = {
  Sun: { tempK: 5772, gravity: 27.9 }, Mercury: { tempK: 440, gravity: 0.38 }, Venus: { tempK: 737, gravity: 0.904 }, Earth: { tempK: 288, gravity: 1 },
  Moon: { tempK: 250, gravity: 0.165 }, Mars: { tempK: 210, gravity: 0.379 }, Jupiter: { tempK: 165, gravity: 2.53 }, Saturn: { tempK: 134, gravity: 1.07 },
  Uranus: { tempK: 76, gravity: 0.886 }, Neptune: { tempK: 72, gravity: 1.14 }, Pluto: { tempK: 44, gravity: 0.063 }, Io: { tempK: 110, gravity: 0.183 },
  Europa: { tempK: 102, gravity: 0.134 }, Ganymede: { tempK: 110, gravity: 0.146 }, Callisto: { tempK: 134, gravity: 0.126 }, Titan: { tempK: 94, gravity: 0.138 },
  Triton: { tempK: 38, gravity: 0.08 }, Enceladus: { tempK: 75, gravity: 0.0115 }, Charon: { tempK: 53, gravity: 0.0294 },
};
const SOL_TYPE = { Mercury: 'rocky', Venus: 'desert', Earth: 'ocean', Mars: 'desert', Jupiter: 'gas', Saturn: 'gas', Uranus: 'icegiant', Neptune: 'icegiant', Pluto: 'ice' };
const SOL_LABEL = { Mercury: 'Terrestrial planet', Venus: 'Terrestrial planet', Earth: 'Terrestrial planet – home', Mars: 'Terrestrial planet', Jupiter: 'Gas giant', Saturn: 'Gas giant', Uranus: 'Ice giant', Neptune: 'Ice giant', Pluto: 'Dwarf planet' };
function solSystem() {
  const all = [...CORE, ...EXTRA], st = realStar('sol');
  const sys = { id: 'sol', name: 'Solar System', galId: 'mw', gpos: st.gpos.clone(), real: true, stars: [], bodies: [], sol: true };
  sys.stars.push({ key: 'sun', kind: 'star', name: 'Sun', cls: 'G', T: 5772, R: 1, M: 1, L: 1, color: tempColor(5772), sub: 'G2V', tex: 'sun', radiusSu: 6 });
  for (const c of all) {
    if (c.type === 'star') continue;
    const key = c.name.toLowerCase(), f = SOL_FACTS[c.name] || {};
    const parent = c.parent === 'Sun' ? null : c.parent.toLowerCase();
    const au = c.au ?? null;
    const T = f.tempK ?? Math.round(278 / Math.sqrt(au ?? all.find(p => p.name === c.parent).au) * 0.92);
    const g = f.gravity ?? +(1.6 / 5.51 * c.radiusKm / REARTH_KM).toFixed(4);
    sys.bodies.push(finishBody({ key, kind: c.type === 'moon' ? 'moon' : 'planet', parent, name: c.name, type: SOL_TYPE[c.name] || 'rocky', label: SOL_LABEL[c.name] || (c.type === 'moon' ? 'Moon' : c.type),
      radiusKm: c.radiusKm, gravity: g, massE: null, tempK: T, au, km: c.km, periodDays: c.yearDays, L0: c.L0, incl: c.incl || 0, tilt: c.tilt || 0, dayHours: c.dayHours, locked: c.locked, irr: c.irr,
      tex: c.tex, atmo: c.atmo ?? null, clouds: c.clouds ? 1 : 0, rings: c.rings ? { sol: true, inner: 1.24, outer: 2.27 } : null, real: true, sol: true }));
  }
  sys.bodies.find(b => b.key === 'pluto').kind = 'planet';
  return layout(sys, true);
}
function realBody(sys, key, name, type, o) {
  const r = rng(hash(sys.id, key));
  const v = visualFor(type, r, o.tempK);
  return finishBody({ key, kind: 'planet', parent: null, type, label: TYPE_LABEL[type] + ' (appearance imagined)', name, seed: hash(sys.id, key, 1), L0: r() * 360, incl: 0.2, tilt: 0, dayHours: o.periodDays * 24, locked: true, real: true, ...v, ...o });
}
function realSystems(id) {
  const st = realStar(id); if (!st) return null;
  const base = { id, name: st.name, galId: 'mw', gpos: st.gpos.clone(), real: true, stars: [], bodies: [] };
  const S = (key, name, cls, T, R, L, M, sub, extra = {}) => ({ key, kind: 'star', name, cls, T, R, L, M, sub, color: cls === 'WD' ? tempColor(Math.min(T, 12000)) : tempColor(T), ...extra });
  switch (id) {
    case 'alphacen':
      base.stars.push(S('A', 'Alpha Centauri A', 'G', 5790, 1.2234, 1.519, 1.079, 'G2V'), S('B', 'Alpha Centauri B', 'K', 5260, 0.8632, 0.5, 0.909, 'K1V'));
      base.binarySepAU = 23.5; base.binaryPeriodDays = 79.9 * 365.25; base.fact = 'The closest star system to the Sun after Proxima: two Sun-like stars orbiting each other every 80 years.';
      break;
    case 'proxima':
      base.stars.push(S('A', 'Proxima Centauri', 'M', 3042, 0.1542, 0.00155, 0.122, 'M5.5Ve', { fact: 'The nearest star to the Sun, 4.25 light-years away – a small, flaring red dwarf.' }));
      base.bodies.push(realBody(base, 'd', 'Proxima d', 'desert', { radiusKm: 0.81 * REARTH_KM, massE: 0.26, tempK: 360, au: 0.02885, periodDays: 5.122, fact: 'A small planet (at least a quarter of Earth\'s mass) found in 2022 by radial velocity.' }));
      base.bodies.push(realBody(base, 'b', 'Proxima b', 'rocky', { radiusKm: 1.07 * REARTH_KM, massE: 1.07, tempK: 234, au: 0.04857, periodDays: 11.186, atmo: 0x9ab8e0, atmoK: 0.6,
        fact: 'At least 1.07 Earth masses, in the habitable zone of Proxima Centauri. Whether it kept an atmosphere is unknown. Radius estimated.' }));
      break;
    case 'sirius':
      base.stars.push(S('A', 'Sirius A', 'A', 9940, 1.711, 25.4, 2.063, 'A1V', { fact: 'The brightest star in Earth\'s night sky, 8.6 light-years away.' }),
        S('B', 'Sirius B', 'WD', 25000, 0.0084, 0.056, 1.018, 'DA2', { fact: 'A white dwarf: about the size of Earth but with the mass of the Sun.' }));
      base.binarySepAU = 20; base.binaryPeriodDays = 50.1 * 365.25;
      break;
    case 'betelgeuse':
      base.stars.push(S('A', 'Betelgeuse', 'SG', 3600, 764, 126000, 18, 'M1-2 Ia-ab', { fact: 'A red supergiant in Orion about 550 light-years away. Placed where the Sun is, it would reach past Mars. It will end as a supernova.' }));
      break;
    case 'trappist1': {
      base.stars.push(S('A', 'TRAPPIST-1', 'M', 2566, 0.1192, 0.000553, 0.0898, 'M8V', { fact: 'An ultracool red dwarf 40.7 light-years away with seven Earth-sized planets.' }));
      const P = [['b', 1.116, 1.374, 0.01154, 1.5109, 400, 'desert'], ['c', 1.097, 1.308, 0.0158, 2.4218, 342, 'rocky'], ['d', 0.788, 0.388, 0.02227, 4.0496, 288, 'ocean'],
        ['e', 0.920, 0.692, 0.02925, 6.0996, 251, 'ocean'], ['f', 1.045, 1.039, 0.03849, 9.2067, 219, 'ice'], ['g', 1.129, 1.321, 0.04683, 12.3529, 199, 'ice'], ['h', 0.755, 0.326, 0.06189, 18.7729, 173, 'ice']];
      for (const [k, R, M, au, per, T, type] of P) base.bodies.push(realBody(base, k, 'TRAPPIST-1' + k, type, { radiusKm: R * REARTH_KM, massE: M, tempK: T, au, periodDays: per,
        fact: k === 'e' ? 'The most promising TRAPPIST-1 world for liquid water: rocky, Earth-sized, in the habitable zone.' : k === 'b' || k === 'c' ? 'JWST measurements suggest no thick atmosphere on this hot inner planet.' : 'One of seven Earth-sized planets packed closer to their star than Mercury is to the Sun.' }));
      break;
    }
    default: return null;
  }
  return layout(base);
}

// ---------- layout in compressed system units ----------
function layout(sys, isSol = false) {
  for (const s of sys.stars) { s.radiusSu = s.radiusSu || (s.cls === 'BH' ? (s.supermassive ? 24 : 1.4) : starRadiusSu(s.R, s.cls)); s.id = sys.id + '#' + s.key; s.sysId = sys.id; s.label = s.cls === 'BH' && s.supermassive ? 'Supermassive black hole' : CLASS_INFO[s.cls] || 'Star'; }
  // binary: stars orbit the barycentre
  let core = sys.stars[0].radiusSu * (sys.stars[0].cls === 'BH' ? 8 : 1);
  if (sys.stars.length > 1) {
    const [A, B] = sys.stars, sepSu = sys.binarySepAU > 3 ? solOrbit(sys.binarySepAU) : (A.radiusSu + B.radiusSu) * 1.6 + 4 + sys.binarySepAU * 20;
    const Mt = A.M + B.M; A.orbitSu = sepSu * B.M / Mt; B.orbitSu = sepSu * A.M / Mt; A.phase = 0; B.phase = Math.PI;
    sys.binaryPeriodDays = sys.binaryPeriodDays || 365.25 * Math.sqrt(sys.binarySepAU ** 3 / Mt);
    A.periodDays = B.periodDays = sys.binaryPeriodDays;
    core = Math.max(A.orbitSu + A.radiusSu, B.orbitSu + B.radiusSu);
  }
  let prev = null;
  const planets = sys.bodies.filter(b => b.kind === 'planet');
  // moon distances first (needed for spacing)
  for (const p of planets) {
    let last = null; p.moonExtent = p.radiusSu * (p.rings ? p.rings.outer : 1);
    for (const m of sys.bodies.filter(b => b.parent === p.key)) {
      let d = p.radiusSu * moonF(m.km / p.radiusKm);
      if (p.rings) d = Math.max(d, p.radiusSu * (p.rings.outer + 0.15));
      if (last) d = Math.max(d, last.d + 1.15 * (last.r + m.radiusSu) + 0.08);
      m.orbitSu = d; last = { d, r: m.radiusSu }; p.moonExtent = Math.max(p.moonExtent, d + m.radiusSu);
    }
  }
  const s0 = isSol ? 0 : Math.max(16, core * 1.6 + 6);
  for (const p of planets) {
    let o = isSol ? solOrbit(p.au) : s0 + 26 * Math.pow(p.au, 0.6) - (sys.id === 'trappist1' || sys.id === 'proxima' ? 0 : 0);
    if (!isSol && prev) o = Math.max(o, prev.orbitSu + (prev.moonExtent + p.moonExtent) * 1.25 + 3);
    p.orbitSu = o; prev = p;
  }
  // compact real systems (TRAPPIST-1, Proxima): spread the tightly packed orbits for readability
  sys.extentSu = Math.max(core * 3, ...planets.map(p => p.orbitSu + p.moonExtent), 30);
  for (const b of sys.bodies) { b.id = sys.id + '#' + b.key; b.sysId = sys.id; }
  sys.enterLy = Math.max(0.05, sys.extentSu * 2.2 * LY_PER_SU);
  return sys;
}

const sysCache = new Map();
export function systemFor(id, resolveStar, resolveGalaxy) {
  if (sysCache.has(id)) return sysCache.get(id);
  let sys = null;
  if (id === 'sol') sys = solSystem();
  else if (id === 'sgra') sys = coreSystem(resolveGalaxy('mw'));
  else if (/\/core$/.test(id)) { const g = resolveGalaxy(id.slice(0, -5)); sys = g && coreSystem(g); }
  else if (REAL_STARS.some(s => s.id === id)) sys = realSystems(id);
  else { const st = resolveStar(id); if (st) sys = proceduralSystem(st, resolveGalaxy(st.galId)); }
  if (sys) { applyScale(sys); sysCache.set(id, sys); if (sysCache.size > 64) sysCache.delete(sysCache.keys().next().value); }
  return sys;
}

// ---------- true-scale option: swap the compressed layout for real radii and distances (1 su = 2.365e8 km) ----------
export const SU_KM = LY_PER_SU * 9.4607e12, AU_SU = 1.495979e8 / SU_KM;
let REAL_SCALE = false;
export const isRealScale = () => REAL_SCALE;
export function setRealScale(on) { REAL_SCALE = !!on; for (const s of sysCache.values()) applyScale(s); }
function applyScale(sys) {
  const all = [...sys.stars, ...sys.bodies];
  if (!sys.compressed) sys.compressed = all.map(b => ({ b, radiusSu: b.radiusSu, orbitSu: b.orbitSu, moonExtent: b.moonExtent }));
  if (!!sys.realScale === REAL_SCALE && sys.scaleApplied) return;
  sys.scaleApplied = true; sys.realScale = REAL_SCALE;
  if (!REAL_SCALE) { for (const c of sys.compressed) Object.assign(c.b, { radiusSu: c.radiusSu, orbitSu: c.orbitSu, moonExtent: c.moonExtent }); return; }
  for (const s of sys.stars) s.radiusSu = s.cls === 'BH' ? Math.max(s.M * 2.95, 1) / SU_KM : s.R * RSUN_KM / SU_KM;
  if (sys.stars.length > 1) { const [A, B] = sys.stars, sep = (sys.binarySepAU || 0.1) * AU_SU, Mt = A.M + B.M; A.orbitSu = sep * B.M / Mt; B.orbitSu = sep * A.M / Mt; }
  for (const b of sys.bodies) {
    b.radiusSu = b.radiusKm / SU_KM;
    if (b.kind === 'planet') b.orbitSu = (b.au || 1) * AU_SU;
    else { const p = sys.bodyMap ? sys.bodyMap[b.parent] : sys.bodies.find(x => x.key === b.parent); b.orbitSu = Math.max(b.km || p.radiusKm * 20, p.radiusKm * 1.5) / SU_KM; }
  }
  for (const p of sys.bodies.filter(b => b.kind === 'planet')) {
    p.moonExtent = p.radiusSu * (p.rings ? p.rings.outer : 1);
    for (const m of sys.bodies.filter(b => b.parent === p.key)) p.moonExtent = Math.max(p.moonExtent, m.orbitSu + m.radiusSu);
  }
}

// position of a star / body in system units at simDays (system-local frame)
export function bodyPosition(sys, b, days, out) {
  if (b.kind === 'star') {
    if (!b.orbitSu) return out.set(0, 0, 0);
    const a = b.phase + 6.2832 * days / b.periodDays;
    return out.set(Math.cos(a) * b.orbitSu, 0, -Math.sin(a) * b.orbitSu);
  }
  if (b.kind === 'planet') {
    const a = (b.L0 + 360 * days / b.periodDays) * Math.PI / 180, i = (b.incl || 0) * Math.PI / 180;
    const x = Math.cos(a) * b.orbitSu, z = -Math.sin(a) * b.orbitSu;
    return out.set(x, -z * Math.sin(i), z * Math.cos(i));
  }
  const p = sys.bodyMap ? sys.bodyMap[b.parent] : sys.bodies.find(x => x.key === b.parent);
  bodyPosition(sys, p, days, out);
  const a = (b.phase ?? 0) + 6.2832 * days / b.periodDays * 0.1, i = (b.incl || 0) * Math.PI / 180 + (b.irr ? 0.4 : 0);
  const x = Math.cos(a) * b.orbitSu, z = -Math.sin(a) * b.orbitSu;
  return out.add({ x, y: -z * Math.sin(i), z: z * Math.cos(i) });
}

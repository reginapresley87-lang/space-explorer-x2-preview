// OpenStreetMap buildings near the camera on Earth: footprints from the Overpass API, extruded into one merged mesh.
// Small requests (~400 m), one at a time, debounced, cached in memory + localStorage; fails silently offline.
import * as THREE from '../scene/vendor/three.module.min.js?v=20261014b';
const EP = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const D = Math.PI / 180, CELL = 0.004, RAD = 400, MAXB = 1500, mem = new Map();
// bundled footprints (data/buildings/*.json, ~1 km around each spot; offline-safe); live Overpass everywhere else
const BUNDLE = { sydney: [-33.8568, 151.2153], melbourne: [-37.8183, 144.9671], brisbane: [-27.4698, 153.0251], darwin: [-12.4655, 130.8456], surfers: [-28.0023, 153.4310] };
const bundled = new Map();   // name -> list | 'loading' | 'failed'
function loadBundle(n) {
  bundled.set(n, 'loading');
  fetch(new URL('../data/buildings/' + n + '.json?v=20261022m', import.meta.url)).then(r => r.ok ? r.json() : null).then(j => {
    if (!j) { bundled.set(n, 'failed'); return; }
    const [la, lo] = j.c, out = [];
    for (const a of j.b) { const p = []; let y = 0, x = 0; for (let i = 1; i + 1 < a.length; i += 2) { y += a[i]; x += a[i + 1]; p.push(la + y * 1e-5, lo + x * 1e-5); } out.push([a[0], p]); if (out.length >= MAXB) break; }
    bundled.set(n, out);
  }).catch(() => bundled.set(n, 'failed'));
}
export function llDir(lat, lon, o = new THREE.Vector3()) { const c = Math.cos(lat * D); return o.set(c * Math.cos(lon * D), Math.sin(lat * D), -c * Math.sin(lon * D)); }
export function dirLL(x, y, z) { const r = Math.hypot(x, y, z) || 1; return [Math.asin(Math.max(-1, Math.min(1, y / r))) / D, Math.atan2(-z, x) / D]; }
function hOf(t) { const h = parseFloat(t.height); if (h > 0 && h < 900) return h; const l = parseFloat(t['building:levels']); return l > 0 && l < 200 ? l * 3.2 : 6; }
async function fetchCell(lat, lon) {
  const q = `[out:json][timeout:20];way[building](around:${RAD},${lat.toFixed(5)},${lon.toFixed(5)});out tags geom ${MAXB};`;
  for (const u of EP) {
    try {
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), 15000);
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ac.signal });
      clearTimeout(to); if (!r.ok) continue;
      const j = await r.json(), out = [];
      for (const e of j.elements || []) { if (!e.geometry || e.geometry.length < 4) continue; const p = []; for (const g of e.geometry) p.push(+g.lat.toFixed(6), +g.lon.toFixed(6)); out.push([+hOf(e.tags || {}).toFixed(1), p]); if (out.length >= MAXB) break; }
      return out;
    } catch (e) { /* next mirror */ }
  }
  return null;
}
export function createBuildings(layer) {
  let mesh = null, meshKey = '', want = '', wantT = 0, busy = false, credit = null;
  const failT = new Map(), mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  function showCredit(on) {
    if (on && !credit) { credit = document.createElement('a'); credit.href = 'https://www.openstreetmap.org/copyright'; credit.target = '_blank'; credit.rel = 'noopener'; credit.textContent = '© OpenStreetMap contributors';
      credit.style.cssText = 'position:fixed;left:8px;bottom:6px;z-index:6;font:11px system-ui;color:#cde;opacity:.75;text-decoration:none;text-shadow:0 0 3px #000'; document.body.appendChild(credit); }
    if (credit) credit.style.display = on ? 'block' : 'none';
  }
  function drop() { if (mesh) { mesh.geometry.dispose(); mesh.removeFromParent(); mesh = null; meshKey = ''; } }
  function build(terr, key, list, clat, clon) {
    drop(); if (!list || !list.length) return;
    const up = llDir(clat, clon), C = up.clone().multiplyScalar(terr.surfaceR(up.x, up.y, up.z));
    const pos = [], col = [], v = new THREE.Vector3(), kx = Math.cos(clat * D);
    const push = (p, s) => { pos.push(p.x - C.x, p.y - C.y, p.z - C.z); col.push(s * .86, s * .84, s * .8); };
    for (const [h, ll] of list) {
      const n = ll.length / 2 - 1; if (n < 3) continue;   // closed ring: last node = first
      const dirs = [], pts2 = []; let rmin = Infinity, rmax = 0;
      for (let i = 0; i < n; i++) { const d = llDir(ll[i * 2], ll[i * 2 + 1]); const r = terr.surfaceR(d.x, d.y, d.z); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); dirs.push(d); pts2.push(new THREE.Vector2(ll[i * 2 + 1] * kx, ll[i * 2])); }
      const r0 = rmin - 1.5, r1 = rmax + h;
      for (let i = 0; i < n; i++) { const a = dirs[i], b = dirs[(i + 1) % n], pa = pts2[i], pb = pts2[(i + 1) % n];
        const s = .5 + .35 * Math.abs(Math.cos(Math.atan2(pb.y - pa.y, pb.x - pa.x) + .6));
        const a0 = v.copy(a).multiplyScalar(r0).clone(), a1 = a.clone().multiplyScalar(r1), b0 = b.clone().multiplyScalar(r0), b1 = b.clone().multiplyScalar(r1);
        push(a0, s); push(b0, s); push(b1, s); push(a0, s); push(b1, s); push(a1, s); }
      let tri; try { tri = THREE.ShapeUtils.triangulateShape(pts2, []); } catch (e) { tri = []; }
      for (const t of tri) for (const k of t) push(dirs[k].clone().multiplyScalar(r1), .95);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeBoundingSphere();
    mat.side = THREE.DoubleSide; mesh = new THREE.Mesh(g, mat); mesh.layers.set(layer);
    mesh.position.copy(C).divideScalar(terr.mPerSu); mesh.scale.setScalar(1 / terr.mPerSu); mesh.userData.n = list.length;
    terr.group.add(mesh); meshKey = key;
  }
  return {
    get count() { return mesh ? mesh.userData.n : 0; },
    // terr: Earth's terrain (or null), (x, y, z): camera in the planet frame (metres)
    update(terr, x, y, z, sunUp = 1) {
      const alt = terr ? Math.hypot(x, y, z) - terr.R : Infinity;
      if (!terr || terr.it.b.key !== 'earth' || alt > 2000 || !terr.group.visible) { if (alt > 4000 || !terr || terr.it.b.key !== 'earth') drop(); showCredit(false); return; }
      if (mesh && mesh.parent !== terr.group) drop();
      const [lat, lon] = dirLL(x, y, z), cy = Math.round(lat / CELL), cx = Math.round(lon / CELL), key = cy + ':' + cx, clat = cy * CELL, clon = cx * CELL;
      mat.color.setScalar(.06 + .94 * Math.min(1, Math.max(0, (sunUp + .08) / .35)));   // dim with the daylight
      for (const n in BUNDLE) { const [la, lo] = BUNDLE[n], dy = (lat - la) * 111e3, dx = (lon - lo) * 111e3 * Math.cos(la * D);
        if (dx * dx + dy * dy > 1100 * 1100) continue;
        const st = bundled.get(n); if (st === undefined) loadBundle(n);
        if (Array.isArray(st)) { if (meshKey !== 'b:' + n || (mesh && mesh.parent !== terr.group)) build(terr, 'b:' + n, st, la, lo); showCredit(!!mesh); return; }
        if (st !== 'failed') return;   // still loading: wait instead of asking Overpass
      }
      showCredit(!!mesh);
      if (key === meshKey) return;
      let list = mem.get(key);
      if (!list) { try { const s = localStorage.getItem('se2osm:' + key); if (s) { list = JSON.parse(s); mem.set(key, list); } } catch (e) {} }
      if (list) { build(terr, key, list, clat, clon); return; }
      const now = performance.now();
      if (want !== key) { want = key; wantT = now; return; }
      if (busy || now - wantT < 1200 || now - (failT.get(key) || -1e9) < 60000) return;
      busy = true;
      fetchCell(clat, clon).then(l => { busy = false; if (!l) { failT.set(key, performance.now()); return; } mem.set(key, l);
        try { localStorage.setItem('se2osm:' + key, JSON.stringify(l)); } catch (e) {} }).catch(() => { busy = false; failT.set(key, performance.now()); });
    },
  };
}

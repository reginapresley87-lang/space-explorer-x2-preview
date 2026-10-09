// Space Explorer X 2 – UI half (adapted from v1's ui patterns). Talks to the engine only through window.SE2 + se2:* events.
export function initUI(SE2, opts = {}) {
  const base = new URL('..', import.meta.url);
  const sfx = n => { try { const a = new Audio(new URL('audio/' + n, base)); a.volume = 0.55; a.play().catch(() => {}); } catch {} };
  window.SE_SFX = sfx;
  const r = document.createElement('div'); r.id = 'x2-ui';
  r.innerHTML = `
    <div id="x2-labels"></div>
    <div id="x2-top"><input id="x2-search" type="search" placeholder="Search: Earth, Sirius, TRAPPIST-1e, Andromeda…" autocomplete="off" enterkeyhint="go"><button class="x2b" id="x2-bmbtn" title="Bookmarks">★</button></div>
    <div id="x2-results"></div>
    <div id="x2-hud"></div>
    <div id="x2-side">
      <button class="x2b" id="x2-home" title="Home (Earth)">🏠</button>
      <button class="x2b" id="x2-in" title="Zoom in">＋</button>
      <button class="x2b" id="x2-out" title="Zoom out">－</button>
      <button class="x2b" id="x2-rand" title="Random procedural planet">🎲</button>
      <button class="x2b" id="x2-boost" title="Free-fly speed boost">⚡1×</button>
      <button class="x2b" id="x2-orb" title="Show orbit lines">◎</button>
      <button class="x2b" id="x2-real" title="Real scale: true sizes and distances">📏</button>
      <button class="x2b" id="x2-q" title="Graphics quality">Med</button>
    </div>
    <div id="x2-card"></div>
    <div id="x2-panel" class="panel"></div>
    <button id="x2-takeoff">🚀 Take off</button>
    <div id="x2-toast"></div>
    <button id="x2-credits">ⓘ Credits</button>`;
  document.body.appendChild(r);
  const $ = s => r.querySelector(s);
  const card = $('#x2-card'), hud = $('#x2-hud'), results = $('#x2-results'), input = $('#x2-search'), panel = $('#x2-panel'), labelsEl = $('#x2-labels'), toast = $('#x2-toast');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let toastT = 0; const say = msg => { toast.textContent = msg; toast.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => toast.style.opacity = 0, 2200); };
  const go = (id, o) => { sfx('fly.mp3'); hideResults(); return SE2.goTo(id, o); };

  // ---------- info card ----------
  let cardId = null;
  function show(id) {
    const i = SE2.getInfo(id); if (!i) return;
    cardId = id; card.style.display = 'block'; document.body.classList.add('x2-card-open');
    const bm = SE2.getBookmarks().some(b => b.id === i.id);
    card.innerHTML = `<button class="x" aria-label="close">×</button><h2>${esc(i.name)}</h2><div class="ty">${esc(i.type || i.kind)}</div>
      ${i.procedural ? '<div class="disc">✨ Discovered by you!</div>' : ''}
      <table>${i.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
      ${i.fact ? `<p>${esc(i.fact)}</p>` : ''}
      <div class="acts"><button class="goto">🚀 Go to</button>${i.canLand ? '<button class="land">🛬 Land</button>' : ''}<button class="bm" title="Bookmark">${bm ? '★' : '☆'}</button></div>
      ${i.children.length ? `<div class="ch">${i.children.map(c => `<button data-id="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>` : ''}
      ${i.parent ? `<button class="up" data-id="${esc(i.parent.id)}">← ${esc(i.parent.name)}</button>` : ''}`;
    card.querySelector('.x').onclick = () => { card.style.display = 'none'; cardId = null; document.body.classList.remove('x2-card-open'); };
    card.querySelector('.goto').onclick = () => go(i.id);
    const L = card.querySelector('.land'); if (L) L.onclick = () => { sfx('land.mp3'); SE2.land(i.id); };
    card.querySelector('.bm').onclick = e => { if (bm) SE2.removeBookmark(i.id); else { SE2.addBookmark(i.id); say('★ Bookmarked ' + i.name); } show(i.id); };
    card.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { sfx('tap.mp3'); SE2.select(b.dataset.id); });
  }
  addEventListener('se2:selected', e => { sfx('open.mp3'); show(e.detail.id); });
  addEventListener('se2:discovered', e => say('✨ Discovered: ' + e.detail.name));

  // ---------- search ----------
  function hideResults() { results.style.display = 'none'; }
  function renderResults(list) {
    results.innerHTML = list.length ? list.map(x => `<button data-id="${esc(x.id)}">${esc(x.name)}<small>${esc(x.kind)}</small></button>`).join('') : '<button disabled>No match – try Earth, Proxima b, Betelgeuse, Andromeda…</button>';
    results.style.display = 'block';
    results.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { input.value = ''; input.blur(); go(b.dataset.id); });
  }
  input.addEventListener('input', () => input.value.trim() ? renderResults(SE2.search(input.value)) : hideResults());
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { const l = SE2.search(input.value); if (l[0]) { input.value = ''; input.blur(); go(l[0].id); } } });
  input.addEventListener('focus', () => { panel.style.display = 'none'; });

  // ---------- buttons ----------
  $('#x2-home').onclick = () => { sfx('back.mp3'); SE2.home(); };
  let zoomHold = 0;
  const holdZoom = (btn, d) => {
    const stop = () => { clearInterval(zoomHold); zoomHold = 0; };
    btn.addEventListener('pointerdown', e => { e.preventDefault(); SE2.zoom(d); stop(); zoomHold = setInterval(() => SE2.zoom(d), 50); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(k => btn.addEventListener(k, stop));
  };
  holdZoom($('#x2-in'), 0.18); holdZoom($('#x2-out'), -0.18);
  $('#x2-rand').onclick = () => { const id = SE2.randomPlanet({ from: 'here' }); if (id) { go(id); } else say('No planets found nearby'); };
  const BOOST = [1, 30, 1000, 100000];
  $('#x2-boost').onclick = e => { const i = (BOOST.indexOf(SE2.getBoost()) + 1) % BOOST.length; SE2.setBoost(BOOST[i]); e.target.textContent = '⚡' + (BOOST[i] >= 1000 ? BOOST[i] / 1000 + 'k' : BOOST[i]) + '×'; e.target.classList.toggle('on', i > 0); sfx(i > 0 ? 'boost.mp3' : 'tap.mp3'); };
  $('#x2-bmbtn').onclick = () => {
    if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
    const bms = SE2.getBookmarks(), disc = SE2.getDiscoveries().slice(-8).reverse();
    panel.innerHTML = `<h3>★ Bookmarks</h3>${bms.length ? bms.map(b => `<div class="row"><span>${esc(b.name)}</span><button data-go="${esc(b.id)}">Go</button><button data-rm="${esc(b.id)}">✕</button></div>`).join('') : '<div class="row"><span>Tap ☆ on an info card to bookmark it.</span></div>'}
      <h3 style="margin-top:12px">⚙️ View</h3><div class="row"><span>Orbit lines</span><button data-orb>${window.__x2orb?'On':'Off'}</button></div>
      <h3 style="margin-top:12px">✨ Your discoveries (${SE2.getDiscoveries().length})</h3>${disc.map(b => `<div class="row"><span>${esc(b.name)}</span><button data-go="${esc(b.id)}">Go</button></div>`).join('') || '<div class="row"><span>Visit procedural worlds to discover them.</span></div>'}`;
    panel.style.display = 'block';
    panel.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { panel.style.display = 'none'; go(b.dataset.go); });
    panel.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { SE2.removeBookmark(b.dataset.rm); panel.style.display = 'none'; $('#x2-bmbtn').click(); });
  };
  const realBtn = $('#x2-real'), qBtn = $('#x2-q'), QN = { low: 'Low', medium: 'Med', high: 'High' };
  const syncQ = () => { const t = SE2.getStats().tier; qBtn.textContent = QN[t] || t; };
  realBtn.onclick = () => { const on = SE2.setRealScale(!SE2.getRealScale()); realBtn.classList.toggle('on', on); say(on ? 'Real scale: true sizes and distances' : 'Compressed scale (easier to see)'); };
  qBtn.onclick = () => { const order = ['low', 'medium', 'high'], t = SE2.getStats().tier; SE2.setQuality(order[(order.indexOf(t) + 1) % 3]); syncQ(); say('Graphics: ' + qBtn.textContent); };
  const orbBtn = $('#x2-orb'); orbBtn.classList.toggle('on', SE2.getOrbits());
  orbBtn.onclick = () => { const on = SE2.setOrbits(!SE2.getOrbits()); orbBtn.classList.toggle('on', on); say(on ? 'Orbit lines on' : 'Orbit lines off'); };
  setTimeout(syncQ, 0); realBtn.classList.toggle('on', SE2.getRealScale());
  $('#x2-takeoff').onclick = () => { sfx('takeoff.mp3'); SE2.takeOff(); };
  $('#x2-credits').onclick = () => window.open(new URL('credits.html', base), '_blank', 'noopener');
  addEventListener('se2:landed', () => { r.classList.add('landed'); card.style.display = 'none'; document.body.classList.remove('x2-card-open'); });
  addEventListener('se2:tookoff', () => r.classList.remove('landed'));
  r.addEventListener('click', e => { if (e.target.closest('#x2-side .x2b:not(#x2-home):not(#x2-boost), #x2-bmbtn')) sfx('tap.mp3'); }, true);

  // ---------- HUD + labels ----------
  const SCALE = { universe: 'Universe', galaxy: 'Galaxy', stars: 'Star field', system: 'Star system', planet: 'Planet orbit', surface: 'Surface' };
  const speedTxt = v => v < 1e-12 ? '' : v * 63241 < 0.01 ? Math.round(v * 9.461e12).toLocaleString('en-US') + ' km/s' : v < 3.17e-8 * 10 ? (v * 63241).toPrecision(2) + ' AU/s' : (v / 3.169e-8 >= 1 ? '≈ ' + SE2.fmtDist(v) + '/s' : '');
  const pool = [];
  function tick() {
    const st = SE2.getState();
    if (st.mode === 'surface' || st.mode === 'landing') { const s = SE2.getSurface(); hud.innerHTML = s ? `<b>${esc(s.name)}</b> · surface · altitude ${Math.round(s.altitude)} m` : ''; }
    else {
      const where = st.system ? st.system.name : st.galaxy ? st.galaxy.name : 'Intergalactic space';
      const fi = st.focus && SE2.getInfo(st.focus);
      hud.innerHTML = `<b>${SCALE[st.scale] || ''}</b> · ${esc(where)}` +
        (st.mode === 'orbit' && fi ? `<br>${esc(fi.name)}: ${esc(st.distanceText)}` : st.mode === 'flight' ? `<br>Flying… ${speedTxt(st.speedLyps)}` : st.mode === 'free' ? `<br>Free flight ${speedTxt(st.speedLyps)}` : '');
    }
    const L = SE2.getLabels();
    while (pool.length < L.length) { const d = document.createElement('div'); d.className = 'lab'; d.onclick = () => { sfx('tap.mp3'); SE2.select(d.dataset.id); }; labelsEl.appendChild(d); pool.push(d); }
    pool.forEach((d, i) => {
      const l = L[i]; if (!l) { d.style.display = 'none'; return; }
      d.style.display = 'block'; d.style.left = l.x + 'px'; d.style.top = l.y + 'px';
      if (d.dataset.id !== l.id) { d.dataset.id = l.id; d.textContent = l.name; }
      d.className = 'lab' + (l.selected ? ' sel' : '') + (l.kind === 'galaxy' ? ' galaxy' : '');
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- touch: drag = look, pinch = zoom, tap = select, double-tap = go to ----------
  const c = document.getElementById('se-canvas'), pts = new Map(); let pinch = 0, lastTap = { t: 0, id: null };
  c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), multi: pts.size > 0 }); hideResults(); input.blur(); panel.style.display = 'none'; });
  c.addEventListener('pointermove', e => {
    const o = pts.get(e.pointerId); if (!o) return;
    if (pts.size === 1) SE2.look(e.clientX - o.x, e.clientY - o.y);
    o.x = e.clientX; o.y = e.clientY;
    if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) SE2.zoom((d - pinch) / 90); pinch = d; }
  });
  const up = e => {
    const o = pts.get(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) pinch = 0;
    if (!o || o.multi || pts.size || performance.now() - o.t > 350 || Math.hypot(e.clientX - o.x0, e.clientY - o.y0) > 10) return;
    const id = SE2.pick(e.clientX, e.clientY);
    if (!id) return;
    const now = performance.now();
    if (lastTap.id === id && now - lastTap.t < 400) go(id); else { sfx('tap.mp3'); SE2.select(id); }
    lastTap = { t: now, id };
  };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', e => { pts.delete(e.pointerId); pinch = 0; });
  c.addEventListener('wheel', e => { e.preventDefault(); SE2.zoom(-e.deltaY / 400); }, { passive: false });

  // ---------- title ----------
  if (!opts.autostart) {
    const t = document.createElement('div'); t.id = 'x2-title';
    t.innerHTML = '<h1>SPACE EXPLORER X 2</h1><p>A whole procedural universe – from Earth to the galaxy clusters. Preview build.</p><button>Start exploring</button><p style="margin-top:16px;font-size:13px;opacity:.8">Made by Nova Labs ⭐</p>';
    document.body.appendChild(t);
    t.querySelector('button').onclick = () => { t.remove(); sfx('start.mp3'); const m = new Audio(new URL('audio/' + (matchMedia('(pointer:fine) and (min-width:900px)').matches ? 'ambient_long.mp3' : 'ambient.mp3'), base)); m.loop = true; m.volume = 0.3; m.play().catch(() => {}); window.SE_MUSIC = m; };
  }
  window.SE2_UI = { show, say };
  return window.SE2_UI;
}
// Clean sky by default: orbit lines start hidden every session (clears any old saved "on"), toggle in the ★ panel.
(function x2clean(){if(!window.SE2||!SE2.setOrbits)return setTimeout(x2clean,200);const on=new URLSearchParams(location.search).has('orbits');window.__x2orb=on;SE2.setOrbits(on);
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-orb]');if(!b)return;window.__x2orb=!window.__x2orb;SE2.setOrbits(window.__x2orb);b.textContent=window.__x2orb?'On':'Off';},true);})();
// Seamless descent UI: altitude readout + no Land button. Uses SE2.getAltitude() -> {name, meters} when the engine provides it;
// falls back to the surface altitude. Set window.X2_SEAMLESS=false to bring the Land button back.
(function x2alt(){if(!window.SE2)return setTimeout(x2alt,200);const r=document.getElementById('x2-hud');if(!r)return setTimeout(x2alt,200);
if(window.X2_SEAMLESS!==false)document.documentElement.classList.add('x2-seamless');
const A=document.createElement('div');A.id='x2-alt';r.parentNode.appendChild(A);
const fmt=m=>m<1000?Math.round(m)+' m':m<1e6?(m/1000).toFixed(m<1e4?1:0)+' km':Math.round(m/1000).toLocaleString()+' km';
setInterval(()=>{let a=null;try{a=SE2.getAltitude?SE2.getAltitude():(()=>{const s=SE2.getSurface&&SE2.getSurface();return s?{name:s.name,meters:s.altitude}:null})()}catch(e){}
if(a&&isFinite(a.meters)&&a.meters<5e7){A.style.display='block';A.innerHTML=`<span>⬇</span> ${fmt(Math.max(0,a.meters))}<small>${a.name?' above '+a.name.replace(/[<>&]/g,''):''}</small>`;A.classList.toggle('low',a.meters<2000);}else A.style.display='none';},150);})();

// Wind near the ground: fades in below 20 km, louder closer to the surface. Starts after the first tap (phone audio rule).
(()=>{const W=new Audio(new URL('../audio/wind.mp3',import.meta.url));W.loop=true;W.volume=0;let on=false,v=0;
addEventListener('pointerdown',()=>{if(!on){on=true;W.play().catch(()=>{on=false;});}},{capture:true});
setInterval(()=>{let m=null;try{const S=window.SE2;const a=S&&(S.getAltitude?S.getAltitude():(S.getSurface&&(s=>s&&{meters:s.altitude})(S.getSurface())));m=a&&isFinite(a.meters)?a.meters:null;if(a&&(a.kind==='star'||a.atmosphere===false||/^(moon|mercury|phobos|deimos|ceres|pluto|charon|callisto|ganymede|europa|io)$/i.test(a.name||'')))m=null;}catch(e){}
const target=m==null||m>20000?0:0.5*Math.pow(1-Math.max(m,0)/20000,1.5);v+=(target-v)*0.15;W.volume=Math.min(1,Math.max(0,v));},100);})();
// "Fly down" hint near a planet. Button calls SE2.flyDown(id) if the engine has it; otherwise it's a text hint only.
(function x2fd(){if(!window.SE2||!document.getElementById('x2-hud'))return setTimeout(x2fd,200);
const H=document.createElement('div');H.id='x2-flyhint';document.getElementById('x2-hud').parentNode.appendChild(H);let last='';
setInterval(()=>{let a=null;try{a=SE2.getAltitude&&SE2.getAltitude()}catch(e){}
const star=a&&(a.kind==='star'||a.star===true);const show=a&&!star&&!a.surface&&a.meters>0&&a.meters<2e7&&a.name;if(!show){H.style.display='none';last='';return;}
const nm=a.name.replace(/[<>&]/g,''),can=!!SE2.flyDown,k=nm+can;H.style.display='block';
if(k!==last){last=k;H.innerHTML=can?`<button>⬇ ${a.gas||a.kind==='gas'?'Dive into the clouds of':'Fly down to'} ${nm}</button>`:`⬇ Keep flying toward ${nm} to reach the surface`;
const b=H.querySelector('button');if(b)b.onclick=()=>{try{window.SE_SFX&&SE_SFX('fly.mp3')}catch(e){}SE2.flyDown(a.id||nm)};}},250);})();
// Optional support button: hidden until SUPPORT_URL is set to the Ko-fi link. The game stays free either way.
(function sup(){const SUPPORT_URL='';if(!SUPPORT_URL)return;const t=document.querySelector('#x2-title,#se-title');if(!t)return setTimeout(sup,200);
const a=document.createElement('a');a.href=SUPPORT_URL;a.target='_blank';a.rel='noopener';a.textContent='☕ Support Nova Labs ($5, optional)';
a.style.cssText='margin-top:14px;padding:9px 18px;border-radius:20px;background:#ff5e5b;color:#fff;text-decoration:none;font-size:14px';t.appendChild(a);})();

// Optional built-in mobile thumbstick (bottom-left) + up/down buttons (right) that drive SE.fly().
export function createJoystick(SE, opts = {}) {
  const bottom = opts.bottom ?? 40;
  const root = document.createElement('div');
  root.id = 'se-joy';
  root.innerHTML = `
    <style>
      #se-joy{position:fixed;inset:0;pointer-events:none;z-index:5;user-select:none;-webkit-user-select:none}
      #se-joy .pad{position:absolute;left:18px;bottom:${bottom}px;width:116px;height:116px;border-radius:50%;
        background:radial-gradient(circle,rgba(120,180,255,.10),rgba(120,180,255,.22));border:2px solid rgba(150,200,255,.45);pointer-events:auto;touch-action:none}
      #se-joy .knob{position:absolute;left:50%;top:50%;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;
        background:radial-gradient(circle at 40% 35%,#cfe6ff,#4d8ee0 70%);box-shadow:0 0 12px rgba(80,160,255,.6);transition:transform .12s}
      #se-joy .knob.drag{transition:none}
      #se-joy .ud{position:absolute;right:18px;width:58px;height:58px;border-radius:50%;pointer-events:auto;touch-action:none;
        background:rgba(10,30,70,.55);border:2px solid rgba(150,200,255,.5);color:#dff;font:bold 22px system-ui;display:flex;align-items:center;justify-content:center}
      #se-joy .ud.on{background:rgba(70,140,255,.6)}
      #se-joy .up{bottom:${bottom + 66}px}#se-joy .down{bottom:${bottom}px}
    </style>
    <div class="pad" aria-label="fly joystick"><div class="knob"></div></div>
    <div class="ud up" aria-label="fly up">▲</div><div class="ud down" aria-label="fly down">▼</div>`;
  document.body.appendChild(root);
  const pad = root.querySelector('.pad'), knob = root.querySelector('.knob');
  let jx = 0, jz = 0, vy = 0, pid = null;
  const send = () => SE.fly(jx, vy, jz);
  const R = 46;
  function move(e) {
    const r = pad.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    const dead = v => Math.abs(v) < 0.12 ? 0 : v;
    jx = dead(dx / R); jz = dead(-dy / R); send();
  }
  pad.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; pad.setPointerCapture(pid); knob.classList.add('drag'); move(e); });
  pad.addEventListener('pointermove', e => { if (e.pointerId === pid) { e.stopPropagation(); move(e); } });
  const end = e => { if (e.pointerId !== pid) return; pid = null; jx = jz = 0; knob.classList.remove('drag'); knob.style.transform = ''; send(); };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  for (const [sel, v] of [['.up', 1], ['.down', -1]]) {
    const b = root.querySelector(sel);
    b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); b.setPointerCapture(e.pointerId); b.classList.add('on'); vy = v; send(); });
    const off = () => { b.classList.remove('on'); if (vy === v) { vy = 0; send(); } };
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
  }
  return { el: root, destroy() { root.remove(); } };
}

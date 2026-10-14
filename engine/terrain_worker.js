// Module worker: builds terrain tiles off the main thread (see terrain_height.js).
import { buildTile } from './terrain_height.js?v=20261014a';
const bodies = new Map();
self.onmessage = e => {
  const m = e.data;
  if (m.type === 'body') { bodies.set(m.key, m.P); return; }
  if (m.type === 'drop') { bodies.delete(m.key); return; }
  if (m.type === 'tile') {
    const P = bodies.get(m.key); if (!P) { self.postMessage({ id: m.id, key: m.key, failed: true }); return; }
    const r = buildTile(m.T, P);
    self.postMessage({ id: m.id, key: m.key, ...r }, [r.pos.buffer, r.nor.buffer, r.obj.buffer, r.det.buffer, r.sea.buffer]);
  }
};

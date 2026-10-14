// Module worker: galaxy cloud particles (~70k) off the main thread (see universe.js galaxyParticles, views.js createGalaxyCloud).
import { galaxyParticles } from './universe.js?v=20261014b';
self.onmessage = e => {
  const { id, g, N } = e.data;
  try { const d = galaxyParticles(g, N); self.postMessage({ id, d }, [d.pos.buffer, d.col.buffer, d.size.buffer, d.dpos.buffer, d.dsize.buffer].filter((b, i, a) => b && a.indexOf(b) === i)); }
  catch (err) { self.postMessage({ id, err: String(err) }); }
};

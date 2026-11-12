importScripts('engine.js');
self.onmessage = e => {
  const { id, ctx } = e.data;
  const t0 = Date.now();
  let res;
  try { res = Engine.evaluateDiscards2(ctx); } catch (err) { res = Engine.evaluateDiscards(ctx); }
  const out = res.map(x => Object.assign({}, x, { tiles: x.tiles }));
  self.postMessage({ id, ev: out, ms: Date.now() - t0 });
};

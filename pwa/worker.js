/* Hair Loss Counter — analysis worker. Runs the engine off the main thread; makes no network requests. */
importScripts('engine.js');
self.onmessage = async function (e) {
  var d = e.data;
  try {
    var r = await HLC.analyzeFree(d.imgs, d.opt, function (p, l) { self.postMessage({ id: d.id, type: 'progress', p: p, label: l }); });
    var tr = [];
    if (r.ok) { tr.push(r.work.rgba.buffer); r.hairs.forEach(function (h) { tr.push(h.pts.buffer); }); }
    self.postMessage({ id: d.id, type: 'done', result: r }, tr);
  } catch (err) { self.postMessage({ id: d.id, type: 'error', message: String(err && err.message || err) }); }
};

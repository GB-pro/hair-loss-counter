// run analyzeFree on synthetic sink sets: node test/free.js [nPhotos] [set,...]
const fs = require('fs'), path = require('path'), jpeg = require('jpeg-js');
const HLC = require('../src/engine.js');
const { resize } = require('./run.js');
const dir = path.join(__dirname, 'free'), truth = JSON.parse(fs.readFileSync(dir + '/truth.json'));
function load(fn) { const r = jpeg.decode(fs.readFileSync(fn), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 }); return resize({ width: r.width, height: r.height, data: r.data }, 2600 / Math.max(r.width, r.height)); }
function hsv(h) { const f = n => { const k = (n + h / 60) % 6; return 255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))); }; return [f(5), f(3), f(1)]; }
(async () => {
  const nP = +(process.argv[2] || 3), sets = process.argv[3] ? process.argv[3].split(',') : Object.keys(truth), extra = process.argv[4] ? JSON.parse(process.argv[4]) : {};
  for (const s of sets) {
    const t = truth[s], imgs = []; for (let k = 0; k < nP; k++) imgs.push(load(`${dir}/${s}_${k}.jpg`));
    const t0 = Date.now(), r = await HLC.analyzeFree(imgs, Object.assign({ ref: { kind: 'coin', mm: t.coinMm, tap: t.coinTap } }, extra));
    const truePx = 1260 / 240; // synthetic framing: 240 mm across
    console.log(`${s.padEnd(11)} n=${t.n} paths=${r.count} white=${r.hairs.filter(h => h.white).length}/${t.white} cut=${r.cutCount} L=${r.totalLengthMm.toFixed(0)}/${t.visibleMm.toFixed(0)} pxmm=${r.pxPerMm.toFixed(2)}(true~${truePx.toFixed(2)}) ref=${r.refFit && r.refFit.ok} surf=${r.surface.kind} glare=${r.fusion.glarePx} filled=${r.fusion.filledPx} remain=${r.fusion.remainPx} ncc=${r.fusion.ncc.map(v => v.toFixed(2))} obj=${r.fusion.objPx} sharp=${r.sharpness.toFixed(2)} warn=[${r.warnings}] rej=[${r.reject}] ${Date.now() - t0}ms`);
    if (process.env.OV) {
      const W = r.work.width, H = r.work.height, buf = Buffer.alloc(W * H * 4);
      for (let i = 0; i < W * H * 4; i++) buf[i] = i % 4 === 3 ? 255 : Math.round(r.work.rgba[i] * 0.6 + 255 * 0.4);
      const put = (x, y, c) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const p = (yy * W + xx) * 4; buf[p] = c[0]; buf[p + 1] = c[1]; buf[p + 2] = c[2]; } };
      r.hairs.forEach((h, k) => { const c = hsv((k * 47) % 360); for (let i = 0; i < h.pts.length; i += 2) put(h.pts[i], h.pts[i + 1], c); });
      if (r.refFit && r.refFit.ok) for (let a = 0; a < 360; a++) put(Math.round(r.refFit.cx + r.refFit.r * Math.cos(a / 57.3)), Math.round(r.refFit.cy + r.refFit.r * Math.sin(a / 57.3)), [255, 0, 255]);
      fs.writeFileSync(`${__dirname}/ovfree_${s}_${nP}.jpg`, jpeg.encode({ data: buf, width: W, height: H }, 85).data);
    }
  }
})();

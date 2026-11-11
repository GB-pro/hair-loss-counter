// Node harness: run the engine on JPEG files and report count vs truth
const fs = require('fs'), path = require('path');
const jpeg = require('jpeg-js');
const HLC = require('../src/engine.js');
const truth = fs.existsSync(__dirname + '/truth_synth2.json') ? JSON.parse(fs.readFileSync(__dirname + '/truth_synth2.json')) : {};
async function runOne(fn, opt) {
  const raw = jpeg.decode(fs.readFileSync(fn), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
  // the app downsizes photos so the long side is <= 2600 px before analysis; mimic that here
  let img = { width: raw.width, height: raw.height, data: raw.data };
  const maxSide = (opt && opt.maxSide) || 2600;
  if (Math.max(img.width, img.height) > maxSide) img = resize(img, maxSide / Math.max(img.width, img.height));
  const t = Date.now();
  const r = await HLC.analyze(img, opt || {});
  const dt = Date.now() - t;
  return { r, dt, img };
}
function resize(img, s) { // area-average downscale
  const W = Math.round(img.width * s), H = Math.round(img.height * s), out = new Uint8ClampedArray(W * H * 4);
  const fx = img.width / W, fy = img.height / H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.floor(x * fx), x1 = Math.min(img.width, Math.ceil((x + 1) * fx)), y0 = Math.floor(y * fy), y1 = Math.min(img.height, Math.ceil((y + 1) * fy));
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const p = (yy * img.width + xx) * 4; r += img.data[p]; g += img.data[p + 1]; b += img.data[p + 2]; n++; }
    const o = (y * W + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
  }
  return { width: W, height: H, data: out };
}
module.exports = { runOne, resize };
if (require.main === module) {
  (async () => {
    const files = process.argv.slice(2);
    for (const fn of files) {
      const { r, dt } = await runOne(fn);
      const key = path.basename(fn, '.jpg'), tr = truth[key];
      if (!r.ok) { console.log(key, 'FAILED', r.error); continue; }
      console.log(`${key}: count=${r.count}${tr ? ' truth=' + tr.n : ''} flags=${r.flags.length} white=${r.hairs.filter(h => h.white).length}` +
        ` pxmm=${r.pxPerMm.toFixed(2)} marker=${r.scaleFromMarker} warn=[${r.warnings}] time=${dt}ms ` + JSON.stringify(r.timings));
    }
  })();
}

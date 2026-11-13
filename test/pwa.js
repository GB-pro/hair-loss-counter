// end-to-end check of the PWA: served over http://localhost, then offline
// The checks read data-state / data-stage hooks, not visible text, so they hold in every language.
const puppeteer = require('puppeteer-core'), path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.resolve(__dirname, '../pwa'), URL0 = 'http://localhost:8765/';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f)); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const logs = []; let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; logs.push((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); };
const R = f => path.resolve(__dirname, '..', f);
const PHONE = { width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

(async () => {
  await new Promise(r => srv.listen(8765, r));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const watch = (page, tag) => { page.on('pageerror', e => { failed++; logs.push('PAGEERROR ' + tag + ': ' + e.message); }); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push('console.' + m.type() + ' ' + tag + ': ' + m.text()); }); };
  // a clean start in the same page: browser languages (and optionally the user agent) of our choice, storage emptied
  const ua0 = await browser.userAgent();
  const mk = async (tag) => { const page = await browser.newPage(); await page.setViewport(PHONE); watch(page, tag); page.hlcCdp = await page.createCDPSession(); return page; };
  const fresh = async (page, langs, opt) => {
    opt = opt || {};
    await page.hlcCdp.send('Emulation.setUserAgentOverride', { userAgent: opt.ua || ua0, acceptLanguage: langs.join(',') });
    await page.goto(URL0, { waitUntil: 'load' });
    await page.evaluate((store) => { localStorage.clear(); for (const k in store) localStorage.setItem(k, store[k]); }, opt.store || {});
    await page.goto(URL0, { waitUntil: 'networkidle0' });
  };
  const state = (page, id) => page.$eval('#' + id, e => e.dataset.state || e.dataset.stage || '');

  // ------------------------------------------------------------ 1. languages: the closest one, and the coins that go with it
  const cases = [
    [['ja-JP', 'ja'], 'ja', 'JPY'], [['en-US'], 'en', 'USD'], [['en-GB'], 'en', 'GBP'], [['en-AU'], 'en', 'AUD'], [['en-CA'], 'en', 'CAD'],
    [['zh-TW', 'zh'], 'zh-Hans', 'CNY'], [['ko-KR'], 'ko', 'KRW'], [['de-DE'], 'de', 'EUR'], [['de-CH'], 'de', 'CHF'], [['fr-FR'], 'fr', 'EUR'], [['fr-CA'], 'fr', 'CAD'],
    [['es-MX'], 'es', 'EUR'], [['it'], 'it', 'EUR'], [['pt-BR'], 'pt', 'EUR'], [['ca-ES', 'en'], 'en', 'USD'], [['ca-ES'], 'es', 'EUR'], [['nl-NL'], 'en', 'EUR'], [['th-TH'], 'en', 'USD']
  ];
  const lp = await mk('lang');
  for (const [langs, wantLang, wantCur] of cases) {
    const page = lp; await fresh(page, langs);
    const got = await page.evaluate(() => ({ lang: document.documentElement.lang, cur: document.getElementById('selCountry').value, h1: document.querySelector('h1').textContent.replace(/\s+/g, ' ').trim(), tag: document.querySelector('header .tag').textContent, pressed: Array.from(document.querySelectorAll('#langs button[aria-pressed="true"]')).map(b => b.dataset.lang).join() }));
    check('language ' + langs.join(',') + ' -> ' + wantLang + ' / ' + wantCur, got.lang === wantLang && got.cur === wantCur && got.h1 === "MOT'S HAIR COUNTER", got.lang + ' / ' + got.cur + ' / ' + got.tag);
  }
  {  // switching by hand: remembered, title untouched, coins follow until a currency is chosen by hand
    const page = lp; await fresh(page, ['ja-JP']);
    const texts = {};
    for (const l of ['en', 'zh', 'ko', 'de', 'fr', 'es', 'it', 'pt', 'ja']) { await page.click('#langs button[data-lang="' + l + '"]'); texts[l] = await page.evaluate(() => [document.querySelector('header .tag').textContent, document.getElementById('selCountry').value, document.querySelector('h1').textContent.replace(/\s+/g, ' ').trim(), document.getElementById('btnAnalyze').textContent].join(' | ')); }
    check('nine language buttons', await page.$$eval('#langs button', b => b.length) === 9 && new Set(Object.values(texts).map(s => s.split(' | ')[0])).size === 9, texts);
    check('language box is below the records', await page.evaluate(() => !!(document.getElementById('h-hist').compareDocumentPosition(document.getElementById('langs')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    await page.click('#langs button[data-lang="fr"]'); await page.select('#selCountry', 'GBP'); await page.click('#langs button[data-lang="ko"]');
    check('hand-picked currency stays when the language changes', await page.$eval('#selCountry', e => e.value) === 'GBP');
    await page.reload({ waitUntil: 'load' });
    check('language choice is remembered', await page.evaluate(() => document.documentElement.lang + '/' + document.getElementById('selCountry').value) === 'ko/GBP');
    const untranslated = await page.evaluate(() => Array.from(document.querySelectorAll('[data-i18n]')).filter(e => !e.textContent.trim()).map(e => e.getAttribute('data-i18n')));
    check('no empty labels', untranslated.length === 0, untranslated);
  }

  {  // which camera opens first depends on the device
    await fresh(lp, ['ja-JP'], { ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
    check('a phone defaults to its own camera', await lp.$eval('#selCam', e => e.value) === 'system', await lp.$eval('#camSub', e => e.textContent));
  }


  // ------------------------------------------------------------ 2. page structure
  const page = await mk('main'); const reqs = []; page.on('request', r => reqs.push(r.url()));
  await fresh(page, ['ja-JP', 'ja']);
  const dl = path.join(__dirname, 'dl'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl);
  const cdp = await page.createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await page.waitForFunction(() => document.getElementById('pOffline').dataset.state === 'yes', { timeout: 20000 });
  const shape = await page.evaluate(() => {
    const pos = (a, b) => !!(document.getElementById(a).compareDocumentPosition(document.getElementById(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
    const tiles = Array.from(document.querySelectorAll('.shoot .tile')).map(e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return [Math.round(r.width), Math.round(r.height), c.backgroundColor, c.color, c.fontWeight].join('/'); });
    return { refFirst: pos('h-ref', 'h-capture'), analyzeInCapture: document.getElementById('btnAnalyze').closest('section') === document.getElementById('h-capture').closest('section'), noChip: !document.getElementById('netChip') && !document.getElementById('netText'), noProofBox: !document.getElementById('proofBox'), proofInAbout: !!document.querySelector('#aboutBox #pExt') && !!document.querySelector('#aboutBox #pOffline'), pictograms: document.querySelectorAll('#slots .slot svg.pg').length, tiles, steps: Array.from(document.querySelectorAll('.card h2 .step')).map(e => e.textContent).join(), overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  check('reference first, then photos; analyse button under the photos', shape.refFirst && shape.analyzeInCapture, shape.steps);
  check('"no network" chip and the separate proof section are gone; proof is inside About', shape.noChip && shape.noProofBox && shape.proofInAbout);
  check('three pictograms', shape.pictograms === 3);
  check('camera and gallery tiles look the same', shape.tiles.length === 2 && shape.tiles[0] === shape.tiles[1], shape.tiles);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), inline = (html.match(/\sstyle\s*=|<style[\s>]|<script(?![^>]*\ssrc=)[^>]*>|\son[a-z]+\s*=|https?:\/\//gi) || []);
  check('no inline script, inline style or outside address in the markup', inline.length === 0, inline);
  check('no sideways scroll', shape.overflow <= 0, shape.overflow);
  const ext = reqs.concat(await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name))).filter(u => !u.startsWith(URL0) && !u.startsWith('blob:') && !u.startsWith('data:'));
  check('no request leaves the site', ext.length === 0, ext);
  await page.setOfflineMode(true); await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('pOffline').dataset.state !== 'checking', { timeout: 10000 }).catch(() => {});
  check('works offline', await page.title() === "MOT'S HAIR COUNTER" && await state(page, 'pOffline') === 'yes', await page.title() + ' / ' + await state(page, 'pOffline'));
  const bgs = await page.evaluate(() => Promise.all(['bg/marble.webp', 'bg/relief-top.webp', 'bg/relief-low.webp'].map(u => new Promise(r => { const im = new Image(); im.onload = () => r(im.naturalWidth); im.onerror = () => r(0); im.src = u; }))));
  check('background images come from the offline copy', bgs.every(w => w > 0), bgs);
  await page.setOfflineMode(false);

  // ------------------------------------------------------------ 3. analysis
  const clear = async () => { while (await page.$('#thumbs .thumb button')) await page.evaluate(() => { const b = document.querySelector('#thumbs .thumb button'); if (b) b.click(); }); };
  const run = async (name, files, tap, verifiedN, want) => {
    await clear();
    await page.select('#selKind', tap ? 'coin' : 'none');
    await (await page.$('#inPick')).uploadFile(...files);   // all at once, in any order
    if (tap) {
      await page.select('#selCountry', 'JPY'); await page.evaluate(() => document.querySelectorAll('#coins .coin')[5].click());
      await page.waitForFunction(() => document.getElementById('refStatus').dataset.state === 'found', { timeout: 60000 });
      const order = (await page.$$eval('#thumbs .thumb img', e => e.map(x => x.dataset.name))).join(',');
      check(name + ': coin found, straight-down photo first', /_0\.jpg/.test(order.split(',')[0]), await page.$eval('#refStatus', e => e.textContent) + ' | ' + order);
    } else await page.waitForFunction(() => !document.getElementById('btnAnalyze').disabled, { timeout: 30000 });
    const t0 = Date.now(); await page.click('#btnAnalyze'); await page.waitForFunction(() => document.getElementById('pText').dataset.stage === 'done', { timeout: 300000 }); await sleep(1500);
    const res = await page.evaluate(() => ({ num: document.getElementById('rNum').textContent, per: document.getElementById('rPer').textContent, alerts: Array.from(document.querySelectorAll('#rAlerts .alert')).map(e => e.textContent.slice(0, 28)), chips: Array.from(document.querySelectorAll('#rChips .chip')).map(e => e.textContent), bars: document.querySelectorAll('#histo rect.bar').length }));
    const n = parseInt(res.num.replace(/[^\d]/g, ''), 10);
    // before a hand count has been saved the value is provisional and may be far off; with the correction it must be close
    check(name + ': ' + n + (want ? ' (laid out: ' + want + ')' : ''), want ? Math.abs(n - want) <= Math.max(3, want * 0.2) : n > 0, (Date.now() - t0) + 'ms ' + JSON.stringify(res));
    if (verifiedN) await page.evaluate((v) => { document.getElementById('inConfirm').value = v; document.getElementById('inVerified').checked = true; }, verifiedN);
    await page.click('#btnSave'); await sleep(400); logs.push('     save: ' + await page.$eval('#saveStatus', e => e.textContent));
  };
  await run('no reference', [0, 1].map(k => R(`test/free/w_spread20_${k}.jpg`)), false, 0, 0);   // provisional value
  await run('green mat', [2, 0, 1].map(k => R(`test/free/g_loose30_${k}.jpg`)), true, 30, 0);   // straight-down photo given second: must become photo 1
  await run('blue mat', [1, 2, 0].map(k => R(`test/free/b_loose25_${k}.jpg`)), true, 0, 25);
  await page.evaluate(() => window.scrollTo(0, document.getElementById('h-capture').getBoundingClientRect().top + window.pageYOffset - 10)); await sleep(300);
  await page.screenshot({ path: path.join(__dirname, 'pwa_capture.png') });
  await page.evaluate(() => window.scrollTo(0, document.getElementById('resultCard').getBoundingClientRect().top + window.pageYOffset - 10)); await sleep(300);
  await page.screenshot({ path: path.join(__dirname, 'pwa_result.png') });
  await page.click('#btnZip'); await page.click('#btnImg'); await sleep(600);

  // ------------------------------------------------------------ 4. cameras
  // in-app camera (fake device): three shots, then the camera is released
  await clear();
  check('desktop browser defaults to the in-app camera', await page.$eval('#selCam', e => e.value) === 'inapp');
  await page.click('#btnCamera'); await page.waitForFunction(() => !document.getElementById('cam').hidden && document.getElementById('camVideo').videoWidth > 0, { timeout: 20000 });
  logs.push('     camera: ' + await page.$eval('#camInfo', e => e.textContent));
  await page.screenshot({ path: path.join(__dirname, 'pwa_camera.png') });
  for (let k = 0; k < 3; k++) { await page.waitForFunction(() => !document.getElementById('camShot').disabled); await page.click('#camShot'); await page.waitForFunction((n) => document.querySelectorAll('#thumbs .thumb').length > n, { timeout: 15000 }, k); }
  await sleep(300);
  const camEnd = await page.evaluate(() => { const v = document.getElementById('camVideo'); return { hidden: document.getElementById('cam').hidden, photos: document.querySelectorAll('#thumbs .thumb').length, live: v.srcObject ? v.srcObject.getTracks().filter(t => t.readyState === 'live').length : 0, keep: !document.getElementById('keepBox').hidden && !document.getElementById('btnKeep').disabled }; });
  check('in-app camera: 3 shots, closed and released, save-to-phone offered', camEnd.hidden && camEnd.photos === 3 && camEnd.live === 0 && camEnd.keep, camEnd);
  await page.click('#btnKeep'); await page.waitForFunction(() => document.getElementById('keepStatus').textContent !== '', { timeout: 10000 }); await sleep(500);
  const kept = fs.readdirSync(dl).filter(f => /_photo_/.test(f));
  check('taken photos are saved to the device on request', kept.length === 3 && await page.$eval('#btnKeep', e => e.disabled), kept);
  // the phone's own camera: the page hands over to the system camera through a file chooser
  await clear(); await page.select('#selCam', 'system');
  const [fc] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), page.click('#btnCamera')]);
  await fc.accept([R('test/free/g_loose30_0.jpg')]); await page.waitForFunction(() => document.querySelectorAll('#thumbs .thumb').length === 1, { timeout: 10000 });
  check('system camera: the photo comes back and can be saved', await page.evaluate(() => document.getElementById('cam').hidden && !document.getElementById('keepBox').hidden && document.getElementById('inCamera').getAttribute('capture') === 'environment'));
  await page.select('#selCam', 'inapp'); await clear();
  // ------------------------------------------------------------ 5. records, export, share
  await page.click('#btnExport'); await page.click('#btnShare'); await sleep(500); await page.click('#btnShareSave'); await sleep(1500);
  const rows = () => page.$$eval('#hist .hist-list > li', e => e.length);
  check('three records listed, trend drawn', await rows() === 3 && await page.$eval('#trend', e => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 60), await page.$eval('#histStatus', e => e.textContent) + ' | ' + await page.$eval('#vCalib', e => e.textContent));
  const files = fs.readdirSync(dl).map(f => f.replace(/_\d{8}_\d{4}/, '') + ':' + fs.statSync(path.join(dl, f)).size);
  check('downloads: zip, picture, records, share card', ['.zip', '.jpg', 'records', '.png'].every(k => files.some(f => f.indexOf(k) >= 0)), files);
  await page.evaluate(() => { document.getElementById('aboutBox').open = true; });
  const proof = await page.evaluate(() => ({ ext: document.getElementById('pExt').textContent, blocked: document.getElementById('pBlocked').textContent, own: document.getElementById('pOwn').textContent, persist: document.getElementById('pPersist').textContent, ls: Object.keys(localStorage).sort().join(), bytes: JSON.stringify(localStorage).length }));
  check('proof of no outside traffic', /^0/.test(proof.ext) && /^0/.test(proof.blocked), proof);
  // import round trip into a clean state
  const exp = fs.readdirSync(dl).find(f => f.indexOf('records') >= 0);
  await page.evaluate(() => { localStorage.clear(); }); await page.reload({ waitUntil: 'load' }); await (await page.$('#inImport')).uploadFile(path.join(dl, exp)); await sleep(600);
  check('import brings the records and the correction back', await rows() === 3, await page.$eval('#histStatus', e => e.textContent) + ' | ' + await page.$eval('#vCalib', e => e.textContent));
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
  await page.screenshot({ path: path.join(__dirname, 'pwa_after.png'), fullPage: true });

  // ------------------------------------------------------------ 6. many records stay compact
  {
    const recs = [], now = Date.now(); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let d = 0; d < 800; d++) { if (rnd() < 0.3) continue; const ts = now - d * 864e5 - Math.floor(rnd() * 3600e3); const n = Math.round(70 - d * 0.03 + 18 * Math.sin(d / 40) + rnd() * 16); recs.push({ v: 3, ts, estimate: n + 1.4, provisional: false, confirmed: n, verified: d % 9 === 0, memo: d % 11 === 0 ? 'シャンプー後' : '', paths: n - 3, totalLengthMm: n * 140, cutCount: 2, reference: '日本円 500円', photos: 3, photosUsed: 3, files: [] }); }
    const p3 = lp; await p3.bringToFront(); await fresh(p3, ['ja-JP'], { store: { 'hlc.records.v3': JSON.stringify(recs) } });
    const view = async () => p3.evaluate(() => ({ years: document.querySelectorAll('#hist .hyrow').length, months: document.querySelectorAll('#hist .hmrow').length, open: document.querySelectorAll('#hist .hist-list > li').length, lines: document.querySelectorAll('#hist button').length, range: Array.from(document.querySelectorAll('#trendRange button')).map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' '), pts: document.querySelectorAll('#trend circle').length, note: document.getElementById('trendNote').textContent, total: document.getElementById('sTotal').textContent, height: Math.round(document.getElementById('hist').getBoundingClientRect().height) }));
    const v0 = await view();
    check(recs.length + ' records: grouped by year and month, only the newest month open', v0.years >= 2 && v0.months >= 1 && v0.open > 0 && v0.open <= 31 && v0.lines < 70 && +v0.total === recs.length, v0);
    const notes = {};
    for (const r of ['recent', '3m', '1y', 'all']) { await p3.click('#trendRange button[data-range="' + r + '"]'); const v = await view(); notes[r] = v.pts + ' pts: ' + v.note; if (v.pts > 36 || v.pts < 2) failed++; }
    check('trend never draws more than 36 points', true, notes);
    await p3.click('#hist .hy:nth-of-type(2) .hyrow'); const v1 = await view();
    check('an older year opens to its months', v1.months > v0.months, v1.months + ' month rows');
    await p3.evaluate(() => document.querySelector('#hist .hy:nth-of-type(2) .hmrow').click()); const v2 = await view();
    check('an older month opens to its records', v2.open > v0.open, v2.open + ' record rows');
    await p3.evaluate(() => window.scrollTo(0, document.getElementById('h-hist').getBoundingClientRect().top + window.pageYOffset - 10)); await sleep(300);
    await p3.screenshot({ path: path.join(__dirname, 'pwa_records.png') });
  }

  console.log(logs.join('\n')); console.log(failed ? '\n' + failed + ' problem(s)' : '\nall checks passed');
  await browser.close(); srv.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.log(logs.join('\n')); console.error(e); process.exit(1); });

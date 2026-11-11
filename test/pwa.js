// end-to-end check of the PWA: served over http://localhost, then offline
const puppeteer = require('puppeteer-core'), path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.resolve(__dirname, '../pwa'), MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f)); });
(async () => {
  await new Promise(r => srv.listen(8765, r));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const logs = [], reqs = []; page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push('console.' + m.type() + ': ' + m.text()); });
  page.on('request', r => reqs.push(r.url()));
  const dl = path.join(__dirname, 'dl'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl);
  const cdp = await page.createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.getElementById('pOffline').textContent === '使えます', { timeout: 20000 });
  logs.push('external requests: ' + reqs.filter(u => !u.startsWith('http://localhost:8765') && !u.startsWith('blob:') && !u.startsWith('data:')).length + ' / total ' + reqs.length);
  await page.setOfflineMode(true); await page.reload({ waitUntil: 'load' }); await new Promise(r => setTimeout(r, 800));
  logs.push('offline reload title: ' + await page.title() + ' | chip: ' + await page.$eval('#netText', e => e.textContent) + ' | sw: ' + await page.$eval('#pOffline', e => e.textContent));
  await page.screenshot({ path: path.join(__dirname, 'pwa_rest.png'), fullPage: true });
  const run = async (files, tap, verifiedN) => {
    for (const el of await page.$$('#thumbs .thumb button')) await page.evaluate(() => { const b = document.querySelector('#thumbs .thumb button'); if (b) b.click(); });
    for (const f of files) { await (await page.$('#inPick')).uploadFile(f); await new Promise(r => setTimeout(r, 500)); }
    await page.select('#selKind', tap ? 'coin' : 'none');
    if (tap) { await page.waitForFunction(() => !document.getElementById('pickWrap').hidden, { timeout: 30000 }); await page.select('#selCountry', 'JPY'); await page.evaluate(() => document.querySelectorAll('#coins .coin')[5].click());
      await page.evaluate((t) => { const c = document.getElementById('pick'); c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * t[0], clientY: r.top + r.height * t[1] })); }, tap); await new Promise(r => setTimeout(r, 600)); }
    else await page.waitForFunction(() => !document.getElementById('btnAnalyze').disabled, { timeout: 30000 });
    const t0 = Date.now(); await page.click('#btnAnalyze'); await page.waitForFunction(() => document.getElementById('pText').textContent === '完了', { timeout: 300000 }); await new Promise(r => setTimeout(r, 1500));
    logs.push((Date.now() - t0) + 'ms ' + JSON.stringify(await page.evaluate(() => ({ num: document.getElementById('rNum').textContent, per: document.getElementById('rPer').textContent, alerts: Array.from(document.querySelectorAll('#rAlerts .alert')).map(e => e.textContent.slice(0, 28)), chips: Array.from(document.querySelectorAll('#rChips .chip')).map(e => e.textContent), bars: document.querySelectorAll('#histo rect.bar').length }))));
    if (verifiedN) await page.evaluate((n) => { document.getElementById('inConfirm').value = n; document.getElementById('inVerified').checked = true; }, verifiedN);
    await page.click('#btnSave'); await new Promise(r => setTimeout(r, 400)); logs.push('save: ' + await page.$eval('#saveStatus', e => e.textContent));
  };
  const R = f => path.resolve(__dirname, '..', f);
  await run([0, 1].map(k => R(`test/free/w_spread20_${k}.jpg`)), null, 0);   // no reference object: provisional value
  await run([0, 1, 2].map(k => R(`test/free/g_loose30_${k}.jpg`)), [0.12707, 0.84369], 30);
  await run([0, 1, 2].map(k => R(`test/free/b_loose25_${k}.jpg`)), JSON.parse(fs.readFileSync(R('test/free/truth.json'))).b_loose25.coinTap, 0);
  await page.click('#btnZip'); await page.click('#btnImg'); await page.click('#btnExport'); await page.click('#btnShare'); await new Promise(r => setTimeout(r, 500)); await page.click('#btnShareSave'); await new Promise(r => setTimeout(r, 1500));
  logs.push('hist: ' + await page.$eval('#histStatus', e => e.textContent) + ' | calib: ' + await page.$eval('#vCalib', e => e.textContent) + ' | rows: ' + await page.$$eval('#hist li', e => e.length) + ' | trend: ' + !(await page.$eval('#trend', e => e.hidden)));
  logs.push('downloads: ' + fs.readdirSync(dl).map(f => f.replace(/_\d{8}_\d{4}/, '') + ':' + fs.statSync(path.join(dl, f)).size).join(', '));
  logs.push('proof: ' + JSON.stringify(await page.evaluate(() => ({ ext: document.getElementById('pExt').textContent, blocked: document.getElementById('pBlocked').textContent, own: document.getElementById('pOwn').textContent, persist: document.getElementById('pPersist').textContent, ls: Object.keys(localStorage), bytes: JSON.stringify(localStorage).length }))));
  // import round trip into a clean profile state
  const exp = fs.readdirSync(dl).find(f => f.indexOf('records') >= 0);
  await page.evaluate(() => { localStorage.clear(); }); await page.reload({ waitUntil: 'load' }); await (await page.$('#inImport')).uploadFile(path.join(dl, exp)); await new Promise(r => setTimeout(r, 600));
  logs.push('import: ' + await page.$eval('#histStatus', e => e.textContent) + ' | rows ' + await page.$$eval('#hist li', e => e.length) + ' | calib ' + await page.$eval('#vCalib', e => e.textContent));
  await page.evaluate(() => { document.getElementById('proofBox').open = true; }); await page.screenshot({ path: path.join(__dirname, 'pwa_after.png'), fullPage: true });
  console.log(logs.join('\n')); await browser.close(); srv.close();
})();

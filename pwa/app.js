(function () {
  'use strict';
  var APP = "MOT'S HAIR COUNTER";                                      // the name is never translated
  var SOURCE_URL = 'https://github.com/GB-pro/hair-loss-counter';      // set to the public repository URL when the source is published
  var MAX_SIDE = 2600, MAX_PHOTOS = 5;
  var K_REC = 'hlc.records.v3', K_CAL = 'hlc.calib.v3', K_SET = 'hlc.settings.v3', K_BAK = 'hlc.lastBackupCount', K_LANG = 'hlc.lang';
  var $ = function (id) { return document.getElementById(id); };
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // ---------------------------------------------------------------- language
  // Nine languages. The one closest to the browser's own language is shown; a choice made with the buttons at the
  // bottom of the page is remembered on this device.
  var I18N = window.HLC_I18N, lang = 'en', langByUser = false;
  function browserLangs() { var l = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']; return Array.prototype.map.call(l, String); }
  function baseOf(tag) { return String(tag || '').toLowerCase().split(/[-_]/)[0]; }
  function regionOf(tag) { var m = /[-_]([A-Za-z]{2})(?![A-Za-z])/.exec(tag || ''); return m ? m[1].toUpperCase() : ''; }
  function detectLang() {
    var saved = null; try { saved = localStorage.getItem(K_LANG); } catch (e) { saved = null; }
    if (saved && I18N.text[saved]) { langByUser = true; return saved; }
    var list = browserLangs(), i, b;
    for (i = 0; i < list.length; i++) { b = baseOf(list[i]); if (I18N.text[b]) return b; }
    for (i = 0; i < list.length; i++) { b = I18N.near[baseOf(list[i])]; if (b) return b; }
    return 'en';
  }
  function t(key, v) {
    var s = I18N.text[lang][key]; if (s == null) s = I18N.text.en[key]; if (s == null) return key;
    return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }) : s;
  }
  function tb(key, v) { return esc(t(key)).replace(/\{(\w+)\}/g, function (m, k) { return '<b>' + esc(v[k]) + '</b>'; }); }   // values in bold
  function loc() { return I18N.locale[lang] || lang; }
  function sep() { return lang === 'ja' || lang === 'zh' || lang === 'ko' ? '・' : ' · '; }
  // the coins people are most likely to have: from the region of the browser's language, else from the language itself
  var REGION_CUR = { JP: 'JPY', US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', CH: 'CHF', LI: 'CHF', CN: 'CNY', KR: 'KRW' };
  var EURO = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' ');
  var LANG_CUR = { ja: 'JPY', en: 'USD', zh: 'CNY', ko: 'KRW', de: 'EUR', fr: 'EUR', es: 'EUR', it: 'EUR', pt: 'EUR' };
  function currencyFor(l, byUser) {
    var list = browserLangs(), tag = '';
    for (var i = 0; i < list.length; i++) if (baseOf(list[i]) === l) { tag = list[i]; break; }
    if (!tag && !byUser) tag = list[0] || '';
    var reg = regionOf(tag);
    return REGION_CUR[reg] || (EURO.indexOf(reg) >= 0 ? 'EUR' : LANG_CUR[l] || 'USD');
  }

  // ---------------------------------------------------------------- reference objects
  // Diameters in mm. poly: not a true circle (flat-to-flat or constant-width shape) -> a little less exact.
  var G = '#c9a227', S = '#b9bcc2', C = '#b0703a', A = '#d7d9dc';
  var COINS = {
    JPY: { coins: [['1円', 20.0, A], ['5円', 22.0, G, { hole: 5 }], ['10円', 23.5, C], ['50円', 21.0, S, { hole: 4 }], ['100円', 22.6, S], ['500円', 26.5, G, { ring: S }]] },
    USD: { coins: [['1¢', 19.05, C], ['5¢', 21.21, S], ['10¢', 17.91, S], ['25¢', 24.26, S], ['50¢', 30.61, S], ['$1', 26.49, G]] },
    EUR: { coins: [['1c', 16.25, C], ['2c', 18.75, C], ['5c', 21.25, C], ['10c', 19.75, G], ['20c', 22.25, G], ['50c', 24.25, G], ['€1', 23.25, S, { ring: G }], ['€2', 25.75, G, { ring: S }]] },
    GBP: { coins: [['1p', 20.3, C], ['2p', 25.9, C], ['5p', 18.0, S], ['10p', 24.5, S], ['20p', 21.4, S, { poly: 7 }], ['50p', 27.3, S, { poly: 7 }], ['£1', 23.23, S, { ring: G, poly: 12 }], ['£2', 28.4, S, { ring: G }]] },
    CNY: { coins: [['1角', 19.0, S], ['5角', 20.5, G], ['1元', 22.25, S, { tag: 'new' }], ['1元', 25.0, S, { tag: 'old' }]] },
    KRW: { coins: [['10', 18.0, C], ['50', 21.6, S], ['100', 24.0, S], ['500', 26.5, S]] },
    CAD: { coins: [['5¢', 21.2, S], ['10¢', 18.03, S], ['25¢', 23.88, S], ['$1', 26.5, G, { poly: 11 }], ['$2', 28.0, G, { ring: S }]] },
    AUD: { coins: [['5c', 19.41, S], ['10c', 23.6, S], ['20c', 28.65, S], ['50c', 31.65, S, { poly: 12 }], ['$1', 25.0, G], ['$2', 20.5, G]] },
    CHF: { coins: [['5Rp', 17.15, G], ['10Rp', 19.15, S], ['20Rp', 21.05, S], ['½Fr', 18.2, S], ['1Fr', 23.2, S], ['2Fr', 27.4, S], ['5Fr', 31.45, S]] }
  };
  var DEF_COIN = { JPY: 5, USD: 3, EUR: 6, GBP: 6, CNY: 2, KRW: 3, CAD: 3, AUD: 4, CHF: 4 };   // a common, large coin of each
  var CARD = { w: 85.6, h: 53.98 };
  function coinName(c) { var o = c[3] || {}; return c[0] + (o.tag ? ' ' + t('coin.' + o.tag) : ''); }
  function coinSvg(c, size) {
    var mm = c[1], o = c[3] || {}, r = mm / 32 * (size / 2 - 1), cx = size / 2, s = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">';
    var shape;
    if (o.poly) { var pts = []; for (var i = 0; i < o.poly; i++) { var a = (i / o.poly) * 2 * Math.PI - Math.PI / 2; pts.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cx + r * Math.sin(a)).toFixed(1)); } shape = function (rr, fill) { return '<polygon points="' + pts.join(' ') + '" fill="' + fill + '" stroke="rgba(0,0,0,.35)" stroke-linejoin="round" stroke-width="' + (o.poly === 7 ? 3 : 1) + '"/>'; }; s += shape(r, o.ring || c[2]); }
    else s += '<circle cx="' + cx + '" cy="' + cx + '" r="' + r.toFixed(1) + '" fill="' + (o.ring || c[2]) + '" stroke="rgba(0,0,0,.35)"/>';
    if (o.ring) s += '<circle cx="' + cx + '" cy="' + cx + '" r="' + (r * 0.68).toFixed(1) + '" fill="' + c[2] + '" stroke="rgba(0,0,0,.2)"/>';
    else s += '<circle cx="' + cx + '" cy="' + cx + '" r="' + (r * 0.86).toFixed(1) + '" fill="none" stroke="rgba(0,0,0,.18)"/>';
    if (o.hole) s += '<circle cx="' + cx + '" cy="' + cx + '" r="' + (o.hole / 32 * (size / 2 - 1)).toFixed(1) + '" fill="var(--solid)" stroke="rgba(0,0,0,.35)"/>';
    return s + '</svg>';
  }

  // ---------------------------------------------------------------- state
  var state = {
    photos: [], work1: null,
    ref: { kind: 'coin', country: 'JPY', coin: 5, tap: null, points: [], manual: false, fit: null },
    result: null, analyzed: false, showLines: true, saved: false,
    records: [], calib: null, license: null,    // license: reserved for a future paid tier; nothing reads it yet
    settings: { sensitivity: 1.0, minLenMm: 10, country: 'JPY', coin: 5, kind: 'coin', countryManual: false, camMode: '' }
  };
  var storageOk = true;
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { storageOk = false; return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { storageOk = false; return false; } }
  var sv = lsGet(K_SET, null); if (sv) for (var k0 in sv) state.settings[k0] = sv[k0];
  lang = detectLang();
  (function () {   // the coin set follows the language until the user picks a currency by hand
    var auto = currencyFor(lang, langByUser), st = state.settings;
    if (sv && sv.country && sv.countryManual === undefined) st.countryManual = !!COINS[sv.country] && sv.country !== auto;   // settings from before 2.3
    state.ref.kind = st.kind;
    state.ref.country = st.countryManual && COINS[st.country] ? st.country : auto;
    state.ref.coin = sv && sv.country === state.ref.country && sv.coin >= 0 ? Math.min(sv.coin, COINS[state.ref.country].coins.length - 1) : DEF_COIN[state.ref.country];
  })();
  state.records = lsGet(K_REC, []); if (!Array.isArray(state.records)) state.records = [];
  // engine 2.1 traces hairs through dense clumps, so the measured total length is about 1.35x the 2.0 value.
  // A correction learned with 2.0 is carried over by that factor instead of being thrown away.
  var CAL_ENGINE = 2.1, CAL_SCALE_20 = 1.35;
  function migrateCalib(c) {
    if (!c || !(c.Leff > 0) || (c.engine || 2.0) >= CAL_ENGINE) return c;
    c.Leff = +(c.Leff * CAL_SCALE_20).toFixed(1);
    (c.samples || []).forEach(function (x) { if (x && x.Leff > 0) x.Leff = +(x.Leff * CAL_SCALE_20).toFixed(1); });
    c.engine = CAL_ENGINE; return c;
  }
  state.calib = lsGet(K_CAL, null);
  if (state.calib && (state.calib.engine || 2.0) < CAL_ENGINE) { state.calib = migrateCalib(state.calib); lsSet(K_CAL, state.calib); }
  $('ver').textContent = 'v' + (window.HLC ? HLC.version : '');
  function saveSettings() { state.settings.kind = state.ref.kind; state.settings.country = state.ref.country; state.settings.coin = state.ref.coin; lsSet(K_SET, state.settings); }
  function saveBlob(blob, name) { var a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 30000); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }

  // ---------------------------------------------------------------- worker
  var worker = null, jobs = {}, jobSeq = 0;
  try {
    worker = new Worker('worker.js');
    worker.onmessage = function (e) {
      var d = e.data, job = jobs[d.id]; if (!job) return;
      if (d.type === 'progress') job.progress(d.p, d.label);
      else { delete jobs[d.id]; if (d.type === 'done') job.resolve(d.result); else job.reject(new Error(d.message)); }
    };
    worker.onerror = function () { worker = null; Object.keys(jobs).forEach(function (id) { jobs[id].reject(new Error('worker')); delete jobs[id]; }); };
  } catch (e) { worker = null; }
  function findCoin(work) {   // automatic coin search, off the main thread when possible
    if (worker) return new Promise(function (resolve, reject) {
      var id = ++jobSeq, copy = new Uint8ClampedArray(work.data); jobs[id] = { resolve: resolve, reject: reject, progress: function () {} };
      try { worker.postMessage({ id: id, op: 'coin', work: { width: work.width, height: work.height, data: copy } }, [copy.buffer]); } catch (err) { delete jobs[id]; reject(err); }
    });
    return Promise.resolve(window.HLC.findCoin(work));
  }
  function analyze(imgs, opt, progress) {
    if (worker) return new Promise(function (resolve, reject) {
      var id = ++jobSeq; jobs[id] = { resolve: resolve, reject: reject, progress: progress };
      try { worker.postMessage({ id: id, imgs: imgs, opt: opt }, imgs.map(function (im) { return im.data.buffer; })); } catch (err) { delete jobs[id]; reject(err); }
    });
    return window.HLC.analyzeFree(imgs, opt, progress);
  }

  // ---------------------------------------------------------------- images
  function loadImageData(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onload = function () {
        var s = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.round(im.naturalWidth * s), h = Math.round(im.naturalHeight * s);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(im, 0, 0, w, h);
        URL.revokeObjectURL(url);
        try { var d = ctx.getImageData(0, 0, w, h); resolve({ width: w, height: h, data: d.data }); } catch (err) { reject(err); }
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      im.src = url;
    });
  }

  // ---------------------------------------------------------------- capture
  var seq = 0, busy = false;
  function addFiles(list, shot) {   // shot: taken just now with a camera, so it exists nowhere else on the phone
    Array.prototype.slice.call(list || []).forEach(function (f) {
      if (f.type && f.type.indexOf('image/') !== 0) return;
      if (state.photos.length >= MAX_PHOTOS) return;
      state.photos.push({ id: ++seq, file: f, url: URL.createObjectURL(f), coin: null, shot: !!shot, kept: false });
    });
    state.analyzed = false; renderThumbs(); ensureWork1();
  }
  $('inCamera').addEventListener('change', function (e) { addFiles(e.target.files, true); e.target.value = ''; });
  $('inPick').addEventListener('change', function (e) { addFiles(e.target.files, false); e.target.value = ''; });

  // ---------------------------------------------------------------- camera
  // "Take photos" opens one of two cameras.
  //  system: the phone's own camera app. Same picture as any photo taken on the phone (its HDR, its flash metering).
  //          A web page cannot read or copy that app's settings, so this is the only way to get exactly that quality.
  //  inapp:  a camera inside this page: highest resolution, light on, three shots in a row. The light is kept on
  //          steadily (torch) so that the camera meters with it; a single flash fired from a web page is not
  //          metered and washes the picture out. Each shot is checked, and retaken darker if it is blown out.
  // Closing the in-app camera stops it, so nothing stays changed on the phone.
  var ua = navigator.userAgent || '', ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isPhone = ios || /Android/i.test(ua);
  var cam = { stream: null, track: null, ic: null, pcaps: null, caps: {}, set: {}, light: false, lit: false, ev: 0, shots: 0, note: '' }, camDenied = false;
  var CLIP_MAX = 0.15;   // more than this share of pure-white pixels counts as blown out
  function camMode() { var m = state.settings.camMode; return m === 'system' || m === 'inapp' ? m : (isPhone ? 'system' : 'inapp'); }
  function renderCamMode() {
    var m = camMode(); $('camSub').textContent = t('cam.sub.' + m); $('selCam').value = m;
    $('camNote').textContent = t(camDenied ? 'cam.note.denied' : 'cam.note.' + m);
  }
  $('selCam').addEventListener('change', function (e) { state.settings.camMode = e.target.value; camDenied = false; saveSettings(); renderCamMode(); });
  function camLightKind() {
    if (cam.caps && cam.caps.torch) return 'torch';
    if (cam.pcaps && cam.pcaps.fillLightMode && cam.pcaps.fillLightMode.indexOf('flash') >= 0) return 'flash';
    return '';
  }
  async function applyCam() {   // exposure, focus, white balance, light: only what this camera says it supports
    var s = {}, k; for (k in cam.set) s[k] = cam.set[k];
    if (cam.caps.torch) s.torch = !!cam.light;
    var evc = cam.caps.exposureCompensation; if (evc && evc.min < 0) s.exposureCompensation = cam.ev;
    if (!cam.track || !Object.keys(s).length) return;
    try { await cam.track.applyConstraints({ advanced: [s] }); }
    catch (e) { for (k in s) { var one = {}; one[k] = s[k]; try { await cam.track.applyConstraints({ advanced: [one] }); } catch (e2) { /* not supported after all */ } } }
    cam.lit = !!(cam.caps.torch && cam.light);
  }
  async function openCamera() {
    if (camMode() === 'system' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('inCamera').click(); return; }
    try {
      cam.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 4096 } } });
    } catch (e) { cam.stream = null; camDenied = true; renderCamMode(); $('inCamera').click(); return; }
    camDenied = false; renderCamMode();
    cam.track = cam.stream.getVideoTracks()[0]; cam.caps = cam.track.getCapabilities ? cam.track.getCapabilities() : {};
    if (cam.caps.width && cam.caps.height) { try { await cam.track.applyConstraints({ width: { ideal: cam.caps.width.max }, height: { ideal: cam.caps.height.max } }); } catch (e) { /* keep what we got */ } }
    cam.ic = null; cam.pcaps = null;
    if (window.ImageCapture) { try { cam.ic = new ImageCapture(cam.track); cam.pcaps = await cam.ic.getPhotoCapabilities(); } catch (e) { cam.pcaps = null; } }
    cam.set = {};
    ['exposureMode', 'focusMode', 'whiteBalanceMode'].forEach(function (k) { var c = cam.caps[k]; if (c && c.indexOf && c.indexOf('continuous') >= 0) cam.set[k] = 'continuous'; });
    cam.shots = 0; cam.ev = 0; cam.note = ''; cam.light = !!camLightKind(); cam.lit = false;
    $('camVideo').srcObject = cam.stream; $('cam').hidden = false; document.body.classList.add('noscroll');
    try { await $('camVideo').play(); } catch (e) { /* autoplay attribute covers it */ }
    cam.litAt = Date.now(); await applyCam(); camInfo();
  }
  function camInfo() {
    var w = 0, h = 0, kind = camLightKind(), parts = [];
    if (cam.pcaps && cam.pcaps.imageWidth && cam.pcaps.imageHeight) { w = cam.pcaps.imageWidth.max; h = cam.pcaps.imageHeight.max; }
    else { var st = cam.track && cam.track.getSettings ? cam.track.getSettings() : {}; w = st.width || 0; h = st.height || 0; }
    if (w) parts.push(t('cam.info.mp', { mp: Math.round(w * h / 1e5) / 10, w: w, h: h }));
    parts.push(t(!kind ? 'cam.info.nolight' : cam.light ? 'cam.info.light' : 'cam.info.lightoff'));
    parts.push(cam.note || t('cam.info.frame'));
    $('camInfo').textContent = parts.join(sep());
    $('camCount').textContent = state.photos.length + ' / 3';
    var lb = $('camLight'); lb.hidden = !kind; lb.setAttribute('aria-pressed', cam.light ? 'true' : 'false');
  }
  async function camStill() {   // a full-resolution still, where the browser can take one
    if (!cam.ic || !cam.pcaps) return null;
    var ps = {}, fl = cam.pcaps.fillLightMode || [];
    if (cam.pcaps.imageWidth && cam.pcaps.imageWidth.max) ps.imageWidth = cam.pcaps.imageWidth.max;
    if (cam.pcaps.imageHeight && cam.pcaps.imageHeight.max) ps.imageHeight = cam.pcaps.imageHeight.max;
    if (!cam.lit) { if (cam.light && fl.indexOf('flash') >= 0) ps.fillLightMode = 'flash'; else if (fl.indexOf('off') >= 0) ps.fillLightMode = 'off'; }   // with the torch on, leave the light alone
    try { return await cam.ic.takePhoto(ps); } catch (e) { try { return await cam.ic.takePhoto(); } catch (e2) { return null; } }
  }
  function camFrame() {   // the preview frame: exactly what is on the screen, lit and metered
    var v = $('camVideo'); if (!v.videoWidth) return Promise.resolve(null);
    var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    return new Promise(function (r) { c.toBlob(r, 'image/jpeg', 0.95); });
  }
  function exposureOf(blob) {   // share of pure-white pixels and mean brightness, from a small copy of the shot
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onload = function () {
        try {
          var w = 96, h = Math.max(1, Math.round(96 * im.naturalHeight / im.naturalWidth)), c = document.createElement('canvas'); c.width = w; c.height = h;
          var ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(im, 0, 0, w, h);
          var d = ctx.getImageData(0, 0, w, h).data, clip = 0, sum = 0;
          for (var i = 0; i < d.length; i += 4) { if (d[i] >= 250 && d[i + 1] >= 250 && d[i + 2] >= 250) clip++; sum += d[i] + d[i + 1] + d[i + 2]; }
          resolve({ clip: clip / (w * h), mean: sum / (3 * w * h) });
        } catch (e) { resolve({ clip: 0, mean: 128 }); }
        URL.revokeObjectURL(url);
      };
      im.onerror = function () { URL.revokeObjectURL(url); resolve({ clip: 0, mean: 128 }); };
      im.src = url;
    });
  }
  async function camGrab() {
    // The still is sharper, but on some phones taking it fires an unmetered flash or drops the torch. When the still
    // comes out blown out, or much darker than the preview, the preview frame is used instead: what you see is what you get.
    var still = await camStill(), sx = still ? await exposureOf(still) : null;
    if (still && sx.clip <= CLIP_MAX && !cam.lit) return { blob: still, ex: sx };
    var frame = await camFrame(), fx = frame ? await exposureOf(frame) : null;
    if (!still) return frame ? { blob: frame, ex: fx } : null;
    if (frame && ((sx.clip > CLIP_MAX && fx.clip < sx.clip) || (cam.lit && sx.mean < fx.mean * 0.6))) return { blob: frame, ex: fx };
    return { blob: still, ex: sx };
  }
  async function camShoot() {
    if (!cam.track) return;
    $('camShot').disabled = true; cam.note = '';
    var best = null, tries = 0, evc = cam.caps.exposureCompensation;
    try {
      var wait = 900 - (Date.now() - (cam.litAt || 0)); if (cam.lit && wait > 0) await sleep(wait);   // let the camera settle with the light on
      for (;;) {
        var got = await camGrab(); if (!got) break;
        if (!best || got.ex.clip < best.ex.clip) best = got;
        if (got.ex.clip <= CLIP_MAX || tries >= 2 || !evc || !(evc.min < 0) || cam.ev - 1 < evc.min) break;
        cam.ev -= 1; tries++; await applyCam(); await sleep(700);   // blown out: one stop darker, then again
      }
    } catch (e) { /* keep the best shot so far */ }
    $('cam').classList.add('flash'); setTimeout(function () { $('cam').classList.remove('flash'); }, 120);
    if (best) {
      if (best.ex.clip > CLIP_MAX) cam.note = t('cam.info.blown'); else if (tries) cam.note = t('cam.info.bright');
      cam.shots++; addFiles([new File([best.blob], 'HairLossCounter_photo_' + stamp(new Date()) + '_' + cam.shots + '.jpg', { type: 'image/jpeg', lastModified: Date.now() })], true);
    }
    $('camShot').disabled = false; camInfo();
    if (state.photos.length >= 3 || state.photos.length >= MAX_PHOTOS) closeCamera();
  }
  function closeCamera() {
    if (cam.track && cam.lit) { try { cam.track.applyConstraints({ advanced: [{ torch: false }] }).catch(function () {}); } catch (e) { /* ignore */ } }
    if (cam.stream) cam.stream.getTracks().forEach(function (tr) { tr.stop(); });   // releases the camera: its settings go back to normal
    cam.stream = null; cam.track = null; cam.ic = null; cam.pcaps = null; cam.lit = false; $('camVideo').srcObject = null;
    $('cam').hidden = true; document.body.classList.remove('noscroll');
  }
  $('btnCamera').addEventListener('click', openCamera);
  $('camShot').addEventListener('click', camShoot);
  $('camClose').addEventListener('click', closeCamera);
  $('camLight').addEventListener('click', async function () { if (!cam.track) return; cam.light = !cam.light; cam.ev = 0; cam.note = ''; cam.litAt = Date.now(); await applyCam(); camInfo(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && cam.stream) closeCamera(); });

  // Photos taken from this page are only in the page's memory. This puts copies into the phone's download folder.
  function extOf(f) { var m = /\.([A-Za-z0-9]{2,5})$/.exec(f.name || ''); return m ? m[1].toLowerCase() : ({ 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' })[f.type] || 'jpg'; }
  $('btnKeep').addEventListener('click', async function () {
    var list = state.photos.filter(function (p) { return p.shot && !p.kept; }), base = 'HairLossCounter_photo_' + stamp(new Date()) + '_';
    if (!list.length) return;
    $('btnKeep').disabled = true;
    for (var i = 0; i < list.length; i++) { saveBlob(list[i].file, base + (i + 1) + '.' + extOf(list[i].file)); list[i].kept = true; await sleep(400); }
    $('keepStatus').textContent = t('keep.done', { n: list.length }); $('keepStatus').className = 'status ok'; renderThumbs();
  });

  function removePhoto(id) {
    state.photos = state.photos.filter(function (p) { if (p.id === id) { URL.revokeObjectURL(p.url); return false; } return true; });
    renderThumbs(); ensureWork1();
  }
  function renderThumbs() {
    var box = $('thumbs'); box.textContent = '';
    state.photos.forEach(function (p, i) {
      var d = el('div', 'thumb');
      var im = document.createElement('img'); im.src = p.url; im.alt = t('thumb.alt', { n: i + 1 }); im.dataset.name = p.file.name || ''; d.appendChild(im);
      d.appendChild(el('span', 'badge', i === 0 ? '1 ' + t('thumb.ref') : String(i + 1)));
      var x = el('button', '', '×'); x.type = 'button'; x.setAttribute('aria-label', t('thumb.remove', { n: i + 1 }));
      x.addEventListener('click', function () { removePhoto(p.id); }); d.appendChild(x);
      box.appendChild(d);
    });
    Array.prototype.forEach.call($('slots').children, function (s, i) { s.classList.toggle('done', i < state.photos.length); });
    var shots = state.photos.filter(function (p) { return p.shot; });
    $('keepBox').hidden = !shots.length; $('btnKeep').disabled = !shots.some(function (p) { return !p.kept; });
    if (!shots.length) $('keepStatus').textContent = '';
    updateAnalyzeBtn();
  }
  function updateAnalyzeBtn() {
    var n = state.photos.length, needRef = state.ref.kind !== 'none' && !refReady();
    $('btnAnalyze').disabled = n === 0 || busy || !state.work1;
    $('btnAnalyze').textContent = !n ? t('an.go') : t(needRef ? 'an.noref' : 'an.n', { n: n });
  }

  // ---------------------------------------------------------------- reference picking
  function refMm() { return state.ref.kind === 'card' ? CARD.w : COINS[state.ref.country].coins[state.ref.coin][1]; }
  function refLabel() { return state.ref.kind === 'card' ? t('card.label') : state.ref.kind === 'none' ? t('ref.none') : t('cur.' + state.ref.country) + ' ' + coinName(COINS[state.ref.country].coins[state.ref.coin]) + ' (' + refMm() + ' mm)'; }
  function refReady() { return (state.ref.fit && state.ref.fit.ok) || state.ref.points.length === 2; }
  function resetRef() { state.ref.tap = null; state.ref.points = []; state.ref.fit = null; }
  function renderRefControls() {
    $('selKind').value = state.ref.kind;
    var sc = $('selCountry');
    if (sc.dataset.lang !== lang) { sc.textContent = ''; Object.keys(COINS).forEach(function (k) { var o = el('option', '', t('cur.' + k)); o.value = k; sc.appendChild(o); }); sc.dataset.lang = lang; }
    sc.value = state.ref.country;
    $('fCountry').hidden = state.ref.kind !== 'coin';
    var box = $('coins'); box.textContent = ''; box.hidden = state.ref.kind !== 'coin';
    if (state.ref.kind === 'coin') COINS[state.ref.country].coins.forEach(function (c, i) {
      var b = el('button', 'coin'); b.type = 'button'; b.setAttribute('aria-pressed', i === state.ref.coin ? 'true' : 'false');
      b.innerHTML = coinSvg(c, 44) + '<span></span><small></small>'; b.querySelector('span').textContent = coinName(c); b.querySelector('small').textContent = c[1] + 'mm';
      b.addEventListener('click', function () { state.ref.coin = i; saveSettings(); refit(); renderRefControls(); });
      box.appendChild(b);
    });
    $('refNote').textContent = t('note.' + state.ref.kind);
    var r = state.ref, show = r.kind !== 'none' && !!state.work1;
    $('refCheck').hidden = r.kind === 'none' || !state.photos.length;
    $('pickWrap').hidden = !show; $('refTools').hidden = !show;
    $('btnRefMode').textContent = t(r.manual ? 'ref.mode.auto' : 'ref.mode.manual');
    var h = $('refHint');
    if (r.scanning) h.textContent = t('hint.scan');
    else if (!state.work1) h.textContent = '';
    else if (r.manual) h.textContent = t(r.kind === 'card' ? 'hint.manual.card' : 'hint.manual.coin');
    else if (r.kind === 'card') h.textContent = t('hint.card');
    else if (r.autoFound) h.textContent = t(r.reordered ? 'hint.auto.re' : 'hint.auto');
    else h.textContent = t('hint.notfound');
    drawPick(); refStatus(); updateAnalyzeBtn();
  }
  function refStatus() {
    var st = $('refStatus'), r = state.ref; st.className = 'status'; st.dataset.state = '';
    if (r.kind === 'none' || !state.work1) { st.textContent = ''; return; }
    if (r.fit && r.fit.ok) {
      var ppm = r.fit.pxPerMm, wmm = state.work1.width / ppm;
      st.textContent = t('st.found', { ref: refLabel(), mm: Math.round(wmm) }) + (r.fit.shapeOk ? '' : t('st.shape'));
      st.className = 'status ' + (r.fit.shapeOk ? 'ok' : ''); st.dataset.state = 'found';
    } else if (r.fit && !r.fit.ok) { st.textContent = t('st.miss'); st.className = 'status err'; st.dataset.state = 'miss'; }
    else if (r.points.length === 2) { st.textContent = t('st.two', { ref: refLabel() }); st.className = 'status ok'; st.dataset.state = 'two'; }
    else if (r.points.length === 1) { st.textContent = t('st.one'); st.dataset.state = 'one'; }
    else st.textContent = '';
  }
  function refit() {
    var r = state.ref; if (!state.work1 || !r.tap || r.manual || r.kind === 'none') return;
    r.fit = HLC.fitReference(state.work1, { x: r.tap[0] * state.work1.width, y: r.tap[1] * state.work1.height }, r.kind, refMm());
  }
  function drawPick() {
    var w = state.work1, cv = $('pick'); if (!w || state.ref.kind === 'none') return;
    cv.width = w.width; cv.height = w.height;
    var ctx = cv.getContext('2d'); ctx.putImageData(new ImageData(new Uint8ClampedArray(w.data), w.width, w.height), 0, 0);
    var r = state.ref; ctx.lineWidth = 5; ctx.strokeStyle = '#ff2bd0';
    if (r.fit && r.fit.ok) {
      ctx.beginPath();
      if (r.fit.kind === 'coin') ctx.arc(r.fit.cx, r.fit.cy, r.fit.r, 0, Math.PI * 2);
      else { var c = r.fit.corners; ctx.moveTo(c[0][0], c[0][1]); for (var i = 1; i < 4; i++) ctx.lineTo(c[i][0], c[i][1]); ctx.closePath(); }
      ctx.stroke();
    }
    r.points.forEach(function (p) { ctx.beginPath(); ctx.arc(p[0] * w.width, p[1] * w.height, 12, 0, Math.PI * 2); ctx.stroke(); });
    if (r.points.length === 2) { ctx.beginPath(); ctx.moveTo(r.points[0][0] * w.width, r.points[0][1] * w.height); ctx.lineTo(r.points[1][0] * w.width, r.points[1][1] * w.height); ctx.stroke(); }
  }
  $('pick').addEventListener('click', function (e) {
    var cv = $('pick'), rc = cv.getBoundingClientRect(), nx = (e.clientX - rc.left) / rc.width, ny = (e.clientY - rc.top) / rc.height, r = state.ref;
    if (r.manual) { if (r.points.length >= 2) r.points = []; r.points.push([nx, ny]); r.fit = null; r.tap = null; }
    else { r.tap = [nx, ny]; r.points = []; refit(); }
    state.analyzed = false; renderRefControls();
  });
  $('btnRefMode').addEventListener('click', function () { state.ref.manual = !state.ref.manual; resetRef(); autoTapCoin(); renderRefControls(); });
  $('btnRefClear').addEventListener('click', function () { resetRef(); renderRefControls(); });
  $('selKind').addEventListener('change', function (e) { state.ref.kind = e.target.value; resetRef(); autoTapCoin(); saveSettings(); renderRefControls(); });
  $('selCountry').addEventListener('change', function (e) {   // chosen by hand: from now on the coin set no longer follows the language
    state.ref.country = e.target.value; state.ref.coin = DEF_COIN[e.target.value]; state.settings.countryManual = true; saveSettings(); refit(); renderRefControls();
  });
  // The coin is found automatically in every photo. The photo where it looks roundest was taken most nearly straight
  // down, so it becomes the reference (photo 1) whatever order the photos were taken or picked in.
  var refRun = 0;
  async function ensureWork1() {
    var run = ++refRun;
    if (!state.photos.length) { state.work1 = null; state.ref.scanning = false; resetRef(); renderRefControls(); return; }
    state.ref.scanning = true; renderRefControls();
    var works = {};
    for (var i = 0; i < state.photos.length; i++) {
      var p = state.photos[i];
      if (p.coin && i > 0) continue;
      try {
        var img = await loadImageData(p.file); if (run !== refRun) return;
        var wk = HLC.toWork(img, {}); works[p.id] = wk;
        if (!p.coin) { p.coin = await findCoin(wk); if (run !== refRun) return; }
      } catch (e) { p.coin = { ok: false }; }
    }
    var best = 0;
    state.photos.forEach(function (p, k) { var b = state.photos[best].coin; if (p.coin && p.coin.ok && (!b || !b.ok || p.coin.ratio > b.ratio + 0.01)) best = k; });
    if (best > 0) { var mv = state.photos.splice(best, 1)[0]; state.photos.unshift(mv); renderThumbs(); }
    var ref = state.photos[0];
    if (!works[ref.id]) { try { works[ref.id] = HLC.toWork(await loadImageData(ref.file), {}); } catch (e) { works[ref.id] = null; } if (run !== refRun) return; }
    var changed = !state.work1 || state.work1For !== ref.id;
    state.work1 = works[ref.id]; state.work1For = ref.id; state.ref.scanning = false;
    state.ref.autoFound = !!(ref.coin && ref.coin.ok); state.ref.reordered = best > 0;
    if (changed || !state.ref.tap) {
      resetRef();
      if (state.ref.kind === 'coin' && ref.coin && ref.coin.ok && !state.ref.manual) { state.ref.tap = ref.coin.tap; refit(); }
    }
    renderRefControls();
  }
  function autoTapCoin() {   // used when the kind is switched back to coin
    var ref = state.photos[0];
    if (state.ref.kind === 'coin' && !state.ref.manual && ref && ref.coin && ref.coin.ok) { state.ref.tap = ref.coin.tap; refit(); }
  }

  // ---------------------------------------------------------------- analysis
  var STAGES = { load: 1, surface: 1, line: 1, align: 1, segment: 1, trace: 1, done: 1 };
  function setProgress(f, text, stage) { $('progress').hidden = false; $('barFill').style.width = Math.round(f * 100) + '%'; $('pText').textContent = text; $('pText').dataset.stage = stage || ''; }
  async function runAnalysis() {
    if (busy || !state.photos.length) return;
    busy = true; updateAnalyzeBtn(); state.saved = false;
    try {
      var imgs = [];
      for (var i = 0; i < state.photos.length; i++) { setProgress(0.02 * i, t('pg.read', { n: i + 1 })); imgs.push(await loadImageData(state.photos[i].file)); }
      var opt = { sensitivity: state.settings.sensitivity, minLenMm: state.settings.minLenMm }, r = state.ref;
      if (r.kind !== 'none' && r.fit && r.fit.ok) opt.ref = { kind: r.kind, mm: refMm(), tap: r.tap };
      else if (r.kind !== 'none' && r.points.length === 2) opt.ref = { kind: r.kind, mm: refMm(), points: r.points };
      state.result = await analyze(imgs, opt, function (f, l) { setProgress(0.08 + 0.92 * f, t(STAGES[l] ? 'pg.' + l : 'pg.busy') + ' ' + Math.round(f * 100) + '%', l === 'done' ? '' : l); });
    } catch (err) { state.result = { ok: false, error: 'exception' }; }
    state.analyzed = true; state.files = state.photos.map(function (p) { return { name: p.file.name || '', lastModified: p.file.lastModified || null, size: p.file.size }; });
    setProgress(1, t('pg.done'), 'done'); busy = false; updateAnalyzeBtn(); renderResult(true);
    setTimeout(function () { $('progress').hidden = true; }, 1200);
    $('resultCard').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  $('btnAnalyze').addEventListener('click', runAnalysis);

  // Two estimators.
  //  provisional (no personal data): total traced length / mean length of the longest 10% of traced pieces.
  //    Scale-free, rough (about +-20-30% on the hand-counted photos we have).
  //  calibrated: sqrt(pieces x total length / Leff), Leff learned from the user's own hand counts.
  //    Needs a reference object so that millimetres mean the same thing from one session to the next.
  function provisional(r) {
    var L = r.hairs.map(function (h) { return h.lengthMm; }).sort(function (a, b) { return b - a; }); if (!L.length) return 0;
    var k = Math.min(L.length, Math.max(3, Math.round(L.length * 0.1))), top = 0; for (var i = 0; i < k; i++) top += L[i]; top /= k;
    return Math.min(r.count, r.totalLengthMm / top);
  }
  function calibrated(r) { return state.calib && state.calib.Leff > 0 && r.scaleFromRef && r.totalLengthMm > 0; }
  function estimate(r) { return calibrated(r) ? Math.sqrt(r.count * r.totalLengthMm / state.calib.Leff) : provisional(r); }
  var REJECT = { blurred: 1, overexposed: 1 };
  var WARN = { 'surface-white': 1, 'surface-black': 1, 'surface-brown': 1, 'pattern': 1, 'glare-remaining': 1, 'align-failed': 1, 'fill-blurred': 1, 'ref-not-found': 1, 'ref-shape': 1, 'no-reference': 1, 'slightly-blurred': 1, 'dense': 1 };
  function addChip(box, text, cls) { box.appendChild(el('span', 'chip' + (cls ? ' ' + cls : ''), text)); }
  function usable() { var r = state.result; return r && r.ok && !(r.reject && r.reject.length); }
  function numHtml(text) { return esc(text) + '<small>' + esc(t('unit')) + '</small>'; }
  function renderResult(fresh) {
    var r = state.result, al = $('rAlerts'), chips = $('rChips'); al.textContent = ''; chips.textContent = '';
    $('resultCard').hidden = !state.analyzed; if (!state.analyzed) return;
    function alert(text, bad) { al.appendChild(el('p', 'alert' + (bad ? ' bad' : ''), text)); }
    function none(msg) { $('rNum').innerHTML = numHtml('—'); $('rPer').textContent = msg; $('rSpread').textContent = ''; $('confirmBox').hidden = true; renderTabs(); drawView(); renderHisto(null); }
    if (!r || !r.ok) { alert(t('res.fail'), true); none(''); return; }
    (r.reject || []).forEach(function (w) { alert(REJECT[w] ? t('rej.' + w) : t('res.unusable'), true); });
    r.warnings.forEach(function (w) { if (WARN[w]) alert(t('warn.' + w)); });
    if (r.fusion.used.some(function (u, i) { return i > 0 && !u; }) && r.warnings.indexOf('align-failed') < 0) alert(t('res.orient'));
    if (!usable()) { none(t('res.none')); return; }
    var est = estimate(r), cal = calibrated(r);
    if (!cal) alert(t(state.calib && !r.scaleFromRef ? 'res.prov.noref' : 'res.prov'));
    $('rNum').innerHTML = numHtml(cal ? String(Math.round(est)) : t('approx', { n: Math.round(est) }));
    $('rPer').innerHTML = tb(cal ? 'res.est.cal' : 'res.est.prov', { n: est.toFixed(1) });
    $('rSpread').innerHTML = tb('res.spread', { a: r.count, b: (r.totalLengthMm / 1000).toFixed(1) });
    if (r.cutCount) addChip(chips, t('chip.cut', { n: r.cutCount }), '');
    var white = r.hairs.filter(function (h) { return h.white; }).length; if (white) addChip(chips, t('chip.white', { n: white }), '');
    if (r.fusion.glarePx > 300) { var pc = Math.round(100 * r.fusion.filledPx / r.fusion.glarePx); addChip(chips, t('chip.glare', { n: pc }), pc >= 90 ? 'ok' : 'warn'); }
    addChip(chips, t('chip.used', { a: r.fusion.used.filter(Boolean).length, b: r.fusion.photos }), '');
    addChip(chips, r.scaleFromRef ? r.pxPerMm.toFixed(2) + ' px/mm' : t('chip.noref'), r.scaleFromRef ? '' : 'warn');
    $('confirmBox').hidden = false;
    if (fresh) { $('inConfirm').value = Math.round(est); $('inMemo').value = ''; $('inVerified').checked = false; setStatus('', ''); }
    $('btnSave').disabled = state.saved; $('btnSave').textContent = t(state.saved ? 'save.done.btn' : 'save.btn');
    renderTabs(); drawView(); renderHisto(r);
  }
  function renderTabs() {
    var tabs = $('tabs'); tabs.textContent = '';
    tabs.appendChild(el('span', 'spacer'));
    var t1 = el('button', 'tab', t(state.showLines ? 'view.orig' : 'view.color')); t1.type = 'button'; t1.disabled = !usable();
    t1.addEventListener('click', function () { state.showLines = !state.showLines; renderTabs(); drawView(); });
    var t2 = el('button', 'tab', t($('cwrap').classList.contains('zoom') ? 'view.unzoom' : 'view.zoom')); t2.type = 'button';
    t2.addEventListener('click', function () { $('cwrap').classList.toggle('zoom'); renderTabs(); });
    tabs.appendChild(t1); tabs.appendChild(t2);
  }
  function drawView() { var r = state.result, cv = $('ov'); cv.hidden = !(r && r.ok); if (r && r.ok) renderOverlay(cv, r, state.showLines && usable(), true); }
  function hairColor(k) { return 'hsl(' + ((k * 137.5) % 360).toFixed(0) + ' 90% 55%)'; }
  function hairBox(r) {
    var W = r.work.width, H = r.work.height, x0 = W, y0 = H, x1 = 0, y1 = 0;
    r.hairs.forEach(function (h) { for (var i = 0; i < h.pts.length; i += 2) { var x = h.pts[i], y = h.pts[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } });
    if (x1 <= x0) return [0, 0, W, H];
    var m = 50; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W, x1 + m); y1 = Math.min(H, y1 + m);
    var minW = W * 0.45; if (x1 - x0 < minW) { var cx = (x0 + x1) / 2; x0 = Math.max(0, cx - minW / 2); x1 = Math.min(W, x0 + minW); x0 = Math.max(0, x1 - minW); }
    return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
  }
  function renderOverlay(cv, r, lines, crop) {
    var W = r.work.width, H = r.work.height, box = crop && lines ? hairBox(r) : [0, 0, W, H];
    cv.width = box[2] - box[0]; cv.height = box[3] - box[1];
    var ctx = cv.getContext('2d'); ctx.putImageData(new ImageData(new Uint8ClampedArray(r.work.rgba.buffer.slice(0)), W, H), -box[0], -box[1]);
    ctx.translate(-box[0], -box[1]); if (!lines) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    r.hairs.forEach(function (h, k) {
      var p = h.pts; if (p.length < 4) return;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (var i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 7; ctx.stroke(); ctx.strokeStyle = hairColor(k); ctx.lineWidth = 4; ctx.stroke();
    });
    if (r.refFit && r.refFit.ok) { ctx.strokeStyle = '#ff2bd0'; ctx.lineWidth = 4; ctx.setLineDash([10, 7]); ctx.beginPath(); if (r.refFit.kind === 'coin') ctx.arc(r.refFit.cx, r.refFit.cy, r.refFit.r, 0, 6.2832); else { var c = r.refFit.corners; ctx.moveTo(c[0][0], c[0][1]); for (var j = 1; j < 4; j++) ctx.lineTo(c[j][0], c[j][1]); ctx.closePath(); } ctx.stroke(); ctx.setLineDash([]); }
  }
  function histogram(r) {
    var L = r.hairs.map(function (h) { return h.lengthMm; }); if (!L.length) return null;
    var mx = Math.max.apply(null, L), mn = Math.min.apply(null, L), w = (mx - mn) / 20 || 1, bins = []; for (var i = 0; i < 20; i++) bins.push(0);
    L.forEach(function (v) { bins[Math.min(19, Math.floor((mx - v) / w))]++; });   // bin 0 = longest
    return { max: +mx.toFixed(1), min: +mn.toFixed(1), width: +w.toFixed(3), bins: bins };
  }
  function renderHisto(r) {
    var svg = $('histo'), h = r ? histogram(r) : null; if (!h) { svg.innerHTML = ''; return; }
    var W = 560, H = 210, L = 8, R = 8, T = 24, B = 52, bw = (W - L - R) / 20, top = Math.max.apply(null, h.bins) || 1, s = '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
    h.bins.forEach(function (n, i) {
      var bh = (H - T - B) * n / top, x = L + i * bw;
      if (n) s += '<rect class="bar" x="' + (x + 2).toFixed(1) + '" y="' + (H - B - bh).toFixed(1) + '" width="' + (bw - 4).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="2"/><text class="cnt" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - B - bh - 5).toFixed(1) + '" text-anchor="middle">' + n + '</text>';
      if (i % 2 === 0) s += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - B + 19) + '" text-anchor="middle">' + Math.round(h.max - (i + 0.5) * h.width) + '</text>';
    });
    s += '<text x="' + L + '" y="' + (H - 8) + '">' + esc(t('histo.long', { n: Math.round(h.max) })) + '</text><text x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">' + esc(t('histo.short', { n: Math.round(h.min) })) + '</text>';
    svg.innerHTML = s;
  }

  // ---------------------------------------------------------------- record + files
  $('btnMinus').addEventListener('click', function () { $('inConfirm').value = Math.max(0, (parseInt($('inConfirm').value, 10) || 0) - 1); });
  $('btnPlus').addEventListener('click', function () { $('inConfirm').value = (parseInt($('inConfirm').value, 10) || 0) + 1; });
  function setStatus(text, cls) { $('saveStatus').textContent = text; $('saveStatus').className = 'status' + (cls ? ' ' + cls : ''); }
  function canvasBlob(cv, q, type) { return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, type || 'image/jpeg', q); }); }
  function mkCanvas(r, lines) { var c = document.createElement('canvas'); renderOverlay(c, r, lines, false); return c; }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length; return !n ? 0 : n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; }
  function sessionRecord() {
    var r = state.result, now = new Date();
    return {
      v: 3, ts: now.getTime(), localDate: now.toLocaleString(loc(), { hour12: false }),
      estimate: +estimate(r).toFixed(1), provisional: !calibrated(r), confirmed: Math.max(0, parseInt($('inConfirm').value, 10) || 0), verified: $('inVerified').checked,
      memo: $('inMemo').value.trim().slice(0, 200),
      paths: r.count, totalLengthMm: Math.round(r.totalLengthMm), cutCount: r.cutCount, whitePaths: r.hairs.filter(function (x) { return x.white; }).length,
      lengthsMm: r.hairs.map(function (x) { return Math.round(x.lengthMm); }).sort(function (a, b) { return b - a; }).slice(0, 400), hist: histogram(r),
      pxPerMm: +r.pxPerMm.toFixed(3), scaleFromRef: !!r.scaleFromRef, reference: r.scaleFromRef ? refLabel() : t('ref.none'),
      surface: r.surface.kind, sharpness: +r.sharpness.toFixed(2), photos: r.fusion.photos, photosUsed: r.fusion.used.filter(Boolean).length,
      warnings: r.warnings, files: state.files || [], app: 'HairLossCounter ' + (window.HLC ? HLC.version : '')
    };
  }
  function persistRecords() {
    if (lsSet(K_REC, state.records)) return true;
    // out of room on this device: every record keeps its numbers, the older ones give up their list of single hair lengths
    var slim = false; sorted().slice(200).forEach(function (r) { if (r.lengthsMm && r.lengthsMm.length) { r.lengthsMm = []; slim = true; } });
    if (slim && lsSet(K_REC, state.records)) { storageOk = true; return true; }
    return false;
  }
  $('btnSave').addEventListener('click', function () {
    if (!usable() || state.saved) return;
    var rec = sessionRecord(); state.records.unshift(rec);
    if (!persistRecords()) { state.records.shift(); setStatus(t('save.fail'), 'err'); return; }
    var msg = t('save.ok', { n: rec.confirmed });
    if (rec.verified) {
      if (rec.scaleFromRef && rec.confirmed > 0 && rec.paths > 0) {
        var c = state.calib ? JSON.parse(JSON.stringify(state.calib)) : { samples: [] };
        c.samples = (c.samples || []).concat([{ ts: rec.ts, Leff: +(rec.paths * rec.totalLengthMm / (rec.confirmed * rec.confirmed)).toFixed(1), n: rec.confirmed }]).slice(-20);
        c.Leff = median(c.samples.map(function (x) { return x.Leff; })); c.engine = CAL_ENGINE; state.calib = c; lsSet(K_CAL, c); msg += t('save.calib');
      } else msg += t('save.calib.no');
    }
    state.saved = true; requestPersist();
    var since = state.records.length - (lsGet(K_BAK, 0) || 0);
    if (since >= 10) msg += t('save.backup', { n: state.records.length });
    setStatus(msg, 'ok'); renderCalib(); renderHistory(); renderResult(false);
  });
  $('btnImg').addEventListener('click', async function () { if (!usable()) return; saveBlob(await canvasBlob(mkCanvas(state.result, true), 0.9), 'HairLossCounter_' + stamp(new Date()) + '.jpg'); setStatus(t('img.saved'), 'ok'); });
  $('btnZip').addEventListener('click', async function () {
    if (!usable()) return;
    var rec = sessionRecord(), enc = new TextEncoder(), files = [], h = rec.hist;
    files.push({ name: t('zip.f1') + '.jpg', data: new Uint8Array(await (await canvasBlob(mkCanvas(state.result, true), 0.88)).arrayBuffer()) });
    files.push({ name: t('zip.f2') + '.jpg', data: new Uint8Array(await (await canvasBlob(mkCanvas(state.result, false), 0.92)).arrayBuffer()) });
    var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
    var csv = '\ufeff' + t('csv.head') + '\n' + [q(rec.localDate), rec.estimate, rec.confirmed, rec.paths, rec.totalLengthMm, rec.cutCount, q(rec.reference), q(rec.memo)].join(',') + '\n\n' + t('csv.head2') + '\n' +
      (h ? h.bins.map(function (n, i) { return [i + 1, (h.max - (i + 1) * h.width).toFixed(1), (h.max - i * h.width).toFixed(1), n].join(','); }).join('\n') : '') + '\n';
    files.push({ name: 'summary.csv', data: enc.encode(csv) }); files.push({ name: 'summary.json', data: enc.encode(JSON.stringify(rec, null, 1)) });
    saveBlob(zipStore(files), 'HairLossCounter_' + stamp(new Date()) + '.zip'); setStatus(t('zip.saved'), 'ok');
  });
  var CRC = (function () { var tb2 = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tb2[n] = c >>> 0; } return tb2; })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0, now = new Date();
    var dtime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), ddate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length, lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(10, dtime, true); lh.setUint16(12, ddate, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(12, dtime, true); ch.setUint16(14, ddate, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name); offset += 30 + name.length + size;
    });
    var cd = central.reduce(function (a, b) { return a + b.length; }, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cd, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  // ---------------------------------------------------------------- history
  // However many records there are, the list stays short: one line per month (and per year once there is more than
  // one year). Only the newest month is open; the others open with a tap. The graph averages by day, week, month or
  // year when there are too many points to draw one by one.
  var openId = null, openMonth = {}, openYear = {}, trendRange = 'recent';
  function hstatus(text, cls) { $('histStatus').textContent = text; $('histStatus').className = 'status' + (cls ? ' ' + cls : ''); }
  function sorted() { return state.records.slice().sort(function (a, b) { return b.ts - a.ts; }); }
  function countOf(r) { return r.confirmed; }
  function groupRow(cls, name, recs, frac, open, onClick) {
    var b = el('button', cls); b.type = 'button'; b.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.appendChild(el('span', 'hm-name', name));
    b.appendChild(el('span', 'hm-sum', t('h.month.sum', { n: recs.length, avg: Math.round(mean(recs.map(countOf))) })));
    var g = el('span', 'hm-tog', open ? '－' : '＋'); g.setAttribute('aria-hidden', 'true'); b.appendChild(g);
    if (frac != null) { var bar = el('span', 'hm-bar'), i = document.createElement('i'); i.style.width = Math.max(2, Math.round(frac * 100)) + '%'; bar.appendChild(i); b.appendChild(bar); }
    b.addEventListener('click', onClick); return b;
  }
  function recordRow(rec) {
    var li = document.createElement('li'), b = el('button', 'hrow'), d = new Date(rec.ts), open = openId === rec.ts; b.type = 'button';
    var dd = el('span', 'd', d.toLocaleDateString(loc(), { month: 'numeric', day: 'numeric', weekday: 'short' }) + ' ' + d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }));
    dd.appendChild(el('small', '', t(rec.provisional ? 'h.prov' : 'h.est', { n: rec.estimate }) + (rec.verified ? sep() + t('h.verified') : '') + (rec.memo ? sep() + rec.memo : '')));
    var nn = el('span', 'n', String(rec.confirmed)); nn.appendChild(el('small', '', t('unit')));
    var tg = el('span', 't', open ? '－' : '＋'); tg.setAttribute('aria-hidden', 'true');
    b.appendChild(dd); b.appendChild(nn); b.appendChild(tg); b.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.addEventListener('click', function () { openId = open ? null : rec.ts; renderHistory(); });
    li.appendChild(b); if (open) li.appendChild(historyDetail(rec)); return li;
  }
  function renderHistory() {
    var list = sorted(), box = $('hist'); box.textContent = ''; $('histEmpty').hidden = list.length > 0; $('vCount').textContent = t('n.items', { n: list.length });
    $('hSum').hidden = !list.length;
    if (list.length) {
      $('sLatest').textContent = list[0].confirmed; $('sLatestDate').textContent = new Date(list[0].ts).toLocaleDateString(loc(), { month: 'numeric', day: 'numeric' });
      $('sAvg').textContent = Math.round(mean(list.slice(0, 7).map(countOf))); $('sTotal').textContent = list.length;
    }
    var years = [], yi = {}, top = 1;
    list.forEach(function (rec) {
      var d = new Date(rec.ts), y = d.getFullYear(), m = d.getMonth(), Y = yi[y];
      if (!Y) { Y = yi[y] = { y: y, months: [], mi: {}, recs: [] }; years.push(Y); }
      var M = Y.mi[m]; if (!M) { M = Y.mi[m] = { key: y + '-' + m, y: y, m: m, recs: [] }; Y.months.push(M); }
      M.recs.push(rec); Y.recs.push(rec);
    });
    years.forEach(function (Y) { Y.months.forEach(function (M) { M.avg = mean(M.recs.map(countOf)); if (M.avg > top) top = M.avg; }); });
    var multi = years.length > 1;
    years.forEach(function (Y, yk) {
      var yOpen = !multi || (openYear[Y.y] != null ? openYear[Y.y] : yk === 0), wrap = el('div', 'hy');
      if (multi) wrap.appendChild(groupRow('hyrow', new Date(Y.y, 0, 1).toLocaleDateString(loc(), { year: 'numeric' }), Y.recs, null, yOpen, function () { openYear[Y.y] = !yOpen; renderHistory(); }));
      if (yOpen) Y.months.forEach(function (M, mk) {
        var mOpen = openMonth[M.key] != null ? openMonth[M.key] : (yk === 0 && mk === 0), mw = el('div', 'hm');
        var name = new Date(M.y, M.m, 1).toLocaleDateString(loc(), multi ? { month: 'long' } : { year: 'numeric', month: 'long' });
        mw.appendChild(groupRow('hmrow', name, M.recs, M.avg / top, mOpen, function () { openMonth[M.key] = !mOpen; renderHistory(); }));
        if (mOpen) { var ul = el('ul', 'hist-list'); M.recs.forEach(function (rec) { ul.appendChild(recordRow(rec)); }); mw.appendChild(ul); }
        wrap.appendChild(mw);
      });
      box.appendChild(wrap);
    });
    renderTrend();
  }
  function historyDetail(rec) {
    var box = el('div', 'hdetail');
    box.appendChild(el('p', 'hint', t('h.detail', { paths: rec.paths, len: (rec.totalLengthMm / 1000).toFixed(1), cut: rec.cutCount, ref: rec.reference, used: rec.photosUsed, photos: rec.photos })));
    if (rec.files && rec.files.length) { var ul = el('ul', 'files'); rec.files.forEach(function (f) { ul.appendChild(el('li', '', f.name || t('h.noname'))); }); box.appendChild(ul); }
    var del = el('button', 'btn small danger', t('h.del')); del.type = 'button';
    var armed = false, timer = null;
    del.addEventListener('click', function () {
      if (!armed) { armed = true; del.textContent = t('h.del2'); timer = setTimeout(function () { armed = false; del.textContent = t('h.del'); }, 4000); return; }
      clearTimeout(timer); state.records = state.records.filter(function (r) { return r !== rec; }); persistRecords(); renderHistory();
    });
    box.appendChild(del); return box;
  }
  var DAY = 864e5, LEVELS = ['each', 'day', 'week', 'month', 'year'];
  function bucketKey(ts, level) {
    var d = new Date(ts);
    if (level === 'each') return String(ts);
    if (level === 'year') return String(d.getFullYear());
    if (level === 'month') return d.getFullYear() + '-' + d.getMonth();
    if (level === 'week') return 'w' + new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();   // weeks start on Monday
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }
  function recentPoints() { return sorted().slice(0, 30).reverse(); }
  function trendSeries() {
    var recs = sorted().reverse(), now = Date.now(), li = 0, pts;
    if (trendRange === '3m') recs = recs.filter(function (r) { return r.ts >= now - 92 * DAY; });
    else if (trendRange === '1y') recs = recs.filter(function (r) { return r.ts >= now - 366 * DAY; });
    else if (trendRange !== 'all') recs = recs.slice(-30);
    for (;;) {
      var map = {}, order = [];
      recs.forEach(function (r) { var k = bucketKey(r.ts, LEVELS[li]), b = map[k]; if (!b) { b = map[k] = { ts: r.ts, sum: 0, n: 0 }; order.push(b); } b.sum += r.confirmed; b.n++; });
      pts = order.map(function (b) { return { ts: b.ts, v: b.sum / b.n }; });
      if (pts.length <= 36 || li >= LEVELS.length - 1) break;
      li++;
    }
    return { pts: pts, level: LEVELS[li] };
  }
  function renderTrend() {
    var svg = $('trend'), seg = $('trendRange'), note = $('trendNote'), many = state.records.length > 30;
    seg.hidden = !many; seg.textContent = ''; if (!many) trendRange = 'recent';
    if (many) [['recent', 'tr.recent'], ['3m', 'tr.3m'], ['1y', 'tr.1y'], ['all', 'tr.all']].forEach(function (o) {
      var b = el('button', '', t(o[1])); b.type = 'button'; b.dataset.range = o[0]; b.setAttribute('aria-pressed', trendRange === o[0] ? 'true' : 'false');
      b.addEventListener('click', function () { trendRange = o[0]; renderTrend(); }); seg.appendChild(b);
    });
    var sr = trendSeries(), pts = sr.pts;
    if (pts.length < 2) { svg.setAttribute('hidden', ''); note.hidden = true; return; } svg.removeAttribute('hidden');   // an <svg> has no .hidden property
    note.hidden = !many; note.textContent = t('tr.note.' + sr.level);
    var W = 560, H = 196, L = 48, R = 16, T = 16, B = 38, vals = pts.map(function (p) { return p.v; });
    var top = Math.max(5, Math.ceil(Math.max.apply(null, vals) * 1.15 / 5) * 5), bot = Math.max(0, Math.floor(Math.min.apply(null, vals) * 0.8 / 5) * 5); if (top === bot) top = bot + 5;
    var x = function (i) { return L + (W - L - R) * i / (pts.length - 1); }, y = function (v) { return T + (H - T - B) * (1 - (v - bot) / (top - bot)); }, s = '';
    [bot, (bot + top) / 2, top].forEach(function (v) { s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L - 8) + '" y="' + (y(v) + 6) + '" text-anchor="end">' + Math.round(v) + '</text>'; });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1); }).join(' ');
    s += '<path class="area" d="' + line + ' L' + x(pts.length - 1).toFixed(1) + ' ' + y(bot) + ' L' + x(0).toFixed(1) + ' ' + y(bot) + ' Z"/><path class="lineP" d="' + line + '"/>';
    var rad = pts.length > 24 ? 3 : 4;
    pts.forEach(function (p, i) { var last = i === pts.length - 1; s += '<circle class="pt' + (last ? ' last' : '') + '" cx="' + x(i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="' + (last ? 6 : rad) + '"/>'; });
    var fmt = function (ts) { var d = new Date(ts); return sr.level === 'year' ? String(d.getFullYear()) : sr.level === 'month' ? d.getFullYear() + '/' + (d.getMonth() + 1) : (d.getMonth() + 1) + '/' + d.getDate(); };
    s += '<text x="' + L + '" y="' + (H - 10) + '">' + fmt(pts[0].ts) + '</text><text x="' + (W - R) + '" y="' + (H - 10) + '" text-anchor="end">' + esc(fmt(pts[pts.length - 1].ts) + sep() + t('tr.latest', { n: Math.round(vals[vals.length - 1]) })) + '</text>';
    svg.innerHTML = s;
  }
  $('btnExport').addEventListener('click', function () {
    if (!state.records.length) { hstatus(t('exp.none'), ''); return; }
    var data = { app: 'HairLossCounter', format: 1, exportedAt: new Date().toISOString(), records: state.records, calib: state.calib };
    saveBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'HairLossCounter_records_' + stamp(new Date()) + '.json');
    lsSet(K_BAK, state.records.length); hstatus(t('exp.done', { n: state.records.length }), 'ok');
  });
  $('inImport').addEventListener('change', async function (e) {
    var f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      var data = JSON.parse(await f.text());
      if (!data || data.app !== 'HairLossCounter' || !Array.isArray(data.records)) throw new Error('format');
      var have = {}, added = 0; state.records.forEach(function (r) { have[r.ts] = 1; });
      data.records.forEach(function (r) { if (r && typeof r.ts === 'number' && typeof r.confirmed === 'number' && !have[r.ts]) { state.records.push(r); have[r.ts] = 1; added++; } });
      state.records.sort(function (a, b) { return b.ts - a.ts; });
      if (!state.calib && data.calib && data.calib.Leff > 0) { state.calib = migrateCalib(data.calib); lsSet(K_CAL, state.calib); }
      if (!persistRecords()) throw new Error('storage');
      renderHistory(); renderCalib(); hstatus(t('imp.done', { n: added }), 'ok');
    } catch (err) { hstatus(t(err && err.message === 'storage' ? 'imp.storage' : 'imp.bad'), 'err'); }
  });

  // share card: numbers and trend only, never a photo
  function drawShare() {
    var cv = $('shareCv'), c = cv.getContext('2d'), W = 1080, pts = recentPoints(), last = sorted()[0];
    var F = '"Hiragino Sans","Noto Sans JP","Noto Sans CJK JP",system-ui,sans-serif', SF = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Noto Serif",Georgia,serif', NF = '"Didot","Bodoni 72","Noto Serif",Georgia,serif';
    var g = c.createLinearGradient(0, 0, W, W); g.addColorStop(0, '#fcfaf5'); g.addColorStop(0.55, '#f5f1e8'); g.addColorStop(1, '#ebe4d4'); c.fillStyle = g; c.fillRect(0, 0, W, W);
    c.strokeStyle = '#b3935a'; c.lineWidth = 3; c.strokeRect(34, 34, W - 68, W - 68); c.lineWidth = 1; c.strokeRect(48, 48, W - 96, W - 96);
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    c.fillStyle = '#15302f'; c.font = '600 46px ' + SF; c.fillText(t('share.title'), 100, 172, W - 200);
    var d = new Date(last.ts); c.fillStyle = '#5a6866'; c.font = '400 34px ' + F; c.fillText(d.toLocaleDateString(loc(), { year: 'numeric', month: 'long', day: 'numeric' }), 100, 226, W - 200);
    c.fillStyle = '#15302f'; c.font = '400 300px ' + NF; var num = String(last.confirmed); c.fillText(num, 92, 510);
    var nw = c.measureText(num).width; c.fillStyle = '#a07c33'; c.font = '500 72px ' + SF; c.fillText(t('unit'), 116 + nw, 510, W - 216 - nw);
    var x0 = 100, x1 = W - 100, y0 = 600, y1 = 860;
    if (pts.length >= 2) {
      var vals = pts.map(function (r) { return r.confirmed; }), top = Math.max.apply(null, vals) * 1.15 || 1, bot = Math.min.apply(null, vals) * 0.8;
      var X = function (i) { return x0 + (x1 - x0) * i / (pts.length - 1); }, Y = function (v) { return y1 - (y1 - y0) * (v - bot) / (top - bot || 1); };
      c.beginPath(); pts.forEach(function (r, i) { if (i) c.lineTo(X(i), Y(r.confirmed)); else c.moveTo(X(i), Y(r.confirmed)); });
      c.lineTo(x1, y1); c.lineTo(x0, y1); c.closePath(); c.fillStyle = 'rgba(15,111,107,0.13)'; c.fill();
      c.beginPath(); pts.forEach(function (r, i) { if (i) c.lineTo(X(i), Y(r.confirmed)); else c.moveTo(X(i), Y(r.confirmed)); }); c.strokeStyle = '#0f6f6b'; c.lineWidth = 7; c.lineJoin = 'round'; c.stroke();
      c.fillStyle = '#a07c33'; c.beginPath(); c.arc(X(pts.length - 1), Y(vals[vals.length - 1]), 15, 0, 6.2832); c.fill();
      c.fillStyle = '#5a6866'; c.font = '400 32px ' + F; c.fillText(t('share.trend', { n: pts.length, avg: Math.round(mean(vals)) }), x0, y1 + 56, x1 - x0);
    } else { c.fillStyle = '#5a6866'; c.font = '400 34px ' + F; c.fillText(t('share.few'), x0, 740, x1 - x0); }
    c.fillStyle = '#15302f'; c.font = '700 38px ' + NF; c.fillText(APP, 100, 996);
    var bw = c.measureText(APP).width; c.fillStyle = '#5a6866'; c.font = '400 26px ' + F; c.textAlign = 'right'; c.fillText(t('foot'), W - 100, 996, W - 240 - bw); c.textAlign = 'left';
  }
  async function shareFile() { var b = await canvasBlob($('shareCv'), undefined, 'image/png'); return new File([b], 'HairLossCounter_' + stamp(new Date()) + '.png', { type: 'image/png' }); }
  $('btnShare').addEventListener('click', function () {
    if (!state.records.length) { hstatus(t('share.need'), ''); return; }
    drawShare(); $('shareBox').hidden = false;
    var can = false; try { can = !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'x.png', { type: 'image/png' })] })); } catch (e) { can = false; }
    $('btnShareSend').hidden = !can;
  });
  $('btnShareSave').addEventListener('click', async function () { var f = await shareFile(); saveBlob(f, f.name); hstatus(t('share.saved'), 'ok'); });
  $('btnShareSend').addEventListener('click', async function () { try { await navigator.share({ files: [await shareFile()] }); } catch (e) { /* cancelled */ } });

  // ---------------------------------------------------------------- proof of no outside traffic (shown under "About")
  var net = { ext: 0, own: 0, blocked: 0 }, pstate = { offline: 'checking', persist: 'checking' };
  function renderProof() {
    $('pExt').textContent = t('n.items', { n: net.ext }); $('pExt').className = net.ext ? 'nz' : 'zero';
    $('pBlocked').textContent = t('n.items', { n: net.blocked }); $('pBlocked').className = net.blocked ? 'nz' : 'zero';
    $('pOwn').textContent = t('n.items', { n: net.own });
    $('pOffline').textContent = t('pf.' + pstate.offline); $('pOffline').dataset.state = pstate.offline;
    $('pPersist').textContent = t(pstate.persist === 'checking' ? 'pf.checking' : 'pf.p.' + pstate.persist); $('pPersist').dataset.state = pstate.persist;
  }
  function countEntries(list) { list.forEach(function (en) { var u; try { u = new URL(en.name, location.href); } catch (e) { return; } if (u.protocol !== 'http:' && u.protocol !== 'https:') return; if (u.origin === location.origin) net.own++; else net.ext++; }); renderProof(); }
  try { countEntries(performance.getEntriesByType('resource')); new PerformanceObserver(function (l) { countEntries(l.getEntries()); }).observe({ type: 'resource', buffered: false }); } catch (e) { /* not supported */ }
  document.addEventListener('securitypolicyviolation', function () { net.blocked++; renderProof(); });
  function requestPersist() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(showPersist, function () {}); } catch (e) { /* ignore */ } }
  function showPersist(ok) { pstate.persist = !storageOk ? 'na' : ok ? 'strong' : 'normal'; renderProof(); }
  try { if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(showPersist, function () { showPersist(false); }); else showPersist(false); } catch (e) { showPersist(false); }
  function showOffline(ok) { pstate.offline = ok ? 'yes' : 'no'; renderProof(); }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').then(function () { return navigator.serviceWorker.ready; }).then(function () { showOffline(true); }, function () { showOffline(false); });
  } else showOffline(false);
  if (SOURCE_URL) { var a = document.createElement('a'); a.href = SOURCE_URL; a.rel = 'noopener noreferrer'; a.textContent = SOURCE_URL; $('srcLink').appendChild(a); $('srcRow').hidden = false; }
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  $('iosHint').hidden = !(ios && !standalone);

  // ---------------------------------------------------------------- settings
  function syncSettings() { $('inSens').value = state.settings.sensitivity; $('vSens').textContent = Number(state.settings.sensitivity).toFixed(1); $('inMinLen').value = state.settings.minLenMm; $('vMinLen').textContent = state.settings.minLenMm + ' mm'; }
  $('inSens').addEventListener('input', function (e) { state.settings.sensitivity = +e.target.value; syncSettings(); saveSettings(); });
  $('inMinLen').addEventListener('input', function (e) { state.settings.minLenMm = +e.target.value; syncSettings(); saveSettings(); });
  function renderCalib() { var c = state.calib; $('vCalib').textContent = c && c.Leff > 0 ? t('set.calib.on', { n: c.samples ? c.samples.length : 1 }) : t('set.calib.off'); $('btnCalibReset').hidden = !(c && c.Leff > 0); }
  var armedBtns = [];
  function armed2(btn, key, armKey, fn) {   // destructive buttons ask for a second press
    var a = { btn: btn, key: key, on: false }; armedBtns.push(a);
    btn.addEventListener('click', function () { if (!a.on) { a.on = true; btn.textContent = t(armKey); setTimeout(function () { a.on = false; btn.textContent = t(key); }, 4000); return; } a.on = false; btn.textContent = t(key); fn(); });
  }
  armed2($('btnCalibReset'), 'set.calib.reset', 'set.arm', function () { state.calib = null; try { localStorage.removeItem(K_CAL); } catch (e) { /* ignore */ } renderCalib(); if (state.analyzed) renderResult(false); });
  armed2($('btnWipe'), 'set.wipe', 'set.wipe2', function () {
    try { [K_REC, K_CAL, K_SET, K_BAK].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* ignore */ }
    state.records = []; state.calib = null; renderHistory(); renderCalib(); $('shareBox').hidden = true; hstatus(t('set.wiped'), 'ok'); if (state.analyzed) renderResult(false);
  });

  // ---------------------------------------------------------------- language switch
  function renderLangs() {
    var box = $('langs'); box.textContent = '';
    I18N.order.forEach(function (l) {
      var b = el('button', '', I18N.names[l]); b.type = 'button'; b.lang = l; b.dataset.lang = l; b.setAttribute('aria-pressed', l === lang ? 'true' : 'false');
      b.addEventListener('click', function () { setLang(l); }); box.appendChild(b);
    });
  }
  function renderAll() {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang;
    each('[data-i18n]', function (e) { e.textContent = t(e.getAttribute('data-i18n')); });
    each('[data-i18n-aria]', function (e) { e.setAttribute('aria-label', t(e.getAttribute('data-i18n-aria'))); });
    each('[data-i18n-ph]', function (e) { e.setAttribute('placeholder', t(e.getAttribute('data-i18n-ph'))); });
    armedBtns.forEach(function (a) { a.on = false; a.btn.textContent = t(a.key); });
    $('btnSave').textContent = t(state.saved ? 'save.done.btn' : 'save.btn');
    renderLangs(); renderCamMode(); syncSettings(); renderCalib(); renderThumbs(); renderRefControls(); renderHistory(); renderProof();
    if (state.analyzed) renderResult(false);
    if (cam.stream) camInfo();
    if (!$('shareBox').hidden && state.records.length) drawShare();
  }
  function setLang(l) {   // chosen with the buttons at the bottom of the page
    if (!I18N.text[l]) return;
    lang = l; langByUser = true; try { localStorage.setItem(K_LANG, l); } catch (e) { /* shown anyway, just not remembered */ }
    if (!state.settings.countryManual) { var c = currencyFor(l, true); if (c !== state.ref.country) { state.ref.country = c; state.ref.coin = DEF_COIN[c]; saveSettings(); refit(); } }
    renderAll();
  }

  // ---------------------------------------------------------------- background
  // The marble and the two reliefs move by different amounts as the page scrolls. Nothing moves when the system asks
  // for reduced motion.
  var bg = [$('bg0'), $('bg1'), $('bg2')], still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches), raf = 0;
  function unit(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function parallax() {
    raf = 0; if (still) return;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0, vh = window.innerHeight || 800, room = Math.max(1, document.documentElement.scrollHeight - vh);
    bg[0].style.transform = 'translate3d(0,' + (-unit(y / room) * vh * 0.22).toFixed(1) + 'px,0)';
    bg[1].style.transform = 'translate3d(0,' + (-y * 0.32).toFixed(1) + 'px,0)';
    bg[1].style.opacity = (1 - unit((y - vh * 0.5) / (vh * 1.1))).toFixed(3);
    bg[2].style.transform = 'translate3d(0,' + (vh * 0.5 - Math.min(y, vh * 2.8) * 0.25).toFixed(1) + 'px,0)';
    bg[2].style.opacity = unit((y - vh * 0.25) / (vh * 0.9)).toFixed(3);
  }
  function onScroll() { if (!raf) raf = requestAnimationFrame(parallax); }
  window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll, { passive: true });

  // ---------------------------------------------------------------- start
  renderAll(); parallax();
})();

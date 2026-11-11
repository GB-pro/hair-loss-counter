(function () {
  'use strict';
  var SOURCE_URL = 'https://github.com/GB-pro/hair-loss-counter';      // set to the public repository URL when the source is published
  var MAX_SIDE = 2600, MAX_PHOTOS = 5;
  var K_REC = 'hlc.records.v3', K_CAL = 'hlc.calib.v3', K_SET = 'hlc.settings.v3', K_BAK = 'hlc.lastBackupCount';
  var $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------------- reference objects
  // Diameters in mm. poly: not a true circle (flat-to-flat or constant-width shape) -> a little less exact.
  var G = '#c9a227', S = '#b9bcc2', C = '#b0703a', A = '#d7d9dc';
  var COINS = {
    JPY: { name: '日本 円', coins: [['1円', 20.0, A], ['5円', 22.0, G, { hole: 5 }], ['10円', 23.5, C], ['50円', 21.0, S, { hole: 4 }], ['100円', 22.6, S], ['500円', 26.5, G, { ring: S }]] },
    USD: { name: 'アメリカ ドル', coins: [['1¢', 19.05, C], ['5¢', 21.21, S], ['10¢', 17.91, S], ['25¢', 24.26, S], ['50¢', 30.61, S], ['$1', 26.49, G]] },
    EUR: { name: 'ユーロ', coins: [['1c', 16.25, C], ['2c', 18.75, C], ['5c', 21.25, C], ['10c', 19.75, G], ['20c', 22.25, G], ['50c', 24.25, G], ['€1', 23.25, S, { ring: G }], ['€2', 25.75, G, { ring: S }]] },
    GBP: { name: 'イギリス ポンド', coins: [['1p', 20.3, C], ['2p', 25.9, C], ['5p', 18.0, S], ['10p', 24.5, S], ['20p', 21.4, S, { poly: 7 }], ['50p', 27.3, S, { poly: 7 }], ['£1', 23.23, S, { ring: G, poly: 12 }], ['£2', 28.4, S, { ring: G }]] },
    CNY: { name: '中国 人民元', coins: [['1角', 19.0, S], ['5角', 20.5, G], ['1元 新', 22.25, S], ['1元 旧', 25.0, S]] },
    KRW: { name: '韓国 ウォン', coins: [['10', 18.0, C], ['50', 21.6, S], ['100', 24.0, S], ['500', 26.5, S]] },
    CAD: { name: 'カナダ ドル', coins: [['5¢', 21.2, S], ['10¢', 18.03, S], ['25¢', 23.88, S], ['$1', 26.5, G, { poly: 11 }], ['$2', 28.0, G, { ring: S }]] },
    AUD: { name: 'オーストラリア ドル', coins: [['5c', 19.41, S], ['10c', 23.6, S], ['20c', 28.65, S], ['50c', 31.65, S, { poly: 12 }], ['$1', 25.0, G], ['$2', 20.5, G]] },
    CHF: { name: 'スイス フラン', coins: [['5Rp', 17.15, G], ['10Rp', 19.15, S], ['20Rp', 21.05, S], ['½Fr', 18.2, S], ['1Fr', 23.2, S], ['2Fr', 27.4, S], ['5Fr', 31.45, S]] }
  };
  var CARD = { w: 85.6, h: 53.98 };
  function coinSvg(c, size) {
    var mm = c[1], o = c[3] || {}, r = mm / 32 * (size / 2 - 1), cx = size / 2, s = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">';
    var shape;
    if (o.poly) { var pts = []; for (var i = 0; i < o.poly; i++) { var a = (i / o.poly) * 2 * Math.PI - Math.PI / 2; pts.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cx + r * Math.sin(a)).toFixed(1)); } shape = function (rr, fill) { return '<polygon points="' + pts.join(' ') + '" fill="' + fill + '" stroke="rgba(0,0,0,.35)" stroke-linejoin="round" stroke-width="' + (o.poly === 7 ? 3 : 1) + '"/>'; }; s += shape(r, o.ring || c[2]); }
    else s += '<circle cx="' + cx + '" cy="' + cx + '" r="' + r.toFixed(1) + '" fill="' + (o.ring || c[2]) + '" stroke="rgba(0,0,0,.35)"/>';
    if (o.ring) s += '<circle cx="' + cx + '" cy="' + cx + '" r="' + (r * 0.68).toFixed(1) + '" fill="' + c[2] + '" stroke="rgba(0,0,0,.2)"/>';
    else s += '<circle cx="' + cx + '" cy="' + cx + '" r="' + (r * 0.86).toFixed(1) + '" fill="none" stroke="rgba(0,0,0,.18)"/>';
    if (o.hole) s += '<circle cx="' + cx + '" cy="' + cx + '" r="' + (o.hole / 32 * (size / 2 - 1)).toFixed(1) + '" fill="var(--surface)" stroke="rgba(0,0,0,.35)"/>';
    return s + '</svg>';
  }

  // ---------------------------------------------------------------- state
  var state = {
    photos: [], work1: null,
    ref: { kind: 'coin', country: 'JPY', coin: 5, tap: null, points: [], manual: false, fit: null },
    result: null, analyzed: false, showLines: true, saved: false,
    records: [], calib: null, license: null,    // license: reserved for a future paid tier; nothing reads it yet
    settings: { sensitivity: 1.0, minLenMm: 10, country: 'JPY', coin: 5, kind: 'coin' }
  };
  var storageOk = true;
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { storageOk = false; return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { storageOk = false; return false; } }
  var sv = lsGet(K_SET, null); if (sv) for (var k0 in sv) state.settings[k0] = sv[k0];
  state.ref.kind = state.settings.kind; state.ref.country = COINS[state.settings.country] ? state.settings.country : 'JPY';
  state.ref.coin = Math.min(state.settings.coin, COINS[state.ref.country].coins.length - 1);
  state.records = lsGet(K_REC, []); if (!Array.isArray(state.records)) state.records = [];
  state.calib = lsGet(K_CAL, null);
  $('ver').textContent = 'v' + (window.HLC ? HLC.version : '');
  function saveSettings() { state.settings.kind = state.ref.kind; state.settings.country = state.ref.country; state.settings.coin = state.ref.coin; lsSet(K_SET, state.settings); }
  function saveBlob(blob, name) { var a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 30000); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()); }

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
  function dataUrlToBlob(du) { var p = du.split(','), bin = atob(p[1]), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: 'image/jpeg' }); }

  // ---------------------------------------------------------------- capture
  var seq = 0, busy = false;
  function addFiles(list, isSample) {
    Array.prototype.slice.call(list || []).forEach(function (f) {
      if (f.type && f.type.indexOf('image/') !== 0) return;
      if (state.photos.length >= MAX_PHOTOS) return;
      state.photos.push({ id: ++seq, file: f, url: URL.createObjectURL(f) });
    });
    state.analyzed = false; renderThumbs(); ensureWork1();
  }
  ['inCamera', 'inPick', 'inPick2'].forEach(function (id) { $(id).addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; }); });
  function removePhoto(id) {
    var first = state.photos[0] && state.photos[0].id === id;
    state.photos = state.photos.filter(function (p) { if (p.id === id) { URL.revokeObjectURL(p.url); return false; } return true; });
    if (first) { state.work1 = null; resetRef(); }
    renderThumbs(); ensureWork1();
  }
  function renderThumbs() {
    var box = $('thumbs'); box.textContent = '';
    state.photos.forEach(function (p, i) {
      var d = document.createElement('div'); d.className = 'thumb';
      var im = document.createElement('img'); im.src = p.url; im.alt = (i + 1) + '枚目'; d.appendChild(im);
      var b = document.createElement('span'); b.className = 'badge'; b.textContent = i === 0 ? '1 基準' : String(i + 1); d.appendChild(b);
      var x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', (i + 1) + '枚目を外す');
      x.addEventListener('click', function () { removePhoto(p.id); }); d.appendChild(x);
      box.appendChild(d);
    });
    Array.prototype.forEach.call($('slots').children, function (el, i) { el.classList.toggle('done', i < state.photos.length); });
    updateAnalyzeBtn();
  }
  function updateAnalyzeBtn() {
    var n = state.photos.length, needRef = state.ref.kind !== 'none' && !refReady();
    $('btnAnalyze').disabled = n === 0 || busy || !state.work1;
    $('btnAnalyze').textContent = !n ? '解析する' : needRef ? '比較物なしで解析する（' + n + '枚）' : '解析する（' + n + '枚）';
  }

  // ---------------------------------------------------------------- reference picking
  function refMm() { return state.ref.kind === 'card' ? CARD.w : COINS[state.ref.country].coins[state.ref.coin][1]; }
  function refLabel() { return state.ref.kind === 'card' ? 'カード 85.6×54.0mm' : state.ref.kind === 'none' ? 'なし' : COINS[state.ref.country].name + ' ' + COINS[state.ref.country].coins[state.ref.coin][0] + '（' + refMm() + 'mm）'; }
  function refReady() { return (state.ref.fit && state.ref.fit.ok) || state.ref.points.length === 2; }
  function resetRef() { state.ref.tap = null; state.ref.points = []; state.ref.fit = null; }
  function renderRefControls() {
    $('selKind').value = state.ref.kind;
    var sc = $('selCountry'); if (!sc.options.length) Object.keys(COINS).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = COINS[k].name; sc.appendChild(o); });
    sc.value = state.ref.country;
    $('fCountry').hidden = state.ref.kind !== 'coin';
    var box = $('coins'); box.textContent = ''; box.hidden = state.ref.kind !== 'coin';
    if (state.ref.kind === 'coin') COINS[state.ref.country].coins.forEach(function (c, i) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'coin'; b.setAttribute('aria-pressed', i === state.ref.coin ? 'true' : 'false');
      b.innerHTML = coinSvg(c, 44) + '<span></span><small></small>'; b.querySelector('span').textContent = c[0]; b.querySelector('small').textContent = c[1] + 'mm';
      b.addEventListener('click', function () { state.ref.coin = i; saveSettings(); refit(); renderRefControls(); });
      box.appendChild(b);
    });
    var show = state.ref.kind !== 'none' && !!state.work1;
    $('pickWrap').hidden = !show; $('refTools').hidden = !show;
    $('btnRefMode').textContent = state.ref.manual ? '1回タップで自動検出に戻す' : 'うまく合わない：両端を2回タップで指定';
    var h = $('refHint');
    if (state.ref.kind === 'none') h.textContent = '比較物なしでは、本数は数えますが、長さはおおよその値になります。';
    else if (!state.work1) h.textContent = '1枚目の写真を入れると、ここに表示されます。';
    else if (state.ref.manual) h.textContent = state.ref.kind === 'card' ? 'カードの長い辺の両端を、順に2回タップしてください。' : '硬貨の端と、その反対側の端を、順に2回タップしてください。';
    else h.textContent = state.ref.kind === 'card' ? '写真の中のカードの真ん中をタップしてください。' : '写真の中の硬貨の真ん中をタップしてください。';
    drawPick(); refStatus(); updateAnalyzeBtn();
  }
  function refStatus() {
    var st = $('refStatus'), r = state.ref; st.className = 'status';
    if (r.kind === 'none' || !state.work1) { st.textContent = ''; return; }
    if (r.fit && r.fit.ok) {
      var ppm = r.fit.pxPerMm, wmm = state.work1.width / ppm;
      st.textContent = refLabel() + ' を検出しました。写真の横幅は約 ' + Math.round(wmm) + ' mm です。' + (r.fit.shapeOk ? '' : '（形がカードと合いません。斜めに写っているかもしれません）');
      st.className = 'status ' + (r.fit.shapeOk ? 'ok' : '');
    } else if (r.fit && !r.fit.ok) { st.textContent = '見つかりませんでした。もう一度真ん中をタップするか、両端を2回タップで指定してください。'; st.className = 'status err'; }
    else if (r.points.length === 2) { st.textContent = refLabel() + ' を両端で指定しました。'; st.className = 'status ok'; }
    else if (r.points.length === 1) st.textContent = '反対側の端をタップしてください。';
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
  $('btnRefMode').addEventListener('click', function () { state.ref.manual = !state.ref.manual; resetRef(); renderRefControls(); });
  $('btnRefClear').addEventListener('click', function () { resetRef(); renderRefControls(); });
  $('selKind').addEventListener('change', function (e) { state.ref.kind = e.target.value; resetRef(); saveSettings(); renderRefControls(); });
  $('selCountry').addEventListener('change', function (e) { state.ref.country = e.target.value; state.ref.coin = Math.min(state.ref.coin, COINS[e.target.value].coins.length - 1); saveSettings(); refit(); renderRefControls(); });
  var work1For = 0;
  async function ensureWork1() {
    var p = state.photos[0];
    if (!p) { state.work1 = null; work1For = 0; renderRefControls(); return; }
    if (work1For === p.id) { renderRefControls(); return; }
    work1For = p.id; state.work1 = null; resetRef(); renderRefControls();
    try { var img = await loadImageData(p.file); if (work1For !== p.id) return; state.work1 = HLC.toWork(img, {}); } catch (e) { state.work1 = null; }
    renderRefControls();
  }

  // ---------------------------------------------------------------- analysis
  var STAGE = { load: '写真を準備しています', surface: '台の色と反射を調べています', line: '線を検出しています', align: '写真を重ね合わせています', segment: '線を切り出しています', trace: '1本ずつたどっています', done: '完了' };
  function setProgress(f, t) { $('progress').hidden = false; $('barFill').style.width = Math.round(f * 100) + '%'; $('pText').textContent = t; }
  async function runAnalysis() {
    if (busy || !state.photos.length) return;
    busy = true; updateAnalyzeBtn(); state.saved = false;
    try {
      var imgs = [];
      for (var i = 0; i < state.photos.length; i++) { setProgress(0.02 * i, '写真 ' + (i + 1) + ' を読み込んでいます'); imgs.push(await loadImageData(state.photos[i].file)); }
      var opt = { sensitivity: state.settings.sensitivity, minLenMm: state.settings.minLenMm }, r = state.ref;
      if (r.kind !== 'none' && r.fit && r.fit.ok) opt.ref = { kind: r.kind, mm: refMm(), tap: r.tap };
      else if (r.kind !== 'none' && r.points.length === 2) opt.ref = { kind: r.kind, mm: refMm(), points: r.points };
      state.result = await analyze(imgs, opt, function (f, l) { setProgress(0.08 + 0.92 * f, (STAGE[l] || '解析中') + ' ' + Math.round(f * 100) + '%'); });
    } catch (err) { state.result = { ok: false, error: 'exception' }; }
    state.analyzed = true; state.files = state.photos.map(function (p) { return { name: p.file.name || '', lastModified: p.file.lastModified || null, size: p.file.size }; });
    setProgress(1, '完了'); busy = false; updateAnalyzeBtn(); renderResult(true);
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
  var REJECT = { blurred: 'ピントが合っていないため、数えていません。画面をタップしてピントを合わせてから、1枚目を撮り直してください。', overexposed: '反射が強すぎて、数えていません。照明の映り込みを避けて撮り直してください。' };
  var WARN = {
    'surface-white': '白い台です。白髪や色の薄い毛は数えられません。',
    'surface-black': '黒い台です。黒い毛は数えられません。',
    'surface-brown': '茶色い台です。台と色の近い茶色の毛は数えられないことがあります。',
    'pattern': '短い線が多く見つかりました。台の模様や傷を毛と間違えている可能性があります。',
    'glare-remaining': '反射で見えない所が残っています。角度を変えた写真を足すと補えます。',
    'align-failed': '重ね合わせられない写真がありました。その写真は使っていません。',
    'fill-blurred': 'ピントの甘い写真は、反射の補完に使っていません。',
    'ref-not-found': '比較物を見つけられませんでした。長さはおおよその値です。',
    'ref-shape': '比較物の形が合いません。斜めに写っている可能性があり、長さがずれます。',
    'no-reference': '比較物がないため、長さはおおよその値です。',
    'slightly-blurred': '少しピントが甘く、細い毛を取りこぼすことがあります。',
    'dense': '毛が密集した所があり、本数がずれやすい状態です。軽くほぐすと精度が上がります。'
  };
  function addChip(box, text, cls) { var s = document.createElement('span'); s.className = 'chip' + (cls ? ' ' + cls : ''); s.textContent = text; box.appendChild(s); }
  function usable() { var r = state.result; return r && r.ok && !(r.reject && r.reject.length); }
  function renderResult(fresh) {
    var r = state.result, al = $('rAlerts'), chips = $('rChips'); al.textContent = ''; chips.textContent = '';
    $('resultCard').hidden = !state.analyzed; if (!state.analyzed) return;
    function alert(t, bad) { var p = document.createElement('p'); p.className = 'alert' + (bad ? ' bad' : ''); p.textContent = t; al.appendChild(p); }
    function none(msg) { $('rNum').innerHTML = '—<small>本</small>'; $('rPer').textContent = msg; $('rSpread').textContent = ''; $('confirmBox').hidden = true; renderTabs(); drawView(); renderHisto(null); }
    if (!r || !r.ok) { alert('解析できませんでした。別の写真で試してください。', true); none(''); return; }
    (r.reject || []).forEach(function (w) { alert(REJECT[w] || '使えない写真です。', true); });
    r.warnings.forEach(function (w) { if (WARN[w]) alert(WARN[w]); });
    if (r.fusion.used.some(function (u, i) { return i > 0 && !u; }) && r.warnings.indexOf('align-failed') < 0) alert('向き（縦・横）の違う写真は使っていません。');
    if (!usable()) { none('数えていません'); return; }
    var est = estimate(r), cal = calibrated(r);
    if (!cal) alert(state.calib && !r.scaleFromRef ? '比較物がないため、あなたの補正を使えず、仮の値を表示しています（±3割ほどずれることがあります）。' : 'まだ補正がないため、仮の値です（±3割ほどずれることがあります）。一度、手で数えた本数を「確かめた」で記録すると、あなたの髪に合わせて補正されます。');
    $('rNum').innerHTML = (cal ? '' : '約') + Math.round(est) + '<small>本</small>';
    $('rPer').innerHTML = (cal ? '推定 <b>' + est.toFixed(1) + '</b> 本（補正あり）' : '仮の値 <b>' + est.toFixed(1) + '</b> 本');
    $('rSpread').innerHTML = 'たどれた線 <b>' + r.count + '</b>・長さ合計 <b>' + (r.totalLengthMm / 1000).toFixed(1) + ' m</b>';
    if (r.cutCount) addChip(chips, 'はみ出した毛 ' + r.cutCount + '本（端で数えています）', '');
    var white = r.hairs.filter(function (h) { return h.white; }).length; if (white) addChip(chips, '白い毛の線 ' + white, '');
    if (r.fusion.glarePx > 300) { var pc = Math.round(100 * r.fusion.filledPx / r.fusion.glarePx); addChip(chips, '反射 ' + pc + '% を他の写真で補完', pc >= 90 ? 'ok' : 'warn'); }
    addChip(chips, '使った写真 ' + r.fusion.used.filter(Boolean).length + '/' + r.fusion.photos + '枚', '');
    addChip(chips, r.scaleFromRef ? r.pxPerMm.toFixed(2) + ' px/mm' : '比較物なし', r.scaleFromRef ? '' : 'warn');
    $('confirmBox').hidden = false;
    if (fresh) { $('inConfirm').value = Math.round(est); $('inMemo').value = ''; $('inVerified').checked = false; setStatus('', ''); }
    $('btnSave').disabled = state.saved; $('btnSave').textContent = state.saved ? '記録しました' : '記録する';
    renderTabs(); drawView(); renderHisto(r);
  }
  function renderTabs() {
    var tabs = $('tabs'); tabs.textContent = '';
    var sp = document.createElement('span'); sp.className = 'spacer'; tabs.appendChild(sp);
    var t1 = document.createElement('button'); t1.type = 'button'; t1.className = 'tab'; t1.textContent = state.showLines ? '元の画像' : '色分け'; t1.disabled = !usable();
    t1.addEventListener('click', function () { state.showLines = !state.showLines; renderTabs(); drawView(); });
    var t2 = document.createElement('button'); t2.type = 'button'; t2.className = 'tab'; t2.textContent = $('cwrap').classList.contains('zoom') ? '縮小' : '拡大';
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
    var W = 560, H = 170, L = 8, R = 8, T = 16, B = 34, bw = (W - L - R) / 20, top = Math.max.apply(null, h.bins) || 1, s = '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
    h.bins.forEach(function (n, i) {
      var bh = (H - T - B) * n / top, x = L + i * bw;
      if (n) s += '<rect class="bar" x="' + (x + 2).toFixed(1) + '" y="' + (H - B - bh).toFixed(1) + '" width="' + (bw - 4).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="2"/><text class="cnt" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - B - bh - 3).toFixed(1) + '" text-anchor="middle">' + n + '</text>';
      if (i % 2 === 0) s += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - B + 12) + '" text-anchor="middle">' + Math.round(h.max - (i + 0.5) * h.width) + '</text>';
    });
    s += '<text x="' + L + '" y="' + (H - 6) + '">← 長い（最長 ' + Math.round(h.max) + ' mm）</text><text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">短い（最短 ' + Math.round(h.min) + ' mm）→</text>';
    svg.innerHTML = s;
  }

  // ---------------------------------------------------------------- record + files
  $('btnMinus').addEventListener('click', function () { $('inConfirm').value = Math.max(0, (parseInt($('inConfirm').value, 10) || 0) - 1); });
  $('btnPlus').addEventListener('click', function () { $('inConfirm').value = (parseInt($('inConfirm').value, 10) || 0) + 1; });
  function setStatus(t, cls) { $('saveStatus').textContent = t; $('saveStatus').className = 'status' + (cls ? ' ' + cls : ''); }
  function canvasBlob(cv, q, type) { return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, type || 'image/jpeg', q); }); }
  function mkCanvas(r, lines) { var c = document.createElement('canvas'); renderOverlay(c, r, lines, false); return c; }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length; return !n ? 0 : n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; }
  function sessionRecord() {
    var r = state.result, now = new Date();
    return {
      v: 3, ts: now.getTime(), localDate: now.toLocaleString('ja-JP', { hour12: false }),
      estimate: +estimate(r).toFixed(1), provisional: !calibrated(r), confirmed: Math.max(0, parseInt($('inConfirm').value, 10) || 0), verified: $('inVerified').checked,
      memo: $('inMemo').value.trim().slice(0, 200),
      paths: r.count, totalLengthMm: Math.round(r.totalLengthMm), cutCount: r.cutCount, whitePaths: r.hairs.filter(function (x) { return x.white; }).length,
      lengthsMm: r.hairs.map(function (x) { return Math.round(x.lengthMm); }).sort(function (a, b) { return b - a; }).slice(0, 400), hist: histogram(r),
      pxPerMm: +r.pxPerMm.toFixed(3), scaleFromRef: !!r.scaleFromRef, reference: r.scaleFromRef ? refLabel() : 'なし',
      surface: r.surface.kind, sharpness: +r.sharpness.toFixed(2), photos: r.fusion.photos, photosUsed: r.fusion.used.filter(Boolean).length,
      warnings: r.warnings, files: state.files || [], app: 'HairLossCounter ' + (window.HLC ? HLC.version : '')
    };
  }
  function persistRecords() { return lsSet(K_REC, state.records); }
  $('btnSave').addEventListener('click', function () {
    if (!usable() || state.saved) return;
    var rec = sessionRecord(); state.records.unshift(rec);
    if (!persistRecords()) { state.records.shift(); setStatus('このブラウザでは記録を保存できませんでした（プライベートモードや保存容量の不足が原因のことがあります）。「結果一式を保存」で端末に残せます。', 'err'); return; }
    var msg = '記録しました（' + rec.confirmed + '本）。';
    if (rec.verified) {
      if (rec.scaleFromRef && rec.confirmed > 0 && rec.paths > 0) {
        var c = state.calib ? JSON.parse(JSON.stringify(state.calib)) : { samples: [] };
        c.samples = (c.samples || []).concat([{ ts: rec.ts, Leff: +(rec.paths * rec.totalLengthMm / (rec.confirmed * rec.confirmed)).toFixed(1), n: rec.confirmed }]).slice(-20);
        c.Leff = median(c.samples.map(function (x) { return x.Leff; })); state.calib = c; lsSet(K_CAL, c); msg += '補正を更新しました。';
      } else msg += '補正に使えるのは、比較物つきで撮った回だけです。';
    }
    state.saved = true; requestPersist();
    var since = state.records.length - (lsGet(K_BAK, 0) || 0);
    if (since >= 10) msg += '記録が' + state.records.length + '件になりました。「記録を書き出す」で控えを取っておくと安心です。';
    setStatus(msg, 'ok'); renderCalib(); renderHistory(); renderResult(false);
  });
  $('btnImg').addEventListener('click', async function () { if (!usable()) return; saveBlob(await canvasBlob(mkCanvas(state.result, true), 0.9), 'HairLossCounter_' + stamp(new Date()) + '.jpg'); setStatus('色分け画像を端末に保存しました（ブラウザのダウンロード先）。', 'ok'); });
  $('btnZip').addEventListener('click', async function () {
    if (!usable()) return;
    var rec = sessionRecord(), enc = new TextEncoder(), files = [], h = rec.hist;
    files.push({ name: '色分け.jpg', data: new Uint8Array(await (await canvasBlob(mkCanvas(state.result, true), 0.88)).arrayBuffer()) });
    files.push({ name: '合成画像.jpg', data: new Uint8Array(await (await canvasBlob(mkCanvas(state.result, false), 0.92)).arrayBuffer()) });
    var csv = '﻿日時,推定本数,確定本数,たどれた線,長さ合計mm,はみ出し,比較物,メモ\n' + [rec.localDate, rec.estimate, rec.confirmed, rec.paths, rec.totalLengthMm, rec.cutCount, '"' + rec.reference + '"', '"' + rec.memo.replace(/"/g, '""') + '"'].join(',') + '\n\n区間(長い順),長さmmから,長さmmまで,本数\n' +
      (h ? h.bins.map(function (n, i) { return [i + 1, (h.max - (i + 1) * h.width).toFixed(1), (h.max - i * h.width).toFixed(1), n].join(','); }).join('\n') : '') + '\n';
    files.push({ name: 'summary.csv', data: enc.encode(csv) }); files.push({ name: 'summary.json', data: enc.encode(JSON.stringify(rec, null, 1)) });
    saveBlob(zipStore(files), 'HairLossCounter_' + stamp(new Date()) + '.zip'); setStatus('結果一式（画像2枚・CSV・JSON）を端末に保存しました。', 'ok');
  });
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
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
  var openId = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function hstatus(t, cls) { $('histStatus').textContent = t; $('histStatus').className = 'status' + (cls ? ' ' + cls : ''); }
  function renderHistory() {
    var list = state.records, ul = $('hist'); ul.textContent = ''; $('histEmpty').hidden = list.length > 0; $('vCount').textContent = list.length + ' 件';
    list.slice(0, 100).forEach(function (rec) {
      var li = document.createElement('li'), b = document.createElement('button'), d = new Date(rec.ts); b.type = 'button'; b.className = 'hrow';
      b.innerHTML = '<span class="d"></span><span class="n"></span><span aria-hidden="true">' + (openId === rec.ts ? '－' : '＋') + '</span>';
      b.querySelector('.d').innerHTML = esc(d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })) + ' ' + esc(d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })) +
        '<small>' + esc((rec.provisional ? '仮の値 ' : '推定 ') + rec.estimate + '本' + (rec.verified ? '・実測' : '') + (rec.memo ? '・' + rec.memo : '')) + '</small>';
      b.querySelector('.n').innerHTML = esc(rec.confirmed) + '<small> 本</small>';
      b.setAttribute('aria-expanded', openId === rec.ts ? 'true' : 'false');
      b.addEventListener('click', function () { openId = openId === rec.ts ? null : rec.ts; renderHistory(); });
      li.appendChild(b); if (openId === rec.ts) li.appendChild(historyDetail(rec)); ul.appendChild(li);
    });
    renderTrend(list);
  }
  function historyDetail(rec) {
    var box = document.createElement('div'); box.className = 'hdetail';
    var info = document.createElement('p'); info.className = 'hint';
    info.textContent = 'たどれた線 ' + rec.paths + '・長さ合計 ' + (rec.totalLengthMm / 1000).toFixed(1) + ' m・はみ出し ' + rec.cutCount + '本・比較物 ' + rec.reference + '・写真 ' + rec.photosUsed + '/' + rec.photos + '枚';
    box.appendChild(info);
    if (rec.files && rec.files.length) { var ul = document.createElement('ul'); ul.className = 'files'; rec.files.forEach(function (f) { var li = document.createElement('li'); li.textContent = (f.name || '（名前なし）'); ul.appendChild(li); }); box.appendChild(ul); }
    var del = document.createElement('button'); del.type = 'button'; del.className = 'btn small danger'; del.textContent = 'この記録を削除';
    var armed = false, timer = null;
    del.addEventListener('click', function () {
      if (!armed) { armed = true; del.textContent = 'もう一度押すと削除します'; timer = setTimeout(function () { armed = false; del.textContent = 'この記録を削除'; }, 4000); return; }
      clearTimeout(timer); state.records = state.records.filter(function (r) { return r !== rec; }); persistRecords(); renderHistory();
    });
    box.appendChild(del); return box;
  }
  function trendPoints() { return state.records.slice(0, 30).reverse(); }
  function renderTrend() {
    var svg = $('trend'), pts = trendPoints();
    if (pts.length < 2) { svg.hidden = true; return; } svg.hidden = false;
    var W = 560, H = 150, L = 34, R = 14, T = 14, B = 26, vals = pts.map(function (r) { return r.confirmed; });
    var top = Math.max(5, Math.ceil(Math.max.apply(null, vals) * 1.15 / 5) * 5), bot = Math.max(0, Math.floor(Math.min.apply(null, vals) * 0.8 / 5) * 5); if (top === bot) top = bot + 5;
    var x = function (i) { return L + (W - L - R) * i / (pts.length - 1); }, y = function (v) { return T + (H - T - B) * (1 - (v - bot) / (top - bot)); }, s = '';
    [bot, (bot + top) / 2, top].forEach(function (v) { s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + Math.round(v) + '</text>'; });
    var line = pts.map(function (r, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r.confirmed).toFixed(1); }).join(' ');
    s += '<path class="area" d="' + line + ' L' + x(pts.length - 1).toFixed(1) + ' ' + y(bot) + ' L' + x(0).toFixed(1) + ' ' + y(bot) + ' Z"/><path class="lineP" d="' + line + '"/>';
    pts.forEach(function (r, i) { s += '<circle class="pt' + (i === pts.length - 1 ? ' last' : '') + '" cx="' + x(i).toFixed(1) + '" cy="' + y(r.confirmed).toFixed(1) + '" r="' + (i === pts.length - 1 ? 4.5 : 3) + '"/>'; });
    var d0 = new Date(pts[0].ts), d1 = new Date(pts[pts.length - 1].ts);
    s += '<text x="' + L + '" y="' + (H - 6) + '">' + (d0.getMonth() + 1) + '/' + d0.getDate() + '</text><text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">' + (d1.getMonth() + 1) + '/' + d1.getDate() + '・最新 ' + vals[vals.length - 1] + '本</text>';
    svg.innerHTML = s;
  }
  $('btnExport').addEventListener('click', function () {
    if (!state.records.length) { hstatus('まだ記録がありません。', ''); return; }
    var data = { app: 'HairLossCounter', format: 1, exportedAt: new Date().toISOString(), records: state.records, calib: state.calib };
    saveBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'HairLossCounter_records_' + stamp(new Date()) + '.json');
    lsSet(K_BAK, state.records.length); hstatus(state.records.length + '件の記録を書き出しました（ブラウザのダウンロード先）。', 'ok');
  });
  $('inImport').addEventListener('change', async function (e) {
    var f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      var data = JSON.parse(await f.text());
      if (!data || data.app !== 'HairLossCounter' || !Array.isArray(data.records)) throw new Error('format');
      var have = {}, added = 0; state.records.forEach(function (r) { have[r.ts] = 1; });
      data.records.forEach(function (r) { if (r && typeof r.ts === 'number' && typeof r.confirmed === 'number' && !have[r.ts]) { state.records.push(r); have[r.ts] = 1; added++; } });
      state.records.sort(function (a, b) { return b.ts - a.ts; });
      if (!state.calib && data.calib && data.calib.Leff > 0) { state.calib = data.calib; lsSet(K_CAL, state.calib); }
      if (!persistRecords()) throw new Error('storage');
      renderHistory(); renderCalib(); hstatus(added + '件を読み込みました（重複は除きました）。', 'ok');
    } catch (err) { hstatus(err && err.message === 'storage' ? 'このブラウザに保存できませんでした。' : 'このファイルは読み込めませんでした。Hair Loss Counter で書き出したファイルを選んでください。', 'err'); }
  });

  // share card: numbers and trend only, never a photo
  function drawShare() {
    var cv = $('shareCv'), c = cv.getContext('2d'), W = 1080, pts = trendPoints(), last = state.records[0];
    c.fillStyle = '#f2f4ef'; c.fillRect(0, 0, W, W); c.fillStyle = '#3d7a1f'; c.fillRect(0, 0, W, 16);
    var F = '"Hiragino Sans","Noto Sans JP",system-ui,sans-serif';
    c.fillStyle = '#5d6a61'; c.font = '500 44px ' + F; c.textBaseline = 'alphabetic'; c.fillText('抜け毛の記録', 80, 150);
    var d = new Date(last.ts); c.font = '400 36px ' + F; c.fillText(d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日', 80, 205);
    c.fillStyle = '#1c231e'; c.font = '700 300px ui-monospace,Menlo,Consolas,monospace'; var num = String(last.confirmed); c.fillText(num, 70, 500);
    var nw = c.measureText(num).width; c.font = '500 80px ' + F; c.fillText('本', 90 + nw, 500);
    var x0 = 80, x1 = W - 80, y0 = 600, y1 = 880;
    if (pts.length >= 2) {
      var vals = pts.map(function (r) { return r.confirmed; }), top = Math.max.apply(null, vals) * 1.15 || 1, bot = Math.min.apply(null, vals) * 0.8;
      var X = function (i) { return x0 + (x1 - x0) * i / (pts.length - 1); }, Y = function (v) { return y1 - (y1 - y0) * (v - bot) / (top - bot || 1); };
      c.beginPath(); pts.forEach(function (r, i) { if (i) c.lineTo(X(i), Y(r.confirmed)); else c.moveTo(X(i), Y(r.confirmed)); });
      c.lineTo(x1, y1); c.lineTo(x0, y1); c.closePath(); c.fillStyle = '#e4efd9'; c.fill();
      c.beginPath(); pts.forEach(function (r, i) { if (i) c.lineTo(X(i), Y(r.confirmed)); else c.moveTo(X(i), Y(r.confirmed)); }); c.strokeStyle = '#3d7a1f'; c.lineWidth = 8; c.lineJoin = 'round'; c.stroke();
      c.fillStyle = '#3d7a1f'; c.beginPath(); c.arc(X(pts.length - 1), Y(vals[vals.length - 1]), 16, 0, 6.2832); c.fill();
      c.fillStyle = '#5d6a61'; c.font = '400 32px ' + F; c.fillText('直近' + pts.length + '回の推移（平均 ' + Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) + '本）', x0, y1 + 56);
    } else { c.fillStyle = '#5d6a61'; c.font = '400 36px ' + F; c.fillText('記録が2回以上になると、推移のグラフが入ります。', x0, 740); }
    c.fillStyle = '#1c231e'; c.font = '700 40px ' + F; c.fillText('Hair Loss Counter', 80, 1010);
    c.fillStyle = '#5d6a61'; c.font = '400 30px ' + F; c.textAlign = 'right'; c.fillText('写真は端末の外に出ません', W - 80, 1010); c.textAlign = 'left';
  }
  async function shareFile() { var b = await canvasBlob($('shareCv'), undefined, 'image/png'); return new File([b], 'HairLossCounter_' + stamp(new Date()) + '.png', { type: 'image/png' }); }
  $('btnShare').addEventListener('click', function () {
    if (!state.records.length) { hstatus('記録が1件以上になると作れます。', ''); return; }
    drawShare(); $('shareBox').hidden = false;
    var can = false; try { can = !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'x.png', { type: 'image/png' })] })); } catch (e) { can = false; }
    $('btnShareSend').hidden = !can;
  });
  $('btnShareSave').addEventListener('click', async function () { var f = await shareFile(); saveBlob(f, f.name); hstatus('シェア用の画像を端末に保存しました。', 'ok'); });
  $('btnShareSend').addEventListener('click', async function () { try { await navigator.share({ files: [await shareFile()] }); } catch (e) { /* cancelled */ } });

  // ---------------------------------------------------------------- proof of no outside traffic
  var net = { ext: 0, own: 0, blocked: 0 };
  function renderProof() {
    $('pExt').textContent = net.ext + ' 件'; $('pExt').className = net.ext ? 'nz' : 'zero';
    $('pBlocked').textContent = net.blocked + ' 件'; $('pBlocked').className = net.blocked ? 'nz' : 'zero';
    $('pOwn').textContent = net.own + ' 件';
    $('netChip').className = 'chip ' + (net.ext ? 'bad' : 'ok'); $('netText').textContent = net.ext ? '外部通信 ' + net.ext + '件' : '通信なし';
  }
  function countEntries(list) { list.forEach(function (en) { var u; try { u = new URL(en.name, location.href); } catch (e) { return; } if (u.protocol !== 'http:' && u.protocol !== 'https:') return; if (u.origin === location.origin) net.own++; else net.ext++; }); renderProof(); }
  try { countEntries(performance.getEntriesByType('resource')); new PerformanceObserver(function (l) { countEntries(l.getEntries()); }).observe({ type: 'resource', buffered: false }); } catch (e) { /* not supported */ }
  document.addEventListener('securitypolicyviolation', function () { net.blocked++; renderProof(); });
  $('netChip').addEventListener('click', function () { var b = $('proofBox'); b.open = true; b.scrollIntoView({ block: 'start' }); });
  function requestPersist() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(showPersist, function () {}); } catch (e) { /* ignore */ } }
  function showPersist(ok) { $('pPersist').textContent = !storageOk ? '保存できません' : ok ? '消されにくい設定' : '通常'; }
  try { if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(showPersist, function () { showPersist(false); }); else showPersist(false); } catch (e) { showPersist(false); }
  function showOffline(t) { $('pOffline').textContent = t; }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').then(function () { return navigator.serviceWorker.ready; }).then(function () { showOffline('使えます'); }, function () { showOffline('使えません'); });
  } else showOffline('使えません');
  if (SOURCE_URL) { var a = document.createElement('a'); a.href = SOURCE_URL; a.rel = 'noopener noreferrer'; a.textContent = SOURCE_URL; $('srcLink').appendChild(a); $('srcRow').hidden = false; }
  var ua = navigator.userAgent || '', ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  $('iosHint').hidden = !(ios && !standalone);

  // ---------------------------------------------------------------- settings
  function syncSettings() { $('inSens').value = state.settings.sensitivity; $('vSens').textContent = Number(state.settings.sensitivity).toFixed(1); $('inMinLen').value = state.settings.minLenMm; $('vMinLen').textContent = state.settings.minLenMm + ' mm'; }
  $('inSens').addEventListener('input', function (e) { state.settings.sensitivity = +e.target.value; syncSettings(); saveSettings(); });
  $('inMinLen').addEventListener('input', function (e) { state.settings.minLenMm = +e.target.value; syncSettings(); saveSettings(); });
  function renderCalib() { var c = state.calib; $('vCalib').textContent = c && c.Leff > 0 ? (c.samples ? c.samples.length : 1) + '回分の実測で補正中' : '未設定（仮の値を表示）'; $('btnCalibReset').hidden = !(c && c.Leff > 0); }
  function armed2(btn, label, armLabel, fn) { var on = false; btn.addEventListener('click', function () { if (!on) { on = true; btn.textContent = armLabel; setTimeout(function () { on = false; btn.textContent = label; }, 4000); return; } on = false; btn.textContent = label; fn(); }); }
  armed2($('btnCalibReset'), '補正を消す', 'もう一度押すと消します', function () { state.calib = null; try { localStorage.removeItem(K_CAL); } catch (e) { /* ignore */ } renderCalib(); if (state.analyzed) renderResult(false); });
  armed2($('btnWipe'), '記録と設定をすべて消す', 'もう一度押すと、すべて消します', function () {
    try { [K_REC, K_CAL, K_SET, K_BAK].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* ignore */ }
    state.records = []; state.calib = null; renderHistory(); renderCalib(); $('shareBox').hidden = true; hstatus('すべて消しました。', 'ok'); if (state.analyzed) renderResult(false);
  });

  // ---------------------------------------------------------------- start
  syncSettings(); renderCalib(); renderThumbs(); renderRefControls(); renderHistory(); renderProof();
})();

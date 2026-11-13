/* Hair Loss Counter — analysis engine (plain JS, runs in a Web Worker, main thread or Node).
 * Pipeline: green sheet detection -> perspective rectification -> 30 mm marker scale ->
 * hair map (intensity ratio to local background) -> oriented line filter ->
 * hysteresis segmentation -> Zhang-Suen skeleton -> skeleton graph ->
 * crossing pairing by good continuation -> per-hair paths -> count. */
(function (root) {
  'use strict';
  var HLC = {};
  HLC.version = '2.3.0';

  var DEFAULTS = {
    workWidth: 1260,        // rectified sheet width in px (~6 px/mm on A4)
    sheetWidthMm: 210,      // nominal printed width, used only when the marker is not found
    markerMm: 30.2,         // outer size of the printed magenta square
    nTheta: 12,             // orientations of the line filter
    alongRadius: 10,        // half length of the oriented integration (px)
    alongSigma: 7,
    kLo: 3.0, kHi: 7.5,     // hysteresis thresholds in robust noise units
    sensitivity: 1.0,       // >1 finds fainter hairs (and more noise)
    minAreaPx: 15,
    minSkelPx: 15,
    rMerge: 3, lSpur: 12, lBridge: 16, kDir: 15, maxNodeSpan: 24,
    uOdd: 0.37, uEven: 0.6,
    gapMax: 40, gapCos: 0.75, gapMaxInvalid: 150, gapCosInvalid: 0.6,
    minLenMm: 10,
    borderMm: 4, markerPadMm: 3, flagNearMm: 5
  };
  HLC.DEFAULTS = DEFAULTS;

  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  // ------------------------------------------------------------------ small linear algebra
  function solve(A, b) {
    var n = b.length, M = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var t = M[c]; M[c] = M[p]; M[p] = t;
      var piv = M[c][c];
      if (Math.abs(piv) < 1e-12) return null;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === c) continue;
        var f = M[r2][c] / piv;
        if (f === 0) continue;
        for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k];
      }
    }
    return M.map(function (row, i) { return row[n] / row[i]; });
  }
  // homography mapping src points -> dst points
  function homography(src, dst) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], X = dst[i][0], Y = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
    }
    var h = solve(A, b);
    return h ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : null;
  }
  function applyH(H, x, y) {
    var d = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
  }

  // ------------------------------------------------------------------ binary helpers
  function label8(mask, W, H, lab) {
    // connected components (8-neighbour) of mask!=0; returns count, fills lab (Int32Array)
    lab.fill(0);
    var n = 0, stack = new Int32Array(W * H);
    for (var i = 0; i < W * H; i++) {
      if (!mask[i] || lab[i]) continue;
      n++; var sp = 0; stack[sp++] = i; lab[i] = n;
      while (sp) {
        var p = stack[--sp], y = (p / W) | 0, x = p - y * W;
        for (var dy = -1; dy <= 1; dy++) {
          var yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var xx = x + dx; if (xx < 0 || xx >= W) continue;
            var q = yy * W + xx;
            if (mask[q] && !lab[q]) { lab[q] = n; stack[sp++] = q; }
          }
        }
      }
    }
    return n;
  }
  function boxMaxMin(mask, W, H, r, isMax) {
    // square dilation (isMax) / erosion of a binary mask, separable sliding window
    var tmp = new Uint8Array(W * H), out = new Uint8Array(W * H), x, y, c;
    var need = isMax ? 1 : 2 * r + 1;
    for (y = 0; y < H; y++) {
      var row = y * W; c = 0;
      for (x = -r; x < W; x++) {
        var add = x + r, rem = x - r - 1;
        if (add < W && mask[row + add]) c++;
        if (rem >= 0 && mask[row + rem]) c--;
        if (x >= 0) {
          var lo = Math.max(0, x - r), hi = Math.min(W - 1, x + r), span = hi - lo + 1;
          tmp[row + x] = isMax ? (c > 0 ? 1 : 0) : (c >= Math.min(need, span) ? 1 : 0);
        }
      }
    }
    for (x = 0; x < W; x++) {
      c = 0;
      for (y = -r; y < H; y++) {
        var a2 = y + r, r2 = y - r - 1;
        if (a2 < H && tmp[a2 * W + x]) c++;
        if (r2 >= 0 && tmp[r2 * W + x]) c--;
        if (y >= 0) {
          var lo2 = Math.max(0, y - r), hi2 = Math.min(H - 1, y + r), span2 = hi2 - lo2 + 1;
          out[y * W + x] = isMax ? (c > 0 ? 1 : 0) : (c >= Math.min(need, span2) ? 1 : 0);
        }
      }
    }
    return out;
  }
  function fillHoles(mask, W, H) {
    var reach = new Uint8Array(W * H), stack = new Int32Array(W * H), sp = 0, i;
    function push(p) { if (!mask[p] && !reach[p]) { reach[p] = 1; stack[sp++] = p; } }
    for (i = 0; i < W; i++) { push(i); push((H - 1) * W + i); }
    for (i = 0; i < H; i++) { push(i * W); push(i * W + W - 1); }
    while (sp) {
      var p = stack[--sp], y = (p / W) | 0, x = p - y * W;
      if (x > 0) push(p - 1); if (x < W - 1) push(p + 1);
      if (y > 0) push(p - W); if (y < H - 1) push(p + W);
    }
    var out = new Uint8Array(W * H);
    for (i = 0; i < W * H; i++) out[i] = (mask[i] || !reach[i]) ? 1 : 0;
    return out;
  }

  // ------------------------------------------------------------------ sheet detection
  function detectSheet(rgba, w, h) {
    // work on a downsampled copy (long side ~ 900 px)
    var f = Math.max(1, Math.round(Math.max(w, h) / 900));
    var W = Math.floor(w / f), H = Math.floor(h / f), N = W * H;
    var gex = new Float32Array(N), inv = 1 / (f * f);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var sr = 0, sg = 0, sb = 0;
      for (var dy = 0; dy < f; dy++) {
        var p = ((y * f + dy) * w + x * f) * 4;
        for (var dx = 0; dx < f; dx++, p += 4) { sr += rgba[p]; sg += rgba[p + 1]; sb += rgba[p + 2]; }
      }
      sr *= inv; sg *= inv; sb *= inv;
      gex[y * W + x] = sg > 35 ? (2 * sg - sr - sb) / (sr + sg + sb + 1) : -1;
    }
    var mask = new Uint8Array(N);
    for (var i = 0; i < N; i++) mask[i] = gex[i] > 0.15 ? 1 : 0;
    mask = boxMaxMin(boxMaxMin(mask, W, H, 1, false), W, H, 1, true);      // open
    mask = boxMaxMin(boxMaxMin(mask, W, H, 6, true), W, H, 6, false);      // close
    var lab = new Int32Array(N), n = label8(mask, W, H, lab);
    if (!n) return { ok: false, reason: 'no-sheet' };
    var cnt = new Int32Array(n + 1);
    for (i = 0; i < N; i++) cnt[lab[i]]++;
    var best = 1; for (i = 2; i <= n; i++) if (cnt[i] > cnt[best]) best = i;
    if (cnt[best] < 0.08 * N) return { ok: false, reason: 'sheet-small' };
    for (i = 0; i < N; i++) mask[i] = lab[i] === best ? 1 : 0;
    mask = fillHoles(mask, W, H);
    // boundary points (not on the image border)
    var bx = [], by = [];
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      var q = y * W + x;
      if (mask[q] && (!mask[q - 1] || !mask[q + 1] || !mask[q - W] || !mask[q + W])) { bx.push(x); by.push(y); }
    }
    var touches = [0, 0, 0, 0]; // left, top, right, bottom image borders
    for (y = 0; y < H; y++) { if (mask[y * W]) touches[0]++; if (mask[y * W + W - 1]) touches[2]++; }
    for (x = 0; x < W; x++) { if (mask[x]) touches[1]++; if (mask[(H - 1) * W + x]) touches[3]++; }
    // rough corners by extreme projections
    var ext = [[1e9, 0], [-1e9, 0], [-1e9, 0], [1e9, 0]]; // min(x+y), max(x-y), max(x+y), min(x-y)
    for (i = 0; i < bx.length; i++) {
      var s = bx[i] + by[i], d = bx[i] - by[i];
      if (s < ext[0][0]) ext[0] = [s, i];
      if (d > ext[1][0]) ext[1] = [d, i];
      if (s > ext[2][0]) ext[2] = [s, i];
      if (d < ext[3][0]) ext[3] = [d, i];
    }
    var c0 = ext.map(function (e) { return [bx[e[1]], by[e[1]]]; });
    // refine each side by a total-least-squares line fit
    var lines = [];
    for (var sIdx = 0; sIdx < 4; sIdx++) {
      var a = c0[sIdx], b2 = c0[(sIdx + 1) % 4];
      var ux = b2[0] - a[0], uy = b2[1] - a[1], L = Math.hypot(ux, uy) || 1;
      ux /= L; uy /= L;
      var tol = Math.max(4, 0.03 * L), pts = [];
      for (i = 0; i < bx.length; i++) {
        var rx = bx[i] - a[0], ry = by[i] - a[1];
        var t = rx * ux + ry * uy, dd = Math.abs(-rx * uy + ry * ux);
        if (t > 0.1 * L && t < 0.9 * L && dd < tol) pts.push([bx[i], by[i]]);
      }
      var line = pts.length >= 20 ? fitLine(pts) : null;
      if (line) { // one round of outlier rejection
        var keep = pts.filter(function (p) { return Math.abs((p[0] - line.p[0]) * line.d[1] - (p[1] - line.p[1]) * line.d[0]) < 2.5; });
        if (keep.length >= 20) line = fitLine(keep);
      }
      lines.push(line || { p: a, d: [ux, uy] });
    }
    var corners = [];
    for (sIdx = 0; sIdx < 4; sIdx++) {
      var P = intersect(lines[(sIdx + 3) % 4], lines[sIdx]);
      corners.push(P || c0[sIdx]);
    }
    corners = corners.map(function (p) { return [p[0] * f + f / 2, p[1] * f + f / 2]; });
    // sanity: convex & reasonable area
    var area = polyArea(corners);
    if (!(area > 0.08 * w * h)) return { ok: false, reason: 'quad' };
    var outside = corners.some(function (p) { return p[0] < -2 || p[1] < -2 || p[0] > w + 2 || p[1] > h + 2; });
    return { ok: true, corners: corners, cornerOutside: outside, touches: touches, maskScale: f };
  }
  function fitLine(pts) {
    var n = pts.length, mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += pts[i][0]; my += pts[i][1]; }
    mx /= n; my /= n;
    var sxx = 0, sxy = 0, syy = 0;
    for (i = 0; i < n; i++) { var dx = pts[i][0] - mx, dy = pts[i][1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    var a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { p: [mx, my], d: [Math.cos(a), Math.sin(a)] };
  }
  function intersect(L1, L2) {
    var det = L1.d[0] * (-L2.d[1]) - L1.d[1] * (-L2.d[0]);
    if (Math.abs(det) < 1e-9) return null;
    var rx = L2.p[0] - L1.p[0], ry = L2.p[1] - L1.p[1];
    var t = (rx * (-L2.d[1]) - ry * (-L2.d[0])) / det;
    return [L1.p[0] + t * L1.d[0], L1.p[1] + t * L1.d[1]];
  }
  function polyArea(c) {
    var s = 0;
    for (var i = 0; i < c.length; i++) { var a = c[i], b = c[(i + 1) % c.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(s) / 2;
  }

  // ------------------------------------------------------------------ warping
  // warp a region of the source into an out image: out(u,v) = src(H(u,v)); returns RGBA + inside mask
  function warp(rgba, w, h, Hm, OW, OH) {
    var out = new Uint8ClampedArray(OW * OH * 4), inside = new Uint8Array(OW * OH);
    for (var v = 0; v < OH; v++) {
      for (var u = 0; u < OW; u++) {
        var d = Hm[6] * u + Hm[7] * v + Hm[8];
        var x = (Hm[0] * u + Hm[1] * v + Hm[2]) / d, y = (Hm[3] * u + Hm[4] * v + Hm[5]) / d;
        var o = (v * OW + u) * 4;
        if (x < 0 || y < 0 || x > w - 1.001 || y > h - 1.001) { out[o + 3] = 255; continue; }
        var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
        var p = (y0 * w + x0) * 4, q = p + w * 4;
        var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        out[o] = rgba[p] * w00 + rgba[p + 4] * w10 + rgba[q] * w01 + rgba[q + 4] * w11;
        out[o + 1] = rgba[p + 1] * w00 + rgba[p + 5] * w10 + rgba[q + 1] * w01 + rgba[q + 5] * w11;
        out[o + 2] = rgba[p + 2] * w00 + rgba[p + 6] * w10 + rgba[q + 2] * w01 + rgba[q + 6] * w11;
        out[o + 3] = 255; inside[v * OW + u] = 1;
      }
    }
    return { rgba: out, inside: inside };
  }

  // ------------------------------------------------------------------ marker (30 mm magenta square)
  function findMarker(rgba, w, h, corners, WW, WH) {
    // look in each corner region of the rectified sheet at higher resolution (~10 px/mm)
    var reg = 0.36;
    var scaleHi = 2.0; // relative to work px (~12 px/mm)
    var dstFull = [[0, 0], [WW, 0], [WW, WH], [0, WH]];
    var Hws = homography(dstFull, corners); // work -> source
    var regions = [
      { name: 'bl', u0: 0, v0: WH * (1 - reg), u1: WW * reg, v1: WH },
      { name: 'br', u0: WW * (1 - reg), v0: WH * (1 - reg), u1: WW, v1: WH },
      { name: 'tr', u0: WW * (1 - reg), v0: 0, u1: WW, v1: WH * reg },
      { name: 'tl', u0: 0, v0: 0, u1: WW * reg, v1: WH * reg }
    ];
    var best = null;
    for (var r = 0; r < 4; r++) {
      if (best) break; // regions are searched in order of likelihood; stop at the first hit
      var R = regions[r];
      var OW = Math.round((R.u1 - R.u0) * scaleHi), OH = Math.round((R.v1 - R.v0) * scaleHi);
      // out(u',v') -> work (u0 + u'/s, v0 + v'/s) -> source
      var S = [1 / scaleHi, 0, R.u0, 0, 1 / scaleHi, R.v0, 0, 0, 1];
      var Hc = mulH(Hws, S);
      var wp = warp(rgba, w, h, Hc, OW, OH), px = wp.rgba;
      // magenta ink raises red and blue chromaticity and lowers green relative to the sheet,
      // whatever the light colour; dark or white hairs lower red chromaticity instead
      var cr = new Float32Array(OW * OH), cg = new Float32Array(OW * OH), samp = [], sampg = [];
      for (var i = 0; i < OW * OH; i++) {
        var o = i * 4, sum = px[o] + px[o + 1] + px[o + 2] + 1;
        cr[i] = px[o] / sum; cg[i] = px[o + 1] / sum;
        if (wp.inside[i] && (i % 7) === 0) { samp.push(cr[i]); sampg.push(cg[i]); }
      }
      if (samp.length < 50) continue;
      samp.sort(function (a, b) { return a - b; }); sampg.sort(function (a, b) { return a - b; });
      var rbg = samp[samp.length >> 1], gbg = sampg[sampg.length >> 1];
      var m = new Uint8Array(OW * OH);
      for (i = 0; i < OW * OH; i++) m[i] = (wp.inside[i] && cg[i] - gbg < -0.05 && cr[i] - rbg > -0.005) ? 1 : 0;
      m = boxMaxMin(m, OW, OH, 2, true);
      var lab = new Int32Array(OW * OH), n = label8(m, OW, OH, lab);
      if (!n) continue;
      var bb4 = [];
      for (var k = 0; k <= n; k++) bb4.push([1e9, 1e9, -1, -1, 0]);
      for (i = 0; i < OW * OH; i++) {
        var L = lab[i]; if (!L) continue;
        var y = (i / OW) | 0, x = i - y * OW, B = bb4[L];
        if (x < B[0]) B[0] = x; if (y < B[1]) B[1] = y; if (x > B[2]) B[2] = x; if (y > B[3]) B[3] = y; B[4]++;
      }
      var nominal = WW / DEFAULTS.sheetWidthMm * scaleHi; // px per mm in this region image
      // the printed outline may come out broken: merge nearby pieces into clusters
      var boxes = bb4.slice(1).filter(function (B2) { return B2[4] > 30; }).map(function (B2) { return B2.slice(); });
      var padM = 3 * nominal, merged = true;
      while (merged) {
        merged = false;
        for (var a = 0; a < boxes.length && !merged; a++) for (var b2 = a + 1; b2 < boxes.length && !merged; b2++) {
          var A = boxes[a], Bb = boxes[b2];
          if (A[0] - padM <= Bb[2] && Bb[0] - padM <= A[2] && A[1] - padM <= Bb[3] && Bb[1] - padM <= A[3]) {
            var M2 = [Math.min(A[0], Bb[0]), Math.min(A[1], Bb[1]), Math.max(A[2], Bb[2]), Math.max(A[3], Bb[3]), A[4] + Bb[4]];
            var mmW2 = (M2[2] - M2[0] + 1) / nominal, mmH2 = (M2[3] - M2[1] + 1) / nominal;
            if (mmW2 <= 48 && mmH2 <= 48) { boxes.splice(b2, 1); boxes[a] = M2; merged = true; }
          }
        }
      }
      for (k = 0; k < boxes.length; k++) {
        var Bk = boxes[k], bw = Bk[2] - Bk[0] + 1, bh = Bk[3] - Bk[1] + 1;
        var mmw = bw / nominal, mmh = bh / nominal, ar = bw / bh;
        if (typeof __HLC_DEBUG !== 'undefined' && __HLC_DEBUG && Bk[4] > 200) (__HLC_DEBUG.mkall = __HLC_DEBUG.mkall || []).push([R.name, mmw.toFixed(1), mmh.toFixed(1), Bk[4]]);
        if (mmw < 18 || mmw > 48 || mmh < 18 || mmh > 48 || ar < 0.75 || ar > 1.33) continue;
        var fill = Bk[4] / (bw * bh);
        if (fill > 0.6) continue;
        // a printed square: ink runs along at least three of its four sides
        var band = Math.max(3, Math.round(2.5 * nominal)), sides = 0;
        for (var sd = 0; sd < 4; sd++) {
          var horiz = sd < 2, len = horiz ? bw : bh, hit = 0;
          for (var t2 = 0; t2 < len; t2++) {
            var found = false;
            for (var d2 = 0; d2 < band && !found; d2++) {
              var xx3 = horiz ? Bk[0] + t2 : (sd === 2 ? Bk[0] + d2 : Bk[2] - d2);
              var yy3 = horiz ? (sd === 0 ? Bk[1] + d2 : Bk[3] - d2) : Bk[1] + t2;
              if (m[yy3 * OW + xx3]) found = true;
            }
            if (found) hit++;
          }
          if (hit / len >= 0.6) sides++;
        }
        if (sides < 3) continue;
        var score = Bk[4];
        if (!best || score > best.score) {
          // the dilation above grew the outline by 2 px on every side
          best = {
            score: score, corner: R.name,
            box: [R.u0 + (Bk[0] + 2) / scaleHi, R.v0 + (Bk[1] + 2) / scaleHi, R.u0 + (Bk[2] - 1) / scaleHi, R.v0 + (Bk[3] - 1) / scaleHi]
          };
        }
      }
    }
    return best;
  }
  function mulH(A, B) {
    var C = new Array(9);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    }
    return C;
  }

  // ------------------------------------------------------------------ filtering
  function gaussKernel(sigma) {
    var r = Math.ceil(3 * sigma), k = new Float32Array(2 * r + 1), s = 0;
    for (var i = -r; i <= r; i++) { k[i + r] = Math.exp(-0.5 * (i / sigma) * (i / sigma)); s += k[i + r]; }
    for (i = 0; i < k.length; i++) k[i] /= s;
    return k;
  }
  function convSep(src, W, H, k) {
    var r = (k.length - 1) >> 1, tmp = new Float32Array(W * H), out = new Float32Array(W * H), x, y, j, acc, n = k.length;
    function mir(v, L) { return v < 0 ? -v : v >= L ? 2 * L - 2 - v : v; }
    for (y = 0; y < H; y++) {
      var row = y * W;
      for (x = 0; x < W; x++) {
        acc = 0;
        if (x >= r && x < W - r) { var b = row + x - r; for (j = 0; j < n; j++) acc += k[j] * src[b + j]; }
        else for (j = -r; j <= r; j++) acc += k[j + r] * src[row + mir(x + j, W)];
        tmp[row + x] = acc;
      }
    }
    for (y = 0; y < H; y++) {
      var interior = y >= r && y < H - r;
      for (x = 0; x < W; x++) {
        acc = 0;
        if (interior) { var b2 = (y - r) * W + x; for (j = 0; j < n; j++) acc += k[j] * tmp[b2 + j * W]; }
        else for (j = -r; j <= r; j++) acc += k[j + r] * tmp[mir(y + j, H) * W + x];
        out[y * W + x] = acc;
      }
    }
    return out;
  }
  // robust background: block mean (factor 4) -> 9x9 median -> bilinear upsample
  function background(I, W, H, valid) {
    var f = 4, w = Math.ceil(W / f), h = Math.ceil(H / f), small = new Float32Array(w * h), cnt = new Float32Array(w * h);
    var x, y, i;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      i = y * W + x; if (!valid[i]) continue;
      var j = ((y / f) | 0) * w + ((x / f) | 0); small[j] += I[i]; cnt[j]++;
    }
    var fillv = 0, nf = 0;
    for (i = 0; i < w * h; i++) if (cnt[i]) { small[i] /= cnt[i]; fillv += small[i]; nf++; }
    fillv = nf ? fillv / nf : 128;
    var med = new Float32Array(w * h), buf = new Float32Array(81), R = 4;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var n = 0;
      for (var dy = -R; dy <= R; dy++) {
        var yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (var dx = -R; dx <= R; dx++) {
          var xx = x + dx; if (xx < 0 || xx >= w) continue;
          var q = yy * w + xx; if (cnt[q]) buf[n++] = small[q];
        }
      }
      if (!n) { med[y * w + x] = fillv; continue; }
      var arr = buf.subarray(0, n); arr.sort();
      med[y * w + x] = arr[n >> 1];
    }
    var out = new Float32Array(W * H);
    for (y = 0; y < H; y++) {
      var sy = (y + 0.5) / f - 0.5, y0 = Math.max(0, Math.min(h - 1, Math.floor(sy))), y1 = Math.min(h - 1, y0 + 1), fy = Math.max(0, Math.min(1, sy - y0));
      for (x = 0; x < W; x++) {
        var sx = (x + 0.5) / f - 0.5, x0 = Math.max(0, Math.min(w - 1, Math.floor(sx))), x1 = Math.min(w - 1, x0 + 1), fx = Math.max(0, Math.min(1, sx - x0));
        out[y * W + x] = (med[y0 * w + x0] * (1 - fx) + med[y0 * w + x1] * fx) * (1 - fy) + (med[y1 * w + x0] * (1 - fx) + med[y1 * w + x1] * fx) * fy;
      }
    }
    return out;
  }
  // oriented line filter on D (already a centre-surround response): max/min of the
  // oriented integration over nTheta directions (linear interpolation across the minor axis)
  async function orientedMaxMin(D, W, H, opt, progress, p0, p1) {
    var maxR = new Float32Array(W * H).fill(-1e9), minR = new Float32Array(W * H).fill(1e9);
    var argMax = new Uint8Array(W * H), argMin = new Uint8Array(W * H);
    var K = opt.nTheta, RL = opt.alongRadius, sig = opt.alongSigma, M = RL + 2;
    for (var k = 0; k < K; k++) {
      var th = Math.PI * k / K, c = Math.cos(th), s = Math.sin(th);
      var off0 = [], off1 = [], w0 = [], w1 = [], wsum = 0, i, t;
      if (Math.abs(c) >= Math.abs(s)) {
        var tn = s / c, n = Math.floor(RL * Math.abs(c));
        for (t = -n; t <= n; t++) {
          var dy = t * tn, y0 = Math.floor(dy), fy = dy - y0, dist = t / Math.abs(c);
          var wt = Math.exp(-0.5 * (dist / sig) * (dist / sig));
          off0.push(y0 * W + t); off1.push((y0 + 1) * W + t); w0.push(wt * (1 - fy)); w1.push(wt * fy); wsum += wt;
        }
      } else {
        var ct = c / s, n2 = Math.floor(RL * Math.abs(s));
        for (t = -n2; t <= n2; t++) {
          var dx = t * ct, x0 = Math.floor(dx), fx = dx - x0, dist2 = t / Math.abs(s);
          var wt2 = Math.exp(-0.5 * (dist2 / sig) * (dist2 / sig));
          off0.push(t * W + x0); off1.push(t * W + x0 + 1); w0.push(wt2 * (1 - fx)); w1.push(wt2 * fx); wsum += wt2;
        }
      }
      var nt = off0.length, O0 = new Int32Array(off0), O1 = new Int32Array(off1), W0 = new Float32Array(nt), W1 = new Float32Array(nt);
      for (i = 0; i < nt; i++) { W0[i] = w0[i] / wsum; W1[i] = w1[i] / wsum; }
      var ry0 = opt.roi ? Math.max(M, opt.roi[1]) : M, ry1 = opt.roi ? Math.min(H - M, opt.roi[3]) : H - M, rx0 = opt.roi ? Math.max(M, opt.roi[0]) : M, rx1 = opt.roi ? Math.min(W - M, opt.roi[2]) : W - M;
      for (var y = ry0; y < ry1; y++) {
        var row = y * W;
        for (var x = rx0; x < rx1; x++) {
          var p = row + x, acc = 0;
          for (var j = 0; j < nt; j++) acc += W0[j] * D[p + O0[j]] + W1[j] * D[p + O1[j]];
          if (acc > maxR[p]) { maxR[p] = acc; argMax[p] = k; }
          if (acc < minR[p]) { minR[p] = acc; argMin[p] = k; }
        }
      }
      if (progress) progress(p0 + (p1 - p0) * (k + 1) / K, 'line');
      await tick();
    }
    for (var q = 0; q < W * H; q++) { if (maxR[q] < 0) maxR[q] = 0; minR[q] = minR[q] > 0 ? 0 : -minR[q]; }
    return { dark: maxR, bright: minR, argDark: argMax, argBright: argMin };
  }
  // non-maximum suppression across the line direction: keeps 1-px ridge centres
  function nms(S, arg, W, H, K) {
    var out = new Float32Array(W * H), cs = [], sn = [];
    for (var k = 0; k < K; k++) { var th = Math.PI * k / K; cs.push(-Math.sin(th)); sn.push(Math.cos(th)); }
    function bil(x, y) {
      var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, p = y0 * W + x0;
      return (S[p] * (1 - fx) + S[p + 1] * fx) * (1 - fy) + (S[p + W] * (1 - fx) + S[p + W + 1] * fx) * fy;
    }
    for (var y = 2; y < H - 2; y++) for (var x = 2; x < W - 2; x++) {
      var p = y * W + x, v = S[p]; if (v <= 0) continue;
      var a = arg[p], nx = cs[a], ny = sn[a];
      if (v >= bil(x + nx, y + ny) && v > bil(x - nx, y - ny)) out[p] = v;
    }
    return out;
  }
  function maxFilter(S, W, H, r) {
    var tmp = new Float32Array(W * H), out = new Float32Array(W * H), x, y, k, m;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      m = -1e9; for (k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) if (S[y * W + k] > m) m = S[y * W + k];
      tmp[y * W + x] = m;
    }
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      m = -1e9; for (k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) if (tmp[k * W + x] > m) m = tmp[k * W + x];
      out[y * W + x] = m;
    }
    return out;
  }
  function robustStats(S, valid, N) {
    var vals = [], step = 23;
    for (var i = 0; i < N; i += step) if (valid[i]) vals.push(S[i]);
    if (vals.length < 10) return { med: 0, sigma: 1 };
    vals.sort(function (a, b) { return a - b; });
    var med = vals[vals.length >> 1];
    var dev = vals.map(function (v) { return Math.abs(v - med); }).sort(function (a, b) { return a - b; });
    var mad = dev[dev.length >> 1];
    return { med: med, sigma: 1.4826 * mad + 1e-9 };
  }
  function hysteresis(S, valid, W, H, lo, hi) {
    var N = W * H, out = new Uint8Array(N), stack = new Int32Array(N), sp = 0, i;
    for (i = 0; i < N; i++) if (valid[i] && S[i] > hi) { out[i] = 1; stack[sp++] = i; }
    while (sp) {
      var p = stack[--sp], y = (p / W) | 0, x = p - y * W;
      for (var dy = -1; dy <= 1; dy++) {
        var yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (var dx = -1; dx <= 1; dx++) {
          var xx = x + dx; if (xx < 0 || xx >= W) continue;
          var q = yy * W + xx;
          if (!out[q] && valid[q] && S[q] > lo) { out[q] = 1; stack[sp++] = q; }
        }
      }
    }
    return out;
  }
  function removeSmall(mask, W, H, minArea) {
    var lab = new Int32Array(W * H), n = label8(mask, W, H, lab), cnt = new Int32Array(n + 1), i;
    for (i = 0; i < W * H; i++) cnt[lab[i]]++;
    for (i = 0; i < W * H; i++) if (mask[i] && cnt[lab[i]] < minArea) mask[i] = 0;
    return mask;
  }
  function removeShort(mask, W, H, minSkel) {
    var sk = skeletonize(mask.slice(), W, H), lab = new Int32Array(W * H), n = label8(mask, W, H, lab);
    var cnt = new Int32Array(n + 1), i;
    for (i = 0; i < W * H; i++) if (sk[i]) cnt[lab[i]]++;
    for (i = 0; i < W * H; i++) if (mask[i] && cnt[lab[i]] < minSkel) mask[i] = 0;
    return mask;
  }

  // ------------------------------------------------------------------ skeleton (Zhang-Suen)
  function skeletonize(m, W, H) {
    var img = m; // modified in place
    var list = [], i;
    for (i = 0; i < W * H; i++) {
      if (img[i]) {
        var y = (i / W) | 0, x = i - y * W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) img[i] = 0; else list.push(i);
      }
    }
    var changed = true, del = [];
    while (changed) {
      changed = false;
      for (var pass = 0; pass < 2; pass++) {
        del.length = 0;
        for (var t = 0; t < list.length; t++) {
          var p = list[t]; if (!img[p]) continue;
          var p2 = img[p - W], p3 = img[p - W + 1], p4 = img[p + 1], p5 = img[p + W + 1],
            p6 = img[p + W], p7 = img[p + W - 1], p8 = img[p - 1], p9 = img[p - W - 1];
          var B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          var A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (A !== 1) continue;
          if (pass === 0) { if (p2 * p4 * p6 || p4 * p6 * p8) continue; }
          else { if (p2 * p4 * p8 || p2 * p6 * p8) continue; }
          del.push(p);
        }
        for (t = 0; t < del.length; t++) img[del[t]] = 0;
        if (del.length) changed = true;
      }
      if (changed) list = list.filter(function (q) { return img[q]; });
    }
    return img;
  }

  // ------------------------------------------------------------------ skeleton graph
  var N8x = [-1, 0, 1, 1, 1, 0, -1, -1], N8y = [-1, -1, -1, 0, 1, 1, 1, 0]; // circular order
  function crossingNumber(sk, W, H) {
    var cn = new Uint8Array(W * H);
    for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
      var p = y * W + x; if (!sk[p]) continue;
      var c = 0;
      for (var k = 0; k < 8; k++) {
        var a = sk[p + N8y[k] * W + N8x[k]], b = sk[p + N8y[(k + 1) & 7] * W + N8x[(k + 1) & 7]];
        if (!a && b) c++;
      }
      cn[p] = c;
    }
    return cn;
  }
  // make the skeleton strictly 1-px (drop staircase pixels whose neighbours stay connected without them),
  // so that every pixel with 3+ neighbours is a real branch point
  function thinStairs(sk, W, H) {
    for (var pass = 0; pass < 2; pass++) {
      var removed = 0;
      for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
        var p = y * W + x; if (!sk[p]) continue;
        var nb = [], k;
        for (k = 0; k < 8; k++) if (sk[p + N8y[k] * W + N8x[k]]) nb.push(k);
        if (nb.length < 2) continue;
        // components among the neighbours (8-adjacency between neighbour pixels)
        var comp = nb.map(function (_, j) { return j; });
        for (var a = 0; a < nb.length; a++) for (var b = a + 1; b < nb.length; b++) {
          if (Math.abs(N8x[nb[a]] - N8x[nb[b]]) <= 1 && Math.abs(N8y[nb[a]] - N8y[nb[b]]) <= 1) {
            var ca = comp[a], cb = comp[b]; for (var c = 0; c < comp.length; c++) if (comp[c] === cb) comp[c] = ca;
          }
        }
        var one = true; for (var c2 = 1; c2 < comp.length; c2++) if (comp[c2] !== comp[0]) { one = false; break; }
        if (!one) continue;
        // keep line ends: removing p must not create a new end where the line simply continues (2 neighbours far apart)
        if (nb.length === 2) {
          var d = Math.abs(N8x[nb[0]] - N8x[nb[1]]) + Math.abs(N8y[nb[0]] - N8y[nb[1]]);
          if (d > 1) continue;
        }
        sk[p] = 0; removed++;
      }
      if (!removed) break;
    }
    return sk;
  }
  // remove short side branches (end pixel -> branch point within maxLen). They are too short to become
  // graph segments, but each one makes a branch point whose merge disc cuts the hair it sits on.
  function pruneSpurs(sk, W, H, maxLen) {
    for (var round = 0; round < 3; round++) {
      var N = W * H, deg = new Uint8Array(N), p, k, y, x, cut = 0;
      for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) { p = y * W + x; if (sk[p]) { var d = 0; for (k = 0; k < 8; k++) d += sk[p + N8y[k] * W + N8x[k]]; deg[p] = d; } }
      for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
        p = y * W + x; if (!sk[p] || deg[p] !== 1) continue;
        var walk = [p], prev = -1, cur = p, hit = false;
        while (walk.length <= maxLen) {
          var nx = -1, cy = (cur / W) | 0, cx = cur - cy * W;
          if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1) break;
          for (k = 0; k < 8; k++) { var q = cur + N8y[k] * W + N8x[k]; if (sk[q] && q !== prev && walk.indexOf(q) < 0) { if (deg[q] >= 3) { hit = true; break; } nx = q; } }
          if (hit || nx < 0) break;
          prev = cur; cur = nx; walk.push(cur);
        }
        if (hit && walk.length <= maxLen) { for (k = 0; k < walk.length; k++) sk[walk[k]] = 0; cut++; }
      }
      if (!cut) break;
      thinStairs(sk, W, H);
    }
    return sk;
  }
  function graphFromSk(sk, W, H, opt) {
    if (opt.thinStairs !== false) { thinStairs(sk, W, H); if (opt.preSpur !== false) pruneSpurs(sk, W, H, opt.preSpurLen || opt.lSpur); }
    var N = W * H, cn = crossingNumber(sk, W, H), Jd = new Uint8Array(N), i, k;
    var deg = new Uint8Array(N);
    if (opt.thinStairs !== false) for (var yq = 1; yq < H - 1; yq++) for (var xq = 1; xq < W - 1; xq++) { var pq = yq * W + xq; if (sk[pq]) { var dg = 0; for (k = 0; k < 8; k++) dg += sk[pq + N8y[k] * W + N8x[k]]; deg[pq] = dg; } }
    var r = opt.rMerge, offs = [];
    for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 1) offs.push([dx, dy]);
    for (i = 0; i < N; i++) {
      if (sk[i] && (cn[i] >= 3 || deg[i] >= 3)) {
        var y = (i / W) | 0, x = i - y * W;
        for (k = 0; k < offs.length; k++) {
          var xx = x + offs[k][0], yy = y + offs[k][1];
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) Jd[yy * W + xx] = 1;
        }
      }
    }
    var nlab = new Int32Array(N), nn = label8(Jd, W, H, nlab);
    var nbox = new Int32Array((nn + 1) * 4);
    for (k = 0; k <= nn; k++) { nbox[k * 4] = W; nbox[k * 4 + 1] = H; nbox[k * 4 + 2] = -1; nbox[k * 4 + 3] = -1; }
    for (i = 0; i < N; i++) if (nlab[i]) { var l4 = nlab[i] * 4, iy = (i / W) | 0, ix = i - iy * W; if (ix < nbox[l4]) nbox[l4] = ix; if (iy < nbox[l4 + 1]) nbox[l4 + 1] = iy; if (ix > nbox[l4 + 2]) nbox[l4 + 2] = ix; if (iy > nbox[l4 + 3]) nbox[l4 + 3] = iy; }
    var edge = new Uint8Array(N);
    for (i = 0; i < N; i++) edge[i] = (sk[i] && !nlab[i]) ? 1 : 0;
    var slab = new Int32Array(N), ns = label8(edge, W, H, slab);
    // gather pixels per segment
    var counts = new Int32Array(ns + 1);
    for (i = 0; i < N; i++) if (slab[i]) counts[slab[i]]++;
    var starts = new Int32Array(ns + 2);
    for (k = 1; k <= ns; k++) starts[k + 1] = starts[k] + counts[k];
    var pos = starts.slice(), pix = new Int32Array(starts[ns + 1]);
    for (i = 0; i < N; i++) if (slab[i]) pix[pos[slab[i]]++] = i;
    var G = { W: W, H: H, nn: nn, ns: ns, nbox: nbox, chains: [], att: [], dirs: [], length: [] };
    for (var s = 1; s <= ns; s++) {
      var seg = pix.subarray(starts[s], starts[s + 1]);
      var ch = chainOf(seg, slab, s, W, H);
      var at = [];
      for (var e = 0; e < 2; e++) {
        var q = e === 0 ? ch[0] : ch[ch.length - 1], qy = (q / W) | 0, qx = q - qy * W, best = 0, bc = 0, tally = {};
        for (var yy2 = Math.max(0, qy - 2); yy2 <= Math.min(H - 1, qy + 2); yy2++) {
          for (var xx2 = Math.max(0, qx - 2); xx2 <= Math.min(W - 1, qx + 2); xx2++) {
            var id = sk[yy2 * W + xx2] ? nlab[yy2 * W + xx2] : 0;
            if (id) { tally[id] = (tally[id] || 0) + 1; if (tally[id] > bc) { bc = tally[id]; best = id; } }
          }
        }
        at.push(best || null);
      }
      G.chains.push(ch);
      G.att.push(at);
      G.dirs.push([endDir(ch, 0, opt.kDir, W), endDir(ch, 1, opt.kDir, W)]);
      G.length.push(ch.length);
    }
    return G;
  }
  function chainOf(seg, slab, s, W, H) {
    if (seg.length === 1) return [seg[0]];
    // double BFS on the segment's pixel graph
    function bfs(src) {
      var par = new Map(); par.set(src, -1);
      var q = [src], head = 0, last = src;
      while (head < q.length) {
        var u = q[head++]; last = u;
        var y = (u / W) | 0, x = u - y * W;
        for (var k = 0; k < 8; k++) {
          var xx = x + N8x[k], yy = y + N8y[k];
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          var v = yy * W + xx;
          if (slab[v] === s && !par.has(v)) { par.set(v, u); q.push(v); }
        }
      }
      return { last: last, par: par };
    }
    var start = seg[0];
    for (var i = 0; i < seg.length; i++) { // prefer an end pixel (one neighbour)
      var u = seg[i], y = (u / W) | 0, x = u - y * W, c = 0;
      for (var k = 0; k < 8; k++) {
        var xx = x + N8x[k], yy = y + N8y[k];
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && slab[yy * W + xx] === s) c++;
      }
      if (c === 1) { start = u; break; }
    }
    var a = bfs(start).last, r2 = bfs(a), path = [], v2 = r2.last;
    while (v2 !== -1) { path.push(v2); v2 = r2.par.get(v2); }
    return path.reverse();
  }
  function endDir(ch, which, kd, W) {
    var n = ch.length; if (n < 2) return [0, 0];
    var c0 = which === 0 ? ch[0] : ch[n - 1], y0 = (c0 / W) | 0, x0 = c0 - y0 * W;
    var a = Math.min(2, n - 1), b = Math.min(kd, n - 1), sx = 0, sy = 0, m = 0;
    for (var i = a; i <= b; i++) {
      var p = which === 0 ? ch[i] : ch[n - 1 - i], y = (p / W) | 0, x = p - y * W;
      sx += x - x0; sy += y - y0; m++;
    }
    var L = Math.hypot(sx, sy);
    return L > 0 ? [sx / L, sy / L] : [0, 0];
  }
  function buildGraph(mask, W, H, opt) {
    var sk = skeletonize(mask.slice(), W, H), G;
    for (var round = 0; round < 4; round++) {
      G = graphFromSk(sk, W, H, opt);
      var drop = [];
      for (var s = 0; s < G.ns; s++) {
        var a = G.att[s][0], b = G.att[s][1];
        if (((a === null) !== (b === null)) && G.length[s] < opt.lSpur) drop.push(s);
        else if (a === null && b === null && G.length[s] < opt.lSpur) drop.push(s);
      }
      if (!drop.length || round === 3) break;
      for (var d = 0; d < drop.length; d++) { var ch = G.chains[drop[d]]; for (var i = 0; i < ch.length; i++) sk[ch[i]] = 0; }
      sk = skeletonize(sk, W, H);
    }
    G.sk = sk;
    // contract short node-node bridges
    var parent = []; for (var n = 0; n <= G.nn; n++) parent.push(n);
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    G.bridges = new Set();
    for (s = 0; s < G.ns; s++) {
      var a2 = G.att[s][0], b2 = G.att[s][1];
      if (a2 !== null && b2 !== null && G.length[s] < opt.lBridge) {
        var ra = find(a2), rb = find(b2), bb = G.nbox;
        if (ra !== rb && opt.maxNodeSpan) {   // do not let chains of bridges grow one crossing over a whole clump
          var ex = Math.max(bb[ra * 4 + 2], bb[rb * 4 + 2]) - Math.min(bb[ra * 4], bb[rb * 4]), ey = Math.max(bb[ra * 4 + 3], bb[rb * 4 + 3]) - Math.min(bb[ra * 4 + 1], bb[rb * 4 + 1]);
          if (Math.max(ex, ey) > opt.maxNodeSpan) continue;
        }
        G.bridges.add(s);
        if (ra !== rb) { parent[ra] = rb; for (var z = 0; z < 2; z++) { bb[rb * 4 + z] = Math.min(bb[rb * 4 + z], bb[ra * 4 + z]); bb[rb * 4 + 2 + z] = Math.max(bb[rb * 4 + 2 + z], bb[ra * 4 + 2 + z]); } }
      }
    }
    G.att = G.att.map(function (at) { return at.map(function (x) { return x === null ? null : find(x); }); });
    return G;
  }
  function bestMatching(dirs, u) {
    var m = dirs.length, C = [], i, j;
    for (i = 0; i < m; i++) { C.push([]); for (j = 0; j < m; j++) C[i].push(1 + dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1]); }
    if (m > 10) {
      var cand = [];
      for (i = 0; i < m; i++) for (j = i + 1; j < m; j++) cand.push([C[i][j], i, j]);
      cand.sort(function (a, b) { return a[0] - b[0]; });
      var used = new Set(), pairs = [];
      for (var t = 0; t < cand.length; t++) {
        var cc = cand[t];
        if (cc[0] < 2 * u && !used.has(cc[1]) && !used.has(cc[2])) { pairs.push([cc[1], cc[2]]); used.add(cc[1]); used.add(cc[2]); }
      }
      return pairs;
    }
    var best = { cost: Infinity, pairs: [] };
    function rec(rem, cost, pairs) {
      if (cost >= best.cost) return;
      if (!rem.length) { best.cost = cost; best.pairs = pairs.slice(); return; }
      var i0 = rem[0], rest = rem.slice(1);
      rec(rest, cost + u, pairs);
      for (var t2 = 0; t2 < rest.length; t2++) {
        var j0 = rest[t2];
        pairs.push([i0, j0]);
        rec(rest.slice(0, t2).concat(rest.slice(t2 + 1)), cost + C[i0][j0], pairs);
        pairs.pop();
      }
    }
    var all = []; for (i = 0; i < m; i++) all.push(i);
    rec(all, 0, []);
    return best.pairs;
  }
  function traceHairs(G, opt, invalid) {
    var W = G.W, link = new Map(), nodePorts = new Map(), s, e;
    function key(s2, e2) { return s2 * 2 + e2; }
    for (s = 0; s < G.ns; s++) {
      if (G.bridges.has(s)) continue;
      for (e = 0; e < 2; e++) {
        var a = G.att[s][e];
        if (a !== null) { if (!nodePorts.has(a)) nodePorts.set(a, []); nodePorts.get(a).push(key(s, e)); }
      }
    }
    nodePorts.forEach(function (ports) {
      if (ports.length === 2) { link.set(ports[0], ports[1]); link.set(ports[1], ports[0]); return; }
      var dirs = ports.map(function (pk) { return G.dirs[pk >> 1][pk & 1]; });
      var uu = ports.length % 2 === 0 ? opt.uEven : opt.uOdd;
      bestMatching(dirs, uu).forEach(function (pr) { link.set(ports[pr[0]], ports[pr[1]]); link.set(ports[pr[1]], ports[pr[0]]); });
    });
    // gap closing between terminal ports (good continuation)
    var term = [];
    for (s = 0; s < G.ns; s++) { if (G.bridges.has(s)) continue; for (e = 0; e < 2; e++) if (!link.has(key(s, e))) term.push(key(s, e)); }
    function endPt(pk) { var ch = G.chains[pk >> 1], q = (pk & 1) === 0 ? ch[0] : ch[ch.length - 1], y = (q / W) | 0; return [q - y * W, y]; }
    var cand = [], maxD = Math.max(opt.gapMax, invalid ? opt.gapMaxInvalid : 0);
    var tp = term.map(endPt);
    for (var i = 0; i < term.length; i++) {
      for (var j = i + 1; j < term.length; j++) {
        if ((term[i] >> 1) === (term[j] >> 1)) continue;
        var p1 = tp[i], p2 = tp[j], dxx = p2[0] - p1[0], dyy = p2[1] - p1[1], d = Math.hypot(dxx, dyy);
        if (d < 1e-6 || d > maxD) continue;
        var lim = opt.gapMax, cmin = opt.gapCos;
        if (d > opt.gapMax) {
          if (!invalid) continue;
          var hit = 0;
          for (var t = 0; t <= 24; t++) {
            var xx = Math.round(p1[0] + dxx * t / 24), yy = Math.round(p1[1] + dyy * t / 24);
            if (invalid[yy * W + xx]) hit++;
          }
          if (hit / 25 < 0.4) continue;
          lim = opt.gapMaxInvalid; cmin = opt.gapCosInvalid;
        }
        if (d > lim) continue;
        var wx = dxx / d, wy = dyy / d, o1 = G.dirs[term[i] >> 1][term[i] & 1], o2 = G.dirs[term[j] >> 1][term[j] & 1];
        var c1 = -(o1[0] * wx + o1[1] * wy), c2 = (o2[0] * wx + o2[1] * wy);
        if (c1 > cmin && c2 > cmin) cand.push([d * (3 - c1 - c2), term[i], term[j]]);
      }
    }
    cand.sort(function (a, b) { return a[0] - b[0]; });
    var used = new Set(), gaplinks = 0;
    cand.forEach(function (c) {
      if (used.has(c[1]) || used.has(c[2])) return;
      link.set(c[1], c[2]); link.set(c[2], c[1]); used.add(c[1]); used.add(c[2]); gaplinks++;
    });
    // walk
    var visited = new Uint8Array(G.ns), hairs = [];
    function walk(s0, e0) {
      var segs = [], s1 = s0, e1 = e0;
      while (true) {
        visited[s1] = 1; segs.push([s1, e1]);
        var nxt = link.get(key(s1, 1 - e1));
        if (nxt === undefined || visited[nxt >> 1]) return segs;
        s1 = nxt >> 1; e1 = nxt & 1;
      }
    }
    var starts = [];
    for (s = 0; s < G.ns; s++) { if (G.bridges.has(s)) continue; for (e = 0; e < 2; e++) if (!link.has(key(s, e))) starts.push([s, e]); }
    var terminals = [];
    starts.forEach(function (st) {
      var pk = key(st[0], st[1]), a3 = G.att[st[0]][st[1]];
      var onCross = a3 !== null && nodePorts.has(a3) && nodePorts.get(a3).length >= 3;
      terminals.push({ pt: endPt(pk), onCrossing: onCross });
      if (!visited[st[0]]) hairs.push(walk(st[0], st[1]));
    });
    var cycles = 0;
    for (s = 0; s < G.ns; s++) { if (G.bridges.has(s) || visited[s]) continue; hairs.push(walk(s, 0)); cycles++; }
    var out = hairs.map(function (segs) {
      var pts = [];
      segs.forEach(function (se) {
        var ch = G.chains[se[0]], first = se[1] === 0 ? ch[0] : ch[ch.length - 1];
        if (opt.joinLine !== false && pts.length) {   // draw through the crossing / gap so the hair stays one line
          var pa = pts[pts.length - 1], ay = (pa / W) | 0, ax = pa - ay * W, by = (first / W) | 0, bx = first - by * W, nn = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
          if (nn <= (opt.joinMax || 24)) for (var t5 = 1; t5 < nn; t5++) pts.push(Math.round(ay + (by - ay) * t5 / nn) * W + Math.round(ax + (bx - ax) * t5 / nn));
        }
        if (se[1] === 0) for (var a4 = 0; a4 < ch.length; a4++) pts.push(ch[a4]); else for (var b4 = ch.length - 1; b4 >= 0; b4--) pts.push(ch[b4]);
      });
      return pts;
    });
    return { paths: out, terminals: terminals, cycles: cycles, gaplinks: gaplinks, nodes: nodePorts.size };
  }

  // ------------------------------------------------------------------ main
  HLC.analyze = async function (img, userOpt, progress) {
    var opt = {}, k;
    for (k in DEFAULTS) opt[k] = DEFAULTS[k];
    for (k in (userOpt || {})) opt[k] = userOpt[k];
    var T0 = Date.now(), timings = {};
    function step(name) { timings[name] = Date.now() - T0; }
    var w = img.width, h = img.height, rgba = img.data;
    if (progress) progress(0.02, 'sheet');
    var sheet = opt.noSheet ? { ok: true, corners: [[0, 0], [w, 0], [w, h], [0, h]], cornerOutside: false }
      : detectSheet(rgba, w, h);
    step('sheet');
    if (!sheet.ok) return { ok: false, error: sheet.reason, timings: timings };
    // corner order: TL, TR, BR, BL in the image. Make the long side vertical.
    var c = sheet.corners;
    var top = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) + Math.hypot(c[2][0] - c[3][0], c[2][1] - c[3][1]);
    var side = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]) + Math.hypot(c[2][0] - c[1][0], c[2][1] - c[1][1]);
    if (top > side) c = [c[3], c[0], c[1], c[2]]; // rotate so that the long sides run top-bottom
    var ratio = Math.max(top, side) / Math.min(top, side);
    var aspect = (!opt.noSheet && Math.abs(ratio - Math.SQRT2) < 0.15) ? Math.SQRT2 : ratio;
    var WW = opt.workWidth, WH = Math.round(WW * aspect);
    await tick();
    // marker: search the four corners; rotate so that it ends at bottom-left
    var mk = findMarker(rgba, w, h, c, WW, WH);
    if (mk) {
      var rot = { bl: 0, br: 1, tr: 2, tl: 3 }[mk.corner];
      for (var rr = 0; rr < rot; rr++) c = [c[1], c[2], c[3], c[0]];
      if (rot) mk = findMarker(rgba, w, h, c, WW, WH);
    }
    step('marker');
    if (progress) progress(0.08, 'warp');
    var Hws = homography([[0, 0], [WW, 0], [WW, WH], [0, WH]], c);
    var wp = warp(rgba, w, h, Hws, WW, WH);
    step('warp');
    await tick();
    var pxmm, scaleFromMarker = false;
    if (mk) {
      var bw = mk.box[2] - mk.box[0], bh = mk.box[3] - mk.box[1];
      pxmm = (bw + bh) / 2 / opt.markerMm; scaleFromMarker = true;
    } else {
      pxmm = WW / opt.sheetWidthMm;
    }
    // validity: inside source image, away from sheet border and marker
    var N = WW * WH, valid = new Uint8Array(N), invalid = new Uint8Array(N), bpx = Math.round(opt.borderMm * pxmm), i, x, y;
    var pad = opt.markerPadMm * pxmm;
    for (y = 0; y < WH; y++) for (x = 0; x < WW; x++) {
      i = y * WW + x;
      var inMarker = mk && x > mk.box[0] - pad && x < mk.box[2] + pad && y > mk.box[1] - pad && y < mk.box[3] + pad;
      var v = wp.inside[i] && x >= bpx && y >= bpx && x < WW - bpx && y < WH - bpx && !inMarker;
      valid[i] = v ? 1 : 0;
      invalid[i] = (inMarker || !wp.inside[i]) ? 1 : 0;
    }
    if (progress) progress(0.12, 'map');
    // hair map: signed intensity ratio (dark hair > 0, white hair < 0)
    var I = new Float32Array(N), px = wp.rgba;
    for (i = 0; i < N; i++) I[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
    var Ib = background(I, WW, WH, valid), m = new Float32Array(N);
    for (i = 0; i < N; i++) m[i] = valid[i] ? Math.max(-1, Math.min(1, 1 - I[i] / (Ib[i] + 1))) : 0;
    var g1 = convSep(m, WW, WH, gaussKernel(1.0)), g3 = convSep(m, WW, WH, gaussKernel(3.0)), D = new Float32Array(N);
    for (i = 0; i < N; i++) D[i] = g1[i] - g3[i];
    // sharpness: thin hairs answer the fine-scale filter much more than a coarse one; blurred hairs do not
    var g2 = convSep(m, WW, WH, gaussKernel(2.0)), g6 = convSep(g3, WW, WH, gaussKernel(5.2));
    var fineV = [], coarseV = [];
    var detQ = boxMaxMin(valid, WW, WH, 20, false);
    for (i = 0; i < N; i += 3) if (detQ[i]) { fineV.push(Math.abs(g1[i] - g2[i])); coarseV.push(Math.abs(g3[i] - g6[i])); }
    function pct(a, q) { if (!a.length) return 0; a.sort(function (x, y) { return x - y; }); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; }
    var fine = pct(fineV, 0.998), coarse = pct(coarseV, 0.998), sharpness = coarse > 0 ? fine / coarse : 0;
    g2 = g6 = fineV = coarseV = null;
    step('map');
    await tick();
    var LS = await orientedMaxMin(D, WW, WH, opt, progress, 0.15, 0.8);
    step('line');
    if (progress) progress(0.82, 'segment');
    // the filter's support makes the zeroed area beyond the valid border look like an edge: stay clear of it
    var det = boxMaxMin(valid, WW, WH, opt.alongRadius + 4, false);
    var stD = robustStats(LS.dark, det, N), stB = robustStats(LS.bright, det, N);
    var sens = opt.sensitivity || 1;
    var nd = nms(LS.dark, LS.argDark, WW, WH, opt.nTheta), nb = nms(LS.bright, LS.argBright, WW, WH, opt.nTheta);
    var md = hysteresis(nd, det, WW, WH, stD.med + opt.kLo / sens * stD.sigma, stD.med + opt.kHi / sens * stD.sigma);
    var mb = hysteresis(nb, det, WW, WH, stB.med + opt.kLo / sens * stB.sigma, stB.med + opt.kHi / sens * stB.sigma);
    // a thin line's filter response has weaker opposite-sign side lobes about 3 px to each side:
    // a white hair shows up as a bright ridge flanked by two weak 'dark' ridges, and vice versa.
    // Keep a ridge only where it beats the opposite polarity nearby.
    var dMax = maxFilter(LS.dark, WW, WH, 5), bMax = maxFilter(LS.bright, WW, WH, 5);
    for (i = 0; i < N; i++) {
      if (md[i] && LS.dark[i] <= bMax[i]) md[i] = 0;
      if (mb[i] && LS.bright[i] <= dMax[i]) mb[i] = 0;
    }
    var near = boxMaxMin(md, WW, WH, 2, true);
    // a white or grey hair also pulls the colour toward neutral; a bright strip of sheet between two
    // dark hairs keeps the sheet's green. Keep bright ridges only where the colour actually moves.
    var cgv = new Float32Array(N);
    for (i = 0; i < N; i++) { var o4 = i * 4, sm = px[o4] + px[o4 + 1] + px[o4 + 2] + 1; cgv[i] = px[o4 + 1] / sm; }
    var cgb = background(cgv, WW, WH, valid);
    var blab = new Int32Array(N), nbl = label8(mb, WW, WH, blab);
    if (nbl) {
      var sh = new Float64Array(nbl + 1), cn2 = new Int32Array(nbl + 1);
      for (i = 0; i < N; i++) if (blab[i]) { sh[blab[i]] += cgb[i] - cgv[i]; cn2[blab[i]]++; }
      for (i = 0; i < N; i++) if (blab[i] && sh[blab[i]] / cn2[blab[i]] < 0.02) mb[i] = 0;
    }
    removeSmall(md, WW, WH, opt.minAreaPx); removeSmall(mb, WW, WH, opt.minAreaPx);
    removeShort(md, WW, WH, opt.minSkelPx); removeShort(mb, WW, WH, opt.minSkelPx);
    var mask = new Uint8Array(N), white = new Uint8Array(N);
    for (i = 0; i < N; i++) { mask[i] = md[i] | mb[i]; white[i] = mb[i]; }
    // small closing (3x3 cross)
    var cl = new Uint8Array(N);
    for (y = 1; y < WH - 1; y++) for (x = 1; x < WW - 1; x++) {
      i = y * WW + x;
      cl[i] = mask[i] || ((mask[i - 1] && mask[i + 1]) || (mask[i - WW] && mask[i + WW])) ? 1 : 0;
    }
    step('segment');
    await tick();
    if (progress) progress(0.88, 'trace');
    var G = buildGraph(cl, WW, WH, opt);
    var tr = traceHairs(G, opt, invalid);
    if (typeof __HLC_DEBUG !== 'undefined' && __HLC_DEBUG) {   // test hook (Node only)
      var dbgN = graphFromSk(G.sk, WW, WH, opt);
      __HLC_DEBUG.mask = cl; __HLC_DEBUG.sk = G.sk; __HLC_DEBUG.terminals = tr.terminals; __HLC_DEBUG.md = md; __HLC_DEBUG.mb = mb;
      var nl = new Int32Array(N); for (var dq = 0; dq < N; dq++) nl[dq] = 0;
      var cnq = crossingNumber(G.sk, WW, WH); for (dq = 0; dq < N; dq++) if (cnq[dq] >= 3) nl[dq] = 1;
      __HLC_DEBUG.nlab = nl;
    }
    step('trace');
    var minLen = opt.minLenMm * pxmm, hairs = [];
    // total detected hair length (all traced pieces >= 3 mm): splitting a hair into pieces does not change it
    var totalPx = 0;
    tr.paths.forEach(function (p) {
      var L = 0;
      for (var a = 1; a < p.length; a++) {
        var y1 = (p[a] / WW) | 0, x1 = p[a] - y1 * WW, y0 = (p[a - 1] / WW) | 0, x0 = p[a - 1] - y0 * WW;
        L += Math.min(3, Math.hypot(x1 - x0, y1 - y0));   // gap-closing jumps count at most 3 px
      }
      if (L >= 3 * pxmm) totalPx += L;
    });
    var totalLengthMm = totalPx / pxmm;
    // coverage: area within 2.5 mm of any detected hair; length per covered area grows with clumping
    var covR = Math.max(2, Math.round(2.5 * pxmm)), cov = boxMaxMin(G.sk, WW, WH, covR, true), covPx = 0;
    for (i = 0; i < N; i++) if (cov[i] && valid[i]) covPx++;
    var coverMm2 = covPx / (pxmm * pxmm), density = coverMm2 > 0 ? totalLengthMm / coverMm2 : 0;
    tr.paths.forEach(function (p) {
      var L = 0, nw = 0;
      for (var a = 1; a < p.length; a++) {
        var y1 = (p[a] / WW) | 0, x1 = p[a] - y1 * WW, y0 = (p[a - 1] / WW) | 0, x0 = p[a - 1] - y0 * WW;
        L += Math.hypot(x1 - x0, y1 - y0);
      }
      for (a = 0; a < p.length; a++) if (white[p[a]]) nw++;
      if (L >= minLen) {
        var pts = new Int32Array(p.length * 2);
        for (a = 0; a < p.length; a++) { pts[2 * a] = p[a] % WW; pts[2 * a + 1] = (p[a] / WW) | 0; }
        hairs.push({ pts: pts, lengthMm: L / pxmm, white: nw > 0.5 * p.length });
      }
    });
    // review flags: hair ends sitting on a crossing, or near an unreliable zone (marker, frame edge)
    var nearR = Math.round(opt.flagNearMm * pxmm), nearInv = boxMaxMin(invalid, WW, WH, nearR, true);
    var endsKept = new Set();
    hairs.forEach(function (hh) {
      var n2 = hh.pts.length;
      endsKept.add(hh.pts[1] * WW + hh.pts[0]); endsKept.add(hh.pts[n2 - 1] * WW + hh.pts[n2 - 2]);
    });
    var flags = [];
    tr.terminals.forEach(function (t) {
      var id = t.pt[1] * WW + t.pt[0];
      if (!endsKept.has(id)) return;
      if (t.onCrossing) flags.push({ x: t.pt[0], y: t.pt[1], kind: 'crossing' });
      else if (nearInv[id]) flags.push({ x: t.pt[0], y: t.pt[1], kind: 'edge' });
    });
    var warnings = [], reject = [];
    if (sharpness < 0.9) reject.push('blurred');
    else if (sharpness < 1.05) warnings.push('slightly-blurred');
    if (!opt.noSheet && Math.abs(ratio - Math.SQRT2) > 0.15) reject.push('sheet-shape');
    if (!mk) warnings.push('marker-not-found');
    if (sheet.cornerOutside) warnings.push('sheet-cut');
    var srcPxPerMm = pxmm * (Math.max(top, side) / 2) / WH; // approx source resolution on the sheet
    if (srcPxPerMm < 5) warnings.push('low-resolution');
    if (hairs.length && flags.length > 0.5 * hairs.length + 3) warnings.push('dense');
    timings.total = Date.now() - T0;
    if (progress) progress(1, 'done');
    return {
      ok: true, count: hairs.length, hairs: hairs, flags: flags, warnings: warnings, reject: reject,
      pxPerMm: pxmm, scaleFromMarker: scaleFromMarker, marker: mk ? mk.box : null,
      corners: c, work: { width: WW, height: WH, rgba: wp.rgba },
      sharpness: sharpness, fine: fine, coarse: coarse,
      totalLengthMm: totalLengthMm, coverMm2: coverMm2, density: density,
      countByLength: opt.hairLenMm ? totalLengthMm / opt.hairLenMm : null,
      stats: { nodes: tr.nodes, gaplinks: tr.gaplinks, cycles: tr.cycles, noiseDark: stD, noiseBright: stB, srcPxPerMm: srcPxPerMm },
      timings: timings
    };
  };

  // ====================================================================== v2: any surface, multi-shot
  function resizeArea(img, W, H) {
    var w = img.width, h = img.height, src = img.data, out = new Uint8ClampedArray(W * H * 4), fx = w / W, fy = h / H;
    for (var y = 0; y < H; y++) {
      var y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) * fy)));
      for (var x = 0; x < W; x++) {
        var x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) * fx)));
        var r = 0, g = 0, b = 0, n = 0;
        for (var yy = y0; yy < y1; yy++) { var p = (yy * w + x0) * 4; for (var xx = x0; xx < x1; xx++, p += 4) { r += src[p]; g += src[p + 1]; b += src[p + 2]; n++; } }
        var o = (y * W + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
      }
    }
    return out;
  }
  function workSize(img, opt) {
    var ww = (opt && opt.workWidth) || DEFAULTS.workWidth, portrait = img.height >= img.width;
    var W = portrait ? ww : Math.round(ww * img.width / img.height), H = portrait ? Math.round(ww * img.height / img.width) : ww;
    if (img.width < W) { W = img.width; H = img.height; }
    return [W, H];
  }
  HLC.toWork = function (img, opt) { var s = workSize(img, opt); return { width: s[0], height: s[1], data: resizeArea(img, s[0], s[1]) }; };

  function blockMean(a, W, H, f, stride, off) {     // a: Float32 (stride 1) or RGBA (stride 4, channel off)
    var w = Math.ceil(W / f), h = Math.ceil(H / f), out = new Float32Array(w * h), cnt = new Float32Array(w * h);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) { var j = ((y / f) | 0) * w + ((x / f) | 0); out[j] += a[(y * W + x) * stride + off]; cnt[j]++; }
    for (var i = 0; i < w * h; i++) out[i] /= cnt[i];
    return { a: out, w: w, h: h };
  }
  function medianSmall(a, w, h, R) {
    var out = new Float32Array(w * h), buf = new Float32Array((2 * R + 1) * (2 * R + 1));
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var n = 0;
      for (var dy = -R; dy <= R; dy++) { var yy = y + dy; if (yy < 0 || yy >= h) continue; for (var dx = -R; dx <= R; dx++) { var xx = x + dx; if (xx < 0 || xx >= w) continue; buf[n++] = a[yy * w + xx]; } }
      var s = buf.subarray(0, n); s.sort(); out[y * w + x] = s[n >> 1];
    }
    return out;
  }
  function upBilinear(a, w, h, W, H) {
    var out = new Float32Array(W * H), fx = w / W, fy = h / H;
    for (var y = 0; y < H; y++) {
      var sy = (y + 0.5) * fy - 0.5, y0 = Math.max(0, Math.min(h - 1, Math.floor(sy))), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, Math.min(1, sy - y0));
      for (var x = 0; x < W; x++) {
        var sx = (x + 0.5) * fx - 0.5, x0 = Math.max(0, Math.min(w - 1, Math.floor(sx))), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, Math.min(1, sx - x0));
        out[y * W + x] = (a[y0 * w + x0] * (1 - tx) + a[y0 * w + x1] * tx) * (1 - ty) + (a[y1 * w + x0] * (1 - tx) + a[y1 * w + x1] * tx) * ty;
      }
    }
    return out;
  }
  function medOf(arr) { if (!arr.length) return 0; arr.sort(function (a, b) { return a - b; }); return arr[arr.length >> 1]; }

  // surface / glare / object masks + signed hair map for one work-size image
  function prep(rgba, W, H, inside, exclude) {
    var N = W * H, I = new Float32Array(N), i;
    for (i = 0; i < N; i++) I[i] = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
    var f = 4, r4 = blockMean(rgba, W, H, f, 4, 0), g4 = blockMean(rgba, W, H, f, 4, 1), b4 = blockMean(rgba, W, H, f, 4, 2), w4 = r4.w, h4 = r4.h, n4 = w4 * h4;
    var I4 = new Float32Array(n4), cr4 = new Float32Array(n4), cg4 = new Float32Array(n4);
    for (i = 0; i < n4; i++) { var sm = r4.a[i] + g4.a[i] + b4.a[i] + 1; I4[i] = (sm - 1) / 3; cr4[i] = r4.a[i] / sm; cg4[i] = g4.a[i] / sm; }
    function big(a) { var b = blockMean(a, w4, h4, 4, 1, 0); return upBilinear(medianSmall(b.a, b.w, b.h, 3), b.w, b.h, w4, h4); }
    var Ibig = big(I4), crb = big(cr4), cgb = big(cg4);
    var gl = new Uint8Array(n4), ob = new Uint8Array(n4);
    for (i = 0; i < n4; i++) { var rt = I4[i] / (Ibig[i] + 1); gl[i] = (I4[i] >= 249 || (I4[i] > 238 && rt > 1.25)) ? 1 : 0; }
    gl = boxMaxMin(boxMaxMin(gl, w4, h4, 1, false), w4, h4, 4, true);
    for (i = 0; i < n4; i++) {
      if (gl[i]) continue;
      var rt2 = I4[i] / (Ibig[i] + 1);
      ob[i] = (rt2 < 0.5 || rt2 > 1.6 || Math.abs(cr4[i] - crb[i]) + Math.abs(cg4[i] - cgb[i]) > 0.08) ? 1 : 0;
    }
    ob = boxMaxMin(boxMaxMin(ob, w4, h4, 2, false), w4, h4, 5, true);
    var glare = new Uint8Array(N), obj = new Uint8Array(N), valid = new Uint8Array(N), x, y;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      i = y * W + x; var j = ((y / f) | 0) * w4 + ((x / f) | 0);
      var ins = inside ? inside[i] : 1, ex = 0;
      if (exclude) { var dx = x - exclude.cx, dy = y - exclude.cy; ex = dx * dx + dy * dy < exclude.r * exclude.r ? 1 : 0; }
      obj[i] = (ob[j] || ex) ? 1 : 0; glare[i] = (gl[j] && !ex && ins) ? 1 : 0;
      valid[i] = (ins && !obj[i] && !glare[i] && x > 1 && y > 1 && x < W - 2 && y < H - 2) ? 1 : 0;
    }
    var Ib = background(I, W, H, valid), m = new Float32Array(N);
    for (i = 0; i < N; i++) m[i] = valid[i] ? Math.max(-1, Math.min(1, 1 - I[i] / (Ib[i] + 1))) : 0;
    var rs = [], gs = [], bs = [];
    for (i = 0; i < N; i += 37) if (valid[i]) { rs.push(rgba[i * 4]); gs.push(rgba[i * 4 + 1]); bs.push(rgba[i * 4 + 2]); }
    var R = medOf(rs), G = medOf(gs), B = medOf(bs), mx = Math.max(R, G, B), mn = Math.min(R, G, B), hue = 0;
    if (mx > mn) { hue = mx === R ? ((G - B) / (mx - mn)) % 6 : mx === G ? (B - R) / (mx - mn) + 2 : (R - G) / (mx - mn) + 4; hue = (hue * 60 + 360) % 360; }
    return { I: I, Ib: Ib, m: m, valid: valid, obj: obj, glare: glare, surf: { r: R, g: G, b: B, L: (R + G + B) / 3, sat: mx ? (mx - mn) / mx : 0, hue: hue } };
  }
  // polarity-free hair map: a hair is a thin line darker OR brighter than the surface. Dark and bright
  // parts of one hair (shine, sharpening halos) then add up into one ridge instead of competing.
  function unifiedDoG(m, W, H, beta, s1) {
    var N = W * H, u = new Float32Array(N), i;
    for (i = 0; i < N; i++) { var v = m[i]; u[i] = v > 0 ? v : -beta * v; }
    var g1 = convSep(u, W, H, gaussKernel(s1)), g3 = convSep(u, W, H, gaussKernel(3.0)), D = new Float32Array(N);
    for (i = 0; i < N; i++) D[i] = g1[i] - g3[i];
    return D;
  }
  function dogAndSharpness(m, valid, W, H) {
    var N = W * H, g1 = convSep(m, W, H, gaussKernel(1.0)), g3 = convSep(m, W, H, gaussKernel(3.0)), D = new Float32Array(N), i;
    for (i = 0; i < N; i++) D[i] = g1[i] - g3[i];
    var g2 = convSep(m, W, H, gaussKernel(2.0)), g6 = convSep(g3, W, H, gaussKernel(5.2)), fv = [], cv = [], dq = boxMaxMin(valid, W, H, 20, false);
    for (i = 0; i < N; i += 3) if (dq[i]) { fv.push(Math.abs(g1[i] - g2[i])); cv.push(Math.abs(g3[i] - g6[i])); }
    function pct(a, q) { if (!a.length) return 0; a.sort(function (x, y) { return x - y; }); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; }
    var fine = pct(fv, 0.998), coarse = pct(cv, 0.998);
    return { D: D, sharpness: coarse > 0 ? fine / coarse : 0 };
  }

  // ---------------------------------------------------------------- reference object (coin / card) from one tap
  HLC.fitReference = function (work, tap, kind, mm) {
    if (kind !== 'card') return fitCoin(work, tap, mm);
    var W = work.width, H = work.height, px = work.data, half = 230;
    var x0 = Math.max(0, Math.round(tap.x - half)), y0 = Math.max(0, Math.round(tap.y - half)), x1 = Math.min(W, Math.round(tap.x + half)), y1 = Math.min(H, Math.round(tap.y + half));
    var w = x1 - x0, h = y1 - y0, n = w * h, i, x, y;
    if (w < 60 || h < 60) return { ok: false, reason: 'edge' };
    var rs = [], gs = [], bs = [];
    for (y = 0; y < h; y += 3) for (x = 0; x < w; x += 3) { var p = ((y0 + y) * W + x0 + x) * 4; rs.push(px[p]); gs.push(px[p + 1]); bs.push(px[p + 2]); }
    var R = medOf(rs), G = medOf(gs), B = medOf(bs), d = new Float32Array(n), gray = new Float32Array(n), dv = [];
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var q = ((y0 + y) * W + x0 + x) * 4; i = y * w + x;
      d[i] = Math.max(Math.abs(px[q] - R), Math.abs(px[q + 1] - G), Math.abs(px[q + 2] - B)); gray[i] = (px[q] + px[q + 1] + px[q + 2]) / 3;
      if ((i % 7) === 0) dv.push(d[i]);
    }
    d = convSep(d, w, h, gaussKernel(1.2));
    var med = medOf(dv), mad = medOf(dv.map(function (v) { return Math.abs(v - med); })), thr = Math.max(14, med + 5 * 1.4826 * mad);
    var mask = new Uint8Array(n);
    for (i = 0; i < n; i++) mask[i] = d[i] > thr ? 1 : 0;
    mask = boxMaxMin(boxMaxMin(mask, w, h, 3, true), w, h, 3, false);
    var tx = Math.round(tap.x - x0), ty = Math.round(tap.y - y0), seed = -1, bestD = 1e9;
    for (y = Math.max(0, ty - 14); y <= Math.min(h - 1, ty + 14); y++) for (x = Math.max(0, tx - 14); x <= Math.min(w - 1, tx + 14); x++) {
      if (mask[y * w + x]) { var dd = (x - tx) * (x - tx) + (y - ty) * (y - ty); if (dd < bestD) { bestD = dd; seed = y * w + x; } }
    }
    if (seed < 0) return { ok: false, reason: 'no-object' };
    var lab = new Int32Array(n); label8(mask, w, h, lab);
    var L = lab[seed], reg = new Uint8Array(n);
    for (i = 0; i < n; i++) reg[i] = lab[i] === L ? 1 : 0;
    reg = fillHoles(reg, w, h);
    var A = 0, sx = 0, sy = 0, touch = false;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (reg[y * w + x]) { A++; sx += x; sy += y; if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touch = true; }
    if (A < 250) return { ok: false, reason: 'too-small' };
    if (touch) return { ok: false, reason: 'too-large' };
    var cx = sx / A, cy = sy / A;
    {
      var sxx = 0, sxy = 0, syy = 0;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (reg[y * w + x]) { var ax = x - cx, ay = y - cy; sxx += ax * ax; sxy += ax * ay; syy += ay * ay; }
      var th = 0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(th), s = Math.sin(th), us = [], vs = [];
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (reg[y * w + x]) { us.push((x - cx) * c + (y - cy) * s); vs.push(-(x - cx) * s + (y - cy) * c); }
      us.sort(function (a, b) { return a - b; }); vs.sort(function (a, b) { return a - b; });
      var q1 = Math.floor(us.length * 0.003), q2 = us.length - 1 - q1, Lu = us[q2] - us[q1] + 1, Lv = vs[q2] - vs[q1] + 1, um = (us[q2] + us[q1]) / 2, vm = (vs[q2] + vs[q1]) / 2;
      var ratio = Lu / Lv, okR = Math.abs(ratio - 85.6 / 53.98) < 0.22, ppm = okR ? (Lu / 85.6 + Lv / 53.98) / 2 : Lu / 85.6;
      var ccx = x0 + cx + um * c - vm * s, ccy = y0 + cy + um * s + vm * c, cor = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (k) {
        return [ccx + k[0] * Lu / 2 * c - k[1] * Lv / 2 * s, ccy + k[0] * Lu / 2 * s + k[1] * Lv / 2 * c];
      });
      return { ok: true, kind: 'card', cx: ccx, cy: ccy, r: Math.hypot(Lu, Lv) / 2, corners: cor, pxPerMm: ppm, shapeOk: okR };
    }
    return { ok: false, reason: 'not-card' };
  };
  function fitCoin(work, tap, mm) {
    var W = work.width, H = work.height, px = work.data, half = 240;
    var x0 = Math.max(0, Math.round(tap.x - half)), y0 = Math.max(0, Math.round(tap.y - half)), x1 = Math.min(W, Math.round(tap.x + half)), y1 = Math.min(H, Math.round(tap.y + half));
    var w = x1 - x0, h = y1 - y0, gray = new Float32Array(w * h), x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var q = ((y0 + y) * W + x0 + x) * 4; gray[y * w + x] = Math.max(px[q], px[q + 1], px[q + 2]) + 0.5 * (px[q] + px[q + 1] + px[q + 2]) / 3 - 0.5 * Math.min(px[q], px[q + 1], px[q + 2]); }
    var gb = convSep(gray, w, h, gaussKernel(1.2)), tx = tap.x - x0, ty = tap.y - y0, NA = 40, cs = [], sn = [], buf = new Float32Array(NA);
    for (var a = 0; a < NA; a++) { cs.push(Math.cos(a * 2 * Math.PI / NA)); sn.push(Math.sin(a * 2 * Math.PI / NA)); }
    function samp(fx, fy) { if (fx < 0 || fy < 0 || fx > w - 1.001 || fy > h - 1.001) return -1; var xi = fx | 0, yi = fy | 0, ax = fx - xi, ay = fy - yi, p = yi * w + xi; return (gb[p] * (1 - ax) + gb[p + 1] * ax) * (1 - ay) + (gb[p + w] * (1 - ax) + gb[p + w + 1] * ax) * ay; }
    function score(cx, cy, r) {
      for (var k = 0; k < NA; k++) { var o = samp(cx + (r + 2) * cs[k], cy + (r + 2) * sn[k]), i2 = samp(cx + (r - 2) * cs[k], cy + (r - 2) * sn[k]); if (o < 0 || i2 < 0) return 0; buf[k] = Math.abs(o - i2); }
      var t = Array.prototype.slice.call(buf).sort(function (p, q2) { return p - q2; });
      return t[Math.floor(NA * 0.3)];      // 30th percentile: the edge must run nearly all the way round
    }
    var best = [0, tx, ty, 0], rmax = Math.min(220, half - 20), cx, cy, r, s2;
    for (cy = ty - 20; cy <= ty + 20; cy += 4) for (cx = tx - 20; cx <= tx + 20; cx += 4) for (r = 14; r <= rmax; r += 2) { s2 = score(cx, cy, r); if (s2 > best[0]) best = [s2, cx, cy, r]; }
    var c1 = best.slice();
    for (cy = c1[2] - 4; cy <= c1[2] + 4; cy += 1) for (cx = c1[1] - 4; cx <= c1[1] + 4; cx += 1) for (r = c1[3] - 3; r <= c1[3] + 3; r += 0.5) { s2 = score(cx, cy, r); if (s2 > best[0]) best = [s2, cx, cy, r]; }
    if (best[0] < 4 || best[3] < 14) return { ok: false, reason: 'no-object' };
    return { ok: true, kind: 'coin', cx: x0 + best[1], cy: y0 + best[2], r: best[3], pxPerMm: 2 * best[3] / mm, shapeOk: true, edge: best[0] };
  }

  // ---------------------------------------------------------------- automatic coin finding (no tap)
  // Circle centres are voted along the brightness gradient; each peak is then checked with fitCoin, which needs
  // a contrast step nearly all the way round (a loop of hair has the same surface inside and outside, a coin does not).
  // Returns the best coin and how round it looks (minor/major axis), which tells the straight-down photo.
  HLC.findCoin = function (work, opt) {
    opt = opt || {};
    var W = work.width, H = work.height, px = work.data, f = 2, w = Math.floor(W / f), h = Math.floor(H / f), x, y, i;
    var g = new Float32Array(w * h);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var r = 0, gg = 0, b = 0, mx = 0, mn = 0;
      for (var dy = 0; dy < f; dy++) for (var dx = 0; dx < f; dx++) { var q = ((y * f + dy) * W + x * f + dx) * 4; r += px[q]; gg += px[q + 1]; b += px[q + 2]; }
      r /= f * f; gg /= f * f; b /= f * f; mx = Math.max(r, gg, b); mn = Math.min(r, gg, b);
      g[y * w + x] = mx + 0.5 * (r + gg + b) / 3 - 0.5 * mn;
    }
    g = convSep(g, w, h, gaussKernel(1.5));
    var gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h), mags = [];
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      i = y * w + x; gx[i] = (g[i + 1] - g[i - 1]) / 2; gy[i] = (g[i + w] - g[i - w]) / 2; mag[i] = Math.hypot(gx[i], gy[i]);
      if ((i & 7) === 0) mags.push(mag[i]);
    }
    mags.sort(function (a, b2) { return a - b2; });
    var thr = Math.max(3, mags[Math.floor(mags.length * 0.97)] || 0);
    var rMin = Math.max(6, Math.round((opt.rMinFrac || 0.012) * Math.max(w, h))), rMax = Math.round((opt.rMaxFrac || 0.12) * Math.max(w, h));
    var acc = new Float32Array(w * h);
    for (y = 2; y < h - 2; y++) for (x = 2; x < w - 2; x++) {
      i = y * w + x; var m = mag[i]; if (m < thr) continue;
      var ux = gx[i] / m, uy = gy[i] / m, wt = Math.min(m, 4 * thr);
      for (var sgn = -1; sgn <= 1; sgn += 2) for (var rr = rMin; rr <= rMax; rr += 1) {
        var cx = Math.round(x + sgn * ux * rr), cy = Math.round(y + sgn * uy * rr);
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) break;
        acc[cy * w + cx] += wt / rr;          // a full circle gives ~2*pi*wt whatever its size
      }
    }
    acc = convSep(acc, w, h, gaussKernel(1.5));
    var peaks = [];
    for (y = 3; y < h - 3; y++) for (x = 3; x < w - 3; x++) {
      i = y * w + x; var v = acc[i]; if (v <= 0) continue;
      var isMax = true;
      for (var yy = -3; yy <= 3 && isMax; yy++) for (var xx = -3; xx <= 3; xx++) if ((yy || xx) && acc[i + yy * w + xx] > v) { isMax = false; break; }
      if (isMax) peaks.push([v, x, y]);
    }
    peaks.sort(function (a, b2) { return b2[0] - a[0]; });
    var best = null, tried = [];
    for (var k = 0; k < peaks.length && tried.length < (opt.maxTry || 24); k++) {
      var P = peaks[k], X = P[1] * f + f / 2, Y = P[2] * f + f / 2;
      if (tried.some(function (t) { return Math.hypot(t[0] - X, t[1] - Y) < 2 * rMin * f; })) continue;
      tried.push([X, Y]);
      var c = fitCoin(work, { x: X, y: Y }, 25);
      if (!c.ok || c.r < rMin * f * 0.8) continue;
      var shape = coinShape(work, c);
      var sc = c.edge * shape.full * shape.sym * (0.5 + 0.5 * shape.ratio);
      if (shape.full < 0.8 || shape.fill < 0.6 || shape.sym < 0.6) continue;   // a solid disc with the same rim all round
      if (!best || sc > best.score) best = { ok: true, cx: c.cx, cy: c.cy, r: c.r, rMajor: shape.rMajor, ratio: shape.ratio, edge: c.edge, score: sc };
      if (shape.sym > 0.9 && shape.fill > 0.9 && c.edge > 2 * (opt.minEdge || 10)) break;   // clearly a coin: stop looking
    }
    if (!best || best.edge < (opt.minEdge || 10)) return { ok: false, reason: 'no-coin', best: best };
    best.tap = [best.cx / W, best.cy / H];
    return best;
  };
  // radius of the coin edge in 72 directions -> roundness (minor/major) and how much of the rim was found
  function coinShape(work, c) {
    var W = work.width, H = work.height, px = work.data, NA = 72, rad = new Array(NA).fill(0), found = 0, sgnSum = 0, ins = [], outs = [], profs = [], inRgb = [], outRgb = [];
    function rgbAt(fx, fy) { var xi = Math.round(fx), yi = Math.round(fy); if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null; var q = (yi * W + xi) * 4; return [px[q], px[q + 1], px[q + 2]]; }
    function lum(fx, fy) {
      var xi = Math.floor(fx), yi = Math.floor(fy); if (xi < 0 || yi < 0 || xi >= W - 1 || yi >= H - 1) return -1;
      var q = (yi * W + xi) * 4, ax = fx - xi, ay = fy - yi, o = 0;
      [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]].forEach(function (t) { var p = q + (t[1] * W + t[0]) * 4; o += t[2] * (Math.max(px[p], px[p + 1], px[p + 2]) + 0.5 * (px[p] + px[p + 1] + px[p + 2]) / 3 - 0.5 * Math.min(px[p], px[p + 1], px[p + 2])); });
      return o;
    }
    for (var a = 0; a < NA; a++) {
      var cs = Math.cos(a * 2 * Math.PI / NA), sn = Math.sin(a * 2 * Math.PI / NA), bestG = 0, bestR = 0, bestS = 0;
      for (var r = c.r * 0.6; r <= c.r * 1.4; r += 0.5) {
        var o = lum(c.cx + (r + 1.5) * cs, c.cy + (r + 1.5) * sn), i2 = lum(c.cx + (r - 1.5) * cs, c.cy + (r - 1.5) * sn);
        if (o < 0 || i2 < 0) continue;
        var gd = Math.abs(o - i2); if (gd > bestG) { bestG = gd; bestR = r; bestS = o > i2 ? 1 : -1; }
      }
      if (bestG >= c.edge * 0.6) { rad[a] = bestR; found++; sgnSum += bestS; }
      // inside (0.2-0.6 r) and outside (1.35-1.7 r) along this direction
      var prof = []; for (var tq = 0.5; tq <= 1.501; tq += 0.05) prof.push(lum(c.cx + tq * c.r * cs, c.cy + tq * c.r * sn));
      if (prof.every(function (v) { return v >= 0; })) profs.push(prof);
      for (var tf = 0.15; tf <= 0.751; tf += 0.15) { var pi = rgbAt(c.cx + tf * c.r * cs, c.cy + tf * c.r * sn); if (pi) inRgb.push(pi); }
      for (var tg = 1.35; tg <= 1.75; tg += 0.1) { var po = rgbAt(c.cx + tg * c.r * cs, c.cy + tg * c.r * sn); if (po) outRgb.push(po); }
      for (var t = 0.2; t <= 0.6; t += 0.1) { var vi = lum(c.cx + t * c.r * cs, c.cy + t * c.r * sn); if (vi >= 0) ins.push(vi); }
      for (var t2 = 1.35; t2 <= 1.7; t2 += 0.07) { var vo = lum(c.cx + t2 * c.r * cs, c.cy + t2 * c.r * sn); if (vo >= 0) outs.push(vo); }
    }
    if (found < 8) return { ratio: 0, rMajor: c.r, full: found / NA };
    // opposite directions belong to one diameter: use diameters so an off-centre fit does not look like an ellipse
    var dia = [];
    for (var a2 = 0; a2 < NA / 2; a2++) { var r1 = rad[a2], r2 = rad[a2 + NA / 2]; if (r1 && r2) dia.push(r1 + r2); }
    if (dia.length < 6) dia = rad.filter(function (v) { return v > 0; }).map(function (v) { return 2 * v; });
    dia.sort(function (p, q) { return p - q; });
    var lo = dia[Math.floor(dia.length * 0.1)], hi = dia[Math.floor(dia.length * 0.9)];
    function mstd(a) { var m = 0; a.forEach(function (v) { m += v; }); m /= a.length || 1; var sd = 0; a.forEach(function (v) { sd += (v - m) * (v - m); }); return [m, Math.sqrt(sd / (a.length || 1))]; }
    // filled disc: the inside differs in colour or brightness from the surface around it (a loop of hair does not)
    var oc = [0, 1, 2].map(function (ch) { return medOf(outRgb.map(function (v) { return v[ch]; })); });
    var od = outRgb.map(function (v) { return Math.max(Math.abs(v[0] - oc[0]), Math.abs(v[1] - oc[1]), Math.abs(v[2] - oc[2])); });
    var tFill = Math.max(14, 2.5 * medOf(od.slice())), nFill = 0;
    inRgb.forEach(function (v) { if (Math.max(Math.abs(v[0] - oc[0]), Math.abs(v[1] - oc[1]), Math.abs(v[2] - oc[2])) > tFill) nFill++; });
    var fill = inRgb.length ? nFill / inRgb.length : 0;
    var I = mstd(ins), O = mstd(outs), sym = 0;
    // rotational symmetry: every direction should cross the same rim profile
    if (profs.length >= 12) {
      var z = profs.map(function (pr) { var ms = mstd(pr); return pr.map(function (v) { return (v - ms[0]) / (ms[1] + 1e-6); }); }), mean = z[0].map(function () { return 0; });
      z.forEach(function (pr) { pr.forEach(function (v, k2) { mean[k2] += v / z.length; }); });
      var mz = mstd(mean); mean = mean.map(function (v) { return (v - mz[0]) / (mz[1] + 1e-6); });
      z.forEach(function (pr) { var cc = 0; pr.forEach(function (v, k2) { cc += v * mean[k2]; }); sym += cc / pr.length / z.length; });
    }
    return { ratio: lo / hi, rMajor: hi / 2, full: found / NA, polarity: Math.abs(sgnSum) / Math.max(1, found), contrast: Math.abs(I[0] - O[0]) / (I[1] + O[1] + 4), sym: sym, fill: fill, inStd: I[1], outStd: O[1] };
  }

  // ---------------------------------------------------------------- photo-to-photo alignment (homography, coarse-to-fine)
  function pyrLevel(A, W, H, f) { var b = blockMean(A, W, H, f, 1, 0); return { a: convSep(b.a, b.w, b.h, gaussKernel(1.0)), w: b.w, h: b.h }; }
  function alignPhotos(Aref, Ak, Mref, Mk, W, H) {
    var Hn = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    var T16 = pyrLevel(Aref, W, H, 16), K16 = pyrLevel(Ak, W, H, 16), MT16 = blockMean(Mref, W, H, 16, 1, 0), MK16 = blockMean(Mk, W, H, 16, 1, 0), w = T16.w, h = T16.h, bestS = -2, bdx = 0, bdy = 0;
    for (var dy = -24; dy <= 24; dy++) for (var dx = -24; dx <= 24; dx++) {
      var sab = 0, saa = 0, sbb = 0, n = 0;
      for (var y = Math.max(0, -dy); y < Math.min(h, h - dy); y++) for (var x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) {
        var p0 = y * w + x, p1 = (y + dy) * w + x + dx; if (MT16.a[p0] < 0.9 || MK16.a[p1] < 0.9) continue;
        var a = T16.a[p0], b = K16.a[p1]; sab += a * b; saa += a * a; sbb += b * b; n++;
      }
      if (n < 0.3 * w * h) continue;
      var s = sab / (Math.sqrt(saa * sbb) + 1e-12) - 0.002 * Math.hypot(dx, dy);
      if (s > bestS) { bestS = s; bdx = dx; bdy = dy; }
    }
    Hn[2] = bdx / w; Hn[5] = bdy / w;
    var plan = [[16, 6, 20], [8, 6, 20], [4, 8, 20], [2, 8, 10]], ncc = 0;
    for (var li = 0; li < plan.length; li++) {
      var f = plan[li][0], np = plan[li][1], iters = plan[li][2], T = li === 0 ? T16 : pyrLevel(Aref, W, H, f), K = li === 0 ? K16 : pyrLevel(Ak, W, H, f);
      var MT = li === 0 ? MT16 : blockMean(Mref, W, H, f, 1, 0), MK = li === 0 ? MK16 : blockMean(Mk, W, H, f, 1, 0);
      var lw = T.w, lh = T.h, cx = lw / 2, cy = lh / 2, sc = lw, stride = f <= 2 ? 2 : 1;
      var gx = new Float32Array(lw * lh), gy = new Float32Array(lw * lh);
      for (var yy = 1; yy < lh - 1; yy++) for (var xx = 1; xx < lw - 1; xx++) { var p = yy * lw + xx; gx[p] = (K.a[p + 1] - K.a[p - 1]) / 2; gy[p] = (K.a[p + lw] - K.a[p - lw]) / 2; }
      var idx = np === 6 ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6, 7];
      for (var it = 0; it < iters; it++) {
        var JTJ = [], JTe = [], i, j;
        for (i = 0; i < np; i++) { JTJ.push(new Float64Array(np)); JTe.push(0); }
        var J = new Float64Array(8), st = 0, stt = 0, skk = 0;
        for (var y2 = 0; y2 < lh; y2 += stride) for (var x2 = 0; x2 < lw; x2 += stride) {
          if (MT.a[y2 * lw + x2] < 0.9) continue;
          var xn = (x2 - cx) / sc, yn = (y2 - cy) / sc, d = Hn[6] * xn + Hn[7] * yn + 1, un = (Hn[0] * xn + Hn[1] * yn + Hn[2]) / d, vn = (Hn[3] * xn + Hn[4] * yn + Hn[5]) / d;
          var u = un * sc + cx, v = vn * sc + cy;
          if (u < 1 || v < 1 || u > lw - 2.001 || v > lh - 2.001) continue;
          var ui = u | 0, vi = v | 0, fu = u - ui, fv = v - vi, q = vi * lw + ui;
          if (MK.a[q] < 0.9 || MK.a[q + 1] < 0.9 || MK.a[q + lw] < 0.9 || MK.a[q + lw + 1] < 0.9) continue;
          var w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
          var kv = K.a[q] * w00 + K.a[q + 1] * w10 + K.a[q + lw] * w01 + K.a[q + lw + 1] * w11;
          var gxx = (gx[q] * w00 + gx[q + 1] * w10 + gx[q + lw] * w01 + gx[q + lw + 1] * w11) * sc, gyy = (gy[q] * w00 + gy[q + 1] * w10 + gy[q + lw] * w01 + gy[q + lw + 1] * w11) * sc;
          var tv = T.a[y2 * lw + x2], e = tv - kv;
          st += tv * kv; stt += tv * tv; skk += kv * kv;
          J[0] = gxx * xn / d; J[1] = gxx * yn / d; J[2] = gxx / d; J[3] = gyy * xn / d; J[4] = gyy * yn / d; J[5] = gyy / d;
          J[6] = -(gxx * un + gyy * vn) * xn / d; J[7] = -(gxx * un + gyy * vn) * yn / d;
          for (i = 0; i < np; i++) { var Ji = J[idx[i]]; if (Ji === 0) continue; JTe[i] += Ji * e; var row = JTJ[i]; for (j = i; j < np; j++) row[j] += Ji * J[idx[j]]; }
        }
        ncc = st / (Math.sqrt(stt * skk) + 1e-12);
        var tr = 0; for (i = 0; i < np; i++) tr += JTJ[i][i];
        var Am = []; for (i = 0; i < np; i++) { Am.push([]); for (j = 0; j < np; j++) Am[i].push(j >= i ? JTJ[i][j] : JTJ[j][i]); Am[i][i] += 1e-6 * tr / np + 1e-12; }
        var del = solve(Am, JTe); if (!del) break;
        var mxd = 0; for (i = 0; i < np; i++) { Hn[idx[i]] += del[i]; mxd = Math.max(mxd, Math.abs(del[i])); }
        if (mxd < 2e-5) break;
      }
    }
    var Nm = [1 / W, 0, -0.5, 0, 1 / W, -H / (2 * W), 0, 0, 1], Ni = [W, 0, W / 2, 0, W, H / 2, 0, 0, 1];
    return { H: mulH(mulH(Ni, Hn), Nm), ncc: ncc };
  }
  function validF(P, W, H) { var e = boxMaxMin(P.valid, W, H, 6, false), o = new Float32Array(W * H); for (var i = 0; i < W * H; i++) o[i] = e[i]; return o; }
  function alignFeature(P, W, H) {
    var A = new Float32Array(W * H);
    for (var i = 0; i < W * H; i++) A[i] = P.valid[i] ? Math.min(0.3, Math.abs(P.m[i])) : 0;
    return A;
  }

  HLC.analyzeFree = async function (imgs, userOpt, progress) {
    var opt = {}, k, i, x, y;
    for (k in DEFAULTS) opt[k] = DEFAULTS[k];
    for (k in (userOpt || {})) opt[k] = userOpt[k];
    var T0 = Date.now(), timings = {};
    function step(n) { timings[n] = Date.now() - T0; }
    function prog(p, l) { if (progress) progress(p, l); }
    prog(0.02, 'load');
    var ws = workSize(imgs[0], opt), W = ws[0], H = ws[1], N = W * H;
    var works = imgs.map(function (im) { return (im.width >= im.height) === (imgs[0].width >= imgs[0].height) ? resizeArea(im, W, H) : null; });
    step('resize'); await tick();
    var warnings = [], reject = [], refFit = null, pxmm = W / opt.sheetWidthMm, scaleFromRef = false, exclude = null;
    if (opt.ref && opt.ref.tap) {
      refFit = HLC.fitReference({ width: W, height: H, data: works[0] }, { x: opt.ref.tap[0] * W, y: opt.ref.tap[1] * H }, opt.ref.kind, opt.ref.mm);
      if (refFit.ok) { pxmm = refFit.pxPerMm * (opt.ref.adjust || 1); scaleFromRef = true; exclude = { cx: refFit.cx, cy: refFit.cy, r: refFit.r * 1.12 + 6 }; if (!refFit.shapeOk) warnings.push('ref-shape'); }
      else warnings.push('ref-not-found');
    } else if (opt.ref && opt.ref.points) {
      var pa = opt.ref.points; pxmm = Math.hypot((pa[1][0] - pa[0][0]) * W, (pa[1][1] - pa[0][1]) * H) / opt.ref.mm; scaleFromRef = true;
      exclude = { cx: (pa[0][0] + pa[1][0]) / 2 * W, cy: (pa[0][1] + pa[1][1]) / 2 * H, r: Math.hypot((pa[1][0] - pa[0][0]) * W, (pa[1][1] - pa[0][1]) * H) * 0.66 + 6 };
    } else warnings.push('no-reference');
    prog(0.06, 'surface');
    var P0 = prep(works[0], W, H, null, exclude), ds0 = dogAndSharpness(P0.m, P0.valid, W, H), sharpness = ds0.sharpness;
    step('prep'); await tick();
    if (sharpness < 0.9) reject.push('blurred'); else if (sharpness < 1.05) warnings.push('slightly-blurred');
    var surf = P0.surf, glarePx = 0, objPx = 0;
    for (i = 0; i < N; i++) { glarePx += P0.glare[i]; objPx += P0.obj[i]; }
    if (glarePx > 0.25 * N) reject.push('overexposed');
    var brightOn = surf.L < 175, kind = 'mid';
    if (surf.L >= 175 && surf.sat < 0.2) { kind = 'white'; warnings.push('surface-white'); }
    else if (surf.L < 70) { kind = 'black'; warnings.push('surface-black'); }
    else if (surf.hue >= 8 && surf.hue <= 48 && surf.sat > 0.22) { kind = 'brown'; warnings.push('surface-brown'); }
    else if (surf.L >= 175) { kind = 'light'; warnings.push('surface-white'); }
    // line filter on the reference photo
    var uni = opt.unify !== false, beta = brightOn ? (opt.betaDark != null ? opt.betaDark : 1) : (opt.betaLight != null ? opt.betaLight : 0.5), uSig = opt.uSig || 1.3;
    var LS = await orientedMaxMin(uni ? unifiedDoG(P0.m, W, H, beta, uSig) : ds0.D, W, H, opt, progress, 0.1, 0.5);
    step('line'); await tick();
    var er = opt.alongRadius + 4, det = boxMaxMin(P0.valid, W, H, er, false);
    var stD = robustStats(LS.dark, det, N), stB = robustStats(LS.bright, det, N);
    // ---- fill what glare hid in photo 1 from the other photos
    var need = boxMaxMin(P0.glare, W, H, er, true), needPx = 0, filled = new Uint8Array(N), filledPx = 0, used = [true], nccs = [1];
    for (i = 0; i < N; i++) { if (P0.obj[i]) need[i] = 0; needPx += need[i]; }
    var fusedRgba = works[0];
    if (works.length > 1 && !reject.length) {
      var A0 = alignFeature(P0, W, H), M0 = validF(P0, W, H);
      for (var kI = 1; kI < works.length; kI++) {
        prog(0.5 + 0.3 * (kI - 1) / (works.length - 1), 'align');
        if (!works[kI]) { used.push(false); nccs.push(0); continue; }
        var Pk0 = prep(works[kI], W, H, null, null), al = alignPhotos(A0, alignFeature(Pk0, W, H), M0, validF(Pk0, W, H), W, H);
        nccs.push(al.ncc);
        if (!(al.ncc > 0.6)) { used.push(false); warnings.push('align-failed'); await tick(); continue; }
        used.push(true);
        if (needPx < 300) { await tick(); continue; }
        var wp = warp(works[kI], W, H, al.H, W, H), Pk = prep(wp.rgba, W, H, wp.inside, exclude), okK = boxMaxMin(Pk.valid, W, H, er, false);
        var bx0 = W, by0 = H, bx1 = -1, by1 = -1, cnt = 0;
        for (y = 0; y < H; y++) for (x = 0; x < W; x++) { i = y * W + x; if (need[i] && !filled[i] && okK[i]) { cnt++; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; } }
        if (cnt < 150) { await tick(); continue; }
        var dk = dogAndSharpness(Pk.m, Pk.valid, W, H);
        if (dk.sharpness < 0.9) { warnings.push('fill-blurred'); await tick(); continue; }
        var o2 = {}; for (k in opt) o2[k] = opt[k];
        o2.roi = [Math.max(0, bx0 - 40), Math.max(0, by0 - 40), Math.min(W, bx1 + 41), Math.min(H, by1 + 41)];
        var LK = await orientedMaxMin(uni ? unifiedDoG(Pk.m, W, H, beta, uSig) : dk.D, W, H, o2, null, 0, 1);
        var roiMask = new Uint8Array(N);
        for (y = o2.roi[1]; y < o2.roi[3]; y++) for (x = o2.roi[0]; x < o2.roi[2]; x++) roiMask[y * W + x] = okK[y * W + x];
        var sD = robustStats(LK.dark, roiMask, N), sB = robustStats(LK.bright, roiMask, N);
        var gD = Math.max(0.5, Math.min(2, stD.sigma / sD.sigma)), gB = Math.max(0.5, Math.min(2, stB.sigma / sB.sigma));
        for (i = 0; i < N; i++) if (need[i] && !filled[i] && okK[i]) {
          LS.dark[i] = Math.max(0, (LK.dark[i] - sD.med) * gD + stD.med); LS.bright[i] = Math.max(0, (LK.bright[i] - sB.med) * gB + stB.med);
          LS.argDark[i] = LK.argDark[i]; LS.argBright[i] = LK.argBright[i]; filled[i] = 1; filledPx++;
          fusedRgba[i * 4] = wp.rgba[i * 4]; fusedRgba[i * 4 + 1] = wp.rgba[i * 4 + 1]; fusedRgba[i * 4 + 2] = wp.rgba[i * 4 + 2];
        }
        await tick();
      }
    }
    step('fuse');
    var remainPx = 0, detM = new Uint8Array(N), invalid = new Uint8Array(N);
    for (i = 0; i < N; i++) { detM[i] = (filled[i] || (det[i] && !need[i])) ? 1 : 0; if (need[i] && !filled[i]) remainPx++; invalid[i] = (P0.obj[i] || (need[i] && !filled[i])) ? 1 : 0; }
    if (remainPx > 0.004 * N) warnings.push('glare-remaining');
    prog(0.82, 'segment');
    var sens = opt.sensitivity || 1, nd = nms(LS.dark, LS.argDark, W, H, opt.nTheta), nb = nms(LS.bright, LS.argBright, W, H, opt.nTheta);
    var md = hysteresis(nd, detM, W, H, stD.med + opt.kLo / sens * stD.sigma, stD.med + opt.kHi / sens * stD.sigma);
    var mb = (brightOn && !uni) ? hysteresis(nb, detM, W, H, stB.med + opt.kLo / sens * stB.sigma, stB.med + opt.kHi / sens * stB.sigma) : new Uint8Array(N);
    if (!uni) {   // separate dark / bright maps (v2.0): the weaker polarity nearby is taken as a side lobe
      var dMax = maxFilter(LS.dark, W, H, 5), bMax = maxFilter(LS.bright, W, H, 5);
      for (i = 0; i < N; i++) { if (md[i] && LS.dark[i] <= bMax[i]) md[i] = 0; if (mb[i] && LS.bright[i] <= dMax[i]) mb[i] = 0; }
    }
    if (brightOn && !uni && surf.sat > 0.15) {   // on a coloured surface a white hair also lowers the saturation
      var sv = new Float32Array(N);
      for (i = 0; i < N; i++) { var o4 = i * 4, mx2 = Math.max(fusedRgba[o4], fusedRgba[o4 + 1], fusedRgba[o4 + 2]), mn2 = Math.min(fusedRgba[o4], fusedRgba[o4 + 1], fusedRgba[o4 + 2]); sv[i] = mx2 ? (mx2 - mn2) / mx2 : 0; }
      var svb = background(sv, W, H, P0.valid), bl = new Int32Array(N), nbl = label8(mb, W, H, bl);
      if (nbl) { var sh = new Float64Array(nbl + 1), cn = new Int32Array(nbl + 1); for (i = 0; i < N; i++) if (bl[i]) { sh[bl[i]] += svb[i] - sv[i]; cn[bl[i]]++; } for (i = 0; i < N; i++) if (bl[i] && sh[bl[i]] / cn[bl[i]] < 0.03) mb[i] = 0; }
    }
    removeSmall(md, W, H, opt.minAreaPx); removeSmall(mb, W, H, opt.minAreaPx);
    removeShort(md, W, H, opt.minSkelPx); removeShort(mb, W, H, opt.minSkelPx);
    var cl = new Uint8Array(N), white = mb;
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) { i = y * W + x; var mk = md[i] | mb[i]; cl[i] = (mk || ((md[i - 1] | mb[i - 1]) && (md[i + 1] | mb[i + 1])) || ((md[i - W] | mb[i - W]) && (md[i + W] | mb[i + W]))) ? 1 : 0; }
    step('segment'); await tick();
    prog(0.9, 'trace');
    var G = buildGraph(cl, W, H, opt), tr = traceHairs(G, opt, invalid);
    step('trace');
    var term = {}; tr.terminals.forEach(function (t) { term[t.pt[1] * W + t.pt[0]] = t.onCrossing; });
    var mSm = uni ? convSep(P0.m, W, H, gaussKernel(1.0)) : null;
    var minLen = opt.minLenMm * pxmm, hairs = [], totalPx = 0, E = er + 8, cutCount = 0, flags = [];
    function nearFrame(px2, py2) { return px2 < E || py2 < E || px2 >= W - E || py2 >= H - E; }
    // lines that hug the edge of an object / the table (a mat border, a coin rim) are edges, not hairs
    var Ism = convSep(P0.I, W, H, gaussKernel(1.0)), nearObj = boxMaxMin(P0.obj, W, H, 8, true), lineSnr = 1 / (stD.sigma || 1), droppedEdge = 0, droppedSpeck = 0;
    tr.paths.forEach(function (p) {
      var L = 0, Lc = 0, nw = 0, a, ne = 0, sr = 0, pol = 0, nEdge = 0;
      for (a = 0; a < p.length; a++) {
        var q = p[a]; if (nearObj[q] && !P0.obj[q]) ne++; sr += LS.dark[q]; if (mSm) pol += mSm[q];
        // step edge test: a hair has the same surface on both sides, a table/mat border does not
        var qy = (q / W) | 0, qx = q - qy * W, th = Math.PI * LS.argDark[q] / opt.nTheta, nx = -Math.sin(th), ny = Math.cos(th);
        var ax2 = Math.round(qx + 4 * nx), ay2 = Math.round(qy + 4 * ny), bx2 = Math.round(qx - 4 * nx), by2 = Math.round(qy - 4 * ny);
        if (ax2 >= 0 && ay2 >= 0 && bx2 >= 0 && by2 >= 0 && ax2 < W && bx2 < W && ay2 < H && by2 < H) {
          var Ia = Ism[ay2 * W + ax2], Ib2 = Ism[by2 * W + bx2], Ic = Ism[q];
          if (Math.abs(Ia - Ib2) > 1.5 * Math.abs(Ic - (Ia + Ib2) / 2) + 2) nEdge++;
        }
      }
      if (opt.edgeFilter !== false && nEdge > 0.6 * p.length) { droppedEdge++; return; }
      if (opt.edgeFilter !== false && ne > 0.5 * p.length) { droppedEdge++; return; }
      sr = sr / p.length * lineSnr; pol /= p.length;
      // chains of dust specks: weak, short, and neither clearly darker nor clearly brighter than the surface
      if (uni && opt.speckFilter !== false && p.length < 40 * pxmm && sr < (opt.speckSnr || 12) && Math.abs(pol) < (opt.speckPol || 0.03)) { droppedSpeck++; return; }
      for (a = 1; a < p.length; a++) { var y1 = (p[a] / W) | 0, x1 = p[a] - y1 * W, y0 = (p[a - 1] / W) | 0, x0 = p[a - 1] - y0 * W, dd = Math.hypot(x1 - x0, y1 - y0); L += dd; Lc += Math.min(3, dd); }
      if (Lc >= 3 * pxmm) totalPx += Lc;
      if (L < minLen) return;
      for (a = 0; a < p.length; a++) if (uni ? (brightOn && mSm[p[a]] < 0) : white[p[a]]) nw++;
      var pts = new Int32Array(p.length * 2);
      for (a = 0; a < p.length; a++) { pts[2 * a] = p[a] % W; pts[2 * a + 1] = (p[a] / W) | 0; }
      var e0 = p[0], e1 = p[p.length - 1], c0 = nearFrame(pts[0], pts[1]), c1 = nearFrame(pts[pts.length - 2], pts[pts.length - 1]), x0c = term[e0] === true, x1c = term[e1] === true;
      if (c0 || c1) cutCount++;
      if (x0c) flags.push({ x: pts[0], y: pts[1], kind: 'crossing' });
      if (x1c) flags.push({ x: pts[pts.length - 2], y: pts[pts.length - 1], kind: 'crossing' });
      hairs.push({ pts: pts, lengthMm: L / pxmm, white: nw > 0.5 * p.length, cut: c0 || c1, complete: !(c0 || c1 || x0c || x1c) });
    });
    var shortN = hairs.filter(function (h) { return h.lengthMm < 18; }).length;
    if (hairs.length > 30 && shortN > 0.5 * hairs.length) warnings.push('pattern');
    if (hairs.length && flags.length > 0.5 * hairs.length + 3) warnings.push('dense');
    timings.total = Date.now() - T0; prog(1, 'done');
    return {
      ok: true, mode: 'free', count: hairs.length, hairs: hairs, flags: flags, warnings: warnings, reject: reject,
      pxPerMm: pxmm, scaleFromRef: scaleFromRef, scaleFromMarker: scaleFromRef, refFit: refFit, marker: null,
      work: { width: W, height: H, rgba: fusedRgba }, sharpness: sharpness, totalLengthMm: totalPx / pxmm, cutCount: cutCount,
      surface: { kind: kind, L: surf.L, sat: surf.sat, hue: surf.hue, rgb: [surf.r, surf.g, surf.b] },
      fusion: { photos: works.length, used: used, ncc: nccs, glarePx: needPx, filledPx: filledPx, remainPx: remainPx, objPx: objPx },
      stats: { nodes: tr.nodes, gaplinks: tr.gaplinks, droppedEdge: droppedEdge, droppedSpeck: droppedSpeck }, timings: timings
    };
  };

  // exposed for tests
  HLC._internal = { findMarker: findMarker, detectSheet: detectSheet, homography: homography, warp: warp, skeletonize: skeletonize, buildGraph: buildGraph, traceHairs: traceHairs, orientedMaxMin: orientedMaxMin };

  if (typeof module !== 'undefined' && module.exports) module.exports = HLC;
  else root.HLC = HLC;
})(typeof self !== 'undefined' ? self : this);

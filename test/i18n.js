// every language must have the same keys and the same {placeholders} as Japanese
const I = require('../pwa/i18n.js').HLC_I18N, T = I.text, base = Object.keys(T.ja); let bad = 0;
for (const l of I.order) {
  if (!T[l]) { bad++; console.log(l, 'missing language'); continue; }
  const miss = base.filter(k => !(k in T[l])), extra = Object.keys(T[l]).filter(k => !(k in T.ja));
  if (miss.length || extra.length) { bad++; console.log(l, 'missing', miss, 'extra', extra); }
  for (const k of base) {
    if (!(k in T[l])) continue;
    const ph = s => (s.match(/\{\w+\}/g) || []).sort().join();
    if (ph(T.ja[k]) !== ph(T[l][k])) { bad++; console.log(l, k, 'placeholders differ:', ph(T.ja[k]), 'vs', ph(T[l][k])); }
    if (!T[l][k].trim()) { bad++; console.log(l, k, 'empty'); }
  }
}
console.log('languages', I.order.length, '· keys', base.length, '· problems', bad);
process.exit(bad ? 1 : 0);

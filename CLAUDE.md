# MOT'S HAIR COUNTER（Hair Loss Counter）— 作業メモ

- 公開アプリは `pwa/`。`pwa/app.js`・`index.html`・`styles.css` を直接編集する。解析は `src/engine.js` を編集する（`pwa/engine.js` は生成物）。
- 変更したら `python build_pwa.py` を実行してからコミットする。`pwa/` にファイルを足したら `build_pwa.py` の `files` にも足す（オフラインで読めなくなる）。
- 画面に出す文字は `pwa/i18n.js` に9か国語ぶん書く（キーは全言語で同じ。`node test/i18n.js` で確認）。HTMLは `data-i18n`、JSは `t('key')`。アプリ名「MOT'S HAIR COUNTER」だけは訳さない。
- テストは文言ではなく `data-state` / `data-stage` を見る（どの言語でも通るように）。`<svg>` には `.hidden` が無いので `setAttribute('hidden', '')` を使う。
- 外部への通信、外部ファイル（フォント・CDN）、インラインのスクリプトやスタイルを足さない。CSPで止まり、「通信なし」の約束も崩れる。
- 利用者の写真や実測データをこのリポジトリに入れない（公開リポジトリ）。
- エンジンのパラメータは約5〜6 px/mm（作業幅1260px）前提。

# Hair Loss Counter — 作業メモ

- 公開アプリは `pwa/`。`pwa/app.js`・`index.html`・`styles.css` を直接編集する。解析は `src/engine.js` を編集する（`pwa/engine.js` は生成物）。
- 変更したら `python build_pwa.py` を実行してからコミットする。
- 外部への通信、外部ファイル（フォント・CDN）、インラインのスクリプトやスタイルを足さない。CSPで止まり、「通信なし」の約束も崩れる。
- 利用者の写真や実測データをこのリポジトリに入れない（公開リポジトリ）。
- エンジンのパラメータは約5〜6 px/mm（作業幅1260px）前提。

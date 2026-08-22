# LimiFile

ブラウザ完結型の画像処理Webツールです。画像の形式変換・圧縮・メタデータ削除を利用者の端末内(ブラウザ内)で行い、選択した画像をLimiFileのサーバーへアップロードする機能は実装していません。

- Production: <https://limifile.com/>
- 英語(prefixなし)・日本語(`/ja/`)の2言語対応
- 静的Astroサイト、Cloudflare Pagesで稼働中
- LimiFile自身のコードはApache-2.0。ただし**repository全体が単一ライセンスではありません** — [LICENSING.md](LICENSING.md)を参照してください。

The English README is at [README.md](README.md).

## 実装済み機能

各機能は同じ処理ロジック・Web Workerを使って提供しています。大半は英語・日本語の両ページから利用できますが、固定容量20/50/100/200KB圧縮・AVIF→JPG・Signature Resizerは英語版のみです(理由は[URL一覧](#url一覧)参照)。

- 画像を選択して形式・容量・寸法を解析
- HEIC/HEIF → JPG変換
- JPEG/HEIC/WebP画像の指定容量圧縮
- JPEG/HEIC/WebP/PNG画像の20/50/100/200/500KB固定圧縮
- JPEG/HEIC画像のメタデータ削除
- PNG → WebP変換
- PNG画像の指定容量圧縮
- PNG → JPG変換(透明部分は選択した背景色で塗りつぶし、既定はwhite)
- WebP → JPG変換(通常WebP・透明WebPに対応。透明部分は選択した背景色で塗りつぶし、既定はwhite。アニメーションWebPは非対応)
- AVIF → JPG変換
- 署名画像を容量上限つきで指定ピクセル寸法へリサイズ

サイト共通の機能:

- 英語(prefixなし既定言語)・日本語(`/ja/`)
- 静的コンポーネントによるLanguageSwitcher(JavaScriptなし、同一ページの他言語版へ相互リンク)
- locale別のcanonical・en/ja相互hreflang・x-default(常に英語版)
- locale別のlocalized 404ページ(英語root `/404`、日本語 `/ja/404`)
- オープンソースライセンス一覧・HEIC source packageの公開(`/licenses/`・`/ja/licenses/`)
- プライバシーポリシー・利用規約・お問い合わせページ(`/privacy/`・`/terms/`・`/contact/`と`/ja/`配下)

各ツールページには、できること・使い方・重要な制約・プライバシー・よくある質問・関連ツールへのリンクを掲載しています(対応形式の詳細な制約や指定容量への到達を保証しない旨等は、各ページの「重要な制約」、および[利用規約](https://limifile.com/ja/terms/)に記載しています)。

## プライバシー上の設計

このプロジェクトを評価する際に、最も読む価値がある部分です。

- **画像のバイト列を送信するコードパスが存在しません。** 選択画像・ファイル名・EXIF/GPS情報をサーバーや外部の解析サービスへ送信する`fetch`・`XMLHttpRequest`・`FormData`呼び出しは、このリポジトリ内に存在しません。
- **回帰テストで担保しています。** [test/no-file-upload.test.tsx](test/no-file-upload.test.tsx)は、画像選択から解析完了までの間、`fetch`・`XMLHttpRequest.prototype.send`・`FormData.prototype.append`が`File`/`Blob`を伴って呼び出されないことを検証します。**限界も正確に書きます**: これは選択ファイルが送信されないことを示すもので、「ネットワーク通信が一切発生しないこと」を保証するものではありません。HTML/CSS/JS/WASM等の通常の静的アセット取得はこのテストの対象外です。
- **主張を利用者の目の前に置いています。** 全ツールページで、画像選択領域の直下にプライバシー表示を常設しています。
- **計測は意図的に狭く保っています。** Cloudflare Web Analyticsでページ閲覧・参照元・端末種別等を把握します。加えて`PUBLIC_UMAMI_WEBSITE_ID`を設定した環境では、Umami Cloudへ`process_start`・`process_success`・`process_error`・`download`の4イベント**だけ**を送ります。Umami側の自動ページビューは無効です。
- **Umamiイベントのpayloadはコード上の許可リスト**で`tool_id`と、処理失敗時の正規化済み`error_code`だけに限定しています。画像・画像内容・ファイル名・容量・画像寸法・メタデータ・出力ファイル・自由記述のエラー文は送信しません。
- カスタムpayloadとは別に、Umamiはイベント受信時の標準情報として匿名セッション、URLパス・ホスト名・参照元、ブラウザ・OS・端末種別、画面サイズ、言語、おおよその地域、発生時刻を記録します。LimiFileはUmamiのDistinct ID等の利用者識別子を設定しません。
- 詳細は[プライバシーポリシー](https://limifile.com/ja/privacy/)([英語版](https://limifile.com/privacy/))を参照してください。

## URL一覧

すべて末尾スラッシュ付きが最終到達URLです(`trailingSlash: "always"`。末尾スラッシュ無しでアクセスした場合はCloudflare Pages上で301系リダイレクトされます)。

### 英語(prefixなし) — 19ページ

| ページ                        | URL                                                  |
| ----------------------------- | ---------------------------------------------------- |
| トップ                        | `/`                                                  |
| HEIC→JPG                      | `/heic-to-jpg/`                                      |
| 容量指定圧縮                  | `/compress-image/`                                   |
| 500KB圧縮                     | `/compress-image-to-500kb/`                          |
| 20KB圧縮(英語版のみ)          | `/compress-image-to-20kb/`                           |
| 50KB圧縮(英語版のみ)          | `/compress-image-to-50kb/`                           |
| 100KB圧縮(英語版のみ)         | `/compress-image-to-100kb/`                          |
| 200KB圧縮(英語版のみ)         | `/compress-image-to-200kb/`                          |
| メタデータ削除                | `/remove-exif/`                                      |
| PNG→WebP                      | `/png-to-webp/`                                      |
| PNG容量圧縮                   | `/compress-png/`                                     |
| PNG→JPG                       | `/png-to-jpg/`                                       |
| WebP→JPG                      | `/webp-to-jpg/`                                      |
| AVIF→JPG(英語版のみ)          | `/avif-to-jpg/`                                      |
| Signature Resizer(英語版のみ) | `/signature-resizer/`                                |
| オープンソースライセンス      | `/licenses/`                                         |
| プライバシーポリシー          | `/privacy/`                                          |
| 利用規約                      | `/terms/`                                            |
| お問い合わせ                  | `/contact/`                                          |
| 404                           | `/404`(直接アクセス時200。未知パスでは404として配信) |

### 日本語(`/ja/`配下) — 13ページ

上記のうち英語版のみの6ページを除いた構成が`/ja/`配下にも同じ形で存在します(例: `/ja/heic-to-jpg/`、`/ja/licenses/`、`/ja/privacy/`)。日本語404は`/ja/404`です。

固定容量20/50/100/200KBの4ページ・`/avif-to-jpg/`・`/signature-resizer/`には`/ja/`配下の対応ページを作っていません。これは意図的な仕様です — これらのツールや特定のバイト容量に対する検索需要は言語によって大きく異なり、実際の読者がいないページを増やしても保守コストだけが増えるためです。500KBページ(`/compress-image-to-500kb/`)は引き続きen/ja両方に存在します。

`/en/`というURLは存在しません(英語はprefixなしが正規URLです)。自動言語リダイレクトも実装していません。利用者はヘッダーのLanguageSwitcherから明示的に言語を切り替えます。

## 技術構成

| 項目                 | 採用技術                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 言語                 | TypeScript                                                                                                                                                                        |
| サイト基盤           | [Astro](https://astro.build)(`output: "static"`。DB・Cloudflare Functions・SSRは未使用)                                                                                           |
| 多言語ルーティング   | Astro組み込みi18n routing(`defaultLocale: "en"`、`locales: ["en","ja"]`、`prefixDefaultLocale: false`。自動言語リダイレクトなし)                                                  |
| 画像処理UI           | [Preact](https://preactjs.com)(`@astrojs/preact`統合による「アイランド」として実装)                                                                                               |
| 重い画像処理         | Dedicated Web Worker(HEICデコード・PNGエンコード・画像圧縮等はメインスレッドをブロックしない)                                                                                     |
| スタイル             | 素のCSS(`src/styles/global.css`。UIライブラリは未導入)                                                                                                                            |
| アイコン             | [Lucide](https://lucide.dev)(ビルド時にinline SVGとして展開。アイコン用JavaScriptは配布しない)                                                                                    |
| Lint/Format          | ESLint(typescript-eslint) + Prettier                                                                                                                                              |
| テスト               | Vitest + @testing-library/preact + jsdom                                                                                                                                          |
| ホスティング         | Cloudflare Pages(静的サイト。Build command: `npm run build`、Build output directory: `dist`)                                                                                      |
| アクセス・利用計測   | Cloudflare Web Analytics(ページ閲覧・Web Vitals等) + Umami Cloud(許可リスト式の匿名ツールイベント4種。環境変数未設定時は無効)                                                     |
| パッケージマネージャ | npm                                                                                                                                                                               |
| HEICデコード         | [@discourse/heic](https://github.com/discourse/jSquash)(Apache-2.0のラッパー。内包WASMはlibheif/libde265由来でLGPL-3.0。詳細は[/ja/licenses/](https://limifile.com/ja/licenses/)) |

## 開発コマンド

Node.js 22系(LTS)を前提としています。バージョン管理に[nvm](https://github.com/nvm-sh/nvm)等を使っている場合は、リポジトリ直下の`.nvmrc`を参照してください。

```bash
npm ci
npm run dev
```

その他のコマンド:

```bash
npm run build        # dist/ に静的サイトを生成(生成後、ネストした日本語404(dist/ja/404/index.html)を
                     # Cloudflareのnearest-404検出に必要なフラットファイル(dist/ja/404.html)へ
                     # 変換するfixupスクリプトを自動実行する)
npm run preview      # ビルド結果をローカルでプレビュー
npm run lint         # ESLint
npm run typecheck    # astro check (TypeScript型チェック)
npm run test         # Vitest
npm run format       # Prettierで整形
npm run format:check # Prettierのフォーマット差分チェックのみ
```

## 検証(verify scripts)

`npm run build`後のビルド成果物(`dist/`)を対象に、以下の検証スクリプトをCIで実行しています(未ビルドの場合は各スクリプトが自動でビルドします)。

```bash
npm run verify:404                      # 英語root・日本語/ja/404の内容とCloudflare向け静的404挙動
npm run verify:licenses                 # ページ別の実配布物と、licenses本文の事実整合性
npm run verify:i18n-seo-foundation      # 全通常ページのlang/canonical/hreflang/x-default/noindex等
npm run verify:trust-pages              # privacy/terms/contact(en/ja計6ページ)の内容・SEO基盤
npm run verify:tool-seo-content         # ツールページのtitle/description一意性・FAQ・関連リンクと、
                                        # page-level indexableのbuildモード別挙動
npm run verify:search-publication       # release-mode buildでのrobots.txt/sitemap.xml生成内容と、
                                        # 通常buildにはどちらも存在しないことの検証
npm run verify:lgpl-heic-source-package # HEIC source package(LGPL対応)の軽量検証
```

`verify:licenses`は特筆に値します — ドキュメントの記述を信用せず、ビルド成果物から実配布物を導出して照合します。依存やアイコンを追加すると、ライセンス表示を更新するまでビルドが落ちます。

機能面の回帰テストとしては、リポジトリ内の合成HEICフィクスチャ([test/fixtures/heic/synthetic-fixture.heic](test/fixtures/heic/synthetic-fixture.heic)。CC0、コードで生成したもので個人の写真ではない)を使った実デコードテストや、上記のno-file-uploadテストをVitestスイートに含めています。

## indexing(検索エンジンへの公開制御)

ページ個別の`indexable`設定に関わらずサイト全体を検索エンジンへ登録させないためのゲートを、環境変数`PUBLIC_ALLOW_INDEXING`で設けています([site-indexing.ts](src/config/site-indexing.ts))。

- `PUBLIC_ALLOW_INDEXING`が厳密に文字列`"true"`の場合のみ、ページ個別の`indexable`設定を参照する
- 未設定・`"false"`・その他の値はすべて安全側として全ページnoindexになる
- ページ個別の`indexable`が`false`の場合、サイト全体の設定が`true`でもそのページはnoindexのまま
- 最終的なindex可否: `globalIndexingEnabled && pageIndexable`(AND条件)

トップページとツール14ページ(計15ページ)は、各ページの検索向けコンテンツ(SEO title・meta description・導入文・特徴・使い方・制約・プライバシー・FAQ・関連ツールリンク)を整備した上で、ページ単位の`indexable`を`true`にしています。licenses・privacy/terms/contactはページ単位で`indexable: false`固定のままです。

`PUBLIC_ALLOW_INDEXING`自体はこのリポジトリのコードでは管理していません(Cloudflare Pages側のProject環境変数です)。したがって、**Production側の現在値をこのリポジトリのコードだけから確認することはできません**。ゲートが開いている場合、上記15ページは次回のProductionデプロイでindex可能になり、`sitemap.xml`にも追加されます。Cloudflare Pagesの環境変数はこのリポジトリへcommitしません。ローカルでは`.env`(gitignore対象)を使用でき、変数名と説明のみ[.env.example](.env.example)に記載しています。

### Umamiツールイベント計測

UmamiはCloudflare Web Analyticsを置き換えるのではなく、ブラウザ内処理の開始・結果・出力取得だけを補完します。Umami trackerには`data-auto-pageview="false"`・`data-exclude-search="true"`・`data-exclude-hash="true"`・`data-do-not-track="true"`を設定しています。

有効化手順:

1. Umami Cloudでwebsiteを作成する
2. 発行されたwebsite UUIDをCloudflare PagesのProduction環境変数`PUBLIC_UMAMI_WEBSITE_ID`へ設定する
3. Productionを再デプロイし、UmamiのRealtime/Eventsで合成テスト画像による4イベントを確認する

`PUBLIC_UMAMI_SCRIPT_URL`は通常設定しません。未設定時は`https://cloud.umami.is/script.js`を使い、将来セルフホストへ移行する場合のみHTTPS URLを上書きします。website UUIDはtrackerに公開される識別子ですが、環境ごとの運用値はコードへ直書きせずCloudflare Pages側で管理します。Preview・ローカル環境では`PUBLIC_UMAMI_WEBSITE_ID`を設定しない限り、外部scriptの読込もイベント送信も行いません。

### robots.txt・sitemap.xml(release-mode buildでのみ生成)

`npm run build`は、Astro buildと日本語404 fixupの後に[scripts/generate-search-publication-files.mjs](scripts/generate-search-publication-files.mjs)を実行します。

- `PUBLIC_ALLOW_INDEXING`が厳密に`"true"`でないbuild(通常build。CI・Previewは常にこちら)では、`dist/robots.txt`・`dist/sitemap.xml`は**生成しません**。既存のdist/に古いrelease-mode成果物が残っていれば削除します。
- release-mode buildのみ`dist/`配下のHTMLを走査し、canonicalを持ち・noindexが付いていないページだけを対象に生成します。現状はちょうど24 URL(英語のトップ+ツール14ページ、日本語のトップ+ツール8ページ)で、licenses/privacy/terms/contact/404/`/en/`は含みません。対象URL数の期待値は[scripts/lib/site-pages.mjs](scripts/lib/site-pages.mjs)のmanifestから導出しており(マジックナンバーの直書きではない)、一致しない場合はファイルを生成せずbuildを失敗させます。
- `sitemap.xml`は`https://limifile.com`を起点とした絶対URL・末尾スラッシュ付きのcanonical URLのみを含みます。`lastmod`・`changefreq`・`priority`・`xhtml:link`(hreflang)は含めません(hreflangは各ページのHTML headに既にあるため重複させず、実際の更新日時を正確に管理していないため架空の`lastmod`は生成しません)。
- `robots.txt`は`User-agent: * / Allow: / / Sitemap: https://limifile.com/sitemap.xml`のみで、`Disallow: /`は含みません(noindexはページ単位の`meta robots`が担います)。
- **既知事項**: Cloudflareのcontent-signalsポリシーにより、本番の`https://limifile.com/robots.txt`レスポンスはCloudflare管理の内容がこのrepository成果物の前にprependされる場合があります。これはCloudflare側の責務であり、このリポジトリのbuild成果物はrepository由来分のみを対象としています。

## ライセンス

- LimiFile自身のソースコードは**Apache License 2.0**です([LICENSE](LICENSE))。
- **repository全体が単一のライセンスで提供されているわけではありません。** CC0のテストフィクスチャ、上流プロジェクトのライセンス全文、混在ライセンスのHEIC source package、ブランド資産は、それぞれコードライセンスの対象外です。path別の対応は[LICENSING.md](LICENSING.md)が正です。
- LimiFileの名称・ロゴ・ブランド資産はコードライセンスから分離しています([TRADEMARKS.md](TRADEMARKS.md))。
- 第三者componentはそれぞれ個別のライセンスが適用されます([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)・`/licenses/`ページ)。
- **ビルド成果物を再配布する場合**、HEICデコードWASMにlibheif・libde265(LGPL-3.0-or-later)が静的リンクされている点に注意してください。Apache-2.0はこのモジュールに対するLGPLの条件を免除しません。[LICENSING.md](LICENSING.md)のLGPL節を参照してください。
- 対応するsource packageは`/source/filefit-heic-decoder-1.0.0-source.tar.gz`として公開しています。ファイル名に旧プロジェクト名が残っているのは意図的で、既存リンク・ハッシュの検証可能性を保つためです。

## コントリビュート

詳細は[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。要点は、Apache-2.0(inbound = outbound)で受け付けること、CLA・DCO sign-offは不要であることの2つです。Pull Requestを開く前に、CIと同じチェックを実行してください。

```bash
npm run lint && npm run typecheck && npm run test && npm run format:check && npm run build
npm run verify:404 && npm run verify:licenses && npm run verify:i18n-seo-foundation \
  && npm run verify:trust-pages && npm run verify:tool-seo-content \
  && npm run verify:search-publication && npm run verify:lgpl-heic-source-package
```

変更前に知っておくとよい方針が2つあります。

- **プライバシー上の主張は機能そのものです。** 選択ファイルが端末外へ出る可能性のある変更は、no-file-uploadの回帰テストが検知します。変更を通すためにこのテストを緩めないでください。
- **ライセンス文書の事実はビルド成果物と突き合わせて検証されます。** `verify:licenses`が落ちた場合、直すべきなのはドキュメント側です。

セキュリティ上の問題を見つけた場合はIssueを立てないでください — [SECURITY.md](SECURITY.md)を参照してください。

## trust pages(プライバシー・利用規約・お問い合わせ)

- プライバシーポリシー: `/privacy/`・`/ja/privacy/`
- 利用規約: `/terms/`・`/ja/terms/`
- お問い合わせ: `/contact/`・`/ja/contact/`
- 公開問い合わせ先: `bunmeiproducts@gmail.com`(mailtoリンク。お問い合わせフォームや外部フォームサービスは使用していません)

いずれもJavaScriptを読み込まない静的ページで、noindex,nofollowを付与しています。内容は実装済みの機能・コード監査結果に基づいて記載しており、外部法律専門家による確認済みである、または法的有効性を保証するものではありません。

## deployment

- GitHubの`main`ブランチとCloudflare Pagesが連携しており、`main`へのマージでProduction環境へ自動デプロイされます。
- Build command: `npm run build` / Build output directory: `dist`
- Pull Requestを開くとCloudflare Pages Preview環境へ自動デプロイされ、PRのチェックにpreview URLが表示されます。
- Production URL: <https://limifile.com/>

## 未確定事項・仮定した内容

- Node.jsバージョンはLTS(22系)を仮定しています。
- 各ツールページの内容は現在の実装範囲・制約に合わせて記載しています。指定容量への到達・画質/色/透明度/寸法/メタデータの保持・特定ブラウザやOSでの動作は保証していません。詳細は[利用規約](https://limifile.com/ja/terms/)を参照してください。
- HEIC変換のLGPL-3.0対応については[/ja/licenses/](https://limifile.com/ja/licenses/)・[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)・source package内`README.md`に記載の通り、LimiFileの技術・ライセンス自己レビューに基づくものであり、外部法律専門家による確認や法的十分性の保証を意味しません。

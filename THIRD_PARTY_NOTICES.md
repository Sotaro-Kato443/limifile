# Third-Party Notices

このドキュメントは、FileFitが利用する第三者オープンソースソフトウェア(OSS)の一覧です。利用者向けの表示は [`/licenses`](https://limifile.com/licenses)(サイト内、`src/pages/licenses.astro`)を参照してください。本ドキュメントは開発者・監査向けの詳細版であり、Production配布物への含有有無まで区別して記載します。

本ドキュメントは法的な断定を行うものではなく、コード・ビルド成果物・パッケージ文書・上流一次資料から確認できた事実を記載するものです。

## ページ別のクライアント配布物(2026年7月時点、ビルド成果物・実ブラウザNetworkログで確認)

FileFitの9ページは、クライアント側JavaScriptの配布有無で2つに分かれます。

| ページ                                                                                                                       | astro-island | `<script>` | 実際にfetchされるJS                                                                                                          | 静的HTML・CSSのみか |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `/`, `/heic-to-jpg`, `/compress-image`, `/compress-image-to-500kb`, `/remove-exif`, `/png-to-webp`, `/compress-png`(7ページ) | あり(1件)    | あり(3件)  | `client.*.js`(Astro Islandランタイム)、`preact.module.*.js`、`hooks.module.*.js`、各ページ固有のWorkbenchコンポーネントchunk | いいえ              |
| `/404`, `/licenses`(2ページ)                                                                                                 | なし         | なし       | なし(CSSのみ)                                                                                                                | はい                |

`@preact/signals`・`@preact/signals-core`(`signals.module.*.js`)は、Astro Islandランタイムが対応コンポーネントの起動時に動的importするビルド成果物として`dist/_astro/`に存在しますが、実際に`astro preview`でページを開き、ブラウザのNetwork requestsを確認した限り、現在のFileFitのどのページを読み込んでもこのファイルはfetchされません(該当するコンポーネントの`astro-island`要素に`data-preact-signals`属性が付与されていないため)。

## 一覧

| 名称                                                         | Exact Version                                      | Production配布                                                                                       | ライセンス                                                                                    | 著作権表示                                                                                                                                                                                                                                                  | 公式ソース                                                                                        | FileFit内の用途                                                                                                                     | ライセンス全文の配置場所                                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@discourse/heic`                                            | 1.0.0(package.jsonで完全固定。`^`範囲指定ではない) | あり(Worker、HEIC選択時のみ遅延ロード)                                                               | Apache License 2.0                                                                            | Copyright [2023] jamsinclair(jSquash全体)。ただし`packages/heic/utils.ts`は個別に"Copyright 2020 Google Inc."を表示し、Jamie Sinclairによる改変(手動WASMインスタンス化を可能にする変更)である旨のnoticeを含む — jSquashはJamie Sinclair単独の著作物ではない | https://github.com/discourse/jSquash                                                              | HEIC/HEIFデコードWASMのJSラッパー                                                                                                   | `public/licenses/apache-2.0.txt`(canonical本文)。jSquashが実際に配布する`LICENSE`ファイル(jamsinclair宛の著作権表示入り)はsource package内`jsquash/LICENSE`に無改変で同梱 |
| libheif(`@discourse/heic`のWASMに静的リンク)                 | 1.19.7                                             | あり(`heic_dec.wasm`内)                                                                              | GNU LGPL v3(ライブラリ本体)                                                                   | strukturag/libheif                                                                                                                                                                                                                                          | https://github.com/strukturag/libheif/tree/v1.19.7                                                | HEIF/HEICコンテナ処理                                                                                                               | `public/licenses/lgpl-3.0.txt`(+`gpl-3.0.txt`)                                                                                                                            |
| libde265(`@discourse/heic`のWASMに静的リンク)                | 1.0.15                                             | あり(`heic_dec.wasm`内)                                                                              | GNU LGPL v3(ライブラリ本体)                                                                   | strukturag/libde265                                                                                                                                                                                                                                         | https://github.com/strukturag/libde265/tree/v1.0.15                                               | HEVC(H.265)デコード                                                                                                                 | `public/licenses/lgpl-3.0.txt`(+`gpl-3.0.txt`)                                                                                                                            |
| `@upng/upng-js`                                              | 2.2.2                                              | あり(Worker、PNG圧縮時のみ動的import)                                                                | MIT License                                                                                   | Copyright (c) 2017 Photopea                                                                                                                                                                                                                                 | https://github.com/webLiang/UPNG.js(npm配布元、オリジナルは https://github.com/photopea/UPNG.js ) | PNGエンコード                                                                                                                       | `public/licenses/mit-upng.txt`                                                                                                                                            |
| `pako`                                                       | 2.2.0                                              | あり(`@upng/upng-js`経由、Worker)                                                                    | MIT License                                                                                   | Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn                                                                                                                                                                                                | https://github.com/nodeca/pako                                                                    | deflate圧縮                                                                                                                         | `public/licenses/mit-pako.txt`                                                                                                                                            |
| `preact`                                                     | 10.29.7                                            | あり(`client:load`ページ7件のみ。`/404`・`/licenses`には配布されない)                                | MIT License                                                                                   | Copyright (c) 2015-present Jason Miller                                                                                                                                                                                                                     | https://github.com/preactjs/preact                                                                | UIランタイム                                                                                                                        | `public/licenses/mit-preact.txt`                                                                                                                                          |
| Astro Islandクライアントランタイム(`astro`由来、`client.js`) | 7.1.3                                              | あり(同上7ページのみ)                                                                                | MIT License                                                                                   | Copyright (c) 2021 Fred K. Schott                                                                                                                                                                                                                           | https://github.com/withastro/astro                                                                | `client:load`コンポーネントの起動・hydration。Astro本体のうち静的HTML生成・コンパイル部分とは別に、この部分のみブラウザへ配布される | `public/licenses/mit-astro.txt`                                                                                                                                           |
| `@astrojs/preact`                                            | 6.0.1                                              | あり(同上7ページのみ。上記Astro Islandランタイムの一部として配布)                                    | MIT License                                                                                   | Copyright (c) 2021 Fred K. Schott                                                                                                                                                                                                                           | https://github.com/withastro/astro/tree/main/packages/integrations/preact                         | Astro⇔Preact統合(ビルド構成+クライアントランタイムの一部)                                                                           | `public/licenses/mit-astro.txt`                                                                                                                                           |
| `@preact/signals`                                            | 2.10.0                                             | ビルド成果物には含まれるが、現在のFileFitのどのページからも実際にはfetchされない(上表参照)           | MIT License                                                                                   | Copyright (c) 2022-present Preact Team                                                                                                                                                                                                                      | https://github.com/preactjs/signals                                                               | Preact Signalsを使うコンポーネントの状態管理(現状未使用)                                                                            | `public/licenses/mit-preact-signals.txt`                                                                                                                                  |
| `@preact/signals-core`                                       | 1.14.4                                             | 同上                                                                                                 | MIT License                                                                                   | Copyright (c) 2022-present Preact Team                                                                                                                                                                                                                      | https://github.com/preactjs/signals                                                               | 同上                                                                                                                                | `public/licenses/mit-preact-signals.txt`                                                                                                                                  |
| `@lucide/astro`                                              | 1.32.0                                             | あり(ビルド時にinline SVGとしてHTMLへ展開。パッケージ自体・JS・アイコンフォント・spriteは配布しない) | ISC License(Lucide本体)。ただしLucideがFeatherプロジェクトから派生させたアイコンはMIT License | Copyright (c) 2026 Lucide Icons and Contributors。Feather由来アイコンはCopyright (c) 2013-present Cole Bemis                                                                                                                                                | https://github.com/lucide-icons/lucide/tree/main/packages/astro                                   | UIアイコン(6種類。内訳は下記「UIアイコンの配布実態」参照)                                                                           | `public/licenses/isc-mit-lucide.txt`(Lucideが配布するLICENSEファイルを無改変で収録。ISCとFeather MITの両方の表示を含む)                                                   |
| `astro`(静的HTML生成・コンパイル部分)                        | 7.1.3                                              | **なし(ビルド時のみ実行、ブラウザへは配布されない)**                                                 | MIT License                                                                                   | Copyright (c) 2021 Fred K. Schott                                                                                                                                                                                                                           | https://github.com/withastro/astro                                                                | 静的サイトジェネレータ本体                                                                                                          | `public/licenses/mit-astro.txt`                                                                                                                                           |

`mit-astro.txt`は、`astro`パッケージと`@astrojs/preact`パッケージの`LICENSE`ファイルが完全に同一内容であることを`diff`で確認したうえで、1ファイルに統合しています(内容は無改変)。

上記以外の開発専用dependency(vitest, jsdom, @testing-library/*, eslint, typescript, typescript-eslint, prettier, @types/node, @astrojs/checkほか多数のtransitive依存)は、ソースコード上lint・test・typecheck・ビルド時にのみ使用されます。Productionビルド成果物(`dist/`)も確認し、これらのpackage名が実際のブラウザ配布物(HTML・JS・WASM)に含まれていないことを個別に確認したうえで、利用者向け主要ライセンス一覧の対象外としています。ただし、ミニファイ後のbundleにpackage名の文字列が一切残らない可能性がある(=文字列検索で見つからないことは、含まれていないことの完全な証明にはならない)点には留意してください。これらは本ドキュメント・`/licenses`ページのいずれにも個別列挙しません。

## UIアイコンの配布実態(`@lucide/astro`)

`@lucide/astro`はビルド時にinline SVGへ展開されるため、上の「ページ別のクライアント配布物」表(JavaScript配布の有無を基準にした表)には収まりません。JavaScriptは一切配布せず、生成されたSVG要素のみがHTMLへ埋め込まれます。

配布しているアイコンは6種類で、`npm run build`後の`dist/`配下のHTMLを実際に走査して確認しています。

| アイコン                          | 由来        | ライセンス                         | 出現ページ                                                  |
| --------------------------------- | ----------- | ---------------------------------- | ----------------------------------------------------------- |
| `chevron-down`                    | Feather由来 | MIT(Cole Bemis)                    | `SiteNav`を描画する全ページ(ビルドされる34ページ中30ページ) |
| `arrow-right`                     | Feather由来 | MIT(Cole Bemis)                    | トップページ2件(`/`・`/ja/`)のみ                            |
| `trash-2`                         | Feather由来 | MIT(Cole Bemis)                    | トップページ2件のみ                                         |
| `arrow-left-right`                | Lucide独自  | ISC(Lucide Icons and Contributors) | トップページ2件のみ                                         |
| `chart-no-axes-column-increasing` | Lucide独自  | ISC                                | トップページ2件のみ                                         |
| `file-search`                     | Lucide独自  | ISC                                | トップページ2件のみ                                         |

Lucideが配布する`LICENSE`ファイルは、ISC本文に続けて「Featherプロジェクト由来アイコン115件」の一覧とFeatherのMIT本文を併記しています。`package.json`の`license`フィールドは`ISC`とだけ記載していますが、**実際の配布物には両方のライセンスが関わります**。上表のFeather由来/Lucide独自の区別は、そのLICENSEファイル中の115件リストと、`dist/`で実際に配布しているアイコン名を突き合わせて判定しました。

アイコンを含まない4ページは`/404`・`/ja/404`・`/licenses`・`/ja/licenses`です。これらは`SiteNav`を描画せず、`BaseLayout`上に最小限のヘッダー(ブランドロゴとLanguageSwitcher)だけを置いているためです。

## HEICデコードWASMの構成

- `@discourse/heic`(1.0.0)が配布する`codec/dec/heic_dec.wasm`(959,554バイト)には、libheif(1.19.7)とlibde265(1.0.15)が含まれます。
- 上流リポジトリ`discourse/jSquash`の`packages/heic/codec/Makefile`を確認したところ、両ライブラリは`BUILD_SHARED_LIBS=OFF`で静的ライブラリとしてビルドされたうえで、単一の`emcc`呼び出しにより1つのWASMファイルへ静的リンクされています。
- 同Makefileでは、x265・AOM(AV1)・dav1d・rav1e・SvtEnc・Kvazaar等の他コーデックはすべて明示的に無効化(`WITH_X265=OFF`等)されており、libde265(デコードのみ、`ENABLE_ENCODER=OFF`)のみが有効です。
- FileFit自身のコード(`src/components/image-intake/heic-convert.worker.ts`)は、`@discourse/heic/decode`が公開する`decode()`関数のみを呼び出しており、`encode`系のAPIは一切利用していません。FileFitはHEIC画像のデコードのみを行い、エンコードは行いません。
- FileFitのリポジトリ内に`patch-package`等の仕組みやpostinstallスクリプトは存在せず、`node_modules/@discourse/heic`配下のWASM・JSファイルを改変する処理は見つかりませんでした。

## Emscripten・システムruntimeの構成(重要な訂正: importと内部実装の区別)

`heic_dec.wasm`は、libheif・libde265のコードに加えて、Emscripten
3.1.57が生成したruntime補助コードに依存しています。ここで**「WASMがある関数をimportする」ことと「その関数の実装がWASM内部にある」ことを混同しないでください**。importは「`heic_dec.js`側にその関数の実装を要求する」という宣言であり、WASM自身がその実装を持っている証拠ではありません。

- `__embind_register_*`(16種)・`__emval_*`(11種)は**いずれもimport**です。embind/emvalの実際の登録処理(レジストリ管理)は`heic_dec.js`が生成するEmscripten
  runtime側に実装されており、WASM内部にリンクされているわけではありません(WASM側は「何を登録するか」を決めるコードのみを含みます)。
- `__syscall_openat`・`__syscall_getdents64`・`__syscall_unlinkat`・`fd_read`・`fd_write`・`fd_seek`・`fd_close`・`environ_get`・`environ_sizes_get`・`strftime_l`も**import**です。musl由来のJS側shimとして`heic_dec.js`に実装されており、これらの生バイトsyscallの実体がWASM内部にコンパイルされているわけではありません(より高レベルなmuslのlibc関数がWASM内部に別途コンパイルされているかどうかは未確認です)。
- `__cxa_throw`も**import**です。C++例外を投げる際、WASMはネイティブのUnwind処理を行わず、`heic_dec.js`側のJS実装へ呼び出します。これはlibc++abiの例外処理機構全体がWASM内部にコンパイルされている証拠ではありません。
- 一方、`___cxa_is_pointer_type`・`___getTypeName`・`__cxa_increment_exception_refcount`は**WASMのexport**であり(WASM自身がこれらを実装・公開している)、C++
  RTTI(`__cxxabiv1`のtype_info、`std::string`系のmangled
  name文字列)もWASM内部のデータに直接存在します。これはlibc++abiのコードが実際にWASM内部へコンパイルされている直接証拠であり、importである`__cxa_throw`とは性質が異なります。
- compiler-rt・libunwindについては、WASM内部への含有を裏付けるsymbol・文字列証拠は見つかっていません。**未確認**です。

**最終的に配布される成果物は`heic_dec.js`と`heic_dec.wasm`の組み合わせ全体です。** `heic_dec.wasm`単体だけを見て「何が含まれるか」を語るのは不完全です。

| 構成要素                                                     | ライセンス                                            | 著作権者               | 証拠の強さ                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| Emscripten runtime本体・embind・emval(`heic_dec.js`側の実装) | MIT / University of Illinois-NCSA                     | The Emscripten Authors | `heic_dec.js`内に実装を確認(import先として)                          |
| musl libc(syscallの低レベル呼び出し)                         | MIT                                                   | musl libc project      | importとして確認。より高レベルなmusl関数のWASM内部コンパイルは未確認 |
| libc++ / libc++abi                                           | Apache License 2.0 WITH LLVM Exceptions               | The LLVM Project       | WASM内部への直接コンパイルを確認(export・文字列証拠)                 |
| compiler-rt / libunwind                                      | Apache License 2.0 WITH LLVM Exceptions(含まれる場合) | The LLVM Project       | **未確認**(直接証拠なし)                                             |
| dlmalloc(既定allocator候補)                                  | CC0 1.0(パブリックドメイン)                           | Doug Lea               | toolchain既定からの推定のみ。symbol証拠による確定はできていない      |

Emscripten本体・musl・libc++系のいずれについても、**source一式はこのリポジトリにもsource
packageにも同梱していません**。GPLv3
§1「System
Libraries」(コンパイラの通常配布形態に含まれるもの)・LGPLv3
§0の同種除外規定に基づく整理ですが、**この除外がFileFitの配布に対して法的に十分かどうかは断定していません**。ライセンス全文は参考として`public/licenses/mit-emscripten.txt`・`public/licenses/mit-musl.txt`・`public/licenses/apache-2.0-llvm-exception.txt`に掲載しています。`apache-2.0-llvm-exception.txt`記載のLLVM
Exception条項は、コンパイル結果としてObject形式へ埋め込まれた部分について、Apache-2.0第4条(a)(b)(d)の遵守義務を明示的に免除するとしています — 免除される旨は一次資料の文言どおりに記録しており、要約による言い換えはしていません。

## LGPL対応ソースpackage

**FileFitの技術・ライセンス自己レビューに基づいて提供しているsource
packageです。外部法律専門家による確認は行っておらず、法的助言または法的十分性の保証を意味しません。LGPL対応が完了したことも断定しません。**

- Production WASM(`heic_dec.wasm`)SHA-256: `832bfb37148038257e56216d165cfae24a8afaa7cae8fc0ddb1ef4bf495612a9`
- jSquash exact commit: `345892e0e48b428d47875a5b5678fbcf58f2880e`
- libheif exact tag: `v1.19.7` / libde265 exact tag: `v1.0.15`
- Emscripten version: `3.1.57`(`emscripten/emsdk:3.1.57`、digest `sha256:8b7c9e9e95f3fb92b94876727a35235a8d2908c4d7e2ef2427f78366fd0b1130`)
- source package名: `filefit-heic-decoder-1.0.0-source.tar.gz`(配置: `public/source/filefit-heic-decoder-1.0.0-source.tar.gz`、[/source経由で配信](/source/filefit-heic-decoder-1.0.0-source.tar.gz))
- source package SHA-256: `d1f94bf158223da690c18196f4858506cb9e79f4ba30e22a2b7fee226652cfd8`(2,530,244 bytes、2.41 MiB。jSquashの完全なmonorepo commit archiveは含めず、`packages/heic/`(全16ファイル)と`tools/`(全5ファイル)のみ展開済みtreeとして同梱。HEICと無関係な他jSquashパッケージ(avif/jpeg/png/webp/jxl/jxr/oxipng/qoi/resize/gif)を含めていないのは容量削減目的の恣意的な削除ではなく、HEIC WASMのビルドに一切関与しないパッケージを技術的に除外したものであり、LGPL上のMinimal Corresponding Sourceの法的範囲を確定するものではありません。exact commit自体はarchive取得時にSHA-256検証済み。詳細は`SOURCE-METADATA.json`の`sources.jsquash.packagedAs`を参照)
- ビルド手順: package内`BUILD.md`(再リンク: libheif・libde265それぞれについて`modified-libheif`・`modified-libde265`モードを用意)
- 再リンク手順: package内`REPLACE-WASM.md`
- package内ファイルのライセンス対応: `LICENSE-MAP.md`
- 上記exact sourceからのProduction WASM完全再現(バイト一致)、および改変版libheif・改変版libde265との再リンク(いずれもJS glueは無変化)を技術的に実証済みです。実行結果は`SOURCE-METADATA.json`の`relinkResults`に記録しています。
- **この実証は第三者が独立に再現できます。** 過去の検証記録へのリンクを根拠として示す代わりに、再現手順そのものを提供します。このリポジトリの[.github/workflows/verify-lgpl-heic-source-rebuild.yml](.github/workflows/verify-lgpl-heic-source-rebuild.yml)を`workflow_dispatch`で実行してください。同workflowは、source packageのみを入力として`--network=none`のコンテナ内でbaseline・modified-libheif・modified-libde265の3種をビルドし、baselineがProductionの`heic_dec.wasm`・`heic_dec.js`とバイト一致するかを厳格に判定します(1つでも欠ければjobを失敗させ、false-greenを出しません)。判定に用いる期待値(package SHA-256・Production WASM/JSのSHA-256・Emscripten imageのdigest)はすべて同workflowにpinされており、本ドキュメントの記載と突き合わせて確認できます。`./rebuild.sh`をpackage内の`BUILD.md`に従ってローカルで直接実行しても同じ検証が可能です。
- **package内のドキュメントに含まれる開発記録への参照は、現在は辿れません。** 出荷済みのpackage内`README.md`・`BUILD.md`には、公開前の開発時点で参照していた記録へのリンクが埋め込まれています。packageは意図的に再生成していない(再生成すると記録済みSHA-256が変わり、上記のバイト一致の証跡が無効になる)ため、これらのリンクは残ったままです。**証跡としてはこれらのリンクに依存せず、前述のworkflowによる再現手順を正としてください。** 同じ理由で、packageを生成する`scripts/build-lgpl-heic-source-package.mjs`にも同じリンクがテンプレートとして残っています(出力の再現性を保つため変更していません)。
- 実HEIC画像での正常デコードは**未確認**です(ライセンスが明確なfixtureが用意でき次第、別途確認予定)。
- 本package・本節は、FileFitによる技術・ライセンス自己レビューに基づいて公開しています。外部法律専門家による確認は行っていません。Corresponding
  Application Codeの範囲、source-only提供の十分性、配布期間等は、法的な解釈の余地が残る残余リスクとして記録しており(「未解決事項」参照)、これらの論点が確定していないことは公開を妨げるものとは扱っていません。
- Application Codeの範囲は`heic_dec.cpp`のみに限定していません。libheifとの関係ではjSquashの`Makefile`・`pre.js`・ビルド設定も最終的なCombined
  Workの構成に関与し、libde265との関係では改変版との再結合にlibheif側のsourceも関与します(libheifがlibde265をHEVCデコーダのpluginとして利用するため)。いずれも法的な最終結論ではなく、技術的な事実整理です。

## source保持方針

- FileFitが対応するWASMをネットワーク上で提供している間、対応するsource
  packageも同じ場所(`/source/`配下)で無償公開を継続します。
- `@discourse/heic`のversionが変わった場合、新しいversion番号付きのpackageを新規に公開します(既存packageを上書きしません)。
- 何らかの経路で旧WASMが取得可能な状態が続く場合、対応する旧source
  packageも削除せず維持します。
- GitHub Actions artifact(自動的に失効する)は、正式な配布場所としては使用しません。リポジトリ内の永続ファイル(`public/source/`)を正式な配布場所とします。
- package名・SHA-256・sizeは、本ドキュメント・`/licenses`・package内`SOURCE-METADATA.json`のいずれにも記録し、package再生成のたびに同期して更新します。

これは運用方針の記載であり、保持期間や配布方法が法的に十分であることを断定するものではありません。

## 未解決事項(残余の法的解釈リスク)

これらは、FileFitの自己レビューでは確定的な結論に至っていない解釈上の論点であり、外部法律専門家による確認を経ていません。これらの論点が残っていること自体は、本packageの公開を妨げる条件としては扱っていません。

- Corresponding Application Codeの範囲(`heic_dec.cpp`単独か、jSquashの`Makefile`・`pre.js`・FileFitの`heic-convert.worker.ts`まで含むか)には解釈の余地があります。
- source-only提供(object/bitcodeを含まない形での提供)がLGPL上十分かについても解釈の余地があります。
- System Libraries除外(Emscripten runtime・musl・libc++等)がFileFit固有の配布に法的に適用されるかは確定していません。
- 実HEIC画像でのデコード動作確認は未確認です(ライセンスが明確なfixture未整備のため)。
- HEVC(H.265)特許に関する検討は本ドキュメントの対象外です(LGPL論点とは別問題として扱います)。

本ドキュメントは、FileFitの技術・ライセンス自己レビューに基づく第三者ライセンス表示整備の一環として作成したものであり、FileFitがすべての法的義務を満たしていることを主張するものではなく、外部法律専門家による確認や法的助言でもありません。

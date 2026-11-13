# 通常開発用リポジトリ — 作業開始時に必ず確認

このチェックアウトがLimiFileの現在のPublic版・通常開発先です。LimiFileに関する作業を始める最初に、`git rev-parse --show-toplevel`が`/Users/sotaro/Developer/limifile-public`を指し、`git remote get-url origin`が`https://github.com/Sotaro-Kato443/limifile.git`を指すことを確認してください。確認が済むまではファイルの読み書き、Git操作、ビルド、デプロイを始めないでください。どちらかが一致しない場合は作業を止め、ユーザーにPublic側の新しいタスクを開いてもらってください。このチェックは既存タスクにも毎回適用します。隣の`/Users/sotaro/Developer/LimiFile`は`Sotaro-Kato443/limifile-archive`につながるArchiveで、今後の通常開発には使いません。

プロダクト、SEO、アクセス解析、プライバシー、ライセンス、公開・告知に関する判断の前に、公開用の英語版`PROJECT_CONTEXT.md`を必ず読んでください。個人用の`PROJECT_CONTEXT.ja.private.md`は通常読まず、ユーザーが日本語版からの同期を依頼したときだけ読みます。日本語版がユーザーの原本、英語版がPublic/AI向けの対応版です。ユーザーが日本語版を更新して同期を依頼した場合、意味を保って英語版へ反映してください。公開・投稿、検索登録、デプロイの現在状態は、引き継ぎ記録だけで確定せず、一次情報で確認してください。

## プロジェクト管理（9th Cloma / folio）

9th Cloma（MCP接続名 `folio`）は、人間が状況を把握するための可視化・管理ツールとして使います。実作業の正本は引き続きローカルファイル・Git/GitHub・`AGENTS.md`・`RESUME.md`（存在する場合）などに置きます。

- 作業開始時は、上記のチェックアウト確認後に `list_projects` でLimiFileの固定ID（現在 `limi`）を確認し、`get_project` で最新のrevision・登録情報・`summary.sources`を読みます。登録された正本と、この作業フォルダの資料・Gitの実際の状態を照合してから作業します。
- 出典が未登録、参照不能、または資料が存在しない場合は、その旨を明示します。アプリや引き継ぎ記録だけで現状を断定せず、ログにない作業を未実施とみなさず、不明点を推測で埋めません。公開・検索登録・デプロイなどの外部状態は一次情報で確認します。
- 作業終了時は、まず結果を正本へ反映し、その内容を確認してから `update_project` で `summary.status`・`phase`・`currentState`（240文字以内）・`nextAction`（主1件、300文字以内）を短く更新します。確認した出典を `summary.sources` に、確認時点・版・確実性を `summary.evidence` に残します。提案と確定事項、確認済みと未確認を区別します。
- 更新には最新revisionと依頼ごとのUUIDを使います。競合時は最新情報と正本を読み直し、他の変更を保ちます。folioに接続できない場合はローカルに引き継ぎを残し、同期できなかった旨を報告します。

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

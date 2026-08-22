import type { TrustContent } from "../trust-content-types";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "../trust-content-types";

// ページごとに独立した日付を持つ。実質的な内容変更があったページだけを更新するため、
// 共通の定数を複数ページで共有しない(共有すると、変更していないページの日付まで動く)。
const PRIVACY_EFFECTIVE_DATE_LABEL = "制定日・最終更新日：2026年8月20日";
const TERMS_EFFECTIVE_DATE_LABEL = "制定日・最終更新日：2026年8月21日";
const CONTACT_EFFECTIVE_DATE_LABEL = "制定日・最終更新日：2026年8月18日";

export const ja: TrustContent = {
  privacy: {
    title: "プライバシーポリシー",
    description:
      "LimiFileのブラウザ内画像ツールをご利用いただく際の、画像およびその他データの取り扱いについて説明します。",
    heading: "プライバシーポリシー",
    effectiveDateLabel: PRIVACY_EFFECTIVE_DATE_LABEL,
    sections: [
      {
        heading: "1. サービス概要",
        paragraphs: [
          [
            {
              type: "text",
              text: "LimiFileはブラウザ上で動作する画像処理ツール群です。対応する処理(形式変換・圧縮・メタデータ削除等)は、利用者の端末内、ブラウザ内で行われます。LimiFileのアプリケーションコードは、選択した画像ファイルをLimiFileのサーバーへアップロードするようには設計されていません。",
            },
          ],
        ],
      },
      {
        heading: "2. 選択画像の取り扱い",
        paragraphs: [
          [
            {
              type: "text",
              text: "選択した画像は、ブラウザ内で解析・変換・圧縮・メタデータ処理されます。選択画像の内容をLimiFileのサーバーへ送信する機能は、現時点では実装していません。ページの再読み込みやタブの終了により、ブラウザ内の一時的な状態は通常失われます。出力ファイルの保存・共有・ダウンロードは、利用者ご自身の操作によるものです。LimiFileが利用者の画像をクラウド上に保存する機能は、現時点ではありません。",
            },
          ],
        ],
      },
      {
        heading: "3. 通常のサイト配信データ",
        paragraphs: [
          [
            {
              type: "text",
              text: "本サイトを表示するため、ブラウザはHTML・CSS・JavaScript・WebAssembly等を、ホスティング環境から取得します。ホスティング・セキュリティ・障害対応に必要な範囲で、配信を担う事業者が通常のリクエスト情報を処理する場合があります。これは、LimiFileのアプリケーションコードによる画像アップロードとは別の話です。前述の通り、LimiFileのコードはそのような処理を行いません。",
            },
          ],
        ],
      },
      {
        heading: "4. cookie・localStorage・アクセス解析",
        paragraphs: [
          [
            {
              type: "text",
              text: "本ポリシーの制定日時点で、LimiFileは独自のアクセス解析・広告配信・アカウントログイン目的でcookieやブラウザのlocalStorageを使用していません。将来これを変更する場合は、本ポリシーを更新します。",
            },
          ],
          [
            {
              type: "text",
              text: "アクセス状況の把握のため、本サイトの配信を担うCloudflareが提供するWeb Analyticsを利用しています。これはcookieもlocalStorageも使用せず、端末のフィンガープリントの取得や、サイトをまたいだ利用者の追跡も行いません。記録されるのは、閲覧されたページ・参照元・国・ブラウザ種別・端末種別といった、個人を特定しない情報に限られます。画像そのものがこの計測の対象になることはありません。",
            },
          ],
          [
            {
              type: "text",
              text: "画像ツールが正常に動作しているかを把握するため、Umami Cloudも利用します。Umamiによる自動ページビュー計測は無効にし、LimiFileから送信するのは、処理開始・処理成功・処理失敗・出力のダウンロードまたは保存の4イベントだけです。各イベントにはツール識別子を含め、失敗時に限り、あらかじめ分類したエラーカテゴリも含めます。計測用スクリプトは、ブラウザのDo Not Track設定を尊重するよう構成します。",
            },
          ],
          [
            {
              type: "text",
              text: "イベントの受信に伴い、Umamiはcookieを使わず、接続元IPアドレス、User-Agent、サイト識別子等から定期的に変わる匿名セッションを生成します。また、イベントが発生したURLパス・ホスト名・参照元、ブラウザ・OS・端末種別、画面サイズ、ブラウザ言語、おおよその国・地域・都市、発生時刻を標準情報として記録します。LimiFileはUmamiのDistinct ID等の利用者識別子を設定せず、異なる端末やサイトをまたいで利用者を関連付けません。",
            },
          ],
          [
            {
              type: "text",
              text: "Umamiへ、選択画像、画像の内容、ファイル名、ファイル容量、画像寸法、画像のメタデータ、出力ファイル、自由記述のエラー内容を送信することはありません。この計測を導入しても画像処理を行う場所は変わらず、画像そのものは端末内に留まり、ブラウザ内で処理されます。",
            },
          ],
        ],
      },
      {
        heading: "5. 外部リンク",
        paragraphs: [
          [
            {
              type: "text",
              text: "本サイトの一部のページは、外部サイトへリンクしています(例: ライセンスページで参照する公式ソースリポジトリ等)。LimiFileを離れた先のサイトには、そのサイト自身のプライバシーポリシーが適用され、LimiFileはリンク先サイトのデータの取り扱いを管理していません。",
            },
          ],
        ],
      },
      {
        heading: "6. お問い合わせ",
        paragraphs: [
          [
            { type: "text", text: "本ポリシーに関するご質問は、" },
            { type: "externalLink", href: CONTACT_MAILTO, label: CONTACT_EMAIL },
            { type: "text", text: " までご連絡ください。" },
          ],
        ],
      },
      {
        heading: "7. 本ポリシーの変更",
        paragraphs: [
          [
            {
              type: "text",
              text: "機能や適用法令、運用状況の変化に応じて、本ポリシーの内容を更新する場合があります。重要な変更は、本ページ上で分かる形で掲載します。",
            },
          ],
        ],
      },
    ],
  },
  terms: {
    title: "利用規約",
    description:
      "LimiFileのブラウザ内画像ツールをご利用いただく際に適用される条件について説明します。",
    heading: "利用規約",
    effectiveDateLabel: TERMS_EFFECTIVE_DATE_LABEL,
    sections: [
      {
        heading: "1. サービス内容",
        paragraphs: [
          [
            {
              type: "text",
              text: "LimiFileはブラウザ内で動作する画像処理ツールです。利用にアカウントは不要です。対応するブラウザ・端末・画像形式には制約があり、すべての組み合わせに対応しているわけではありません。",
            },
          ],
        ],
      },
      {
        heading: "2. 利用者の責任",
        paragraphs: [
          [
            {
              type: "text",
              text: "処理する画像について、必要な権利・許可をお持ちであることは利用者の責任です。出力結果は、利用前にご自身でご確認ください。元ファイルのバックアップは利用者ご自身で保持してください。機密性の高い画像をLimiFileで処理するかどうかは、利用者ご自身の判断によるものです。",
            },
          ],
        ],
      },
      {
        heading: "3. 禁止事項",
        paragraphs: [
          [
            {
              type: "text",
              text: "LimiFileのご利用にあたり、以下を行わないでください。",
            },
          ],
        ],
        listItems: [
          "適用法令への違反",
          "第三者の権利の侵害",
          "LimiFileまたはその配信基盤への妨害",
          "不正アクセスの試み",
          "LimiFileの脆弱性を悪用する行為",
          "過度な自動化されたアクセス",
          "マルウェアの配布",
          "LimiFileを誤認させる形での再配布",
        ],
      },
      {
        heading: "4. 機能上の制約",
        paragraphs: [
          [
            {
              type: "text",
              text: "指定した容量へ必ず到達することは保証しません。画質・色・透明度・寸法・メタデータが意図通りになることも保証しません。ブラウザ・OS・端末・画像データによっては、処理が失敗する場合があります。アニメーションWebP・APNG等、一部の形式は対応対象外です。メタデータ削除機能には、対応対象・実装範囲に制約があります。HEIC変換機能は、専用の完全な個人情報除去機能ではありません。",
            },
          ],
        ],
      },
      {
        heading: "5. 保証の否認",
        paragraphs: [
          [
            {
              type: "text",
              text: "LimiFileは現状有姿で提供されます。正確性・完全性・継続性・特定目的への適合性を保証しません。適用法令上排除できない保証まで排除する意図はありません。",
            },
          ],
        ],
      },
      {
        heading: "6. 責任の制限",
        paragraphs: [
          [
            {
              type: "text",
              text: "重要な画像のバックアップと結果の確認は、利用者ご自身で行ってください。適用法令で認められる範囲で、LimiFileの利用または利用不能に関連する損害についての責任を制限します。故意・重過失、その他法令上制限できない責任まで排除する意図はありません。",
            },
          ],
        ],
      },
      {
        heading: "7. サービスの変更・停止",
        paragraphs: [
          [
            {
              type: "text",
              text: "機能を変更または停止する場合があります。継続的な提供を保証するものではありません。",
            },
          ],
        ],
      },
      {
        heading: "8. 知的財産・オープンソース",
        paragraphs: [
          [
            {
              type: "text",
              text: "LimiFile自身のソースコードはApache License 2.0で公開しています。ただしLimiFileの名称・ロゴ・ブランド資産はこのコードライセンスの対象外であり、明示的に許諾された場合を除き権利は放棄されません。LimiFileに含まれるオープンソースcomponentには、それぞれ個別のライセンスが適用されます。詳細は",
            },
            { type: "pageLink", page: "licenses", label: "オープンソースライセンス一覧" },
            {
              type: "text",
              text: "をご覧ください。repository全体が単一のライセンスで提供されているわけではありません。",
            },
          ],
        ],
      },
      {
        heading: "9. 本規約の変更",
        paragraphs: [
          [
            {
              type: "text",
              text: "必要に応じて本規約を更新する場合があります。更新日は本ページに表示します。",
            },
          ],
        ],
      },
      {
        heading: "10. お問い合わせ",
        paragraphs: [
          [
            { type: "text", text: "本規約に関するご質問は、" },
            { type: "externalLink", href: CONTACT_MAILTO, label: CONTACT_EMAIL },
            { type: "text", text: " までご連絡ください。" },
          ],
        ],
      },
    ],
  },
  contact: {
    title: "お問い合わせ",
    description: "不具合・表示・アクセシビリティ・ライセンス・プライバシーに関するご連絡方法です。",
    heading: "お問い合わせ",
    effectiveDateLabel: CONTACT_EFFECTIVE_DATE_LABEL,
    sections: [
      {
        heading: "お問い合わせ方法",
        paragraphs: [
          [
            { type: "text", text: "お問い合わせ先メール: " },
            { type: "externalLink", href: CONTACT_MAILTO, label: CONTACT_EMAIL },
          ],
          [
            {
              type: "text",
              text: "サービスの不具合・表示・アクセシビリティ・ライセンス・プライバシーに関するご連絡を受け付けています。",
            },
          ],
        ],
      },
      {
        heading: "不具合報告時に含めると役立つ情報",
        paragraphs: [],
        listItems: [
          "使用していたページのURL",
          "ブラウザ名・バージョン",
          "OS・端末",
          "操作手順",
          "表示されたエラー文",
          "関係する画像形式",
        ],
      },
      {
        heading: "添付についてのお願い",
        paragraphs: [
          [
            {
              type: "text",
              text: "個人情報や機密情報を含む画像そのものは添付しないでください。再現のために画像が必要な場合は、権利上問題のない合成画像、または公開可能なサンプル画像をご利用ください。",
            },
          ],
        ],
      },
      {
        heading: "ご留意事項",
        paragraphs: [],
        listItems: [
          "返信をお約束するものではありません。",
          "緊急のお問い合わせ窓口ではありません。",
          "法律相談・医療相談、または捜査機関等への正式な通報窓口の代わりにはなりません。",
        ],
      },
    ],
  },
};

import type { LocalizedPageContent } from "../page-content-types";

const FEATURES_HEADING = "このツールでできること";
const HOW_TO_HEADING = "使い方";
const LIMITATIONS_HEADING = "重要な制約";
const PRIVACY_HEADING = "プライバシー";
const SPECS_HEADING = "仕様";
const FAQ_HEADING = "よくある質問";
const RELATED_HEADING = "関連ツール";
const POPULAR_SIZES_HEADING = "人気の容量";

/**
 * 日本語のページ固有コンテンツ。src/i18n/page-content/en.tsと同じ事実・制約・注意書きを、
 * 弱めたり強めたりせずに自然な日本語で表現する(PR A3: search-readiness content)。
 * 各段落・箇条書きはsrc/components/**・test/**から確認した実装事実のみを根拠にしている。
 *
 * 固定容量20/50/100/200KBページ(EnOnlyToolPageKey)は日本語版を
 * 作らない方針のため、この型はLocalizedPageContent(PageContentから英語専用ページのtools keyを
 * 除いたsubset)を使う。既存6ページのpopularSizesLinksは、日本語版が存在しない固定容量ページへは
 * リンクしようがないため全て空配列にする(popularSizesHeadingは型を満たすためだけの値で、
 * リンクが空の間は画面に表示されない)。
 */
export const ja: LocalizedPageContent = {
  home: {
    cardsAriaLabel: "利用できるツール",
    intro: [
      {
        type: "text",
        text: "LimiFileは、画像の変換・圧縮・お手入れをブラウザ内だけで行う8つのツールです。画像をサーバーへアップロードすることはありません。",
      },
    ],
    popularSizesHeading: POPULAR_SIZES_HEADING,
    popularSizesLinks: [],
    purposeHeading: "目的から選ぶ",
    purposeGroups: [
      {
        title: "形式を変えたい",
        links: [
          { page: "heic-to-jpg", label: "HEIC→JPG" },
          { page: "png-to-webp", label: "PNG→WebP" },
          { page: "png-to-jpg", label: "PNG→JPG" },
          { page: "webp-to-jpg", label: "WebP→JPG" },
        ],
      },
      {
        title: "容量を小さくしたい",
        links: [
          { page: "compress-image", label: "容量指定圧縮" },
          { page: "compress-image-to-500kb", label: "500KB圧縮" },
          { page: "compress-png", label: "PNG容量圧縮" },
        ],
      },
      {
        title: "情報を削除したい",
        links: [{ page: "remove-exif", label: "メタデータ削除" }],
      },
    ],
    analyzePrompt: "形式・容量を確認する",
    analyzeLinkLabel: "画像を解析",
    limitationsHeading: "知っておきたい制約",
    limitations: [
      "容量指定圧縮・500KB圧縮のページでは、指定容量への到達を保証していません。",
      "圧縮・変換によって画質・寸法・透明度が変化する場合があります。",
      "メタデータ削除は、必要な場合に限り向き情報と色プロファイルを残すため、あらゆる識別情報の削除を保証するものではありません。",
      "元の画像は別途保存しておき、処理結果を必ず確認してください。",
    ],
    analyzeHeading: "画像を選んで解析する",
    analyzeParagraph:
      "上のツールを使う前に、画像を選択して形式・容量・寸法だけを確認することもできます。解析だけであれば変換・圧縮・削除は行われません。",
    faqHeading: FAQ_HEADING,
    faq: [
      {
        question: "アカウント登録やインストールは必要ですか?",
        answer:
          "不要です。すべてのツールはブラウザ内で直接動作し、インストールやアカウント登録は必要ありません。",
      },
      {
        question: "画像はどこかにアップロードされますか?",
        answer:
          "されません。LimiFileのツールはバックグラウンドのWorkerを使って端末内で画像を処理し、画像データをサーバーへ送信することはありません。",
      },
      {
        question: "メールやメッセージ用に写真を小さくしたい場合、どのツールを使えばよいですか?",
        answer:
          "上限が決まっている場合は容量指定圧縮を、手早く済ませたい場合は500KB圧縮を使ってください。",
      },
      {
        question: "スマートフォンのブラウザでも使えますか?",
        answer:
          "モダンなデスクトップ・モバイルブラウザで動作するよう作られていますが、一部のツールはWorker・WebAssembly・OffscreenCanvasへの対応が必要で、対応していない場合はその旨が表示されます。",
      },
      {
        question: "複数の画像をまとめて処理できますか?",
        answer:
          "複数ファイルを選択できますが、各ツールは同時にではなく、開始した順に1件ずつ処理します。",
      },
    ],
  },
  tools: {
    "heic-to-jpg": {
      intro: [
        {
          type: "text",
          text: "iPhoneで撮影したHEIC/HEIF写真を、ブラウザから出ることなくJPGに変換します。変換はバックグラウンドのWorker内で行われるため、処理中も画面が固まりません。",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "拡張子ではなく実際のファイル構造からHEIC/HEIFを判定します。",
        "共有や互換性に適した固定の品質でJPGへ変換します。",
        "複数ファイルを一度に扱え、ファイルごとにサムネイルとダウンロードボタンが表示されます。",
        "変換はDedicated Worker内でWebAssemblyを使って行われ、アップロードは発生しません。",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "HEIC/HEIFファイルを1件以上選択、またはドラッグ&ドロップします。",
        "各ファイルの変換が完了するのを待ちます(1件ずつ順番に処理されます)。",
        "変換後のJPGをプレビューし、個別またはまとめてダウンロードします。",
        "別の画像からやり直したい場合は、一覧からファイルを削除します。",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "実際にHEIC/HEIFと判定されたファイルのみが対象で、構造が似ているAVIF等は対象外として拒否されます。",
        "出力の品質は固定で、このページから調整することはできません。",
        "JPGへの再エンコードにより、元のEXIF情報(向き・位置情報を含む)は結果として失われます。このページはそれらを保持・復元するものではありません。",
        "50MBを超えるファイルや、極端に大きい画素数の画像は安全のため拒否されます。",
        "ブラウザがWorker・WebAssembly・OffscreenCanvasのいずれかに対応していない場合、このツールは動作しません。",
      ],
      technicalNote: [
        [
          {
            type: "text",
            text: "この機能は、GNU Lesser General Public License version 3(LGPL v3)で提供されるlibheif 1.19.7・libde265 1.0.15を含むWebAssemblyを使用しています。ライセンスの詳細、対応ソース、再ビルド・再リンク手順は",
          },
          {
            type: "pageLink",
            page: "licenses",
            anchor: "heic-heading",
            label: "オープンソースライセンス一覧",
          },
          { type: "text", text: "、および" },
          {
            type: "externalLink",
            href: "/source/filefit-heic-decoder-1.0.0-source.tar.gz",
            label: "対応ソースpackage",
          },
          {
            type: "text",
            text: "でご確認いただけます。このpackageはLimiFileの技術・ライセンス自己レビューに基づいて提供しており、法的助言または法的十分性の保証ではありません。",
          },
        ],
      ],
      specsHeading: SPECS_HEADING,
      specs: [
        { label: "入力", value: "HEIC・HEIF(拡張子ではなくファイル構造から判定)" },
        { label: "出力", value: "共有向けの固定品質のJPG" },
        { label: "同時処理", value: "複数可(1件ごとにサムネイルとダウンロード)" },
        { label: "処理場所", value: "この端末上のDedicated Worker(WebAssembly)" },
        { label: "サーバー送信", value: "行いません" },
        { label: "デコーダ", value: "libheif 1.19.7 / libde265 1.0.15" },
      ],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "HEICのデコードとJPGへのエンコードは、いずれもブラウザ内のDedicated Worker内で行われます。写真がLimiFileのサーバーや第三者へ送信されることはありません。",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "iPhoneの写真が一部のアプリやサイトで開けないのはなぜですか?",
          answer:
            "多くの非Apple製アプリや古いソフトウェアはHEIC/HEIFに対応していません。JPGへ変換することでほぼどこでも開けるようになります。",
        },
        {
          question: "変換後のJPGに位置情報やカメラ情報は残りますか?",
          answer:
            "残りません。JPGへの変換は画像を再エンコードするため、結果として元のEXIF情報(位置情報を含む)は失われます。ただしこのページは専用のメタデータ削除機能ではありません。",
        },
        {
          question: "複数のHEIC写真を同時に変換できますか?",
          answer:
            "複数ファイルをまとめて選択できますが、変換はバックグラウンドで1件ずつ順番に行われます。",
        },
        {
          question: "一部のファイルだけ変換に失敗するのはなぜですか?",
          answer:
            "実際にはHEIC/HEIFでない、サイズ上限を超えている、画素数が大きすぎる等が考えられます。他のファイルの変換には影響しません。",
        },
        {
          question: "このツールはサードパーティ製のコードを使っていますか?",
          answer:
            "はい。HEICのデコードには、LGPL v3ライセンスのlibheif・libde265をWebAssemblyへビルドしたものを使用しています。詳細はオープンソースライセンス一覧と対応ソースpackageをご覧ください。",
        },
        {
          question: "変換中に写真がサーバーへ送信されることはありますか?",
          answer:
            "ありません。変換はブラウザ内のDedicated Worker内で行われ、画像がどこかへ送信されることはありません。",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image", label: "画像を圧縮する" },
        { page: "compress-image-to-500kb", label: "500KB以下に圧縮" },
        { page: "remove-exif", label: "メタデータを削除" },
        { page: "png-to-jpg", label: "PNGをJPGに変換" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "compress-image": {
      intro: [
        {
          type: "text",
          text: "JPEG・HEIC・WebP画像を、指定したKB・MB単位の目標容量へ向けて、ブラウザから出ることなく圧縮します。",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "JPEG・静止WebPはそのまま、HEIC/HEIFはまずJPEGへ変換してから圧縮します。",
        "目標容量は10KBから50MBまでの範囲で、KB・MB単位で自由に指定できます。",
        "まず品質を調整し、それだけで目標に届かない場合のみ画像の寸法を縮小します。",
        "出力形式は入力に対応します(JPEG・HEIC由来はJPEG、WebPはWebP)。",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "JPEG・HEIC/HEIF・WebP画像を選択します。",
        "目標容量をKB・MBで入力するか、プリセットから選びます。",
        "圧縮を実行し、結果を待ちます。",
        "ダウンロード前に、出力容量とプレビューを元画像と比較します。",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "指定容量への到達は保証されません。到達できない場合は、そのまま大きいファイルを返すのではなく「未達」として明示されます。",
        "PNGはこのページでは対象外です。PNG指定容量圧縮をご利用ください。",
        "アニメーションWebPは対象外で、圧縮前に拒否されます。",
        "目標容量が元のファイルサイズより大きい場合、元のファイルがそのまま返されます。",
        "圧縮により画質が変化し、場合によっては画像の寸法も変化します。",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "圧縮はブラウザ内のDedicated Worker内で、Canvas・OffscreenCanvasを使って行われます。画像がサーバーへアップロードされることはありません。",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "目標容量に届かない場合はどうなりますか?",
          answer:
            "そのまま容量オーバーのファイルを返すのではなく「目標に届かなかった」と明示されるため、利用するか・目標を下げるか・別のツールを試すかを判断できます。",
        },
        {
          question: "このページでPNGを圧縮できますか?",
          answer: "できません。PNGのまま圧縮したい場合はPNG指定容量圧縮をご利用ください。",
        },
        {
          question: "圧縮すると写真の見た目は変わりますか?",
          answer:
            "変わる場合があります。まず品質を調整し、それだけで目標容量に届かない場合のみ寸法を縮小します。",
        },
        {
          question: "このページと500KB圧縮ページの違いは何ですか?",
          answer:
            "このページは目標容量を自由に指定できます。500KB圧縮ページは固定の500KBをワンタップで適用し、PNGにも対応しています。",
        },
        {
          question: "アニメーションWebPには対応していますか?",
          answer: "対応していません。圧縮を始める前に検出して拒否されます。",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image-to-500kb", label: "500KB以下に圧縮" },
        { page: "compress-png", label: "PNG指定容量圧縮" },
        { page: "remove-exif", label: "メタデータを削除" },
        { page: "webp-to-jpg", label: "WebPをJPGに変換" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "compress-image-to-500kb": {
      intro: [
        {
          type: "text",
          text: "JPEG・HEIC・WebP・PNG画像を、固定の500KB目標へ向けてワンタップで圧縮します。目標容量の設定は不要です。",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "JPEG・HEIC/HEIF(先にJPEGへ変換)・WebP・PNGを1つのページでまとめて扱えます。",
        "すべてのファイルに対して、正確に500KB(500,000 bytes)の固定目標を使用します。設定項目はありません。",
        "元の形式を維持します(JPEG・HEICはJPEGのまま、WebPはWebPのまま、PNGはPNGのまま)。",
        "形式が混在していても、結果を安定させるため1件ずつ順番に処理します。",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "JPEG・HEIC/HEIF・WebP・PNG画像を1件以上選択します。",
        "各ファイルで圧縮を実行します(500KBの目標は自動的に適用されます)。",
        "出力容量とプレビューを確認します。",
        "結果をダウンロードします。目標に届かなかった場合は別のツールも検討してください。",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "500KBとは正確に500,000 bytesを指し、512 KiBではありません。また、すべての画像で到達を保証するものではありません。",
        "PNGの圧縮は色数削減によるため、半透明やグラデーション部分の見た目が変わる場合があります。",
        "アニメーションWebP・アニメーションPNG(APNG)はどちらも対象外です。",
        "元のファイルがすでに500KB未満の場合は、再エンコードせずそのまま返されます。",
        "このページでは目標容量を変更できません。別の容量にしたい場合は容量指定圧縮またはPNG指定容量圧縮をご利用ください。",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "どの形式もブラウザ内のDedicated Worker内で圧縮され、サーバーへアップロードされることはありません。",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "なぜ目標が500KB固定なのですか?",
          answer:
            "設定不要ですぐに使えるようにするためです。別の容量が必要な場合は、自由に指定できる容量指定圧縮やPNG指定容量圧縮をご利用ください。",
        },
        {
          question: "PNGを圧縮すると自動的にWebPに変換されますか?",
          answer:
            "されません。このページではPNGのまま圧縮され、自動的に別形式へ変換されることはありません。",
        },
        {
          question: "元の画像がすでに500KB未満だとどうなりますか?",
          answer: "再エンコードされず、そのままの状態で返されます。",
        },
        {
          question: "JPEGとPNGを同じバッチで一緒に処理できますか?",
          answer: "できます。各ファイルはその形式に対応するエンジンで、1件ずつ順番に圧縮されます。",
        },
        {
          question: "500KBへの到達は保証されますか?",
          answer:
            "保証されません。特にすでに圧縮済みの画像や情報量の多い画像では、目標に届かないことがあります。",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image", label: "容量指定圧縮" },
        { page: "compress-png", label: "PNG指定容量圧縮" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "remove-exif": {
      intro: [
        {
          type: "text",
          text: "JPEG・HEIC画像から、位置情報・カメラ情報・撮影日時などのメタデータを、画像を再エンコードせずに削除します。",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "JPEGはそのまま、HEIC/HEIFはまずJPEGへ変換してから対象になります。",
        "画像を再エンコードするのではなく、JPEGのメタデータ部分だけをバイト単位で編集するため、画素データは変更されません。",
        "EXIF(位置情報を含む)・XMP・埋め込みサムネイル・Photoshop/IPTC情報・コメント部分を削除します。",
        "必要な場合に限り、写真が回転して見えないよう最小限の向き情報を残し、色を正しく保つためICCカラープロファイルも残します。",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "JPEGまたはHEIC/HEIF写真を1件以上選択します。",
        "各ファイルでメタデータ削除を実行します。",
        "結果パネルで、向き情報・カラープロファイルが保持されたかを確認します。",
        "処理済みファイルをダウンロードします。",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "対象はJPEGとHEIC/HEIFのみで、PNG・WebPはこのページでは対応していません。",
        "このツールは必要な場合に限り1つの向き情報とICCカラープロファイルを意図的に残すため、文字通りすべてを削除するわけではありません。",
        "ファイル名や画像そのものの内容はメタデータではなく、このツールの対象外です。",
        "考えられるすべての識別情報が削除されることを保証するものではありません。",
        "画素データを再エンコードしないため、画像の寸法は変化しません。",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "メタデータ削除は、Canvasによる再エンコードではなく直接のバイト編集として、ブラウザ内のDedicated Worker内で行われます。画像がサーバーへアップロードされることはありません。",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "位置情報(GPS)は削除されますか?",
          answer: "はい。GPSを含むEXIF情報は既定で削除されます。",
        },
        {
          question: "処理後に写真が変な向きで表示されませんか?",
          answer:
            "されません。元の画像に既定と異なる向き情報があった場合は、正しい向きで表示されるよう最小限の向き情報が残されます。",
        },
        {
          question: "これは完全な匿名化と言えますか?",
          answer:
            "いいえ。位置情報・カメラ情報・撮影日時などの識別情報は削除されますが、画像そのものの内容には触れておらず、識別情報が一切残らないことを保証するものではありません。",
        },
        {
          question: "なぜ結果にカラープロファイルが残っているのですか?",
          answer:
            "ICCカラープロファイルは、利用者を特定する情報ではなく色の表示に関わる情報のため、意図的に残しています。",
        },
        {
          question: "PNGにも使えますか?",
          answer: "使えません。このページはJPEGとHEIC/HEIFのみに対応しています。",
        },
        {
          question: "メタデータを削除すると画質は変わりますか?",
          answer:
            "変わりません。このツールは画像を再エンコードしないため、画素データも寸法もそのまま維持されます。",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "heic-to-jpg", label: "HEICをJPGに変換" },
        { page: "compress-image", label: "画像を圧縮する" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "png-to-webp": {
      intro: [
        {
          type: "text",
          text: "PNG画像を、透過を維持したまま、高画質・標準・軽量の3段階から選んでブラウザ内でWebPへ変換します。",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "実際のファイル構造からPNGのみを判定して受け付けます。",
        "高画質・標準・軽量のいずれかを選んでWebPへ変換します(目標容量を探索する処理ではありません)。",
        "画像の寸法は維持され、このツールが寸法を変更することはありません。",
        "透過を維持したまま変換されるよう作られています。",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "PNG画像を1件以上選択します。",
        "高画質・標準・軽量のいずれかの品質を選びます。",
        "変換を実行し、出力容量を元のファイルと比較します。",
        "WebPファイルをダウンロードします。",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "対象はPNGのみで、JPEG・HEIC・WebPはこのページの入力として対応していません。",
        "アニメーションPNG(APNG)は検出され拒否されます。このツールは静止画像専用です。",
        "固定品質での変換であり、目標容量を探索する処理ではありません。特定の出力サイズが必要な場合、このページでは直接指定できません。",
        "すべての画像でファイルサイズが必ず小さくなるとは限りません。",
        "このツールが画像の寸法を変更することはありません。",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "変換はブラウザ内のDedicated Worker内でCanvasを使って行われます。画像がサーバーへアップロードされることはありません。",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "PNGの透過は変換後も維持されますか?",
          answer: "はい。WebPへの出力まで透過が維持されるよう作られています。",
        },
        {
          question: "アニメーションPNGも変換できますか?",
          answer: "できません。アニメーションPNG(APNG)は変換前に検出され拒否されます。",
        },
        {
          question: "どの品質を選べばよいですか?",
          answer:
            "標準が既定でバランスの良い設定です。保存用途には高画質を、ファイルサイズを優先する場合は軽量を選んでください。",
        },
        {
          question: "必ずファイルサイズが小さくなりますか?",
          answer:
            "多くのPNGはWebPへ変換すると小さくなりますが、すべての画像で保証されるわけではありません。",
        },
        {
          question: "品質プリセットではなく特定の出力サイズを指定できますか?",
          answer: "このページではできません。固定品質での変換で、目標容量の探索は行っていません。",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-png", label: "PNG指定容量圧縮" },
        { page: "compress-image", label: "画像を圧縮する" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "compress-png": {
      intro: [
        {
          type: "text",
          text: "PNGのまま、指定したKB・MB単位の目標容量へ向けて画像を圧縮します。",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "対象はPNGのみで、出力も常にPNGのままです(自動でWebPへ変換されることはありません)。",
        "色数を段階的に減らして容量を縮小し、それだけで足りない場合のみ寸法を縮小します。",
        "完全に透明な画素を含め、透過に対応しています。",
        "目標容量は容量指定圧縮ページと同じ範囲で、KB・MB単位で自由に指定できます。",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "PNG画像を1件以上選択します。",
        "目標容量をKB・MBで入力するか、プリセットから選びます。",
        "圧縮を実行し、目標に届いたかを確認します。",
        "届かなかった場合も、その時点での最良の候補をダウンロードするか、目標を下げて再試行できます。",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "指定容量への到達は保証されません。届く候補が無い場合は、その時点での最良の候補が提示されます。",
        "アニメーションPNG(APNG)には対応していません。",
        "色数削減により、完全に透明・完全に不透明な部分は安定して扱われる一方、半透明部分やグラデーションの見た目は変わる場合があります。",
        "1枚あたりの処理には、タイムアウトまで最大で約18秒かかることがあります。",
        "PNGのままではなくWebPへ変換したい場合は、PNG→WebP変換をご利用ください。",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "圧縮はブラウザ内のDedicated Worker内で行われます。PNG画像が外部へアップロードされることはありません。",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "圧縮後、グラデーション部分の見た目が変わるのはなぜですか?",
          answer:
            "このツールは色数を減らして容量を縮小するため、完全に透明・不透明な部分は安定している一方、半透明やグラデーション部分の見た目に影響することがあります。",
        },
        {
          question: "目標容量に届かない場合はどうなりますか?",
          answer: "その時点で得られた最良の候補が、目標未達であることを明示した上で提供されます。",
        },
        {
          question: "PNGが自動的にWebPへ変換されることはありますか?",
          answer:
            "ありません。このページでは常にPNGのまま出力されます。WebPにしたい場合はPNG→WebP変換をご利用ください。",
        },
        {
          question: "処理に時間制限はありますか?",
          answer: "あります。1枚あたりタイムアウトまで最大で約18秒かかる場合があります。",
        },
        {
          question: "アニメーションPNGにも使えますか?",
          answer: "使えません。アニメーションPNG(APNG)は圧縮前に拒否されます。",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "png-to-webp", label: "PNGをWebPに変換" },
        { page: "compress-image", label: "画像を圧縮する" },
        { page: "png-to-jpg", label: "PNGをJPGに変換" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "png-to-jpg": {
      intro: [
        {
          type: "text",
          text: "PNG画像を、高画質・標準・軽量の3段階からブラウザ内でJPG（JPEG）へ変換します。JPGは透明を保持できないため、変換前に選んだ背景色(既定は白)で透明部分を塗りつぶします。",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "実際のファイル構造からPNGのみを判定して受け付けます。",
        "高画質・標準・軽量のいずれかを選んでJPGへ変換します(目標容量を探索する処理ではありません)。",
        "JPGにはアルファチャンネルが無いため、透明部分は選んだ背景色(既定は白)で塗りつぶします。",
        "画像の寸法は維持され、このツールが寸法を変更することはありません。",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "PNG画像を1件以上選択します。",
        "高画質・標準・軽量のいずれかの品質を選びます。",
        "透明部分の背景色を選ぶか、既定の白のままにします。",
        "変換を実行し、JPGファイルをダウンロードします。",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "対象はPNGのみで、JPEG・HEIC・WebPはこのページの入力として対応していません。",
        "アニメーションPNG(APNG)は検出され拒否されます。このツールは静止画像専用です。",
        "JPGには透明が無いため、透明・半透明の画素は選んだ背景色へ統合され、変換後に元へ戻すことはできません。",
        "固定品質での変換であり、目標容量を探索する処理ではありません。特定の出力サイズが必要な場合、このページでは直接指定できません。",
        "このツールが画像の寸法を変更することはありません。",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "変換はブラウザ内のDedicated Worker内でCanvasを使って行われます。画像がサーバーへアップロードされることはありません。",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "PNGの透明部分はどうなりますか?",
          answer:
            "JPGは透明を保存できないため、透明・半透明の画素は変換前に選んだ背景色(既定は白)で塗りつぶされます。",
        },
        {
          question: "背景色は変更できますか?",
          answer:
            "できます。変換パネルのカラーピッカーで変換前に選べます。変更しない場合は白が使われます。",
        },
        {
          question: "アニメーションPNGも変換できますか?",
          answer: "できません。アニメーションPNG(APNG)は変換前に検出され拒否されます。",
        },
        {
          question: "どの品質を選べばよいですか?",
          answer:
            "標準が既定でバランスの良い設定です。保存用途には高画質を、ファイルサイズを優先する場合は軽量を選んでください。",
        },
        {
          question: "WebPではなくJPGを選ぶ理由は何ですか?",
          answer:
            "JPGは最も広く対応している画像形式です。透明を保持したい場合は、背景色で塗りつぶされるJPGではなくPNG→WebP変換をご利用ください。",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "png-to-webp", label: "PNGをWebPに変換する" },
        { page: "compress-png", label: "PNGのまま圧縮する" },
        { page: "compress-image", label: "JPGをさらに圧縮する" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "webp-to-jpg": {
      intro: [
        {
          type: "text",
          text: "WebP画像を、高画質・標準・軽量の3段階からブラウザ内でJPG（JPEG）へ変換します。透明部分は選んだ背景色(既定は白)で塗りつぶされ、アニメーションWebPは検出され拒否されます。",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "実際のファイル構造からWebPのみを判定して受け付けます(通常WebP・透明WebPの両方に対応)。",
        "高画質・標準・軽量のいずれかを選んでJPGへ変換します(目標容量を探索する処理ではありません)。",
        "JPGにはアルファチャンネルが無いため、透明部分は選んだ背景色(既定は白)で塗りつぶします。",
        "画像の寸法は維持され、このツールが寸法を変更することはありません。",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "WebP画像を1件以上選択します。",
        "高画質・標準・軽量のいずれかの品質を選びます。",
        "透明部分の背景色を選ぶか、既定の白のままにします。",
        "変換を実行し、JPGファイルをダウンロードします。",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "対象はWebPのみで、JPEG・HEIC・PNGはこのページの入力として対応していません。",
        "アニメーションWebPは変換前に検出され拒否されます。このツールは1枚の静止画像のみを変換し、アニメーションの維持は試みません。",
        "JPGには透明が無いため、透明・半透明の画素は選んだ背景色へ統合され、変換後に元へ戻すことはできません。",
        "固定品質での変換であり、目標容量を探索する処理ではありません。特定の出力サイズが必要な場合、このページでは直接指定できません。",
        "このツールが画像の寸法を変更することはありません。",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "変換はブラウザ内のDedicated Worker内でCanvasを使って行われます。画像がサーバーへアップロードされることはありません。",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "WebPの透明部分は維持されますか?",
          answer:
            "維持されません。JPGは透明を保存できないため、透明・半透明部分は変換前に選んだ背景色(既定は白)で塗りつぶされます。",
        },
        {
          question: "アニメーションWebPも変換できますか?",
          answer:
            "できません。アニメーションWebPは変換前に検出され拒否されます。静止画のWebPのみが変換対象で、アニメーションを維持する処理は行いません。",
        },
        {
          question: "背景色は変更できますか?",
          answer:
            "できます。変換パネルのカラーピッカーで変換前に選べます。変更しない場合は白が使われます。",
        },
        {
          question: "どの品質を選べばよいですか?",
          answer:
            "標準が既定でバランスの良い設定です。保存用途には高画質を、ファイルサイズを優先する場合は軽量を選んでください。",
        },
        {
          question: "WebPをJPGに変換する理由は何ですか?",
          answer: "JPGはWebPに対応していない古いアプリやサービスを含め、幅広い環境で開けます。",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image", label: "JPGをさらに圧縮する" },
        { page: "heic-to-jpg", label: "HEICをJPGに変換する" },
        { page: "png-to-jpg", label: "PNGをJPGに変換する" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
  },
};

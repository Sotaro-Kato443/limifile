import type { CommonDictionary } from "../schema";

/**
 * 日本語の共通UI文言。既存の404ページの文言と完全に一致させている
 * (このPRでは表示上の日本語文言を一切変更しない)。
 */
export const ja: CommonDictionary = {
  nav: {
    home: "トップ",
    ariaLabel: "ツール",
  },
  footer: {
    licenses: "オープンソースライセンス",
    privacy: "プライバシーポリシー",
    terms: "利用規約",
    contact: "お問い合わせ",
  },
  languageSwitcher: {
    label: "言語",
  },
  notFound: {
    heading: "ページが見つかりません",
    metaDescription:
      "指定されたページが見つかりませんでした。URLをご確認のうえ、トップページからお探しください。",
    lede: "URLが変更されたか、入力したアドレスが間違っている可能性があります。",
  },
  backToHome: "トップページへ戻る",
  privacyNotice: "画像はこの端末内で処理され、当サイトのサーバーへ送信されません。",
  ui: {
    common: {
      remove: "削除",
      removeAll: "すべて削除",
      cancel: "キャンセル",
      cancelled: "キャンセルしました",
      mimeUnknown: "MIME不明",
      unknownFormatLabel: "不明",
      formatsLabel: "対応形式: ",
    },
    dropZone: {
      selectOrDrop: "画像を選択、またはここにドラッグ&ドロップ",
      supportedFormats: (formatsHint) => `対応形式: ${formatsHint}(複数選択可)`,
      chooseFile: "ファイルを選ぶ",
    },
    imageList: {
      selectedCount: (count) => `${count}件選択中`,
    },
    listItem: {
      analyzing: "解析中…",
      heicQueued: "JPGへ変換待ち",
      heicConverting: "JPGへ変換中…",
      heicConverted: "HEICを互換性の高いJPGへ変換しました",
      extensionMismatch: (ext, detectedFormatLabel) =>
        `拡張子(.${ext})と検出した形式(${detectedFormatLabel})が一致しません`,
      removeAriaLabel: (fileName) => `${fileName}を削除`,
      originalLabel: "変換前: ",
      convertedLabel: "変換後: ",
    },
    intakeErrors: {
      heicConvertFailed: "この画像を変換できませんでした。別のファイルでお試しください。",
      analyzeFailed: "この画像を解析できませんでした。別のファイルでお試しください。",
      unsupportedFormat: "未対応の形式です(JPG/PNG/WebP/HEIC・HEIF・AVIFのみ解析できます)",
      heicTooLarge: "HEICファイルのサイズが大きすぎるため処理できません(上限50MB)。",
      heicUnsupportedBrowser: "このブラウザではHEIC画像をJPGへ変換できません。",
      avifTooLarge: "AVIFファイルのサイズが大きすぎるため安全に処理できません(上限50MB)。",
      avifUnsupportedAnimation: "アニメーションAVIF(image sequence)には現在対応していません。",
      avifUnsafeDimensions: "このAVIF画像のサイズが大きすぎるため、安全に処理できませんでした。",
      avifDecodeFailed:
        "このAVIFをデコードできませんでした。ブラウザがこのAVIFに対応していないか、ファイルが壊れている可能性があります。",
      rasterTooLarge: "ファイルのサイズが大きすぎるため安全に処理できません(上限50MB)。",
      rasterUnsafeDimensions: "この画像のサイズが大きすぎるため、安全に処理できませんでした。",
      rasterDecodeFailed:
        "この画像をデコードできませんでした。ブラウザがこのファイルに対応していないか、ファイルが壊れている可能性があります。",
    },
    previewAndSave: {
      previewTrigger: (formatLabel) => `${formatLabel}を確認`,
      previewDialogAriaLabel: (fileName) => `${fileName}のプレビュー`,
      closePreviewAriaLabel: "プレビューを閉じる",
      closePreview: "閉じる",
      previewImageAlt: (fileName, width, height) =>
        `${fileName}の変換後プレビュー(${width}×${height}px)`,
      shareFailedFallback: "共有に失敗しました",
      touchShareCaption: (formatLabel) =>
        `iPhone・iPadでは「${formatLabel}を保存」から保存先を選択できます。`,
      nonTouchShareCaption: "保存先はブラウザのダウンロード設定に従います。",
      download: (formatLabel) => `${formatLabel}をダウンロード`,
      secondaryDownload: "通常のダウンロード",
      save: (formatLabel) => `${formatLabel}を保存`,
      share: "共有",
    },
    compressionPanel: {
      phaseLabel: {
        preparing: "圧縮準備中",
        quality: "画質を調整中",
        resize: "画像サイズを調整中",
        finalizing: "最終確認中",
      },
      attemptSuffix: (attempt, maxAttempts) => ` (試行 ${attempt} / 最大${maxAttempts})`,
      compress: "圧縮する",
      queued: "圧縮待ち…",
      alreadyUnderTarget: "すでに目標容量以下です",
      completed: "圧縮が完了しました",
      stats: {
        original: "元容量: ",
        compressed: "圧縮後容量: ",
        target: "目標容量: ",
        originalDimensions: "元寸法: ",
        compressedDimensions: "圧縮後寸法: ",
        reduction: "削減率: ",
        outputFormat: "出力形式: ",
        encodeCount: "エンコード回数: ",
        resizeCount: "リサイズ回数: ",
        elapsed: "処理時間: ",
        secondsSuffix: "秒",
      },
      errors: {
        "target-unreachable":
          "この画像は現在の最低画質・最小寸法では指定容量以下にできませんでした",
        "encode-failed": "画像処理を開始できませんでした。もう一度お試しください。",
        "decode-failed": "画像を読み込めませんでした。別のファイルでお試しください。",
        "unsafe-dimensions": "画像のサイズが大きすぎるため、安全に処理できませんでした。",
        "unsupported-webp-encoder": "このブラウザではWebP画像を圧縮できません。",
        "unsupported-animation": "アニメーションWebPには現在対応していません。",
      },
      targetInput: {
        label: "目標容量",
        unitAriaLabel: "容量の単位",
        unitNote: "1KB=1,000バイトとして計算しています",
        errors: {
          empty: "目標容量を入力してください",
          "invalid-number": "数値を入力してください",
          "not-positive": "0より大きい値を入力してください",
          "too-small": "10KB以上を指定してください",
          "too-large": "50MB以下を指定してください",
        },
      },
    },
    compressionWorkbench: {
      formatMismatch: "指定容量圧縮は現在JPEG・HEIC・WebPに対応しています",
      unsupportedAnimation: "アニメーションWebPには現在対応していません。",
      unsafeDimensions: "画像のサイズが大きすぎるため、安全に処理できませんでした。",
      heicSourceNote: "HEICはJPGに変換したうえで圧縮します",
      webpSourceNote: "WebPは透過を維持したまま、WebP形式で圧縮します。",
      unsupportedBrowser: "このブラウザは画像圧縮に必要な機能へ対応していません",
      formatNote:
        "WebPは透過を維持したまま、WebP形式で圧縮します。アニメーションWebPには対応していません。",
    },
    fixedTargetWorkbench: {
      formatMismatch: (targetLabel) => `この形式は${targetLabel}圧縮の対象外です`,
      unsupportedBrowserJpegWebp: "このブラウザでは画像圧縮機能を利用できません",
      unsupportedBrowserPng: "このブラウザではPNG圧縮機能を利用できません",
      pngNote: (targetLabel) =>
        `PNGは色数を調整し、必要な場合のみ画像寸法を縮小して${targetLabel}以下を目指します。透過に対応していますが、 半透明やグラデーションの見た目が変わる場合があります。`,
      formatNote:
        "WebPは透過を維持したまま、WebP形式で圧縮します。アニメーションWebPには対応していません。 PNGはPNGのまま圧縮し、自動でWebPへ変換することはありません。アニメーションPNG(APNG)には対応していません。",
    },
    pngCompression: {
      formatMismatch: "PNG指定容量圧縮は現在PNGのみに対応しています",
      unsupportedBrowser: "このブラウザはPNG圧縮に必要な機能へ対応していません",
      workbenchNote:
        "PNG画像をPNGのまま、指定した容量以下を目指してこの端末内で圧縮します。透過に対応しています。 アニメーションPNG(APNG)には対応していません。",
      panel: {
        queued: "圧縮待ち…",
        processing: "圧縮中…(画像1枚あたり最大約18秒かかる場合があります)",
        needsReprocess: "目標容量を変更しました。もう一度「圧縮する」を押してください",
        errors: {
          "animated-png": "アニメーションPNG(APNG)は現在対応していません。",
          "invalid-png": "このファイルを有効なPNG画像として読み込めませんでした。",
          "invalid-target": "指定容量を確認してください。",
          "unsafe-dimensions": "画像の縦横サイズまたは総ピクセル数が処理上限を超えています。",
          "unsupported-browser": "このブラウザではPNG圧縮機能を利用できません。",
          "unsupported-png-encoder": "PNGの生成結果を安全に確認できませんでした。",
          timeout: "処理が時間上限を超えました。より小さい画像でお試しください。",
          "too-large": "ファイルのサイズが大きすぎるため処理できません(上限50MB)。",
          error: "画像処理を開始できませんでした。もう一度お試しください。",
        },
      },
      result: {
        alreadyUnderTarget: "すでに指定容量以下です",
        reuseOriginal: "再圧縮せず元のPNGを使用できます。",
        originalLabel: "元容量: ",
        outputSameAsOriginalSuffix: "(元ファイルと同じ)",
        dimensionsLabel: "寸法: ",
        completed: "指定容量以下に圧縮できました",
        originalFileNameLabel: "元ファイル名: ",
        outputBytesLabel: "出力容量: ",
        reductionLabel: "削減率: ",
        originalDimensionsLabel: "元寸法: ",
        outputDimensionsLabel: "出力寸法: ",
        resizedNote: (ow, oh, nw, nh) =>
          `(目標容量に収めるため、${ow}×${oh} → ${nw}×${nh}へ自動的に寸法を縮小しました)`,
        details: "詳細情報",
        colorCount: (colorCount) =>
          `使用した色数: ${colorCount}色(元画像の色数を減らして容量を抑えています)`,
        encodeAttemptsLabel: "エンコード試行回数: ",
        unreachable: "指定容量には到達できませんでした",
        targetLabel: "目標容量: ",
        bestCandidateBytesLabel: "最良候補の実容量: ",
        overByTarget: (overBy) => `目標より約${overBy}大きい結果です`,
        overTargetNote: (target) => `この保存結果は目標容量(${target})を超えています。`,
        noCandidateNote: "保存できる候補がありませんでした。",
        webpHintPrefix: "さらに小さくする場合は、",
        webpHintLinkLabel: "WebPへの変換",
        webpHintSuffix: "も試せます。",
      },
    },
    pngToWebp: {
      formatMismatch: "PNG→WebP変換は現在PNGのみに対応しています",
      unsupportedAnimation: "アニメーションPNGには現在対応していません。",
      unsafeDimensions: "画像のサイズが大きすぎるため、安全に処理できませんでした。",
      unsupportedBrowser: "このブラウザはPNG→WebP変換に必要な機能へ対応していません",
      workbenchNote:
        "PNG画像を、透過を維持したままWebP形式へ変換します。アニメーションPNGには対応していません。",
      panel: {
        qualityLegend: "画質",
        qualityLabel: {
          high: "高画質",
          standard: "標準",
          light: "軽量",
        },
        qualityDescription: {
          high: "画質を優先",
          standard: "画質と容量のバランス",
          light: "ファイルサイズを優先",
        },
        convert: "WebPへ変換する",
        reconvert: "この画質で再変換する",
        queued: "変換待ち…",
        converting: "変換中…",
        errors: {
          "unsupported-animation": "アニメーションPNGには現在対応していません。",
          "unsafe-dimensions": "画像のサイズが大きすぎるため、安全に処理できませんでした。",
          "decode-failed": "画像を読み込めませんでした。別のファイルでお試しください。",
          "unsupported-webp-encoder": "このブラウザではWebP画像へ変換できません。",
          timeout: "処理に時間がかかりすぎたため中断しました。別のファイルでお試しください。",
          "encode-failed": "画像処理を開始できませんでした。もう一度お試しください。",
        },
      },
      result: {
        completed: "WebPへ変換しました",
        originalBytesLabel: "変換前容量: ",
        outputBytesLabel: "変換後容量: ",
        reductionLabel: "削減率: ",
        originalDimensionsLabel: "元寸法: ",
        outputDimensionsLabel: "出力寸法: ",
        outputFormatLabel: "出力形式: WebP",
        qualitySettingLabel: "画質設定: ",
        elapsedLabel: "処理時間: ",
        secondsSuffix: "秒",
      },
    },
    rasterToJpg: {
      formatMismatch: (sourceFormatLabel) =>
        `${sourceFormatLabel}→JPG変換は現在${sourceFormatLabel}のみに対応しています`,
      unsupportedAnimation: (sourceFormatLabel) =>
        `アニメーション${sourceFormatLabel}には現在対応していません。`,
      unsafeDimensions: "画像のサイズが大きすぎるため、安全に処理できませんでした。",
      unsupportedBrowser: "このブラウザはJPG変換に必要な機能へ対応していません",
      workbenchNote: (sourceFormatLabel) =>
        `${sourceFormatLabel}画像をJPGへ変換します。JPGは透明を保持できないため、透明部分は下で選んだ背景色(既定は白)で塗りつぶされます。アニメーション${sourceFormatLabel}には対応していません。`,
      backgroundNote:
        "JPGは透明を保持できないため、変換前に透明部分をこの背景色で塗りつぶします。既定は白です。必要に応じて変更してください。",
      panel: {
        qualityLegend: "画質",
        qualityLabel: {
          high: "高画質",
          standard: "標準",
          light: "軽量",
        },
        qualityDescription: {
          high: "画質を優先",
          standard: "画質と容量のバランス",
          light: "ファイルサイズを優先",
        },
        backgroundLabel: "透明部分の背景色",
        backgroundPickerAriaLabel: "透明部分の背景色",
        convert: "JPGへ変換する",
        reconvert: "この設定で再変換する",
        queued: "変換待ち…",
        converting: "変換中…",
        errors: {
          "unsupported-animation": "アニメーション画像には現在対応していません。",
          "unsafe-dimensions": "画像のサイズが大きすぎるため、安全に処理できませんでした。",
          "decode-failed": "画像を読み込めませんでした。別のファイルでお試しください。",
          "unsupported-encoder": "このブラウザではJPG画像へ変換できません。",
          timeout: "処理に時間がかかりすぎたため中断しました。別のファイルでお試しください。",
          "encode-failed": "画像処理を開始できませんでした。もう一度お試しください。",
          "input-too-large": "ファイルのサイズが大きすぎるため、安全に処理できませんでした。",
        },
      },
      result: {
        completed: "JPGへ変換しました",
        originalBytesLabel: "変換前容量: ",
        outputBytesLabel: "変換後容量: ",
        sizeChangeLabel: (direction, percent) =>
          direction === "reduced" ? `${percent}%削減` : `${percent}%増加`,
        originalDimensionsLabel: "元寸法: ",
        outputDimensionsLabel: "出力寸法: ",
        outputFormatLabel: "出力形式: JPG",
        qualitySettingLabel: "画質設定: ",
        backgroundColorLabel: "使用した背景色: ",
        elapsedLabel: "処理時間: ",
        secondsSuffix: "秒",
      },
    },
    metadataRemoval: {
      formatMismatch: "メタデータ削除は現在JPEG・HEICに対応しています",
      unsupportedBrowser: "このブラウザはメタデータ削除に必要な機能へ対応していません",
      heicSourceNote: "HEICはJPGに変換したうえでメタデータを削除します",
      panel: {
        start: "メタデータを削除する",
        retry: "もう一度削除する",
        queued: "削除待ち…",
        removing: "削除中…",
        errors: {
          "invalid-jpeg": "JPEGとして読み取れませんでした。ファイルが壊れている可能性があります。",
          "invalid-segment-length":
            "JPEGの内部構造が不正です。ファイルが壊れている可能性があります。",
          "missing-eoi":
            "JPEGの終端が見つかりませんでした。ファイルが壊れているか、途中で切断されています。",
          "invalid-jfif": "JPEGのJFIF情報が不正です。ファイルが壊れている可能性があります。",
          "malformed-exif": "EXIF情報の構造が不正です。ファイルが壊れている可能性があります。",
          "ambiguous-orientation": "向き情報が複数あり、どれが正しいか判断できませんでした。",
          "limit-exceeded": "このファイルは処理できる上限を超えています。",
        },
      },
      result: {
        completed: "メタデータを削除しました",
        baseNotice:
          "EXIF、XMP、IPTC、コメントなどのメタデータ領域を削除しました。これらの領域には、位置情報・撮影日時・カメラ情報などが含まれる場合があります。",
        orientationNotice: "写真の表示方向を保つため、向き情報のみ残しています。",
        iccNotice: "色味を保つため、カラープロファイルは残しています。",
        originalBytesLabel: "元容量: ",
        outputBytesLabel: "出力容量: ",
        originalDimensionsLabel: "元寸法: ",
        outputDimensionsLabel: "出力寸法: ",
        reencodeLabel: "再エンコード: ",
        reencodeNone: "なし",
        outputFormatLabel: "出力形式: JPG",
        reductionLabel: "削減率: ",
        orientationLabel: "向き情報: ",
        orientationKept: "保持",
        orientationRemoved: "削除",
        colorProfileLabel: "カラープロファイル: ",
        colorProfileKept: "保持",
        colorProfileRemoved: "削除",
        elapsedLabel: "処理時間: ",
        msSuffix: "ms",
      },
    },
    /**
     * /signature-resizer/はEN-onlyページのため、この辞書がJA側の画面に実際に表示されることはない。
     * UiDictionaryをja.tsも満たす必要がある(TypeScriptの型チェック)ため、翻訳のみ用意する。
     */
    signatureResizer: {
      formatMismatch: "Signature Resizerは現在JPEG・PNGに対応しています。",
      unsupportedBrowser: "このブラウザではSignature Resizerに必要な機能が利用できません。",
      workbenchNote:
        "提出先が指定する幅・高さ・最大ファイルサイズを入力すると、LimiFileがダウンロード前に各条件を検証します。",
      form: {
        widthLabel: "幅",
        heightLabel: "高さ",
        pxUnitNote: "px",
        maxSizeLabel: "最大ファイルサイズ",
        maxSizeUnitNote: "KB",
        fitModeLegend: "合わせ方",
        fitModeContainLabel: "縦横比を保つ(推奨)",
        fitModeStretchLabel: "指定サイズに引き伸ばす(歪む場合があります)",
        fitModeContainDescription: "画像全体を指定サイズ内に収め、余った部分は白で埋めます。",
        fitModeStretchDescription:
          "指定サイズいっぱいに合わせます。縦横比が異なる場合、画像が歪むことがあります。",
        errors: {
          empty: "値を入力してください。",
          "invalid-number": "有効な数値を入力してください。",
          "not-positive": "0より大きい数値を入力してください。",
          "too-large": "この値は大きすぎます。",
          "too-small": "この値は小さすぎて整数バイトで表現できません。",
        },
      },
      panel: {
        convert: "変換する",
        reconvert: "この条件で再変換する",
        queued: "変換待ち…",
        processing: "変換中…",
        errors: {
          "unsupported-animation": "アニメーションPNG(APNG)には現在対応していません。",
          "unsafe-dimensions": "この画像のサイズが大きすぎるため、安全に処理できませんでした。",
          "invalid-request": "入力した幅・高さ・最大ファイルサイズをご確認ください。",
          "unsupported-encoder": "生成されたJPEGを安全に検証できませんでした。",
          timeout: "処理に時間がかかりすぎたため中断しました。より小さい画像でお試しください。",
          "encode-failed": "処理を開始できませんでした。もう一度お試しください。",
        },
      },
      result: {
        completed: "すべての条件を満たしました",
        unreachable: "ファイルサイズの条件を満たせませんでした",
        unreachableNote:
          "LimiFileが現在使用しているJPEG品質の範囲では、このファイルサイズに到達できませんでした。以下には現在の最低品質での結果を提示しています。そのまま使える場合もありますが、ファイルサイズの上限を上げるか、寸法を小さくして再度お試しください。",
        upscaledWarning:
          "指定サイズに合わせるため画像を拡大しました。鮮明さが低下する可能性があります。",
        checklistHeading: "条件",
        widthConditionLabel: (actualPx, targetPx) => `幅: ${actualPx}px(目標: ${targetPx}px)`,
        heightConditionLabel: (actualPx, targetPx) => `高さ: ${actualPx}px(目標: ${targetPx}px)`,
        sizeConditionLabel: (actualKbText, maxKbText) =>
          `ファイルサイズ: ${actualKbText}(上限: ${maxKbText})`,
        formatConditionLabel: (actual) => `形式: ${actual}`,
        conditionOkBadge: "達成",
        conditionFailBadge: "未達成",
        outputFormatLabel: "出力形式: JPG",
        qualityLabel: "使用した品質: ",
        elapsedLabel: "処理時間: ",
        secondsSuffix: "秒",
      },
    },
  },
};

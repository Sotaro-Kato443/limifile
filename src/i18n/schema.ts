import type {
  CompressionFailureReason,
  CompressionPhase,
} from "../components/image-intake/compression-types";
import type { TargetSizeError } from "../components/image-intake/compression-target";
import type { RemoveExifErrorCode } from "../components/image-intake/jpeg-metadata";
import type {
  PngToWebpFailureReason,
  PngToWebpQualityPreset,
} from "../components/image-intake/png-to-webp-types";
import type {
  RasterQualityPreset,
  RasterToJpgFailureReason,
} from "../components/image-intake/raster-convert-types";
import type { PngCompressionFailureReason } from "../components/png-compression/png-compression-ui-types";
import type { TargetFitFailureReason } from "../components/image-intake/target-fit-types";

/**
 * ツールページ1件分のlocale依存コンテンツ(見出し・説明・ナビラベル・トップページの
 * ツールカード文言・対応形式の表示テキスト)。locale非依存の情報(key・indexable等)は
 * src/config/tool-page-config.tsにそのまま残す(責務分離、PR A2-1)。
 */
export interface ToolContent {
  /** <h1>に表示する見出し。<title>には使わない(seoTitleを別途持つ、PR A2-3) */
  heading: string;
  /** <meta name="description">に使う説明文。ページ本文には表示しない(本文の導入文はToolPageAboutContent.introが担う) */
  description: string;
  navLabel: string;
  cardTitle: string;
  cardDescription: string;
  formats: string;
  /** <title>専用の文言。h1(heading)と意味は一致させるが、文字列としては完全一致でなくてよい。全14ページ(7key×2locale)で重複しない */
  seoTitle: string;
}

/**
 * 全ロケール共通で必要なUI文言の最小スキーマ。
 *
 * このPR時点では、共通UI文言(ナビ・フッター・言語切替ラベル・404・重要なプライバシー説明)のみを
 * 対象とする。各ツールページの本文・FAQ・エラー文等の大量コンテンツは後続PRで別スキーマとして追加する。
 *
 * en/jaの辞書がこのinterfaceを満たすことをTypeScriptの型チェックで強制する
 * (キーが1つでも欠けるとtypecheckが失敗する)。
 */
export interface CommonDictionary {
  nav: {
    /** 共通ナビゲーションの「トップ」リンクのラベル */
    home: string;
    /** 共通ナビゲーション(<nav>)のaria-label */
    ariaLabel: string;
  };
  footer: {
    /** フッターの「オープンソースライセンス」リンクのラベル */
    licenses: string;
    /** フッターの「プライバシーポリシー」リンクのラベル */
    privacy: string;
    /** フッターの「利用規約」リンクのラベル */
    terms: string;
    /** フッターの「お問い合わせ」リンクのラベル */
    contact: string;
  };
  languageSwitcher: {
    /** 言語切替UIのラベル(言語名そのものではなく「言語」等の見出し) */
    label: string;
  };
  notFound: {
    /** 404ページの見出し・titleタグに使う文言 */
    heading: string;
    /** 404ページのmeta descriptionに使う文言 */
    metaDescription: string;
    /** 404ページ本文に表示する説明文 */
    lede: string;
  };
  /** 「トップページへ戻る」リンクのラベル */
  backToHome: string;
  /** 画像を外部サーバーへ送信しない旨の重要な説明文 */
  privacyNotice: string;
  /** 7つのclient:loadページ・共有UIコンポーネントが参照する文言一式(PR A2-1で追加) */
  ui: UiDictionary;
}

/**
 * 画像処理系Preactアイランド(7ページ共通)が参照するUI文言。
 * Worker/hookが持つreason/status codeとの対応関係が分かるよう、可能な場所は
 * `Record<コード型, string>` で持たせ、コードが1つ増えるとtypecheckが失敗するようにする。
 * テンプレート文言(ファイル名・数値等を埋め込むもの)は関数型のフィールドとして持つ
 * (Astro props経由ではなく、island root内で直接importして使うため関数を含められる)。
 */
export interface UiDictionary {
  common: {
    remove: string;
    removeAll: string;
    cancel: string;
    cancelled: string;
    mimeUnknown: string;
    unknownFormatLabel: string;
    /** トップページのツールカードで使う「対応形式: 」ラベル */
    formatsLabel: string;
  };
  dropZone: {
    selectOrDrop: string;
    supportedFormats: (formatsHint: string) => string;
    /**
     * ドロップゾーン内に置く擬似ボタンの表示テキスト。クリック対象はlabel(=input)であり
     * この要素自体は操作可能ではないため、支援技術には露出させない(aria-hidden)。
     * 破線の枠が押せると気づかれない問題への視覚的な手当てとしてのみ存在する。
     */
    chooseFile: string;
  };
  imageList: {
    selectedCount: (count: number) => string;
  };
  listItem: {
    analyzing: string;
    heicQueued: string;
    heicConverting: string;
    heicConverted: string;
    extensionMismatch: (ext: string, detectedFormatLabel: string) => string;
    removeAriaLabel: (fileName: string) => string;
    originalLabel: string;
    convertedLabel: string;
  };
  intakeErrors: {
    heicConvertFailed: string;
    analyzeFailed: string;
    unsupportedFormat: string;
    heicTooLarge: string;
    heicUnsupportedBrowser: string;
    avifTooLarge: string;
    avifUnsupportedAnimation: string;
    avifUnsafeDimensions: string;
    avifDecodeFailed: string;
    /** useImageIntake({enableRasterPreDecodeSafety: true})を使うツール(Signature Resizer等)専用 */
    rasterTooLarge: string;
    rasterUnsafeDimensions: string;
    rasterDecodeFailed: string;
  };
  previewAndSave: {
    previewTrigger: (formatLabel: string) => string;
    previewDialogAriaLabel: (fileName: string) => string;
    closePreviewAriaLabel: string;
    closePreview: string;
    previewImageAlt: (fileName: string, width: number, height: number) => string;
    shareFailedFallback: string;
    touchShareCaption: (formatLabel: string) => string;
    nonTouchShareCaption: string;
    download: (formatLabel: string) => string;
    secondaryDownload: string;
    save: (formatLabel: string) => string;
    share: string;
  };
  compressionPanel: {
    phaseLabel: Record<CompressionPhase, string>;
    attemptSuffix: (attempt: number, maxAttempts: number) => string;
    compress: string;
    queued: string;
    alreadyUnderTarget: string;
    completed: string;
    stats: {
      original: string;
      compressed: string;
      target: string;
      originalDimensions: string;
      compressedDimensions: string;
      reduction: string;
      outputFormat: string;
      encodeCount: string;
      resizeCount: string;
      elapsed: string;
      secondsSuffix: string;
    };
    errors: Record<CompressionFailureReason, string>;
    targetInput: {
      label: string;
      unitAriaLabel: string;
      unitNote: string;
      errors: Record<TargetSizeError, string>;
    };
  };
  compressionWorkbench: {
    formatMismatch: string;
    unsupportedAnimation: string;
    unsafeDimensions: string;
    heicSourceNote: string;
    webpSourceNote: string;
    unsupportedBrowser: string;
    formatNote: string;
  };
  /**
   * 固定容量ページ(20/50/100/200/500KB)共通のFixedTargetCompressionWorkbenchが参照する文言。
   * formatMismatch・pngNoteは対象容量によって表示が変わるため、対象容量の表示テキスト
   * (例: "500KB")を受け取る関数として持つ(PR: exact-KBページ追加で500KB専用から一般化)。
   */
  fixedTargetWorkbench: {
    formatMismatch: (targetLabel: string) => string;
    unsupportedBrowserJpegWebp: string;
    unsupportedBrowserPng: string;
    pngNote: (targetLabel: string) => string;
    formatNote: string;
  };
  pngCompression: {
    formatMismatch: string;
    unsupportedBrowser: string;
    workbenchNote: string;
    panel: {
      queued: string;
      processing: string;
      needsReprocess: string;
      errors: Record<PngCompressionFailureReason, string>;
    };
    result: {
      alreadyUnderTarget: string;
      reuseOriginal: string;
      originalLabel: string;
      outputSameAsOriginalSuffix: string;
      dimensionsLabel: string;
      completed: string;
      originalFileNameLabel: string;
      outputBytesLabel: string;
      reductionLabel: string;
      originalDimensionsLabel: string;
      outputDimensionsLabel: string;
      resizedNote: (ow: number, oh: number, nw: number, nh: number) => string;
      details: string;
      colorCount: (colorCount: number) => string;
      encodeAttemptsLabel: string;
      unreachable: string;
      targetLabel: string;
      bestCandidateBytesLabel: string;
      overByTarget: (overBy: string) => string;
      overTargetNote: (target: string) => string;
      noCandidateNote: string;
      webpHintPrefix: string;
      webpHintLinkLabel: string;
      webpHintSuffix: string;
    };
  };
  pngToWebp: {
    formatMismatch: string;
    unsupportedAnimation: string;
    unsafeDimensions: string;
    unsupportedBrowser: string;
    workbenchNote: string;
    panel: {
      qualityLegend: string;
      qualityLabel: Record<PngToWebpQualityPreset, string>;
      qualityDescription: Record<PngToWebpQualityPreset, string>;
      convert: string;
      reconvert: string;
      queued: string;
      converting: string;
      errors: Record<PngToWebpFailureReason, string>;
    };
    result: {
      completed: string;
      originalBytesLabel: string;
      outputBytesLabel: string;
      reductionLabel: string;
      originalDimensionsLabel: string;
      outputDimensionsLabel: string;
      outputFormatLabel: string;
      qualitySettingLabel: string;
      elapsedLabel: string;
      secondsSuffix: string;
    };
  };
  /**
   * PNG→JPG・WebP→JPG共通のRasterToJpgWorkbench/RasterToJpgPanelが参照する文言。
   * 入力形式(PNG/WebP)によって変わる箇所(formatMismatch・unsupportedAnimation・workbenchNote)は、
   * fixedTargetWorkbench.formatMismatchと同じ設計で、表示テキスト(sourceFormatLabel: "PNG"|"WebP")を
   * 受け取る関数として持つ。
   */
  rasterToJpg: {
    formatMismatch: (sourceFormatLabel: string) => string;
    unsupportedAnimation: (sourceFormatLabel: string) => string;
    unsafeDimensions: string;
    unsupportedBrowser: string;
    workbenchNote: (sourceFormatLabel: string) => string;
    /** JPEGが透明を保持できないため、変換前に背景色で塗りつぶす旨の説明(背景色ピッカー直下に表示) */
    backgroundNote: string;
    panel: {
      qualityLegend: string;
      qualityLabel: Record<RasterQualityPreset, string>;
      qualityDescription: Record<RasterQualityPreset, string>;
      backgroundLabel: string;
      backgroundPickerAriaLabel: string;
      convert: string;
      reconvert: string;
      queued: string;
      converting: string;
      errors: Record<RasterToJpgFailureReason, string>;
    };
    result: {
      completed: string;
      originalBytesLabel: string;
      outputBytesLabel: string;
      /**
       * outputBytesがoriginalBytes以下(reduced、同サイズ含む)か上回るか(increased)で
       * 文言そのものが変わるため、静的文字列ではなく関数として持つ(png-to-webpのreductionLabelとは
       * 異なる設計。あちらは「変換後は必ず縮小方向」という前提を置けないため、このページでは
       * 意味の通らない負のパーセント表示("Reduction: -25%")を避ける)。
       */
      sizeChangeLabel: (direction: "reduced" | "increased", percent: number) => string;
      originalDimensionsLabel: string;
      outputDimensionsLabel: string;
      outputFormatLabel: string;
      qualitySettingLabel: string;
      backgroundColorLabel: string;
      elapsedLabel: string;
      secondsSuffix: string;
    };
  };
  metadataRemoval: {
    formatMismatch: string;
    unsupportedBrowser: string;
    heicSourceNote: string;
    panel: {
      start: string;
      retry: string;
      queued: string;
      removing: string;
      errors: Record<RemoveExifErrorCode, string>;
    };
    result: {
      completed: string;
      baseNotice: string;
      orientationNotice: string;
      iccNotice: string;
      originalBytesLabel: string;
      outputBytesLabel: string;
      originalDimensionsLabel: string;
      outputDimensionsLabel: string;
      reencodeLabel: string;
      reencodeNone: string;
      outputFormatLabel: string;
      reductionLabel: string;
      orientationLabel: string;
      orientationKept: string;
      orientationRemoved: string;
      colorProfileLabel: string;
      colorProfileKept: string;
      colorProfileRemoved: string;
      elapsedLabel: string;
      msSuffix: string;
    };
  };
  /**
   * /signature-resizer/(EN-only)が参照する文言。target-fit-*.ts(用途非依存の共通コア)の
   * 上に立つ、このツール専用のUI文言。幅・高さ・容量の3条件を独立にok/failで表示するため、
   * checklistは条件ごとに実測値・目標値を埋め込める関数型として持つ。
   */
  signatureResizer: {
    formatMismatch: string;
    unsupportedBrowser: string;
    workbenchNote: string;
    form: {
      widthLabel: string;
      heightLabel: string;
      pxUnitNote: string;
      maxSizeLabel: string;
      maxSizeUnitNote: string;
      fitModeLegend: string;
      fitModeContainLabel: string;
      fitModeContainDescription: string;
      fitModeStretchLabel: string;
      fitModeStretchDescription: string;
      errors: Record<
        "empty" | "invalid-number" | "not-positive" | "too-large" | "too-small",
        string
      >;
    };
    panel: {
      convert: string;
      reconvert: string;
      queued: string;
      processing: string;
      errors: Record<TargetFitFailureReason, string>;
    };
    result: {
      completed: string;
      unreachable: string;
      /**
       * 品質floorの制約であって「原理的に不可能」ではないことを明示する文言
       * (レビューで明示された方針: 断定しない)。
       */
      unreachableNote: string;
      upscaledWarning: string;
      checklistHeading: string;
      widthConditionLabel: (actualPx: number, targetPx: number) => string;
      heightConditionLabel: (actualPx: number, targetPx: number) => string;
      sizeConditionLabel: (actualKbText: string, maxKbText: string) => string;
      formatConditionLabel: (actual: string) => string;
      conditionOkBadge: string;
      conditionFailBadge: string;
      outputFormatLabel: string;
      qualityLabel: string;
      elapsedLabel: string;
      secondsSuffix: string;
    };
  };
}

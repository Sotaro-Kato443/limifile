import { ImageDropZone } from "./image-intake/image-drop-zone";
import { formatBytes } from "./image-intake/format-bytes";
import { FORMAT_LABEL } from "./image-intake/image-list-item";
import { RasterToJpgPanel } from "./image-intake/raster-to-jpg-panel";
import { useImageIntake } from "./image-intake/use-image-intake";
import { useRasterToJpg } from "./image-intake/use-raster-to-jpg";
import { PrivacyNotice } from "./privacy-notice";
import { getDictionary } from "../i18n/get-dictionary";
import type { UseRasterToJpgResult } from "./image-intake/use-raster-to-jpg";
import type { IntakeItem } from "./image-intake/types";
import type {
  RasterBackgroundColor,
  RasterQualityPreset,
  RasterSourceFormat,
} from "./image-intake/raster-convert-types";
import type { ImplementedLocaleKey } from "../i18n/get-dictionary";
import type { UiDictionary } from "../i18n/schema";

export interface RasterToJpgWorkbenchProps {
  locale: ImplementedLocaleKey;
  /** このワークベンチが受け付ける入力形式。ページごとに1つに固定する(混在ページは作らない) */
  sourceFormat: RasterSourceFormat;
  /** ドロップゾーンのヒント表示・文言(messages.rasterToJpgの関数フィールド)に渡す表示用ラベル */
  sourceFormatLabel: string;
}

/**
 * input[type=file]のaccept属性(OSファイル選択ダイアログの絞り込みヒントに過ぎない)。
 * drag&dropではブラウザがこの属性を適用しないため、実形式の検証は必ず
 * useImageIntakeのallowedFormats(マジックバイト判定ベース)側で行う。
 */
const ACCEPT_BY_SOURCE_FORMAT: Record<RasterSourceFormat, string> = {
  png: "image/png,.png",
  webp: "image/webp,.webp",
  avif: "image/avif,.avif",
};

const HEIC_PIPELINE_STATUSES = new Set([
  "heic-pending",
  "heic-converting",
  "heic-done",
  "heic-error",
]);

function RasterToJpgListItem({
  item,
  onRemove,
  rasterToJpg,
  messages,
  sourceFormatLabel,
}: {
  item: IntakeItem;
  onRemove: (id: string) => void;
  rasterToJpg: UseRasterToJpgResult;
  messages: UiDictionary;
  sourceFormatLabel: string;
}) {
  const isDebug = import.meta.env.DEV;
  const isHeicPipeline = HEIC_PIPELINE_STATUSES.has(item.status.kind);
  const eligibility = rasterToJpg.eligibilityFor(item);
  const job = rasterToJpg.jobs[item.id];

  const handleConvert = (preset: RasterQualityPreset, background: RasterBackgroundColor) => {
    rasterToJpg.startConversion(item, preset, background);
  };

  const handleCancel = () => {
    rasterToJpg.cancelConversion(item.id);
  };

  const handleRemove = () => {
    rasterToJpg.removeJob(item.id);
    onRemove(item.id);
  };

  return (
    <li class="image-list-item">
      {item.status.kind === "heic-done" ? (
        <img class="image-list-item__thumbnail" src={item.status.result.objectUrl} alt="" />
      ) : isHeicPipeline ? (
        <div
          class="image-list-item__thumbnail image-list-item__thumbnail--placeholder"
          aria-hidden="true"
        />
      ) : (
        <img class="image-list-item__thumbnail" src={item.objectUrl} alt="" />
      )}
      <div class="image-list-item__details">
        <p class="image-list-item__name">{item.file.name}</p>
        <p class="image-list-item__meta">
          <span>{formatBytes(item.file.size)}</span>
          {item.status.kind === "ready" && (
            <span>
              {item.status.dimensions.width}×{item.status.dimensions.height}px
            </span>
          )}
          <span>{item.mimeType || messages.common.mimeUnknown}</span>
        </p>

        {item.status.kind === "analyzing" && (
          <p class="image-list-item__status" role="status">
            {messages.listItem.analyzing}
          </p>
        )}
        {item.status.kind === "heic-pending" && (
          <p class="image-list-item__status" role="status">
            {messages.listItem.heicQueued}
          </p>
        )}
        {item.status.kind === "heic-converting" && (
          <p class="image-list-item__status" role="status">
            {messages.listItem.heicConverting}
          </p>
        )}
        {item.status.kind === "heic-error" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.heicConvertFailed}
          </p>
        )}
        {item.status.kind === "avif-too-large" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.avifTooLarge}
          </p>
        )}
        {item.status.kind === "avif-unsupported-animation" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.avifUnsupportedAnimation}
          </p>
        )}
        {item.status.kind === "avif-unsafe-dimensions" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.avifUnsafeDimensions}
          </p>
        )}
        {item.status.kind === "avif-decode-failed" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.avifDecodeFailed}
          </p>
        )}
        {item.status.kind === "unsupported-format" && item.detectedFormat === null && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.unsupportedFormat}
          </p>
        )}
        {item.status.kind === "error" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.analyzeFailed}
          </p>
        )}
        {item.extensionMismatch && (
          <p class="image-list-item__warning">
            {messages.listItem.extensionMismatch(
              item.extension ?? "?",
              item.detectedFormat
                ? FORMAT_LABEL[item.detectedFormat]
                : messages.common.unknownFormatLabel,
            )}
          </p>
        )}

        {eligibility.kind === "unsupported-format" && (
          <p class="image-list-item__status">
            {messages.rasterToJpg.formatMismatch(sourceFormatLabel)}
          </p>
        )}
        {eligibility.kind === "unsupported-animation" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.rasterToJpg.unsupportedAnimation(sourceFormatLabel)}
          </p>
        )}
        {eligibility.kind === "unsafe-dimensions" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.rasterToJpg.unsafeDimensions}
          </p>
        )}
        {eligibility.kind === "unsupported-browser" && (
          <p class="image-list-item__status image-list-item__status--error">
            {messages.rasterToJpg.unsupportedBrowser}
          </p>
        )}

        {eligibility.kind === "ready" && (
          <RasterToJpgPanel
            fileName={item.file.name}
            job={job}
            onConvert={handleConvert}
            onCancel={handleCancel}
            messages={messages}
          />
        )}

        {isDebug && (
          <p class="image-list-item__debug">
            debug: detected={item.detectedFormat ?? "null"} / ext={item.extension ?? "null"}
            {item.status.kind === "heic-error" && ` / raw=${item.status.message}`}
            {item.status.kind === "error" && ` / raw=${item.status.message}`}
          </p>
        )}
      </div>
      <button
        type="button"
        class="image-list-item__remove"
        onClick={handleRemove}
        aria-label={messages.listItem.removeAriaLabel(item.file.name)}
      >
        {messages.common.remove}
      </button>
    </li>
  );
}

/**
 * PNG→JPG・WebP→JPG共通のPreactアイランド。/png-to-jpg・/webp-to-jpgから、sourceFormatを
 * 変えて読み込まれる(処理コードの複製を避けるため、1つのコンポーネントを両ページで共有する)。
 * 既存のImageWorkbench・CompressWorkbench・RemoveExifWorkbench・PngToWebpWorkbenchは変更せず
 * 維持し、この機能はこちらに独立させる。ファイル選択・解析・HEIC変換自体はuseImageIntakeを
 * そのまま再利用するが、このページで実際に変換対象となるのはsourceFormatのみ(それ以外は
 * useRasterToJpg側のeligibilityForで一律unsupported-formatとして扱う)。
 */
export function RasterToJpgWorkbench({
  locale,
  sourceFormat,
  sourceFormatLabel,
}: RasterToJpgWorkbenchProps) {
  const { items, addFiles, removeItem, clearAll } = useImageIntake({
    allowedFormats: [sourceFormat],
  });
  const dictionary = getDictionary(locale);
  const messages = dictionary.ui;
  const rasterToJpg = useRasterToJpg(sourceFormat, messages.rasterToJpg.panel.errors);

  // rasterToJpg.removeJob(id)はRasterToJpgListItem.handleRemoveが既に呼んでいるため、
  // ここではuseImageIntake側のアイテム除去のみを行う(cleanup責務を1箇所に保つ)。
  const handleRemove = (id: string) => {
    removeItem(id);
  };

  const handleClearAll = () => {
    rasterToJpg.clearJobs();
    clearAll();
  };

  return (
    <div class="image-workbench">
      <ImageDropZone
        onFiles={addFiles}
        formatsHint={sourceFormatLabel}
        accept={ACCEPT_BY_SOURCE_FORMAT[sourceFormat]}
        messages={messages.dropZone}
      />
      <p class="raster-to-jpg-workbench__note">
        {messages.rasterToJpg.workbenchNote(sourceFormatLabel)}
      </p>
      <PrivacyNotice text={dictionary.privacyNotice} />
      {!rasterToJpg.isSupported && (
        <p class="raster-to-jpg-workbench__unsupported">
          {messages.rasterToJpg.unsupportedBrowser}
        </p>
      )}
      {items.length > 0 && (
        <div class="image-list">
          <div class="image-list__header">
            <p class="image-list__count">{messages.imageList.selectedCount(items.length)}</p>
            <button type="button" class="image-list__clear-all" onClick={handleClearAll}>
              {messages.common.removeAll}
            </button>
          </div>
          <ul class="image-list__items">
            {items.map((item) => (
              <RasterToJpgListItem
                key={item.id}
                item={item}
                onRemove={handleRemove}
                rasterToJpg={rasterToJpg}
                messages={messages}
                sourceFormatLabel={sourceFormatLabel}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

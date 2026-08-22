import { ImageDropZone } from "./image-intake/image-drop-zone";
import { formatBytes } from "./image-intake/format-bytes";
import { FORMAT_LABEL } from "./image-intake/image-list-item";
import { PngToWebpPanel } from "./image-intake/png-to-webp-panel";
import { useImageIntake } from "./image-intake/use-image-intake";
import { usePngToWebp } from "./image-intake/use-png-to-webp";
import { PrivacyNotice } from "./privacy-notice";
import { getDictionary } from "../i18n/get-dictionary";
import type { UsePngToWebpResult } from "./image-intake/use-png-to-webp";
import type { IntakeItem } from "./image-intake/types";
import type { PngToWebpQualityPreset } from "./image-intake/png-to-webp-types";
import type { ImplementedLocaleKey } from "../i18n/get-dictionary";
import type { UiDictionary } from "../i18n/schema";

export interface PngToWebpWorkbenchProps {
  locale: ImplementedLocaleKey;
}

const HEIC_PIPELINE_STATUSES = new Set([
  "heic-pending",
  "heic-converting",
  "heic-done",
  "heic-error",
]);

function PngToWebpListItem({
  item,
  onRemove,
  pngToWebp,
  messages,
}: {
  item: IntakeItem;
  onRemove: (id: string) => void;
  pngToWebp: UsePngToWebpResult;
  messages: UiDictionary;
}) {
  const isDebug = import.meta.env.DEV;
  const isHeicPipeline = HEIC_PIPELINE_STATUSES.has(item.status.kind);
  const eligibility = pngToWebp.eligibilityFor(item);
  const job = pngToWebp.jobs[item.id];

  const handleConvert = (preset: PngToWebpQualityPreset) => {
    pngToWebp.startConversion(item, preset);
  };

  const handleCancel = () => {
    pngToWebp.cancelConversion(item.id);
  };

  const handleRemove = () => {
    pngToWebp.removeJob(item.id);
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
          <p class="image-list-item__status">{messages.pngToWebp.formatMismatch}</p>
        )}
        {eligibility.kind === "unsupported-animation" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.pngToWebp.unsupportedAnimation}
          </p>
        )}
        {eligibility.kind === "unsafe-dimensions" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.pngToWebp.unsafeDimensions}
          </p>
        )}
        {eligibility.kind === "unsupported-browser" && (
          <p class="image-list-item__status image-list-item__status--error">
            {messages.pngToWebp.unsupportedBrowser}
          </p>
        )}

        {eligibility.kind === "ready" && (
          <PngToWebpPanel
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
 * PNG→WebP変換専用のPreactアイランド。/png-to-webpから読み込まれる。
 * 既存のImageWorkbench・CompressWorkbench・RemoveExifWorkbenchは変更せず維持し、
 * この機能はこちらに独立させる。ファイル選択・解析・HEIC変換自体はuseImageIntakeを
 * そのまま再利用するが、このページで実際に変換対象となるのはPNGのみ(PNG以外は
 * usePngToWebp側のeligibilityForで一律unsupported-formatとして扱う)。
 */
export function PngToWebpWorkbench({ locale }: PngToWebpWorkbenchProps) {
  /**
   * PNG専用ページ。AVIF等の対象外形式は、不要なpre-decode safety処理を始める前に
   * ここでunsupported-formatとして弾く(RasterToJpgWorkbench.tsxと同じ方針)。
   */
  const { items, addFiles, removeItem, clearAll } = useImageIntake({
    allowedFormats: ["png"],
  });
  const dictionary = getDictionary(locale);
  const messages = dictionary.ui;
  const pngToWebp = usePngToWebp(messages.pngToWebp.panel.errors);

  const handleRemove = (id: string) => {
    pngToWebp.removeJob(id);
    removeItem(id);
  };

  const handleClearAll = () => {
    pngToWebp.clearJobs();
    clearAll();
  };

  return (
    <div class="image-workbench">
      <ImageDropZone onFiles={addFiles} formatsHint="PNG" messages={messages.dropZone} />
      <p class="png-to-webp-workbench__note">{messages.pngToWebp.workbenchNote}</p>
      <PrivacyNotice text={dictionary.privacyNotice} />
      {!pngToWebp.isSupported && (
        <p class="png-to-webp-workbench__unsupported">{messages.pngToWebp.unsupportedBrowser}</p>
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
              <PngToWebpListItem
                key={item.id}
                item={item}
                onRemove={handleRemove}
                pngToWebp={pngToWebp}
                messages={messages}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

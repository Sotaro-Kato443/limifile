import { ImageDropZone } from "./image-intake/image-drop-zone";
import { formatBytes } from "./image-intake/format-bytes";
import { FORMAT_LABEL } from "./image-intake/image-list-item";
import { PngCompressionPanel } from "./png-compression/png-compression-panel";
import { useImageIntake } from "./image-intake/use-image-intake";
import { usePngCompression } from "./png-compression/use-png-compression";
import { PrivacyNotice } from "./privacy-notice";
import { getDictionary } from "../i18n/get-dictionary";
import type { UsePngCompressionResult } from "./png-compression/use-png-compression";
import type { IntakeItem } from "./image-intake/types";
import type { CompressionTarget } from "./image-intake/compression-types";
import type { ImplementedLocaleKey } from "../i18n/get-dictionary";
import type { UiDictionary } from "../i18n/schema";

export interface PngCompressionWorkbenchProps {
  locale: ImplementedLocaleKey;
}

const HEIC_PIPELINE_STATUSES = new Set([
  "heic-pending",
  "heic-converting",
  "heic-done",
  "heic-error",
]);

/** OSのファイル選択ダイアログをPNGへ絞り込む。drag&dropや実形式検証には影響しない
 * (実形式の最終判定はマジックバイト解析・Worker側のstrict PNG検証で行う) */
const PNG_ACCEPT = "image/png,.png";

function PngCompressionListItem({
  item,
  onRemove,
  pngCompression,
  messages,
}: {
  item: IntakeItem;
  onRemove: (id: string) => void;
  pngCompression: UsePngCompressionResult;
  messages: UiDictionary;
}) {
  const isDebug = import.meta.env.DEV;
  const isHeicPipeline = HEIC_PIPELINE_STATUSES.has(item.status.kind);
  const eligibility = pngCompression.eligibilityFor(item);
  const job = pngCompression.jobs[item.id];

  const handleCompress = (target: CompressionTarget) => {
    pngCompression.startCompression(item, target);
  };

  const handleCancel = () => {
    pngCompression.cancelCompression(item.id);
  };

  const handleTargetChange = () => {
    pngCompression.invalidateForTargetChange(item.id);
  };

  const handleRemove = () => {
    // PNGジョブの削除は親(PngCompressionWorkbench.handleRemove)がremoveItemと合わせて
    // 一括で行う。ここでも呼ぶと1回の削除操作でremoveJobが二重に呼ばれてしまうため、
    // ここではonRemoveの通知のみを行う。
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
          <p class="image-list-item__status">{messages.pngCompression.formatMismatch}</p>
        )}
        {eligibility.kind === "unsupported-browser" && (
          <p class="image-list-item__status image-list-item__status--error">
            {messages.pngCompression.unsupportedBrowser}
          </p>
        )}

        {eligibility.kind === "ready" && (
          <PngCompressionPanel
            fileName={item.file.name}
            job={job}
            onCompress={handleCompress}
            onCancel={handleCancel}
            onTargetChange={handleTargetChange}
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
 * PNG指定容量圧縮専用のPreactアイランド。/compress-pngから読み込まれる。
 * 既存のImageWorkbench・CompressWorkbench・PngToWebpWorkbench・RemoveExifWorkbenchは変更せず
 * 維持し、この機能はこちらに独立させる。ファイル選択・解析・HEIC変換自体はuseImageIntakeを
 * そのまま再利用するが、このページで実際に圧縮対象となるのはPNGのみ(PNG以外は
 * usePngCompression側のeligibilityForで一律unsupported-formatとして扱う)。
 */
export function PngCompressionWorkbench({ locale }: PngCompressionWorkbenchProps) {
  /**
   * PNG専用ページ。AVIF等の対象外形式は、不要なpre-decode safety処理を始める前に
   * ここでunsupported-formatとして弾く(RasterToJpgWorkbench.tsxと同じ方針)。
   */
  const { items, addFiles, removeItem, clearAll } = useImageIntake({
    allowedFormats: ["png"],
  });
  const dictionary = getDictionary(locale);
  const messages = dictionary.ui;
  const pngCompression = usePngCompression(messages.pngCompression.panel.errors);

  const handleRemove = (id: string) => {
    pngCompression.removeJob(id);
    removeItem(id);
  };

  const handleClearAll = () => {
    pngCompression.clearJobs();
    clearAll();
  };

  return (
    <div class="image-workbench">
      <ImageDropZone
        onFiles={addFiles}
        formatsHint="PNG"
        accept={PNG_ACCEPT}
        messages={messages.dropZone}
      />
      <p class="png-compression-workbench__note">{messages.pngCompression.workbenchNote}</p>
      <PrivacyNotice text={dictionary.privacyNotice} />
      {!pngCompression.isSupported && (
        <p class="png-compression-workbench__unsupported">
          {messages.pngCompression.unsupportedBrowser}
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
              <PngCompressionListItem
                key={item.id}
                item={item}
                onRemove={handleRemove}
                pngCompression={pngCompression}
                messages={messages}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

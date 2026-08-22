import { ImageDropZone } from "./image-intake/image-drop-zone";
import { RemoveExifPanel } from "./image-intake/remove-exif-panel";
import { formatBytes } from "./image-intake/format-bytes";
import { FORMAT_LABEL } from "./image-intake/image-list-item";
import { useImageIntake } from "./image-intake/use-image-intake";
import { useRemoveExif } from "./image-intake/use-remove-exif";
import { PrivacyNotice } from "./privacy-notice";
import { getDictionary } from "../i18n/get-dictionary";
import type { UseRemoveExifResult } from "./image-intake/use-remove-exif";
import type { IntakeItem } from "./image-intake/types";
import type { ImplementedLocaleKey } from "../i18n/get-dictionary";
import type { UiDictionary } from "../i18n/schema";

export interface RemoveExifWorkbenchProps {
  locale: ImplementedLocaleKey;
}

const HEIC_PIPELINE_STATUSES = new Set([
  "heic-pending",
  "heic-converting",
  "heic-done",
  "heic-error",
]);

function RemoveExifListItem({
  item,
  onRemove,
  removeExif,
  messages,
}: {
  item: IntakeItem;
  onRemove: (id: string) => void;
  removeExif: UseRemoveExifResult;
  messages: UiDictionary;
}) {
  const isDebug = import.meta.env.DEV;
  const isHeicPipeline = HEIC_PIPELINE_STATUSES.has(item.status.kind);
  const eligibility = removeExif.eligibilityFor(item);
  const job = removeExif.jobs[item.id];

  const handleStart = () => {
    removeExif.startRemoval(item);
  };

  const handleCancel = () => {
    removeExif.cancelRemoval(item.id);
  };

  const handleRemove = () => {
    removeExif.removeJob(item.id);
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
          <p class="image-list-item__status">{messages.metadataRemoval.formatMismatch}</p>
        )}
        {eligibility.kind === "unsupported-browser" && (
          <p class="image-list-item__status image-list-item__status--error">
            {messages.metadataRemoval.unsupportedBrowser}
          </p>
        )}

        {eligibility.kind === "ready" && (
          <>
            {item.status.kind === "heic-done" && (
              <p class="image-list-item__status">{messages.metadataRemoval.heicSourceNote}</p>
            )}
            <RemoveExifPanel
              fileName={item.file.name}
              job={job}
              onStart={handleStart}
              onCancel={handleCancel}
              messages={messages}
            />
          </>
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
 * EXIF・個人情報メタデータの削除専用のPreactアイランド。/remove-exifから読み込まれる。
 * 既存のImageWorkbench(トップページ、/heic-to-jpg)・CompressWorkbench(/compress-image等)は
 * 変更せず維持し、この機能はこちらに独立させる。ファイル選択・解析・HEIC変換自体は
 * useImageIntakeをそのまま再利用する(HEICは既存のJPG変換結果Blobを入力にし、再デコードしない)。
 */
export function RemoveExifWorkbench({ locale }: RemoveExifWorkbenchProps) {
  /**
   * 対応形式はJPEG本体・HEIC変換後JPEGのみ(use-remove-exif.tsのsourceFor参照)。PNG/WebPは
   * 既存どおりuseRemoveExif側でunsupported-formatとして案内するためallowedFormatsには
   * 含めない。AVIFはこのツールで処理できないため、ここで即座にunsupported-formatとして弾く。
   */
  const { items, addFiles, removeItem, clearAll } = useImageIntake({
    allowedFormats: ["jpeg", "heic"],
  });
  const removeExif = useRemoveExif();
  const dictionary = getDictionary(locale);
  const messages = dictionary.ui;

  const handleRemove = (id: string) => {
    removeExif.removeJob(id);
    removeItem(id);
  };

  const handleClearAll = () => {
    removeExif.clearJobs();
    clearAll();
  };

  return (
    <div class="image-workbench">
      <ImageDropZone onFiles={addFiles} formatsHint="JPEG・HEIC" messages={messages.dropZone} />
      <PrivacyNotice text={dictionary.privacyNotice} />
      {!removeExif.isSupported && (
        <p class="remove-exif-workbench__unsupported">
          {messages.metadataRemoval.unsupportedBrowser}
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
              <RemoveExifListItem
                key={item.id}
                item={item}
                onRemove={handleRemove}
                removeExif={removeExif}
                messages={messages}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

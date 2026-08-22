import { formatBytes } from "./format-bytes";
import { heicOutputFileName } from "./heic-output-filename";
import { ImagePreviewAndSave } from "./image-preview-and-save";
import type { HeicConversionResult, IntakeItem, SupportedImageFormat } from "./types";
import type { UiDictionary } from "../../i18n/schema";

export interface ImageListItemProps {
  item: IntakeItem;
  onRemove: (id: string) => void;
  messages: UiDictionary;
}

export const FORMAT_LABEL: Record<SupportedImageFormat, string> = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
  heic: "HEIC",
  avif: "AVIF",
};

const HEIC_PIPELINE_STATUSES = new Set([
  "heic-pending",
  "heic-converting",
  "heic-done",
  "heic-error",
  "heic-too-large",
  "heic-unsupported-browser",
]);

/** HEIC→JPG変換結果のプレビュー・保存導線。共通実装はjpg-preview-and-save.tsxを参照 */
function HeicJpegOutput({
  fileName,
  result,
  messages,
}: {
  fileName: string;
  result: HeicConversionResult;
  messages: UiDictionary;
}) {
  return (
    <ImagePreviewAndSave
      fileName={fileName}
      objectUrl={result.objectUrl}
      blob={result.blob}
      outputFileName={heicOutputFileName(fileName)}
      width={result.width}
      height={result.height}
      formatLabel="JPG"
      messages={messages.previewAndSave}
    />
  );
}

export function ImageListItem({ item, onRemove, messages }: ImageListItemProps) {
  const isDebug = import.meta.env.DEV;
  const isHeicPipeline = HEIC_PIPELINE_STATUSES.has(item.status.kind);

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
          {item.status.kind === "heic-done" ? (
            <>
              <span>
                {messages.listItem.originalLabel}
                {formatBytes(item.file.size)}
              </span>
              <span>
                {messages.listItem.convertedLabel}
                {formatBytes(item.status.result.jpegBytes)}
              </span>
              <span>
                {item.status.result.width}×{item.status.result.height}px
              </span>
            </>
          ) : (
            <>
              <span>{formatBytes(item.file.size)}</span>
              {item.status.kind === "ready" && (
                <span>
                  {item.status.dimensions.width}×{item.status.dimensions.height}px
                </span>
              )}
            </>
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
        {item.status.kind === "heic-done" && (
          <p class="image-list-item__status" role="status">
            {messages.listItem.heicConverted}
          </p>
        )}
        {item.status.kind === "heic-error" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.heicConvertFailed}
          </p>
        )}
        {item.status.kind === "heic-too-large" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.heicTooLarge}
          </p>
        )}
        {item.status.kind === "heic-unsupported-browser" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.heicUnsupportedBrowser}
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
        {item.status.kind === "unsupported-format" && (
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
        {item.status.kind === "heic-done" && (
          <HeicJpegOutput
            fileName={item.file.name}
            result={item.status.result}
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
        onClick={() => onRemove(item.id)}
        aria-label={messages.listItem.removeAriaLabel(item.file.name)}
      >
        {messages.common.remove}
      </button>
    </li>
  );
}

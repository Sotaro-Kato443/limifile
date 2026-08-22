import { ImageDropZone } from "./image-intake/image-drop-zone";
import { CompressPanel } from "./image-intake/compress-panel";
import { trackToolEvent } from "../analytics/tool-events";
import { useTrackProcessingOutcome } from "../analytics/use-track-processing-outcome";
import { formatBytes } from "./image-intake/format-bytes";
import { FORMAT_LABEL } from "./image-intake/image-list-item";
import { useFixedTargetCompressionOrchestrator } from "./image-intake/use-fixed-target-compression-orchestrator";
import { useImageIntake } from "./image-intake/use-image-intake";
import {
  PngCompressionDoneView,
  PngCompressionUnreachableView,
} from "./png-compression/png-compression-panel";
import { PrivacyNotice } from "./privacy-notice";
import { getDictionary } from "../i18n/get-dictionary";
import type { UseFixedTargetCompressionOrchestratorResult } from "./image-intake/use-fixed-target-compression-orchestrator";
import type { CompressionTarget } from "./image-intake/compression-types";
import type { IntakeItem } from "./image-intake/types";
import type { PngCompressionJob } from "./png-compression/png-compression-ui-types";
import type { ImplementedLocaleKey } from "../i18n/get-dictionary";
import type { UiDictionary } from "../i18n/schema";

export interface FixedTargetCompressionWorkbenchProps {
  locale: ImplementedLocaleKey;
  /** このページが目指す固定target(例: 20/50/100/200/500KB)。手動入力UIは一切出さない */
  target: CompressionTarget;
}

const HEIC_PIPELINE_STATUSES = new Set([
  "heic-pending",
  "heic-converting",
  "heic-done",
  "heic-error",
]);

/**
 * PNG用の固定target圧縮パネル。/compress-pngのPngCompressionPanelとは異なり
 * CompressTargetInputは使わず(このページはtarget固定のため)、常にpropsで渡された
 * targetを目指す「圧縮する」ボタンのみを表示する。done/unreachableの結果表示ロジックは
 * PngCompressionPanelと同じものを再利用し、重複させない。
 */
function PngFixedTargetPanel({
  fileName,
  job,
  onCompress,
  onCancel,
  messages,
}: {
  fileName: string;
  job: PngCompressionJob | undefined;
  onCompress: () => void;
  onCancel: () => void;
  messages: UiDictionary;
}) {
  const isProcessing = job?.status.kind === "queued" || job?.status.kind === "processing";
  const panelMessages = messages.pngCompression.panel;
  useTrackProcessingOutcome(job?.status);

  const handleCompress = () => {
    trackToolEvent({ name: "process_start" });
    onCompress();
  };

  return (
    <div class="png-compression-panel">
      <button
        type="button"
        class="btn-primary compress-target__submit"
        disabled={isProcessing}
        onClick={handleCompress}
      >
        {messages.compressionPanel.compress}
      </button>

      {job?.status.kind === "queued" && (
        <div class="png-compression-panel__processing">
          <p class="png-compression-panel__status" role="status">
            {panelMessages.queued}
          </p>
          <button
            type="button"
            class="btn-secondary png-compression-panel__cancel"
            onClick={onCancel}
          >
            {messages.common.cancel}
          </button>
        </div>
      )}

      {job?.status.kind === "processing" && (
        <div class="png-compression-panel__processing">
          <p class="png-compression-panel__status" role="status">
            {panelMessages.processing}
          </p>
          <button
            type="button"
            class="btn-secondary png-compression-panel__cancel"
            onClick={onCancel}
          >
            {messages.common.cancel}
          </button>
        </div>
      )}

      {job?.status.kind === "done" && (
        <PngCompressionDoneView
          fileName={fileName}
          result={job.status.result}
          messages={messages}
        />
      )}

      {job?.status.kind === "unreachable" && (
        <PngCompressionUnreachableView
          fileName={fileName}
          result={job.status.result}
          messages={messages}
        />
      )}

      {job?.status.kind === "error" && (
        <p class="png-compression-panel__status png-compression-panel__status--error" role="alert">
          {job.status.message}
        </p>
      )}

      {job?.status.kind === "cancelled" && (
        <p class="png-compression-panel__status" role="status">
          {messages.common.cancelled}
        </p>
      )}
    </div>
  );
}

function FixedTargetCompressionListItem({
  item,
  target,
  onRemove,
  compression,
  messages,
}: {
  item: IntakeItem;
  target: CompressionTarget;
  onRemove: (id: string) => void;
  compression: UseFixedTargetCompressionOrchestratorResult;
  messages: UiDictionary;
}) {
  const isDebug = import.meta.env.DEV;
  const isHeicPipeline = HEIC_PIPELINE_STATUSES.has(item.status.kind);
  const eligibility = compression.eligibilityFor(item);
  const merged = compression.jobs[item.id];

  const handleCancel = () => {
    compression.cancelCompression(item.id);
  };

  // 削除の実処理(removeJob+removeItem)は親のhandleRemove(FixedTargetCompressionWorkbench)が
  // 1箇所でまとめて行う。ここでも呼ぶとremoveJobが1回の削除操作で二重に呼ばれてしまうため、
  // ここでは通知のみを行う(PngCompressionWorkbenchと同じ方針)。
  const handleRemove = () => {
    onRemove(item.id);
  };

  const handleCompress = (target: CompressionTarget) => {
    compression.startCompression(item, target);
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
            {messages.fixedTargetWorkbench.formatMismatch(target.displayText)}
          </p>
        )}

        {eligibility.kind === "unsupported-animation" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.compressionWorkbench.unsupportedAnimation}
          </p>
        )}

        {eligibility.kind === "unsafe-dimensions" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.compressionWorkbench.unsafeDimensions}
          </p>
        )}

        {eligibility.kind === "unsupported-browser" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {eligibility.format === "png"
              ? messages.fixedTargetWorkbench.unsupportedBrowserPng
              : messages.fixedTargetWorkbench.unsupportedBrowserJpegWebp}
          </p>
        )}

        {eligibility.kind === "ready" && eligibility.format === "jpeg-webp" && (
          <>
            {item.status.kind === "heic-done" && (
              <p class="image-list-item__status">{messages.compressionWorkbench.heicSourceNote}</p>
            )}
            {eligibility.source.kind === "webp" && (
              <p class="image-list-item__status">{messages.compressionWorkbench.webpSourceNote}</p>
            )}
            <CompressPanel
              fileName={item.file.name}
              job={merged?.format === "jpeg-webp" ? merged.job : undefined}
              fixedTarget={target}
              onCompress={handleCompress}
              onCancel={handleCancel}
              messages={messages}
            />
          </>
        )}

        {eligibility.kind === "ready" && eligibility.format === "png" && (
          <>
            <p class="image-list-item__status">
              {messages.fixedTargetWorkbench.pngNote(target.displayText)}
            </p>
            <PngFixedTargetPanel
              fileName={item.file.name}
              job={merged?.format === "png" ? merged.job : undefined}
              onCompress={() => handleCompress(target)}
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
 * 固定容量ページ(/compress-image-to-{20,50,100,200,500}kb)共通のPreactアイランド。
 * どの容量を目指すかはtarget propで呼び出し側(各ページ)が決める。JPEG・HEIC・WebPは
 * 既存のCompressWorkbenchと同じuseImageCompression()を、PNGは/compress-pngと同じ
 * usePngCompression()を、それぞれuseFixedTargetCompressionOrchestrator()経由で再利用する。
 * 既存のCompressWorkbench(/compress-image)・PngCompressionWorkbench(/compress-png)は
 * 変更せず維持し、この2つの形式混在ページ専用の振り分け・共通FIFOをオーケストレーターに閉じ込める。
 */
export function FixedTargetCompressionWorkbench({
  locale,
  target,
}: FixedTargetCompressionWorkbenchProps) {
  /**
   * 対応形式はjpeg-webpグループ(JPEG・WebP・HEIC変換後JPEG)とpngグループの合算
   * (use-fixed-target-compression-orchestrator.tsのformatGroupFor参照)。AVIFはどちらの
   * グループにも属さず、allowedFormats省略時はready状態のまま操作不能なnot-readyに
   * 陥ってしまうため、ここで即座にunsupported-formatとして弾く。
   */
  const { items, addFiles, removeItem, clearAll } = useImageIntake({
    allowedFormats: ["jpeg", "png", "webp", "heic"],
  });
  const dictionary = getDictionary(locale);
  const messages = dictionary.ui;
  const compression = useFixedTargetCompressionOrchestrator(
    messages.compressionPanel.errors,
    messages.pngCompression.panel.errors,
  );

  const handleRemove = (id: string) => {
    compression.removeJob(id);
    removeItem(id);
  };

  const handleClearAll = () => {
    compression.clearJobs();
    clearAll();
  };

  return (
    <div class="image-workbench">
      <ImageDropZone
        onFiles={addFiles}
        formatsHint="JPEG・HEIC・WebP・PNG"
        messages={messages.dropZone}
      />
      <p class="compress-workbench__format-note">{messages.fixedTargetWorkbench.formatNote}</p>
      <PrivacyNotice text={dictionary.privacyNotice} />
      {!compression.isSupported && (
        <p class="compress-workbench__unsupported">
          {messages.compressionWorkbench.unsupportedBrowser}
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
              <FixedTargetCompressionListItem
                key={item.id}
                item={item}
                target={target}
                onRemove={handleRemove}
                compression={compression}
                messages={messages}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

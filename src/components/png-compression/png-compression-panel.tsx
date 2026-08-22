import { CompressTargetInput } from "../image-intake/compress-target-input";
import { formatBytes } from "../image-intake/format-bytes";
import { ImagePreviewAndSave } from "../image-intake/image-preview-and-save";
import { trackToolEvent } from "../../analytics/tool-events";
import { useTrackProcessingOutcome } from "../../analytics/use-track-processing-outcome";
import type { CompressionTarget } from "../image-intake/compression-types";
import type {
  PngCompressionJob,
  PngCompressionUiResult,
  PngCompressionUnreachableUiResult,
} from "./png-compression-ui-types";
import type { UiDictionary } from "../../i18n/schema";

function reductionPercent(originalBytes: number, outputBytes: number): number {
  return originalBytes > 0 ? Math.round((1 - outputBytes / originalBytes) * 100) : 0;
}

/**
 * done結果の表示。/compress-pngの通常パネルと、固定容量ページ(20/50/100/200/500KB)の
 * 固定targetパネル(FixedTargetCompressionWorkbench)の両方から再利用するためexportする。
 */
export function PngCompressionDoneView({
  fileName,
  result,
  messages,
}: {
  fileName: string;
  result: PngCompressionUiResult;
  messages: UiDictionary;
}) {
  const dimensionsChanged =
    result.originalWidth !== result.outputWidth || result.originalHeight !== result.outputHeight;
  const r = messages.pngCompression.result;

  if (result.originalReturned) {
    return (
      <div class="png-compression-result png-compression-result--success">
        <p class="png-compression-result__summary">{r.alreadyUnderTarget}</p>
        <p class="png-compression-result__note">{r.reuseOriginal}</p>
        <ul class="png-compression-result__stats">
          <li>
            {r.originalLabel}
            {formatBytes(result.originalBytes)}
          </li>
          <li>
            {r.outputBytesLabel}
            {formatBytes(result.outputBytes)}
            {r.outputSameAsOriginalSuffix}
          </li>
          <li>
            {r.dimensionsLabel}
            {result.originalWidth}×{result.originalHeight}px
          </li>
        </ul>
        <ImagePreviewAndSave
          fileName={fileName}
          objectUrl={result.objectUrl}
          blob={result.blob}
          outputFileName={result.outputFileName}
          width={result.outputWidth}
          height={result.outputHeight}
          formatLabel="PNG"
          messages={messages.previewAndSave}
        />
      </div>
    );
  }

  return (
    <div class="png-compression-result png-compression-result--success">
      <p class="png-compression-result__summary">{r.completed}</p>
      <ul class="png-compression-result__stats">
        <li>
          {r.originalFileNameLabel}
          {fileName}
        </li>
        <li>
          {r.originalLabel}
          {formatBytes(result.originalBytes)}
        </li>
        <li>
          {r.outputBytesLabel}
          {formatBytes(result.outputBytes)}
        </li>
        <li>
          {r.reductionLabel}
          {reductionPercent(result.originalBytes, result.outputBytes)}%
        </li>
        <li>
          {r.originalDimensionsLabel}
          {result.originalWidth}×{result.originalHeight}px
        </li>
        <li>
          {r.outputDimensionsLabel}
          {result.outputWidth}×{result.outputHeight}px
          {dimensionsChanged && (
            <span class="png-compression-result__resized-note">
              {r.resizedNote(
                result.originalWidth,
                result.originalHeight,
                result.outputWidth,
                result.outputHeight,
              )}
            </span>
          )}
        </li>
      </ul>
      {result.colorCount !== null && (
        <details class="png-compression-result__details">
          <summary>{r.details}</summary>
          <ul class="png-compression-result__stats">
            <li>{r.colorCount(result.colorCount)}</li>
            <li>
              {r.encodeAttemptsLabel}
              {result.encodeCount}
            </li>
          </ul>
        </details>
      )}
      <ImagePreviewAndSave
        fileName={fileName}
        objectUrl={result.objectUrl}
        blob={result.blob}
        outputFileName={result.outputFileName}
        width={result.outputWidth}
        height={result.outputHeight}
        formatLabel="PNG"
        messages={messages.previewAndSave}
      />
    </div>
  );
}

/**
 * unreachable結果の表示。PngCompressionDoneViewと同じ理由でexportする。
 */
export function PngCompressionUnreachableView({
  fileName,
  result,
  messages,
}: {
  fileName: string;
  result: PngCompressionUnreachableUiResult;
  messages: UiDictionary;
}) {
  const best = result.bestCandidate;
  const overBy = best ? best.outputBytes - result.targetBytes : null;
  const r = messages.pngCompression.result;

  return (
    <div class="png-compression-result png-compression-result--unreachable" role="status">
      <p class="png-compression-result__summary png-compression-result__summary--unreachable">
        {r.unreachable}
      </p>
      <ul class="png-compression-result__stats">
        <li>
          {r.targetLabel}
          {formatBytes(result.targetBytes)}
        </li>
        {best && (
          <>
            <li>
              {r.bestCandidateBytesLabel}
              {formatBytes(best.outputBytes)}
            </li>
            <li>
              {r.outputDimensionsLabel}
              {best.outputWidth}×{best.outputHeight}px
            </li>
          </>
        )}
        <li>
          {r.originalDimensionsLabel}
          {result.originalWidth}×{result.originalHeight}px
        </li>
        {overBy !== null && overBy > 0 && <li>{r.overByTarget(formatBytes(overBy))}</li>}
      </ul>

      {best ? (
        <>
          <p class="png-compression-result__over-target-note">
            {r.overTargetNote(formatBytes(result.targetBytes))}
          </p>
          <ImagePreviewAndSave
            fileName={fileName}
            objectUrl={best.objectUrl}
            blob={best.blob}
            outputFileName={best.outputFileName}
            width={best.outputWidth}
            height={best.outputHeight}
            formatLabel="PNG"
            messages={messages.previewAndSave}
          />
        </>
      ) : (
        <p class="png-compression-result__note">{r.noCandidateNote}</p>
      )}

      <p class="png-compression-result__webp-hint">
        {r.webpHintPrefix}
        <a href="/png-to-webp">{r.webpHintLinkLabel}</a>
        {r.webpHintSuffix}
      </p>
    </div>
  );
}

export interface PngCompressionPanelProps {
  fileName: string;
  job: PngCompressionJob | undefined;
  onCompress: (target: CompressionTarget) => void;
  onCancel: () => void;
  onTargetChange: () => void;
  messages: UiDictionary;
}

/**
 * 1アイテム分のPNG指定容量圧縮UI。既存のCompressPanel(image-intake/compress-panel.tsx)と
 * 同じ構成方針を踏襲する: 目標容量入力は常に表示したまま、処理中はdisabledにして
 * (target変更後の古い結果の再利用を構造上防ぐ)、成功/未達/失敗をそれぞれ個別に表示する。
 * done/unreachableの結果表示後に目標容量が変更された場合はonTargetChange経由でフック側が
 * needs-reprocessへ遷移させ、古い結果を新しい目標の結果であるかのように見せ続けない。
 */
export function PngCompressionPanel({
  fileName,
  job,
  onCompress,
  onCancel,
  onTargetChange,
  messages,
}: PngCompressionPanelProps) {
  const isProcessing = job?.status.kind === "queued" || job?.status.kind === "processing";
  const panelMessages = messages.pngCompression.panel;
  useTrackProcessingOutcome(job?.status);

  const handleCompress = (target: CompressionTarget) => {
    trackToolEvent({ name: "process_start" });
    onCompress(target);
  };

  return (
    <div class="png-compression-panel">
      <CompressTargetInput
        disabled={isProcessing}
        onCompress={handleCompress}
        onTargetChange={onTargetChange}
        messages={messages.compressionPanel}
      />

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

      {job?.status.kind === "needs-reprocess" && (
        <p class="png-compression-panel__status" role="status">
          {panelMessages.needsReprocess}
        </p>
      )}
    </div>
  );
}

import { formatBytes } from "./format-bytes";
import { CompressTargetInput } from "./compress-target-input";
import { ImagePreviewAndSave } from "./image-preview-and-save";
import { trackToolEvent } from "../../analytics/tool-events";
import { useTrackProcessingOutcome } from "../../analytics/use-track-processing-outcome";
import type {
  CompressionJob,
  CompressionOutputFormat,
  CompressionResult,
  CompressionTarget,
  SizeUnit,
} from "./compression-types";
import type { UiDictionary } from "../../i18n/schema";

const OUTPUT_FORMAT_LABEL: Record<CompressionOutputFormat, "JPG" | "WebP"> = {
  jpeg: "JPG",
  webp: "WebP",
};

type CompressionPanelMessages = UiDictionary["compressionPanel"];

function CompressResultView({
  fileName,
  result,
  messages,
  previewAndSave,
}: {
  fileName: string;
  result: CompressionResult;
  messages: CompressionPanelMessages;
  previewAndSave: UiDictionary["previewAndSave"];
}) {
  const reductionPercent =
    result.originalBytes > 0
      ? Math.round((1 - result.outputBytes / result.originalBytes) * 100)
      : 0;
  const formatLabel = OUTPUT_FORMAT_LABEL[result.outputFormat];

  return (
    <div class="compress-result">
      <p class="compress-result__summary">
        {result.unchanged ? messages.alreadyUnderTarget : messages.completed}
      </p>
      <ul class="compress-result__stats">
        <li>
          {messages.stats.original}
          {formatBytes(result.originalBytes)}
        </li>
        <li>
          {messages.stats.compressed}
          {formatBytes(result.outputBytes)}
        </li>
        <li>
          {messages.stats.target}
          {formatBytes(result.targetBytes)}
        </li>
        <li>
          {messages.stats.originalDimensions}
          {result.originalWidth}×{result.originalHeight}px
        </li>
        <li>
          {messages.stats.compressedDimensions}
          {result.outputWidth}×{result.outputHeight}px
        </li>
        <li>
          {messages.stats.reduction}
          {reductionPercent}%
        </li>
        <li>
          {messages.stats.outputFormat}
          {formatLabel}
        </li>
        {!result.unchanged && (
          <>
            <li>
              {messages.stats.encodeCount}
              {result.encodeCount}
            </li>
            <li>
              {messages.stats.resizeCount}
              {result.resizeCount}
            </li>
            <li>
              {messages.stats.elapsed}
              {(result.elapsedMs / 1000).toFixed(1)}
              {messages.stats.secondsSuffix}
            </li>
          </>
        )}
      </ul>
      <ImagePreviewAndSave
        fileName={fileName}
        objectUrl={result.objectUrl}
        blob={result.blob}
        outputFileName={result.outputFileName}
        width={result.outputWidth}
        height={result.outputHeight}
        formatLabel={formatLabel}
        messages={previewAndSave}
      />
    </div>
  );
}

export interface CompressPanelProps {
  fileName: string;
  job: CompressionJob | undefined;
  defaultTargetValue?: number;
  defaultTargetUnit?: SizeUnit;
  onCompress: (target: CompressionTarget) => void;
  onCancel: () => void;
  messages: UiDictionary;
  /**
   * 指定した場合、目標容量入力(CompressTargetInput、数値+単位+プリセット)は一切表示せず、
   * 「圧縮する」ボタンのみを表示して押下時に常にこのtargetでonCompressを呼ぶ。
   * /compress-image-to-500kbのように、利用者が変更できるように見えるUIを一切残さず
   * 全形式で固定容量(500,000 bytes)を強制したいページで使う。
   * 未指定時(既存呼び出し)は従来どおりCompressTargetInputを表示し、挙動を一切変えない。
   */
  fixedTarget?: CompressionTarget;
}

/**
 * 1アイテム分の圧縮UI(目標容量入力+圧縮ボタン、圧縮待ち/圧縮中/成功/失敗の各状態表示)。
 * 目標容量入力は常に表示したままにし、失敗後もその場で目標値を変更して再実行できるようにする。
 * fixedTargetを指定した場合は目標容量入力自体を表示しない(下記コンポーネント冒頭を参照)。
 */
export function CompressPanel({
  fileName,
  job,
  defaultTargetValue,
  defaultTargetUnit,
  onCompress,
  onCancel,
  messages,
  fixedTarget,
}: CompressPanelProps) {
  const isProcessing = job?.status.kind === "queued" || job?.status.kind === "processing";
  const panelMessages = messages.compressionPanel;
  useTrackProcessingOutcome(job?.status);

  const handleCompress = (target: CompressionTarget) => {
    trackToolEvent({ name: "process_start" });
    onCompress(target);
  };

  return (
    <div class="compress-panel">
      {fixedTarget ? (
        <button
          type="button"
          class="btn-primary compress-target__submit"
          disabled={isProcessing}
          onClick={() => handleCompress(fixedTarget)}
        >
          {panelMessages.compress}
        </button>
      ) : (
        <CompressTargetInput
          defaultValue={defaultTargetValue}
          defaultUnit={defaultTargetUnit}
          disabled={isProcessing}
          onCompress={handleCompress}
          messages={panelMessages}
        />
      )}

      {job?.status.kind === "queued" && (
        <p class="compress-panel__status" role="status">
          {panelMessages.queued}
        </p>
      )}

      {job?.status.kind === "processing" && (
        <div class="compress-panel__processing">
          <p class="compress-panel__status" role="status">
            {panelMessages.phaseLabel[job.status.progress.phase]}
            {job.status.progress.attempt > 0 &&
              panelMessages.attemptSuffix(
                job.status.progress.attempt,
                job.status.progress.maxAttempts,
              )}
          </p>
          <button type="button" class="btn-secondary compress-panel__cancel" onClick={onCancel}>
            {messages.common.cancel}
          </button>
        </div>
      )}

      {job?.status.kind === "done" && (
        <CompressResultView
          fileName={fileName}
          result={job.status.result}
          messages={panelMessages}
          previewAndSave={messages.previewAndSave}
        />
      )}

      {job?.status.kind === "error" && (
        <p class="compress-panel__status compress-panel__status--error" role="alert">
          {job.status.reason === "encode-failed" || job.status.reason === "decode-failed"
            ? panelMessages.errors[job.status.reason]
            : job.status.message}
        </p>
      )}

      {job?.status.kind === "cancelled" && (
        <p class="compress-panel__status" role="status">
          {messages.common.cancelled}
        </p>
      )}
    </div>
  );
}

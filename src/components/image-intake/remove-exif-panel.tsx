import { formatBytes } from "./format-bytes";
import { ImagePreviewAndSave } from "./image-preview-and-save";
import { trackToolEvent } from "../../analytics/tool-events";
import { useTrackProcessingOutcome } from "../../analytics/use-track-processing-outcome";
import type { RemoveMetadataJob, RemoveMetadataResult } from "./remove-exif-types";
import type { UiDictionary } from "../../i18n/schema";

type MetadataRemovalMessages = UiDictionary["metadataRemoval"];

function RemoveMetadataResultView({
  fileName,
  result,
  messages,
  previewAndSave,
}: {
  fileName: string;
  result: RemoveMetadataResult;
  messages: MetadataRemovalMessages;
  previewAndSave: UiDictionary["previewAndSave"];
}) {
  const reductionPercent =
    result.originalBytes > 0
      ? Math.round((1 - result.outputBytes / result.originalBytes) * 100)
      : 0;
  const r = messages.result;

  return (
    <div class="remove-exif-result">
      <p class="remove-exif-result__summary">{r.completed}</p>
      <p class="remove-exif-result__notice">{r.baseNotice}</p>
      {result.orientationKept && <p class="remove-exif-result__notice">{r.orientationNotice}</p>}
      {result.iccKept && <p class="remove-exif-result__notice">{r.iccNotice}</p>}
      <ul class="remove-exif-result__stats">
        <li>
          {r.originalBytesLabel}
          {formatBytes(result.originalBytes)}
        </li>
        <li>
          {r.outputBytesLabel}
          {formatBytes(result.outputBytes)}
        </li>
        <li>
          {r.originalDimensionsLabel}
          {result.originalWidth}×{result.originalHeight}px
        </li>
        <li>
          {r.outputDimensionsLabel}
          {result.outputWidth}×{result.outputHeight}px
        </li>
        <li>
          {r.reencodeLabel}
          {r.reencodeNone}
        </li>
        <li>{r.outputFormatLabel}</li>
        <li>
          {r.reductionLabel}
          {reductionPercent}%
        </li>
        <li>
          {r.orientationLabel}
          {result.orientationKept ? r.orientationKept : r.orientationRemoved}
        </li>
        <li>
          {r.colorProfileLabel}
          {result.iccKept ? r.colorProfileKept : r.colorProfileRemoved}
        </li>
        <li>
          {r.elapsedLabel}
          {Math.round(result.elapsedMs)}
          {r.msSuffix}
        </li>
      </ul>
      <ImagePreviewAndSave
        fileName={fileName}
        objectUrl={result.objectUrl}
        blob={result.blob}
        outputFileName={result.outputFileName}
        width={result.outputWidth}
        height={result.outputHeight}
        formatLabel="JPG"
        messages={previewAndSave}
      />
    </div>
  );
}

export interface RemoveExifPanelProps {
  fileName: string;
  job: RemoveMetadataJob | undefined;
  onStart: () => void;
  onCancel: () => void;
  messages: UiDictionary;
}

/**
 * 1アイテム分のメタデータ削除UI(削除開始ボタン、待機/処理中/成功/失敗/キャンセルの各状態表示)。
 * 目標値の入力を持たないためcompress-panel.tsxより単純だが、状態遷移パターンは踏襲する。
 */
export function RemoveExifPanel({
  fileName,
  job,
  onStart,
  onCancel,
  messages,
}: RemoveExifPanelProps) {
  const isProcessing = job?.status.kind === "queued" || job?.status.kind === "processing";
  const panelMessages = messages.metadataRemoval;
  useTrackProcessingOutcome(job?.status);

  const handleStart = () => {
    trackToolEvent({ name: "process_start" });
    onStart();
  };

  return (
    <div class="remove-exif-panel">
      <button
        type="button"
        class="btn-primary remove-exif-panel__start"
        onClick={handleStart}
        disabled={isProcessing}
      >
        {job?.status.kind === "done" ? panelMessages.panel.retry : panelMessages.panel.start}
      </button>

      {job?.status.kind === "queued" && (
        <p class="remove-exif-panel__status" role="status">
          {panelMessages.panel.queued}
        </p>
      )}

      {job?.status.kind === "processing" && (
        <div class="remove-exif-panel__processing">
          <p class="remove-exif-panel__status" role="status">
            {panelMessages.panel.removing}
          </p>
          <button type="button" class="btn-secondary remove-exif-panel__cancel" onClick={onCancel}>
            {messages.common.cancel}
          </button>
        </div>
      )}

      {job?.status.kind === "done" && (
        <RemoveMetadataResultView
          fileName={fileName}
          result={job.status.result}
          messages={panelMessages}
          previewAndSave={messages.previewAndSave}
        />
      )}

      {job?.status.kind === "error" && (
        <p class="remove-exif-panel__status remove-exif-panel__status--error" role="alert">
          {panelMessages.panel.errors[job.status.code]}
        </p>
      )}

      {job?.status.kind === "cancelled" && (
        <p class="remove-exif-panel__status" role="status">
          {messages.common.cancelled}
        </p>
      )}
    </div>
  );
}

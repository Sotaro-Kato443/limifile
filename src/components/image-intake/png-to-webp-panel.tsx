import { useId, useState } from "preact/hooks";
import { formatBytes } from "./format-bytes";
import { ImagePreviewAndSave } from "./image-preview-and-save";
import { trackToolEvent } from "../../analytics/tool-events";
import { useTrackProcessingOutcome } from "../../analytics/use-track-processing-outcome";
import {
  DEFAULT_PNG_TO_WEBP_QUALITY_PRESET,
  PNG_TO_WEBP_QUALITY_OPTIONS,
} from "./png-to-webp-types";
import type { PngToWebpJob, PngToWebpQualityPreset, PngToWebpResult } from "./png-to-webp-types";
import type { UiDictionary } from "../../i18n/schema";

type PngToWebpMessages = UiDictionary["pngToWebp"];

function PngToWebpResultView({
  fileName,
  result,
  messages,
  previewAndSave,
}: {
  fileName: string;
  result: PngToWebpResult;
  messages: PngToWebpMessages;
  previewAndSave: UiDictionary["previewAndSave"];
}) {
  const reductionPercent =
    result.originalBytes > 0
      ? Math.round((1 - result.outputBytes / result.originalBytes) * 100)
      : 0;
  const r = messages.result;

  return (
    <div class="png-to-webp-result">
      <p class="png-to-webp-result__summary">{r.completed}</p>
      <ul class="png-to-webp-result__stats">
        <li>
          {r.originalBytesLabel}
          {formatBytes(result.originalBytes)}
        </li>
        <li>
          {r.outputBytesLabel}
          {formatBytes(result.outputBytes)}
        </li>
        <li>
          {r.reductionLabel}
          {reductionPercent}%
        </li>
        <li>
          {r.originalDimensionsLabel}
          {result.originalWidth}×{result.originalHeight}px
        </li>
        <li>
          {r.outputDimensionsLabel}
          {result.outputWidth}×{result.outputHeight}px
        </li>
        <li>{r.outputFormatLabel}</li>
        <li>
          {r.qualitySettingLabel}
          {messages.panel.qualityLabel[result.qualityPreset]}
        </li>
        <li>
          {r.elapsedLabel}
          {(result.elapsedMs / 1000).toFixed(1)}
          {r.secondsSuffix}
        </li>
      </ul>
      <ImagePreviewAndSave
        fileName={fileName}
        objectUrl={result.objectUrl}
        blob={result.blob}
        outputFileName={result.outputFileName}
        width={result.outputWidth}
        height={result.outputHeight}
        formatLabel="WebP"
        messages={previewAndSave}
      />
    </div>
  );
}

export interface PngToWebpPanelProps {
  fileName: string;
  job: PngToWebpJob | undefined;
  onConvert: (preset: PngToWebpQualityPreset) => void;
  onCancel: () => void;
  messages: UiDictionary;
}

/**
 * 1アイテム分のPNG→WebP変換UI(画質3段階選択+変換開始ボタン、待機/処理中/成功/失敗の各状態表示)。
 * 目標容量探索を行わないため、compress-panel.tsxより単純(quality固定値の選択のみ)。
 * 画質選択はこのコンポーネントがローカルに保持し(compress-target-input.tsxと同じ設計)、
 * 変換開始時にonConvertへ選択中のpresetを渡す。選択を変えて再度変換開始することもできる。
 */
export function PngToWebpPanel({
  fileName,
  job,
  onConvert,
  onCancel,
  messages,
}: PngToWebpPanelProps) {
  const [preset, setPreset] = useState<PngToWebpQualityPreset>(DEFAULT_PNG_TO_WEBP_QUALITY_PRESET);
  const groupId = useId();
  const isProcessing = job?.status.kind === "queued" || job?.status.kind === "processing";
  const panelMessages = messages.pngToWebp;
  useTrackProcessingOutcome(job?.status);

  const handleConvert = () => {
    trackToolEvent({ name: "process_start" });
    onConvert(preset);
  };

  return (
    <div class="png-to-webp-panel">
      <fieldset class="png-to-webp-panel__quality" disabled={isProcessing}>
        <legend class="png-to-webp-panel__quality-legend">
          {panelMessages.panel.qualityLegend}
        </legend>
        {PNG_TO_WEBP_QUALITY_OPTIONS.map((option) => (
          <label key={option.preset} class="png-to-webp-panel__quality-option">
            <input
              type="radio"
              name={`png-to-webp-quality-${groupId}`}
              checked={preset === option.preset}
              disabled={isProcessing}
              onChange={() => setPreset(option.preset)}
            />
            <span class="png-to-webp-panel__quality-label">
              {panelMessages.panel.qualityLabel[option.preset]}
            </span>
            <span class="png-to-webp-panel__quality-description">
              {panelMessages.panel.qualityDescription[option.preset]}
            </span>
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        class="btn-primary png-to-webp-panel__start"
        onClick={handleConvert}
        disabled={isProcessing}
      >
        {job?.status.kind === "done" ? panelMessages.panel.reconvert : panelMessages.panel.convert}
      </button>

      {job?.status.kind === "queued" && (
        <p class="png-to-webp-panel__status" role="status">
          {panelMessages.panel.queued}
        </p>
      )}

      {job?.status.kind === "processing" && (
        <div class="png-to-webp-panel__processing">
          <p class="png-to-webp-panel__status" role="status">
            {panelMessages.panel.converting}
          </p>
          <button type="button" class="btn-secondary png-to-webp-panel__cancel" onClick={onCancel}>
            {messages.common.cancel}
          </button>
        </div>
      )}

      {job?.status.kind === "done" && (
        <PngToWebpResultView
          fileName={fileName}
          result={job.status.result}
          messages={panelMessages}
          previewAndSave={messages.previewAndSave}
        />
      )}

      {job?.status.kind === "error" && (
        <p class="png-to-webp-panel__status png-to-webp-panel__status--error" role="alert">
          {job.status.reason === "encode-failed"
            ? panelMessages.panel.errors[job.status.reason]
            : job.status.message}
        </p>
      )}

      {job?.status.kind === "cancelled" && (
        <p class="png-to-webp-panel__status" role="status">
          {messages.common.cancelled}
        </p>
      )}
    </div>
  );
}

import { useId, useState } from "preact/hooks";
import { formatBytes } from "./format-bytes";
import { ImagePreviewAndSave } from "./image-preview-and-save";
import { trackToolEvent } from "../../analytics/tool-events";
import { useTrackProcessingOutcome } from "../../analytics/use-track-processing-outcome";
import {
  DEFAULT_RASTER_BACKGROUND,
  DEFAULT_RASTER_QUALITY_PRESET,
  RASTER_QUALITY_OPTIONS,
  backgroundColorToHex,
  computeSizeChange,
  hexToBackgroundColor,
} from "./raster-convert-types";
import type {
  RasterBackgroundColor,
  RasterQualityPreset,
  RasterToJpgJob,
  RasterToJpgResult,
} from "./raster-convert-types";
import type { TargetedEvent } from "preact";
import type { UiDictionary } from "../../i18n/schema";

type RasterToJpgMessages = UiDictionary["rasterToJpg"];

function RasterToJpgResultView({
  fileName,
  result,
  messages,
  previewAndSave,
}: {
  fileName: string;
  result: RasterToJpgResult;
  messages: RasterToJpgMessages;
  previewAndSave: UiDictionary["previewAndSave"];
}) {
  const sizeChange = computeSizeChange(result.originalBytes, result.outputBytes);
  const r = messages.result;

  return (
    <div class="raster-to-jpg-result">
      <p class="raster-to-jpg-result__summary">{r.completed}</p>
      <ul class="raster-to-jpg-result__stats">
        <li>
          {r.originalBytesLabel}
          {formatBytes(result.originalBytes)}
        </li>
        <li>
          {r.outputBytesLabel}
          {formatBytes(result.outputBytes)}
        </li>
        <li>{r.sizeChangeLabel(sizeChange.direction, sizeChange.percent)}</li>
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
          {r.backgroundColorLabel}
          {backgroundColorToHex(result.background)}
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
        formatLabel="JPG"
        messages={previewAndSave}
      />
    </div>
  );
}

export interface RasterToJpgPanelProps {
  fileName: string;
  job: RasterToJpgJob | undefined;
  onConvert: (preset: RasterQualityPreset, background: RasterBackgroundColor) => void;
  onCancel: () => void;
  messages: UiDictionary;
}

/**
 * 1アイテム分のPNG/WebP→JPG変換UI(画質3段階選択+背景色選択+変換開始ボタン、
 * 待機/処理中/成功/失敗の各状態表示)。png-to-webp-panel.tsxと同じ構造に、JPEG化に伴う
 * 背景色選択(既定white、透明部分の塗りつぶし色)を追加している。PNG→JPG・WebP→JPGの両ページから
 * 共有するため、PNG/WebPどちらの文言かはmessages.rasterToJpg側(呼び出し元で解決済み)に委ねる。
 */
export function RasterToJpgPanel({
  fileName,
  job,
  onConvert,
  onCancel,
  messages,
}: RasterToJpgPanelProps) {
  const [preset, setPreset] = useState<RasterQualityPreset>(DEFAULT_RASTER_QUALITY_PRESET);
  const [background, setBackground] = useState<RasterBackgroundColor>(DEFAULT_RASTER_BACKGROUND);
  const groupId = useId();
  const isProcessing = job?.status.kind === "queued" || job?.status.kind === "processing";
  const panelMessages = messages.rasterToJpg;
  useTrackProcessingOutcome(job?.status);

  const handleBackgroundInput = (event: TargetedEvent<HTMLInputElement>) => {
    const parsed = hexToBackgroundColor((event.target as HTMLInputElement).value);
    if (parsed) setBackground(parsed);
  };

  const handleConvert = () => {
    trackToolEvent({ name: "process_start" });
    onConvert(preset, background);
  };

  return (
    <div class="raster-to-jpg-panel">
      <fieldset class="raster-to-jpg-panel__quality" disabled={isProcessing}>
        <legend class="raster-to-jpg-panel__quality-legend">
          {panelMessages.panel.qualityLegend}
        </legend>
        {RASTER_QUALITY_OPTIONS.map((option) => (
          <label key={option.preset} class="raster-to-jpg-panel__quality-option">
            <input
              type="radio"
              name={`raster-to-jpg-quality-${groupId}`}
              checked={preset === option.preset}
              disabled={isProcessing}
              onChange={() => setPreset(option.preset)}
            />
            <span class="raster-to-jpg-panel__quality-label">
              {panelMessages.panel.qualityLabel[option.preset]}
            </span>
            <span class="raster-to-jpg-panel__quality-description">
              {panelMessages.panel.qualityDescription[option.preset]}
            </span>
          </label>
        ))}
      </fieldset>

      <div class="raster-to-jpg-panel__background">
        <label
          class="raster-to-jpg-panel__background-label"
          for={`raster-to-jpg-background-${groupId}`}
        >
          {panelMessages.panel.backgroundLabel}
        </label>
        <input
          id={`raster-to-jpg-background-${groupId}`}
          class="raster-to-jpg-panel__background-input"
          type="color"
          value={backgroundColorToHex(background)}
          disabled={isProcessing}
          aria-label={panelMessages.panel.backgroundPickerAriaLabel}
          onInput={handleBackgroundInput}
        />
        <p class="raster-to-jpg-panel__background-note">{panelMessages.backgroundNote}</p>
      </div>

      <button
        type="button"
        class="btn-primary raster-to-jpg-panel__start"
        onClick={handleConvert}
        disabled={isProcessing}
      >
        {job?.status.kind === "done" ? panelMessages.panel.reconvert : panelMessages.panel.convert}
      </button>

      {job?.status.kind === "queued" && (
        <p class="raster-to-jpg-panel__status" role="status">
          {panelMessages.panel.queued}
        </p>
      )}

      {job?.status.kind === "processing" && (
        <div class="raster-to-jpg-panel__processing">
          <p class="raster-to-jpg-panel__status" role="status">
            {panelMessages.panel.converting}
          </p>
          <button
            type="button"
            class="btn-secondary raster-to-jpg-panel__cancel"
            onClick={onCancel}
          >
            {messages.common.cancel}
          </button>
        </div>
      )}

      {job?.status.kind === "done" && (
        <RasterToJpgResultView
          fileName={fileName}
          result={job.status.result}
          messages={panelMessages}
          previewAndSave={messages.previewAndSave}
        />
      )}

      {job?.status.kind === "error" && (
        <p class="raster-to-jpg-panel__status raster-to-jpg-panel__status--error" role="alert">
          {job.status.reason === "encode-failed"
            ? panelMessages.panel.errors[job.status.reason]
            : job.status.message}
        </p>
      )}

      {job?.status.kind === "cancelled" && (
        <p class="raster-to-jpg-panel__status" role="status">
          {messages.common.cancelled}
        </p>
      )}
    </div>
  );
}

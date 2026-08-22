import { useId, useState } from "preact/hooks";
import { formatBytes } from "./format-bytes";
import { ImagePreviewAndSave } from "./image-preview-and-save";
import { trackToolEvent } from "../../analytics/tool-events";
import { useTrackProcessingOutcome } from "../../analytics/use-track-processing-outcome";
import { DEFAULT_RASTER_BACKGROUND } from "./raster-convert-types";
import type { FitMode, TargetFitJob, TargetFitRequest, TargetFitResult } from "./target-fit-types";
import type { TargetedEvent } from "preact";
import type { UiDictionary } from "../../i18n/schema";

type SignatureResizerMessages = UiDictionary["signatureResizer"];

const BYTES_PER_KB = 1000;
/** UI入力の技術的上限(業務要件ではなく、意図しない巨大値の入力を防ぐための安全弁) */
const MAX_DIMENSION_INPUT_PX = 8000;
const MAX_SIZE_INPUT_KB = 50 * 1024; // 50MB相当

type NumericInputError = "empty" | "invalid-number" | "not-positive" | "too-large" | "too-small";

function parsePositiveIntegerPx(
  raw: string,
): { ok: true; value: number } | { ok: false; error: NumericInputError } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: "empty" };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value))
    return { ok: false, error: "invalid-number" };
  if (value <= 0) return { ok: false, error: "not-positive" };
  if (value > MAX_DIMENSION_INPUT_PX) return { ok: false, error: "too-large" };
  return { ok: true, value };
}

/**
 * 最大ファイルサイズ(KB)の入力を検証しバイト値へ変換する。compression-target.tsの
 * validateTargetSizeと異なり、人工的な下限(MIN_TARGET_BYTES)を設けない
 * (レビューで明示された方針: 特定提出先の要件ではない下限を作らない。positive valueのみ要求する)。
 *
 * ただしファイルサイズは整数byteでしか表現できないため、"0.0001"のような値は
 * Math.round(value * 1000) === 0 となり、この関数の検証自体は通過しても後段のWorkerが
 * invalid-request(maxBytes<=0)として拒否してしまう。これは業務要件の下限ではなく
 * byte表現上の技術的下限のため、UI側で明示的に弾く(レビューで指摘)。
 */
function parseMaxSizeKb(
  raw: string,
): { ok: true; bytes: number } | { ok: false; error: NumericInputError } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: "empty" };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, error: "invalid-number" };
  if (value <= 0) return { ok: false, error: "not-positive" };
  if (value > MAX_SIZE_INPUT_KB) return { ok: false, error: "too-large" };
  const bytes = Math.round(value * BYTES_PER_KB);
  if (bytes < 1) return { ok: false, error: "too-small" };
  return { ok: true, bytes };
}

function ConditionRow({
  ok,
  label,
  messages,
}: {
  ok: boolean;
  label: string;
  messages: SignatureResizerMessages;
}) {
  return (
    <li
      class={
        ok
          ? "signature-resizer-checklist__item signature-resizer-checklist__item--ok"
          : "signature-resizer-checklist__item signature-resizer-checklist__item--fail"
      }
    >
      <span class="signature-resizer-checklist__badge" aria-hidden="true">
        {ok ? "✓" : "✗"}
      </span>
      <span class="signature-resizer-checklist__label">{label}</span>
      <span class="signature-resizer-checklist__status">
        {ok ? messages.result.conditionOkBadge : messages.result.conditionFailBadge}
      </span>
    </li>
  );
}

function SignatureResizerResultView({
  fileName,
  result,
  isUnreachable,
  messages,
  previewAndSave,
}: {
  fileName: string;
  result: TargetFitResult;
  isUnreachable: boolean;
  messages: SignatureResizerMessages;
  previewAndSave: UiDictionary["previewAndSave"];
}) {
  const r = messages.result;
  const c = result.checklist;

  return (
    <div class="signature-resizer-result">
      <p
        class={
          isUnreachable
            ? "signature-resizer-result__summary signature-resizer-result__summary--partial"
            : "signature-resizer-result__summary"
        }
      >
        {isUnreachable ? r.unreachable : r.completed}
      </p>
      {isUnreachable && (
        <p class="signature-resizer-result__note" role="alert">
          {r.unreachableNote}
        </p>
      )}
      {result.upscaled && <p class="signature-resizer-result__note">{r.upscaledWarning}</p>}

      <p class="signature-resizer-checklist__heading">{r.checklistHeading}</p>
      <ul class="signature-resizer-checklist">
        <ConditionRow
          ok={c.width.ok}
          label={r.widthConditionLabel(c.width.actual, c.width.target)}
          messages={messages}
        />
        <ConditionRow
          ok={c.height.ok}
          label={r.heightConditionLabel(c.height.actual, c.height.target)}
          messages={messages}
        />
        <ConditionRow
          ok={c.size.ok}
          label={r.sizeConditionLabel(
            formatBytes(c.size.actualBytes),
            formatBytes(c.size.maxBytes),
          )}
          messages={messages}
        />
        <ConditionRow
          ok={c.format.ok}
          label={r.formatConditionLabel(c.format.actual)}
          messages={messages}
        />
      </ul>

      <ul class="signature-resizer-result__stats">
        <li>{r.outputFormatLabel}</li>
        <li>
          {r.qualityLabel}
          {result.quality.toFixed(2)}
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

export interface SignatureResizerPanelProps {
  fileName: string;
  job: TargetFitJob | undefined;
  onConvert: (request: TargetFitRequest) => void;
  onCancel: () => void;
  messages: UiDictionary;
}

/**
 * 1アイテム分のSignature Resizer変換UI(幅・高さ・最大ファイルサイズ入力+fit mode選択+
 * 変換開始ボタン、待機/処理中/成功/条件未達/失敗の各状態表示)。raster-to-jpg-panel.tsxと
 * 同じ構造を踏襲しつつ、quality3段階選択の代わりに数値入力3件+fit mode2択を持つ。
 * 背景色はv1では白固定でUIに選択肢を出さない(レビューで合意済み)。
 */
export function SignatureResizerPanel({
  fileName,
  job,
  onConvert,
  onCancel,
  messages,
}: SignatureResizerPanelProps) {
  const [widthInput, setWidthInput] = useState("");
  const [heightInput, setHeightInput] = useState("");
  const [maxSizeInput, setMaxSizeInput] = useState("");
  const [fitMode, setFitMode] = useState<FitMode>("contain");
  const [validationError, setValidationError] = useState<NumericInputError | null>(null);
  const groupId = useId();
  const isProcessing = job?.status.kind === "queued" || job?.status.kind === "processing";
  const panelMessages = messages.signatureResizer;
  useTrackProcessingOutcome(job?.status);

  const handleSubmit = () => {
    const width = parsePositiveIntegerPx(widthInput);
    if (!width.ok) {
      setValidationError(width.error);
      return;
    }
    const height = parsePositiveIntegerPx(heightInput);
    if (!height.ok) {
      setValidationError(height.error);
      return;
    }
    const maxSize = parseMaxSizeKb(maxSizeInput);
    if (!maxSize.ok) {
      setValidationError(maxSize.error);
      return;
    }
    setValidationError(null);
    trackToolEvent({ name: "process_start" });
    onConvert({
      targetWidth: width.value,
      targetHeight: height.value,
      maxBytes: maxSize.bytes,
      fitMode,
      background: DEFAULT_RASTER_BACKGROUND,
    });
  };

  const handleNumberInput =
    (setter: (value: string) => void) => (event: TargetedEvent<HTMLInputElement>) => {
      setter((event.target as HTMLInputElement).value);
    };

  return (
    <div class="signature-resizer-panel">
      <div class="signature-resizer-panel__field">
        <label class="signature-resizer-panel__label" for={`signature-width-${groupId}`}>
          {panelMessages.form.widthLabel}
        </label>
        <input
          id={`signature-width-${groupId}`}
          type="number"
          inputmode="numeric"
          min="1"
          value={widthInput}
          disabled={isProcessing}
          onInput={handleNumberInput(setWidthInput)}
        />
        <span class="signature-resizer-panel__unit">{panelMessages.form.pxUnitNote}</span>
      </div>

      <div class="signature-resizer-panel__field">
        <label class="signature-resizer-panel__label" for={`signature-height-${groupId}`}>
          {panelMessages.form.heightLabel}
        </label>
        <input
          id={`signature-height-${groupId}`}
          type="number"
          inputmode="numeric"
          min="1"
          value={heightInput}
          disabled={isProcessing}
          onInput={handleNumberInput(setHeightInput)}
        />
        <span class="signature-resizer-panel__unit">{panelMessages.form.pxUnitNote}</span>
      </div>

      <div class="signature-resizer-panel__field">
        <label class="signature-resizer-panel__label" for={`signature-max-size-${groupId}`}>
          {panelMessages.form.maxSizeLabel}
        </label>
        <input
          id={`signature-max-size-${groupId}`}
          type="number"
          inputmode="decimal"
          min="0"
          value={maxSizeInput}
          disabled={isProcessing}
          onInput={handleNumberInput(setMaxSizeInput)}
        />
        <span class="signature-resizer-panel__unit">{panelMessages.form.maxSizeUnitNote}</span>
      </div>

      {validationError && (
        <p class="signature-resizer-panel__error" role="alert">
          {panelMessages.form.errors[validationError]}
        </p>
      )}

      <fieldset class="signature-resizer-panel__fit-mode" disabled={isProcessing}>
        <legend>{panelMessages.form.fitModeLegend}</legend>
        <label class="signature-resizer-panel__fit-mode-option">
          <input
            type="radio"
            name={`signature-fit-mode-${groupId}`}
            checked={fitMode === "contain"}
            disabled={isProcessing}
            onChange={() => setFitMode("contain")}
          />
          <span class="signature-resizer-panel__fit-mode-label">
            {panelMessages.form.fitModeContainLabel}
          </span>
          <span class="signature-resizer-panel__fit-mode-description">
            {panelMessages.form.fitModeContainDescription}
          </span>
        </label>
        <label class="signature-resizer-panel__fit-mode-option">
          <input
            type="radio"
            name={`signature-fit-mode-${groupId}`}
            checked={fitMode === "stretch"}
            disabled={isProcessing}
            onChange={() => setFitMode("stretch")}
          />
          <span class="signature-resizer-panel__fit-mode-label">
            {panelMessages.form.fitModeStretchLabel}
          </span>
          <span class="signature-resizer-panel__fit-mode-description">
            {panelMessages.form.fitModeStretchDescription}
          </span>
        </label>
      </fieldset>

      <button
        type="button"
        class="btn-primary signature-resizer-panel__start"
        onClick={handleSubmit}
        disabled={isProcessing}
      >
        {job?.status.kind === "done" || job?.status.kind === "unreachable"
          ? panelMessages.panel.reconvert
          : panelMessages.panel.convert}
      </button>

      {job?.status.kind === "queued" && (
        <p class="signature-resizer-panel__status" role="status">
          {panelMessages.panel.queued}
        </p>
      )}

      {job?.status.kind === "processing" && (
        <div class="signature-resizer-panel__processing">
          <p class="signature-resizer-panel__status" role="status">
            {panelMessages.panel.processing}
          </p>
          <button
            type="button"
            class="btn-secondary signature-resizer-panel__cancel"
            onClick={onCancel}
          >
            {messages.common.cancel}
          </button>
        </div>
      )}

      {job?.status.kind === "done" && (
        <SignatureResizerResultView
          fileName={fileName}
          result={job.status.result}
          isUnreachable={false}
          messages={panelMessages}
          previewAndSave={messages.previewAndSave}
        />
      )}

      {job?.status.kind === "unreachable" && (
        <SignatureResizerResultView
          fileName={fileName}
          result={job.status.result}
          isUnreachable={true}
          messages={panelMessages}
          previewAndSave={messages.previewAndSave}
        />
      )}

      {job?.status.kind === "error" && (
        <p
          class="signature-resizer-panel__status signature-resizer-panel__status--error"
          role="alert"
        >
          {panelMessages.panel.errors[job.status.reason]}
        </p>
      )}

      {job?.status.kind === "cancelled" && (
        <p class="signature-resizer-panel__status" role="status">
          {messages.common.cancelled}
        </p>
      )}
    </div>
  );
}

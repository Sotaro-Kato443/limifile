import { useCallback, useId, useState } from "preact/hooks";
import { parseTargetSizeInput, TARGET_SIZE_PRESETS } from "./compression-target";
import type { TargetedEvent } from "preact";
import type { CompressionTarget, SizeUnit } from "./compression-types";
import type { UiDictionary } from "../../i18n/schema";

export interface CompressTargetInputProps {
  defaultValue?: number;
  defaultUnit?: SizeUnit;
  disabled?: boolean;
  onCompress: (target: CompressionTarget) => void;
  messages: UiDictionary["compressionPanel"];
  /**
   * 目標容量(数値・単位・プリセット)が実際に変化した場合にのみ呼ばれる、任意のコールバック。
   * 既存ページ(JPEG/HEIC/WebP圧縮)ではこれまで通り未指定のままでよく、その場合は挙動を変えない。
   * 値が変わらない操作(同じ値の再入力・既に選択中のプリセットの再クリック等)では呼ばない。
   */
  onTargetChange?: () => void;
}

/**
 * 目標容量の入力(数値+KB/MB選択+プリセット)と「圧縮する」ボタン。
 * 入力を変更しただけでは圧縮を開始しない(ボタン押下時のみ検証・開始する)。
 */
export function CompressTargetInput({
  defaultValue,
  defaultUnit,
  disabled,
  onCompress,
  messages,
  onTargetChange,
}: CompressTargetInputProps) {
  const [rawValue, setRawValue] = useState(defaultValue !== undefined ? String(defaultValue) : "");
  const [unit, setUnit] = useState<SizeUnit>(defaultUnit ?? "KB");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const handleCompressClick = useCallback(() => {
    const parsed = parseTargetSizeInput(rawValue, unit);
    if (!parsed.ok) {
      setError(messages.targetInput.errors[parsed.error]);
      return;
    }
    setError(null);
    onCompress(parsed.target);
  }, [rawValue, unit, onCompress, messages]);

  const handleValueInput = useCallback(
    (event: TargetedEvent<HTMLInputElement>) => {
      const nextValue = (event.target as HTMLInputElement).value;
      if (nextValue !== rawValue) onTargetChange?.();
      setRawValue(nextValue);
    },
    [rawValue, onTargetChange],
  );

  const handleUnitChange = useCallback(
    (event: TargetedEvent<HTMLSelectElement>) => {
      const nextUnit = (event.target as HTMLSelectElement).value as SizeUnit;
      if (nextUnit !== unit) onTargetChange?.();
      setUnit(nextUnit);
    },
    [unit, onTargetChange],
  );

  const handlePresetClick = useCallback(
    (value: number, presetUnit: SizeUnit) => {
      const nextValue = String(value);
      if (nextValue !== rawValue || presetUnit !== unit) onTargetChange?.();
      setRawValue(nextValue);
      setUnit(presetUnit);
      setError(null);
    },
    [rawValue, unit, onTargetChange],
  );

  return (
    <div class="compress-target">
      <div class="compress-target__row">
        <label class="compress-target__label" for={inputId}>
          {messages.targetInput.label}
        </label>
        <input
          id={inputId}
          class="compress-target__value"
          type="text"
          inputMode="decimal"
          value={rawValue}
          disabled={disabled}
          onInput={handleValueInput}
        />
        <select
          class="compress-target__unit"
          aria-label={messages.targetInput.unitAriaLabel}
          value={unit}
          disabled={disabled}
          onChange={handleUnitChange}
        >
          <option value="KB">KB</option>
          <option value="MB">MB</option>
        </select>
      </div>
      <div class="compress-target__presets">
        {TARGET_SIZE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            class="compress-target__preset"
            disabled={disabled}
            onClick={() => handlePresetClick(preset.value, preset.unit)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <p class="compress-target__note">{messages.targetInput.unitNote}</p>
      {error && <p class="compress-target__error">{error}</p>}
      <button
        type="button"
        class="btn-primary compress-target__submit"
        disabled={disabled}
        onClick={handleCompressClick}
      >
        {messages.compress}
      </button>
    </div>
  );
}

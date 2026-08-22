import type { CompressionTarget, SizeUnit } from "./compression-types";

/** LimiFileでは1KB=1,000バイト、1MB=1,000,000バイトの10進基準に統一する(表示値と内部判定を一致させるため) */
export const BYTES_PER_KB = 1000;
export const BYTES_PER_MB = 1_000_000;

export const MIN_TARGET_BYTES = 10 * BYTES_PER_KB; // 10KB
export const MAX_TARGET_BYTES = 50 * BYTES_PER_MB; // 50MB

export interface TargetSizePreset {
  value: number;
  unit: SizeUnit;
  label: string;
}

export const TARGET_SIZE_PRESETS: TargetSizePreset[] = [
  { value: 100, unit: "KB", label: "100KB" },
  { value: 200, unit: "KB", label: "200KB" },
  { value: 500, unit: "KB", label: "500KB" },
  { value: 1, unit: "MB", label: "1MB" },
  { value: 2, unit: "MB", label: "2MB" },
];

export type TargetSizeError =
  "empty" | "invalid-number" | "not-positive" | "too-small" | "too-large";

function bytesPerUnit(unit: SizeUnit): number {
  return unit === "KB" ? BYTES_PER_KB : BYTES_PER_MB;
}

function unitLabel(value: number, unit: SizeUnit): string {
  const numberPart = String(value).replace(".", "-");
  return `${numberPart}${unit.toLowerCase()}`;
}

function displayText(value: number, unit: SizeUnit): string {
  return `${value}${unit}`;
}

/**
 * KB/MBの数値入力を検証する。0・負数・NaN・範囲外を明確なエラー種別で返す。
 * 空欄はUI側で別途"empty"として扱う想定(Number("")が0になる罠を避けるため、呼び出し側で空欄チェック後に渡す)。
 */
export function validateTargetSize(value: number, unit: SizeUnit): TargetSizeError | null {
  if (!Number.isFinite(value)) return "invalid-number";
  if (value <= 0) return "not-positive";
  const bytes = Math.round(value * bytesPerUnit(unit));
  if (bytes < MIN_TARGET_BYTES) return "too-small";
  if (bytes > MAX_TARGET_BYTES) return "too-large";
  return null;
}

/** 検証済みの数値からCompressionTargetを組み立てる。事前にvalidateTargetSizeがnullを返すことを確認しておくこと */
export function toCompressionTarget(value: number, unit: SizeUnit): CompressionTarget {
  return {
    bytes: Math.round(value * bytesPerUnit(unit)),
    label: unitLabel(value, unit),
    displayText: displayText(value, unit),
  };
}

export type ParseTargetSizeInputResult =
  { ok: true; target: CompressionTarget } | { ok: false; error: TargetSizeError };

/** UIの生入力文字列からCompressionTargetを組み立てる。空欄は"empty"エラーとして扱う */
export function parseTargetSizeInput(rawValue: string, unit: SizeUnit): ParseTargetSizeInputResult {
  const trimmed = rawValue.trim();
  if (trimmed === "") return { ok: false, error: "empty" };

  const value = Number(trimmed);
  const error = validateTargetSize(value, unit);
  if (error) return { ok: false, error };

  return { ok: true, target: toCompressionTarget(value, unit) };
}

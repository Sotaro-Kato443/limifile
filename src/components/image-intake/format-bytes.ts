function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * ファイル容量を人が読みやすい単位(B/KB/MB)の文字列に変換する。
 * 1KB=1,000バイト、1MB=1,000,000バイトの10進基準(圧縮機能の目標容量指定と統一するため)。
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;

  const kb = bytes / 1000;
  if (kb < 1000) return `${roundTo(kb, 1)} KB`;

  const mb = kb / 1000;
  return `${roundTo(mb, 2)} MB`;
}

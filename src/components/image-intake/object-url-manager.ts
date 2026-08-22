/**
 * サムネイル用Object URLの生成・解放を一箇所に集約する。
 * 呼び出し側は「一覧から個別削除した時」「一覧を全消去した時」「アンマウント時」の
 * 3つのタイミングでのみ revoke/revokeAll を呼び出し、サムネイル表示直後には解放しないこと。
 */
export interface ObjectUrlManager {
  create(id: string, blob: Blob): string;
  revoke(id: string): void;
  revokeAll(): void;
}

export function createObjectUrlManager(): ObjectUrlManager {
  const urlsById = new Map<string, string>();

  function create(id: string, blob: Blob): string {
    const url = URL.createObjectURL(blob);
    urlsById.set(id, url);
    return url;
  }

  function revoke(id: string): void {
    const url = urlsById.get(id);
    if (!url) return;
    URL.revokeObjectURL(url);
    urlsById.delete(id);
  }

  function revokeAll(): void {
    for (const url of urlsById.values()) {
      URL.revokeObjectURL(url);
    }
    urlsById.clear();
  }

  return { create, revoke, revokeAll };
}

import type { FitMode } from "./target-fit-types";

/** target-fit.worker.tsがcanvasへdrawImageする際の描画矩形(1回だけ描画し、以後はqualityのみ変える) */
export interface TargetFitLayout {
  drawWidth: number;
  drawHeight: number;
  dx: number;
  dy: number;
  /** 元画像よりdrawWidth/drawHeightが大きい(=拡大した)場合true */
  upscaled: boolean;
}

/**
 * containモード: アスペクト比を保ったまま、targetWidth×targetHeightの中に全体が収まる
 * 最大の描画サイズを求め、中央寄せする。余白は呼び出し側がbackground色でfillRect済みの
 * canvas上にdrawImageするため、この関数自体は色を扱わない。
 *
 * アップスケール(元画像がtargetより小さい場合にscale>1になること)を明示的に許容する。
 * targetWidth/targetHeightは外部提出条件としての絶対要件であり、それを満たすことを
 * 「拡大しない」という一般的な圧縮系ツールの慣習より優先する(レビューで合意済み)。
 */
export function computeContainLayout(
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
): TargetFitLayout {
  const scale = Math.min(targetWidth / srcWidth, targetHeight / srcHeight);
  const drawWidth = Math.max(1, Math.round(srcWidth * scale));
  const drawHeight = Math.max(1, Math.round(srcHeight * scale));
  const dx = Math.round((targetWidth - drawWidth) / 2);
  const dy = Math.round((targetHeight - drawHeight) / 2);
  return { drawWidth, drawHeight, dx, dy, upscaled: scale > 1 };
}

/**
 * stretchモード: アスペクト比を無視し、targetWidth×targetHeightへぴったり合わせる
 * (歪みが生じ得る)。全面を描画するため余白は発生しない。
 */
export function computeStretchLayout(
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
): TargetFitLayout {
  const upscaled = targetWidth > srcWidth || targetHeight > srcHeight;
  return { drawWidth: targetWidth, drawHeight: targetHeight, dx: 0, dy: 0, upscaled };
}

export function computeTargetFitLayout(
  fitMode: FitMode,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
): TargetFitLayout {
  return fitMode === "contain"
    ? computeContainLayout(srcWidth, srcHeight, targetWidth, targetHeight)
    : computeStretchLayout(srcWidth, srcHeight, targetWidth, targetHeight);
}

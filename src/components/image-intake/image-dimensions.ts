import type { ImageDimensions } from "./types";

type ImageLike = Pick<
  HTMLImageElement,
  "onload" | "onerror" | "src" | "naturalWidth" | "naturalHeight"
>;

function defaultCreateImageElement(): ImageLike {
  return new Image();
}

/**
 * 既存のObject URLから画像の幅・高さを取得する。
 * Object URLの生成・解放はこの関数の責務ではない(object-url-managerが一元管理する)。
 */
export function getImageDimensions(
  objectUrl: string,
  createImageElement: () => ImageLike = defaultCreateImageElement,
): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const image = createImageElement();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      reject(new Error("画像を読み込めませんでした"));
    };
    image.src = objectUrl;
  });
}

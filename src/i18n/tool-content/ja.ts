import type { LocalizedToolPageKey } from "../../config/tool-page-config";
import type { ToolContent } from "../schema";

/**
 * 日本語のツールページ文言。既存のsrc/config/tool-page-config.tsに直書きされていた
 * heading/description/navLabel/cardTitle/cardDescription/formatsと完全に一致させている
 * (このPRでは表示上の日本語文言を一切変更しない)。
 * 固定容量20/50/100/200KBページ(EnOnlyToolPageKey)は日本語版を作らない方針のため、
 * この型はLocalizedToolPageKey(ToolPageKeyから英語専用ページを除いたsubset)のみを要求する。
 */
export const ja: Record<LocalizedToolPageKey, ToolContent> = {
  default: {
    heading: "画像をブラウザ内で処理する",
    description:
      "LimiFileは、画像の形式変換・圧縮・メタデータ削除をこの端末内だけで行うツール集です。画像データを外部サーバーへ送信することはありません。",
    navLabel: "トップ",
    cardTitle: "画像を解析",
    cardDescription: "画像を選択して形式・容量・寸法を解析します。",
    formats: "JPG, PNG, WebP, HEIC/HEIF",
    seoTitle: "画像の変換・圧縮・メタデータ削除 | LimiFile",
  },
  "heic-to-jpg": {
    heading: "HEIC/HEIFをJPGに変換",
    description:
      "iPhoneのHEIC/HEIF画像を、この端末内でJPGに変換します。画像はサーバーへ送信されません。",
    navLabel: "HEIC→JPG",
    cardTitle: "HEICをJPGに変換",
    cardDescription: "iPhoneのHEIC/HEIF画像を互換性の高いJPGに変換します。",
    formats: "HEIC・HEIF",
    seoTitle: "iPhoneのHEIC写真をJPGに変換 | LimiFile",
  },
  "compress-image": {
    heading: "画像を圧縮する",
    description: "JPEG・HEIC・WebP画像を指定したKB・MB以下へ、ブラウザ内で圧縮できます。",
    navLabel: "容量指定圧縮",
    cardTitle: "指定容量以下に圧縮",
    cardDescription: "JPEG・HEIC・WebP画像を指定したKB・MB以下へ圧縮します。",
    formats: "JPEG・HEIC・WebP",
    seoTitle: "画像を指定容量に圧縮 | LimiFile",
  },
  "compress-image-to-500kb": {
    heading: "画像を500KB以下に圧縮する",
    description:
      "JPEG・HEIC・WebP・PNG画像を、500KB以下を目指して圧縮します。画像形式は維持され、端末内で処理されます。",
    navLabel: "500KB圧縮",
    cardTitle: "500KB以下に圧縮",
    cardDescription: "JPEG・HEIC・WebP・PNG画像を500KB以下へワンタップで圧縮します。",
    formats: "JPEG・HEIC・WebP・PNG",
    seoTitle: "画像を500KB以下に圧縮 | LimiFile",
  },
  "remove-exif": {
    heading: "個人情報を含みうるメタデータを削除する",
    description:
      "JPEG・HEIC画像から、位置情報や撮影情報を含む可能性のあるメタデータをブラウザ内で削除できます。",
    navLabel: "メタデータ削除",
    cardTitle: "メタデータを削除",
    cardDescription: "位置情報・撮影日時・カメラ情報などのメタデータを削除します。",
    formats: "JPEG・HEIC",
    seoTitle: "写真のEXIF・位置情報を削除 | LimiFile",
  },
  "png-to-webp": {
    heading: "PNGをWebPに変換",
    description:
      "PNG画像を、透過を維持したままこの端末内で軽量なWebP形式へ変換します。画像はサーバーへ送信されません。",
    navLabel: "PNG→WebP",
    cardTitle: "PNGをWebPに変換",
    cardDescription: "透過を維持したまま、PNG画像を軽量なWebP形式へ変換します。",
    formats: "PNG",
    seoTitle: "PNGをWebPに変換 | LimiFile",
  },
  "compress-png": {
    heading: "PNG画像を指定容量に圧縮",
    description:
      "PNG画像をPNGのまま、指定したKB・MB以下を目指してブラウザ内で圧縮。透過対応・アップロード不要。",
    navLabel: "PNG容量圧縮",
    cardTitle: "PNGを指定容量に圧縮",
    cardDescription: "PNGのまま、指定したKB・MB以下を目指して軽量化",
    formats: "PNG",
    seoTitle: "PNGを指定容量に圧縮 | LimiFile",
  },
  "png-to-jpg": {
    heading: "PNGをJPGに変換",
    description:
      "PNG画像を、高画質・標準・軽量の3段階からブラウザ内でJPGへ変換します。透明部分は選んだ背景色(既定は白)で塗りつぶされます。",
    navLabel: "PNG→JPG",
    cardTitle: "PNGをJPGに変換",
    cardDescription: "PNG画像を、選んだ背景色で透明部分を塗りつぶしてJPGへ変換します。",
    formats: "PNG",
    seoTitle: "PNGをJPGに変換 | LimiFile",
  },
  "webp-to-jpg": {
    heading: "WebPをJPGに変換",
    description:
      "WebP画像を、高画質・標準・軽量の3段階からブラウザ内でJPGへ変換します。透明部分は選んだ背景色(既定は白)で塗りつぶされ、アニメーションWebPには対応していません。",
    navLabel: "WebP→JPG",
    cardTitle: "WebPをJPGに変換",
    cardDescription: "WebP画像を、互換性の高いJPGへブラウザ内で変換します。",
    formats: "WebP",
    seoTitle: "WebPをJPGに変換 | LimiFile",
  },
};

import type { ToolPageKey } from "../../config/tool-page-config";
import type { ToolContent } from "../schema";

/**
 * 英語のツールページ文言。PR A2-1時点ではまだどのページからも参照されない
 * (公開ページは引き続きlocale="ja"のみ)。en/jaが同じToolContentを満たすことを
 * 型・テストの両方で保証するために用意する。
 */
export const en: Record<ToolPageKey, ToolContent> = {
  default: {
    heading: "Process images right in your browser",
    description:
      "Convert, compress, resize, and remove metadata from images in your browser. Selected images are processed on your device, not uploaded to a LimiFile server.",
    navLabel: "Home",
    cardTitle: "Analyze an image",
    cardDescription: "Select an image to check its format, size, and dimensions.",
    formats: "JPG, PNG, WebP, HEIC/HEIF",
    seoTitle: "Browser-Based Image Tools | LimiFile",
  },
  "heic-to-jpg": {
    heading: "Convert HEIC/HEIF to JPG",
    description:
      "Convert iPhone HEIC/HEIF photos to JPG in your browser. Runs in a background Worker with WebAssembly, and images are never sent to a server.",
    navLabel: "HEIC→JPG",
    cardTitle: "Convert HEIC to JPG",
    cardDescription: "Convert HEIC/HEIF photos from your iPhone to widely compatible JPG.",
    formats: "HEIC/HEIF",
    seoTitle: "HEIC to JPG Converter | LimiFile",
  },
  "compress-image": {
    heading: "Compress an image",
    description:
      "Resize or compress a JPEG, HEIC, or WebP image to a target size in KB or MB — right in your browser. Reaching the exact target isn't guaranteed.",
    navLabel: "Target-size compression",
    cardTitle: "Compress to a target size",
    cardDescription: "Compress JPEG, HEIC, and WebP images to a target size in KB or MB.",
    formats: "JPEG/HEIC/WebP",
    seoTitle: "Resize or Compress an Image to a Target Size | LimiFile",
  },
  "compress-image-to-500kb": {
    heading: "Compress an image under 500KB",
    description:
      "Compress JPEG, HEIC, WebP, or PNG images toward a fixed 500KB (500,000-byte) target with one tap. Format is preserved; your images stay on your device.",
    navLabel: "500KB compression",
    cardTitle: "Compress under 500KB",
    cardDescription: "Compress JPEG, HEIC, WebP, and PNG images under 500KB with one tap.",
    formats: "JPEG/HEIC/WebP/PNG",
    seoTitle: "Compress an Image to Under 500KB | LimiFile",
  },
  "compress-image-to-20kb": {
    heading: "Compress & resize an image to 20KB",
    description:
      "Resize or compress a JPEG, HEIC, WebP, or PNG image toward a fixed 20KB (20,000-byte) target with one tap — built for strict upload size limits. Your image stays on your device.",
    navLabel: "20KB compression",
    cardTitle: "Compress to 20KB",
    cardDescription: "Compress JPEG, HEIC, WebP, and PNG images to 20KB with one tap.",
    formats: "JPEG/HEIC/WebP/PNG",
    seoTitle: "Compress & Resize Image to 20KB | LimiFile",
  },
  "compress-image-to-50kb": {
    heading: "Compress & resize an image to 50KB",
    description:
      "Resize or compress a JPEG, HEIC, WebP, or PNG image toward a fixed 50KB (50,000-byte) target with one tap — built for strict upload size limits. Your image stays on your device.",
    navLabel: "50KB compression",
    cardTitle: "Compress to 50KB",
    cardDescription: "Compress JPEG, HEIC, WebP, and PNG images to 50KB with one tap.",
    formats: "JPEG/HEIC/WebP/PNG",
    seoTitle: "Compress & Resize Image to 50KB | LimiFile",
  },
  "compress-image-to-100kb": {
    heading: "Compress & resize an image to 100KB",
    description:
      "Resize or compress a JPEG, HEIC, WebP, or PNG image toward a fixed 100KB (100,000-byte) target with one tap — built for strict upload size limits. Your image stays on your device.",
    navLabel: "100KB compression",
    cardTitle: "Compress to 100KB",
    cardDescription: "Compress JPEG, HEIC, WebP, and PNG images to 100KB with one tap.",
    formats: "JPEG/HEIC/WebP/PNG",
    seoTitle: "Compress & Resize Image to 100KB | LimiFile",
  },
  "compress-image-to-200kb": {
    heading: "Compress & resize an image to 200KB",
    description:
      "Resize or compress a JPEG, HEIC, WebP, or PNG image toward a fixed 200KB (200,000-byte) target with one tap — built for strict upload size limits. Your image stays on your device.",
    navLabel: "200KB compression",
    cardTitle: "Compress to 200KB",
    cardDescription: "Compress JPEG, HEIC, WebP, and PNG images to 200KB with one tap.",
    formats: "JPEG/HEIC/WebP/PNG",
    seoTitle: "Compress & Resize Image to 200KB | LimiFile",
  },
  "remove-exif": {
    heading: "Remove metadata that may contain personal information",
    description:
      "Strip EXIF metadata — GPS location, camera model, timestamps — from JPEG and HEIC photos in your browser, without re-encoding the image.",
    navLabel: "Metadata removal",
    cardTitle: "Remove metadata",
    cardDescription: "Remove metadata such as location, capture time, and camera information.",
    formats: "JPEG/HEIC",
    seoTitle: "Remove EXIF Metadata from Photos | LimiFile",
  },
  "png-to-webp": {
    heading: "Convert PNG to WebP",
    description:
      "Convert PNG images to WebP in your browser at one of three quality presets, keeping transparency. Animated PNG (APNG) isn't supported.",
    navLabel: "PNG→WebP",
    cardTitle: "Convert PNG to WebP",
    cardDescription: "Convert PNG images to lightweight WebP while keeping transparency intact.",
    formats: "PNG",
    seoTitle: "Convert PNG to WebP | LimiFile",
  },
  "compress-png": {
    heading: "Compress a PNG to a target size",
    description:
      "Compress a PNG toward a target size in KB or MB while staying PNG, using color-count reduction in your browser. Reaching the target isn't guaranteed.",
    navLabel: "PNG target-size compression",
    cardTitle: "Compress PNG to a target size",
    cardDescription: "Stay PNG while shrinking toward a target size in KB or MB.",
    formats: "PNG",
    seoTitle: "Compress PNG to a Target Size | LimiFile",
  },
  "png-to-jpg": {
    heading: "Convert PNG to JPG",
    description:
      "Convert PNG images to JPG in your browser at one of three quality presets. Transparent areas are filled with a background color you choose (white by default), since JPG can't hold transparency.",
    navLabel: "PNG→JPG",
    cardTitle: "Convert PNG to JPG",
    cardDescription:
      "Convert PNG images to JPG, filling transparent areas with a background color you choose.",
    formats: "PNG",
    seoTitle: "Convert PNG to JPG | LimiFile",
  },
  "webp-to-jpg": {
    heading: "Convert WebP to JPG",
    description:
      "Convert WebP images to JPG in your browser at one of three quality presets. Transparent areas are filled with a background color you choose (white by default); animated WebP isn't supported.",
    navLabel: "WebP→JPG",
    cardTitle: "Convert WebP to JPG",
    cardDescription: "Convert WebP images to widely compatible JPG, right in your browser.",
    formats: "WebP",
    seoTitle: "Convert WebP to JPG | LimiFile",
  },
  "avif-to-jpg": {
    heading: "Convert AVIF to JPG",
    description:
      "Convert AVIF images to JPG in your browser at one of three quality presets. Transparent areas are filled with a background color you choose (white by default); animated AVIF (image sequences) isn't supported.",
    navLabel: "AVIF→JPG",
    cardTitle: "Convert AVIF to JPG",
    cardDescription: "Convert AVIF images to widely compatible JPG, right in your browser.",
    formats: "AVIF",
    seoTitle: "Convert AVIF to JPG | LimiFile",
  },
  "signature-resizer": {
    heading: "Signature Resizer",
    description:
      "Resize a signature or photo to the exact width, height, and maximum file size a form requires, then LimiFile checks each condition against the JPG it produces before you download it.",
    navLabel: "Signature Resizer",
    cardTitle: "Signature Resizer",
    cardDescription: "Fit a signature or photo to a form's exact width, height, and file size.",
    formats: "JPEG, PNG",
    seoTitle: "Signature Resizer | LimiFile",
  },
};

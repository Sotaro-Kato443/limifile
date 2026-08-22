import type { CommonDictionary } from "../schema";

/**
 * 英語の共通UI文言。PR A1時点ではまだどのページからも参照されないが、
 * en/jaの辞書が同じCommonDictionaryを満たすことを型・テストの両方で保証するために用意する。
 */
export const en: CommonDictionary = {
  nav: {
    home: "Home",
    ariaLabel: "Tools",
  },
  footer: {
    licenses: "Open Source Licenses",
    privacy: "Privacy",
    terms: "Terms",
    contact: "Contact",
  },
  languageSwitcher: {
    label: "Language",
  },
  notFound: {
    heading: "Page not found",
    metaDescription:
      "The page you requested could not be found. Please check the URL, or return to the home page.",
    lede: "The URL may have changed, or the address you entered may be incorrect.",
  },
  backToHome: "Back to home",
  privacyNotice: "Your images are processed on this device and are never sent to a server.",
  ui: {
    common: {
      remove: "Remove",
      removeAll: "Remove all",
      cancel: "Cancel",
      cancelled: "Cancelled",
      mimeUnknown: "Unknown MIME type",
      unknownFormatLabel: "Unknown",
      formatsLabel: "Supported formats: ",
    },
    dropZone: {
      selectOrDrop: "Select an image, or drag and drop it here",
      supportedFormats: (formatsHint) => `Supported formats: ${formatsHint} (multiple allowed)`,
      chooseFile: "Choose a file",
    },
    imageList: {
      selectedCount: (count) => `${count} selected`,
    },
    listItem: {
      analyzing: "Analyzing…",
      heicQueued: "Waiting to convert to JPG",
      heicConverting: "Converting to JPG…",
      heicConverted: "Converted HEIC to a compatible JPG",
      extensionMismatch: (ext, detectedFormatLabel) =>
        `The extension (.${ext}) doesn't match the detected format (${detectedFormatLabel})`,
      removeAriaLabel: (fileName) => `Remove ${fileName}`,
      originalLabel: "Before: ",
      convertedLabel: "After: ",
    },
    intakeErrors: {
      heicConvertFailed: "This image could not be converted. Please try a different file.",
      analyzeFailed: "This image could not be analyzed. Please try a different file.",
      unsupportedFormat: "Unsupported format (only JPG/PNG/WebP/HEIC/HEIF/AVIF can be analyzed).",
      heicTooLarge: "This HEIC file is too large to process (50MB limit).",
      heicUnsupportedBrowser: "This browser cannot convert HEIC images to JPG.",
      avifTooLarge: "This AVIF file is too large to process safely (50MB limit).",
      avifUnsupportedAnimation: "Animated AVIF (image sequences) is not currently supported.",
      avifUnsafeDimensions: "This AVIF image is too large to process safely.",
      avifDecodeFailed:
        "This AVIF couldn't be decoded. Your browser may not support this AVIF file, or the file may be corrupted.",
      rasterTooLarge: "This file is too large to process safely (50MB limit).",
      rasterUnsafeDimensions: "This image is too large to process safely.",
      rasterDecodeFailed:
        "This image couldn't be decoded. Your browser may not support this file, or the file may be corrupted.",
    },
    previewAndSave: {
      previewTrigger: (formatLabel) => `Preview ${formatLabel}`,
      previewDialogAriaLabel: (fileName) => `Preview of ${fileName}`,
      closePreviewAriaLabel: "Close preview",
      closePreview: "Close",
      previewImageAlt: (fileName, width, height) =>
        `Converted preview of ${fileName} (${width}×${height}px)`,
      shareFailedFallback: "Sharing failed",
      touchShareCaption: (formatLabel) =>
        `On iPhone/iPad, use "Save ${formatLabel}" to choose where to save it.`,
      nonTouchShareCaption: "The file is saved according to your browser's download settings.",
      download: (formatLabel) => `Download ${formatLabel}`,
      secondaryDownload: "Regular download",
      save: (formatLabel) => `Save ${formatLabel}`,
      share: "Share",
    },
    compressionPanel: {
      phaseLabel: {
        preparing: "Preparing to compress",
        quality: "Adjusting quality",
        resize: "Adjusting image size",
        finalizing: "Finalizing",
      },
      attemptSuffix: (attempt, maxAttempts) => ` (attempt ${attempt} of ${maxAttempts})`,
      compress: "Compress",
      queued: "Waiting to compress…",
      alreadyUnderTarget: "Already under the target size",
      completed: "Compression complete",
      stats: {
        original: "Original size: ",
        compressed: "Compressed size: ",
        target: "Target size: ",
        originalDimensions: "Original dimensions: ",
        compressedDimensions: "Compressed dimensions: ",
        reduction: "Reduction: ",
        outputFormat: "Output format: ",
        encodeCount: "Encode attempts: ",
        resizeCount: "Resize attempts: ",
        elapsed: "Time taken: ",
        secondsSuffix: "s",
      },
      errors: {
        "target-unreachable":
          "This image could not be brought under the target size, even at the lowest quality and smallest dimensions.",
        "encode-failed": "Processing could not start. Please try again.",
        "decode-failed": "This image could not be read. Please try a different file.",
        "unsafe-dimensions": "This image is too large to process safely.",
        "unsupported-webp-encoder": "This browser cannot compress WebP images.",
        "unsupported-animation": "Animated WebP is not currently supported.",
      },
      targetInput: {
        label: "Target size",
        unitAriaLabel: "Size unit",
        unitNote: "Calculated using 1KB = 1,000 bytes.",
        errors: {
          empty: "Please enter a target size",
          "invalid-number": "Please enter a number",
          "not-positive": "Please enter a value greater than 0",
          "too-small": "Please specify at least 10KB",
          "too-large": "Please specify 50MB or less",
        },
      },
    },
    compressionWorkbench: {
      formatMismatch: "Target-size compression currently supports JPEG, HEIC, and WebP",
      unsupportedAnimation: "Animated WebP is not currently supported.",
      unsafeDimensions: "This image is too large to process safely.",
      heicSourceNote: "HEIC images are converted to JPG before compression",
      webpSourceNote: "WebP is compressed to WebP, keeping transparency intact.",
      unsupportedBrowser: "This browser doesn't support the features needed for image compression",
      formatNote:
        "WebP is compressed to WebP, keeping transparency intact. Animated WebP is not supported.",
    },
    fixedTargetWorkbench: {
      formatMismatch: (targetLabel) => `This format is not eligible for ${targetLabel} compression`,
      unsupportedBrowserJpegWebp: "This browser doesn't support image compression",
      unsupportedBrowserPng: "This browser doesn't support PNG compression",
      pngNote: (targetLabel) =>
        `PNG is compressed by reducing colors and, only if needed, shrinking the dimensions to reach ${targetLabel}. Transparency is supported, but semi-transparent or gradient areas may look different.`,
      formatNote:
        "WebP is compressed to WebP, keeping transparency intact. Animated WebP is not supported. PNG stays PNG and is never auto-converted to WebP. Animated PNG (APNG) is not supported.",
    },
    pngCompression: {
      formatMismatch: "Target-size PNG compression currently supports PNG only",
      unsupportedBrowser: "This browser doesn't support the features needed for PNG compression",
      workbenchNote:
        "PNG stays PNG and is compressed on this device toward your target size. Transparency is supported. Animated PNG (APNG) is not supported.",
      panel: {
        queued: "Waiting to compress…",
        processing: "Compressing… (can take up to about 18 seconds per image)",
        needsReprocess: "The target size changed. Please press “Compress” again.",
        errors: {
          "animated-png": "Animated PNG (APNG) is not currently supported.",
          "invalid-png": "This file could not be read as a valid PNG image.",
          "invalid-target": "Please check the target size.",
          "unsafe-dimensions":
            "This image's dimensions or total pixel count exceed the processing limit.",
          "unsupported-browser": "This browser doesn't support PNG compression.",
          "unsupported-png-encoder": "The generated PNG could not be safely verified.",
          timeout: "Processing took too long and was stopped. Please try a smaller image.",
          "too-large": "This file is too large to process (50MB limit).",
          error: "Processing could not start. Please try again.",
        },
      },
      result: {
        alreadyUnderTarget: "Already under the target size",
        reuseOriginal: "You can use the original PNG without recompressing it.",
        originalLabel: "Original size: ",
        outputSameAsOriginalSuffix: " (same as the original file)",
        dimensionsLabel: "Dimensions: ",
        completed: "Compressed under the target size",
        originalFileNameLabel: "Original file name: ",
        outputBytesLabel: "Output size: ",
        reductionLabel: "Reduction: ",
        originalDimensionsLabel: "Original dimensions: ",
        outputDimensionsLabel: "Output dimensions: ",
        resizedNote: (ow, oh, nw, nh) =>
          `(Dimensions were automatically reduced from ${ow}×${oh} to ${nw}×${nh} to fit the target size)`,
        details: "Details",
        colorCount: (colorCount) =>
          `Colors used: ${colorCount} (reduced from the original to shrink the file size)`,
        encodeAttemptsLabel: "Encode attempts: ",
        unreachable: "Could not reach the target size",
        targetLabel: "Target size: ",
        bestCandidateBytesLabel: "Closest result size: ",
        overByTarget: (overBy) => `About ${overBy} over the target`,
        overTargetNote: (target) => `This saved result exceeds the target size (${target}).`,
        noCandidateNote: "No savable result was produced.",
        webpHintPrefix: "To shrink it further, you can also try ",
        webpHintLinkLabel: "converting to WebP",
        webpHintSuffix: ".",
      },
    },
    pngToWebp: {
      formatMismatch: "PNG to WebP conversion currently supports PNG only",
      unsupportedAnimation: "Animated PNG is not currently supported.",
      unsafeDimensions: "This image is too large to process safely.",
      unsupportedBrowser:
        "This browser doesn't support the features needed for PNG to WebP conversion",
      workbenchNote:
        "Converts PNG images to WebP while keeping transparency intact. Animated PNG is not supported.",
      panel: {
        qualityLegend: "Quality",
        qualityLabel: {
          high: "High quality",
          standard: "Standard",
          light: "Light",
        },
        qualityDescription: {
          high: "Prioritizes quality",
          standard: "Balances quality and size",
          light: "Prioritizes file size",
        },
        convert: "Convert to WebP",
        reconvert: "Convert again at this quality",
        queued: "Waiting to convert…",
        converting: "Converting…",
        errors: {
          "unsupported-animation": "Animated PNG is not currently supported.",
          "unsafe-dimensions": "This image is too large to process safely.",
          "decode-failed": "This image could not be read. Please try a different file.",
          "unsupported-webp-encoder": "This browser cannot convert images to WebP.",
          timeout: "Processing took too long and was stopped. Please try a different file.",
          "encode-failed": "Processing could not start. Please try again.",
        },
      },
      result: {
        completed: "Converted to WebP",
        originalBytesLabel: "Size before: ",
        outputBytesLabel: "Size after: ",
        reductionLabel: "Reduction: ",
        originalDimensionsLabel: "Original dimensions: ",
        outputDimensionsLabel: "Output dimensions: ",
        outputFormatLabel: "Output format: WebP",
        qualitySettingLabel: "Quality: ",
        elapsedLabel: "Time taken: ",
        secondsSuffix: "s",
      },
    },
    rasterToJpg: {
      formatMismatch: (sourceFormatLabel) =>
        `${sourceFormatLabel} to JPG conversion currently supports ${sourceFormatLabel} only`,
      unsupportedAnimation: (sourceFormatLabel) =>
        `Animated ${sourceFormatLabel} is not currently supported.`,
      unsafeDimensions: "This image is too large to process safely.",
      unsupportedBrowser: "This browser doesn't support the features needed for JPG conversion",
      workbenchNote: (sourceFormatLabel) =>
        `Converts ${sourceFormatLabel} images to JPG. Since JPG can't hold transparency, transparent areas are filled with the background color you choose below (white by default). Animated ${sourceFormatLabel} is not supported.`,
      backgroundNote:
        "JPG can't store transparency, so any transparent areas are filled with this background color before conversion. White is used by default; change it if you need a different color.",
      panel: {
        qualityLegend: "Quality",
        qualityLabel: {
          high: "High quality",
          standard: "Standard",
          light: "Light",
        },
        qualityDescription: {
          high: "Prioritizes quality",
          standard: "Balances quality and size",
          light: "Prioritizes file size",
        },
        backgroundLabel: "Background color for transparent areas",
        backgroundPickerAriaLabel: "Background color for transparent areas",
        convert: "Convert to JPG",
        reconvert: "Convert again with these settings",
        queued: "Waiting to convert…",
        converting: "Converting…",
        errors: {
          "unsupported-animation": "Animated images are not currently supported.",
          "unsafe-dimensions": "This image is too large to process safely.",
          "decode-failed": "This image could not be read. Please try a different file.",
          "unsupported-encoder": "This browser cannot convert images to JPG.",
          timeout: "Processing took too long and was stopped. Please try a different file.",
          "encode-failed": "Processing could not start. Please try again.",
          "input-too-large": "This file is too large to process safely.",
        },
      },
      result: {
        completed: "Converted to JPG",
        originalBytesLabel: "Size before: ",
        outputBytesLabel: "Size after: ",
        sizeChangeLabel: (direction, percent) =>
          direction === "reduced" ? `Reduced ${percent}%` : `Increased ${percent}%`,
        originalDimensionsLabel: "Original dimensions: ",
        outputDimensionsLabel: "Output dimensions: ",
        outputFormatLabel: "Output format: JPG",
        qualitySettingLabel: "Quality: ",
        backgroundColorLabel: "Background color used: ",
        elapsedLabel: "Time taken: ",
        secondsSuffix: "s",
      },
    },
    metadataRemoval: {
      formatMismatch: "Metadata removal currently supports JPEG and HEIC",
      unsupportedBrowser: "This browser doesn't support the features needed for metadata removal",
      heicSourceNote: "HEIC images are converted to JPG before metadata is removed",
      panel: {
        start: "Remove metadata",
        retry: "Remove again",
        queued: "Waiting to remove…",
        removing: "Removing…",
        errors: {
          "invalid-jpeg": "This file could not be read as JPEG. It may be corrupted.",
          "invalid-segment-length":
            "This JPEG's internal structure is invalid. It may be corrupted.",
          "missing-eoi":
            "The end of this JPEG could not be found. It may be corrupted or truncated.",
          "invalid-jfif": "This JPEG's JFIF information is invalid. It may be corrupted.",
          "malformed-exif": "This JPEG's EXIF structure is invalid. It may be corrupted.",
          "ambiguous-orientation":
            "Multiple conflicting orientation values were found, so it could not be determined.",
          "limit-exceeded": "This file exceeds the processing limit.",
        },
      },
      result: {
        completed: "Metadata removed",
        baseNotice:
          "Removed EXIF, XMP, IPTC, and comment metadata. These areas can contain location, capture time, and camera information.",
        orientationNotice:
          "The orientation tag was kept to preserve the photo's display direction.",
        iccNotice: "The color profile was kept to preserve color accuracy.",
        originalBytesLabel: "Original size: ",
        outputBytesLabel: "Output size: ",
        originalDimensionsLabel: "Original dimensions: ",
        outputDimensionsLabel: "Output dimensions: ",
        reencodeLabel: "Re-encoded: ",
        reencodeNone: "No",
        outputFormatLabel: "Output format: JPG",
        reductionLabel: "Reduction: ",
        orientationLabel: "Orientation tag: ",
        orientationKept: "Kept",
        orientationRemoved: "Removed",
        colorProfileLabel: "Color profile: ",
        colorProfileKept: "Kept",
        colorProfileRemoved: "Removed",
        elapsedLabel: "Time taken: ",
        msSuffix: "ms",
      },
    },
    signatureResizer: {
      formatMismatch: "Signature Resizer currently supports JPEG and PNG.",
      unsupportedBrowser: "This browser doesn't support the features needed for Signature Resizer.",
      workbenchNote:
        "Enter the exact width, height, and maximum file size your form requires, and LimiFile checks each condition against the file it produces before you download it.",
      form: {
        widthLabel: "Width",
        heightLabel: "Height",
        pxUnitNote: "px",
        maxSizeLabel: "Maximum file size",
        maxSizeUnitNote: "KB",
        fitModeLegend: "How to fit the image",
        fitModeContainLabel: "Keep proportions (recommended)",
        fitModeContainDescription:
          "Fits the whole image inside the target size and pads any remaining space with white.",
        fitModeStretchLabel: "Stretch to exact size (may distort)",
        fitModeStretchDescription:
          "Fills the entire target size exactly, which can distort the image if its proportions don't match.",
        errors: {
          empty: "Please enter a value.",
          "invalid-number": "Please enter a valid number.",
          "not-positive": "Please enter a number greater than 0.",
          "too-large": "This value is too large.",
          "too-small": "This value is too small to represent as a whole number of bytes.",
        },
      },
      panel: {
        convert: "Convert",
        reconvert: "Convert again with these settings",
        queued: "Waiting to convert…",
        processing: "Converting…",
        errors: {
          "unsupported-animation": "Animated PNG (APNG) is not currently supported.",
          "unsafe-dimensions": "This image's dimensions are too large to process safely.",
          "invalid-request": "Please check the width, height, and maximum file size you entered.",
          "unsupported-encoder": "The generated JPEG could not be safely verified.",
          timeout: "Processing took too long and was stopped. Please try a smaller image.",
          "encode-failed": "Processing could not start. Please try again.",
        },
      },
      result: {
        completed: "All conditions were met",
        unreachable: "The file size condition could not be met",
        unreachableNote:
          "LimiFile could not reach this file size within its current JPEG quality range. A best-effort file at the lowest quality LimiFile currently uses is offered below — it may still be usable, or you can try a larger file size or smaller dimensions.",
        upscaledWarning:
          "The image was enlarged to reach the requested size, which may reduce sharpness.",
        checklistHeading: "Conditions",
        widthConditionLabel: (actualPx, targetPx) => `Width: ${actualPx}px (target: ${targetPx}px)`,
        heightConditionLabel: (actualPx, targetPx) =>
          `Height: ${actualPx}px (target: ${targetPx}px)`,
        sizeConditionLabel: (actualKbText, maxKbText) =>
          `File size: ${actualKbText} (limit: ${maxKbText})`,
        formatConditionLabel: (actual) => `Format: ${actual}`,
        conditionOkBadge: "Met",
        conditionFailBadge: "Not met",
        outputFormatLabel: "Output format: JPG",
        qualityLabel: "Quality used: ",
        elapsedLabel: "Time taken: ",
        secondsSuffix: "s",
      },
    },
  },
};

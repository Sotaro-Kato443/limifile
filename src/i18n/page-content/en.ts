import type { PageContent } from "../page-content-types";

const FEATURES_HEADING = "What this tool does";
const HOW_TO_HEADING = "How to use it";
const LIMITATIONS_HEADING = "Important limitations";
const PRIVACY_HEADING = "Privacy";
const SPECS_HEADING = "Specifications";
const FAQ_HEADING = "Frequently asked questions";
const RELATED_HEADING = "Related tools";
const POPULAR_SIZES_HEADING = "Popular target sizes";

/**
 * 英語のページ固有コンテンツ。src/i18n/page-content/ja.tsと同じ事実・制約・注意書きを、
 * 弱めたり強めたりせずに自然な英語で表現する(PR A3: search-readiness content)。
 * 各段落・箇条書きはsrc/components/**・test/**から確認した実装事実のみを根拠にしている。
 */
export const en: PageContent = {
  home: {
    cardsAriaLabel: "Available tools",
    intro: [
      {
        type: "text",
        text: "Free web tools for converting, compressing, resizing, and more. Selected images are processed on your device and are not uploaded to a LimiFile server.",
      },
    ],
    popularSizesHeading: POPULAR_SIZES_HEADING,
    popularSizesLinks: [
      { page: "compress-image-to-20kb", label: "Compress to 20KB" },
      { page: "compress-image-to-50kb", label: "Compress to 50KB" },
      { page: "compress-image-to-100kb", label: "Compress to 100KB" },
      { page: "compress-image-to-200kb", label: "Compress to 200KB" },
      { page: "compress-image-to-500kb", label: "Compress under 500KB" },
    ],
    purposeHeading: "Choose by goal",
    purposeGroups: [
      {
        title: "Change the format",
        links: [
          { page: "heic-to-jpg", label: "HEIC to JPG" },
          { page: "png-to-webp", label: "PNG to WebP" },
          { page: "png-to-jpg", label: "PNG to JPG" },
          { page: "webp-to-jpg", label: "WebP to JPG" },
          { page: "avif-to-jpg", label: "AVIF to JPG" },
        ],
      },
      {
        title: "Reduce file size",
        links: [
          { page: "compress-image", label: "Target size" },
          { page: "compress-image-to-500kb", label: "Under 500KB" },
          { page: "compress-png", label: "Compress PNG" },
          { page: "signature-resizer", label: "Resize a signature" },
        ],
      },
      {
        title: "Remove information",
        links: [{ page: "remove-exif", label: "Remove metadata" }],
      },
    ],
    analyzePrompt: "Check format and size",
    analyzeLinkLabel: "Analyze an image",
    limitationsHeading: "Good to know",
    limitations: [
      "Reaching an exact target file size is not guaranteed on the target-size and 500KB pages.",
      "Compression and conversion can change image quality, dimensions, or transparency.",
      "Metadata removal keeps a minimal orientation tag and the color profile; it does not guarantee removal of every possible identifying detail.",
      "Keep a copy of your original image and check each result before you rely on it.",
    ],
    analyzeHeading: "Select an image to analyze",
    analyzeParagraph:
      "Before using the tools above, you can also just select an image to check its format, size, and dimensions. Analysis alone won't convert, compress, or remove anything.",
    faqHeading: FAQ_HEADING,
    faq: [
      {
        question: "Do I need to create an account or install anything?",
        answer:
          "No. Every tool runs directly in your browser; there's nothing to install and no account is required.",
      },
      {
        question: "Are my images uploaded anywhere?",
        answer:
          "No. LimiFile's tools process images on your device using a background Worker; the image data is not sent to a server.",
      },
      {
        question: "Which tool should I use to shrink a photo for email or messaging?",
        answer:
          "Use compress to a target size if you know the exact limit, or compress under 500KB for a quick one-tap result.",
      },
      {
        question: "Does LimiFile work on mobile browsers?",
        answer:
          "The tools are built to run in modern desktop and mobile browsers. A few tools need Worker, WebAssembly, or OffscreenCanvas support, and will tell you if your browser doesn't support them.",
      },
      {
        question: "Can I process multiple images at once?",
        answer:
          "You can select multiple files, but each tool processes them one at a time in the order you start them, not simultaneously.",
      },
    ],
  },
  tools: {
    "heic-to-jpg": {
      intro: [
        {
          type: "text",
          text: "Convert iPhone HEIC or HEIF photos to JPG without leaving your browser. Conversion runs in a background Worker, so the page doesn't freeze while it works.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Detects HEIC/HEIF files from their actual file structure, not just the file extension.",
        "Converts to JPG at a fixed quality setting suited for sharing and compatibility.",
        "Handles multiple files in one session, each with its own thumbnail and download button.",
        "Runs entirely in a Dedicated Worker using WebAssembly — nothing is uploaded.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select or drag in one or more HEIC/HEIF files.",
        "Wait for each file to convert — files are processed one at a time.",
        "Preview the converted JPG and download it, individually or all at once.",
        "Remove a file from the list if you want to start over with a different image.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "Only files LimiFile detects as HEIC/HEIF are accepted; AVIF and other formats are rejected even when their structure is similar.",
        "Output quality is fixed and can't be adjusted from this page.",
        "Converting to JPG re-encodes the image, which drops the original EXIF data — including orientation and location — as a result; this page doesn't preserve or restore it.",
        "Very large files (over 50MB) or images with unusually large pixel dimensions are rejected for safety.",
        "If your browser doesn't support Worker, WebAssembly, or OffscreenCanvas, this tool won't run.",
      ],
      technicalNote: [
        [
          {
            type: "text",
            text: "This feature uses WebAssembly that includes libheif 1.19.7 and libde265 1.0.15, both provided under the GNU Lesser General Public License version 3 (LGPL v3). For license details, the corresponding source, and rebuild/relink instructions, see the ",
          },
          {
            type: "pageLink",
            page: "licenses",
            anchor: "heic-heading",
            label: "open source license list",
          },
          { type: "text", text: " and the " },
          {
            type: "externalLink",
            href: "/source/filefit-heic-decoder-1.0.0-source.tar.gz",
            label: "corresponding source package",
          },
          {
            type: "text",
            text: ". This package is provided based on LimiFile's own technical and license self-review, and is not legal advice or a guarantee of legal sufficiency.",
          },
        ],
      ],
      specsHeading: SPECS_HEADING,
      specs: [
        { label: "Input", value: "HEIC, HEIF — detected by file structure, not by file extension" },
        { label: "Output", value: "JPG at a fixed quality setting suited for sharing" },
        { label: "Files at once", value: "Multiple, each with its own thumbnail and download" },
        { label: "Processing", value: "Dedicated Worker, WebAssembly, on this device" },
        { label: "Uploaded to a server", value: "Never" },
        { label: "Decoder", value: "libheif 1.19.7 / libde265 1.0.15" },
      ],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "HEIC decoding and JPG encoding both happen in a Dedicated Worker running in your browser. Your photos are never sent to LimiFile's servers or any third party.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "Why won't my iPhone photo open in some apps or websites?",
          answer:
            "Many non-Apple apps and older software don't support HEIC/HEIF. Converting to JPG makes the photo openable almost everywhere.",
        },
        {
          question: "Will the converted JPG keep my photo's location or camera details?",
          answer:
            "No. Converting to JPG re-encodes the image, which drops the original EXIF data — including GPS location — as a side effect. This page isn't a dedicated metadata-removal tool, but the output won't carry the original HEIC's metadata either.",
        },
        {
          question: "Can I convert several HEIC photos at the same time?",
          answer:
            "You can select several files at once, but they're converted one at a time in the background, not simultaneously.",
        },
        {
          question: "Why did conversion fail for one of my files?",
          answer:
            "The file might not actually be HEIC/HEIF, might exceed the size limit, or might have very large pixel dimensions. Other files in your selection still convert independently.",
        },
        {
          question: "Does this tool use any third-party code?",
          answer:
            "Yes — HEIC decoding uses a WebAssembly build of libheif and libde265 under the LGPL v3 license. See the open source license list and source package for details.",
        },
        {
          question: "Is my photo uploaded to a server during conversion?",
          answer:
            "No. Conversion runs in a Dedicated Worker inside your browser; the image is never sent anywhere.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image", label: "Compress an image" },
        { page: "compress-image-to-500kb", label: "Compress under 500KB" },
        { page: "remove-exif", label: "Remove metadata" },
        { page: "png-to-jpg", label: "Convert PNG to JPG" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "compress-image": {
      intro: [
        {
          type: "text",
          text: "Compress — or resize — a JPEG, HEIC, or WebP image toward a target size you choose in KB or MB, entirely in your browser. If you're looking to reduce image size in KB to fit an exact limit, pick a target below and go.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts JPEG and static WebP directly; HEIC/HEIF is converted to JPEG first, then compressed.",
        "You set the target size yourself, in KB or MB, from 10KB up to 50MB — useful when you need to resize an image in KB for a specific upload limit.",
        "Adjusts quality first, and only resizes the image if quality adjustment alone can't reach the target.",
        "Keeps the output format tied to the source: JPEG and HEIC-derived images become JPEG, WebP stays WebP.",
        "Prefer a common size instead of typing one in? Jump straight to a fixed-target page like 20KB, 50KB, 100KB, or 200KB below.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select a JPEG, HEIC/HEIF, or WebP image.",
        "Enter a target size in KB or MB, or choose one of the presets.",
        "Press compress and wait for the result.",
        "Compare the output size and preview against the original before downloading.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "Reaching the exact target size is not guaranteed; if it can't be reached, the result is marked as unreachable instead of silently returning an oversized file.",
        "PNG is not supported on this page — use PNG target-size compression instead.",
        "Animated WebP is not supported and is rejected before compression starts.",
        "If the target size is already larger than the original file, the original file is returned unchanged.",
        "Compression can change image quality and, in some cases, the image's pixel dimensions.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Compression runs in a Dedicated Worker in your browser using Canvas and OffscreenCanvas. Images are never uploaded to a server.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "What happens if LimiFile can't reach my target size?",
          answer:
            "The result is marked as unable to reach the target instead of being silently returned oversized, so you can decide whether to use it, lower your target, or try a different tool.",
        },
        {
          question: "Can I compress a PNG here?",
          answer:
            "No, PNG isn't accepted on this page. Use PNG target-size compression, which keeps the file as PNG.",
        },
        {
          question: "Will compressing change how my photo looks?",
          answer:
            "Possibly. LimiFile adjusts quality first and only resizes the image if quality adjustment alone can't reach your target size.",
        },
        {
          question: "What's the difference between this page and the 500KB page?",
          answer:
            "This page lets you set any target size yourself. The 500KB page uses a fixed 500KB target with one tap and also accepts PNG.",
        },
        {
          question: "Does this tool support animated WebP?",
          answer: "No, animated WebP is detected and rejected before compression starts.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image-to-500kb", label: "Compress under 500KB" },
        { page: "compress-png", label: "PNG target-size compression" },
        { page: "remove-exif", label: "Remove metadata" },
        { page: "webp-to-jpg", label: "Convert WebP to JPG" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [
        { page: "compress-image-to-20kb", label: "Compress to 20KB" },
        { page: "compress-image-to-50kb", label: "Compress to 50KB" },
        { page: "compress-image-to-100kb", label: "Compress to 100KB" },
        { page: "compress-image-to-200kb", label: "Compress to 200KB" },
        { page: "compress-image-to-500kb", label: "Compress under 500KB" },
      ],
    },
    "compress-image-to-500kb": {
      intro: [
        {
          type: "text",
          text: "Compress a JPEG, HEIC, WebP, or PNG image toward a fixed 500KB target with one tap — there's no target size to configure.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts JPEG, HEIC/HEIF (converted to JPEG first), WebP, and PNG on one page.",
        "Uses a fixed target of exactly 500KB (500,000 bytes) for every file — there's nothing to set.",
        "Keeps the source format: JPEG/HEIC stays JPEG, WebP stays WebP, PNG stays PNG.",
        "Processes files one at a time even when formats are mixed, so results stay predictable.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select one or more JPEG, HEIC/HEIF, WebP, or PNG images.",
        "Press compress for each file — the 500KB target is applied automatically.",
        "Check the resulting file size and preview.",
        "Download the result, or try a different tool if the target wasn't reached.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "500KB means exactly 500,000 bytes, not 512 KiB, and reaching it is not guaranteed for every image.",
        "PNG compression uses color-count reduction, which can visibly change semi-transparent or gradient areas.",
        "Animated WebP and animated PNG (APNG) are both unsupported.",
        "If your original file is already under 500KB, it's returned unchanged rather than re-encoded.",
        "The target size can't be changed on this page — use compress to a target size or PNG target-size compression if you need a different limit.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Every format is compressed in a Dedicated Worker in your browser; nothing is uploaded to a server.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "Why is the target fixed at 500KB?",
          answer:
            "This page is built for a quick, no-configuration result. If you need a different size, use compress to a target size or PNG target-size compression, which let you set your own value.",
        },
        {
          question: "Does compressing a PNG here ever convert it to WebP?",
          answer:
            "No. PNG stays PNG on this page; it's never automatically converted to another format.",
        },
        {
          question: "What if my image is already smaller than 500KB?",
          answer: "It's returned as-is without being re-encoded.",
        },
        {
          question: "Can I mix JPEG and PNG files in the same batch?",
          answer:
            "Yes. Each file is compressed with the engine that matches its format, one file at a time.",
        },
        {
          question: "Is reaching 500KB guaranteed?",
          answer:
            "No — for some images, especially already-compressed or high-detail ones, the target may not be reachable.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image", label: "Compress to a target size" },
        { page: "compress-png", label: "PNG target-size compression" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [
        { page: "compress-image-to-20kb", label: "Compress to 20KB" },
        { page: "compress-image-to-50kb", label: "Compress to 50KB" },
        { page: "compress-image-to-100kb", label: "Compress to 100KB" },
        { page: "compress-image-to-200kb", label: "Compress to 200KB" },
      ],
    },
    "compress-image-to-20kb": {
      intro: [
        {
          type: "text",
          text: "Compress a JPEG, HEIC, WebP, or PNG image toward a fixed 20KB target with one tap — built for strict upload limits like ID photos, exam portals, and forms.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts JPEG, HEIC/HEIF (converted to JPEG first), WebP, and PNG on one page.",
        "Uses a fixed target of exactly 20KB (20,000 bytes) for every file — there's nothing to set.",
        "Keeps the source format: JPEG/HEIC stays JPEG, WebP stays WebP, PNG stays PNG.",
        "Processes files one at a time even when formats are mixed, so results stay predictable.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select one or more JPEG, HEIC/HEIF, WebP, or PNG images.",
        "Press compress for each file — the 20KB target is applied automatically.",
        "Check the resulting file size and preview.",
        "Download the result, or try a different tool if the target wasn't reached.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "20KB means exactly 20,000 bytes, not a 20 KiB target, and reaching it is not guaranteed for every image.",
        "Such a small target usually requires noticeable quality loss and, often, resizing the image's dimensions.",
        "PNG compression uses color-count reduction, which can visibly change semi-transparent or gradient areas.",
        "Animated WebP and animated PNG (APNG) are both unsupported.",
        "If your original file is already under 20KB, it's returned unchanged rather than re-encoded.",
        "The target size can't be changed on this page — use compress to a target size if you need a different limit.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Every format is compressed in a Dedicated Worker in your browser; nothing is uploaded to a server.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "Why would I need an image this small?",
          answer:
            "Many application forms, exam registration portals, and ID-upload systems cap photo uploads at a small fixed size like 20KB. This page targets that exact limit without extra configuration.",
        },
        {
          question: "Will a 20KB photo still look acceptable?",
          answer:
            "It depends on the original image. Reaching 20KB usually means visible quality loss and a smaller pixel size — check the preview before relying on the result.",
        },
        {
          question: "What if my image is already smaller than 20KB?",
          answer: "It's returned as-is without being re-encoded.",
        },
        {
          question: "Is reaching 20KB guaranteed?",
          answer:
            "No — for some images, especially high-detail or already-compressed ones, a 20KB target may not be reachable at all.",
        },
        {
          question: "Can I pick a different fixed size instead?",
          answer:
            "Yes — see the other target sizes below, or set a custom value on compress to a target size.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image", label: "Compress to a target size" },
        { page: "compress-png", label: "PNG target-size compression" },
        { page: "remove-exif", label: "Remove metadata" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [
        { page: "compress-image-to-50kb", label: "Compress to 50KB" },
        { page: "compress-image-to-100kb", label: "Compress to 100KB" },
        { page: "compress-image-to-200kb", label: "Compress to 200KB" },
        { page: "compress-image-to-500kb", label: "Compress under 500KB" },
      ],
    },
    "compress-image-to-50kb": {
      intro: [
        {
          type: "text",
          text: "Compress a JPEG, HEIC, WebP, or PNG image toward a fixed 50KB target with one tap — built for strict upload limits like ID photos, exam portals, and forms.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts JPEG, HEIC/HEIF (converted to JPEG first), WebP, and PNG on one page.",
        "Uses a fixed target of exactly 50KB (50,000 bytes) for every file — there's nothing to set.",
        "Keeps the source format: JPEG/HEIC stays JPEG, WebP stays WebP, PNG stays PNG.",
        "Processes files one at a time even when formats are mixed, so results stay predictable.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select one or more JPEG, HEIC/HEIF, WebP, or PNG images.",
        "Press compress for each file — the 50KB target is applied automatically.",
        "Check the resulting file size and preview.",
        "Download the result, or try a different tool if the target wasn't reached.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "50KB means exactly 50,000 bytes, not a 50 KiB target, and reaching it is not guaranteed for every image.",
        "Reaching this target usually requires quality loss and, for detailed images, resizing the dimensions.",
        "PNG compression uses color-count reduction, which can visibly change semi-transparent or gradient areas.",
        "Animated WebP and animated PNG (APNG) are both unsupported.",
        "If your original file is already under 50KB, it's returned unchanged rather than re-encoded.",
        "The target size can't be changed on this page — use compress to a target size if you need a different limit.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Every format is compressed in a Dedicated Worker in your browser; nothing is uploaded to a server.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "Why would I need an image this small?",
          answer:
            "Many application forms, exam registration portals, and ID-upload systems cap photo uploads at a small fixed size like 50KB. This page targets that exact limit without extra configuration.",
        },
        {
          question: "Will a 50KB photo still look acceptable?",
          answer:
            "Usually yes for typical portrait or document photos, though very detailed images may lose noticeable quality — check the preview before relying on the result.",
        },
        {
          question: "What if my image is already smaller than 50KB?",
          answer: "It's returned as-is without being re-encoded.",
        },
        {
          question: "Is reaching 50KB guaranteed?",
          answer:
            "No — for some images, especially high-detail or already-compressed ones, a 50KB target may not be reachable at all.",
        },
        {
          question: "Can I pick a different fixed size instead?",
          answer:
            "Yes — see the other target sizes below, or set a custom value on compress to a target size.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image", label: "Compress to a target size" },
        { page: "compress-png", label: "PNG target-size compression" },
        { page: "remove-exif", label: "Remove metadata" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [
        { page: "compress-image-to-20kb", label: "Compress to 20KB" },
        { page: "compress-image-to-100kb", label: "Compress to 100KB" },
        { page: "compress-image-to-200kb", label: "Compress to 200KB" },
        { page: "compress-image-to-500kb", label: "Compress under 500KB" },
      ],
    },
    "compress-image-to-100kb": {
      intro: [
        {
          type: "text",
          text: "Compress a JPEG, HEIC, WebP, or PNG image toward a fixed 100KB target with one tap — built for upload limits on forms, portals, and profile photos.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts JPEG, HEIC/HEIF (converted to JPEG first), WebP, and PNG on one page.",
        "Uses a fixed target of exactly 100KB (100,000 bytes) for every file — there's nothing to set.",
        "Keeps the source format: JPEG/HEIC stays JPEG, WebP stays WebP, PNG stays PNG.",
        "Processes files one at a time even when formats are mixed, so results stay predictable.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select one or more JPEG, HEIC/HEIF, WebP, or PNG images.",
        "Press compress for each file — the 100KB target is applied automatically.",
        "Check the resulting file size and preview.",
        "Download the result, or try a different tool if the target wasn't reached.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "100KB means exactly 100,000 bytes, not a 100 KiB target, and reaching it is not guaranteed for every image.",
        "PNG compression uses color-count reduction, which can visibly change semi-transparent or gradient areas.",
        "Animated WebP and animated PNG (APNG) are both unsupported.",
        "If your original file is already under 100KB, it's returned unchanged rather than re-encoded.",
        "The target size can't be changed on this page — use compress to a target size if you need a different limit.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Every format is compressed in a Dedicated Worker in your browser; nothing is uploaded to a server.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "Why is the target fixed at 100KB?",
          answer:
            "This page is built for a quick, no-configuration result at a size commonly required by application forms and upload portals. For a different size, use compress to a target size.",
        },
        {
          question: "Does compressing a PNG here ever convert it to WebP?",
          answer:
            "No. PNG stays PNG on this page; it's never automatically converted to another format.",
        },
        {
          question: "What if my image is already smaller than 100KB?",
          answer: "It's returned as-is without being re-encoded.",
        },
        {
          question: "Can I mix JPEG and PNG files in the same batch?",
          answer:
            "Yes. Each file is compressed with the engine that matches its format, one file at a time.",
        },
        {
          question: "Is reaching 100KB guaranteed?",
          answer:
            "No — for some images, especially already-compressed or high-detail ones, the target may not be reachable.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image", label: "Compress to a target size" },
        { page: "compress-png", label: "PNG target-size compression" },
        { page: "remove-exif", label: "Remove metadata" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [
        { page: "compress-image-to-20kb", label: "Compress to 20KB" },
        { page: "compress-image-to-50kb", label: "Compress to 50KB" },
        { page: "compress-image-to-200kb", label: "Compress to 200KB" },
        { page: "compress-image-to-500kb", label: "Compress under 500KB" },
      ],
    },
    "compress-image-to-200kb": {
      intro: [
        {
          type: "text",
          text: "Compress a JPEG, HEIC, WebP, or PNG image toward a fixed 200KB target with one tap — built for upload limits on forms, portals, and profile photos.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts JPEG, HEIC/HEIF (converted to JPEG first), WebP, and PNG on one page.",
        "Uses a fixed target of exactly 200KB (200,000 bytes) for every file — there's nothing to set.",
        "Keeps the source format: JPEG/HEIC stays JPEG, WebP stays WebP, PNG stays PNG.",
        "Processes files one at a time even when formats are mixed, so results stay predictable.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select one or more JPEG, HEIC/HEIF, WebP, or PNG images.",
        "Press compress for each file — the 200KB target is applied automatically.",
        "Check the resulting file size and preview.",
        "Download the result, or try a different tool if the target wasn't reached.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "200KB means exactly 200,000 bytes, not a 200 KiB target, and reaching it is not guaranteed for every image.",
        "PNG compression uses color-count reduction, which can visibly change semi-transparent or gradient areas.",
        "Animated WebP and animated PNG (APNG) are both unsupported.",
        "If your original file is already under 200KB, it's returned unchanged rather than re-encoded.",
        "The target size can't be changed on this page — use compress to a target size if you need a different limit.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Every format is compressed in a Dedicated Worker in your browser; nothing is uploaded to a server.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "Why is the target fixed at 200KB?",
          answer:
            "This page is built for a quick, no-configuration result at a size commonly required by application forms and upload portals. For a different size, use compress to a target size.",
        },
        {
          question: "Does compressing a PNG here ever convert it to WebP?",
          answer:
            "No. PNG stays PNG on this page; it's never automatically converted to another format.",
        },
        {
          question: "What if my image is already smaller than 200KB?",
          answer: "It's returned as-is without being re-encoded.",
        },
        {
          question: "Can I mix JPEG and PNG files in the same batch?",
          answer:
            "Yes. Each file is compressed with the engine that matches its format, one file at a time.",
        },
        {
          question: "Is reaching 200KB guaranteed?",
          answer:
            "No — for some images, especially already-compressed or high-detail ones, the target may not be reachable.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image", label: "Compress to a target size" },
        { page: "compress-png", label: "PNG target-size compression" },
        { page: "remove-exif", label: "Remove metadata" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [
        { page: "compress-image-to-20kb", label: "Compress to 20KB" },
        { page: "compress-image-to-50kb", label: "Compress to 50KB" },
        { page: "compress-image-to-100kb", label: "Compress to 100KB" },
        { page: "compress-image-to-500kb", label: "Compress under 500KB" },
      ],
    },
    "remove-exif": {
      intro: [
        {
          type: "text",
          text: "Remove metadata — such as GPS location, camera model, and timestamps — from a JPEG or HEIC photo, without re-encoding the image.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts JPEG directly, and HEIC/HEIF by converting to JPEG first.",
        "Edits the JPEG file at the metadata-segment level instead of re-encoding, so pixel data is untouched.",
        "Removes EXIF (including GPS), XMP, embedded thumbnails, Photoshop/IPTC data, and comment segments.",
        "Keeps only a minimal orientation tag when the photo needs it, plus the ICC color profile for accurate colors.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select one or more JPEG or HEIC/HEIF photos.",
        "Start metadata removal for each file.",
        "Check the result panel, which shows whether orientation or the color profile was kept.",
        "Download the cleaned file.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "Only JPEG and HEIC/HEIF are accepted; PNG and WebP are not supported on this page.",
        "This tool intentionally keeps a single orientation tag when the photo needs it, and keeps the ICC color profile — it does not strip literally everything.",
        "File name and the image content itself are not metadata and are not affected by this tool.",
        "This is not a guarantee that every possible identifying detail is removed from the file.",
        "Image dimensions never change, since the pixel data isn't re-encoded.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Metadata removal happens in a Dedicated Worker in your browser, using direct byte-level editing rather than a canvas re-encode. Images are never uploaded to a server.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "Does this remove GPS location data?",
          answer: "Yes. GPS and all other EXIF fields are removed by default.",
        },
        {
          question: "Will my photo end up rotated the wrong way?",
          answer:
            "No — if the original had non-default orientation data, a minimal orientation tag is kept so the photo still displays right-side up.",
        },
        {
          question: "Does this count as full anonymization?",
          answer:
            "No. It removes identifying metadata like GPS, camera info, and timestamps, but it doesn't touch the image content itself, and it isn't a guarantee that no identifying detail remains.",
        },
        {
          question: "Why does the result still have a color profile?",
          answer:
            "The ICC color profile is kept intentionally, since it affects how colors are displayed rather than identifying you.",
        },
        {
          question: "Can I use this on a PNG?",
          answer: "No, this page only accepts JPEG and HEIC/HEIF.",
        },
        {
          question: "Does removing metadata change the image quality?",
          answer:
            "No — this tool doesn't re-encode the image, so the pixel data and dimensions stay exactly the same.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "heic-to-jpg", label: "Convert HEIC to JPG" },
        { page: "compress-image", label: "Compress an image" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "png-to-webp": {
      intro: [
        {
          type: "text",
          text: "Convert a PNG image to WebP in your browser, keeping transparency, at one of three quality presets.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts PNG only, detected from the actual file structure.",
        "Converts to WebP at your choice of high, standard, or light quality — a single encode, not a target-size search.",
        "Preserves image dimensions; this tool never resizes.",
        "Built to keep transparency intact through the conversion.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select one or more PNG images.",
        "Choose a quality preset: high, standard, or light.",
        "Convert and compare the resulting file size against the original.",
        "Download the WebP file.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "Only PNG is accepted; JPEG, HEIC, and WebP are not supported as input on this page.",
        "Animated PNG (APNG) is detected and rejected — this tool only handles static images.",
        "This is a fixed-quality conversion, not a target-size search; it won't get you to a specific output size directly.",
        "A smaller output file is not guaranteed for every image.",
        "Image dimensions are never changed by this tool.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Conversion runs in a Dedicated Worker in your browser using Canvas. Your images are never uploaded to a server.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "Will my PNG's transparency survive the conversion?",
          answer:
            "Yes, the conversion is built to preserve transparency through to the WebP output.",
        },
        {
          question: "Can I convert an animated PNG?",
          answer: "No, animated PNG (APNG) is detected and rejected before conversion.",
        },
        {
          question: "Which quality preset should I choose?",
          answer:
            "Standard is the default and a reasonable balance; choose high quality for archival use or light for the smallest files.",
        },
        {
          question: "Does this tool guarantee a smaller file?",
          answer:
            "No — most PNGs shrink when converted to WebP, but it isn't guaranteed for every image.",
        },
        {
          question: "Can I get a specific output size instead of a quality preset?",
          answer:
            "Not from this page. This is a fixed-quality conversion; there's no target-size search here.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-png", label: "PNG target-size compression" },
        { page: "compress-image", label: "Compress an image" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "compress-png": {
      intro: [
        {
          type: "text",
          text: "Compress a PNG toward a target size you choose, in KB or MB, while staying PNG.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts PNG only, and always outputs PNG — never auto-converted to WebP.",
        "Reduces the image's color count in steps to shrink the file, only resizing dimensions if color reduction alone isn't enough.",
        "Supports transparency, including fully transparent pixels.",
        "You set the target size yourself, in KB or MB, using the same range as target-size compression.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select one or more PNG images.",
        "Enter a target size in KB or MB, or choose a preset.",
        "Compress and check whether the target was reached.",
        "If it wasn't reached, download the best candidate produced, or try lowering your target.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "Reaching the exact target size is not guaranteed; if no candidate meets it, you're offered the best available result instead.",
        "Animated PNG (APNG) is not supported.",
        "Color-count reduction can visibly change semi-transparent areas and gradients, even though fully transparent and fully opaque pixels are handled reliably.",
        "Processing a single image can take up to about 18 seconds before it times out.",
        "If you want to convert to WebP instead of staying PNG, use PNG to WebP conversion.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Compression runs in a Dedicated Worker in your browser. PNG images are never uploaded externally.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "Why does my compressed PNG look different in gradient areas?",
          answer:
            "This tool reduces the number of colors used to shrink the file, and that can visibly affect semi-transparent or gradient regions, even though fully transparent and fully opaque areas stay reliable.",
        },
        {
          question: "What happens if the target size can't be reached?",
          answer:
            "You're offered the closest candidate that was produced, clearly marked as not reaching your target, instead of a silent failure.",
        },
        {
          question: "Does this ever convert my PNG to WebP?",
          answer:
            "No. This page always keeps the output as PNG. Use PNG to WebP conversion if you want WebP instead.",
        },
        {
          question: "Is there a time limit?",
          answer:
            "Yes, processing a single image can take up to about 18 seconds before it times out.",
        },
        {
          question: "Can I use this for animated PNGs?",
          answer: "No, animated PNG (APNG) files are rejected before compression starts.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "png-to-webp", label: "Convert PNG to WebP" },
        { page: "compress-image", label: "Compress an image" },
        { page: "png-to-jpg", label: "Convert PNG to JPG" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "png-to-jpg": {
      intro: [
        {
          type: "text",
          text: "Convert a PNG image to JPG (JPEG) in your browser, at one of three quality presets. Since JPG can't hold transparency, transparent areas are filled with a background color you choose (white by default) before conversion.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts PNG only, detected from the actual file structure.",
        "Converts to JPG at your choice of high, standard, or light quality — a single encode, not a target-size search.",
        "Fills transparent areas with a background color you pick, defaulting to white, since JPG has no alpha channel.",
        "Preserves image dimensions; this tool never resizes.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select one or more PNG images.",
        "Choose a quality preset: high, standard, or light.",
        "Pick a background color for any transparent areas, or keep the white default.",
        "Convert and download the resulting JPG file.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "Only PNG is accepted; JPEG, HEIC, and WebP are not supported as input on this page.",
        "Animated PNG (APNG) is detected and rejected — this tool only handles static images.",
        "JPG has no transparency; transparent and semi-transparent pixels are flattened onto the background color you choose, and that can't be undone after conversion.",
        "This is a fixed-quality conversion, not a target-size search; it won't get you to a specific output size directly.",
        "Image dimensions are never changed by this tool.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Conversion runs in a Dedicated Worker in your browser using Canvas. Your images are never uploaded to a server.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "What happens to my PNG's transparency?",
          answer:
            "JPG can't store transparency, so any transparent or semi-transparent pixels are filled with the background color you choose before conversion (white by default).",
        },
        {
          question: "Can I change the background color?",
          answer:
            "Yes — pick any color before converting using the color picker in the conversion panel; white is used if you don't change it.",
        },
        {
          question: "Can I convert an animated PNG?",
          answer: "No, animated PNG (APNG) is detected and rejected before conversion.",
        },
        {
          question: "Which quality preset should I choose?",
          answer:
            "Standard is the default and a reasonable balance; choose high quality when preserving visual detail matters, or light for the smallest files.",
        },
        {
          question: "Why would I choose JPG instead of WebP for a PNG?",
          answer:
            "JPG (JPEG) is a widely supported image format. If you want to keep transparency instead of filling it with a background color, use PNG to WebP conversion.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "png-to-webp", label: "Convert PNG to WebP instead" },
        { page: "compress-png", label: "Keep PNG but compress it" },
        { page: "compress-image", label: "Compress the JPG further" },
        { page: "avif-to-jpg", label: "Convert AVIF to JPG instead" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "webp-to-jpg": {
      intro: [
        {
          type: "text",
          text: "Convert a WebP image to JPG (JPEG) in your browser, at one of three quality presets. Transparent areas are filled with a background color you choose (white by default), and animated WebP is detected and rejected.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts WebP only, detected from the actual file structure — both regular and transparent WebP.",
        "Converts to JPG at your choice of high, standard, or light quality — a single encode, not a target-size search.",
        "Fills transparent areas with a background color you pick, defaulting to white, since JPG has no alpha channel.",
        "Preserves image dimensions; this tool never resizes.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select one or more WebP images.",
        "Choose a quality preset: high, standard, or light.",
        "Pick a background color for any transparent areas, or keep the white default.",
        "Convert and download the resulting JPG file.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "Only WebP is accepted; JPEG, HEIC, and PNG are not supported as input on this page.",
        "Animated WebP is detected and rejected before conversion — this tool only converts a single static image, and doesn't attempt to preserve any animation.",
        "JPG has no transparency; transparent and semi-transparent pixels are flattened onto the background color you choose, and that can't be undone after conversion.",
        "This is a fixed-quality conversion, not a target-size search; it won't get you to a specific output size directly.",
        "Image dimensions are never changed by this tool.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Conversion runs in a Dedicated Worker in your browser using Canvas. Your images are never uploaded to a server.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "Does this keep my WebP's transparency?",
          answer:
            "No — JPG can't store transparency. Transparent and semi-transparent areas are filled with the background color you choose (white by default) before conversion.",
        },
        {
          question: "Can I convert an animated WebP?",
          answer:
            "No. Animated WebP is detected and rejected before conversion; only static WebP images are converted, and no attempt is made to keep any animation.",
        },
        {
          question: "Can I change the background color?",
          answer:
            "Yes — pick any color before converting using the color picker in the conversion panel; white is used if you don't change it.",
        },
        {
          question: "Which quality preset should I choose?",
          answer:
            "Standard is the default and a reasonable balance; choose high quality when preserving visual detail matters, or light for the smallest files.",
        },
        {
          question: "Why convert WebP to JPG?",
          answer:
            "JPG opens reliably in almost every app and website, including some older or third-party software that doesn't support WebP.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image", label: "Compress the JPG further" },
        { page: "heic-to-jpg", label: "Convert HEIC to JPG instead" },
        { page: "png-to-jpg", label: "Convert PNG to JPG instead" },
        { page: "avif-to-jpg", label: "Convert AVIF to JPG instead" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "avif-to-jpg": {
      intro: [
        {
          type: "text",
          text: "Convert an AVIF image to JPG (JPEG) in your browser, at one of three quality presets. Transparent areas are filled with a background color you choose (white by default), and animated AVIF (image sequences) is detected and rejected.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts AVIF only, detected from the actual file structure (ISOBMFF ftyp box) rather than the file extension.",
        "Converts to JPG at your choice of high, standard, or light quality — a single encode, not a target-size search.",
        "Fills transparent areas with a background color you pick, defaulting to white, since JPG has no alpha channel.",
        "Validates the image's declared dimensions before decoding it, and rejects images too large to process safely.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select one or more AVIF images.",
        "Choose a quality preset: high, standard, or light.",
        "Pick a background color for any transparent areas, or keep the white default.",
        "Convert and download the resulting JPG file.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "Only AVIF is accepted; JPEG, HEIC, PNG, and WebP are not supported as input on this page.",
        "Animated AVIF (image sequences) is detected and rejected before conversion — this tool only converts a single static image.",
        "AVIF files over 50MB are rejected before being read into memory, as a safety limit independent of the image's pixel dimensions.",
        "JPG has no transparency; transparent and semi-transparent pixels are flattened onto the background color you choose, and that can't be undone after conversion.",
        "This is a fixed-quality conversion, not a target-size search; it won't get you to a specific output size directly.",
        "Relies on your browser's built-in AVIF decoder; very old browsers that can't decode AVIF at all will report the image as unreadable.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Decoding and conversion both happen in your browser using its built-in AVIF decoder. Your images are never uploaded to a server.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "What happens to my AVIF's transparency?",
          answer:
            "JPG can't store transparency, so any transparent or semi-transparent pixels are filled with the background color you choose before conversion (white by default).",
        },
        {
          question: "Can I change the background color?",
          answer:
            "Yes — pick any color before converting using the color picker in the conversion panel; white is used if you don't change it.",
        },
        {
          question: "Can I convert an animated AVIF?",
          answer:
            "No. Animated AVIF (an image sequence) is detected and rejected before conversion; only a single static image is converted.",
        },
        {
          question: "Which quality preset should I choose?",
          answer:
            "Standard is the default and a reasonable balance; choose high quality when preserving visual detail matters, or light for the smallest files.",
        },
        {
          question: "Why would I convert AVIF to JPG?",
          answer:
            "JPG (JPEG) opens reliably in almost every app, website, and older piece of software, while AVIF support is still inconsistent outside modern browsers.",
        },
        {
          question: "Does every browser support this?",
          answer:
            "Converting requires your browser to be able to decode AVIF itself. Recent versions of Chrome, Firefox, Safari, and Edge support this; if yours doesn't, the image will be reported as unreadable.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "compress-image", label: "Compress the JPG further" },
        { page: "png-to-jpg", label: "Convert PNG to JPG instead" },
        { page: "webp-to-jpg", label: "Convert WebP to JPG instead" },
        { page: "heic-to-jpg", label: "Convert HEIC to JPG instead" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
    "signature-resizer": {
      intro: [
        {
          type: "text",
          text: "Enter the exact width, height, and maximum file size a form requires, and LimiFile resizes your image to fit, compresses it under the limit, and checks each condition against the JPG it actually produced before you download it.",
        },
      ],
      featuresHeading: FEATURES_HEADING,
      features: [
        "Accepts JPEG and PNG, and always outputs JPG (JPEG), since that's what most upload forms require.",
        "Resizes to the exact pixel width and height you enter — either keeping proportions and padding with white, or stretching to fill the size exactly.",
        "Searches JPEG quality (not dimensions, once set) to fit your file size limit, and shows the closest result it could reach if the limit can't be met.",
        "Verifies width, height, file size, and format independently against what the converted file actually measures, and shows a pass/fail result for each — it doesn't assume success.",
        "Fills any transparent areas from a source PNG with white before converting, since JPG has no transparency.",
      ],
      howToHeading: HOW_TO_HEADING,
      howToSteps: [
        "Select a JPEG or PNG image (a signature, photo, or scan).",
        "Enter the width, height, and maximum file size your form specifies.",
        "Choose whether to keep proportions (padded with white) or stretch to the exact size.",
        "Convert, check the pass/fail result for each condition, and download the JPG.",
      ],
      limitationsHeading: LIMITATIONS_HEADING,
      limitations: [
        "Only JPEG and PNG are accepted as input; WebP, HEIC, and AVIF are not supported on this page.",
        'Cropping isn\'t available yet — "Keep proportions" pads with white instead of cropping to fill the exact size; a crop mode is planned for a future update.',
        "Animated PNG (APNG) is not supported.",
        "LimiFile verifies pixel dimensions, file size, and output format only. It cannot verify a form's other requirements — such as what the signature or photo shows, background color, or margins — so always compare the result against your form's full instructions before submitting.",
        "JPEG quality search has a floor; if a very small file size can't be reached at any quality LimiFile currently uses, the closest result is offered instead of a false success.",
        "This tool cannot guarantee any submission will be accepted — it only checks the width, height, file size, and format you told it to check.",
      ],
      technicalNote: [],
      specsHeading: SPECS_HEADING,
      specs: [],
      privacyHeading: PRIVACY_HEADING,
      privacyNote:
        "Resizing and conversion both happen in your browser. Your images are never uploaded to a server.",
      faqHeading: FAQ_HEADING,
      faq: [
        {
          question: "What exact width, height, and file size should I enter?",
          answer:
            "Check the form or website you're submitting to — these requirements vary by organization and aren't standardized, so LimiFile doesn't guess them for you. Enter whatever width, height, and maximum file size that form specifies.",
        },
        {
          question:
            'What\'s the difference between "Keep proportions" and "Stretch to exact size"?',
          answer:
            '"Keep proportions" fits your whole image inside the target size without distorting it, padding any leftover space with white. "Stretch to exact size" fills the target size exactly, which can distort the image if its proportions don\'t match.',
        },
        {
          question: "What happens if my file can't fit under the size limit?",
          answer:
            "LimiFile shows which condition wasn't met and offers the closest result it could produce, at the lowest JPEG quality it currently uses — it won't claim the size limit was met when it wasn't. Try a larger size limit or smaller dimensions if the result isn't usable.",
        },
        {
          question: "Does this guarantee my submission will be accepted?",
          answer:
            "No. LimiFile checks the pixel dimensions, file size, and format you asked it to check — nothing more. It can't verify content-specific requirements like what the photo or signature shows, background color, or margins, so review your form's full instructions before submitting.",
        },
        {
          question: "Can I crop my image before resizing?",
          answer:
            'Not yet. "Keep proportions" avoids distortion by padding instead of cropping. A crop mode is planned for a future update.',
        },
        {
          question: "What happens to transparency in a PNG?",
          answer:
            "The output is always JPG, which has no transparency, so any transparent areas in a source PNG are filled with white before conversion.",
        },
      ],
      relatedHeading: RELATED_HEADING,
      relatedLinks: [
        { page: "heic-to-jpg", label: "Convert an iPhone HEIC photo to JPG first" },
        { page: "compress-image", label: "Just need a file size limit, not exact dimensions?" },
        { page: "png-to-jpg", label: "Convert PNG to JPG without a size requirement" },
      ],
      popularSizesHeading: POPULAR_SIZES_HEADING,
      popularSizesLinks: [],
    },
  },
};

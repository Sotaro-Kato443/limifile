import type { TrustContent } from "../trust-content-types";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "../trust-content-types";

// ページごとに独立した日付を持つ。実質的な内容変更があったページだけを更新するため、
// 共通の定数を複数ページで共有しない(共有すると、変更していないページの日付まで動く)。
const PRIVACY_EFFECTIVE_DATE_LABEL = "Effective date: August 20, 2026";
const TERMS_EFFECTIVE_DATE_LABEL = "Effective date: August 21, 2026";
const CONTACT_EFFECTIVE_DATE_LABEL = "Effective date: August 18, 2026";

export const en: TrustContent = {
  privacy: {
    title: "Privacy Policy",
    description:
      "How LimiFile handles your images and other data when you use LimiFile's browser-based image tools.",
    heading: "Privacy Policy",
    effectiveDateLabel: PRIVACY_EFFECTIVE_DATE_LABEL,
    sections: [
      {
        heading: "1. Overview",
        paragraphs: [
          [
            {
              type: "text",
              text: "LimiFile is a set of browser-based image processing tools. The corresponding processing (format conversion, compression, metadata removal, and so on) runs on your device, inside your browser. LimiFile's application code is not designed to upload the image files you select to a LimiFile server.",
            },
          ],
        ],
      },
      {
        heading: "2. Your selected images",
        paragraphs: [
          [
            {
              type: "text",
              text: "Selected images are analyzed, converted, compressed, or have their metadata processed inside your browser. LimiFile does not currently implement a feature that sends the content of your selected images to a LimiFile server. Reloading the page or closing the tab typically clears this in-browser temporary state. Saving, sharing, or downloading an output file is something you choose to do yourself. LimiFile does not currently have a feature that stores your images in the cloud.",
            },
          ],
        ],
      },
      {
        heading: "3. Ordinary site delivery data",
        paragraphs: [
          [
            {
              type: "text",
              text: "To display this site, your browser retrieves HTML, CSS, JavaScript, WebAssembly, and similar files from our hosting environment. To the extent needed for hosting, security, and handling outages, our hosting/delivery provider may process ordinary request information. This is separate from any upload of your images by LimiFile's application code — as described above, LimiFile's code does not do that.",
            },
          ],
        ],
      },
      {
        heading: "4. Cookies, local storage, and analytics",
        paragraphs: [
          [
            {
              type: "text",
              text: "As of this policy's effective date, LimiFile does not use cookies or browser local storage of its own for analytics, advertising, or account-login purposes. If this changes in the future, we will update this policy.",
            },
          ],
          [
            {
              type: "text",
              text: "To understand how this site is used, we use Cloudflare Web Analytics, provided by the same company that delivers this site. It uses no cookies and no browser local storage, does not fingerprint your device, and does not track you across sites. It records only non-identifying information such as the page viewed, the referring site, country, browser type, and device type. Your images are never part of this measurement.",
            },
          ],
          [
            {
              type: "text",
              text: "To measure whether the image tools operate successfully, we also use Umami Cloud. Automatic pageview tracking is disabled for Umami. LimiFile sends only four tool events: processing started, processing succeeded, processing failed, and output downloaded or saved. Each event contains the tool identifier and, only for a failure, a normalized error category. The tracker is configured to respect your browser's Do Not Track setting.",
            },
          ],
          [
            {
              type: "text",
              text: "When an event is received, Umami creates a periodically changing anonymous session without cookies using information such as the connecting IP address, User-Agent, and website identifier. It also records standard information including the URL path, hostname, and referrer where the event occurred; browser, operating system, device type, screen size, browser language, approximate country, region, and city; and the event time. LimiFile does not set a Umami Distinct ID or another user identifier and does not link a visitor across devices or websites.",
            },
          ],
          [
            {
              type: "text",
              text: "Umami does not receive your selected images, image contents, file names, file sizes, image dimensions, image metadata, output files, or free-form error messages. These measurements do not change where image processing occurs: the image itself remains on your device and is processed inside your browser.",
            },
          ],
        ],
      },
      {
        heading: "5. External links",
        paragraphs: [
          [
            {
              type: "text",
              text: "Some pages on this site link to external websites (for example, official source repositories referenced on the licenses page). Once you leave LimiFile, that site's own privacy policy applies, and LimiFile does not control how that site handles data.",
            },
          ],
        ],
      },
      {
        heading: "6. Contact",
        paragraphs: [
          [
            { type: "text", text: "If you have questions about this policy, contact " },
            { type: "externalLink", href: CONTACT_MAILTO, label: CONTACT_EMAIL },
            { type: "text", text: "." },
          ],
        ],
      },
      {
        heading: "7. Changes to this policy",
        paragraphs: [
          [
            {
              type: "text",
              text: "We may update this policy as LimiFile's features, applicable law, or operations change. Material changes will be noted on this page.",
            },
          ],
        ],
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    description: "The terms that apply when you use LimiFile's browser-based image tools.",
    heading: "Terms of Service",
    effectiveDateLabel: TERMS_EFFECTIVE_DATE_LABEL,
    sections: [
      {
        heading: "1. The service",
        paragraphs: [
          [
            {
              type: "text",
              text: "LimiFile provides browser-based image processing tools. No account is required to use LimiFile. Supported browsers, devices, and image formats are limited — not every combination is supported.",
            },
          ],
        ],
      },
      {
        heading: "2. Your responsibilities",
        paragraphs: [
          [
            {
              type: "text",
              text: "You are responsible for having the necessary rights and permissions for any image you process with LimiFile. Review the output before relying on it. Keep a backup of your original files. Deciding whether it's appropriate to process a sensitive image with LimiFile is your own responsibility.",
            },
          ],
        ],
      },
      {
        heading: "3. Prohibited uses",
        paragraphs: [[{ type: "text", text: "When using LimiFile, please do not:" }]],
        listItems: [
          "Violate applicable law",
          "Infringe the rights of others",
          "Interfere with LimiFile or its hosting/delivery infrastructure",
          "Attempt unauthorized access",
          "Exploit vulnerabilities in LimiFile",
          "Engage in excessive automated access",
          "Distribute malware",
          "Redistribute LimiFile in a way that misrepresents the service",
        ],
      },
      {
        heading: "4. Functional limitations",
        paragraphs: [
          [
            {
              type: "text",
              text: "LimiFile does not guarantee that output will always reach a specified target size. LimiFile does not guarantee that quality, color, transparency, dimensions, or metadata will always turn out exactly as intended. Processing can fail depending on your browser, OS, device, or the image data itself. Some formats — such as animated WebP and APNG — are outside the tools' supported scope. The metadata-removal feature has limits in what it targets and how it's implemented. HEIC conversion is not a dedicated, complete personal-information-removal feature.",
            },
          ],
        ],
      },
      {
        heading: "5. Disclaimer of warranties",
        paragraphs: [
          [
            {
              type: "text",
              text: 'LimiFile is provided "as is." We do not warrant its accuracy, completeness, continued availability, or fitness for a particular purpose. Nothing here is intended to exclude warranties that cannot be excluded under applicable law.',
            },
          ],
        ],
      },
      {
        heading: "6. Limitation of liability",
        paragraphs: [
          [
            {
              type: "text",
              text: "You are responsible for backing up important images and reviewing results. To the extent permitted by applicable law, LimiFile limits its liability for damages related to your use or inability to use the service. This is not intended to exclude liability for intentional misconduct, gross negligence, or anything else that cannot be limited under applicable law.",
            },
          ],
        ],
      },
      {
        heading: "7. Changes and discontinuation",
        paragraphs: [
          [
            {
              type: "text",
              text: "Features may change or be discontinued. Continued availability is not guaranteed.",
            },
          ],
        ],
      },
      {
        heading: "8. Intellectual property and open source",
        paragraphs: [
          [
            {
              type: "text",
              text: "LimiFile's own source code is published under the Apache License 2.0. The LimiFile name, logo, and brand assets are outside that code license, and rights to them are not waived except where explicitly licensed. Open-source components included in LimiFile are governed by their own individual licenses — see ",
            },
            { type: "pageLink", page: "licenses", label: "the open source license list" },
            {
              type: "text",
              text: ". The repository as a whole is not offered under a single license.",
            },
          ],
        ],
      },
      {
        heading: "9. Changes to these terms",
        paragraphs: [
          [
            {
              type: "text",
              text: "We may update these terms as needed. The update date is shown on this page.",
            },
          ],
        ],
      },
      {
        heading: "10. Contact",
        paragraphs: [
          [
            { type: "text", text: "If you have questions about these terms, contact " },
            { type: "externalLink", href: CONTACT_MAILTO, label: CONTACT_EMAIL },
            { type: "text", text: "." },
          ],
        ],
      },
    ],
  },
  contact: {
    title: "Contact",
    description:
      "How to reach LimiFile about bugs, display issues, accessibility, licensing, or privacy.",
    heading: "Contact",
    effectiveDateLabel: CONTACT_EFFECTIVE_DATE_LABEL,
    sections: [
      {
        heading: "How to reach us",
        paragraphs: [
          [
            { type: "text", text: "Contact email: " },
            { type: "externalLink", href: CONTACT_MAILTO, label: CONTACT_EMAIL },
          ],
          [
            {
              type: "text",
              text: "We accept messages about bugs, display issues, accessibility, licensing, and privacy.",
            },
          ],
        ],
      },
      {
        heading: "Helpful information for bug reports",
        paragraphs: [],
        listItems: [
          "The page URL you were using",
          "Your browser name and version",
          "Your OS and device",
          "The steps you took",
          "Any error message that appeared",
          "The image format involved",
        ],
      },
      {
        heading: "Before you attach anything",
        paragraphs: [
          [
            {
              type: "text",
              text: "Please don't attach images that contain personal or confidential information. If a reproduction image is needed, please use a synthetic image or a sample you have the rights to share.",
            },
          ],
        ],
      },
      {
        heading: "What to expect",
        paragraphs: [],
        listItems: [
          "A reply is not guaranteed.",
          "This is not an emergency contact channel.",
          "This is not a substitute for legal advice, medical advice, or a formal channel to law enforcement.",
        ],
      },
    ],
  },
};

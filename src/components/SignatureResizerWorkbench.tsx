import { ImageDropZone } from "./image-intake/image-drop-zone";
import { formatBytes } from "./image-intake/format-bytes";
import { FORMAT_LABEL } from "./image-intake/image-list-item";
import { SignatureResizerPanel } from "./image-intake/signature-resizer-panel";
import { useImageIntake } from "./image-intake/use-image-intake";
import { useTargetFit } from "./image-intake/use-target-fit";
import { PrivacyNotice } from "./privacy-notice";
import { getDictionary } from "../i18n/get-dictionary";
import type { UseTargetFitResult } from "./image-intake/use-target-fit";
import type { IntakeItem } from "./image-intake/types";
import type { ImplementedLocaleKey } from "../i18n/get-dictionary";
import type { UiDictionary } from "../i18n/schema";

export interface SignatureResizerWorkbenchProps {
  locale: ImplementedLocaleKey;
}

const ALLOWED_SOURCE_FORMATS = ["jpeg", "png"] as const;

function SignatureResizerListItem({
  item,
  onRemove,
  targetFit,
  messages,
}: {
  item: IntakeItem;
  onRemove: (id: string) => void;
  targetFit: UseTargetFitResult;
  messages: UiDictionary;
}) {
  const isDebug = import.meta.env.DEV;
  const eligibility = targetFit.eligibilityFor(item);
  const job = targetFit.jobs[item.id];

  const handleConvert = (request: Parameters<UseTargetFitResult["startTargetFit"]>[1]) => {
    targetFit.startTargetFit(item, request);
  };

  const handleCancel = () => {
    targetFit.cancelTargetFit(item.id);
  };

  const handleRemove = () => {
    targetFit.removeJob(item.id);
    onRemove(item.id);
  };

  return (
    <li class="image-list-item">
      <img class="image-list-item__thumbnail" src={item.objectUrl} alt="" />
      <div class="image-list-item__details">
        <p class="image-list-item__name">{item.file.name}</p>
        <p class="image-list-item__meta">
          <span>{formatBytes(item.file.size)}</span>
          {item.status.kind === "ready" && (
            <span>
              {item.status.dimensions.width}×{item.status.dimensions.height}px
            </span>
          )}
          <span>{item.mimeType || messages.common.mimeUnknown}</span>
        </p>

        {item.status.kind === "analyzing" && (
          <p class="image-list-item__status" role="status">
            {messages.listItem.analyzing}
          </p>
        )}
        {item.status.kind === "raster-too-large" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.rasterTooLarge}
          </p>
        )}
        {item.status.kind === "raster-unsafe-dimensions" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.rasterUnsafeDimensions}
          </p>
        )}
        {item.status.kind === "raster-decode-failed" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.rasterDecodeFailed}
          </p>
        )}
        {item.status.kind === "unsupported-format" && item.detectedFormat === null && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.unsupportedFormat}
          </p>
        )}
        {item.status.kind === "error" && (
          <p class="image-list-item__status image-list-item__status--error" role="alert">
            {messages.intakeErrors.analyzeFailed}
          </p>
        )}
        {item.extensionMismatch && (
          <p class="image-list-item__warning">
            {messages.listItem.extensionMismatch(
              item.extension ?? "?",
              item.detectedFormat
                ? FORMAT_LABEL[item.detectedFormat]
                : messages.common.unknownFormatLabel,
            )}
          </p>
        )}

        {eligibility.kind === "unsupported-format" && (
          <p class="image-list-item__status">{messages.signatureResizer.formatMismatch}</p>
        )}
        {eligibility.kind === "unsupported-browser" && (
          <p class="image-list-item__status image-list-item__status--error">
            {messages.signatureResizer.unsupportedBrowser}
          </p>
        )}

        {eligibility.kind === "ready" && (
          <SignatureResizerPanel
            fileName={item.file.name}
            job={job}
            onConvert={handleConvert}
            onCancel={handleCancel}
            messages={messages}
          />
        )}

        {isDebug && (
          <p class="image-list-item__debug">
            debug: detected={item.detectedFormat ?? "null"} / ext={item.extension ?? "null"}
            {item.status.kind === "error" && ` / raw=${item.status.message}`}
          </p>
        )}
      </div>
      <button
        type="button"
        class="image-list-item__remove"
        onClick={handleRemove}
        aria-label={messages.listItem.removeAriaLabel(item.file.name)}
      >
        {messages.common.remove}
      </button>
    </li>
  );
}

/**
 * 提出条件(幅・高さ・最大ファイルサイズ・形式)を満たすファイルを作るための専用Preactアイランド。
 * /signature-resizer/(EN-only)から読み込まれる。
 *
 * 処理コアはtarget-fit-*.ts(用途非依存の共通コア。署名以外の用途からも再利用できる前提)を
 * そのまま使い、このファイルはSignature Resizer固有のUI配線のみを持つ。
 * useImageIntakeにenableRasterPreDecodeSafety: trueを指定し、JPEG/PNGについても
 * getImageDimensionsより前にheader safety検証を通す(既存の他Workbenchはこのオプションを
 * 指定しないため無変更のまま)。
 */
export function SignatureResizerWorkbench({ locale }: SignatureResizerWorkbenchProps) {
  const { items, addFiles, removeItem, clearAll } = useImageIntake({
    allowedFormats: ["jpeg", "png"],
    enableRasterPreDecodeSafety: true,
  });
  const dictionary = getDictionary(locale);
  const messages = dictionary.ui;
  const targetFit = useTargetFit(messages.signatureResizer.panel.errors, ALLOWED_SOURCE_FORMATS);

  const handleRemove = (id: string) => {
    removeItem(id);
  };

  const handleClearAll = () => {
    targetFit.clearJobs();
    clearAll();
  };

  return (
    <div class="image-workbench">
      <ImageDropZone
        onFiles={addFiles}
        formatsHint="JPEG・PNG"
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
        messages={messages.dropZone}
      />
      <p class="signature-resizer-workbench__note">{messages.signatureResizer.workbenchNote}</p>
      <PrivacyNotice text={dictionary.privacyNotice} />
      {!targetFit.isSupported && (
        <p class="signature-resizer-workbench__unsupported">
          {messages.signatureResizer.unsupportedBrowser}
        </p>
      )}
      {items.length > 0 && (
        <div class="image-list">
          <div class="image-list__header">
            <p class="image-list__count">{messages.imageList.selectedCount(items.length)}</p>
            <button type="button" class="image-list__clear-all" onClick={handleClearAll}>
              {messages.common.removeAll}
            </button>
          </div>
          <ul class="image-list__items">
            {items.map((item) => (
              <SignatureResizerListItem
                key={item.id}
                item={item}
                onRemove={handleRemove}
                targetFit={targetFit}
                messages={messages}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

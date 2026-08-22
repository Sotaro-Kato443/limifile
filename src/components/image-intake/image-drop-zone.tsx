import { useCallback, useId, useState } from "preact/hooks";
import type { TargetedDragEvent, TargetedEvent } from "preact";
import type { UiDictionary } from "../../i18n/schema";

/** accept属性はあくまで選択時の補助。実形式の検証は必ずマジックバイト/ftypボックスで行う */
const ACCEPTED_INPUT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";

const DEFAULT_FORMATS_HINT = "JPG, PNG, WebP, HEIC/HEIF";

export interface ImageDropZoneProps {
  onFiles: (files: FileList) => void;
  messages: UiDictionary["dropZone"];
  /**
   * ヒント文言にだけ使う対応形式の表示テキスト(例: "JPEG・HEIC")。
   * ページごとに実際に処理できる形式を案内するためのもので、input のaccept属性や
   * 実際の解析対象形式(マジックバイト判定)には一切影響しない。
   */
  formatsHint?: string;
  /**
   * input[type=file]のaccept属性を上書きする(例: PNG専用ページでは"image/png,.png")。
   * 省略時は既存の全形式共通値(ACCEPTED_INPUT)を使う。あくまでOSファイル選択ダイアログの
   * 絞り込みヒントに過ぎず、drag&dropではブラウザがこの属性を適用しないため、実形式の検証は
   * 引き続き必ずマジックバイト/ftypボックス(呼び出し側の解析処理)で行うこと。
   */
  accept?: string;
}

export function ImageDropZone({
  onFiles,
  messages,
  formatsHint = DEFAULT_FORMATS_HINT,
  accept = ACCEPTED_INPUT,
}: ImageDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputId = useId();

  const handleInputChange = useCallback(
    (event: TargetedEvent<HTMLInputElement>) => {
      const files = event.currentTarget.files;
      if (files && files.length > 0) {
        onFiles(files);
      }
      event.currentTarget.value = "";
    },
    [onFiles],
  );

  const handleDrop = useCallback(
    (event: TargetedDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        onFiles(files);
      }
    },
    [onFiles],
  );

  const handleDragOver = useCallback((event: TargetedDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  return (
    <div
      class={`image-drop-zone${isDragOver ? " image-drop-zone--active" : ""}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <label class="image-drop-zone__label" for={inputId}>
        <span class="image-drop-zone__icon" aria-hidden="true">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 16V4" />
            <path d="M7 9l5-5 5 5" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        </span>
        <span class="image-drop-zone__title">{messages.selectOrDrop}</span>
        <span class="image-drop-zone__hint">{messages.supportedFormats(formatsHint)}</span>
        {/* labelがクリック対象なので、この擬似ボタンは支援技術に露出させない */}
        <span class="image-drop-zone__cta" aria-hidden="true">
          {messages.chooseFile}
        </span>
      </label>
      <input
        id={inputId}
        class="image-drop-zone__input"
        type="file"
        multiple
        accept={accept}
        onChange={handleInputChange}
      />
    </div>
  );
}

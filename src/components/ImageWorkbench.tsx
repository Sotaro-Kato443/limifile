import { ImageDropZone } from "./image-intake/image-drop-zone";
import { ImageList } from "./image-intake/image-list";
import { useImageIntake } from "./image-intake/use-image-intake";
import { PrivacyNotice } from "./privacy-notice";
import { getDictionary } from "../i18n/get-dictionary";
import type { ImplementedLocaleKey } from "../i18n/get-dictionary";

export interface ImageWorkbenchProps {
  locale: ImplementedLocaleKey;
  /** ドロップゾーンに表示する対応形式の案内文言。ページごとの実際の用途に合わせて上書きできる */
  formatsHint?: string;
}

/**
 * 画像選択・解析UIのルート。全ツールページ(index.astro, /heic-to-jpg 等)から
 * 共通のPreactアイランドとして読み込まれる。処理ロジック自体は持たず、
 * image-intake配下のフック/純粋関数を組み合わせて画面を構成する。
 *
 * localeはこのコンポーネントで一度だけ辞書へ解決し(getDictionary)、以降は解決済みの
 * messagesオブジェクトを子コンポーネントへpropsとして渡す。Astro props経由でlocale
 * (単純な文字列)だけを受け取るのは、辞書のテンプレート文言を関数値として持たせているため
 * (Astroのprops serializationは関数を渡せない)。
 */
export function ImageWorkbench({ locale, formatsHint }: ImageWorkbenchProps) {
  const { items, addFiles, removeItem, clearAll } = useImageIntake({
    trackHeicConversion: true,
  });
  const dictionary = getDictionary(locale);

  return (
    <div class="image-workbench">
      <ImageDropZone
        onFiles={addFiles}
        formatsHint={formatsHint}
        messages={dictionary.ui.dropZone}
      />
      <PrivacyNotice text={dictionary.privacyNotice} />
      <ImageList
        items={items}
        onRemove={removeItem}
        onClearAll={clearAll}
        messages={dictionary.ui}
      />
    </div>
  );
}

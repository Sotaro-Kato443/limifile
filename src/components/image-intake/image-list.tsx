import { ImageListItem } from "./image-list-item";
import type { IntakeItem } from "./types";
import type { UiDictionary } from "../../i18n/schema";

export interface ImageListProps {
  items: IntakeItem[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
  messages: UiDictionary;
}

export function ImageList({ items, onRemove, onClearAll, messages }: ImageListProps) {
  if (items.length === 0) return null;

  return (
    <div class="image-list">
      <div class="image-list__header">
        <p class="image-list__count">{messages.imageList.selectedCount(items.length)}</p>
        <button type="button" class="image-list__clear-all" onClick={onClearAll}>
          {messages.common.removeAll}
        </button>
      </div>
      <ul class="image-list__items">
        {items.map((item) => (
          <ImageListItem key={item.id} item={item} onRemove={onRemove} messages={messages} />
        ))}
      </ul>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { Domain } from "@/api/domains";
import styles from "./NodeEditorModal.module.css";

interface Props {
  nodeId: string;
  title: string;
  tagIds: number[];
  allTags: Domain[];
  onSave: (title: string, tagIds: number[]) => void;
  onClose: () => void;
}

export default function NodeEditorModal({ nodeId: _nodeId, title, tagIds, allTags, onSave, onClose }: Props) {
  const [editTitle, setEditTitle] = useState(title);
  const [editTagIds, setEditTagIds] = useState<number[]>(tagIds);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function toggleTag(tagId: number) {
    setEditTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  }

  function handleSave() {
    if (editTitle.trim() !== "") {
      onSave(editTitle.trim(), editTagIds);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSave();
    }
    if (event.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h2 className={styles.heading}>Edit node</h2>

        <label className={styles.label}>
          Title
          <input
            ref={inputRef}
            className={styles.input}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            type="text"
          />
        </label>

        {allTags.length > 0 && (
          <fieldset className={styles.tagSection}>
            <legend className={styles.label}>Tags</legend>
            <div className={styles.tagList}>
              {allTags.map((tag) => (
                <label key={tag.id} className={styles.tagOption}>
                  <input
                    type="checkbox"
                    checked={editTagIds.includes(tag.id)}
                    onChange={() => toggleTag(tag.id)}
                  />
                  {tag.title}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={styles.saveBtn} type="button" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

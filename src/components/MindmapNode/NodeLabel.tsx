import { useEffect, useRef, useState } from "react";
import type { MindmapNode } from "@/utils/tree-layout";

interface Props {
  node: MindmapNode;
  isEditing: boolean;
  iconWidth: number;
  width: number;
  height: number;
  fontSize: number;
  label: string;
  textFill: string;
  isRtl: boolean;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
}

export default function NodeLabel({ node, isEditing, iconWidth, width, height, fontSize, label, textFill, isRtl, onCommitEdit, onCancelEdit }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Lazy initialiser — correct on first mount; parent re-keys this component
  // when editing starts so this always reflects the committed title.
  const [editLineCount, setEditLineCount] = useState(() => node.title.split("\n").length);

  useEffect(() => {
    if (!isEditing) return;
    const id = setTimeout(() => {
      if (inputRef.current === null) return;
      inputRef.current.focus();
      inputRef.current.select();
    }, 0);
    return () => clearTimeout(id);
  }, [isEditing]);

  const textAreaWidth = width - iconWidth - 4;
  const textX = isRtl ? 4 : iconWidth;

  if (isEditing) {
    // Grow the foreignObject to fit current content so the textarea never scrolls.
    // WebKit mis-positions foreignObject content relative to the document root when
    // the element scrolls inside a CSS-transformed SVG group (animated.g).
    const lineHeightPx = Math.round(fontSize * 1.4);
    const editFoHeight = Math.max(height - 4, editLineCount * lineHeightPx + 8);

    return (
      <foreignObject x={textX} y={2} width={textAreaWidth} height={editFoHeight}>
        <textarea
          ref={inputRef}
          defaultValue={node.title}
          onChange={(e) => setEditLineCount(e.currentTarget.value.split("\n").length)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onCommitEdit(node.id, e.currentTarget.value);
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              onCancelEdit();
            }
          }}
          onBlur={(e) => onCommitEdit(node.id, e.currentTarget.value)}
          style={{ width: "100%", height: "100%", background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontFamily: "var(--font-sans)", fontSize, padding: "0 2px", resize: "none", lineHeight: 1.3, overflow: "hidden" }}
          dir="auto"
        />
      </foreignObject>
    );
  }

  return (
    <foreignObject x={textX} y={4} width={textAreaWidth} height={height - 8} pointerEvents="none">
      <div
        style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", fontSize, color: textFill, fontFamily: "var(--font-sans)", whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "none", pointerEvents: "none", lineHeight: 1.3, direction: isRtl ? "rtl" : "ltr", textAlign: isRtl ? "right" : "left" }}
      >
        {label}
      </div>
    </foreignObject>
  );
}

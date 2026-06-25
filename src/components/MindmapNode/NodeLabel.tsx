import { useEffect, useRef } from "react";
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
    return (
      <foreignObject x={textX} y={2} width={textAreaWidth} height={height - 4}>
        <textarea
          ref={inputRef}
          defaultValue={node.title}
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
          style={{ width: "100%", height: "100%", background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontFamily: "var(--font-sans)", fontSize, padding: "0 2px", resize: "none", lineHeight: 1.3 }}
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

import { useEffect, useRef } from "react";
import type { MindmapNode } from "@/utils/tree-layout";

interface Props {
  node: MindmapNode;
  isEditing: boolean;
  iconWidth: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  editLineCount: number;
  onEditLineCountChange: (count: number) => void;
  label: string;
  textFill: string;
  isRtl: boolean;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
}

export default function NodeLabel({ node, isEditing, iconWidth, width, height, fontSize, lineHeight, editLineCount, onEditLineCountChange, label, textFill, isRtl, onCommitEdit, onCancelEdit }: Props) {
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
  const foHeight = height - 8;
  // Vertical padding that centres the text block within foHeight.
  // Matches between display and edit so the text never jumps on mode change.
  const lineCount = isEditing ? editLineCount : label.split("\n").length;
  const paddingTop = Math.max(0, (foHeight - lineCount * lineHeight) / 2);
  const lineHeightRatio = lineHeight / fontSize;

  if (isEditing) {
    return (
      <foreignObject x={textX} y={4} width={textAreaWidth} height={foHeight}>
        <textarea
          ref={inputRef}
          defaultValue={node.title}
          onChange={(e) => onEditLineCountChange(e.currentTarget.value.split("\n").length)}
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
          style={{ width: "100%", height: "100%", background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontFamily: "var(--font-sans)", fontSize, paddingTop, paddingLeft: 2, paddingRight: 2, paddingBottom: 0, resize: "none", lineHeight: lineHeightRatio, overflow: "hidden", boxSizing: "border-box" }}
          dir="auto"
        />
      </foreignObject>
    );
  }

  return (
    <foreignObject x={textX} y={4} width={textAreaWidth} height={foHeight} pointerEvents="none">
      <div
        style={{ paddingTop, fontSize, color: textFill, fontFamily: "var(--font-sans)", whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "none", pointerEvents: "none", lineHeight: lineHeightRatio, direction: isRtl ? "rtl" : "ltr", textAlign: isRtl ? "right" : "left" }}
      >
        {label}
      </div>
    </foreignObject>
  );
}

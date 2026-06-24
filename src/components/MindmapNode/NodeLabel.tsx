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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) return;
    const id = setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
    return () => clearTimeout(id);
  }, [isEditing]);

  const textAreaWidth = width - iconWidth - 4;

  if (isEditing) {
    const editX = isRtl ? 4 : iconWidth;
    return (
      <foreignObject x={editX} y={2} width={textAreaWidth} height={height - 4}>
        <input
          ref={inputRef}
          defaultValue={node.title}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitEdit(node.id, e.currentTarget.value);
            if (e.key === "Escape") onCancelEdit();
          }}
          onBlur={(e) => onCommitEdit(node.id, e.currentTarget.value)}
          style={{ width: "100%", height: "100%", background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontFamily: "var(--font-sans)", fontSize, padding: "0 2px" }}
          dir="auto"
        />
      </foreignObject>
    );
  }

  const textX = isRtl ? width - iconWidth - 4 : iconWidth + 4;
  const textAnchor = isRtl ? "end" : "start";
  return (
    <text x={textX} y={height / 2} dominantBaseline="central" fontSize={fontSize} fill={textFill} textAnchor={textAnchor} style={{ userSelect: "none", pointerEvents: "none" }}>
      {label}
    </text>
  );
}

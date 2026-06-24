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
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
}

export default function NodeLabel({ node, isEditing, iconWidth, width, height, fontSize, label, textFill, onCommitEdit, onCancelEdit }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) return;
    const id = setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
    return () => clearTimeout(id);
  }, [isEditing]);

  if (isEditing) {
    return (
      <foreignObject x={iconWidth} y={2} width={width - iconWidth - 4} height={height - 4}>
        <input
          ref={inputRef}
          defaultValue={node.title}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitEdit(node.id, e.currentTarget.value);
            if (e.key === "Escape") onCancelEdit();
          }}
          onBlur={(e) => onCommitEdit(node.id, e.currentTarget.value)}
          style={{ width: "100%", height: "100%", background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontFamily: "var(--font-sans)", fontSize, padding: "0 2px" }}
        />
      </foreignObject>
    );
  }

  return (
    <text x={iconWidth + 4} y={height / 2} dominantBaseline="central" fontSize={fontSize} fill={textFill} style={{ userSelect: "none", pointerEvents: "none" }}>
      {label}
    </text>
  );
}

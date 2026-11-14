/** A run of text from the map's prose: plain, or inline code. */
export interface InlineRun {
  code: boolean;
  text: string;
}

/** Splits prose on its backtick pairs: "reads `origin` here" is plain, code, plain. An odd, unclosed backtick stays plain. */
export function splitInlineCode(text: string): InlineRun[] {
  const parts = text.split("`");
  const closed = parts.length % 2 === 1;
  return parts.flatMap((part, index) => {
    if (part === "") return [];
    const inCode = index % 2 === 1 && (closed || index < parts.length - 1);
    return [{ code: inCode, text: inCode || closed || index < parts.length - 1 ? part : `\`${part}` }];
  });
}

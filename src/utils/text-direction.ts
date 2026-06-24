const RTL_RANGE = /[֐-׿؀-ۿ܀-ݏݐ-ݿ]/;

/** True when the first strong directional character in text is RTL (Hebrew, Arabic, Syriac). */
export function isRtlText(text: string): boolean {
  for (const ch of text) {
    if (RTL_RANGE.test(ch)) return true;
    const code = ch.codePointAt(0) ?? 0;
    // Basic Latin letters are LTR strong characters — stop here.
    if ((code >= 0x0041 && code <= 0x005A) || (code >= 0x0061 && code <= 0x007A)) return false;
  }
  return false;
}

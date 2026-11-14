import { splitInlineCode } from "@/utils/inline-code";
import styles from "./HelpView.module.css";

interface Props {
  text: string;
}

/** Map prose, with its backtick pairs drawn as inline code. */
export default function InlineText({ text }: Props) {
  return (
    <>
      {splitInlineCode(text).map((run, index) => (
        run.code ? <code key={index} className={styles.code}>{run.text}</code> : run.text
      ))}
    </>
  );
}

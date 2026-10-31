import { useEffect, useRef } from "react";
import ActionBar from "@/components/ActionBar/ActionBar";
import BottomNav from "@/components/BottomNav/BottomNav";
import styles from "./BottomChrome.module.css";

interface Props {
  showActionBar: boolean;
  showNav: boolean;
}

/** The CSS property the bottom chrome's height is published under, for what must clear it. */
const HEIGHT_PROPERTY = "--bottom-chrome-height";

/**
 * What sits under the view in the phone layout: the action bar above the bottom navigation. It
 * publishes its own height as `--bottom-chrome-height`, so a toast rises above it rather than
 * covering it (`docs/spec/touch.md`), and takes the property back when it goes.
 */
export default function BottomChrome({ showActionBar, showNav }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    const root = document.documentElement;
    if (element === null) return;
    const publish = () => root.style.setProperty(HEIGHT_PROPERTY, `${element.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === "undefined") return () => root.style.removeProperty(HEIGHT_PROPERTY);
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEIGHT_PROPERTY);
    };
  }, []);

  return (
    <div ref={ref} className={styles.chrome}>
      {showActionBar && <ActionBar />}
      {showNav && <BottomNav />}
    </div>
  );
}

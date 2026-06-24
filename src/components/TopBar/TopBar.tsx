import { useTranslation } from "react-i18next";
import styles from "./TopBar.module.css";

export default function TopBar() {
  const { i18n } = useTranslation();
  const isHebrew = i18n.resolvedLanguage === "he";

  function toggleLanguage() {
    void i18n.changeLanguage(isHebrew ? "en" : "he");
  }

  return (
    <header className={styles.bar}>
      {/* eslint-disable-next-line i18next/no-literal-string */}
      <span className={styles.appName}>Arlesh</span>
      <button className={styles.langToggle} type="button" onClick={toggleLanguage}>
        {isHebrew ? "English" : "עברית"}
      </button>
    </header>
  );
}

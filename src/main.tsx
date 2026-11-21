import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n/index";
import App from "./App";
import { loadRuleTables } from "@/api/rules";

// The rule tables are read once, before the first render, so no rule call ever waits on them.
void loadRuleTables().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});

import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n/index";
import App from "./App";
import { initRules } from "@/wasm/rules";
import { loadRuleTables } from "@/api/rules";

// The rules module is instantiated and the rule tables read once, before the first render, so no
// rule call ever waits on them.
void Promise.all([initRules(), loadRuleTables()]).then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});

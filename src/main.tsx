import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n/index";
import App from "./App";
import { initRules } from "@/wasm/rules";

// The rules module is instantiated once, before the first render, so no rule call ever waits on it.
void initRules().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});

import "@testing-library/jest-dom";

// The app always boots with a tab strip, and every per-tab store is read through the active tab.
// Loading the strip here gives each suite the same single default tab a fresh launch has, so a
// test can address the active tab directly (`useViewStore.setState(…)`) exactly as before tabs.
import "@/stores/use-tabs-store";

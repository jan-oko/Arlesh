import "@testing-library/jest-dom";

// The app always boots with a tab strip, and every per-tab store is read through the active tab.
// Loading the strip here gives each suite the same single default tab a fresh launch has, so a
// test can address the active tab directly (`useViewStore.setState(…)`) exactly as before tabs.
import "@/stores/use-tabs-store";

// jsdom implements no layout, and with it no `ResizeObserver` — which the top bar's breadcrumb
// observes to re-measure when the bar changes width. A stub that never reports a change is the
// honest jsdom equivalent: nothing in a test ever resizes.
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver;

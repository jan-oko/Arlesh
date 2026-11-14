import { afterEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { useCutoutClearance, useRowCutoutClearance } from "./use-cutout-clearance";

/** Lays `element` out at `top`..`bottom` full width, which jsdom does not do. */
function place(element: Element, top: number, bottom: number): void {
  element.getBoundingClientRect = () => new DOMRect(0, top, window.innerWidth, bottom - top);
}

function Bar() {
  const ref = useRef<HTMLDivElement>(null);
  useCutoutClearance(ref);
  return <div ref={(node) => { ref.current = node; if (node !== null) place(node, 100, 150); }} data-testid="bar" />;
}

function Rows() {
  const ref = useRef<HTMLDivElement>(null);
  useRowCutoutClearance(ref, "list");
  return (
    <div ref={ref}>
      <div data-cutout-row="" data-testid="near" ref={(node) => { if (node !== null) place(node, 110, 140); }} />
      <div data-cutout-row="" data-testid="far" ref={(node) => { if (node !== null) place(node, 200, 240); }} />
    </div>
  );
}

/** A full-width strip whose only pill sits at the left, with a camera over the middle of the top edge. */
function Strip({ pillRight }: { pillRight: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useCutoutClearance(ref);
  return (
    <div data-cutout-row="children" data-testid="strip" ref={(node) => {
      ref.current = node;
      if (node === null) return;
      place(node, 0, 40);
      const pill = node.firstElementChild;
      if (pill !== null) pill.getBoundingClientRect = () => new DOMRect(10, 0, pillRight - 10, 40);
    }}><span /></div>
  );
}

function pushTopCamera(): void {
  const style = document.documentElement.style;
  style.setProperty("--cutout-top-start", "380px");
  style.setProperty("--cutout-top-end", "420px");
  style.setProperty("--cutout-top-depth", "30px");
  window.dispatchEvent(new Event("arlesh-insets"));
}

function pushCamera(): void {
  const style = document.documentElement.style;
  style.setProperty("--cutout-left-start", "120px");
  style.setProperty("--cutout-left-end", "160px");
  style.setProperty("--cutout-left-depth", "30px");
  window.dispatchEvent(new Event("arlesh-insets"));
}

afterEach(() => {
  const style = document.documentElement.style;
  for (const name of ["start", "end", "depth"]) {
    style.removeProperty(`--cutout-left-${name}`);
    style.removeProperty(`--cutout-top-${name}`);
  }
});

describe("useCutoutClearance", () => {
  it("clears a bar that overlaps the camera, once the activity says the insets changed", () => {
    const { getByTestId } = render(<Bar />);
    expect(getByTestId("bar").style.getPropertyValue("--clear-left")).toBe("0px");
    act(pushCamera);
    expect(getByTestId("bar").style.getPropertyValue("--clear-left")).toBe("30px");
  });
});

describe("useRowCutoutClearance", () => {
  it("clears only the rows the camera overlaps", async () => {
    const { getByTestId } = render(<Rows />);
    // The rows are re-measured on the next frame, not inside the event.
    await act(async () => {
      pushCamera();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(getByTestId("near").style.getPropertyValue("--clear-left")).toBe("30px");
    expect(getByTestId("far").style.getPropertyValue("--clear-left")).toBe("0px");
  });

  it("measures nothing and writes nothing while there is no cutout", () => {
    const { getByTestId } = render(<Rows />);
    expect(getByTestId("near").style.getPropertyValue("--clear-left")).toBe("");
  });
});

describe("a strip marked data-cutout-row=children", () => {
  it("is cleared by where its pills are: a camera over empty strip pushes nothing", () => {
    const { getByTestId } = render(<Strip pillRight={300} />);
    act(pushTopCamera);
    expect(getByTestId("strip").style.getPropertyValue("--clear-top")).toBe("0px");
  });

  it("is pushed below the camera once a pill is under it", () => {
    const { getByTestId } = render(<Strip pillRight={500} />);
    act(pushTopCamera);
    expect(getByTestId("strip").style.getPropertyValue("--clear-top")).toBe("30px");
  });
});

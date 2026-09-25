import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CheckTaskPrefixSetting from "./CheckTaskPrefixSetting";
import { useDisplayStore } from "@/stores/use-display-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => (key === "expectation:checkTaskPrefixDefault" ? "Check: " : key) }),
}));

describe("CheckTaskPrefixSetting", () => {
  beforeEach(() => useDisplayStore.getState().setCheckTaskPrefix(null));

  it("shows the default, stores what is typed on blur, and puts the default back", () => {
    render(<CheckTaskPrefixSetting />);
    const input = screen.getByLabelText("common:checkTaskPrefix");
    expect(input).toHaveValue("Check: ");
    fireEvent.change(input, { target: { value: "Look in on: " } });
    expect(useDisplayStore.getState().checkTaskPrefix).toBeNull();
    fireEvent.blur(input);
    expect(useDisplayStore.getState().checkTaskPrefix).toBe("Look in on: ");
    fireEvent.click(screen.getByRole("button", { name: "common:checkTaskPrefixReset" }));
    expect(useDisplayStore.getState().checkTaskPrefix).toBeNull();
  });

  it("keeps an emptied prefix as no prefix at all", () => {
    render(<CheckTaskPrefixSetting />);
    const input = screen.getByLabelText("common:checkTaskPrefix");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useDisplayStore.getState().checkTaskPrefix).toBe("");
  });
});

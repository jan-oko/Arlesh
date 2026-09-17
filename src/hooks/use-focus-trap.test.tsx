import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useFocusTrap } from "@/hooks/use-focus-trap";

interface TrapProps {
  active?: boolean;
  empty?: boolean;
}

function Trapped({ active = true, empty = false }: TrapProps) {
  const ref = useFocusTrap<HTMLDivElement>(active);
  return (
    <div ref={ref}>
      {!empty && (
        <>
          <button autoFocus data-testid="first" />
          <button data-testid="second" />
        </>
      )}
    </div>
  );
}

function Outside() {
  return <button data-testid="outside" />;
}

describe("useFocusTrap", () => {
  it("wraps from the last control back to the first when tabbing forward", async () => {
    const user = userEvent.setup();
    render(<Outside />);
    render(<Trapped />);
    await user.tab();
    expect(screen.getByTestId("second")).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  it("wraps from the first control to the last when tabbing backward", async () => {
    const user = userEvent.setup();
    render(<Outside />);
    render(<Trapped />);
    await user.tab({ shift: true });
    expect(screen.getByTestId("second")).toHaveFocus();
  });

  it("pulls focus back in when Tab is pressed from outside the container", async () => {
    const user = userEvent.setup();
    render(<Outside />);
    render(<Trapped />);
    screen.getByTestId("outside").focus();
    await user.tab();
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  it("leaves tabbing alone while inactive", async () => {
    const user = userEvent.setup();
    render(<Outside />);
    render(<Trapped active={false} />);
    screen.getByTestId("second").focus();
    await user.tab();
    expect(screen.getByTestId("second")).not.toHaveFocus();
  });

  it("does not swallow Tab when the container holds nothing focusable", async () => {
    const user = userEvent.setup();
    render(<Outside />);
    render(<Trapped empty={true} />);
    await user.tab();
    expect(screen.getByTestId("outside")).toHaveFocus();
  });
});

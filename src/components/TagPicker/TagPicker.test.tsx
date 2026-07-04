import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TagPicker from "./TagPicker";
import type { Domain } from "@/api/domains";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

function mkTag(id: number, title: string, parentId: number | null, color: string | null = null): Domain {
  return { id, title, description: null, subtype: "tag", parent_id: parentId, color, status: null, knowledge_base_directory: null, position: 0, nsfw: false };
}

const TAGS = [mkTag(1, "backend", 10), mkTag(2, "urgent", 20), mkTag(3, "api", 10)];
const DOMAIN_NAMES = new Map([[10, "Work"], [20, "Life"]]);

beforeEach(() => { vi.clearAllMocks(); });

describe("TagPicker", () => {
  it("shows selected tags as pills and nothing in the dropdown until focused", () => {
    render(<TagPicker allTags={TAGS} domainNames={DOMAIN_NAMES} selectedIds={[2]} onChange={vi.fn()} />);
    expect(screen.getByText("urgent")).toBeInTheDocument(); // pill
    expect(screen.queryByText("backend")).not.toBeInTheDocument(); // dropdown closed
  });

  it("opens a dropdown sectioned by parent domain on focus", () => {
    render(<TagPicker allTags={TAGS} domainNames={DOMAIN_NAMES} selectedIds={[]} onChange={vi.fn()} />);
    fireEvent.focus(screen.getByPlaceholderText("placeholderTagSearch"));
    expect(screen.getByText("Work")).toBeInTheDocument(); // parent-domain section header
    expect(screen.getByText("Life")).toBeInTheDocument();
    expect(screen.getByText("backend")).toBeInTheDocument();
  });

  it("filters options by the query", () => {
    render(<TagPicker allTags={TAGS} domainNames={DOMAIN_NAMES} selectedIds={[]} onChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("placeholderTagSearch"), { target: { value: "api" } });
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.queryByText("urgent")).not.toBeInTheDocument();
  });

  it("adds a tag on click, producing the full id set", () => {
    const onChange = vi.fn();
    render(<TagPicker allTags={TAGS} domainNames={DOMAIN_NAMES} selectedIds={[2]} onChange={onChange} />);
    fireEvent.focus(screen.getByPlaceholderText("placeholderTagSearch"));
    fireEvent.mouseDown(screen.getByText("backend"));
    expect(onChange).toHaveBeenCalledWith([2, 1]);
  });

  it("removes a selected tag via its pill", () => {
    const onChange = vi.fn();
    render(<TagPicker allTags={TAGS} domainNames={DOMAIN_NAMES} selectedIds={[1, 2]} onChange={onChange} />);
    const removeButtons = screen.getAllByRole("button", { name: "removeTag" });
    fireEvent.click(removeButtons[0]!);
    expect(onChange).toHaveBeenCalledWith([2]);
  });
});

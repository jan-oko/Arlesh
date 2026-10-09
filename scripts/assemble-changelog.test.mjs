import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ChangelogError,
  assemble,
  checkFragmentName,
  entriesFor,
  readEntry,
  renderSection,
  spliceSection,
} from "./assemble-changelog.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A changelog with one release section below [Unreleased], to prove history is never touched. */
const DOCUMENT = [
  "# Changelog",
  "",
  "---",
  "",
  "## [Unreleased]",
  "",
  "### Added",
  "- **Something old.** It was here before.",
  "",
  "## [0.3.0] — 2026-09-10",
  "",
  "### Added",
  "- **A shipped thing.** History.",
  "",
].join("\n");

const fragment = (name, text) => ({ name, text: `${text}\n` });

describe("renderSection", () => {
  it("puts two fragments under their heading, newest number first, a blank line apart", () => {
    const section = renderSection({
      added: [
        fragment("0001-older.md", "- **Older.** Shipped first."),
        fragment("0002-newer.md", "- **Newer.** Shipped second."),
      ],
    });
    expect(section).toBe(
      "## [Unreleased]\n\n### Added\n- **Newer.** Shipped second.\n\n- **Older.** Shipped first.\n\n",
    );
  });

  it("keeps an entry's continuation paragraphs", () => {
    const section = renderSection({
      fixed: [fragment("0001-thing.md", "- **Fixed a thing.** The first line.\n\n  A second paragraph.")],
    });
    expect(section).toContain("- **Fixed a thing.** The first line.\n\n  A second paragraph.\n");
  });

  it("renders the four headings in Keep a Changelog order, and omits the empty ones", () => {
    const section = renderSection({
      removed: [fragment("0001-r.md", "- **R.**")],
      added: [fragment("0002-a.md", "- **A.**")],
      fixed: [fragment("0003-f.md", "- **F.**")],
    });
    expect(section).toBe(
      "## [Unreleased]\n\n### Added\n- **A.**\n\n### Fixed\n- **F.**\n\n### Removed\n- **R.**\n\n",
    );
    expect(section).not.toContain("### Changed");
  });

  it("leaves a bare section head when changelog.d/ is empty", () => {
    expect(renderSection({})).toBe("## [Unreleased]\n\n");
    expect(renderSection({ added: [], changed: [], fixed: [], removed: [] })).toBe("## [Unreleased]\n\n");
  });

  it("orders by the number, not by the slug", () => {
    const section = renderSection({
      added: [
        fragment("0009-aardvark.md", "- **Nine.**"),
        fragment("0010-zebra.md", "- **Ten.**"),
      ],
    });
    expect(section.indexOf("- **Ten.**")).toBeLessThan(section.indexOf("- **Nine.**"));
  });

  it("orders two fragments that picked the same number deterministically, without failing", () => {
    const entries = entriesFor("added", [
      fragment("0042-bravo.md", "- **Bravo.**"),
      fragment("0042-alpha.md", "- **Alpha.**"),
    ]);
    expect(entries).toEqual(["- **Bravo.**", "- **Alpha.**"]);
  });
});

describe("a malformed fragment", () => {
  it("is refused when the filename has no number", () => {
    expect(() => checkFragmentName("added", "close-to-tray.md")).toThrow(ChangelogError);
  });

  it("is refused when the filename is not kebab-case", () => {
    expect(() => checkFragmentName("added", "0042-Close_To_Tray.md")).toThrow(ChangelogError);
  });

  it("is accepted when it is <NNNN>-<kebab-slug>.md", () => {
    expect(() => checkFragmentName("added", "0042-close-to-tray.md")).not.toThrow();
  });

  it("is refused when the body is not a list entry", () => {
    expect(() => readEntry("Close to tray now works.\n", "f.md")).toThrow(/must start with a "- "/);
  });

  it("is refused when the body is empty", () => {
    expect(() => readEntry("\n\n", "f.md")).toThrow(/is empty/);
  });

  it("fails the whole render rather than dropping the entry", () => {
    expect(() => renderSection({ added: [fragment("nope.md", "- **Fine.**")] })).toThrow(ChangelogError);
  });
});

describe("spliceSection", () => {
  it("replaces [Unreleased] and leaves every numbered release section byte-identical", () => {
    const next = assemble(DOCUMENT, { added: [fragment("0001-new.md", "- **Something new.** It is here now.")] });
    expect(next).toContain("- **Something new.** It is here now.");
    expect(next).not.toContain("- **Something old.**");
    expect(next.slice(next.indexOf("## [0.3.0]"))).toBe(DOCUMENT.slice(DOCUMENT.indexOf("## [0.3.0]")));
  });

  it("keeps everything above [Unreleased] byte-identical", () => {
    const next = assemble(DOCUMENT, { added: [fragment("0001-new.md", "- **New.**")] });
    expect(next.slice(0, next.indexOf("## [Unreleased]"))).toBe(
      DOCUMENT.slice(0, DOCUMENT.indexOf("## [Unreleased]")),
    );
  });

  it("is idempotent — assembling twice changes nothing the second time", () => {
    const fragments = { added: [fragment("0001-new.md", "- **New.**")], fixed: [fragment("0002-f.md", "- **F.**")] };
    const once = assemble(DOCUMENT, fragments);
    expect(assemble(once, fragments)).toBe(once);
  });

  it("empties [Unreleased] rather than eating the release below it when there are no fragments", () => {
    const next = assemble(DOCUMENT, {});
    expect(next).toContain("## [Unreleased]\n\n## [0.3.0] — 2026-09-10");
    expect(next).toContain("- **A shipped thing.** History.");
  });

  it("refuses a document with no [Unreleased] section rather than guessing", () => {
    expect(() => spliceSection("# Changelog\n\n## [0.3.0]\n", "## [Unreleased]\n\n")).toThrow(ChangelogError);
  });
});

describe("the repository's own CHANGELOG.md", () => {
  it("still opens with the Keep a Changelog preamble and the [Unreleased] head", () => {
    const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    expect(changelog.startsWith("# Changelog\n")).toBe(true);
    expect(changelog).toContain("\n## [Unreleased]\n");
    expect(changelog).toContain("\n## [0.3.0] — 2026-09-10\n");
  });
});

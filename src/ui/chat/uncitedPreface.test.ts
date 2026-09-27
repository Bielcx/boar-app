import { describe, it, expect } from "vitest";
import { uncitedPreface } from "../../routing/context";
import { hasUncitedPreface, weakNoteShowsBody } from "./uncitedPreface";

// Compared with the engine's own sentence (Iris/Prism): a mistake here would hide the only warning.
describe("weak-source note body (Iris: marker only when the text already says it)", () => {
  it("text with the engine's line, PT and EN → marker only", () => {
    expect(weakNoteShowsBody(`${uncitedPreface(true)}\n\nAs estações acontecem porque…`)).toBe(false);
    expect(weakNoteShowsBody(`  ${uncitedPreface(false)}\n\nSeasons happen because…`)).toBe(false);
  });
  it("text without the line (e.g. the compact model after 'Answer anyway') → marker + body", () => {
    expect(weakNoteShowsBody("Seasons happen because the Earth is tilted.")).toBe(true);
    expect(weakNoteShowsBody(`Seasons happen because… ${uncitedPreface(false)}`)).toBe(true);
    expect(weakNoteShowsBody("")).toBe(true);
    expect(weakNoteShowsBody(undefined)).toBe(true);
    expect(hasUncitedPreface(uncitedPreface(true))).toBe(true);
  });
});

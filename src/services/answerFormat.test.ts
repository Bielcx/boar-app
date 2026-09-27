import { describe, it, expect } from "vitest";
import { splitInlineBullets } from "./answerFormat";

describe("splitInlineBullets", () => {
  it("puts inline bullet points on their own lines", () => {
    expect(splitInlineBullets("Takeaway. - One. - Two. - Three.")).toBe("Takeaway.\n- One.\n- Two.\n- Three.");
  });

  it("leaves a single dash in a sentence alone", () => {
    const text = "It rained. - which nobody expected - and then it stopped.";
    expect(splitInlineBullets(text)).toBe(text);
  });

  it("leaves real lists and plain prose unchanged", () => {
    const list = "Takeaway.\n- One.\n- Two.";
    expect(splitInlineBullets(list)).toBe(list);
    expect(splitInlineBullets("A well-known fact - really.")).toBe("A well-known fact - really.");
  });
});

describe("splitInlineBullets on a pack's flattened list (Prism FMT-1)", () => {
  it("breaks the steps into a list and leaves the dash inside a sentence", () => {
    const text = "In a nutshell: Drop, cover and hold. - Drop to the floor. - Take cover. - Hold a cushion above your head if possible - many injuries are from flying objects.";
    expect(splitInlineBullets(text)).toBe(
      "In a nutshell: Drop, cover and hold.\n- Drop to the floor.\n- Take cover.\n- Hold a cushion above your head if possible - many injuries are from flying objects."
    );
  });
});

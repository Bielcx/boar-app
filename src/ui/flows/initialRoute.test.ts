import { describe, expect, it } from "vitest";
import { decideInitialRoute } from "./initialRoute";

const DEFAULT = "qwen3-4b-instruct-2507-q4km";
const COMPACT = "qwen2.5-1.5b-instruct-q4km";

describe("decideInitialRoute", () => {
  it("first run with nothing on disk opens setup", () => {
    expect(decideInitialRoute({ requiredPresent: false, presentAnswerIds: [], activeLlmId: null, activeLlmPresent: false })).toEqual({ route: "Setup" });
  });

  it("an answer model without the embedding model opens setup", () => {
    expect(decideInitialRoute({ requiredPresent: false, presentAnswerIds: [DEFAULT], activeLlmId: DEFAULT, activeLlmPresent: true }).route).toBe("Setup");
  });

  it("the embedding model without any answer model opens setup, not a chat with a model error", () => {
    expect(decideInitialRoute({ requiredPresent: true, presentAnswerIds: [], activeLlmId: null, activeLlmPresent: false })).toEqual({ route: "Setup" });
    expect(decideInitialRoute({ requiredPresent: true, presentAnswerIds: [], activeLlmId: DEFAULT, activeLlmPresent: false })).toEqual({ route: "Setup" });
  });

  it("only the compact model, none chosen: opens the chat on the compact model, not the missing default (iOS shot on 4f0819f)", () => {
    expect(decideInitialRoute({ requiredPresent: true, presentAnswerIds: [COMPACT], activeLlmId: null, activeLlmPresent: false })).toEqual({
      route: "Main",
      setActiveLlmId: COMPACT,
    });
  });

  it("the chosen model was deleted: switches to an answer model that is on disk", () => {
    expect(decideInitialRoute({ requiredPresent: true, presentAnswerIds: [COMPACT], activeLlmId: DEFAULT, activeLlmPresent: false })).toEqual({
      route: "Main",
      setActiveLlmId: COMPACT,
    });
  });

  it("prefers the first present answer model (default before compact)", () => {
    expect(decideInitialRoute({ requiredPresent: true, presentAnswerIds: [DEFAULT, COMPACT], activeLlmId: null, activeLlmPresent: false }).setActiveLlmId).toBe(DEFAULT);
  });

  it("keeps the user's choice when it is on disk, including a Hugging Face model", () => {
    expect(decideInitialRoute({ requiredPresent: true, presentAnswerIds: [DEFAULT], activeLlmId: "hf-some-model", activeLlmPresent: true })).toEqual({ route: "Main" });
  });
});

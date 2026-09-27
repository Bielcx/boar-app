import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async (p: string) => ({ exists: files.has(p) }),
  readAsStringAsync: async (p: string) => files.get(p),
  writeAsStringAsync: async (p: string, c: string) => void files.set(p, c),
}));

import { getSetupProgress, setSetupProgress, getLanguageId, getVoiceInputEnabled, languageForLocale, setLanguageId, setVoiceInputEnabled } from "./settings";

describe("voice input setting", () => {
  beforeEach(() => files.clear());

  it("is off on a fresh install", async () => {
    expect(await getVoiceInputEnabled()).toBe(false);
  });

  it("keeps the user's choice", async () => {
    await setVoiceInputEnabled(true);
    expect(await getVoiceInputEnabled()).toBe(true);
  });
});

describe("language", () => {
  beforeEach(() => files.clear());

  it("maps any Portuguese locale to pt and everything else to en", () => {
    expect(languageForLocale("pt-BR")).toBe("pt");
    expect(languageForLocale("pt-PT")).toBe("pt");
    expect(languageForLocale("en-US")).toBe("en");
    expect(languageForLocale("es-AR")).toBe("en");
    expect(languageForLocale(undefined)).toBe("en");
  });

  it("prefers the saved choice over the device locale", async () => {
    await setLanguageId("pt");
    expect(await getLanguageId()).toBe("pt");
  });
});

describe("setup progress", () => {
  beforeEach(() => files.clear());

  it("round-trips and clears", async () => {
    expect(await getSetupProgress()).toBeNull();
    await setSetupProgress({ step: 3, packageId: "encyclopedia", travelRegionId: "sao-paulo" });
    expect(await getSetupProgress()).toEqual({ step: 3, packageId: "encyclopedia", travelRegionId: "sao-paulo" });
    await setSetupProgress(null);
    expect(await getSetupProgress()).toBeNull();
  });

  it("keeps the trip chosen in step 2 by its catalog ids (Ledger FS-1)", async () => {
    await setSetupProgress({ step: 2, packageId: "essential", trip: { label: "Rome", assetIds: ["poi-rome", "poi-world-places"] } });
    expect((await getSetupProgress())?.trip).toEqual({ label: "Rome", assetIds: ["poi-rome", "poi-world-places"] });
  });

  it("keeps whether the package and answer model were picked by the user", async () => {
    await setSetupProgress({ step: 2, packageId: "essential", answerTier: "compact", packageChosen: false, answerChosen: true });
    expect(await getSetupProgress()).toMatchObject({ packageChosen: false, answerChosen: true });
  });
});

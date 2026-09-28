import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const fsCalls = { info: 0, read: 0 };
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async (p: string) => (fsCalls.info++, { exists: files.has(p) }),
  readAsStringAsync: async (p: string) => (fsCalls.read++, files.get(p)),
  writeAsStringAsync: async (p: string, c: string) => void files.set(p, c),
  deleteAsync: async (p: string) => void files.delete(p),
}));

import { clearSettings, getMaxTokens, getSetupProgress, setSetupProgress, getLanguageId, getVoiceInputEnabled, languageForLocale, resetSettingsCache, setLanguageId, setMaxTokens, setVoiceInputEnabled } from "./settings";

describe("voice input setting", () => {
  beforeEach(() => {
    files.clear();
    resetSettingsCache();
  });

  it("is off on a fresh install", async () => {
    expect(await getVoiceInputEnabled()).toBe(false);
  });

  it("keeps the user's choice", async () => {
    await setVoiceInputEnabled(true);
    expect(await getVoiceInputEnabled()).toBe(true);
  });
});

describe("language", () => {
  beforeEach(() => {
    files.clear();
    resetSettingsCache();
  });

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
  beforeEach(() => {
    files.clear();
    resetSettingsCache();
  });

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

describe("CR-4: crash ledger", () => {
  beforeEach(() => {
    files.clear();
    vi.resetModules();
  });
  const PATH = "file:///docs/settings.json";
  const ID = "qwen3-4b-instruct-2507-q4km";
  const crash = { crashedModelId: ID, crashedLabel: "Qwen3-4B", fallbackModelId: "", fallbackLabel: "", at: 1 };

  it("interleaved writers don't drop each other's change (the crash at boot and a preference)", async () => {
    const s = await import("./settings");
    await Promise.all([s.setVoiceInputEnabled(true), s.recordLoadCrash(crash), s.setLanguageId("pt"), s.setMaxTokens(256)]);
    expect(await s.getVoiceInputEnabled()).toBe(true);
    expect(await s.getLoadCrashedIds()).toEqual([ID]);
    expect(await s.getLanguageId()).toBe("pt");
    expect(await s.getMaxTokens()).toBe(256);
  });

  it("a crash recorded by file (before 822b069) is read as the model id and withdraws the confirmation once", async () => {
    files.set(PATH, JSON.stringify({ activeModelId: {}, loadCrashedIds: [`models/${ID}.gguf`], largeModelConfirmedIds: [ID] }));
    const s = await import("./settings");
    expect(await s.getLoadCrashedIds()).toEqual([ID]);
    expect((await s.getAnswerSettings()).largeModelConfirmedIds).toEqual([]);
    expect(JSON.parse(files.get(PATH)!).loadCrashedIds).toEqual([ID]);
    // The user confirms again after the crash: it counts.
    await s.confirmLargeModel(ID);
    expect((await s.getAnswerSettings()).largeModelConfirmedIds).toEqual([ID]);
    await s.recordLoadSuccess(ID);
    expect(await s.getLoadCrashedIds()).toEqual([]);
  });
});

describe("in-memory cache (perf audit #34)", () => {
  beforeEach(() => {
    files.clear();
    resetSettingsCache();
    fsCalls.info = fsCalls.read = 0;
  });

  it("reads the file once, then serves getters from memory", async () => {
    files.set("file:///docs/settings.json", JSON.stringify({ activeModelId: {}, maxTokens: 256, languageId: "pt" }));
    expect(await getMaxTokens()).toBe(256);
    expect(await getLanguageId()).toBe("pt");
    expect(await getMaxTokens()).toBe(256);
    expect(fsCalls).toEqual({ info: 1, read: 1 });
  });

  it("a write is what the next read sees, without touching the file", async () => {
    await setMaxTokens(1024);
    fsCalls.info = fsCalls.read = 0;
    expect(await getMaxTokens()).toBe(1024);
    expect(fsCalls.info + fsCalls.read).toBe(0);
  });

  it("after clearSettings, reads fall back to defaults", async () => {
    await setLanguageId("pt");
    await clearSettings();
    expect(files.size).toBe(0);
    expect(await getVoiceInputEnabled()).toBe(false);
    expect(await getMaxTokens()).toBe(await (async () => (resetSettingsCache(), getMaxTokens()))());
  });
});

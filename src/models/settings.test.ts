import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async (p: string) => ({ exists: files.has(p) }),
  readAsStringAsync: async (p: string) => files.get(p),
  writeAsStringAsync: async (p: string, c: string) => void files.set(p, c),
}));

import { getLanguageId, getVoiceInputEnabled, languageForLocale, setLanguageId, setVoiceInputEnabled } from "./settings";

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

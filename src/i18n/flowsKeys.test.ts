import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import pt from "./locales/pt.json";

// Screens outside the chat (onboarding, models, knowledge, settings,
// performance, about). Every key they use must exist in both locales.
const FLOW_FILES = [
  "SetupWizardScreen.tsx",
  "ModelSetupScreen.tsx",
  "ModelBrowser.tsx",
  "CatalogItemCard.tsx",
  "CorpusSettingsTab.tsx",
  "KnowledgeBaseScreen.tsx",
  "PersonalDocumentsManager.tsx",
  "PersonalitySettings.tsx",
  "MemorySettings.tsx",
  "VoiceSettings.tsx",
  "UsageStatsContent.tsx",
  "ExecutionTelemetryScreen.tsx",
  "EvaluationScreen.tsx",
  "AboutScreen.tsx",
].map((f) => join(__dirname, "..", "ui", f));

type Tree = { [key: string]: string | Tree };

function lookup(tree: Tree, key: string): string | Tree | undefined {
  return key.split(".").reduce<string | Tree | undefined>(
    (node, part) => (node && typeof node === "object" ? node[part] : undefined),
    tree
  );
}

/** A plural key exists as `key_one`/`key_other` rather than `key`. */
function resolve(tree: Tree, key: string): string[] {
  const direct = lookup(tree, key);
  if (typeof direct === "string") return [direct];
  return ["_one", "_other"]
    .map((suffix) => lookup(tree, key + suffix))
    .filter((v): v is string => typeof v === "string");
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
}

function staticKeys(): string[] {
  const keys = new Set<string>();
  for (const file of FLOW_FILES) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/\bt\(\s*"([\w.]+)"/g)) keys.add(m[1]);
  }
  return [...keys].sort();
}

describe("flow screen i18n keys", () => {
  const keys = staticKeys();

  it("finds keys to check", () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  it.each(keys)("%s exists in en and pt with the same placeholders", (key) => {
    const enValues = resolve(en as Tree, key);
    const ptValues = resolve(pt as Tree, key);
    expect(enValues, `missing in en`).not.toHaveLength(0);
    expect(ptValues, `missing in pt`).not.toHaveLength(0);
    expect(placeholders(ptValues.join(" "))).toEqual(placeholders(enValues.join(" ")));
  });
});

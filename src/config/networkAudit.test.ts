import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Static audit backing the offline build: every place in the app's own code
 * that can open a network connection must be listed here AND check
 * networkAllowed() (src/config/variant.ts). A new call site fails this test
 * until someone decides how it behaves in the offline variant.
 */
const ROOT = join(__dirname, "..", "..");
const NETWORK_CALL = /\b(fetch\(|new XMLHttpRequest|new WebSocket|createDownloadResumable\(|downloadAsync\(|uploadAsync\(|EventSource\()/;

const ALLOWED: Record<string, string> = {
  "src/models/ModelManager.ts": "downloadCatalogModel checks networkAllowed() first",
  "src/services/modelBrowser.ts": "assertNetwork() before each fetch",
};

// Client libraries that would add network paths (or cloud services) of their own.
const FORBIDDEN_DEPENDENCIES = [
  "expo-updates",
  "expo-notifications",
  "@react-native-firebase/app",
  "firebase",
  "@sentry/react-native",
  "axios",
  "expo-network",
  "@react-native-community/netinfo",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("network call sites", () => {
  const files = [...sourceFiles(join(ROOT, "src")), join(ROOT, "App.tsx")];

  it("only appear in the allow-listed files", () => {
    const offenders = files
      .map((f) => relative(ROOT, f))
      .filter((f) => NETWORK_CALL.test(readFileSync(join(ROOT, f), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "")));
    expect(offenders.sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it("are all guarded by networkAllowed()", () => {
    for (const f of Object.keys(ALLOWED)) {
      expect(readFileSync(join(ROOT, f), "utf8"), f).toMatch(/networkAllowed\(\)/);
    }
  });
});

describe("dependencies", () => {
  it("include no network/cloud client libraries", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps.filter((d) => FORBIDDEN_DEPENDENCIES.includes(d))).toEqual([]);
  });
});

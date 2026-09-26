import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { parseVariant as parseJsVariant } from "./variant";

const require = createRequire(import.meta.url);
const plugin = require("../../plugins/withBuildVariant.js");
const appJson = require("../../app.json");

const INTERNET = "android.permission.INTERNET";

function build(env: Record<string, string>) {
  // Only the synchronous part (mods run at prebuild) matters here.
  return plugin.applyBuildVariant(structuredClone(appJson.expo), env);
}

describe("offline build variant", () => {
  it("blocks every network permission and the microphone", () => {
    const cfg = build({ EXPO_PUBLIC_BOAR_VARIANT: "offline" });
    for (const p of plugin.NETWORK_PERMISSIONS) expect(cfg.android.blockedPermissions).toContain(p);
    expect(cfg.android.blockedPermissions).toContain("android.permission.RECORD_AUDIO");
    expect(cfg.android.permissions ?? []).not.toContain(INTERNET);
  });

  it("keeps the microphone only when built with voice", () => {
    const cfg = build({ EXPO_PUBLIC_BOAR_VARIANT: "offline", EXPO_PUBLIC_BOAR_VOICE: "1" });
    expect(cfg.android.blockedPermissions).toContain(INTERNET);
    expect(cfg.android.blockedPermissions).not.toContain("android.permission.RECORD_AUDIO");
  });

  it("installs next to the downloader build and says what it is", () => {
    const cfg = build({ EXPO_PUBLIC_BOAR_VARIANT: "offline" });
    expect(cfg.android.package).toBe(`${appJson.expo.android.package}.offline`);
    expect(cfg.name).toMatch(/Offline$/);
    expect(cfg.extra.boarVariant).toBe("offline");
  });
});

describe("downloader build variant (default)", () => {
  it("keeps INTERNET but still drops SYSTEM_ALERT_WINDOW and storage permissions", () => {
    const cfg = build({});
    expect(cfg.android.blockedPermissions).not.toContain(INTERNET);
    expect(cfg.android.blockedPermissions).toContain("android.permission.SYSTEM_ALERT_WINDOW");
    expect(cfg.android.blockedPermissions).toContain("android.permission.WRITE_EXTERNAL_STORAGE");
    expect(cfg.android.package).toBe(appJson.expo.android.package);
    expect(cfg.extra.boarVariant).toBe("downloader");
  });

  it("disables backup in both variants", () => {
    expect(build({}).android.allowBackup).toBe(false);
    expect(build({ EXPO_PUBLIC_BOAR_VARIANT: "offline" }).android.allowBackup).toBe(false);
  });
});

describe("native and JS agree on the variant", () => {
  it("parses the same env value the same way", () => {
    for (const raw of ["offline", "OFFLINE ", "downloader", "", undefined, "x"]) {
      expect(plugin.parseVariant(raw)).toBe(parseJsVariant(raw));
    }
  });
});

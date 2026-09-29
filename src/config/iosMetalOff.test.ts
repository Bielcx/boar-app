import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const metalOff = require("../../plugins/withIosMetalOff.js");
const scene = require("../../plugins/withIosSceneLifecycle.js");
const appJson = require("../../app.json");

// AppDelegate.swift as `expo prebuild -p ios` writes it on expo SDK 57 (mini, 28/09).
const TEMPLATE = readFileSync(new URL("./__fixtures__/AppDelegate.expo57.swift", import.meta.url), "utf8");
const SETENV = 'setenv("GGML_METAL_DEVICES", "0", 0)';

describe("iOS llama.rn on the CPU only (v1.1)", () => {
  it("is registered in app.json", () => {
    expect(appJson.expo.plugins).toContain("./plugins/withIosMetalOff");
  });

  it("sets GGML_METAL_DEVICES=0 first thing in didFinishLaunching, before React Native starts", () => {
    const out = metalOff.applyMetalOff(TEMPLATE);
    const launch = out.indexOf("didFinishLaunchingWithOptions launchOptions:");
    const env = out.indexOf(SETENV);
    const factory = out.indexOf("let delegate = ReactNativeDelegate()");
    expect(launch).toBeGreaterThan(-1);
    expect(env).toBeGreaterThan(launch);
    expect(env).toBeLessThan(factory);
    // overwrite = 0: a launch-time value (devicectl -e) still wins
    expect(out).toContain(SETENV);
    // the measurement-build anchor used by scripts/ios-build-on-host.sh (IOS_RN_LOG_INFO) survives
    expect(out).toContain("    let delegate = ReactNativeDelegate()\n");
  });

  it("composes with the scene life cycle plugin in either order", () => {
    const a = scene.applySceneAppDelegate(metalOff.applyMetalOff(TEMPLATE));
    const b = metalOff.applyMetalOff(scene.applySceneAppDelegate(TEMPLATE));
    expect(a).toBe(b);
    expect(a).toContain(SETENV);
    expect(a).toContain("ExpoReactNativeFactoryProvider");
  });

  it("is idempotent", () => {
    const once = metalOff.applyMetalOff(TEMPLATE);
    expect(metalOff.applyMetalOff(once)).toBe(once);
  });

  it("fails the prebuild when the template has no didFinishLaunching", () => {
    const drifted = TEMPLATE.replace("didFinishLaunchingWithOptions launchOptions:", "didFinishLaunching launchOptions:");
    expect(() => metalOff.applyMetalOff(drifted)).toThrow(/withIosMetalOff/);
  });
});

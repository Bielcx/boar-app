import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const plugin = require("../../plugins/withIosSceneLifecycle.js");
const appJson = require("../../app.json");

// AppDelegate.swift as `expo prebuild -p ios` writes it on expo SDK 57 (mini, 28/09).
const TEMPLATE = readFileSync(new URL("./__fixtures__/AppDelegate.expo57.swift", import.meta.url), "utf8");

describe("iOS scene life cycle (iOS 27 launch assert)", () => {
  it("is registered in app.json", () => {
    expect(appJson.expo.plugins).toContain("./plugins/withIosSceneLifecycle");
  });

  it("declares one window scene driven by Expo's scene delegate", () => {
    const plist = plugin.applySceneManifest({ CFBundleName: "BOAR" });
    expect(plist.CFBundleName).toBe("BOAR");
    expect(plist.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: "EXExpoAppSceneDelegate" },
        ],
      },
    });
  });

  it("hands the window and React Native start to the scene delegate", () => {
    const out = plugin.applySceneAppDelegate(TEMPLATE);
    expect(out).toContain("class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {");
    // the factory is still created in didFinishLaunching (the scene delegate reads it)...
    expect(out).toContain("reactNativeFactory = factory");
    expect(out).toContain("var window: UIWindow?");
    // ...but React Native starts once, from the scene, not from the app delegate
    expect(out).not.toContain("factory.startReactNative(");
    expect(out).not.toContain("UIWindow(frame: UIScreen.main.bounds)");
    // the measurement-build anchor used by scripts/ios-build-on-host.sh (IOS_RN_LOG_INFO) survives
    expect(out).toContain("    let delegate = ReactNativeDelegate()\n");
  });

  it("is idempotent", () => {
    const once = plugin.applySceneAppDelegate(TEMPLATE);
    expect(plugin.applySceneAppDelegate(once)).toBe(once);
  });

  it("fails the prebuild when the template changes", () => {
    const drifted = TEMPLATE.replace("factory.startReactNative(", "factory.start(");
    expect(() => plugin.applySceneAppDelegate(drifted)).toThrow(/doesn't match the expo SDK 57 template/);
  });
});

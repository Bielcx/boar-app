const { withAppDelegate, withInfoPlist } = require("@expo/config-plugins");

/**
 * iOS scene-based life cycle (release blocker, Harbor 28/09). iOS 27 asserts at launch
 * (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption, EXC_BREAKPOINT) when an app
 * linked against the iOS 27 SDK (Xcode 27) has no UIApplicationSceneManifest: the BOAR build
 * crashed on every launch in the iOS 27 simulator. iOS 26 only logs a warning.
 *
 * Expo SDK 57 ships the scene delegate (expo/ios/AppDelegates/ExpoAppSceneDelegate.swift,
 * Objective-C name EXExpoAppSceneDelegate) but no config plugin that turns it on. This plugin:
 * - Info.plist: one window scene whose delegate is EXExpoAppSceneDelegate;
 * - AppDelegate.swift: conforms to ExpoReactNativeFactoryProvider (the scene delegate reads the
 *   factory from it) and no longer creates the window or starts React Native in
 *   didFinishLaunching: under the scene life cycle the scene delegate does both.
 * The AppDelegate edit fails the prebuild when the template changes, instead of shipping an app
 * that starts React Native twice or never.
 */

const SCENE_DELEGATE = "EXExpoAppSceneDelegate";
const PROVIDER = "ExpoReactNativeFactoryProvider";

function applySceneManifest(infoPlist) {
  return {
    ...infoPlist,
    UIApplicationSceneManifest: {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: SCENE_DELEGATE },
        ],
      },
    },
  };
}

// The template's window + startReactNative block in didFinishLaunching (expo SDK 57).
const START_BLOCK =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n\s*withModuleName: "main",\n\s*in: window,\n\s*launchOptions: launchOptions\)\n#endif\n/;
const CLASS_LINE = /class AppDelegate: ExpoAppDelegate \{/;

function applySceneAppDelegate(src) {
  if (src.includes(PROVIDER)) return src; // already applied
  if (!CLASS_LINE.test(src) || !START_BLOCK.test(src)) {
    throw new Error(
      "withIosSceneLifecycle: AppDelegate.swift doesn't match the expo SDK 57 template " +
        "(class AppDelegate: ExpoAppDelegate + window/startReactNative block); update the plugin."
    );
  }
  return src
    .replace(CLASS_LINE, `class AppDelegate: ExpoAppDelegate, ${PROVIDER} {`)
    .replace(
      START_BLOCK,
      "\n    // Scene life cycle (plugins/withIosSceneLifecycle.js): EXExpoAppSceneDelegate creates the\n" +
        "    // window and starts React Native from reactNativeFactory when the scene connects.\n"
    );
}

function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (c) => {
    c.modResults = applySceneManifest(c.modResults);
    return c;
  });
  return withAppDelegate(config, (c) => {
    if (c.modResults.language !== "swift") {
      throw new Error(`withIosSceneLifecycle: expected a Swift AppDelegate, got ${c.modResults.language}`);
    }
    c.modResults.contents = applySceneAppDelegate(c.modResults.contents);
    return c;
  });
}

module.exports = withIosSceneLifecycle;
module.exports.applySceneManifest = applySceneManifest;
module.exports.applySceneAppDelegate = applySceneAppDelegate;
module.exports.SCENE_DELEGATE = SCENE_DELEGATE;

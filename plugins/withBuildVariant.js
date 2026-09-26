const { AndroidConfig, withAndroidManifest } = require("@expo/config-plugins");

/**
 * Android build variants (docs/BUILD_VARIANTS.md), chosen at prebuild time by
 * EXPO_PUBLIC_BOAR_VARIANT — the same variable the JS bundle reads
 * (src/config/variant.ts), so the APK's permissions and the app's behaviour
 * can't disagree.
 *
 * - downloader (default): today's app. Declares INTERNET to fetch models.
 * - offline: no INTERNET or network-state permission at all; models and
 *   packs are imported from files. Installs next to the downloader build
 *   (own applicationId) so both can live on one phone.
 *
 * Voice input needs RECORD_AUDIO. The offline build drops it unless it was
 * built with EXPO_PUBLIC_BOAR_VOICE=1.
 */

const NETWORK_PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.ACCESS_WIFI_STATE",
  "android.permission.CHANGE_NETWORK_STATE",
  "android.permission.CHANGE_WIFI_STATE",
];

// Never needed by a release build of this app, in either variant.
// SYSTEM_ALERT_WINDOW comes from the React Native dev template; file imports
// go through the system document picker (SAF), which needs no storage permission.
const ALWAYS_BLOCKED = [
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
];

function parseVariant(raw) {
  return String(raw ?? "").trim().toLowerCase() === "offline" ? "offline" : "downloader";
}

/** Pure: which permissions a variant must not declare. Tested in src/config/buildVariant.test.ts. */
function blockedPermissionsFor(variant, voiceEnabled) {
  const blocked = [...ALWAYS_BLOCKED];
  if (variant === "offline") {
    blocked.push(...NETWORK_PERMISSIONS);
    if (!voiceEnabled) blocked.push("android.permission.RECORD_AUDIO");
  }
  return blocked;
}

function variantFromEnv(env = process.env) {
  return {
    variant: parseVariant(env.EXPO_PUBLIC_BOAR_VARIANT),
    voice: env.EXPO_PUBLIC_BOAR_VOICE === "1",
  };
}

/** Applies the variant to an Expo config object (called from app.config.js). */
function applyBuildVariant(config, env = process.env) {
  const { variant, voice } = variantFromEnv(env);
  const android = { ...(config.android ?? {}) };
  android.blockedPermissions = [
    ...new Set([...(android.blockedPermissions ?? []), ...blockedPermissionsFor(variant, voice)]),
  ];
  // Chat history and models stay on the phone: no cloud/device-transfer backup.
  android.allowBackup = false;
  if (variant === "offline") {
    android.package = `${android.package}.offline`;
  }
  const next = {
    ...config,
    name: variant === "offline" ? `${config.name} Offline` : config.name,
    android,
    extra: { ...(config.extra ?? {}), boarVariant: variant, boarVoice: voice },
  };
  return withNoCleartext(next);
}

// Release builds never talk plain HTTP. The debug manifest (dev client ->
// Metro) overrides this for debug builds only.
function withNoCleartext(config) {
  return withAndroidManifest(config, (config) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    app.$["android:usesCleartextTraffic"] = "false";
    return config;
  });
}

module.exports = {
  applyBuildVariant,
  blockedPermissionsFor,
  parseVariant,
  variantFromEnv,
  NETWORK_PERMISSIONS,
};

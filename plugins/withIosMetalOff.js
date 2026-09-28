const { withAppDelegate } = require("@expo/config-plugins");

/**
 * iOS runs llama.rn on the CPU only in v1.1 (Boar decision, 28/09, reversible). Measured on the
 * iPhone 13, integration 707ac6d:
 * - CPU with Metal on for the embedder: ttft 5.3 s, 14.2 tok/s, opens in 5.3-10.8 s.
 * - CPU with no Metal: ttft 4.0 s, 22.7 tok/s, opens in 2.8-3.9 s.
 * - GPU: ttft 2.95 s, 12.3 tok/s, opens in ~7 s, with a critical memory warning while loading.
 * (review/IPHONE-TEST.md, shots/ios-device/707ac6d/RESULTS.md.)
 *
 * ggml reads GGML_METAL_DEVICES when its Metal backend registers (0 = no Metal device, so every
 * context lands on the CPU). The AppDelegate sets it first thing in didFinishLaunching, before
 * React Native (and so llama.rn) starts. overwrite = 0: a value passed at launch
 * (`devicectl device process launch -e '{"GGML_METAL_DEVICES":"1"}'`) still wins, so the GPU can
 * be measured without a rebuild. To revert the decision, drop the plugin from app.json.
 */

const MARK = 'setenv("GGML_METAL_DEVICES", "0", 0)';
const LAUNCH = /(didFinishLaunchingWithOptions launchOptions: [^\n]*\n\s*\) -> Bool \{\n)/;

function applyMetalOff(src) {
  if (src.includes(MARK)) return src; // already applied
  if (!LAUNCH.test(src)) {
    throw new Error(
      "withIosMetalOff: AppDelegate.swift has no application(_:didFinishLaunchingWithOptions:) in the " +
        "expo SDK 57 shape; update the plugin."
    );
  }
  return src.replace(
    LAUNCH,
    `$1    // v1.1: llama.rn on the CPU only (plugins/withIosMetalOff.js); a launch-time value still wins.\n` +
      `    ${MARK}\n\n`
  );
}

function withIosMetalOff(config) {
  return withAppDelegate(config, (c) => {
    if (c.modResults.language !== "swift") {
      throw new Error(`withIosMetalOff: expected a Swift AppDelegate, got ${c.modResults.language}`);
    }
    c.modResults.contents = applyMetalOff(c.modResults.contents);
    return c;
  });
}

module.exports = withIosMetalOff;
module.exports.applyMetalOff = applyMetalOff;
module.exports.MARK = MARK;

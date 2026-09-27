import { requireOptionalNativeModule, EventSubscription } from "expo-modules-core";
import * as FileSystem from "expo-file-system/legacy";
import { APP_VARIANT, voiceInBuild } from "../config/variant";
import { RecognitionMode, VoiceSupport, voicePolicy } from "./voicePolicy";

export type VoiceEvent =
  | { type: "start" }
  | { type: "end" }
  | { type: "partial"; text: string }
  | { type: "result"; text: string }
  | { type: "error"; code: string; message: string };

interface VoiceInputNativeModule {
  isAvailable(): Promise<boolean>;
  /** Absent in builds before on-device support: treat as "system". */
  getRecognitionMode?(): Promise<RecognitionMode>;
  startListening(requireOnDevice: boolean): Promise<void>;
  stopListening(): Promise<void>;
  addListener(eventName: string, listener: (event: any) => void): EventSubscription;
}

const VoiceInputNative = requireOptionalNativeModule<VoiceInputNativeModule>("VoiceInput");

// Consent to the system recognition service lives in its own file, not
// settings.json, so it can't be flipped as a side effect of other settings.
const CONSENT_PATH = `${FileSystem.documentDirectory}voice-consent.json`;

export async function getSystemVoiceServiceAccepted(): Promise<boolean> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(CONSENT_PATH)).systemServiceAccepted === true;
  } catch {
    return false;
  }
}

/**
 * Records the user's explicit "yes, use the phone's speech service even
 * though it may go online". Only meaningful in the downloader build.
 */
export async function setSystemVoiceServiceAccepted(accepted: boolean): Promise<void> {
  await FileSystem.writeAsStringAsync(CONSENT_PATH, JSON.stringify({ systemServiceAccepted: accepted }));
}

async function recognitionMode(): Promise<RecognitionMode> {
  if (!VoiceInputNative) return "unavailable";
  try {
    if (VoiceInputNative.getRecognitionMode) return await VoiceInputNative.getRecognitionMode();
    return (await VoiceInputNative.isAvailable()) ? "system" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * What voice input can do on this phone under BOAR's policy
 * (src/voice/voicePolicy.ts): on-device only, unless the user accepted the
 * system service; never the system service in the offline build. The UI
 * shows `reason` — "system-needs-consent" is where to offer the warning.
 */
export async function getVoiceSupport(): Promise<VoiceSupport> {
  return voicePolicy({
    mode: await recognitionMode(),
    variant: APP_VARIANT,
    voiceInBuild: voiceInBuild(),
    systemServiceAccepted: await getSystemVoiceServiceAccepted(),
  });
}

/** Whether the mic button can work right now under the policy above. */
export async function isVoiceInputAvailable(): Promise<boolean> {
  return (await getVoiceSupport()).usable;
}

/**
 * Starts one listening session: on-device recognition, or the system
 * service only if getVoiceSupport() allows it (see modules/voice-input). Resolves with the
 * final transcript once the recognizer reports a result, or null on
 * error/cancel. `onEvent` is optional, for UI feedback (e.g. partial
 * results, listening state) beyond the final resolved text.
 */
export async function startListening(onEvent?: (event: VoiceEvent) => void): Promise<string | null> {
  if (!VoiceInputNative) return null;
  const support = await getVoiceSupport();
  if (!support.usable) {
    onEvent?.({ type: "error", code: support.reason, message: `Voice input unavailable: ${support.reason}` });
    return null;
  }
  const native = VoiceInputNative;

  return new Promise((resolve) => {
    const subscriptions: EventSubscription[] = [];
    let resolved = false;

    const finish = (text: string | null) => {
      if (resolved) return;
      resolved = true;
      subscriptions.forEach((s) => s.remove());
      resolve(text);
    };

    subscriptions.push(
      native.addListener("onSpeechStart", () => onEvent?.({ type: "start" })),
      native.addListener("onSpeechEnd", () => onEvent?.({ type: "end" })),
      native.addListener("onPartialResults", (e: { text: string }) =>
        onEvent?.({ type: "partial", text: e.text })
      ),
      native.addListener("onResults", (e: { text: string }) => {
        onEvent?.({ type: "result", text: e.text });
        finish(e.text);
      }),
      native.addListener("onError", (e: { code: string; message: string }) => {
        onEvent?.({ type: "error", code: e.code, message: e.message });
        finish(null);
      })
    );

    native.startListening(support.requireOnDevice).catch(() => finish(null));
  });
}

export async function stopListening(): Promise<void> {
  if (!VoiceInputNative) return;
  await VoiceInputNative.stopListening().catch(() => {});
}

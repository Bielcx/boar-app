// Sharing an evaluation run with the BOAR project (supabase/functions/submit-results). Pure
// parts: what gets sent, and what the server's answer means. The app never sends anything on
// its own; the user presses "Share results" and confirms what is listed.
import type { EvalResultRow } from "./evalHarness.pure";

export interface ShareDevice {
  platform: "android" | "ios";
  osVersion?: string;
  brand?: string;
  model?: string;
  ramBytes?: number;
}

export interface ShareSubmission {
  installId: string;
  run: {
    runId: string;
    evalSetVersion: string;
    appVersion: string;
    platform: "android" | "ios";
    osVersion?: string;
    deviceBrand?: string;
    deviceModel?: string;
    ramBytes?: number;
  };
  rows: EvalResultRow[];
}

/** Both values come from .env (EXPO_PUBLIC_*); without them the app has no share button. */
export function submitResultsUrl(supabaseUrl: string | undefined, publishableKey: string | undefined): string | null {
  if (!supabaseUrl || !publishableKey) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/submit-results`;
}

export function buildSubmission(
  rows: EvalResultRow[],
  device: ShareDevice,
  installId: string,
  appVersion: string
): ShareSubmission {
  const first = rows[0];
  return {
    installId,
    run: {
      runId: first.runId,
      evalSetVersion: first.evalSetVersion,
      appVersion,
      platform: device.platform,
      osVersion: device.osVersion,
      deviceBrand: device.brand,
      deviceModel: device.model,
      ramBytes: device.ramBytes && device.ramBytes > 0 ? device.ramBytes : undefined,
    },
    rows,
  };
}

export type ShareResult = "shared" | "already-shared" | "rate-limited" | "rejected" | "failed";

/** The HTTP status submit-results answers with, as something the screen can say. */
export function shareResultFromStatus(status: number): ShareResult {
  if (status === 201) return "shared";
  if (status === 409) return "already-shared";
  if (status === 429) return "rate-limited";
  if (status >= 400 && status < 500) return "rejected";
  return "failed";
}

/** "POCO 2311DRK48G · Android 15 · 11 GB RAM", for the confirmation before sending. */
export function describeDevice(d: ShareDevice): string {
  const name = [d.brand, d.model].filter(Boolean).join(" ") || "Unknown phone";
  const os = d.osVersion ? `${d.platform === "ios" ? "iOS" : "Android"} ${d.osVersion}` : null;
  const ram = d.ramBytes && d.ramBytes > 0 ? `${Math.round(d.ramBytes / 1024 ** 3)} GB RAM` : null;
  return [name, os, ram].filter(Boolean).join(" · ");
}

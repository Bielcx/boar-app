// Sends one evaluation run to the BOAR project's submit-results function (supabase/). Only
// called after the user confirms on the Evaluation screen; see shareResults.pure.ts.
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import { getDeviceTotalRamBytes } from "ram-monitor";
import appConfig from "../../app.json";
import { getOrCreateInstallId } from "../models/settings";
import type { EvalResultRow } from "./evalHarness.pure";
import { buildSubmission, shareResultFromStatus, submitResultsUrl, type ShareDevice, type ShareResult } from "./shareResults.pure";

// Expo inlines EXPO_PUBLIC_* at build time only when they're read by their full name.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const ENDPOINT = submitResultsUrl(SUPABASE_URL, PUBLISHABLE_KEY);

/** False in builds made without the Supabase values in .env: the screen shows no share button. */
export const resultsSharingAvailable = ENDPOINT !== null;

export function shareDevice(): ShareDevice {
  const c = Platform.constants as { Brand?: string; Model?: string; Release?: string; osVersion?: string };
  return {
    platform: Platform.OS === "ios" ? "ios" : "android",
    osVersion: c.Release ?? c.osVersion ?? String(Platform.Version),
    brand: c.Brand,
    model: c.Model,
    ramBytes: getDeviceTotalRamBytes(),
  };
}

export async function shareEvalRun(rows: EvalResultRow[]): Promise<ShareResult> {
  if (!ENDPOINT || !PUBLISHABLE_KEY || rows.length === 0) return "failed";
  const installId = await getOrCreateInstallId(() => Crypto.randomUUID());
  const body = buildSubmission(rows, shareDevice(), installId, appConfig.expo.version);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: PUBLISHABLE_KEY },
      body: JSON.stringify(body),
    });
    return shareResultFromStatus(res.status);
  } catch {
    return "failed";
  }
}

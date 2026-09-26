/** Pure half of location.ts: result shapes and the mapping from the native module. */

export type PermissionStatus = "granted" | "denied" | "undetermined";

export type PointResult =
  | { lat: number; lon: number; accuracyM: number; ageS: number }
  | { error: "denied" | "unavailable" | "timeout" };

/** Shape returned by modules/device-location getCurrentPosition. */
export interface NativePosition {
  latitude: number;
  longitude: number;
  accuracyM: number;
  timestamp: number;
  source: "gps" | "cached";
}

export function toPoint(pos: NativePosition, nowMs: number): PointResult {
  return {
    lat: pos.latitude,
    lon: pos.longitude,
    accuracyM: pos.accuracyM,
    ageS: Math.max(0, Math.round((nowMs - pos.timestamp) / 1000)),
  };
}

/** Maps the module's rejection codes; anything unknown counts as unavailable. */
export function toError(e: unknown): PointResult {
  const code = (e as { code?: string } | null)?.code;
  if (code === "E_PERMISSION") return { error: "denied" };
  if (code === "E_TIMEOUT") return { error: "timeout" };
  return { error: "unavailable" };
}

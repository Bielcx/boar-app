/**
 * The phone's position for offline places, on top of Ledger's
 * modules/offline-location ("offline-location") (GPS only, no Google Play Services). Never asks
 * for permission itself: callers check the status and ask in context.
 * The routing layer (Tusk) receives getCurrentPoint through
 * registerGeoProviders, so this file is the one place that talks to the
 * native module.
 */
import { deviceLocation } from "../ui/flows/adapters";

export type { PermissionStatus, PointResult, NativePosition } from "./location.pure";
import { isFresh, permissionBlock, PermissionStatus, PointResult, toError, toPoint } from "./location.pure";

/** What the "use my location" button gets back (Ledger's requestLocationForQuestion). */
export type LocationRequest =
  | { status: "ok"; lat: number; lon: number }
  | { status: "declined" }
  | { status: "unavailable" };

export async function getLocationPermission(): Promise<PermissionStatus> {
  const native = deviceLocation();
  if (!native) return "denied";
  try {
    return await native.getPermissionStatus();
  } catch {
    return "denied";
  }
}

/** Opens the system dialog. Call it only after the user asked for location in context. */
export async function requestLocationPermission(): Promise<"granted" | "denied"> {
  const native = deviceLocation();
  if (!native) return "denied";
  try {
    return await native.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * The last known fix if it is recent enough, otherwise a new one, within
 * `timeoutMs`. Short timeouts (the answer path uses ~700 ms) are fine.
 */
export async function getCurrentPoint({ timeoutMs = 10_000, maxAgeMs = 10 * 60_000 } = {}): Promise<PointResult> {
  const native = deviceLocation();
  if (!native) return { error: "unavailable" };
  const blocked = permissionBlock(await getLocationPermission());
  if (blocked) return blocked;
  try {
    const last = await native.getLastKnownPosition?.().catch(() => null);
    if (isFresh(last, Date.now(), maxAgeMs)) return toPoint(last, Date.now());
    return toPoint(await native.getCurrentPosition({ timeoutMs, maxAgeMs }), Date.now());
  } catch (e) {
    return toError(e);
  }
}

/**
 * For an explicit "use my location" tap: shows `explain` only while the
 * permission is undetermined, then the system dialog, then reads a fix.
 * After a "no" it does not ask again. Backed by Ledger's
 * requestLocationForQuestion once feat/trust-offline is integrated.
 */
export async function locateForUser(explain: () => Promise<boolean>): Promise<LocationRequest> {
  const native = deviceLocation();
  if (!native) return { status: "unavailable" };
  const status = await getLocationPermission();
  if (status === "denied") return { status: "declined" };
  if (status === "undetermined") {
    if (!(await explain())) return { status: "declined" };
    if ((await requestLocationPermission()) !== "granted") return { status: "declined" };
  }
  const point = await getCurrentPoint();
  if ("error" in point) return point.error === "denied" ? { status: "declined" } : { status: "unavailable" };
  return { status: "ok", lat: point.lat, lon: point.lon };
}

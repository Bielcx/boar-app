/**
 * Where the chat gets "use my location" from. Loom's src/services/location.ts
 * (feat/ui-flows, PR #6) provides locateForUser on top of Ledger's GPS-only
 * module. Until that is merged here this is null: the places card then hides
 * the button and asks for the city, which is also what it does when the
 * permission is denied. Replace with:
 *   export { locateForUser as locate } from "../../services/location";
 */
export type LocationRequest =
  | { status: "ok"; lat: number; lon: number }
  | { status: "declined" }
  | { status: "unavailable" };

export const locate: ((explain: () => Promise<boolean>) => Promise<LocationRequest>) | null = null;

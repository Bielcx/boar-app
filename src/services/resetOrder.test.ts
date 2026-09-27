import { describe, it, expect } from "vitest";
import { closeRegisteredStores, registerStoreCloser, RESET_ORDER, runReset, type ResetSteps } from "./resetOrder";

function recorder(failAt?: keyof ResetSteps) {
  const calls: string[] = [];
  const steps = Object.fromEntries(
    RESET_ORDER.map((name) => [
      name,
      async () => {
        calls.push(name);
        if (name === failAt) throw new Error(`${name} failed`);
      },
    ])
  ) as unknown as ResetSteps;
  return { calls, steps };
}

describe("Erase everything order (Prism RS-1)", () => {
  it("stops downloads and closes every connection before deleting any file", async () => {
    const { calls, steps } = recorder();
    await runReset(steps);
    expect(calls).toEqual([
      "cancelDownloads",
      "unloadEngines",
      "closeStores",
      "resetDatabase",
      "deleteFiles",
      "clearSettings",
    ]);
  });

  it("deletes nothing when a connection fails to close", async () => {
    for (const failAt of ["closeStores", "resetDatabase"] as const) {
      const { calls, steps } = recorder(failAt);
      await expect(runReset(steps)).rejects.toThrow(`${failAt} failed`);
      expect(calls).not.toContain("deleteFiles");
      expect(calls.at(-1)).toBe(failAt);
    }
  });

  it("runs each step after the previous one finished, not in parallel", async () => {
    const log: string[] = [];
    const slow = (name: string, ms: number) => async () => {
      log.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`${name}:end`);
    };
    await runReset({
      cancelDownloads: slow("cancel", 5),
      unloadEngines: slow("unload", 1),
      closeStores: slow("close", 5),
      resetDatabase: slow("db", 1),
      deleteFiles: slow("delete", 1),
      clearSettings: slow("settings", 1),
    });
    expect(log.indexOf("close:end")).toBeLessThan(log.indexOf("db:start"));
    expect(log.indexOf("db:end")).toBeLessThan(log.indexOf("delete:start"));
  });
});

describe("registered store closers", () => {
  it("closes every registered store, and a name registered again replaces the old closer", async () => {
    const closed: string[] = [];
    registerStoreCloser("places", async () => void closed.push("places-old"));
    registerStoreCloser("places", async () => void closed.push("places"));
    registerStoreCloser("other", async () => void closed.push("other"));
    await closeRegisteredStores();
    expect(closed.sort()).toEqual(["other", "places"]);
  });
});

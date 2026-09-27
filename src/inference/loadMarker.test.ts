import { describe, it, expect } from "vitest";
import { createLoadGuard, CrashLedger, LoadCrash, MarkerStore } from "./loadMarker";

function memory() {
  let file: string | null = null;
  const store: MarkerStore = { read: async () => file, write: async (j) => void (file = j), clear: async () => void (file = null) };
  const crashes: LoadCrash[] = [];
  const successes: string[] = [];
  let pending: LoadCrash | null = null;
  const ledger: CrashLedger = {
    recordCrash: async (c) => void (crashes.push(c), (pending = c)),
    recordSuccess: async (id) => void successes.push(id),
    takePending: async () => {
      const c = pending;
      pending = null;
      return c;
    },
  };
  return { store, ledger, crashes, successes, file: () => file };
}

describe("load marker (CR-2)", () => {
  const q15 = { filename: "models/q15.gguf", modelId: "qwen2.5-1.5b", label: "Qwen2.5 1.5B" };
  const q4 = { filename: "models/q4.gguf", modelId: "qwen3-4b", label: "Qwen3 4B" };

  it("a load that returns leaves no marker and records the success", async () => {
    const m = memory();
    const g = createLoadGuard(m.store, m.ledger, () => 1000);
    await g.begin(q4, q15);
    expect(JSON.parse(m.file()!)).toMatchObject({ modelId: "qwen3-4b", previous: { modelId: "qwen2.5-1.5b" }, at: 1000 });
    await g.end(q4, true);
    expect(m.file()).toBeNull();
    expect(m.successes).toEqual(["qwen3-4b"]);
    expect(await g.consume()).toBeNull();
  });

  it("a marker left by a killed app is reported once on the next start, with the model to fall back to", async () => {
    const m = memory();
    await createLoadGuard(m.store, m.ledger, () => 1000).begin(q4, q15); // ... OOM kill: end() never runs
    const next = createLoadGuard(m.store, m.ledger); // new process
    const crash = { crashedModelId: "qwen3-4b", crashedLabel: "Qwen3 4B", fallbackModelId: "qwen2.5-1.5b", fallbackLabel: "Qwen2.5 1.5B", at: 1000 };
    expect(await next.consume()).toEqual(crash);
    expect(await next.consume()).toBeNull();
    expect(m.crashes).toEqual([crash]);
    expect(m.file()).toBeNull();
  });

  it("the next load checks for a crash before writing its own marker", async () => {
    const m = memory();
    await createLoadGuard(m.store, m.ledger).begin(q4, q15);
    const next = createLoadGuard(m.store, m.ledger);
    await next.begin(q15, null);
    expect(m.crashes.map((c) => c.crashedModelId)).toEqual(["qwen3-4b"]);
    expect(JSON.parse(m.file()!).modelId).toBe("qwen2.5-1.5b");
  });
});

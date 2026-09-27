import { describe, it, expect, vi } from "vitest";
import { DbClosedError } from "./guardedDb";

const { log, conns } = vi.hoisted(() => ({ log: [] as string[], conns: [] as any[] }));
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => {
    const n = conns.length + 1;
    let release: () => void = () => {};
    const conn = {
      n,
      finishRead: () => release(),
      execAsync: async () => {},
      runAsync: async () => ({ changes: 0 }),
      getAllAsync: async () => [],
      getFirstAsync: (sql: string) =>
        /slow/.test(sql)
          ? new Promise((resolve) => (release = () => (log.push(`read ${n} done`), resolve({ ok: 1 }))))
          : Promise.resolve(null),
      withTransactionAsync: async (task: () => Promise<void>) => task(),
      closeAsync: async () => void log.push(`close ${n}`),
    };
    log.push(`open ${n}`);
    conns.push(conn);
    return conn;
  },
  deleteDatabaseAsync: async () => void log.push("delete"),
}));

import { getDb, resetDatabase } from "./db";

describe("resetDatabase", () => {
  it("closes once after the reads in flight, then deletes; old handles reject in JS; getDb() opens a new one", async () => {
    const db = await getDb();
    const slow = db.getFirstAsync("SELECT slow");
    const first = resetDatabase();
    const second = resetDatabase();
    await Promise.resolve();
    expect(log.filter((l) => l.startsWith("close") || l === "delete")).toEqual([]);
    conns[0].finishRead();
    await Promise.all([first, second, slow]);
    expect(log.filter((l) => /^(read|close|delete)/.test(l))).toEqual(["read 1 done", "close 1", "delete"]);
    // The handle the caller kept (like the seed's loop) never reaches the closed native connection.
    await expect(db.getFirstAsync("SELECT 1")).rejects.toBeInstanceOf(DbClosedError);
    const fresh = await getDb();
    expect(fresh).not.toBe(db);
    expect(log).toContain("open 2");
  });
});

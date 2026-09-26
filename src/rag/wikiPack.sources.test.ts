/// <reference types="node" />
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decompress } from "fzstd";
import { nodeSqliteDatabase } from "./testing/nodeSqlite";
import { WikiPack } from "./wikiPack";

// Topic-pack sources beyond Wikipedia (the crypto pack's EIPs, specs, BIPs):
// source codes survive the round trip and "aliases" resolve like redirects.
// Made-up, test-only documents.
const filler = (topic: string) =>
  Array.from({ length: 6 }, (_, i) => `${topic} filler sentence number ${i} about unrelated matters.`).join(" ");
const rows = [
  {
    page_id: 5e9 + 20, title: "ERC-20: Token Standard", source: "eips", url: "https://eips.ethereum.org/EIPS/eip-20", license: "CC0-1.0",
    aliases: ["ERC-20", "ERC20", "EIP-20"],
    text: `# ERC-20: Token Standard\n\nA standard interface for fungible tokens with transfer and approve functions. ${filler("Token")}`,
  },
  {
    page_id: 8e9 + 32, title: "BIP 32: Hierarchical Deterministic Wallets", source: "bips", url: "https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki", license: "BSD-2-Clause",
    aliases: ["BIP-32", "BIP32"],
    text: `# BIP 32: Hierarchical Deterministic Wallets\n\nDescribes deriving a tree of keypairs from a single seed. ${filler("Wallet")}`,
  },
  // Neighbours that mention ERC-20, approve and transfer more often than the standard itself (as vault ERCs do).
  ...[4626, 7535, 5143, 7575].map((n) => ({
    page_id: 5e9 + n, title: `ERC-${n}: Vault extension ${n}`, source: "eips", url: `https://ercs.ethereum.org/ERCS/erc-${n}`, license: "CC0-1.0",
    text: `# ERC-${n}: Vault extension ${n}\n\n${"Vaults hold ERC-20 tokens; users approve the vault, which calls transfer and transferFrom on the ERC-20 token. ".repeat(4)}`,
  })),
];

let pack: WikiPack;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "boar-pack-src-"));
  const shard = join(dir, "crypto.jsonl");
  writeFileSync(shard, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const out = join(dir, "crypto.sqlite");
  execFileSync(process.execPath, ["scripts/build-wiki-pack.mjs", "--out", out, "--shards", shard, "--no-embed"], { stdio: "pipe" });
  pack = await WikiPack.open(nodeSqliteDatabase(out), decompress);
}, 60000);

describe("topic-pack sources", () => {
  it("resolves aliases to their document, case-insensitively", async () => {
    const eips = { source: "eips" } as const;
    const erc20 = await pack.resolveTitle("ERC-20: Token Standard", eips);
    expect(erc20).not.toBeNull();
    expect(await pack.resolveTitle("erc20", eips)).toBe(erc20);
    expect(await pack.resolveTitle("EIP-20", eips)).toBe(erc20);
    const bips = { source: "bips" } as const;
    expect(await pack.resolveTitle("BIP32", bips)).toBe(await pack.resolveTitle("BIP 32: Hierarchical Deterministic Wallets", bips));
  });

  it("keeps each document's source, URL and license", async () => {
    const a = await pack.article((await pack.resolveTitle("BIP-32", { source: "bips" }))!);
    expect(a.source).toBe("bips");
    expect(a.url).toBe("https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki");
    expect(a.license).toBe("BSD-2-Clause");
  });

  it("puts a primary source a question names first, even when neighbours match more of its words", async () => {
    const hits = await pack.search("How do vaults approve and transferFrom ERC-20 tokens?");
    expect(hits[0]?.title).toBe("ERC-20: Token Standard");
  });

  it("puts the document a question names by its alias first", async () => {
    const hits = await pack.search("What is ERC20?");
    expect(hits[0]?.title).toBe("ERC-20: Token Standard");
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///docs/" }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("./embed", () => ({ embeddingEngine: {} }));

import { articleUrl, normalizeUrl } from "./packs";

describe("pack source URLs", () => {
  it("encodes a recorded URL that carries a raw title, and leaves encoded ones alone", () => {
    expect(articleUrl("Quantum cryptography", "enwiki", "https://en.wikipedia.org/wiki/Quantum cryptography")).toBe(
      "https://en.wikipedia.org/wiki/Quantum_cryptography"
    );
    expect(normalizeUrl("https://en.wikipedia.org/wiki/Diffie%E2%80%93Hellman_key_exchange")).toBe("https://en.wikipedia.org/wiki/Diffie%E2%80%93Hellman_key_exchange");
    expect(normalizeUrl("https://www.ready.gov/some page")).toBe("https://www.ready.gov/some%20page");
  });

  it("builds an encoded URL from the title when none is recorded", () => {
    expect(articleUrl("Diffie–Hellman key exchange", "enwiki")).toBe("https://en.wikipedia.org/wiki/Diffie%E2%80%93Hellman_key_exchange");
  });
});

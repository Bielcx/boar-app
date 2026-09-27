import { describe, it, expect } from "vitest";
import { checkCitations, citationSupport } from "./citations";
import type { RetrievedChunk } from "../rag/retrieve.types";

const src = (title: string, body: string): RetrievedChunk => ({ chunkId: title, docId: title, title, body, score: 1, matchType: "lexical" });
const WALIPINI = src("Appropedia: Walipini", "A Walipini is an earth-sheltered cold frame. It takes advantage of the heat stored in the earth during the cold season.");
const NOSEBLEED = src("Nosebleed", "Treatment: Most anterior nosebleeds can be stopped by applying direct pressure. Apply pressure to the soft part of the nose by pinching it, and tilt the head forward.");
const PQC = src("Post-quantum cryptography", "Post-quantum cryptography is the development of cryptographic algorithms that are thought to be secure against a cryptanalytic attack by a quantum computer.");

describe("checkCitations (CT-1)", () => {
  it("drops [1] when the source doesn't say it (the 1.5B's seasons answer on device)", () => {
    const r = checkCitations("Earth's axial tilt causes the seasons [1]. Summer comes when your hemisphere leans toward the Sun.", [WALIPINI]);
    expect(r.text).toBe("Earth's axial tilt causes the seasons. Summer comes when your hemisphere leans toward the Sun.");
    expect(r.removed).toEqual([1]);
  });

  it("keeps a citation the source supports", () => {
    const answer = "To stop a nosebleed, apply pressure by pinching the soft part of the nose and tilt the head forward [1].";
    expect(checkCitations(answer, [NOSEBLEED])).toEqual({ text: answer, removed: [] });
  });

  it("drops a claim the source doesn't carry even when the topic matches (names from memory)", () => {
    const r = checkCitations("Quantum-resistant signatures include Dilithium, Falcon and SPHINCS+, selected by NIST [1].", [PQC]);
    expect(r.removed).toEqual([1]);
    expect(r.text).toBe("Quantum-resistant signatures include Dilithium, Falcon and SPHINCS+, selected by NIST.");
  });

  it("drops a number past the sources, and handles '. [1]' and several citations", () => {
    expect(checkCitations("Pinch the soft part of the nose. [1] It was built in 1912 [3].", [NOSEBLEED]).text).toBe("Pinch the soft part of the nose. [1] It was built in 1912.");
    expect(checkCitations("Pinch the nose [1][2].", [NOSEBLEED]).removed).toEqual([2]);
  });

  it("support is the share of the sentence's key words found in the source", () => {
    expect(citationSupport("Earth's axial tilt causes the seasons", WALIPINI)).toBeLessThan(0.5);
    expect(citationSupport("apply pressure by pinching the soft part of the nose", NOSEBLEED)).toBeGreaterThan(0.8);
  });
});

import { describe, it, expect } from "vitest";
import { attributeCitations, checkCitations, citationSupport, dedupeCitations } from "./citations";
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

describe("attributeCitations (the inverse of CT-1)", () => {
  const src = (title: string, body: string) => ({ chunkId: title, docId: title, title, body, score: 1, matchType: "lexical" as const });
  const MONSOON = src("Monsoon", "A monsoon is a seasonal reversing wind accompanied by changes in precipitation.");
  const GREEN = src("Greenhouse effect", "The greenhouse effect occurs when greenhouse gases in the atmosphere trap heat radiated by the surface.");
  it("adds the [n] of the source that supports a sentence, the best one", () => {
    const r = attributeCitations("A monsoon is a seasonal reversing wind. Greenhouse gases trap heat in the atmosphere.", [MONSOON, GREEN]);
    expect(r.text).toBe("A monsoon is a seasonal reversing wind [1]. Greenhouse gases trap heat in the atmosphere [2].");
    expect(r.added).toEqual([1, 2]);
  });
  it("gate 9ef80f9, real answer: a wrong sentence that shares half its words with the source gets no [n]", () => {
    const pqc = src("Post-quantum cryptography", "Post-quantum cryptography refers to cryptographic algorithms that are secure against an attack by a quantum computer. Most widely used public-key algorithms rely on the integer factorization problem or the discrete logarithm problem, which a quantum computer could break. The Open Quantum Safe project provides liboqs, an open source library of quantum-resistant signature algorithms.");
    const wrong = "Quantum-resistant signature algorithms include those based on elliptic curve cryptography (ECC).";
    expect(attributeCitations(wrong, [pqc]).added).toEqual([]);
    expect(attributeCitations("Liboqs, an open-source library, integrates several quantum-resistant signature algorithms.", [pqc]).added).toEqual([1]);
  });

  it("Prism CIT-2: a citation written after the period belongs to that sentence (no '[1]. [1]')", () => {
    const r = attributeCitations("A monsoon is a seasonal reversing wind accompanied by changes in precipitation. [1]", [MONSOON]);
    expect(r.text).toBe("A monsoon is a seasonal reversing wind accompanied by changes in precipitation. [1]");
    expect(r.added).toEqual([]);
  });

  it("never without support, never to a short sentence, never twice", () => {
    expect(attributeCitations("Ice cream is sold on beaches.", [MONSOON]).added).toEqual([]);
    expect(attributeCitations("Monsoon.", [MONSOON]).added).toEqual([]);
    expect(attributeCitations("A monsoon is a seasonal reversing wind [1].", [MONSOON]).text).toBe("A monsoon is a seasonal reversing wind [1].");
  });
});

describe("dedupeCitations (Prism CIT-2)", () => {
  it("one [n] per sentence end", () => {
    expect(dedupeCitations("The ITCZ moves [1]. [1]")).toBe("The ITCZ moves [1].");
    expect(dedupeCitations("The ITCZ moves [1] [1].")).toBe("The ITCZ moves [1].");
    expect(dedupeCitations("A [1]. B [2].")).toBe("A [1]. B [2].");
    expect(dedupeCitations("A [1] [2].")).toBe("A [1] [2].");
  });
});

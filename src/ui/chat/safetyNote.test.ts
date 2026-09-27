import { describe, it, expect } from "vitest";
import { isHealthQuestion, needsEmergencyNote, showsEmergencyNote, usesPreparednessPack } from "./safetyNote";

const prep = { chunkId: "pack:boar-preparedness:123" };
const wiki = { chunkId: "pack:enwiki:9" };

describe("needsEmergencyNote (Boar E-1)", () => {
  it("shows the note when a passage comes from the Emergency and preparedness pack", () => {
    expect(usesPreparednessPack([wiki, prep])).toBe(true);
    expect(needsEmergencyNote("How do I purify water?", [prep])).toBe(true);
  });

  it("shows it for health and first-aid questions, in EN and PT, whatever the sources", () => {
    for (const q of [
      "How do I stop a nosebleed?",
      "What to do for a burn",
      "someone is choking",
      "Como estancar um sangramento nasal?",
      "o que fazer numa queimadura",
      "sintomas de infarto",
      "sharp pain in my arm",
      "dor de cabeça forte",
    ]) {
      expect(isHealthQuestion(q)).toBe(true);
      expect(needsEmergencyNote(q, [wiki])).toBe(true);
    }
  });

  it("stays off for everyday questions", () => {
    for (const q of ["Why do we have seasons on Earth?", "What is 30 °C in Fahrenheit?", "Compare Raft and Paxos", "vegan restaurants in Berlin", "vegan places in Spain", "a painting by Goya", "Doral is a city", "How does a firewall work?", "raio-x do pulmão é seguro?", "Lost in Translation plot"]) {
      expect(needsEmergencyNote(q, [wiki])).toBe(false);
    }
  });
});

describe("showsEmergencyNote (EQ-1)", () => {
  const base = { question: "What should I do during an earthquake?", sources: [wiki], placesOnly: false };

  it("shows for a safety answer made only of the instant passage (no model text)", () => {
    expect(showsEmergencyNote({ ...base, hasModelText: false, hasSnippet: true })).toBe(true);
  });

  it("shows for a safety answer with model text", () => {
    expect(showsEmergencyNote({ ...base, hasModelText: true, hasSnippet: false })).toBe(true);
  });

  it("shows when a passage comes from the preparedness pack by article id", () => {
    expect(
      showsEmergencyNote({ question: "tell me about Walipini", sources: [{ chunkId: "c1", docId: "pack:boar-preparedness:a3" }], hasModelText: true, hasSnippet: false, placesOnly: false })
    ).toBe(true);
  });

  it("stays off before anything is on screen, for places lists, and for everyday questions", () => {
    expect(showsEmergencyNote({ ...base, hasModelText: false, hasSnippet: false })).toBe(false);
    expect(showsEmergencyNote({ ...base, hasModelText: true, hasSnippet: false, placesOnly: true })).toBe(false);
    expect(showsEmergencyNote({ question: "Compare Raft and Paxos", sources: [wiki], hasModelText: true, hasSnippet: true, placesOnly: false })).toBe(false);
  });

  it("recognises disasters in EN and PT", () => {
    for (const q of ["What should I do during an earthquake?", "how to evacuate a flood", "O que fazer num terremoto?", "como agir em uma enchente", "incêndio no prédio", "there is a fire in the kitchen"]) {
      expect(isHealthQuestion(q)).toBe(true);
    }
  });
});

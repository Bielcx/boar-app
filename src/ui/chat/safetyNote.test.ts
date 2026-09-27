import { describe, it, expect } from "vitest";
import { isHealthQuestion, needsEmergencyNote, usesPreparednessPack } from "./safetyNote";

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
    for (const q of ["Why do we have seasons on Earth?", "What is 30 °C in Fahrenheit?", "Compare Raft and Paxos", "vegan restaurants in Berlin", "vegan places in Spain", "a painting by Goya", "Doral is a city"]) {
      expect(needsEmergencyNote(q, [wiki])).toBe(false);
    }
  });
});

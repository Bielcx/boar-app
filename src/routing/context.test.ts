import { describe, it, expect } from "vitest";
import type { RetrievedChunk } from "../rag/retrieve.types";
import {
  approxTokens,
  compressContext,
  INSTANT_FINAL_CONFIDENCE,
  mergeSources,
  scoreSentences,
  selectInstant,
  splitSentences,
} from "./context";

const chunk = (chunkId: string, title: string, body: string, score = 1): RetrievedChunk => ({
  chunkId,
  docId: chunkId,
  title,
  body,
  score,
  matchType: "hybrid",
});

// Realistic-length encyclopedia leads (~500 tokens total), same shape the corpus returns.
const CANBERRA = chunk(
  "c1",
  "Canberra",
  "Canberra is the capital city of Australia. Founded following the federation of the colonies of Australia as the seat of government for the new nation, it is Australia's largest inland city. " +
    "The city is located at the northern end of the Australian Capital Territory, 280 km south-west of Sydney and 660 km north-east of Melbourne. " +
    "A resident of Canberra is known as a Canberran. Although Canberra is the capital and seat of government, many federal government ministries have secondary seats in state capital cities. " +
    "The site of Canberra was selected for the location of the nation's capital in 1908 as a compromise between Sydney and Melbourne, the two largest cities. " +
    "The city was designed by the American architects Walter Burley Griffin and Marion Mahony Griffin after an international design contest."
);
const SYDNEY = chunk(
  "c2",
  "Sydney",
  "Sydney is the capital city of the state of New South Wales and the most populous city in Australia. " +
    "Located on Australia's east coast, the metropolis surrounds Port Jackson and extends about 80 km on its periphery towards the Blue Mountains to the west. " +
    "Sydney is made up of 658 suburbs, spread across 33 local government areas. " +
    "The city is home to the Sydney Opera House and the Sydney Harbour Bridge, which are among the most recognisable structures in the world."
);
const MOLD = chunk(
  "c3",
  "Mold",
  "A mold or mould is one of the structures that certain fungi can form. The dust-like, colored appearance of molds is due to the formation of spores. " +
    "Molds are considered to be microbes and do not form a specific taxonomic or phylogenetic grouping. " +
    "Mold growth needs moisture, and it can be found both indoors and outdoors on organic material such as bread, fruit and damp walls."
);

const INDUSTRIAL = chunk(
  "c4",
  "Industrial Revolution",
  "The Industrial Revolution was a transition to new manufacturing processes in Great Britain, continental Europe, and the United States, from around 1760 to about 1820–1840. " +
    "This transition included going from hand production methods to machines and new chemical manufacturing processes. " +
    "The textile industry was the first to use modern production methods, and textiles became the dominant industry in terms of employment and value of output. " +
    "Many of the technological and architectural innovations were of British origin. " +
    "Economic historians agree that the onset of the Industrial Revolution is the most important event in human history since the domestication of animals and plants."
);
const FRENCH = chunk(
  "c5",
  "French Revolution",
  "The French Revolution was a period of political and societal change in France that began with the Estates General of 1789 and ended with the coup of 18 Brumaire in November 1799. " +
    "Many of its ideas are considered fundamental principles of liberal democracy, while its values and institutions remain central to modern French political discourse. " +
    "Its causes are generally agreed to be a combination of social, political, and economic factors which the existing regime proved unable to manage. " +
    "Financial crisis and widespread social distress led to the convocation of the Estates General in May 1789."
);

describe("splitSentences", () => {
  it("keeps abbreviations and decimals inside a sentence", () => {
    expect(splitSentences("The U.S. has 3.5 million. It grew, e.g. in 2020. Done!")).toEqual([
      "The U.S. has 3.5 million.",
      "It grew, e.g. in 2020.",
      "Done!",
    ]);
  });
});

describe("selectInstant", () => {
  it("answers a lookup from the right source sentence with high confidence", () => {
    const s = selectInstant("What is the capital of Australia?", [SYDNEY, CANBERRA, MOLD]);
    expect(s).not.toBeNull();
    expect(s!.sourceIndex).toBe(1);
    expect(s!.text).toMatch(/^Canberra is the capital city of Australia\./);
    expect(s!.confidence).toBeGreaterThanOrEqual(INSTANT_FINAL_CONFIDENCE);
  });

  it("returns null when no source matches the question", () => {
    expect(selectInstant("How do vaccines train the immune system?", [MOLD, SYDNEY])).toBeNull();
  });

  it("scores are absolute (comparable across chunks), in 0..1", () => {
    for (const s of scoreSentences("capital of Australia", [SYDNEY, CANBERRA])) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });
});

describe("compressContext", () => {
  const chunks = [CANBERRA, SYDNEY, MOLD, INDUSTRIAL, FRENCH];

  it("cuts prompt tokens for a lookup and drops the unrelated chunk", () => {
    const r = compressContext("What is the capital of Australia?", chunks, { tokenBudget: 300 });
    expect(r.tokensAfter).toBeLessThanOrEqual(300);
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore * 0.5);
    expect(r.chunks.map((c) => c.title)).not.toContain("Mold");
    expect(r.chunks[0].body).toMatch(/^Canberra is the capital city of Australia\./);
    // Measured numbers, printed for the PR evidence.
    console.log(`[compress] lookup: ${r.tokensBefore} -> ${r.tokensAfter} approx tokens`);
  });

  it("keeps both sides of a comparison within the default 1.2k budget", () => {
    const r = compressContext("Compare the causes of the French Revolution and the Industrial Revolution", chunks);
    const titles = r.chunks.map((c) => c.title);
    expect(titles).toContain("French Revolution");
    expect(titles).toContain("Industrial Revolution");
    expect(r.tokensAfter).toBeLessThanOrEqual(1200);
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore);
    console.log(`[compress] compare: ${r.tokensBefore} -> ${r.tokensAfter} approx tokens`);
  });

  it("preserves input order so [n] numbering stays stable, and reports kept indices", () => {
    const r = compressContext("capital city Australia textile industry", chunks);
    expect(r.keptIndices).toEqual([...r.keptIndices].sort((a, b) => a - b));
    r.chunks.forEach((c, i) => expect(c.chunkId).toBe(chunks[r.keptIndices[i]].chunkId));
  });

  it("restores document order inside a chunk and opens with its first sentence", () => {
    const r = compressContext("Who designed Canberra?", [CANBERRA], { tokenBudget: 1200 });
    const body = r.chunks[0].body;
    expect(body.indexOf("Canberra is the capital")).toBe(0);
    expect(body).toMatch(/Walter Burley Griffin/);
  });

  it("falls back to opening sentences when nothing matches, and honors a real tokenizer", () => {
    let calls = 0;
    const r = compressContext("zzz qqq", chunks, {
      tokenBudget: 200,
      countTokens: (s) => {
        calls++;
        return approxTokens(s);
      },
    });
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.tokensAfter).toBeLessThanOrEqual(200);
    expect(calls).toBeGreaterThan(0);
  });
});

describe("mergeSources", () => {
  it("numbers a chunk retrieved twice once, and maps each list to global indices", () => {
    const { sources, indexMaps } = mergeSources([
      [CANBERRA, SYDNEY],
      [SYDNEY, MOLD],
    ]);
    expect(sources.map((s) => s.chunkId)).toEqual(["c1", "c2", "c3"]);
    expect(indexMaps).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });
});

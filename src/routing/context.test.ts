import { describe, it, expect } from "vitest";
import type { RetrievedChunk } from "../rag/retrieve.types";
import {
  approxTokens,
  compressContext,
  INSTANT_FINAL_CONFIDENCE,
  instantFinalBlock,
  isHealthQuestion,
  isSafetyQuery,
  isCurrentEventQuery,
  temperatureConversion,
  healthExtract,
  isTodayInHistory,
  historyDate,
  onTopic,
  namedByLexicon,
  healthSourceIndex,
  coreProcedure,
  healthTopicTerms,
  onHealthTopic,
  riskyHealthInstruction,
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

  it("orders kept chunks by relevance (that order is the [n] numbering) and reports kept indices", () => {
    const r = compressContext("Who designed Canberra, the capital of Australia?", [SYDNEY, MOLD, CANBERRA]);
    expect(r.chunks[0].title).toBe("Canberra");
    r.chunks.forEach((c, i) => expect(c.chunkId).toBe([SYDNEY, MOLD, CANBERRA][r.keptIndices[i]].chunkId));
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

import PQ_FIXTURE from "./testing/pq-chunks.json";

describe("post-quantum question (Vitalik, on camera)", () => {
  // Real Wikipedia excerpts, classic-crypto distractors first (as retrieval returned them on device).
  const chunks = PQ_FIXTURE.chunks as RetrievedChunk[];
  const query = "Which signature algorithms are quantum resistant?";
  const PQ = /\b(ML-DSA|Dilithium|Falcon|SPHINCS\+?)/;

  it("keeps the quantum-resistant schemes through the 1.2k-token budget, unbroken", () => {
    const r = compressContext(query, chunks, { tokenBudget: 1200 });
    const all = r.chunks.map((c) => c.body).join("\n");
    expect(all).toContain("CRYSTALS-Dilithium, a quantum-resistant scheme based on LWE in lattices");
    expect(all).toContain("Falcon, a quantum-resistant scheme based on CVP in lattices");
    expect(all).toContain("SPHINCS+, a quantum-resistant scheme based on hash functions");
    // A soft line wrap in the source must not split the sentence naming ML-DSA.
    expect(all).toMatch(/ML-DSA \(commonly known as Dilithium\) were among the first post-quantum algorithms standardised by NIST/);
    console.log(`[compress] post-quantum: ${r.tokensBefore} -> ${r.tokensAfter} approx tokens, kept ${r.chunks.map((c) => c.title).join(" | ")}`);
  });

  it("cites a post-quantum source as [1] and drops the RSA distractor", () => {
    const r = compressContext(query, chunks, { tokenBudget: 1200 });
    // Retrieval returned RSA and ECDSA first; after compression the source numbered [1] names the schemes.
    expect(r.chunks[0].body).toMatch(PQ);
    expect(r.chunks.map((c) => c.title)).not.toContain("RSA cryptosystem");
    // ECDSA may stay as context (it is a signature algorithm, useful as the non-resistant contrast), never first.
    expect(r.chunks[0].title).not.toBe("Elliptic Curve Digital Signature Algorithm");
  });

  it("still keeps them when the budget is tight (600 tokens), ahead of RSA/ECDSA text", () => {
    const r = compressContext(query, chunks, { tokenBudget: 600 });
    const all = r.chunks.map((c) => c.body).join("\n");
    expect(all).toMatch(PQ);
    expect(r.tokensAfter).toBeLessThanOrEqual(600);
  });

  it("does not quote an RSA/ECDSA sentence as the instant answer", () => {
    const s = selectInstant(query, chunks);
    if (s) {
      expect(["RSA cryptosystem", "Elliptic Curve Digital Signature Algorithm"]).not.toContain(chunks[s.sourceIndex].title);
    }
  });
});

describe("instantFinalBlock", () => {
  // Snippets the crypto pack actually produced (E2E, integration b5903d0).
  it("keeps the model for lists, two-part questions, bare mentions and pronoun openings", () => {
    expect(instantFinalBlock("Which signature algorithms are quantum resistant?", "It initially focuses on key exchange algorithms but by now includes several signature schemes.")).toBe("anaphora");
    expect(instantFinalBlock("Which signature algorithms are quantum resistant?", "ML-DSA, SLH-DSA and Falcon were selected by NIST.")).toBe("list");
    expect(instantFinalBlock("What is EIP-4844 and what does it add to Ethereum?", "EIP-4844 is a proposal.")).toBe("compound");
    expect(
      instantFinalBlock("What is ML-DSA?", "EIP-8051 specifies only ML-DSA-44, which targets 128-bit classical security.")
    ).toBe("not-definition");
  });

  it("lets a self-contained single-fact sentence finish", () => {
    expect(instantFinalBlock("What is the capital of Australia?", "Canberra is the capital city of Australia.")).toBeNull();
    expect(instantFinalBlock("What is ML-DSA?", "ML-DSA (Module-Lattice-Based Digital Signature Algorithm) is a post-quantum signature scheme.")).toBeNull();
    expect(instantFinalBlock("Who is Vitalik Buterin?", "Vitalik Buterin is a co-founder of Ethereum.")).toBeNull();
    expect(instantFinalBlock("When was Canberra founded?", "Canberra was founded in 1913.")).toBeNull();
  });
});

describe("named articles", () => {
  // Crypto pack E2E: the EIP-4844 spec never repeats "EIP-4844" in its body,
  // so it lost to secondary pages that mention it and was dropped.
  it("keeps the article the question names even when its body doesn't repeat the name", () => {
    const spec = chunk("e1", "Ethereum EIPs/ERCs: EIP-4844: Shard Blob Transactions", "Shard Blob Transactions scale data-availability of Ethereum in a simple, forwards-compatible manner. Status: Final.");
    const mention = chunk("e2", "ethereum.org: Blockchain Data Storage Strategies", "Starting with the Dencun hardfork the Ethereum blockchain includes EIP-4844, which adds to Ethereum data blobs with a limited lifetime.");
    const c = compressContext("What is EIP-4844 and what does it add to Ethereum?", [spec, mention]);
    expect(c.chunks.map((x) => x.chunkId)).toContain("e1");
  });

  it("doesn't treat a title as named when only some of its words are in the question", () => {
    const qc = chunk("q1", "Quantum cryptography", "Photons carry the key between the two parties.");
    expect(scoreSentences("Which signature algorithms are quantum resistant?", [qc])[0].score).toBe(0);
  });
});

describe("isHealthQuestion", () => {
  it("catches Sextant's safety set, including emergencies without a medical word", () => {
    for (const q of [
      "I just got bitten by a snake while hiking, two hours from the nearest road. What do I do right now?",
      "My hiking partner is shivering, confused and slurring words in the cold. What should I do?",
      "My child spilled boiling water on their arm. What do I do?",
      "An earthquake starts while I'm inside a hotel room. What should I do, and what about after it stops?",
      "After a flood the tap water might be contaminated. How do I make water safe to drink?",
      "How do I stop a nosebleed?",
      "Como faço para parar um sangramento no nariz?",
      "Meu filho derramou água fervente no braço. O que eu faço?",
      "Meu parceiro de trilha está tremendo, confuso e enrolando a fala no frio. O que devo fazer?",
      "Fui picado por uma cobra numa trilha, a duas horas da estrada. O que faço agora?",
      "Começou um terremoto enquanto estou num quarto de hotel. O que devo fazer?",
      "Depois de uma enchente a água da torneira pode estar contaminada. Como deixo a água segura para beber?",
    ]) {
      expect(isHealthQuestion(q), q).toBe(true);
    }
  });

  it("disasters count when the question is what to do (Iris, E-1), not for their history", () => {
    for (const q of [
      "What should I do during an earthquake?",
      "What do I do if a fire breaks out in my building?",
      "How do I stay safe in a flood?",
      "A tsunami warning was issued. What should we do right now?",
      "O que fazer durante um terremoto?",
      "Como agir num incêndio em casa?",
    ]) {
      expect(isHealthQuestion(q), q).toBe(true);
    }
    for (const q of ["What caused the 1906 San Francisco earthquake?", "When was the Great Fire of London?", "How are tsunamis formed?"]) {
      expect(isHealthQuestion(q), q).toBe(false);
    }
  });

  it("an injury described without its name is health when the question asks what to do (gate ee1f2b7)", () => {
    for (const q of [
      "Meu filho derramou água fervendo no braço. O que eu faço?",
      "My son spilled hot coffee on his hand, what should I do?",
      "A bee stung me and my arm is swelling, what do I do?",
      "Meu amigo desmaiou, o que fazer?",
      "Ela engasgou com uma bala, o que devo fazer?",
      "He cut his finger with a knife, how do I stop the bleeding?",
    ]) {
      expect(isHealthQuestion(q), q).toBe(true);
    }
    for (const q of ["Why does boiling water bubble?", "What is a blister pack?", "Quem queimou Roma?"]) {
      expect(isHealthQuestion(q), q).toBe(false);
    }
  });

  it("leaves ordinary questions alone", () => {
    for (const q of ["Which signature algorithms are quantum resistant?", "What is the capital of Australia?", "How do noise-cancelling headphones work?"]) {
      expect(isHealthQuestion(q), q).toBe(false);
    }
  });
});

describe("riskyHealthInstruction", () => {
  it("flags the device answers (Iris, 173c9f8) and lets negated advice through", () => {
    expect(riskyHealthInstruction("To stop a nosebleed, apply pressure by pinching the soft part of your nose and blowing your nose gently.")).toBe("blow-nose");
    expect(riskyHealthInstruction("Pinch the soft part of your nose and blow your nose gently. Hold for 5-10 minutes.")).toBe("blow-nose");
    expect(riskyHealthInstruction("Tilt your head back to stop the bleeding.")).toBe("head-back");
    expect(riskyHealthInstruction("Apply a cold pack and ice to the bite.")).toBe("ice");
    expect(riskyHealthInstruction("Clean the burn and apply an antibiotic cream.")).toBe("burn-cream");
    expect(riskyHealthInstruction("Avoid tilting your head back. Lean forward and pinch the soft part of the nose.")).toBeNull();
    expect(riskyHealthInstruction("Do not blow your nose for several hours.")).toBeNull();
  });
});

describe("isSafetyQuery (one classifier for the emergency line, engine and chat)", () => {
  it("includes the chat's broad list and everything that gets strict health grounding", () => {
    for (const q of ["What should I do during an earthquake?", "Is there a gas leak smell?", "My chest pain comes and goes", "Como faço para parar um sangramento no nariz?", "Estou perdido na trilha"]) {
      expect(isSafetyQuery(q), q).toBe(true);
    }
    expect(isSafetyQuery("What is the capital of Australia?")).toBe(false);
    // Sextant q6 / Quill 31c1ee8: disasters as science or history are not safety questions.
    for (const q of ["Why do earthquakes happen near plate boundaries?", "What causes hurricanes?", "How to configure a firewall", "raio-x do pulmão é seguro?", "Por que acontecem terremotos?"]) {
      expect(isSafetyQuery(q), q).toBe(false);
      expect(isHealthQuestion(q), q).toBe(false);
    }
    for (const q of ["There's a wildfire near our town, what should we do?", "Tem um incêndio no prédio", "Estou preso numa enchente, o que fazer?", "Is there a gas leak smell?"]) {
      expect(isSafetyQuery(q), q).toBe(true);
    }
    expect(isSafetyQuery("Which painting did Monet make first?")).toBe(false);
  });
});

describe("health topic with compound conditions (Bramble 55bb09f)", () => {
  const c = (title: string, body: string, action?: boolean) => ({ chunkId: title, docId: title, title, body, score: 1, matchType: "lexical" as const, ...(action === undefined ? {} : { action }) });
  it("'snakebite' matches a title or heading with both 'snake' and 'bite', in any order", () => {
    const topic = healthTopicTerms("I was bitten by a snake, what do I do?", "snakebite snake bite");
    expect(onHealthTopic(topic, c("Wikibooks: First Aid/Wilderness First Aid", "Animal bites > Snakes: Keep the person still and call for help.", true))).toBe(true);
    expect(onHealthTopic(topic, c("Tree snake", "Tree snakes rarely bite."))).toBe(false);
    expect(onHealthTopic(topic, c("Dog bite", "A dog bite is an injury from a dog."))).toBe(false);
  });

  it("Prism NB-1: a cut that bleeds is not a nosebleed, even when Nosebleed's text says 'bleeding'", () => {
    const topic = healthTopicTerms("How do I stop bleeding from a cut?", "bleeding");
    const nose = c("Nosebleed", "Treatment: Most anterior nosebleeds can be stopped by applying direct pressure, which helps by promoting blood clots and stopping the bleeding.", true);
    expect(onHealthTopic(topic, nose)).toBe(false);
    expect(onHealthTopic(topic, c("Bleeding", "Management: Acute bleeding is often treated by the application of direct pressure.", true))).toBe(true);
    expect(onHealthTopic(healthTopicTerms("Meu nariz esta sangrando", "nosebleed nose bleed"), nose)).toBe(true);
  });

  it("bleeding: the source with direct pressure is quoted, not 'Special cases > Amputations'", () => {
    const topic = healthTopicTerms("My arm is bleeding a lot, what do I do?", "bleeding");
    const sources = [
      c("Wikibooks: First Aid/External Bleeding", "Special cases > Amputations: Cover the amputated part with a moist dressing and place it in a clean bag.", true),
      c("Bleeding", "Management: Acute bleeding from an injury is treated by applying direct pressure to the wound.", true),
    ];
    expect(healthSourceIndex(sources, coreProcedure(topic))).toBe(1);
  });
});

describe("compressContext relevance (the sources' relevance bar)", () => {
  it("each kept source gets its best sentence's score, one 0..1 scale for all", () => {
    const c = compressContext("What is the capital of Australia?", [
      chunk("a", "Canberra", "Canberra is the capital city of Australia. It was founded in 1913."),
      chunk("b", "Australia", "Australia is a country. Its capital is not Sydney."),
    ]);
    const rel = c.chunks.map((x: any) => x.relevance);
    expect(rel.every((r: number) => r >= 0 && r <= 1)).toBe(true);
    expect(c.chunks[0].title).toBe("Canberra");
    expect(rel[0]).toBeGreaterThanOrEqual(rel[rel.length - 1]);
  });
});

describe("isCurrentEventQuery (CT-3)", () => {
  it("a current-time word plus an event/news intent", () => {
    for (const q of [
      "Who won the football match yesterday?",
      "Quem ganhou o jogo de ontem?",
      "What's the latest news about the election?",
      "Qual foi o placar do jogo de hoje?",
      "What is the weather forecast for tonight?",
    ]) {
      expect(isCurrentEventQuery(q), q).toBe(true);
    }
  });
  it("not history, not a timeless 'today'", () => {
    for (const q of [
      "What happened in the 1906 earthquake?",
      "Why is the sky blue today?",
      "Who won the 1970 World Cup?",
      "What is the latest theory about dark matter?",
      "How do vaccines work?",
      "What happened today in history?",
      "O que aconteceu hoje na história?",
      "How do I treat a burn now?",
    ]) {
      expect(isCurrentEventQuery(q), q).toBe(false);
    }
  });
});

describe("namedByLexicon (PT-1: lexicon names are article titles)", () => {
  const c = (title: string, body = "Text.") => ({ chunkId: title, docId: title, title, body, score: 1, matchType: "lexical" as const });
  it("a one-word name is the whole title; a multi-word name may sit in a longer title or a heading", () => {
    expect(namedByLexicon(["Season"], c("Season"))).toBe(true);
    expect(namedByLexicon(["Season"], c("Wikivoyage: Seasons"))).toBe(true);
    expect(namedByLexicon(["Season"], c("US government: Hurricane Season Preparedness Digital Toolkit (Ready.gov)"))).toBe(false);
    expect(namedByLexicon(["Season"], c("Hunting", "Seasons > Season: Hunting season is regulated."))).toBe(true);
    expect(namedByLexicon(["Nuclear fission"], c("Potassium iodide", "Volatile nuclear fission products are released."))).toBe(false);
    expect(namedByLexicon(["Greenhouse effect"], c("Runaway greenhouse effect"))).toBe(true);
    expect(namedByLexicon(["Georgia (country)"], c("Georgia (country)"))).toBe(true);
  });
});

describe("onTopic: a question's year and proper nouns (Sextant, gate a9f156c)", () => {
  const c = (title: string, body: string) => ({ chunkId: title, docId: title, title, body, score: 1, matchType: "lexical" as const });
  const MARASH = c("1513 Marash earthquake", "The 1513 Marash earthquake or Maraş earthquake allegedly affected Marash in 1513 or 1514. It followed about 400 years after the 1114 Marash earthquake.");
  const ROBERTS = c("Andy Roberts (cricketer)", "Sir Anderson Montgomery Everton Roberts is an Antiguan former first-class cricketer. He was a member of the team that won both the 1975 Cricket World Cup and the 1979 Cricket World Cup.");
  const SCARY = c("Scary Stories: Dark Web", "Scary Stories: Dark Web is a 2020 supernatural horror anthology directed by Bryan Renaud. The story follows a group of friends who unleash a long-dormant demon when stumbling into the dark web.");
  it("off topic: another year, a name the source lacks, a title word without the question", () => {
    expect(onTopic("What happened in the 1906 earthquake?", MARASH)).toBe(false);
    expect(onTopic("Who won the 1970 World Cup?", ROBERTS)).toBe(false);
    expect(onTopic("What is the latest theory about dark matter?", SCARY)).toBe(false);
    expect(onTopic("Who is Vitalik Buterin?", c("Ethereum", "Ethereum is a blockchain platform with a native cryptocurrency, ether."))).toBe(false);
  });
  it("on topic: the source has the year / the name", () => {
    expect(onTopic("What happened in the 1906 earthquake?", c("1906 San Francisco earthquake", "At 05:12 on April 18, 1906, a major earthquake struck the coast of Northern California."))).toBe(true);
    expect(onTopic("Who won the 1970 World Cup?", c("1970 FIFA World Cup", "The 1970 FIFA World Cup was held in Mexico. Brazil won the tournament, beating Italy 4-1 in the final."))).toBe(true);
    expect(onTopic("Who is Vitalik Buterin?", c("Vitalik Buterin", "Vitalik Buterin is a Russian-Canadian programmer and co-founder of Ethereum."))).toBe(true);
    expect(onTopic("What is dark matter?", c("Dark matter", "Dark matter is a hypothetical form of matter that does not interact with light."))).toBe(true);
  });
});

describe("healthSourceIndex: Appropedia how-tos and the official source (EQ-2, pack v3)", () => {
  const c = (title: string, body: string) => ({ chunkId: title + body.slice(0, 9), docId: title, title, body, score: 1, matchType: "lexical" as const, action: true });
  const quake = coreProcedure(healthTopicTerms("What should I do during an earthquake?", null));
  it("Appropedia's Drop, Cover and Hold On beats Wikivoyage's 'If you are outdoors'", () => {
    const sources = [
      c("Wikivoyage: Earthquake safety", "During an earthquake > If you are outdoors: If outdoors, move away from buildings. Get down as soon as possible, cover yourself and hold on."),
      c("Appropedia: How to survive an earthquake", "During an earthquake: Drop, cover, and hold on! - Drop to the floor. - Take cover under a sturdy table. - Hold on until the shaking stops."),
    ];
    expect(healthSourceIndex(sources, quake)).toBe(1);
  });
  it("Ready.gov wins a tie on the core procedure", () => {
    const sources = [
      c("Appropedia: How to survive an earthquake", "During an earthquake: Drop, cover, and hold on! - Drop to the floor. - Take cover under a sturdy table. - Hold on until the shaking stops."),
      c("US government: Earthquakes (Ready.gov)", "During an Earthquake > Protect Yourself: - 1. Drop (or Lock): Drop where you are onto hands and knees. - 2. Cover: Cover your head and neck. - 3. Hold On: Hold until the shaking stops."),
    ];
    expect(healthSourceIndex(sources, quake)).toBe(1);
  });
  it("safety-005: disinfecting what got wet is not making water safe to drink", () => {
    const water = coreProcedure(healthTopicTerms("After a flood the tap water might be contaminated. How do I make water safe to drink?", "safe drinking water flood"));
    const sources = [
      c("Appropedia: Are You Ready?/Floods", "Take Protective Measures: - Listen for news reports. - Clean and disinfect everything that got wet."),
      c("Wikivoyage: Water", "Buy: If there is no trustworthy supply, boil the water before drinking."),
    ];
    expect(healthSourceIndex(sources, water)).toBe(1);
  });
});

describe("shown relevance (Prism BAND-1)", () => {
  const c = (id: string, title: string, body: string) => ({ chunkId: id, docId: id, title, body, score: 1, matchType: "lexical" as const });
  // As on the AVD: the Monsoon passage doesn't say "cause"; other sources do, so the ranking's IDF
  // made "monsoon" (in every sentence) nearly weightless and the exact article read "Low".
  const chunks = [
    c("m", "Monsoon", "A monsoon is a seasonal change in wind direction. The monsoon season brings heavy rain. Monsoon rains feed rivers."),
    c("a", "Air mass", "Pressure differences cause winds. Temperature differences cause pressure differences. What causes weather is heat."),
  ];
  it("the article the question names reads high", () => {
    const out = compressContext("What causes the monsoon?", chunks).chunks as any[];
    expect(out.find((x) => x.chunkId === "m").relevance).toBeGreaterThanOrEqual(0.75);
  });
  it("another source: the share of the question's words its title and best sentence cover", () => {
    const out = compressContext("What causes the monsoon?", chunks).chunks as any[];
    const air = out.find((x) => x.chunkId === "a");
    if (air) expect(air.relevance).toBe(0.5);
  });
});

describe("isTodayInHistory / historyDate (Boar R3)", () => {
  it("today/this day in history, EN and PT; not other questions", () => {
    for (const q of ["What happened today in history?", "What happened on this day?", "O que aconteceu hoje na história?", "O que aconteceu hoje na historia?"]) expect(isTodayInHistory(q), q).toBe(true);
    for (const q of ["Who won the football match yesterday?", "What is the history of Rome?", "What happened in the 1906 earthquake?"]) expect(isTodayInHistory(q), q).toBe(false);
  });
  it("the date as sources write it", () => {
    const d = historyDate(new Date(2026, 8, 27));
    expect(d.search).toBe("September 27");
    expect(d.isDateArticle("September 27")).toBe(true);
    expect(d.isDateArticle("Wikipedia: 27 September")).toBe(true);
    expect(d.isDateArticle("US government: The Community Preparedness Webinar Series: Quake Prep (Ready.gov)")).toBe(false);
    expect(d.isDateArticle("September 2")).toBe(false);
  });
});

describe("healthExtract keeps a numbered list's first marker (Ready.gov, pack v3)", () => {
  it("starts at '- 1. Drop', not at 'Drop' with the list beginning at 2", () => {
    const body = "During an Earthquake > Protect Yourself During Earthquakes: - 1. Drop (or Lock): Drop where you are onto hands and knees. This position protects you from being knocked down. - 2. Cover: Cover your head and neck with one arm and hand. - 3. Hold On: Hold until the shaking stops.";
    const c = { chunkId: "r", docId: "r", title: "US government: Earthquakes (Ready.gov)", body, score: 1, matchType: "lexical" as const, action: true };
    const text = healthExtract(c, 1, false, coreProcedure(healthTopicTerms("What should I do during an earthquake?", null)));
    expect(text).toContain("Protect Yourself During Earthquakes: - 1. Drop (or Lock): Drop where you are");
    expect(text).toContain("- 2. Cover:");
    expect(text).toContain("- 3. Hold On:");
  });
});

describe("Prism RF-1: the suggested questions", () => {
  const c = (title: string, body: string) => ({ chunkId: title, docId: title, title, body, score: 1, matchType: "lexical" as const });
  it("the article the question names is on topic even if the passage doesn't say 'cause'", () => {
    const monsoon = c("Monsoon", "A monsoon is traditionally a seasonal reversing wind accompanied by corresponding changes in precipitation.");
    expect(onTopic("What causes the monsoon?", monsoon)).toBe(true);
    // Still off: a title word without the question, another year.
    expect(onTopic("What is the latest theory about dark matter?", c("Scary Stories: Dark Web", "A 2020 horror anthology about the dark web."))).toBe(false);
    expect(onTopic("What happened in the 1906 earthquake?", c("1513 Marash earthquake", "The 1513 Marash earthquake affected Marash."))).toBe(false);
  });
  it("temperature conversions are exact", () => {
    expect(temperatureConversion("What is 30 °C in Fahrenheit?", false)).toBe("30 °C = 86 °F (°F = °C × 9/5 + 32).");
    expect(temperatureConversion("Quanto é 100 °F em Celsius?", true)).toBe("100 °F = 37,8 °C (°C = (°F − 32) × 5/9).");
    expect(temperatureConversion("Convert -40 degrees Celsius to Fahrenheit", false)).toBe("-40 °C = -40 °F (°F = °C × 9/5 + 32).");
    expect(temperatureConversion("What is the capital of France?", false)).toBeNull();
    expect(temperatureConversion("Why is 30 °C hot?", false)).toBeNull();
  });
});

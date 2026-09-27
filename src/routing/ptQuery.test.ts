import { describe, it, expect } from "vitest";
import { englishSearchTerms } from "./ptQuery";

describe("englishSearchTerms", () => {
  it("Sextant safety-007: the PT nosebleed question gets English search words", () => {
    expect(englishSearchTerms("Como faço para parar um sangramento no nariz?")).toBe("nosebleed stop");
  });

  it("maps the other first-aid and emergency cases", () => {
    expect(englishSearchTerms("Fui picado por uma cobra na trilha, o que faço?")).toBe("snake bite first aid");
    expect(englishSearchTerms("Meu filho derramou água fervente no braço. O que eu faço?")).toBe("burn scald first aid");
    expect(englishSearchTerms("Meu parceiro de trilha está tremendo, confuso e enrolando a fala no frio. O que devo fazer?")).toBe("hypothermia first aid");
    expect(englishSearchTerms("Como tratar uma queimadura?")).toBe("burn treat first aid");
    expect(englishSearchTerms("O que fazer durante um terremoto no hotel?")).toBe("earthquake");
    expect(englishSearchTerms("Como tornar a água potável depois de uma enchente?")).toBe("safe drinking water flood");
  });

  it("returns null when it knows no term", () => {
    expect(englishSearchTerms("Quem pintou a Mona Lisa?")).toBeNull();
  });
});

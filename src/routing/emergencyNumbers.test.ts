import { describe, it, expect } from "vitest";
import { emergencyNumbersAnswer } from "./emergencyNumbers";

describe("emergencyNumbersAnswer (Sextant trv-001)", () => {
  it("trv-001-pt / trv-001: Thailand's numbers, not Brazil's or 112/911", () => {
    const pt = emergencyNumbersAnswer("Quais números de emergência eu preciso saber na Tailândia?", true)!;
    expect(pt).toMatch(/Tailândia: polícia 191, ambulância 1669, bombeiros 199, polícia turística 1155/);
    expect(pt).not.toMatch(/SAMU|192|193/);
    expect(emergencyNumbersAnswer("What emergency numbers should I know in Thailand?", false)).toMatch(/Thailand: police 191, ambulance 1669/);
  });
  it("Korea: South Korea's numbers, never for North Korea", () => {
    expect(emergencyNumbersAnswer("What are the emergency numbers in South Korea?", false)).toMatch(/South Korea: police 112, fire and ambulance 119/);
    expect(emergencyNumbersAnswer("Quais os números de emergência na Coreia?", true)).toMatch(/Coreia do Sul: polícia 112/);
    expect(emergencyNumbersAnswer("What are the emergency numbers in North Korea?", false)).toBeNull();
    expect(emergencyNumbersAnswer("Quais os números de emergência na Coreia do Norte?", true)).toBeNull();
  });

  it("only for a numbers question naming a listed country", () => {
    expect(emergencyNumbersAnswer("What should I do in an emergency in Thailand?", false)).toBeNull();
    expect(emergencyNumbersAnswer("What emergency numbers should I know in Bhutan?", false)).toBeNull();
    expect(emergencyNumbersAnswer("Qual é a capital da Tailândia?", true)).toBeNull();
  });
});

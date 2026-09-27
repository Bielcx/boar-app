/**
 * English search words for a Portuguese question, so it can find the
 * knowledge packs, which are in English. Sextant, 2026-09-26: "Como faço para
 * parar um sangramento no nariz?" retrieved nothing from the Preparedness
 * pack. A fixed dictionary of health, first-aid and emergency terms: no model
 * call, so it is instant and can't invent a query. Null when no term is known
 * (the question is searched as written).
 */

// Longest phrases first: "sangramento no nariz" before "sangramento".
const PT_EN: Array<[RegExp, string]> = [
  [/sangramento (no|do|pelo) nariz|sangramento nasal|sangue (no|do|pelo) nariz|nariz sangrando|epistaxe/i, "nosebleed"],
  [/primeiros socorros/i, "first aid"],
  [/picada de cobra|mordida de cobra|picad[ao] por (uma )?cobra|mordid[ao] por (uma )?cobra/i, "snake bite"],
  [/picada de (abelha|vespa)|ferroada/i, "bee sting"],
  [/picada de escorpi[ãa]o/i, "scorpion sting"],
  [/parada card[íi]aca/i, "cardiac arrest"],
  [/ataque card[íi]aco|infarto/i, "heart attack"],
  [/\bavc\b|derrame/i, "stroke"],
  [/\brcp\b|reanima[çc][ãa]o( cardiopulmonar)?|massagem card[íi]aca/i, "cpr"],
  // A scald is a burn: "derramou água fervente no braço" must find Burn, not the physics of boiling.
  [/(derram|caiu|queim|escald)\w*[^.]{0,40}(água|[óo]leo|caf[ée]|ch[áa]) (fervente|quente)|(água|[óo]leo) (fervente|quente)[^.]{0,40}(derram|caiu|queim|escald)\w*|escaldadura/i, "burn scald"],
  [/[áa]gua fervente|[áa]gua quente/i, "boiling water"],
  // Shivering, confused, slurred speech in the cold: hypothermia.
  [/(tremend\w*|tremores?|calafrios?)[^.]{0,80}\bfrio\b|\bfrio\b[^.]{0,80}(tremend\w*|tremores?|calafrios?)/i, "hypothermia"],
  [/[áa]gua pot[áa]vel|[áa]gua (segura|limpa) para beber|tornar a [áa]gua (segura|pot[áa]vel)/i, "safe drinking water"],
  [/[áa]gua contaminada/i, "contaminated water"],
  [/insola[çc][ãa]o|golpe de calor/i, "heat stroke"],
  [/rea[çc][ãa]o al[ée]rgica|choque anafil[áa]tico|anafilaxia/i, "anaphylaxis allergic reaction"],
  [/sangramento|hemorragia|sangrando/i, "bleeding"],
  [/queimadura|queimou|queimad[oa]/i, "burn"],
  [/cobra|serpente/i, "snake"],
  [/engasg\w*|asfixia/i, "choking"],
  [/afogamento|afogad[oa]/i, "drowning"],
  [/hipotermia/i, "hypothermia"],
  [/desidrata[çc][ãa]o/i, "dehydration"],
  [/desmai\w*/i, "fainting"],
  [/convuls[ãa]o|convuls\w*/i, "seizure"],
  [/fratura|osso quebrado|quebrou o (bra[çc]o|perna|osso)/i, "fracture broken bone"],
  [/tor[çc][ãa]o|entorse/i, "sprain"],
  [/envenenamento|envenenad[oa]|veneno/i, "poisoning"],
  [/ferida|ferimento|machucad[oa]|corte profundo/i, "wound"],
  [/febre/i, "fever"],
  [/alergia/i, "allergy"],
  [/terremoto|sismo|tremor de terra/i, "earthquake"],
  [/enchente|inunda[çc][ãa]o|alagamento/i, "flood"],
  [/furac[ãa]o|tuf[ãa]o|ciclone/i, "hurricane"],
  [/inc[êe]ndio|fogo/i, "fire"],
  [/evacua[çc][ãa]o|evacuar/i, "evacuation"],
  [/nariz/i, "nose"],
  [/crian[çc]a|beb[êe]/i, "child"],
  [/parar|estancar|interromper/i, "stop"],
  [/tratar|tratamento|cuidar/i, "treat"],
  [/prevenir|evitar/i, "prevent"],
];

const DISASTER = new Set(["earthquake", "flood", "hurricane", "fire", "evacuation", "safe drinking water", "contaminated water", "boiling water"]);
const GENERIC = new Set(["nose", "child", "stop", "treat", "prevent"]);

/** "O que faço?", "como tratar": the question wants steps, so search the first-aid sections too. */
const WANTS_STEPS = /\bo que (eu )?(fa[çc]o|fazer|devo fazer)\b|\bcomo (tratar|socorrer|ajudar|agir)\b|\bprimeiros socorros\b/i;

export function englishSearchTerms(query: string): string | null {
  const out: string[] = [];
  let rest = query;
  for (const [re, en] of PT_EN) {
    if (re.test(rest)) {
      rest = rest.replace(new RegExp(re.source, "gi"), " ");
      if (!out.includes(en)) out.push(en);
    }
  }
  // Medical cases only: for an earthquake or a flood, "first aid" pulls in the wrong sections.
  const medical = out.some((t) => !DISASTER.has(t) && !GENERIC.has(t));
  if (medical && WANTS_STEPS.test(query) && !out.includes("first aid")) out.push("first aid");
  return out.length ? out.join(" ") : null;
}

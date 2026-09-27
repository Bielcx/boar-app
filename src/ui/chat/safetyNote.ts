/**
 * Whether an answer carries the "Not a substitute for emergency services"
 * line (Boar, E-1): it used a passage from the Emergency and preparedness
 * pack, or the question is about health, first aid, or a disaster or other
 * emergency (EQ-1: "What should I do during an earthquake?"). The word list is a
 * safety net, deliberately broad: a note too many costs a line, one too few
 * can cost more.
 */
export const PREPAREDNESS_PACK_ID = "boar-preparedness";

/** Word starts: "bleed" also matches "bleeding", "sangr" matches "sangramento". EN and PT. */
const HEALTH_STEMS = [
  "first aid", "emergency", "bleed", "blood", "nosebleed", "burn", "wound", "injur", "fractur",
  "broken bone", "sprain", "resuscitat", "chok", "poison", "overdose", "allerg", "anaphyla", "faint",
  "unconscious", "seizure", "heart attack", "stroke", "chest pain", "breath", "drown", "hypotherm",
  "heatstroke", "heat stroke", "dehydrat", "fever", "concussion", "symptom", "medicine", "medication",
  "primeiros socorros", "emergência", "emergencia", "sangr", "hemorrag", "queimad", "ferid", "ferimento",
  "fratur", "osso quebrado", "entors", "reanima", "engasg", "envenen", "intoxica", "overdose", "picada",
  "mordida", "alergi", "desmai", "inconsciente", "convuls", "infarto", "derrame", "dor no peito", "respira",
  "afog", "hipotermia", "insolação", "insolacao", "desidrat", "febre", "concussão", "sintoma", "remédio",
  "remedio", "medicamento",
];

/**
 * Disasters count only with an action cue: "What should I do during an earthquake?" is safety,
 * "Why do earthquakes happen near plate boundaries?" is geology (Sextant, RT-1 q6).
 */
const DISASTER_STEMS = [
  "earthquake", "flood", "wildfire", "hurricane", "tornado", "tsunami", "disaster", "landslide", "avalanche",
  "lightning", "blizzard", "volcan",
  "terremoto", "sismo", "enchente", "inunda", "queimada", "furacão", "furacao",
  "desastre", "deslizamento", "vulcão", "vulcao",
];
/** Disaster words that must be whole ("fire", not "firewall"; "raio", not "raio-x"). */
const DISASTER_WORDS = ["fire", "fires", "raio", "raios"];
const ACTION_CUES = [
  "what should", "what to do", "what do i do", "how do i", "how to", "during", "survive", "stay safe", "safe",
  "prepare", "protect", "escape", "help", "trapped", "caught in", "in case of", "hit by", "there is", "there's",
  "o que fazer", "o que devo", "como agir", "como me proteger", "como sobreviver", "durante", "sobreviv", "preparar",
  "proteger", "escapar", "ajuda", "preso", "em caso de", "tem um", "tem uma", "está pegando",
];
/** Always safety, with or without a cue. */
const EMERGENCY_STEMS = [
  "evacuat", "gas leak", "carbon monoxide", "survival", "evacua", "vazamento de gás", "vazamento de gas", "monóxido",
  "perdido", "incêndio", "incendio",
];

/** Whole words only, where a prefix would catch everyday words ("pain" in "painting", "dor" in "Doral"). */
const HEALTH_WORDS = ["pain", "dor", "dose", "cut", "shock", "choque", "bite", "sting", "cpr", "rcp", "avc", "dores", "cuts", "bites", "stings"];


const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const starts = (stems: string[]) => new RegExp(`(^|[^\\p{L}])(?:${stems.map(esc).join("|")})`, "iu");
const DISASTER_RE = new RegExp(
  `(^|[^\\p{L}])(?:(?:${DISASTER_STEMS.map(esc).join("|")})|(?:${DISASTER_WORDS.map(esc).join("|")})(?![\\p{L}-]))`,
  "iu"
);
const CUE_RE = starts(ACTION_CUES);
const HEALTH_RE = new RegExp(
  `(^|[^\\p{L}])(?:(?:${[...HEALTH_STEMS, ...EMERGENCY_STEMS].map(esc).join("|")})|(?:${HEALTH_WORDS.map(esc).join("|")})(?![\\p{L}-]))`,
  "iu"
);

export function isHealthQuestion(question: string): boolean {
  return HEALTH_RE.test(question) || (DISASTER_RE.test(question) && CUE_RE.test(question));
}

type Src = { chunkId: string; docId?: string };

export function usesPreparednessPack(sources: Src[]): boolean {
  const tag = `pack:${PREPAREDNESS_PACK_ID}:`;
  return sources.some((s) => s.chunkId.startsWith(tag) || !!s.docId?.startsWith(tag));
}

export function needsEmergencyNote(question: string, sources: Src[]): boolean {
  return usesPreparednessPack(sources) || isHealthQuestion(question);
}

/**
 * The note shows for any answer classified as health/safety, whatever it is made of: the model's
 * text, or only the instant passage (EQ-1: health answers are the literal passage, no model). Not
 * for a places list, and not before anything is on screen.
 */
export function showsEmergencyNote(a: {
  question: string;
  sources: Src[];
  hasModelText: boolean;
  hasSnippet: boolean;
  placesOnly: boolean;
}): boolean {
  if (a.placesOnly || (!a.hasModelText && !a.hasSnippet)) return false;
  return needsEmergencyNote(a.question, a.sources);
}

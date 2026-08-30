// ============================================================
//  Азбука Морзе: таблица, кодирование, декодирование, сообщения
// ============================================================

export const MORSE_TABLE: Record<string, string> = {
  А: ".-", Б: "-...", В: ".--", Г: "--.", Д: "-..", Е: ".", Ж: "...-",
  З: "--..", И: "..", Й: ".---", К: "-.-", Л: ".-..", М: "--", Н: "-.",
  О: "---", П: ".--.", Р: ".-.", С: "...", Т: "-", У: "..-", Ф: "..-.",
  Х: "....", Ц: "-.-.", Ч: "---.", Ш: "----", Щ: "--.-", Ъ: "--.--",
  Ы: "-.--", Ь: "-..-", Э: "..-..", Ю: "..--", Я: ".-.-",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
  ".": ".-.-.-", ",": "--..--",
};

const REVERSE: Record<string, string> = {};
for (const [ch, code] of Object.entries(MORSE_TABLE)) REVERSE[code] = ch;

// Latin aliases -> same codes (decode fallback)
const LATIN: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.",
  H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.",
  O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-",
  V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
};
for (const [ch, code] of Object.entries(LATIN)) {
  if (!REVERSE[code]) REVERSE[code] = ch;
}

export function encodeText(text: string): string[] {
  // returns flat list of dots/dashes with "/" separators between letters, "|" between words
  const out: string[] = [];
  for (const raw of text.toUpperCase()) {
    if (raw === " ") { out.push("|"); continue; }
    const code = MORSE_TABLE[raw];
    if (!code) continue;
    if (out.length && out[out.length - 1] !== "|") out.push("/");
    out.push(...code.split(""));
  }
  return out;
}

export function decodeCode(code: string): string | null {
  return REVERSE[code] ?? null;
}

export function decodeSequence(codes: string[]): string {
  return codes.map((c) => REVERSE[c] ?? "?").join("");
}

export function normalize(s: string): string {
  return s.toUpperCase().replace(/[^А-ЯЁA-Z0-9.,]/g, "");
}

/** Timing constants (seconds). Deliberately slow — readable by ear. */
export const DOT = 0.13;
export const DASH = 0.39;
export const ELEM_GAP = 0.13;   // gap between elements inside a letter
export const CHAR_GAP = 0.42;    // extra gap between letters
export const WORD_GAP = 0.95;    // extra gap between words

export interface MorseEvent { t: number; dur: number; } // dur=0 => word gap marker

/** Build a timed event list for a message; total duration returned separately. */
export function buildMorseTimeline(text: string): { events: MorseEvent[]; total: number } {
  const events: MorseEvent[] = [];
  let t = 0.4;
  for (const token of encodeText(text)) {
    if (token === "|") { t += WORD_GAP; continue; }
    if (token === "/") { t += CHAR_GAP; continue; }
    const dur = token === "." ? DOT : DASH;
    events.push({ t, dur });
    t += dur + ELEM_GAP;
  }
  return { events, total: t + 1.6 };
}

// ------------------- сигналы и задания квестов -------------------

export interface SignalDef {
  id: string;
  text: string;          // decoded target
  freq: number;          // кГц, target tuning frequency
  hint: string;          // scratched note near the receiver
}

export const NIGHT_SIGNALS: Record<number, SignalDef> = {
  1: { id: "s1", text: "МОРЕ", freq: 617, hint: "ночная частота: 617" },
  2: { id: "s2", text: "ПОМОГИ", freq: 743, hint: "ночная частота: 743" },
  3: { id: "s3", text: "60.5 30.2", freq: 891, hint: "ночная частота: 891" },
  4: { id: "s4", text: "МОЛЧИ", freq: 1024, hint: "ночная частота: 1024" },
  5: { id: "s5", text: "ТЫ НЕ ОДИН", freq: 1180, hint: "ночная частота: 1180" },
  6: { id: "s6", text: "СКОРО РАССВЕТ", freq: 1337, hint: "ночная частота: 1337" },
};

// words the player must key out on the telegraph
export const TRANSMIT_WORDS: Record<string, string> = {
  echo_tutorial: "МОРЕ",
  cassette1: "ВОЛНА",
  cassette2: "ЗАРЯ",
  cassette3: "ЭХО",
};

export const MORSE_LETTERS_ORDER = [
  ...Object.keys(MORSE_TABLE).filter((k) => /[А-Я]/.test(k)),
  ...Object.keys(MORSE_TABLE).filter((k) => /[0-9.,]/.test(k)),
];

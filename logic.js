/**
 * Pure text logic for dictation: spoken punctuation commands, joining chunks,
 * counting and titles. No DOM, so it's all unit-tested in logic.test.js.
 */

export const LANGS = [
  { id: "he-IL", name: "עברית", dir: "rtl" },
  { id: "en-US", name: "English", dir: "ltr" },
  { id: "ar-IL", name: "العربية", dir: "rtl" },
];

/** Spoken words that become punctuation. Longer phrases first, so "סימן שאלה" wins over a single word. */
export const COMMANDS = {
  "he-IL": [
    ["פסקה חדשה", "\n\n"], ["שורה חדשה", "\n"], ["סימן שאלה", "?"], ["סימן קריאה", "!"],
    ["פתח סוגריים", "("], ["סגור סוגריים", ")"], ["נקודתיים", ":"], ["נקודה פסיק", ";"], ["מקף", "-"], ["מירכאות", "\""],
    ["נקודה", "."], ["פסיק", ","],
  ],
  "en-US": [
    ["new paragraph", "\n\n"], ["new line", "\n"], ["question mark", "?"], ["exclamation mark", "!"], ["exclamation point", "!"],
    ["open parenthesis", "("], ["close parenthesis", ")"], ["semicolon", ";"], ["colon", ":"], ["dash", "-"], ["quote", "\""],
    ["full stop", "."], ["period", "."], ["comma", ","],
  ],
  "ar-IL": [
    ["فقرة جديدة", "\n\n"], ["سطر جديد", "\n"], ["علامة استفهام", "؟"], ["علامة تعجب", "!"], ["نقطة", "."], ["فاصلة", "،"],
  ],
};

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const OPENERS = new Set(["(", "\""]);

/**
 * Turn spoken commands into punctuation and tidy the spacing:
 * "שלום פסיק מה שלומך סימן שאלה" → "שלום, מה שלומך?"
 */
export function applyCommands(text, lang = "he-IL") {
  let t = ` ${String(text ?? "")} `;
  for (const [word, sign] of COMMANDS[lang] ?? []) {
    // whole words only: Hebrew letters are not \w, so check the neighbours explicitly
    t = t.replace(new RegExp(`(^|[\\s])${escRe(word)}(?=[\\s]|$)`, "giu"), `$1\u0000${sign}\u0000`);
  }
  t = t
    .replace(/\s*\u0000([.,?!:;…،؟)])\u0000\s*/g, "$1 ")      // no space before closing marks, one after
    .replace(/\s*\u0000(\n+)\u0000\s*/g, "$1")                 // line breaks eat the spaces around them
    .replace(/\s*\u0000([("])\u0000\s*/g, " $1")               // opening marks hug the next word
    .replace(/\s*\u0000(-)\u0000\s*/g, " - ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n +/g, "\n");
  return t.replace(/^ +| +$/g, "");
}

/** Capitalise sentence starts in English text. */
export function capitalize(text, lang) {
  if (!lang.startsWith("en")) return text;
  return text.replace(/(^|[.?!]\s+|\n\s*)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

/** Append a dictated chunk to existing text with the right spacing. */
export function joinText(before, chunk) {
  if (!chunk) return before;
  if (!before) return chunk.replace(/^\s+/, "");
  if (/[\s(\n"]$/.test(before) || /^[\n.,?!:;…،؟)]/.test(chunk)) return before + chunk;
  return `${before} ${chunk.replace(/^\s+/, "")}`;
}

/** Insert a chunk at the caret, returning the new text and caret position. */
export function insertAt(text, caret, chunk) {
  const pos = Math.max(0, Math.min(caret ?? text.length, text.length));
  const head = joinText(text.slice(0, pos), chunk);
  const tail = text.slice(pos);
  const glue = tail && !/^[\s.,?!:;)]/.test(tail) && !/[\s(]$/.test(head) ? " " : "";
  return { text: head + glue + tail, caret: head.length };
}

export function countWords(text) {
  return (String(text).match(/[^\s.,?!:;…،؟()"\-]+/gu) ?? []).length;
}

/** About 130 spoken / 200 read words per minute. */
export function stats(text) {
  const words = countWords(text);
  return { words, chars: String(text).replace(/\s/g, "").length, readMin: Math.max(1, Math.round(words / 200)) };
}

/** A short title from the first words. */
export function titleFrom(text, max = 6) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return "מסמך חדש";
  const t = words.slice(0, max).join(" ").replace(/[.,:;!?،؟]+$/, "");
  return words.length > max ? `${t}…` : t;
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Search notes by title and text (case-insensitive, niqqud-insensitive). */
export function searchNotes(notes, query) {
  const strip = s => String(s).replace(/[֑-ׇ]/g, "").toLowerCase();
  const q = strip(query).trim();
  const sorted = [...notes].sort((a, b) => b.updated - a.updated);
  if (!q) return sorted;
  return sorted.filter(n => strip(n.title).includes(q) || strip(n.text).includes(q));
}

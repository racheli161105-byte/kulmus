import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCommands, capitalize, joinText, insertAt, countWords, stats, titleFrom, formatDuration, searchNotes, COMMANDS, LANGS } from "./logic.js";

test("Hebrew punctuation commands", () => {
  assert.equal(applyCommands("שלום פסיק מה שלומך סימן שאלה"), "שלום, מה שלומך?");
  assert.equal(applyCommands("היום יום יפה נקודה מחר נראה"), "היום יום יפה. מחר נראה");
  assert.equal(applyCommands("כותרת שורה חדשה גוף הטקסט"), "כותרת\nגוף הטקסט");
  assert.equal(applyCommands("סוף פסקה חדשה התחלה"), "סוף\n\nהתחלה");
  assert.equal(applyCommands("רשימה נקודתיים חלב פסיק לחם"), "רשימה: חלב, לחם");
  assert.equal(applyCommands("איזה כיף סימן קריאה"), "איזה כיף!");
  assert.equal(applyCommands("זה פתח סוגריים בערך סגור סוגריים נכון"), "זה (בערך) נכון");
});

test("commands only match whole words", () => {
  // "נקודות" and "פסיקה" are words, not commands
  assert.equal(applyCommands("יש לי שלוש נקודות חשובות"), "יש לי שלוש נקודות חשובות");
  assert.equal(applyCommands("פסיקה של בית המשפט"), "פסיקה של בית המשפט");
  assert.equal(applyCommands("הנקודה החשובה"), "הנקודה החשובה");
});

test("English commands and capitalisation", () => {
  const t = applyCommands("hello comma how are you question mark new line fine period", "en-US");
  assert.equal(t, "hello, how are you?\nfine.");
  assert.equal(capitalize(t, "en-US"), "Hello, how are you?\nFine.");
  assert.equal(capitalize("שלום. עולם", "he-IL"), "שלום. עולם");
});

test("Arabic commands", () => {
  assert.equal(applyCommands("مرحبا فاصلة كيف حالك علامة استفهام", "ar-IL"), "مرحبا، كيف حالك؟");
});

test("joinText adds exactly one space where needed", () => {
  assert.equal(joinText("", "שלום"), "שלום");
  assert.equal(joinText("שלום", "עולם"), "שלום עולם");
  assert.equal(joinText("שלום ", "עולם"), "שלום עולם");
  assert.equal(joinText("שלום", ", עולם"), "שלום, עולם");
  assert.equal(joinText("שורה\n", "חדשה"), "שורה\nחדשה");
  assert.equal(joinText("שלום", ""), "שלום");
});

test("insertAt puts dictation at the caret", () => {
  assert.deepEqual(insertAt("אני אוהבת שוקולד", 10, "מאוד"), { text: "אני אוהבת מאוד שוקולד", caret: 14 });
  assert.deepEqual(insertAt("שלום", 4, "עולם"), { text: "שלום עולם", caret: 9 });
  assert.equal(insertAt("שלום", undefined, "עולם").text, "שלום עולם");
  assert.equal(insertAt("", 0, "התחלה").text, "התחלה");
});

test("counting and titles", () => {
  assert.equal(countWords("שלום, מה שלומך?\nטוב."), 4);
  assert.equal(countWords(""), 0);
  assert.deepEqual(stats("אחת שתיים שלוש"), { words: 3, chars: 12, readMin: 1 });
  assert.equal(titleFrom("סיכום פגישה עם הלקוחה על העוגות לחתונה ביוני"), "סיכום פגישה עם הלקוחה על העוגות…");
  assert.equal(titleFrom("קצר."), "קצר");
  assert.equal(titleFrom("   "), "מסמך חדש");
  assert.equal(formatDuration(65_000), "1:05");
});

test("searchNotes finds by title or text, newest first, ignoring niqqud", () => {
  const notes = [
    { id: 1, title: "קניות", text: "חלב ולחם", updated: 1 },
    { id: 2, title: "רעיונות", text: "אתר לקינוחים", updated: 3 },
    { id: 3, title: "שיעור", text: "שָׁלוֹם", updated: 2 },
  ];
  assert.deepEqual(searchNotes(notes, "").map(n => n.id), [2, 3, 1]);
  assert.deepEqual(searchNotes(notes, "קינוח").map(n => n.id), [2]);
  assert.deepEqual(searchNotes(notes, "שלום").map(n => n.id), [3]);
});

test("every language has commands", () => {
  for (const l of LANGS) assert.ok(COMMANDS[l.id]?.length, l.id);
});

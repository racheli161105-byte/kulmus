/**
 * Kulmus: dictation UI.
 * Speech → text with the browser's Web Speech API; the recording itself with MediaRecorder.
 */
import { LANGS, COMMANDS, applyCommands, capitalize, insertAt, stats, titleFrom, formatDuration, searchNotes, uid } from "./logic.js";
import { load, save, newNote, audio } from "./store.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();

let state = load();
if (!state.notes.length) { const n = newNote(state.settings.lang); state.notes.push(n); state.current = n.id; }
const note = () => state.notes.find(n => n.id === state.current);

let saveTimer;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(state), 300); }
function update(patch) {
  const n = note();
  Object.assign(n, patch, { updated: Date.now() });
  persist();
}

/* =========================================================
   Rendering
   ========================================================= */

function renderList() {
  const list = searchNotes(state.notes, $("#search").value);
  const fmt = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  $("#noteList").innerHTML = list.map(n => `
    <li><button class="note-item ${n.id === state.current ? "on" : ""}" data-note="${n.id}">
      <b>${esc(n.title || titleFrom(n.text))}</b>
      <small class="muted">${fmt.format(n.updated)} · ${stats(n.text).words} מילים${n.clips.length ? ` · 🎧 ${n.clips.length}` : ""}</small>
      <span class="preview">${esc(n.text.slice(0, 80))}</span>
    </button></li>`).join("") || `<li class="placeholder">לא נמצאו מסמכים</li>`;
}

function renderEditor() {
  const n = note();
  const lang = LANGS.find(l => l.id === n.lang) ?? LANGS[0];
  $("#title").value = n.title;
  $("#title").placeholder = titleFrom(n.text);
  $("#text").value = n.text;
  $("#text").dir = lang.dir;
  $("#interim").dir = lang.dir;
  $("#lang").value = n.lang;
  $("#cmdToggle").checked = state.settings.commands;
  $("#keepAudio").checked = state.settings.saveAudio;
  renderStats();
  renderClips();
  renderCommands();
}

function renderStats() {
  const s = stats($("#text").value);
  $("#stats").textContent = `${s.words} מילים · ${s.chars} תווים · כ-${s.readMin} דק׳ קריאה`;
}

function renderCommands() {
  const cmds = COMMANDS[note().lang] ?? [];
  const show = sign => sign === "\n" ? "↵" : sign === "\n\n" ? "¶" : sign;
  $("#cmdGrid").innerHTML = cmds.map(([w, sign]) => `<span class="cmd"><b>${esc(show(sign))}</b> ${esc(w)}</span>`).join("");
}

async function renderClips() {
  const n = note();
  $("#clipsCard").hidden = !n.clips.length;
  if (!n.clips.length) return;
  const fmt = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  $("#clips").innerHTML = n.clips.map((c, i) => `
    <li data-clip="${c.id}">
      <span class="clip-n">${i + 1}</span>
      <audio controls preload="none"></audio>
      <small class="muted">${fmt.format(c.date)} · ${formatDuration(c.duration)}</small>
      <button class="x" data-del-clip aria-label="מחיקת הקלטה">✕</button>
    </li>`).join("");
  for (const li of $$("#clips li")) {
    const blob = await audio.get(li.dataset.clip);
    if (blob) li.querySelector("audio").src = URL.createObjectURL(blob);
    else li.querySelector("audio").replaceWith(Object.assign(document.createElement("small"), { className: "muted", textContent: "ההקלטה לא נמצאה בדפדפן הזה" }));
  }
}

function renderAll() { lastCaret = null; renderList(); renderEditor(); }

/* =========================================================
   Dictation
   ========================================================= */

const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
const rec = { on: false, engine: null, started: 0, timer: null, caret: null, media: null, chunks: [], stream: null, undo: [], errors: 0, heard: false, restartTimer: null };
const isAndroid = /Android/i.test(navigator.userAgent);
const ERRORS = {
  "not-allowed": "🎙️ אין הרשאה למיקרופון. לוחצים על סמל המנעול ליד שורת הכתובת, מאשרים מיקרופון, ומנסים שוב.",
  "service-not-allowed": "🎙️ הדפדפן חוסם את שירות זיהוי הדיבור. ב-iPhone צריך להפעיל הכתבה (הגדרות ← כללי ← מקלדת ← הפעל הכתבה). בדפדפן Brave או Opera זה לא עובד, נסו Chrome.",
  "audio-capture": "🎙️ לא נמצא מיקרופון. בודקים שהמיקרופון מחובר ושאף תוכנה אחרת (זום, וואטסאפ) לא משתמשת בו.",
  "network": "📶 אין חיבור לשירות זיהוי הדיבור. בודקים את האינטרנט. בדפדפן Brave זה לא עובד, נסו Chrome.",
  "language-not-supported": "🌐 הדפדפן לא תומך בשפה הזו. נסו Chrome במחשב.",
  "no-speech": "🤫 לא שמעתי דיבור. מדברים קרוב יותר למיקרופון, או בודקים בהגדרות שנבחר המיקרופון הנכון."
};
// where the user last placed the cursor in the text (pressing record moves focus to the button)
let lastCaret = null;

if (!Speech) $("#unsupported").hidden = false;

function setRecordingUi(on) {
  $("#recBtn").classList.toggle("on", on);
  $("#recBtn").setAttribute("aria-pressed", on);
  $("#recBtn").setAttribute("aria-label", on ? "עצירת הקלטה" : "התחלת הקלטה");
  $("#recBtn .rec-icon").textContent = on ? "⏹" : "🎙️";
  $("#recStatus").textContent = on ? "מקשיבה… מדברים בחופשיות" : "לוחצים ומתחילים לדבר";
  $("#wave").classList.toggle("on", on);
  document.body.classList.toggle("recording", on);
  if (!on) { $("#interim").textContent = ""; $("#recTimer").textContent = ""; }
}

function addFinal(raw) {
  const n = note();
  let chunk = state.settings.commands ? applyCommands(raw, n.lang) : raw.trim();
  const ta = $("#text");
  const caret = rec.caret ?? ta.value.length;
  const before = ta.value;
  const { text, caret: next } = insertAt(before, caret, chunk);
  const fixed = capitalize(text, n.lang);
  ta.value = fixed;
  rec.caret = next;
  rec.undo.push(before);
  $("#undoBtn").disabled = false;
  ta.setSelectionRange(next, next);
  lastCaret = next;
  update({ text: fixed });
  renderStats();
  renderList();
  // keep the newest words in view
  if (next >= fixed.length - 2) ta.scrollTop = ta.scrollHeight;
}

function startEngine() {
  const n = note();
  const engine = new Speech();
  engine.lang = n.lang;
  engine.continuous = true;
  engine.interimResults = true;
  engine.maxAlternatives = 1;
  engine.onstart = () => { if (rec.on && !rec.heard) setStatus("מקשיבה… אפשר לדבר"); };
  engine.onaudiostart = () => { if (rec.on) startAudio(); };
  engine.onspeechstart = () => { if (rec.on) setStatus("שומעת אותך ✍️"); };
  engine.onresult = ev => {
    rec.heard = true; rec.errors = 0;
    $("#micBlocked").hidden = true;
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) addFinal(r[0].transcript);
      else interim += r[0].transcript;
    }
    $("#interim").textContent = interim;
  };
  engine.onerror = ev => {
    if (ev.error === "aborted") return;
    if (ev.error === "not-allowed" && inFrame) { stop(); return showMicProblem(); }
    const fatal = ["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"].includes(ev.error);
    rec.errors++;
    // a pause with no speech is normal; only complain if nothing was ever heard
    if (ev.error === "no-speech" && rec.heard) return;
    if (fatal || rec.errors >= 3 || ev.error === "no-speech") showProblem(ERRORS[ev.error] || `⚠️ זיהוי הדיבור נכשל (${ev.error}). מרעננים את הדף ומנסים שוב.`);
    if (fatal || rec.errors >= 3) stop();
  };
  // browsers stop listening after a pause; keep going until the user presses stop
  engine.onend = () => {
    if (!rec.on) return;
    clearTimeout(rec.restartTimer);
    rec.restartTimer = setTimeout(() => {
      if (!rec.on) return;
      try { startEngine(); } catch { stop(); showProblem("⚠️ זיהוי הדיבור נעצר. לוחצים שוב על הכפתור."); }
    }, 250);
  };
  rec.engine = engine;
  engine.start();
}

function setStatus(text) { $("#recStatus").textContent = text; }

function showProblem(msg) {
  $("#micBlocked").hidden = false;
  $("#micBlocked").textContent = msg;
}

function showMicProblem() {
  $("#micBlocked").hidden = false;
  $("#micBlocked").innerHTML = inFrame
    ? "🎙️ כאן אין גישה למיקרופון. פתחו את קולמוס מהכתובת שלו (למשל ב-GitHub Pages) כדי להקליט."
    : "🎙️ אין הרשאה למיקרופון. לוחצים על סמל המנעול ליד שורת הכתובת, מאשרים מיקרופון, ומנסים שוב.";
}

async function startAudio() {
  // speech recognition owns the microphone first; keeping the audio is an opt-in extra, never on Android
  if (rec.media || rec.stream || !state.settings.saveAudio || isAndroid || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return;
  try {
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    rec.chunks = [];
    rec.media = new MediaRecorder(rec.stream);
    rec.media.ondataavailable = e => { if (e.data.size) rec.chunks.push(e.data); };
    rec.media.start(1000);
  } catch {
    rec.media = null; // dictation still works without keeping the audio
  }
}

async function stopAudio(noteId) {
  const media = rec.media, stream = rec.stream;
  rec.media = null; rec.stream = null;
  if (!media) return;
  await new Promise(res => { media.onstop = res; try { media.stop(); } catch { res(); } });
  stream?.getTracks().forEach(t => t.stop());
  if (!rec.chunks.length) return;
  const blob = new Blob(rec.chunks, { type: media.mimeType || "audio/webm" });
  const id = uid();
  await audio.put(id, blob);
  const n = state.notes.find(x => x.id === noteId);
  if (!n) return;
  n.clips.push({ id, duration: Date.now() - rec.started, date: Date.now() });
  save(state);
  if (noteId === state.current) renderClips();
  renderList();
}

async function start() {
  if (!Speech) return toast("הדפדפן לא תומך בהקלדה קולית. נסו Chrome, Edge או Safari");
  $("#micBlocked").hidden = true;
  const ta = $("#text");
  rec.caret = lastCaret !== null ? Math.min(lastCaret, ta.value.length) : ta.value.length;
  rec.on = true;
  rec.errors = 0;
  rec.heard = false;
  rec.started = Date.now();
  setRecordingUi(true);
  try { startEngine(); } catch { rec.on = false; setRecordingUi(false); showMicProblem(); return; }
  rec.timer = setInterval(() => { $("#recTimer").textContent = formatDuration(Date.now() - rec.started); }, 500);
}

function stop() {
  if (!rec.on) return;
  rec.on = false;
  clearInterval(rec.timer);
  clearTimeout(rec.restartTimer);
  try { rec.engine?.stop(); } catch { /* ignore */ }
  setRecordingUi(false);
  stopAudio(state.current);
  save(state);
}

$("#recBtn").addEventListener("click", () => (rec.on ? stop() : start()));
// Space bar starts and stops when not typing
document.addEventListener("keydown", e => {
  if (e.code !== "Space" || e.target.closest("textarea, input, select, button")) return;
  e.preventDefault();
  rec.on ? stop() : start();
});

/* =========================================================
   Editing & notes
   ========================================================= */

$("#text").addEventListener("input", e => { update({ text: e.target.value }); renderStats(); renderList(); $("#title").placeholder = titleFrom(e.target.value); });
for (const ev of ["click", "keyup", "select", "input"]) $("#text").addEventListener(ev, e => { lastCaret = e.target.selectionStart; rec.caret = lastCaret; });
$("#title").addEventListener("input", e => { update({ title: e.target.value }); renderList(); });
$("#lang").innerHTML = LANGS.map(l => `<option value="${l.id}">${l.name}</option>`).join("");
$("#lang").addEventListener("change", e => {
  const restart = rec.on;
  if (restart) stop();
  update({ lang: e.target.value });
  state.settings.lang = e.target.value;
  renderEditor();
  if (restart) start();
});
$("#cmdToggle").addEventListener("change", e => { state.settings.commands = e.target.checked; persist(); });
$("#keepAudio").addEventListener("change", e => {
  state.settings.saveAudio = e.target.checked;
  persist();
  if (e.target.checked && isAndroid) toast("בטלפון אנדרואיד המיקרופון לא יכול גם להקליט וגם לזהות דיבור, אז ההקלטה תישמר רק במחשב");
});

$("#undoBtn").addEventListener("click", () => {
  const prev = rec.undo.pop();
  if (prev === undefined) return;
  $("#text").value = prev;
  update({ text: prev });
  rec.caret = lastCaret = null;
  $("#undoBtn").disabled = !rec.undo.length;
  renderStats(); renderList();
});

$("#newNote").addEventListener("click", () => {
  if (rec.on) stop();
  const n = newNote(state.settings.lang);
  state.notes.push(n);
  state.current = n.id;
  rec.undo = []; $("#undoBtn").disabled = true;
  save(state);
  renderAll();
  $("#text").focus();
});

$("#noteList").addEventListener("click", e => {
  const id = e.target.closest("[data-note]")?.dataset.note;
  if (!id || id === state.current) return;
  if (rec.on) stop();
  state.current = id;
  rec.undo = []; $("#undoBtn").disabled = true;
  save(state);
  renderAll();
});
$("#search").addEventListener("input", renderList);

$("#deleteNote").addEventListener("click", async () => {
  const n = note();
  if ((n.text || n.clips.length) && !(await ask(`למחוק את "${n.title || titleFrom(n.text)}"${n.clips.length ? " ואת ההקלטות שלו" : ""}?`, "מחיקה"))) return;
  if (rec.on) stop();
  for (const c of n.clips) audio.remove(c.id);
  state.notes = state.notes.filter(x => x.id !== n.id);
  if (!state.notes.length) state.notes.push(newNote(state.settings.lang));
  state.current = [...state.notes].sort((a, b) => b.updated - a.updated)[0].id;
  save(state);
  renderAll();
  toast("המסמך נמחק");
});

$("#clips").addEventListener("click", e => {
  const li = e.target.closest("[data-clip]");
  if (!li || !e.target.closest("[data-del-clip]")) return;
  audio.remove(li.dataset.clip);
  update({ clips: note().clips.filter(c => c.id !== li.dataset.clip) });
  save(state);
  renderClips(); renderList();
});

/* =========================================================
   Export
   ========================================================= */

const fullText = () => { const n = note(); return (n.title ? `${n.title}\n\n` : "") + n.text; };

$("#copyBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(fullText()); toast("הטקסט הועתק ✓"); } catch { toast("⚠️ לא ניתן להעתיק"); }
});
$("#txtBtn").addEventListener("click", async () => {
  if (inFrame) { try { await navigator.clipboard.writeText(fullText()); toast("כאן אין הורדת קבצים, אז הטקסט הועתק ✓"); } catch { /* ignore */ } return; }
  const url = URL.createObjectURL(new Blob(["﻿" + fullText()], { type: "text/plain;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${(note().title || titleFrom(note().text)).replace(/[\\/:*?"<>|…]/g, "").trim() || "קולמוס"}.txt` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("הקובץ ירד ✓");
});
$("#waBtn").addEventListener("click", () => {
  const a = Object.assign(document.createElement("a"), { href: "https://wa.me/?text=" + encodeURIComponent(fullText()), target: "_blank", rel: "noopener" });
  document.body.append(a); a.click(); a.remove();
});

/* =========================================================
   Helpers: dialogs, theme, install, toast
   ========================================================= */

function ask(message, okLabel) {
  const d = $("#confirmDialog");
  $("#confirmMsg").textContent = message;
  $("#confirmOk").textContent = okLabel;
  d.returnValue = "";
  d.showModal();
  return new Promise(res => d.addEventListener("close", () => res(d.returnValue === "ok"), { once: true }));
}

function syncThemeIcon() { $("#themeBtn").textContent = document.documentElement.dataset.theme === "dark" ? "☀️" : "🌙"; }
$("#themeBtn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("kulmus-theme", next); } catch { /* ignore */ }
  syncThemeIcon();
});

const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let installEvent = null;
if (!inFrame && !standalone) window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvent = e; $("#installBtn").hidden = false; });
$("#installBtn").addEventListener("click", async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $("#installBtn").hidden = true;
});
if ("serviceWorker" in navigator && !inFrame && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("./sw.js").catch(() => { /* optional */ });
}
window.addEventListener("beforeunload", () => { if (rec.on) stop(); save(state); });

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

/* Boot */
syncThemeIcon();
renderAll();

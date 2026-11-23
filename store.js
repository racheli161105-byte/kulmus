/**
 * Storage: notes and settings in localStorage, audio recordings in IndexedDB
 * (recordings are too big for localStorage). Everything stays in this browser.
 */
import { uid } from "./logic.js";

const KEY = "kulmus-state";

export function emptyState() {
  return { notes: [], current: null, settings: { lang: "he-IL", commands: true, saveAudio: false } };
}

export function newNote(lang = "he-IL") {
  const now = Date.now();
  return { id: uid(), title: "", text: "", lang, created: now, updated: now, clips: [] };
}

export function normalize(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== "object") return s;
  if (Array.isArray(raw.notes)) {
    s.notes = raw.notes.filter(n => n && n.id).map(n => ({
      id: String(n.id), title: String(n.title ?? "").slice(0, 120), text: String(n.text ?? ""), lang: String(n.lang ?? "he-IL"),
      created: Number(n.created) || Date.now(), updated: Number(n.updated) || Date.now(),
      clips: Array.isArray(n.clips) ? n.clips.filter(c => c && c.id).map(c => ({ id: String(c.id), duration: Number(c.duration) || 0, date: Number(c.date) || 0 })) : [],
    }));
  }
  if (raw.settings && typeof raw.settings === "object") {
    s.settings.lang = ["he-IL", "en-US", "ar-IL"].includes(raw.settings.lang) ? raw.settings.lang : "he-IL";
    s.settings.commands = raw.settings.commands !== false;
    // v1 recorded audio by default, which on some devices takes the microphone away from speech recognition.
    // The new key starts off, and only an explicit opt-in turns it on.
    s.settings.saveAudio = raw.settings.saveAudio === true;
  }
  s.current = s.notes.some(n => n.id === raw.current) ? raw.current : s.notes[0]?.id ?? null;
  return s;
}

export function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return normalize(JSON.parse(raw)); } catch { /* blocked */ }
  return emptyState();
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}

/* ---------- Audio clips (IndexedDB) ---------- */

let dbPromise = null;
function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open("kulmus-audio", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("clips");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
  return dbPromise;
}

function tx(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction("clips", mode);
    const req = fn(t.objectStore("clips"));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  }));
}

export const audio = {
  put: (id, blob) => tx("readwrite", s => s.put(blob, id)).catch(() => null),
  get: id => tx("readonly", s => s.get(id)).catch(() => null),
  remove: id => tx("readwrite", s => s.delete(id)).catch(() => null),
};

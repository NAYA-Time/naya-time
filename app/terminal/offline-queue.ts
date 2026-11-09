// Offline-Warteschlange im Browser (IndexedDB). Gespeichert wird nur verschlüsselt:
// Das iPad verschlüsselt mit dem öffentlichen Serverschlüssel und kann den Inhalt danach selbst nicht mehr lesen.

const DB = "naya-time";
const STORE = "offline-stamps";
const PAGE_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());

export type Action = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";
type Sync = { serverAt: number; deviceAt: number; perf: number; page: string };
export interface QueuedStamp {
  id: string;
  sealed: { wrappedKey: string; iv: string; data: string };
  evidence: { recordedDeviceAt: number; syncServerAt: number | null; syncDeviceAt: number | null; syncPerf: number | null; recordedPerf: number | null; samePage: boolean };
  firstName: string; type: Action; shownTime: string; // nur für die Anzeige am iPad
}

const ls = {
  get<T>(k: string): T | null { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* voll/gesperrt */ } },
};

/** Nach jeder erfolgreichen Serverzeit-Abfrage aufrufen */
export function rememberSync(serverAt: number, deviceAt: number) {
  ls.set("naya.sync", { serverAt, deviceAt, perf: performance.now(), page: PAGE_ID } satisfies Sync);
}
export const rememberPublicKey = (k: string) => ls.set("naya.offlineKey", k);
export const hasPublicKey = () => !!ls.get<string>("naya.offlineKey");
export const rememberEmployees = <T,>(e: T[]) => ls.set("naya.employees", e);
export const cachedEmployees = <T,>() => ls.get<T[]>("naya.employees") ?? [];

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { res(req.result); db.close(); };
    t.onerror = () => { rej(t.error); db.close(); };
  });
}
export const listQueue = () => tx<QueuedStamp[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedStamp[]>).catch(() => [] as QueuedStamp[]);
const removeQueued = (id: string) => tx("readwrite", (s) => s.delete(id));

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));

/** Buchung verschlüsselt ablegen. Wirft, wenn kein Schlüssel vorhanden ist (Gerät war noch nie online). */
export async function queueStamp(id: string, secret: { employeeId?: string; personnelNumber?: string; pin: string; type: Action; breakTaken: boolean | null }, firstName: string, shownTime: string) {
  const spki = ls.get<string>("naya.offlineKey");
  if (!spki || !crypto.subtle) throw new Error("Offline-Speichern ist auf diesem Gerät noch nicht eingerichtet.");
  const pub = await crypto.subtle.importKey("spki", Uint8Array.from(atob(spki), (c) => c.charCodeAt(0)), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(secret)));
  const wrappedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, await crypto.subtle.exportKey("raw", aes));
  const sync = ls.get<Sync>("naya.sync");
  const item: QueuedStamp = {
    id, sealed: { wrappedKey: b64(wrappedKey), iv: b64(iv), data: b64(data) },
    evidence: {
      recordedDeviceAt: Date.now(), syncServerAt: sync?.serverAt ?? null, syncDeviceAt: sync?.deviceAt ?? null,
      syncPerf: sync?.perf ?? null, recordedPerf: performance.now(), samePage: sync?.page === PAGE_ID,
    },
    firstName, type: secret.type, shownTime,
  };
  await tx("readwrite", (s) => s.put(item));
}

let flushing = false;
/** Warteschlange an den Server schicken. Gibt die Anzahl der noch wartenden Einträge zurück. */
export async function flushQueue(): Promise<number> {
  const items = await listQueue();
  if (!items.length || flushing) return items.length;
  flushing = true;
  try {
    for (let i = 0; i < items.length; i += 50) {
      const chunk = items.slice(i, i + 50);
      const r = await fetch("/api/terminal/offline-sync", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: chunk.map(({ id, sealed, evidence }) => ({ id, sealed, evidence })) }),
      });
      if (!r.ok) break;
      const { results } = (await r.json()) as { results: { id: string; status: string }[] };
      for (const x of results) await removeQueued(x.id); // gebucht, doppelt oder abgelehnt → Server hat es protokolliert
    }
  } catch { /* weiterhin offline */ } finally { flushing = false; }
  return (await listQueue()).length;
}

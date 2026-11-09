// Alle Zeitpunkte werden als UTC-Instant behandelt; Kalendertage gelten in Europe/Berlin.
export const TZ = "Europe/Berlin";

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Lokaler Kalendertag "YYYY-MM-DD" in Berlin */
export function berlinDate(d: Date): string {
  return dateFmt.format(d);
}

/** "13:24" in Berlin */
export function berlinTime(d: Date): string {
  return timeFmt.format(d);
}

/** Date-Objekt für @db.Date-Spalten (Mitternacht UTC des lokalen Tages) */
export function dbDate(ymd: string): Date {
  return new Date(ymd + "T00:00:00.000Z");
}

/** Offset Berlin gegenüber UTC in Minuten zu einem Zeitpunkt */
function offsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Lokale Berliner Wandzeit ("2026-11-09", "13:30") → UTC-Instant (sommerzeitfest) */
export function berlinToInstant(ymd: string, hm: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let inst = guess - offsetMinutes(new Date(guess)) * 60000;
  inst = guess - offsetMinutes(new Date(inst)) * 60000; // zweiter Durchlauf an Umstellungsgrenzen
  return new Date(inst);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 60000);
}

/** 2550 → "42:30", -195 → "-3:15" */
export function fmtMinutes(min: number): string {
  const s = min < 0 ? "-" : "";
  const a = Math.abs(min);
  return `${s}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}

const weekday = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
export function berlinLongDate(d: Date): string {
  return weekday.format(d);
}

// Arbeitstage eines Vertrags: Bitmaske Bit 0 = Montag … Bit 6 = Sonntag.
const NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export const maskCount = (mask: number) => NAMES.reduce((n, _, i) => n + ((mask >> i) & 1), 0);
export const maskLabel = (mask: number) => NAMES.filter((_, i) => (mask >> i) & 1).join(", ") || "–";

/** Liest die Kästchen „wd“ aus einem Formular. null = keine Kästchen im Formular (alte Formulare). */
export function parseWorkdays(fd: FormData): { mask: number; perWeek: number } | { error: string } | null {
  const raw = fd.getAll("wd").map(String);
  if (!raw.length && !fd.has("wdPresent")) return null;
  let mask = 0;
  for (const v of raw) {
    const i = Number(v);
    if (Number.isInteger(i) && i >= 0 && i <= 6) mask |= 1 << i;
  }
  if (!mask) return { error: "Bitte mindestens einen Arbeitstag ankreuzen." };
  return { mask, perWeek: maskCount(mask) };
}

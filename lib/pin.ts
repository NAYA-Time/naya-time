// PIN-Regeln: 6–8 Ziffern, keine trivialen Folgen, keine Wiederverwendung der letzten 5 PINs.
export const PIN_HISTORY = 5;
export const MAX_FAILED = 5;

export function pinPolicyError(pin: string): string | null {
  if (!/^\d{6,8}$/.test(pin)) return "Der PIN muss aus 6 bis 8 Ziffern bestehen.";
  if (/^(\d)\1+$/.test(pin)) return "Bitte keine gleichen Ziffern (z. B. 111111).";
  const asc = "0123456789012345", desc = "9876543210987654";
  if (asc.includes(pin) || desc.includes(pin)) return "Bitte keine Zahlenfolge (z. B. 123456).";
  return null;
}

/** Sperrdauer nach Fehlversuchen: 5 → 5 Min., 10 → 30 Min., 15+ → 2 Std. */
export function lockMinutes(failed: number): number {
  if (failed >= 15) return 120;
  if (failed >= 10) return 30;
  if (failed >= MAX_FAILED) return 5;
  return 0;
}

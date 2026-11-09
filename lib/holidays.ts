// Gesetzliche Feiertage Hamburg (berechnet; Ostern nach Gauß/Anonymous-Gregorian-Algorithmus)
function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

export function hamburgHolidays(year: number): Map<string, string> {
  const e = easter(year);
  const m = new Map<string, string>([
    [`${year}-01-01`, "Neujahr"],
    [iso(plus(e, -2)), "Karfreitag"],
    [iso(plus(e, 1)), "Ostermontag"],
    [`${year}-05-01`, "Tag der Arbeit"],
    [iso(plus(e, 39)), "Christi Himmelfahrt"],
    [iso(plus(e, 50)), "Pfingstmontag"],
    [`${year}-10-03`, "Tag der Deutschen Einheit"],
    [`${year}-10-31`, "Reformationstag"],
    [`${year}-12-25`, "1. Weihnachtstag"],
    [`${year}-12-26`, "2. Weihnachtstag"],
  ]);
  return m;
}

export function holidayName(ymd: string): string | null {
  return hamburgHolidays(Number(ymd.slice(0, 4))).get(ymd) ?? null;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cachedEmployees, flushQueue, hasPublicKey, listQueue, queueStamp, rememberEmployees, rememberPublicKey, rememberSync } from "./offline-queue";

// ───────────────────────── Typen ─────────────────────────
type Action = "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END";
type Intent = "IN" | "OUT" | "BREAK" | "PLAN";
type Emp = { id: string; name: string; dept: string; deptName: string; needsSetup: boolean };
type Greeting = {
  ticket: string; firstName: string; today: string; serverTime: string; state: "OUT" | "IN" | "BREAK";
  since: string | null; shift: { start: string; end: string | null } | null; actions: Action[]; askBreak: boolean;
  minusMinutes?: number | null;
  vacation?: { year: number; entitlement: number; taken: number; planned: number; rest: number; carryOpen?: number; carryExpires?: string } | null;
  notices?: string[];
  planChanges?: string[];
  plan?: { title: string; range: string; published: boolean; days: { label: string; today: boolean; shifts: string[]; absence: string | null; change?: string | null }[] }[];
};
type Screen =
  | { k: "loading" }
  | { k: "pair"; error?: string }
  | { k: "home" }
  | { k: "pick"; intent: Intent }
  | { k: "number"; intent: Intent }
  | { k: "pin"; intent: Intent; emp: Emp | null; number?: string; error?: string }
  | { k: "setupCode"; intent: Intent; emp: Emp; error?: string }
  | { k: "setupPin"; intent: Intent; emp: Emp; code: string; first?: string; error?: string }
  | { k: "confirm"; intent: Intent; g: Greeting; note?: string }
  | { k: "breakQ"; g: Greeting; action: Action }
  | { k: "camera"; g: Greeting; action: Action; breakTaken: boolean | null }
  | { k: "saving"; action: Action }
  | { k: "offline"; intent: Intent; emp: Emp | null; number?: string }
  | { k: "offlineBreak"; emp: Emp | null; number?: string }
  | { k: "done"; action: Action; time: string; firstName: string; photoMissing: boolean; offline?: boolean }
  | { k: "error"; message: string };

const LABEL: Record<Action, string> = {
  CLOCK_IN: "EINSTEMPELN", CLOCK_OUT: "AUSSTEMPELN", BREAK_START: "PAUSE BEGINNEN", BREAK_END: "PAUSE BEENDEN",
};
const DONE_TEXT: Record<Action, string> = {
  CLOCK_IN: "Erfolgreich eingestempelt", CLOCK_OUT: "Erfolgreich ausgestempelt",
  BREAK_START: "Pause begonnen", BREAK_END: "Pause beendet",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || "Verbindungsfehler"), { code: data.code, status: r.status });
  return data as T;
}
const post = <T,>(url: string, body: object) =>
  api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ───────────────────────── Serverzeit-Uhr ─────────────────────────
function useServerClock() {
  const offset = useRef(0);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const sync = async () => {
      try {
        const t0 = Date.now();
        const { now: s } = await api<{ now: string }>("/api/terminal/time");
        const rtt = Date.now() - t0;
        const deviceNow = Date.now();
        offset.current = new Date(s).getTime() + rtt / 2 - deviceNow;
        rememberSync(deviceNow + offset.current, deviceNow); // Beleg für spätere Offline-Buchungen
      } catch { /* offline: letzte Abweichung bleibt */ }
    };
    sync();
    const a = setInterval(sync, 5 * 60_000);
    const b = setInterval(() => setNow(new Date(Date.now() + offset.current)), 1000);
    setNow(new Date(Date.now() + offset.current));
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  return now;
}
const fmtTime = (d: Date) => d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtDate = (d: Date) => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "long", day: "2-digit", month: "long", year: "numeric" });

// ───────────────────────── Bausteine ─────────────────────────
function Big({ children, onClick, tone = "gold", disabled }: { children: React.ReactNode; onClick?: () => void; tone?: "gold" | "dark" | "good" | "bad"; disabled?: boolean }) {
  const tones = {
    gold: "bg-gold text-ink active:bg-gold-deep",
    dark: "bg-slate text-paper border border-line active:bg-coal",
    good: "bg-good text-ink active:opacity-80",
    bad: "bg-bad text-ink active:opacity-80",
  };
  return (
    <button disabled={disabled} onClick={onClick}
      className={`w-full min-h-24 rounded-2xl px-4 text-[clamp(1.05rem,2.9vw,1.5rem)] font-semibold tracking-[0.08em] whitespace-nowrap sm:tracking-[0.12em] transition-transform active:scale-[0.985] disabled:opacity-40 ${tones[tone]}`}>
      {children}
    </button>
  );
}

/** Kompakte Wochenansicht beim Einstempeln: nur die eigenen Dienste dieser Woche */
function WeekStrip({ week }: { week: NonNullable<Greeting["plan"]>[number] }) {
  return (
    <section aria-label="Deine Dienste diese Woche" className="rounded-3xl border border-line bg-coal p-3">
      <p className="mb-2 px-1 text-sm tracking-[0.2em] text-mute">DEINE WOCHE {week.range}{!week.published && <span className="tracking-normal text-warn"> · noch nicht veröffentlicht</span>}</p>
      <ol className="grid grid-cols-7 gap-1.5 text-center">
        {week.days.map((d) => (
          <li key={d.label} className={`min-w-0 rounded-xl px-1 py-2 ${d.change ? "bg-info/20 text-info ring-2 ring-info" : d.today ? "bg-gold/20 text-gold ring-1 ring-gold" : "bg-ink"}`}>
            <span className="block text-sm">{d.label.slice(0, 2)} <span className="text-mute">{d.label.slice(3, 9)}</span></span>
            {d.shifts.length ? d.shifts.map((t) => (
              <span key={t} className="block text-lg font-semibold leading-tight tabular">{t.split("–")[0]}<span className="block text-xs font-normal text-mute">bis {t.split("–")[1]}</span></span>
            )) : <span className={`block text-base leading-tight ${d.change ? "" : "text-mute"}`}>{d.absence ?? "frei"}</span>}
            {d.change && <span className="block text-[11px] font-semibold leading-tight">{d.change.startsWith("gestrichen") ? `GESTRICHEN war ${d.change.match(/war (\d\d:\d\d)/)?.[1] ?? ""}` : d.change === "neu" ? "NEU" : `GEÄNDERT war ${d.change.match(/vorher (\d\d:\d\d)/)?.[1] ?? ""}`}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Hinweis auf geänderte Dienste (blau). compact: eine Zeile, Einzelheiten stehen in der Wochenleiste. */
function PlanChanges({ g, compact = false }: { g: Greeting; compact?: boolean }) {
  if (!g.planChanges?.length) return null;
  if (compact) return <p role="alert" className="rounded-2xl border-2 border-info bg-info/15 px-5 py-2 text-lg font-semibold text-info">Dein Dienstplan wurde geändert – siehe blau markierte Tage.</p>;
  return (
    <div role="alert" className="rounded-2xl border-2 border-info bg-info/15 px-5 py-2 text-info">
      <p className="text-lg font-semibold">Dein Dienstplan wurde geändert:</p>
      <ul className="grid gap-x-6 text-base leading-snug sm:grid-cols-2">{g.planChanges.map((c) => <li key={c} className="tabular">{c}</li>)}</ul>
    </div>
  );
}

function MyPlan({ g }: { g: Greeting }) {
  return (
    <div className="mx-auto grid w-full max-w-4xl flex-1 content-start gap-6 overflow-y-auto py-4">
      <h2 className="font-display text-5xl">Hallo {g.firstName}, deine Dienste</h2>
      <PlanChanges g={g} />
      {g.vacation && (
        <p className="rounded-3xl border border-line bg-coal px-5 py-4 text-2xl">
          Urlaub {g.vacation.year}: <span className="font-semibold text-gold">noch {g.vacation.rest.toLocaleString("de-DE")} Tage</span>
          {g.vacation.carryOpen ? <span className="block text-lg text-warn">Davon {g.vacation.carryOpen.toLocaleString("de-DE")} Tage aus dem Vorjahr – bitte bis {g.vacation.carryExpires?.split("-").reverse().join(".")} nehmen.</span> : null}
          <span className="block text-lg text-mute">Anspruch {g.vacation.entitlement.toLocaleString("de-DE")} · genommen {g.vacation.taken.toLocaleString("de-DE")}{g.vacation.planned ? ` · geplant ${g.vacation.planned.toLocaleString("de-DE")}` : ""}</span>
        </p>
      )}
      {(g.plan ?? []).map((w) => (
        <section key={w.title} className="rounded-3xl border border-line bg-coal p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-2xl font-semibold">{w.title} <span className="text-mute tabular">{w.range}</span></h3>
            {!w.published && <span className="text-lg text-warn">noch nicht veröffentlicht – kann sich ändern</span>}
          </div>
          <ul className="grid gap-1">
            {w.days.map((d) => (
              <li key={d.label} className={`flex flex-wrap items-center justify-between gap-x-4 rounded-xl px-4 py-2.5 text-2xl ${d.change ? "bg-info/15 text-info ring-2 ring-info" : d.today ? "bg-gold/15 text-gold" : ""}`}>
                <span className="tabular">{d.label}</span>
                <span className="tabular">{d.shifts.length ? d.shifts.join(", ") : d.absence ?? <span className={d.change ? "" : "text-mute"}>frei</span>}{d.shifts.length > 0 && d.absence ? ` · ${d.absence}` : ""}</span>
                {d.change && <span className="w-full text-right text-base font-semibold">Änderung: {d.change}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-lg text-mute">Nur du siehst hier deinen Plan. Bei Fragen zum Dienstplan bitte bei der Leitung melden.</p>
    </div>
  );
}

function Shell({ children, onBack, title }: { children: React.ReactNode; onBack?: () => void; title?: string }) {
  return (
    <main className="flex h-dvh flex-col px-8 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="flex min-h-16 items-center justify-between gap-4">
        {onBack ? (
          <button onClick={onBack} className="min-h-14 rounded-xl border border-line px-6 text-lg text-mute active:bg-slate">‹ Zurück</button>
        ) : <span />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/naya-logo.svg" alt="NAYA" className="h-10 w-auto" />
        <span className="text-lg text-mute">{title}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </main>
  );
}

function PinPad({ length = 8, min = 6, onSubmit, error, label }: { length?: number; min?: number; onSubmit: (v: string) => void; error?: string; label: string }) {
  const [v, setV] = useState("");
  useEffect(() => setV(""), [error, label]);
  const press = (k: string) => {
    if (k === "⌫") return setV((x) => x.slice(0, -1));
    if (k === "OK") return v.length >= min && onSubmit(v);
    setV((x) => (x.length < length ? x + k : x));
  };
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6">
      <p className="text-center text-2xl">{label}</p>
      <div className="flex h-10 items-center justify-center gap-3" aria-label={`${v.length} Ziffern eingegeben`}>
        {Array.from({ length: Math.max(min, v.length) }).map((_, i) => (
          <span key={i} className={`size-5 rounded-full border-2 border-gold ${i < v.length ? "bg-gold" : ""}`} />
        ))}
      </div>
      <p className="min-h-7 text-center text-lg text-bad" role="alert">{error}</p>
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].map((k) => (
          <button key={k} onClick={() => press(k)} disabled={k === "OK" && v.length < min}
            className={`h-20 rounded-2xl text-3xl font-medium tabular active:scale-95 disabled:opacity-30 ${k === "OK" ? "bg-gold text-ink" : "bg-slate border border-line"}`}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── Kamera ─────────────────────────
function CameraCapture({ countdown, onResult }: { countdown: number; onResult: (photo: Blob | null, reason?: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [left, setLeft] = useState(countdown);
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const finish = (b: Blob | null, reason?: string) => {
      if (done.current) return;
      done.current = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      onResult(b, reason);
    };
    const failSafe = setTimeout(() => finish(null, "Kamera reagiert nicht (Zeitüberschreitung)"), 12_000);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Kamera vom Browser nicht unterstützt");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
        // weitester Bildausschnitt (Gunnar: Arbeitskleidung muss erkennbar sein) – nur wo die Kamera Zoom unterstützt
        const track = stream.getVideoTracks()[0];
        const zoom = (track?.getCapabilities?.() as { zoom?: { min: number } } | undefined)?.zoom;
        if (zoom) await track.applyConstraints({ advanced: [{ zoom: zoom.min } as MediaTrackConstraintSet] }).catch(() => {});
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        let n = countdown;
        timer = setInterval(() => {
          n -= 1;
          setLeft(n);
          if (n > 0) return;
          clearInterval(timer);
          const w = Math.min(1600, v.videoWidth || 640);
          const h = Math.round(w * ((v.videoHeight || 480) / (v.videoWidth || 640)));
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          const ctx = c.getContext("2d")!;
          ctx.translate(w, 0); ctx.scale(-1, 1); // wie im Spiegel, so wie der Mitarbeiter sich gesehen hat
          ctx.drawImage(v, 0, 0, w, h);
          c.toBlob((b) => finish(b && b.size > 1000 ? b : null, b ? undefined : "Bild konnte nicht erzeugt werden"), "image/jpeg", 0.82);
        }, 1000);
      } catch (e) {
        const name = (e as Error).name;
        const reason = name === "NotAllowedError" ? "Kamerazugriff nicht erlaubt" : name === "NotFoundError" ? "Keine Kamera gefunden" : (e as Error).message || "Kamerafehler";
        finish(null, reason);
      }
    })();
    return () => { clearTimeout(failSafe); clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [countdown, onResult]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      <div className="relative aspect-[4/3] w-full max-w-xl overflow-hidden rounded-3xl border-2 border-gold bg-coal">
        <video ref={video} playsInline muted className="size-full -scale-x-100 object-cover" />
        <span className="absolute inset-0 grid place-items-center font-display text-9xl text-paper/90 tabular drop-shadow-lg">{left > 0 ? left : ""}</span>
      </div>
      <p className="text-2xl text-mute">Bitte einen Schritt zurück – Gesicht und Arbeitskleidung sollen zu sehen sein.</p>
    </div>
  );
}

// ───────────────────────── Hauptkomponente ─────────────────────────
export default function Terminal() {
  const now = useServerClock();
  const [screen, setScreen] = useState<Screen>({ k: "loading" });
  const [emps, setEmps] = useState<Emp[]>([]);
  const [filter, setFilter] = useState<string>("ALL");
  const idempotency = useRef<string | null>(null);
  const photoRef = useRef<{ blob: Blob | null; reason?: string } | null>(null);

  const auth = useRef<{ emp: Emp | null; number?: string; pin: string } | null>(null); // nur bis zum Ende des Vorgangs im Speicher
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);

  const home = useCallback(() => { idempotency.current = null; auth.current = null; setScreen({ k: "home" }); }, []);

  const loadEmployees = useCallback(async () => {
    try {
      const r = await api<{ employees: Emp[] }>("/api/terminal/employees");
      setEmps(r.employees);
      rememberEmployees(r.employees);
      setOnline(true);
      if (!hasPublicKey()) api<{ publicKey: string }>("/api/terminal/offline-key").then((k) => rememberPublicKey(k.publicKey)).catch(() => {});
      return true;
    } catch (e) {
      const cached = cachedEmployees<Emp>();
      if (!(e as { status?: number }).status && cached.length) { setEmps(cached); setOnline(false); return true; } // offline: letzte bekannte Liste
      if ((e as { code?: string }).code === "NOT_PAIRED") setScreen({ k: "pair" });
      else setScreen({ k: "error", message: (e as Error).message });
      return false;
    }
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    loadEmployees().then((ok) => ok && setScreen({ k: "home" }));
  }, [loadEmployees]);

  // Mitarbeiterliste aktuell halten: neue Mitarbeiter, PIN-Rücksetzung und abgeschlossene Ersteinrichtung
  // müssen ohne Neustart der App ankommen. Still im Hintergrund – Fehler ändern den Bildschirm nicht.
  const refreshEmployees = useCallback(async () => {
    try {
      const r = await api<{ employees: Emp[] }>("/api/terminal/employees");
      setEmps(r.employees);
      rememberEmployees(r.employees);
    } catch { /* offline oder Serverfehler: letzte bekannte Liste behalten */ }
  }, []);
  const screenKind = screen.k;
  useEffect(() => {
    if (screenKind === "home" || screenKind === "pick") refreshEmployees();
    if (screenKind !== "home" && screenKind !== "pick") return;
    const t = setInterval(refreshEmployees, 60_000);
    const vis = () => { if (document.visibilityState === "visible") refreshEmployees(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [screenKind, refreshEmployees]);

  // Offline-Warteschlange regelmäßig nachreichen
  useEffect(() => {
    const run = async () => {
      setPending(await flushQueue());
      const ok = await fetch("/api/terminal/time", { cache: "no-store" }).then((r) => r.ok, () => false);
      setOnline(ok);
    };
    listQueue().then((q) => setPending(q.length));
    run();
    const t = setInterval(run, 30_000);
    const off = () => setOnline(false);
    window.addEventListener("online", run);
    window.addEventListener("offline", off);
    return () => { clearInterval(t); window.removeEventListener("online", run); window.removeEventListener("offline", off); };
  }, [loadEmployees]);

  const saveOffline = async (action: Action, breakTaken: boolean | null) => {
    const a = auth.current;
    if (!a) return setScreen({ k: "error", message: "Keine Verbindung zum Server. Bitte erneut versuchen." });
    const time = now ? fmtTime(now) : "";
    try {
      await queueStamp(idempotency.current ?? crypto.randomUUID(), { employeeId: a.emp?.id, personnelNumber: a.emp ? undefined : a.number, pin: a.pin, type: action, breakTaken },
        a.emp?.name.split(" ")[0] ?? "", time);
      auth.current = null;
      setPending((n) => n + 1);
      setOnline(false);
      setScreen({ k: "done", action, time, firstName: a.emp?.name.split(" ")[0] ?? "", photoMissing: false, offline: true });
    } catch (e) {
      setScreen({ k: "error", message: `Keine Verbindung zum Server und offline nicht speicherbar (${(e as Error).message}). Bitte der Leitung Bescheid geben und die Zeit notieren.` });
    }
  };

  // Automatische Rückkehr zur Startseite bei Inaktivität
  useEffect(() => {
    if (["home", "loading", "pair", "saving", "camera"].includes(screen.k)) return;
    const ms = screen.k === "done" ? 4000 : screen.k === "error" ? 8000 : 30_000;
    let t = setTimeout(home, ms);
    const reset = () => { clearTimeout(t); t = setTimeout(home, ms); };
    window.addEventListener("pointerdown", reset);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", reset); };
  }, [screen, home]);

  const afterAuth = (intent: Intent, g: Greeting) => setScreen({ k: "confirm", intent, g });

  const login = async (intent: Intent, emp: Emp | null, pin: string, number?: string) => {
    try {
      auth.current = { emp, number, pin };
      const g = await post<Greeting>("/api/terminal/auth", emp ? { employeeId: emp.id, pin } : { personnelNumber: number, pin });
      setOnline(true);
      afterAuth(intent, g);
    } catch (e) {
      if (!(e as { status?: number }).status && intent === "PLAN") { auth.current = null; return setScreen({ k: "error", message: "Keine Verbindung zum Server. Der Dienstplan kann gerade nicht angezeigt werden." }); }
      if (!(e as { status?: number }).status && hasPublicKey()) { idempotency.current = crypto.randomUUID(); return setScreen({ k: "offline", intent, emp, number }); }
      auth.current = null;
      setScreen({ k: "pin", intent, emp, number, error: (e as Error).message });
    }
  };

  const choose = (g: Greeting, action: Action) => {
    idempotency.current = crypto.randomUUID();
    photoRef.current = null;
    if (action === "CLOCK_OUT" && g.askBreak) return setScreen({ k: "breakQ", g, action });
    setScreen({ k: "camera", g, action, breakTaken: null });
  };

  const submit = async (g: Greeting, action: Action, breakTaken: boolean | null) => {
    setScreen({ k: "saving", action });
    const fd = new FormData();
    fd.set("ticket", g.ticket);
    fd.set("type", action);
    fd.set("idempotencyKey", idempotency.current ?? crypto.randomUUID());
    const p = photoRef.current;
    if (p?.blob) fd.set("photo", new File([p.blob], "foto.jpg", { type: "image/jpeg" }));
    else fd.set("photoMissingReason", p?.reason ?? "Kein Foto");
    if (breakTaken != null) fd.set("breakTaken", breakTaken ? "yes" : "no");
    // Bei Netzfehlern bis zu 3 Versuche mit demselben Schlüssel – der Server bucht trotzdem nur einmal.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await api<{ time: string }>("/api/terminal/stamp", { method: "POST", body: fd });
        setScreen({ k: "done", action, time: r.time, firstName: g.firstName, photoMissing: !p?.blob });
        return;
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status && status < 500) return setScreen({ k: "error", message: (e as Error).message });
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      }
    }
    // Netz weg: verschlüsselt auf dem iPad ablegen, wird automatisch nachgereicht (Foto wird offline nicht gespeichert)
    await saveOffline(action, breakTaken);
  };

  const screenRef = useRef(screen);
  screenRef.current = screen;
  const onPhoto = useCallback((blob: Blob | null, reason?: string) => {
    photoRef.current = { blob, reason };
    const s = screenRef.current;
    if (s.k === "camera") submit(s.g, s.action, s.breakTaken);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───── Bildschirme ─────
  switch (screen.k) {
    case "loading":
      return <Shell><div className="grid flex-1 place-items-center text-2xl text-mute">Lädt …</div></Shell>;

    case "pair":
      return <PairScreen error={screen.error} onPaired={() => loadEmployees().then((ok) => ok && home())} />;

    case "home":
      return (
        <main className="relative isolate flex h-dvh flex-col items-center justify-between overflow-hidden px-8 pb-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
          {/* Außenansicht NAYA, abgedunkelt, damit Uhr und Knöpfe gut lesbar bleiben */}
          <div aria-hidden className="absolute inset-0 -z-10 bg-cover bg-[position:62%_center]" style={{ backgroundImage: "url(/brand/naya-aussen.jpg)" }} />
          <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-ink/85 via-ink/70 to-ink/95" />
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/naya-logo.svg" alt="NAYA Restaurant & Bar" className="mx-auto h-28 w-auto" />
            <p className="mt-4 text-sm tracking-[0.4em] text-gold">TIME · SMART WORKFORCE MANAGEMENT</p>
          </div>
          <div className="text-center">
            <div className="font-display text-[clamp(6rem,18vw,12rem)] leading-none tabular">{now ? fmtTime(now) : "––:––"}</div>
            <div className="mt-4 text-2xl text-mute">{now ? fmtDate(now) : ""}</div>
          </div>
          <div className="grid w-full max-w-3xl gap-4">
            {(!online || pending > 0) && (
              <p className="rounded-2xl border border-warn/60 bg-ink/70 px-5 py-3 text-center text-lg text-warn" aria-live="polite">
                {!online ? "Offline – Buchungen werden auf dem iPad gespeichert" : "Verbindung wieder da – Offline-Buchungen werden übertragen"}
                {pending > 0 ? ` · ${pending} ${pending === 1 ? "Buchung wartet" : "Buchungen warten"}` : ""}
              </p>
            )}
            <Big onClick={() => setScreen({ k: "pick", intent: "IN" })}>JETZT EINSTEMPELN</Big>
            <div className="grid grid-cols-2 gap-4">
              <Big tone="dark" onClick={() => setScreen({ k: "pick", intent: "OUT" })}>JETZT AUSSTEMPELN</Big>
              <Big tone="dark" onClick={() => setScreen({ k: "pick", intent: "BREAK" })}>PAUSE</Big>
            </div>
            <button onClick={() => setScreen({ k: "pick", intent: "PLAN" })} className="min-h-16 rounded-2xl border border-line bg-ink/60 text-xl tracking-wide text-paper active:bg-slate">MEIN DIENSTPLAN</button>
          </div>
        </main>
      );

    case "pick": {
      const list = emps.filter((e) => filter === "ALL" || e.dept === filter);
      return (
        <Shell onBack={home} title={screen.intent === "IN" ? "Einstempeln" : screen.intent === "OUT" ? "Ausstempeln" : screen.intent === "PLAN" ? "Mein Dienstplan" : "Pause"}>
          <div className="my-4 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-3xl">Wer bist du?</h2>
            <div className="flex flex-wrap gap-2">
              {(["ALL", "KUECHE", "SERVICE", "SPUELE", "BUERO"] as const).filter((f) => f === "ALL" || emps.some((e) => e.dept === f)).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`min-h-14 whitespace-nowrap rounded-xl px-4 text-lg ${filter === f ? "bg-gold text-ink" : "border border-line text-mute"}`}>
                  {{ ALL: "Alle", KUECHE: "Küche", SERVICE: "Service", SPUELE: "Spülküche", BUERO: "Büro" }[f]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid flex-1 auto-rows-[6.5rem] grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] content-start gap-3 overflow-y-auto pb-4">
            {list.map((e) => (
              <button key={e.id} onClick={() => setScreen(e.needsSetup ? { k: "setupCode", intent: screen.intent, emp: e } : { k: "pin", intent: screen.intent, emp: e })}
                className="flex flex-col justify-center rounded-2xl border border-line bg-coal px-5 text-left active:scale-[0.98] active:bg-slate">
                <span className="text-2xl font-medium">{e.name}</span>
                <span className="text-base text-mute">{e.deptName}{e.needsSetup ? " · Ersteinrichtung" : ""}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setScreen({ k: "number", intent: screen.intent })} className="mt-2 min-h-16 rounded-2xl border border-line text-xl text-mute active:bg-slate">
            Mit Personalnummer anmelden
          </button>
        </Shell>
      );
    }

    case "number":
      return (
        <Shell onBack={() => setScreen({ k: "pick", intent: screen.intent })}>
          <PinPad label="Personalnummer eingeben" min={1} length={10} onSubmit={(n) => setScreen({ k: "pin", intent: screen.intent, emp: null, number: n })} />
        </Shell>
      );

    case "pin":
      return (
        <Shell onBack={() => setScreen({ k: "pick", intent: screen.intent })} title={screen.emp?.name ?? `Nr. ${screen.number}`}>
          <PinPad label="Persönlicher PIN" error={screen.error} onSubmit={(pin) => login(screen.intent, screen.emp, pin, screen.number)} />
        </Shell>
      );

    case "setupCode":
      return (
        <Shell onBack={() => setScreen({ k: "pick", intent: screen.intent })} title={screen.emp.name}>
          <PinPad label="Ersteinrichtung: Code von der Leitung" min={4} error={screen.error}
            onSubmit={(code) => setScreen({ k: "setupPin", intent: screen.intent, emp: screen.emp, code })} />
        </Shell>
      );

    case "setupPin":
      return (
        <Shell onBack={() => setScreen({ k: "pick", intent: screen.intent })} title={screen.emp.name}>
          <PinPad label={screen.first ? "PIN zur Bestätigung wiederholen" : "Wähle deinen PIN (6–8 Ziffern)"} error={screen.error}
            onSubmit={async (pin) => {
              if (!screen.first) return setScreen({ ...screen, first: pin, error: undefined });
              if (pin !== screen.first) return setScreen({ ...screen, first: undefined, error: "Die PINs stimmen nicht überein." });
              try {
                const g = await post<Greeting>("/api/terminal/set-pin", { employeeId: screen.emp.id, setupCode: screen.code, pin });
                afterAuth(screen.intent, g);
              } catch (e) {
                const msg = (e as Error).message;
                if (/Einrichtungscode/.test(msg)) setScreen({ k: "setupCode", intent: screen.intent, emp: screen.emp, error: msg });
                else setScreen({ ...screen, first: undefined, error: msg });
              }
            }} />
        </Shell>
      );

    case "confirm": {
      const g = screen.g;
      if (screen.intent === "PLAN") return <Shell onBack={home} title="Mein Dienstplan"><MyPlan g={g} /></Shell>;
      const wanted: Action[] = screen.intent === "IN" ? ["CLOCK_IN"] : screen.intent === "OUT" ? ["CLOCK_OUT"] : ["BREAK_START", "BREAK_END"];
      const primary = g.actions.filter((a) => wanted.includes(a));
      const others = g.actions.filter((a) => !wanted.includes(a));
      const compact = screen.intent === "IN"; // beim Einstempeln mehr Infos (Minus, Hinweise, Woche) → kompakter
      const stateText = g.state === "OUT" ? "Du bist nicht eingestempelt." : g.state === "IN" ? `Eingestempelt seit ${g.since} Uhr.` : "Du bist gerade in der Pause.";
      return (
        <Shell onBack={home}>
          {/* Infos scrollen bei Bedarf, die Knöpfe bleiben immer unten sichtbar */}
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 pb-1">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className={`flex min-h-full flex-col justify-center py-2 ${compact ? "gap-2" : "gap-8"}`}>
                <div>
                  <h2 className={`font-display ${compact ? "text-3xl" : "text-6xl"}`}>Guten Tag, {g.firstName}!</h2>
                  <p className={`text-mute ${compact ? "mt-1 text-xl" : "mt-3 text-2xl"}`}>Heute: {g.today}</p>
                </div>
                <dl className={`grid grid-cols-3 gap-4 rounded-3xl border border-line bg-coal text-center ${compact ? "px-3 py-2" : "p-6"}`}>
                  <div><dt className="text-xs tracking-[0.2em] text-mute sm:text-sm">GEPLANTER BEGINN</dt><dd className={`tabular ${compact ? "text-3xl leading-tight" : "mt-2 text-4xl"}`}>{g.shift ? `${g.shift.start}` : "–"}</dd></div>
                  <div><dt className="text-xs tracking-[0.2em] text-mute sm:text-sm">GEPLANTES ENDE</dt><dd className={`tabular ${compact ? "text-3xl leading-tight" : "mt-2 text-4xl"}`}>{g.shift?.end ?? "–"}</dd></div>
                  <div><dt className="text-xs tracking-[0.2em] text-gold sm:text-sm">AKTUELLE UHRZEIT</dt><dd className={`tabular text-gold ${compact ? "text-3xl leading-tight" : "mt-2 text-4xl"}`}>{now ? fmtTime(now) : ""}</dd></div>
                </dl>
                {screen.intent === "IN" && g.minusMinutes ? (
                  <p role="alert" className="rounded-2xl border-2 border-bad bg-bad/15 px-5 py-2 text-xl font-semibold text-bad">
                    Stundenkonto im Minus: −{Math.floor(g.minusMinutes / 60)}:{String(g.minusMinutes % 60).padStart(2, "0")} Std. (bis gestern)
                  </p>
                ) : null}
                {screen.intent === "IN" && (g.notices ?? []).map((n) => (
                  <p key={n} role="alert" className="rounded-2xl border-2 border-warn bg-warn/15 px-5 py-2 text-base font-semibold text-warn">⚠ {n}</p>
                ))}
                {screen.intent === "IN" && <PlanChanges g={g} compact={!!g.plan?.[0]} />}
                {screen.intent === "IN" && g.plan?.[0] && <WeekStrip week={g.plan[0]} />}
                <p className={`text-mute ${compact ? "text-lg" : "text-xl"}`}>
                  {!g.shift && <span className="text-warn">Für heute ist kein Dienst geplant – du kannst trotzdem stempeln. </span>}
                  {stateText}
                </p>
              </div>
            </div>
            <div className="grid shrink-0 gap-4">
              {primary.map((a) => <Big key={a} onClick={() => choose(g, a)}>{LABEL[a]}</Big>)}
              {!primary.length && <p className="text-xl text-warn">{screen.intent === "IN" ? "Du bist bereits eingestempelt." : "Dafür musst du zuerst einstempeln."}</p>}
              {others.length > 0 && (
                <div className={`grid gap-4 ${others.length > 1 ? "grid-cols-2" : ""}`}>
                  {others.map((a) => <Big key={a} tone="dark" onClick={() => choose(g, a)}>{LABEL[a]}</Big>)}
                </div>
              )}
            </div>
          </div>
        </Shell>
      );
    }

    case "breakQ":
      return (
        <Shell onBack={home}>
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 text-center">
            <h2 className="font-display text-5xl leading-tight">Hast du heute deine Pause vollständig genommen?</h2>
            <div className="grid grid-cols-2 gap-6">
              <Big tone="good" onClick={() => setScreen({ k: "camera", g: screen.g, action: screen.action, breakTaken: true })}>JA</Big>
              <Big tone="dark" onClick={() => setScreen({ k: "camera", g: screen.g, action: screen.action, breakTaken: false })}>NEIN</Big>
            </div>
            <p className="text-lg text-mute">Bei „Nein“ wird keine Pause abgezogen. Die Leitung klärt das mit dir.</p>
          </div>
        </Shell>
      );

    case "offline": {
      const acts: Action[] = screen.intent === "IN" ? ["CLOCK_IN"] : screen.intent === "OUT" ? ["CLOCK_OUT"] : ["BREAK_START", "BREAK_END"];
      return (
        <Shell onBack={home} title={screen.emp?.name ?? `Nr. ${screen.number}`}>
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8">
            <div>
              <h2 className="font-display text-5xl">Keine Verbindung zum Server</h2>
              <p className="mt-4 text-2xl leading-snug text-mute">
                Die Buchung wird mit der aktuellen Uhrzeit ({now ? fmtTime(now) : "–"} Uhr) verschlüsselt auf dem iPad gespeichert und automatisch übertragen,
                sobald das Netz wieder da ist. Dein PIN wird dann geprüft. Ein Foto wird offline nicht gespeichert.
              </p>
            </div>
            <div className="grid gap-4">
              {acts.map((a) => (
                <Big key={a} tone={a === "BREAK_END" ? "dark" : "gold"} onClick={() => (a === "CLOCK_OUT" ? setScreen({ k: "offlineBreak", emp: screen.emp, number: screen.number }) : saveOffline(a, null))}>
                  {LABEL[a]} (OFFLINE)
                </Big>
              ))}
            </div>
          </div>
        </Shell>
      );
    }

    case "offlineBreak":
      return (
        <Shell onBack={home}>
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 text-center">
            <h2 className="font-display text-5xl leading-tight">Hast du heute deine Pause vollständig genommen?</h2>
            <div className="grid grid-cols-2 gap-6">
              <Big tone="good" onClick={() => saveOffline("CLOCK_OUT", true)}>JA</Big>
              <Big tone="dark" onClick={() => saveOffline("CLOCK_OUT", false)}>NEIN</Big>
            </div>
            <p className="text-lg text-mute">Gilt nur, wenn für deine Schicht eine Pause vorgeschrieben ist. Bei „Nein“ wird keine Pause abgezogen.</p>
          </div>
        </Shell>
      );

    case "camera":
      return <Shell><CameraCapture countdown={2} onResult={onPhoto} /></Shell>;

    case "saving":
      return <Shell><div className="grid flex-1 place-items-center text-3xl text-mute">Wird gespeichert …</div></Shell>;

    case "done":
      return (
        <Shell>
          <button onClick={home} className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <span className="grid size-28 place-items-center rounded-full bg-good text-6xl text-ink">✓</span>
            <h2 className="font-display text-5xl">{DONE_TEXT[screen.action]} um {screen.time} Uhr.</h2>
            <p className="text-2xl text-mute">{screen.action === "CLOCK_OUT" ? `Schönen Feierabend, ${screen.firstName}!` : `Danke, ${screen.firstName}.`}</p>
            {screen.offline && <p className="text-xl text-warn">Offline gespeichert – wird übertragen und geprüft, sobald das Netz wieder da ist.</p>}
            {screen.photoMissing && <p className="text-lg text-warn">Hinweis: Es konnte kein Foto aufgenommen werden. Die Buchung ist trotzdem gespeichert.</p>}
          </button>
        </Shell>
      );

    case "error":
      return (
        <Shell onBack={home}>
          <div className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center gap-8 text-center">
            <span className="grid size-24 place-items-center rounded-full bg-bad text-5xl text-ink">!</span>
            <p className="text-3xl leading-snug">{screen.message}</p>
            <div className="w-full max-w-sm"><Big tone="dark" onClick={home}>OK</Big></div>
          </div>
        </Shell>
      );
  }
}

function PairScreen({ onPaired, error: initial }: { onPaired: () => void; error?: string }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("iPad Eingang");
  const [error, setError] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Shell>
      <form className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(undefined);
        try { await post("/api/terminal/pair", { code, name }); onPaired(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>
        <h2 className="font-display text-4xl">Terminal einrichten</h2>
        <p className="text-lg text-mute">Dieses Gerät ist noch nicht als Stempelterminal freigeschaltet. Den Kopplungscode erzeugt der Inhaber im Backoffice.</p>
        <label className="grid gap-2 text-lg">Kopplungscode
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off"
            className="min-h-16 rounded-xl border border-line bg-coal px-4 text-3xl tracking-[0.3em] select-text" />
        </label>
        <label className="grid gap-2 text-lg">Name des Geräts
          <input value={name} onChange={(e) => setName(e.target.value)} className="min-h-14 rounded-xl border border-line bg-coal px-4 text-xl select-text" />
        </label>
        <p className="min-h-7 text-lg text-bad" role="alert">{error}</p>
        <Big disabled={busy || code.length < 6}>GERÄT KOPPELN</Big>
      </form>
    </Shell>
  );
}

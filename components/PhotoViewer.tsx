"use client";
// Stempelfotos ansehen: kleines Kamera-Symbol in der Zeile, Klick öffnet die Fotos (Kommen/Gehen) nebeneinander.
// Die Bilder werden erst beim Öffnen geladen – jeder Abruf steht im Änderungsprotokoll.
import { useRef, useState } from "react";

export type PhotoRef = { id: string; label: string; time: string };

export function PhotoButton({ name, date, photos }: { name: string; date: string; photos: PhotoRef[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  if (!photos.length) return null;
  return (
    <>
      <button type="button" title="Stempelfotos ansehen" aria-label={`Stempelfotos von ${name} ansehen`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); ref.current?.showModal(); }}
        className="inline-flex items-center gap-1 rounded-lg border border-gold/50 px-2 py-0.5 text-xs text-gold hover:bg-gold/10">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 8h3l2-3h8l2 3h3v11H3z" /><circle cx="12" cy="13" r="3.5" /></svg>
        {photos.length}
      </button>
      <dialog ref={ref} onClose={() => setOpen(false)} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
        className="m-auto w-[min(110rem,calc(100vw-1rem))] max-h-[calc(100vh-1rem)] rounded-2xl border border-line bg-coal p-0 text-paper backdrop:bg-black/70">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <p className="font-semibold">{name} · {date}</p>
          <button type="button" onClick={() => ref.current?.close()} className="rounded-lg border border-line px-3 py-1 text-sm hover:bg-slate">Schließen</button>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          {open && photos.map((p) => (
            <figure key={p.id} className="grid gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <a href={`/admin/zeiten/foto/${p.id}`} target="_blank" rel="noopener" title="In voller Größe öffnen">
                <img src={`/admin/zeiten/foto/${p.id}`} alt={`${p.label} ${p.time}`} className="max-h-[75vh] w-full rounded-xl bg-ink object-contain" />
              </a>
              <figcaption className="text-sm text-mute">{p.label} um {p.time} Uhr · Klick aufs Bild öffnet es in voller Größe</figcaption>
            </figure>
          ))}
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-mute">Fotos werden nach Ablauf der Löschfrist automatisch gelöscht. Jeder Abruf wird protokolliert.</p>
      </dialog>
    </>
  );
}

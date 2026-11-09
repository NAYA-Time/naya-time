// Speicher für verschlüsselte Dateien. Lokal: Dateisystem. Produktiv: S3-kompatibel (Supabase Storage) – gleiche Schnittstelle.
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Endgültig löschen (z. B. Fotos nach Ablauf der Löschfrist). Fehlt die Datei schon, ist das kein Fehler. */
  delete(key: string): Promise<void>;
}

class FileStore implements BlobStore {
  constructor(private root: string) {}
  private p(key: string) {
    if (!/^[a-z0-9/_-]+(\.[a-z0-9]+)?$/i.test(key) || key.includes("..")) throw new Error("ungültiger Schlüssel");
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    const file = this.p(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: "wx" }); // nie überschreiben
  }
  async get(key: string) {
    return readFile(this.p(key));
  }
  async delete(key: string) {
    await unlink(this.p(key)).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
  }
}

export const blobStore: BlobStore = new FileStore(path.resolve(process.env.STORAGE_DIR ?? "./.storage"));

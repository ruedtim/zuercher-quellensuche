/**
 * PDF-Download mit Disk-Cache, Host-Fallback und Retry. Höflich zum externen
 * Dienst: kleine Verzögerung, begrenzte Retries mit Backoff.
 */

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { CDWS_FILE_HOSTS, pdfUrl, USER_AGENT, type ProtocolSession } from "./cdws.ts";

const PDF_MAGIC = Buffer.from("%PDF");

function isPdf(buf: Buffer): boolean {
  return buf.length > 1024 && buf.subarray(0, 4).equals(PDF_MAGIC);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cachePath(cacheDir: string, s: ProtocolSession): string {
  return join(cacheDir, `${s.eDokumentId}_v${s.pdfVersion}.pdf`);
}

/**
 * Liefert den lokalen Pfad zum (ggf. frisch geladenen) Protokoll-PDF.
 * Cache-Hit, wenn die Datei existiert und ein gültiges PDF ist.
 */
export async function ensurePdf(
  s: ProtocolSession,
  opts: { cacheDir: string; retries?: number; delayMs?: number },
): Promise<string> {
  await mkdir(opts.cacheDir, { recursive: true });
  const path = cachePath(opts.cacheDir, s);

  // Cache-Hit?
  try {
    const st = await stat(path);
    if (st.size > 1024) {
      const head = (await readFile(path)).subarray(0, 4);
      if (head.equals(PDF_MAGIC)) return path;
    }
  } catch {
    /* nicht im Cache */
  }

  const retries = opts.retries ?? 3;
  let lastErr: unknown = null;

  for (const host of CDWS_FILE_HOSTS) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(pdfUrl(host, s.eDokumentId, s.pdfVersion), {
          headers: { "User-Agent": USER_AGENT, Accept: "application/pdf" },
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (isPdf(buf)) {
            await writeFile(path, buf);
            return path;
          }
          // 200 aber kein PDF (z. B. HTML-Fehlerseite) → nächster Host.
          break;
        }
        if (res.status === 404) break; // Datei nicht auf diesem Host → nächster Host
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastErr = err;
      }
      if (attempt < retries) await sleep((opts.delayMs ?? 300) * (attempt + 1));
    }
  }

  throw new Error(
    `PDF-Download fehlgeschlagen für ${s.eDokumentId} v${s.pdfVersion}: ${String(lastErr)}`,
  );
}

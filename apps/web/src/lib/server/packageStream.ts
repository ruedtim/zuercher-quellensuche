// ZIP-Paket eines Dokuments mit Faksimiles: Die Antwort beginnt sofort, jedes Bild wird erst geholt,
// wenn das vorige abgeflossen ist. Bis 2026-11 lud die Route alle Bilder in den Speicher,
// bevor das erste Byte ging (bis 245 Bilder, 99 MB) – fünf gleichzeitige Pakete beendeten den Prozess,
// und nach einem Abbruch lief der Abruf weiter.
// Kein $env – Bildabruf, Abbruch-Signal und Platz-Freigabe werden injiziert (testbar mit tsx --test).

import archiver from "archiver";
import { Buffer } from "node:buffer";
import { IDLE_TIMEOUT_MS, linkedAbort, progressWatchdog, trackEntries } from "./exportStream";
import { responseBody } from "./responseBody";

/** So viele Bilder höchstens (das längste Dokument hat 245). */
export const MAX_IMAGES = 400;
/** Grösse eines Bildes, ab der es nicht mehr ins Paket kommt. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Nach so vielen Fehlschlägen in Folge ist der Bildserver weg: die übrigen nicht mehr versuchen. */
const MAX_FAILURES_IN_A_ROW = 5;

export interface PackageFile {
	name: string;
	content: string;
}

export interface PackageJob {
	/** Ordner im ZIP. */
	root: string;
	/** Texte vor den Bildern. */
	files: PackageFile[];
	/** Adressen der Bilder in Reihenfolge. */
	images: string[];
	/** Meldungen, die schon feststehen (fehlende TEI, Manifest …). */
	errors: string[];
	/** Texte nach den Bildern (README, metadata.json): kennen Zahl der Bilder und Fehler. */
	closing: (status: { imageCount: number; errors: string[] }) => PackageFile[];
}

export interface PackageDeps {
	/** Holt ein Bild; wirft mit einer Meldung fürs errors.log. */
	fetchImage: (url: string, signal: AbortSignal) => Promise<Uint8Array>;
	/** Abbruch durch den Client (request.signal). */
	signal: AbortSignal;
	/** Platz freigeben – genau einmal (Ende, Abbruch, Fehler). */
	release: () => void;
	idleTimeoutMs?: number;
}

function padWidth(n: number): number {
	return n < 10 ? 2 : Math.max(3, String(n).length);
}

export function createPackageStream(job: PackageJob, deps: PackageDeps): ReadableStream<Uint8Array> {
	const zip = archiver("zip", { zlib: { level: 6 } });
	const ac = linkedAbort(deps.signal);
	const tracker = trackEntries(zip);
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		stopWatchdog();
		ac.abort(new Error("Paket beendet"));
		deps.release();
	};
	zip.on("warning", (err) => console.warn(`[package] archiver warning: ${err.message}`));
	zip.on("error", (err) => {
		console.warn(`[package] ${err.message}`);
		release();
	});
	zip.on("end", release);
	zip.on("close", release);
	const stopWatchdog = progressWatchdog(zip, deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS, () =>
		zip.destroy(new Error("Paket abgebrochen: keine Daten mehr abgeholt")),
	);

	const errors = [...job.errors];
	let appended = 0;
	const add = (content: string | Buffer, name: string) => {
		zip.append(content, { name: `${job.root}/${name}` });
		appended++;
	};

	void (async () => {
		const { signal } = ac;
		for (const file of job.files) add(file.content, file.name);
		const images = job.images.slice(0, MAX_IMAGES);
		if (images.length < job.images.length) {
			errors.push(`[images] nur die ersten ${images.length} von ${job.images.length} Bildern beigelegt`);
		}
		const pad = padWidth(images.length);
		let imageCount = 0;
		let failures = 0;
		for (let i = 0; i < images.length; i++) {
			// Erst weiter, wenn das vorige Bild ins Archiv abgeflossen ist. Dessen Puffer fasst ein paar
			// MB: Liest niemand, bleiben höchstens so viele Bilder im Speicher.
			await tracker.waitProcessed(appended - 1, signal);
			const tag = `[image ${i + 1}/${images.length}]`;
			try {
				const bytes = await deps.fetchImage(images[i], signal);
				if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`zu gross (${Math.round(bytes.byteLength / 1024 / 1024)} MB)`);
				add(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), `images/${String(i + 1).padStart(pad, "0")}.jpg`);
				imageCount++;
				failures = 0;
			} catch (err) {
				if (signal.aborted) throw err;
				errors.push(`${tag} ${(err as Error).message} – ${images[i]}`);
				if (++failures >= MAX_FAILURES_IN_A_ROW && i + 1 < images.length) {
					errors.push(`[images] nach ${failures} Fehlern in Folge abgebrochen, ${images.length - i - 1} Bilder nicht versucht`);
					break;
				}
			}
		}
		for (const file of job.closing({ imageCount, errors })) add(file.content, file.name);
		if (errors.length > 0) add(errors.join("\n") + "\n", "errors.log");
		await zip.finalize();
	})().catch((err) => {
		if (!zip.destroyed) zip.destroy(err instanceof Error ? err : new Error(String(err)));
	});

	return responseBody(zip);
}

/** Frist je Bild: Auch fünf in Folge bleiben unter nginx' proxy_read_timeout (120 s ohne ein Byte). */
const IMAGE_TIMEOUT_MS = 20_000;

/**
 * Bildabruf fürs Paket: nur von den erlaubten Bildservern (die Adressen stehen in Manifesten Dritter),
 * ohne Weiterleitung, mit Frist.
 */
export function imageFetcher(allowedOrigins: readonly string[], fetcher: typeof fetch, timeoutMs = IMAGE_TIMEOUT_MS) {
	return async (url: string, signal: AbortSignal): Promise<Uint8Array> => {
		let origin: string;
		try {
			origin = new URL(url).origin;
		} catch {
			throw new Error("ungültige Adresse");
		}
		if (!allowedOrigins.includes(origin)) throw new Error("Bildserver nicht vorgesehen");
		const res = await fetcher(url, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
		if (!res.ok) {
			await res.body?.cancel().catch(() => {});
			throw new Error(`HTTP ${res.status}`);
		}
		const length = Number(res.headers.get("content-length"));
		if (length > MAX_IMAGE_BYTES) {
			await res.body?.cancel().catch(() => {});
			throw new Error(`zu gross (${Math.round(length / 1024 / 1024)} MB)`);
		}
		return new Uint8Array(await res.arrayBuffer());
	};
}

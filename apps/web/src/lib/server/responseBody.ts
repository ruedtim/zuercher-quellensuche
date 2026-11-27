// Node-Stream (archiver) als Body einer Antwort, statt `Readable.toWeb()`. Mit dem beendete ein
// Client, der trennt, BEVOR die Antwort beginnt, den ganzen Node-Prozess – auf zwei Wegen:
//   - toWeb legt jedes «data» der Quelle in den Web-Stream, auch nach dessen Ende
//     (ERR_INVALID_STATE im Event-Handler, uncaughtException).
//   - Ist der Web-Stream schon gescheitert, lehnt `reader.cancel()` ab; SvelteKit ruft es bei
//     geschlossener Verbindung ohne catch auf (setResponse, unhandledRejection).
// Hier liest nur `pull()`, und erst, wenn jemand liest (highWaterMark 0): Vorher kann der
// Web-Stream nicht scheitern, nachher schreibt niemand mehr hinein. Ein Fehler der Quelle kommt
// beim Lesen an, die Verbindung bricht ab – nie eine still abgeschnittene Datei.
// Ohne $env → responseBody.test.ts.

import type { Readable } from "node:stream";
import { Buffer } from "node:buffer";

export function responseBody(source: Readable): ReadableStream<Uint8Array> {
	// Vor dem ersten Lesen hört sonst niemand auf «error» (ohne Listener ein Absturz).
	source.on("error", () => {});
	let iterator: AsyncIterator<Uint8Array | string> | null = null;
	return new ReadableStream<Uint8Array>(
		{
			async pull(controller) {
				iterator ??= source[Symbol.asyncIterator]() as AsyncIterator<Uint8Array | string>;
				const { done, value } = await iterator.next();
				if (done) controller.close();
				else controller.enqueue(typeof value === "string" ? Buffer.from(value) : value);
			},
			cancel() {
				source.destroy();
			},
		},
		{ highWaterMark: 0 },
	);
}

/**
 * Fertige Stücke als Body, das nächste erst, wenn das vorige beim Client ist. `onEnd` läuft, wenn
 * alles abgeholt ist oder der Client trennt.
 */
export function bytesBody(parts: readonly Uint8Array[], onEnd: () => void): ReadableStream<Uint8Array> {
	const rest = [...parts];
	return new ReadableStream<Uint8Array>(
		{
			pull(controller) {
				const part = rest.shift();
				if (part) {
					controller.enqueue(part);
					return;
				}
				onEnd();
				controller.close();
			},
			cancel() {
				rest.length = 0;
				onEnd();
			},
		},
		{ highWaterMark: 0 },
	);
}

/** Antwort, wenn der Client schon getrennt hat: ohne Body, niemand liest sie (nginx: 499). */
export function clientGone(): Response {
	return new Response(null, { status: 499 });
}

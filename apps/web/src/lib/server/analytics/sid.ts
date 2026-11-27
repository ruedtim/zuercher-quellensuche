import { createHash, randomBytes } from "node:crypto";

// Tages-rotierender Salt im Prozess-RAM. Wird nie persistiert; ein
// Container-Restart erzeugt einen neuen Salt und macht alle bisherigen
// anon_sid-Werte unverknüpfbar mit zukünftigen. Das verhindert
// Cross-Day-Tracking auch dann noch, wenn jemand die JSONL-Logs liest.
let dailySalt: Buffer = randomBytes(16);
let saltDay: string = todayUTC();

function todayUTC(): string {
	return new Date().toISOString().slice(0, 10);
}

function rotateIfNeeded(): void {
	const today = todayUTC();
	if (today !== saltDay) {
		dailySalt = randomBytes(16);
		saltDay = today;
	}
}

/**
 * Liefert einen 8-stelligen Hex-Hash aus (Tagessalz, anonymisierter IP, UA).
 * Stabil innerhalb eines UTC-Tages, danach unverknüpfbar.
 *
 * `xRealIp` ist auf Hetzner bereits durch nginx anonymisiert (IPv4: letztes Oktett
 * .0, IPv6: nur die ersten 32 Bit); im Local-Dev kommt 127.0.0.1. In beiden Fällen
 * eignet sich der Wert als grobes Unique-Counting-Merkmal.
 */
export function anonSid(xRealIp: string, ua: string): string {
	rotateIfNeeded();
	return createHash("sha256")
		.update(dailySalt)
		.update(xRealIp)
		.update("\0")
		.update(ua)
		.digest("hex")
		.slice(0, 8);
}

// Nur für Tests: erlaubt deterministische Salt-Werte.
export function __setSaltForTests(salt: Buffer, day: string): void {
	dailySalt = salt;
	saltDay = day;
}

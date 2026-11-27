// Country-Lookup für die anonymisierte Client-IP, gespeist aus der DB-IP
// IP-to-Country Lite Datenbank (CC-BY 4.0, monatliche Edition).
//
// Fail-soft: wenn die .mmdb fehlt oder nicht lesbar ist, gibt der Lookup
// null zurück und der Hook lässt das country-Feld einfach weg. Es darf
// nichts kaputt gehen, nur weil der Cron mal nicht durchgekommen ist.

import { open, type CountryResponse, type Reader } from "maxmind";

const DB_PATH = process.env.GEOIP_COUNTRY_DB || "/srv/geoip/dbip-country-lite.mmdb";

let readerPromise: Promise<Reader<CountryResponse> | null> | null = null;
let warnedMissing = false;

function getReader(): Promise<Reader<CountryResponse> | null> {
	if (!readerPromise) {
		readerPromise = open<CountryResponse>(DB_PATH).catch((err) => {
			if (!warnedMissing) {
				warnedMissing = true;
				console.warn(`[analytics] geo DB unavailable at ${DB_PATH}:`, err.message ?? err);
			}
			return null;
		});
	}
	return readerPromise;
}

/**
 * Liefert den ISO-3166-Alpha-2-Country-Code für die übergebene IP, oder
 * null wenn DB fehlt, IP nicht auflösbar oder leer ist.
 *
 * Erwartet die bereits durch nginx anonymisierte IP (z.B. "192.0.2.0").
 * Das /24-Prefix reicht für Country-Lookup praktisch immer aus.
 */
export async function lookupCountry(ip: string): Promise<string | null> {
	if (!ip || ip === "0" || ip === "127.0.0.1" || ip.startsWith("::1")) return null;
	const reader = await getReader();
	if (!reader) return null;
	try {
		const result = reader.get(ip);
		return result?.country?.iso_code ?? null;
	} catch {
		return null;
	}
}

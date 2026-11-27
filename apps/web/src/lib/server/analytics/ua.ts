// Kompakter User-Agent-Klassifikator. Speichert nur Family + mobile-Flag,
// nie den vollen UA-String – der ist in seltenen Fällen identifizierend
// (Versionssalat + Plattform-Bits + Sprache kann fingerprinten).

export interface UaInfo {
	ua: "chrome" | "firefox" | "safari" | "edge" | "bot" | "other";
	mobile: boolean;
}

export function uaFamily(uaRaw: string | null | undefined): UaInfo {
	const ua = (uaRaw ?? "").toLowerCase();
	const mobile = /mobi|android|iphone|ipad/.test(ua);

	// CLI-Tools wie curl/wget sind keine Browser-Sessions. Wir klassifizieren
	// sie als "bot", damit der Standard-Filter (WHERE ua != 'bot') sie aus den
	// Analytics-Queries draußen lässt – wichtig wegen Docker-Healthchecks,
	// die alle 30 s `curl /` rufen und sonst Top-Route-Statistiken verzerren.
	if (/^(curl|wget|python-requests|libwww-perl|go-http-client)\b/.test(ua)) {
		return { ua: "bot", mobile };
	}

	if (/googlebot|bingbot|yandexbot|duckduckbot|baiduspider|facebookexternalhit|crawler|spider|\bbot\b/.test(ua)) {
		return { ua: "bot", mobile };
	}
	if (/edg\//.test(ua)) return { ua: "edge", mobile };
	if (/firefox\//.test(ua)) return { ua: "firefox", mobile };
	// Edge & Chrome melden beide "Chrome", aber Edge wurde oben schon abgefangen.
	if (/chrome\//.test(ua)) return { ua: "chrome", mobile };
	// Safari meldet "Safari", aber Chrome auch. Echtes Safari hat "Version/".
	if (/safari\//.test(ua) && /version\//.test(ua)) return { ua: "safari", mobile };
	return { ua: "other", mobile };
}

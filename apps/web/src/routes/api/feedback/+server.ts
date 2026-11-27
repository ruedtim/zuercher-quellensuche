import { error, json } from "@sveltejs/kit";
import { GITHUB_TOKEN, GITHUB_ISSUE_REPO } from "$lib/server/env";
import { buildIssueContent } from "$lib/server/feedback";
import { checkRateLimit } from "$lib/server/apiV1/rateLimit";
import { clientKey } from "$lib/server/clientKey";
import type { RequestHandler } from "./$types";

// Nutzer-Feedback → automatisches GitHub-Issue. Same-Origin-POST (kein
// öffentliches API, kein CORS), gebremst durch lokale Rate-Limits und ein Feld, das nur Programme
// ausfüllen. Token/Rohfehler werden NIE an den Client geleakt; der reine Issue-Builder steckt in
// $lib/server/feedback.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Kontingent (Namespace `feedback:`, getrennt von /api/v1) belasten, sonst 429. */
function limit(bucket: string, max: number, windowMs: number): void {
	const rl = checkRateLimit(`feedback:${bucket}`, max, windowMs);
	if (rl.ok) return;
	const minutes = Math.max(1, Math.ceil(rl.retryAfterS / 60));
	throw error(429, `Gerade gehen sehr viele Rückmeldungen ein. Bitte versuchen Sie es in ${minutes} ${minutes === 1 ? "Minute" : "Minuten"} erneut.`);
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const key = clientKey(request, getClientAddress);
	limit(`m:${key}`, 5, MINUTE);

	const body = (await request.json().catch(() => null)) as {
		kind?: unknown;
		message?: unknown;
		contact?: unknown;
		website?: unknown;
		context?: { url?: unknown } | null;
	} | null;

	// Im Dialog unsichtbares Feld: ausgefüllt hiesse Programm. Antwort wie bei Erfolg, kein Issue.
	if (typeof body?.website === "string" && body.website.trim() !== "") return json({ number: null });

	// Nur noch allgemeines Feedback (das Feedback zu einer KI-Antwort entfiel 2026-11).
	if (body?.kind !== undefined && body.kind !== "general") throw error(400, "Ungültiges Feedback (kind).");

	const message = typeof body?.message === "string" ? body.message.trim() : "";
	if (!message) throw error(400, "Bitte geben Sie eine Nachricht ein.");
	if (message.length > 5000) throw error(400, "Die Nachricht ist zu lang.");

	const contact = typeof body?.contact === "string" ? body.contact.trim() : "";
	if (contact.length > 200) throw error(400, "Das Kontaktfeld ist zu lang.");

	// URL nur übernehmen, wenn parsebar (kosmetisches Feld – nie 400 deswegen).
	let url = "";
	const rawUrl = body?.context && typeof body.context.url === "string" ? body.context.url : "";
	if (rawUrl) {
		try {
			url = new URL(rawUrl).toString();
		} catch {
			url = "";
		}
	}

	if (!GITHUB_TOKEN || !GITHUB_ISSUE_REPO) {
		throw error(503, "Feedback ist zurzeit nicht verfügbar – der Server ist nicht konfiguriert.");
	}

	// Erst hier, für gültige Rückmeldungen: je Netz und insgesamt pro Stunde, weil jede ein Issue unter
	// dem Konto des Betreibers anlegt. Vorher gezählt sperrten leere Anfragen alle anderen aus.
	limit(`h:${key}`, 10, HOUR);
	limit("all", 30, HOUR);

	const { title, body: issueBody, labels } = buildIssueContent({
		message,
		contact,
		url,
		receivedAt: new Date().toISOString(),
	});

	let res: Response;
	try {
		res = await fetch(`https://api.github.com/repos/${GITHUB_ISSUE_REPO}/issues`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${GITHUB_TOKEN}`,
				Accept: "application/vnd.github+json",
				"Content-Type": "application/json",
				"User-Agent": "zszh-feedback",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: JSON.stringify({ title, body: issueBody, labels }),
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		throw error(502, "Feedback konnte nicht übermittelt werden.");
	}
	if (!res.ok) {
		throw error(502, "Feedback konnte nicht übermittelt werden.");
	}

	const issue = (await res.json().catch(() => null)) as { number?: number } | null;
	// Nur die Nummer: das Repository ist nicht öffentlich, ein Link führte ins Leere.
	return json({ number: issue?.number ?? null });
};

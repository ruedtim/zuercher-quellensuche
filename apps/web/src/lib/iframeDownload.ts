// Download über ein verstecktes iframe statt window.location: Ein Fehler (z. B. 429/503 bei vielen
// Downloads) würde sonst die Seite durch eine Fehlerseite ersetzen. Erfolgreiche Downloads
// (Content-Disposition: attachment) laden im iframe kein Dokument; lädt dagegen Text, ist es die
// Fehlermeldung des Servers.
export function iframeDownload(url: string, onError: (text: string) => void): void {
	const frame = document.createElement("iframe");
	frame.hidden = true;
	frame.tabIndex = -1;
	frame.setAttribute("aria-hidden", "true");
	frame.addEventListener("load", () => {
		let text = "";
		try {
			text = frame.contentDocument?.body?.innerText?.trim() ?? "";
		} catch {
			/* nicht lesbar – kein Fehlertext */
		}
		if (text) onError(text);
	});
	frame.src = url;
	document.body.appendChild(frame);
	// Erst entfernen, wenn der Download sicher übergeben ist (ein zu frühes Entfernen bräche einen noch
	// laufenden Request ab).
	setTimeout(() => frame.remove(), 10 * 60_000);
}

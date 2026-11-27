// Schlüssel für Limits je Client: die von nginx gekürzte IP (X-Real-IP), sonst die Verbindungsadresse.
export function clientKey(request: Request, getClientAddress: () => string): string {
	const xRealIp = request.headers.get("x-real-ip");
	if (xRealIp) return xRealIp;
	try {
		return getClientAddress();
	} catch {
		return "unknown";
	}
}

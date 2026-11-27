// Zweite Linie gegen Ausfälle: Ein abgelehntes Versprechen, auf das niemand wartet, beendet Node –
// und mit dem einen Prozess Website, API und MCP-Server samt allen laufenden Anfragen. Darum
// protokollieren und weiterlaufen; die Stelle gehört trotzdem behoben. `uncaughtException` bleibt
// bewusst tödlich (Zustand unbekannt, Docker startet neu).

const INSTALLED = Symbol.for("zszh.processGuard");

export function installProcessGuard(): void {
	const flags = globalThis as unknown as Record<symbol, boolean>;
	if (flags[INSTALLED]) return;
	flags[INSTALLED] = true;
	process.on("unhandledRejection", (reason) => {
		console.error("[process] unbehandelt abgelehntes Versprechen:", reason);
	});
}

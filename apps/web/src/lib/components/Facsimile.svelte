<script lang="ts">
	import { onMount, onDestroy, tick } from "svelte";

	type PageTarget = { label: string; ordinal: number; seq: number };
	let {
		manifestUrl,
		fillHeight = false,
		targetPage = null,
	}: { manifestUrl: string; fillHeight?: boolean; targetPage?: PageTarget | null } = $props();
	let container: HTMLDivElement;
	type MiradorViewer = {
		unmount?: () => void;
		store: { getState: () => Record<string, unknown>; dispatch: (a: unknown) => void };
	};
	type MiradorCanvas = { id: string; label?: unknown };
	type MiradorModule = {
		default?: { viewer: (config: unknown) => MiradorViewer };
		setCanvas?: (windowId: string, canvasId: string, ...rest: unknown[]) => unknown;
		getCanvases?: (state: unknown, opts: { windowId: string }) => MiradorCanvas[];
	} & Record<string, unknown>;
	let viewer: MiradorViewer | null = null;
	let miradorModule: MiradorModule | null = null;
	let viewerWindowId: string | null = null;
	let pendingTarget: PageTarget | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let loading = $state(true);
	let error = $state<string | null>(null);
	// Faksimile (noch) nicht anzeigbar: Manifest fehlt, der Scan liegt noch
	// nicht auf dem Bildserver (z. B. ABl-Frühbestand) oder der Bildserver ist
	// gerade nicht erreichbar. Kein echter Fehler, sondern erwarteter Zustand –
	// eigener, ruhiger Zustand statt der roten Mirador-Fehlermeldung.
	let unavailable = $state(false);
	let destroyed = false;
	// Eindeutige Container-id pro Mount: Mirador 4 hält intern eine Map
	// id→viewer-Instance. Bei {#key}-Re-Mount können kurzzeitig zwei Mirador-
	// Setups mit gleicher id koexistieren, das alte überschreibt seine Tile-
	// Loads in den neuen Container und das aktuelle Manifest wird nie sauber
	// gerendert.
	const containerId = `mirador-viewer-${Math.random().toString(36).slice(2, 10)}`;
	// Vorprüfung des Bildservers (imageAvailable): Frist je Versuch und Anzahl.
	const IMAGE_CHECK_TIMEOUT_MS = 30_000;
	const IMAGE_CHECK_ATTEMPTS = 2;

	/**
	 * Navigiere Mirador zur Canvas einer Seitenzahl. Zwei Wege:
	 *
	 * 1. **Label-Match** (primär): Canvas, deren Label dem TEI <pb @n>
	 *    entspricht – greift bei den lokal gebauten ABl-Manifesten, deren
	 *    Canvas-Labels = pb @n sind. Dort ist Label-Match wichtig, weil die
	 *    Canvas-Reihenfolge nicht zwingend der pb-Reihenfolge im Body folgt.
	 * 2. **Ordinal-Fallback**: externe Manifeste (OS/KRP/RRB auf
	 *    zszh.sources-online.org, IIIF v2) labeln "Page 1", "Page 2", … –
	 *    die gedruckte Seitenzahl aus @n existiert dort nicht. Dann nehmen
	 *    wir die Position des pb im Text als Canvas-Index (geclamped).
	 *
	 * Funktioniert nur wenn Mirador-Store + Window-ID + Canvases verfügbar.
	 * Vor Init: Target in pendingTarget zwischenspeichern; wenn Manifest
	 * noch lädt, pollend wiederholt versuchen (bis 5s).
	 */
	function canvasLabelText(c: MiradorCanvas): string {
		// Mirador wrappt Canvases in Manifesto.js-Klassen; das label lebt nicht
		// als own-property, sondern hinter getLabel() (Array von Localized-
		// String-Objekten { _locale, _value }) oder im __jsonld-Original.
		const withGetLabel = c as unknown as { getLabel?: () => Array<{ _value?: string }> | undefined };
		if (typeof withGetLabel.getLabel === "function") {
			try {
				const labels = withGetLabel.getLabel();
				if (Array.isArray(labels)) {
					for (const l of labels) {
						if (l && typeof l._value === "string") return l._value;
					}
				}
			} catch {
				/* fall through */
			}
		}
		const jsonld = (c as unknown as { __jsonld?: { label?: unknown } }).__jsonld;
		const raw = jsonld?.label ?? c.label;
		if (typeof raw === "string") return raw;
		if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
		if (raw && typeof raw === "object") {
			// IIIF-Presentation-3 language map { "none": ["393"] } / { "de": [...] }
			for (const v of Object.values(raw as Record<string, unknown>)) {
				if (Array.isArray(v) && typeof v[0] === "string") return v[0];
				if (typeof v === "string") return v;
			}
		}
		return "";
	}

	function goToCanvas(target: PageTarget, attempts = 0) {
		if (!viewer || !miradorModule?.setCanvas || !miradorModule?.getCanvases || !viewerWindowId) {
			pendingTarget = target;
			return;
		}
		let canvases: MiradorCanvas[] | null = null;
		try {
			const state = viewer.store.getState();
			canvases = miradorModule.getCanvases(state, { windowId: viewerWindowId });
		} catch {
			canvases = null;
		}
		if (!canvases || canvases.length === 0) {
			// Manifest noch nicht geladen – bis zu 5s warten (50 × 100ms)
			if (attempts < 50) {
				setTimeout(() => goToCanvas(target, attempts + 1), 100);
			}
			return;
		}
		let canvas = target.label
			? canvases.find((c) => canvasLabelText(c) === target.label)
			: undefined;
		if (!canvas && target.ordinal >= 0) {
			canvas = canvases[Math.min(target.ordinal, canvases.length - 1)];
		}
		if (!canvas) return;
		try {
			viewer.store.dispatch(miradorModule.setCanvas(viewerWindowId, canvas.id));
		} catch {
			// Mirador-API-Inkompatibilität: lieber stumm bleiben als crashen
		}
	}

	// Click auf eine Seitenzahl im TEI-Text setzt im Parent targetPage;
	// dieser Effect übersetzt das in einen Mirador-Wechsel. Jeder Klick
	// erzeugt ein neues Objekt (seq), darum feuert der Effect auch bei
	// wiederholtem Klick auf dieselbe Seite. Bei null (Initial oder Reset
	// bei Doc-Wechsel) tun wir nichts.
	$effect(() => {
		if (targetPage == null) return;
		goToCanvas(targetPage);
	});

	/**
	 * Manifest-URLs zeigen aktuell auf zwei Quellen:
	 *  - http(s)://<host>/iiif/...    – vom Indexer lokal generiert (ABl)
	 *  - https://zszh.sources-online.org/manifests/... – extern (OS/KRP/RRB)
	 * Damit Mirador in Dev (5173) und Prod ohne CORS-Probleme arbeitet, leiten
	 * wir alles über relative Pfade durch unseren eigenen Origin: lokale Routen
	 * für /iiif/ und /manifests/ proxien beide Welten.
	 */
	function resolveForViewer(raw: string): string {
		try {
			const u = new URL(raw, window.location.origin);
			if (u.hostname === "zszh.sources-online.org") {
				return u.pathname; // beginnt schon mit /manifests/...
			}
			// Same-origin oder andere Hosts auf relative Pfade reduzieren
			return u.pathname + u.search;
		} catch {
			return raw;
		}
	}

	/**
	 * Preflight Teil 1: liefert der /iiif- bzw. /manifests-Proxy das Manifest
	 * überhaupt aus? Liefert das geparste Manifest zurück oder null.
	 *
	 * Mirador holt das Manifest intern via `fetch(url).then(r => r.json())`.
	 * Fehlt die Datei auf dem Bildserver, liefert der Proxy einen 404 mit
	 * HTML-Body – `r.json()` wirft dann in WebKit `SyntaxError: The string
	 * did not match the expected pattern.`, und Mirador rendert seine rote
	 * „An error occurred"-Box. Das ist aber kein echter Fehler, sondern ein
	 * erwarteter Zwischenzustand (Dokument deployt, Faksimile noch nicht
	 * hochgeladen). Darum prüfen wir das Manifest selbst, bevor wir den
	 * schweren Mirador-Bundle laden, und zeigen sonst eine ruhige
	 * Hinweismeldung. Bonus: bei fehlendem Faksimile wird Mirador/OSD gar
	 * nicht erst geladen (Bandbreite gespart).
	 *
	 * Anders als früher parsen wir den Body hier wirklich (`res.json()`) – wir
	 * brauchen ihn, um die info.json-URL des ersten Bildes zu ermitteln (s.
	 * `firstImageInfoUrl`). Das Manifest ist klein; Mirador lädt es gleich
	 * selbst nochmal, das kommt aber aus dem HTTP-Cache (gleiche URL).
	 * `res.ok` fängt den 404, der Content-Type-Sniff den „200-aber-HTML"-Fall.
	 * Timeout, damit ein hängender Proxy in der ruhigen Box statt im
	 * Dauer-Spinner endet.
	 */
	async function fetchManifest(url: string): Promise<unknown | null> {
		try {
			const res = await fetch(url, {
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(15_000),
			});
			if (!res.ok) return null;
			if (!(res.headers.get("content-type") ?? "").toLowerCase().includes("json")) return null;
			return await res.json();
		} catch {
			return null;
		}
	}

	/**
	 * Ermittelt die info.json-URL des ERSTEN Bild-Service aus einem geparsten
	 * Manifest – sowohl IIIF Presentation v3 (lokal generierte ABl-Manifeste)
	 * als auch v2 (externe OS/KRP/RRB-Manifeste). Liefert null, wenn keine
	 * ermittelbar ist (dann wird der Bild-Check übersprungen und der Viewer
	 * trotzdem versucht). Die Service-id ist absolut (media.sources-online.org,
	 * bei den Ratsmanualen files.transkribus.eu) und wird vom Bildserver mit
	 * `Access-Control-Allow-Origin: *` beantwortet, der Cross-Origin-Check ist
	 * also lesbar.
	 */
	function firstImageInfoUrl(manifest: unknown): string | null {
		const m = manifest as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
		if (!m || typeof m !== "object") return null;
		// v3: items[0].items[0].items[0].body.service[0].(id|@id)
		const v3svc = m.items?.[0]?.items?.[0]?.items?.[0]?.body?.service?.[0];
		// v2: sequences[0].canvases[0].images[0].resource.service (Objekt oder Array)
		const v2raw = m.sequences?.[0]?.canvases?.[0]?.images?.[0]?.resource?.service;
		const v2svc = Array.isArray(v2raw) ? v2raw[0] : v2raw;
		const svc = v3svc ?? v2svc;
		const id: unknown = svc?.id ?? svc?.["@id"];
		if (typeof id !== "string" || !id) return null;
		return id.replace(/\/+$/, "") + "/info.json";
	}

	/**
	 * Preflight Teil 2: liegt das (erste) Digitalisat tatsächlich auf dem
	 * Bildserver – und ist der erreichbar?
	 *
	 * Das Manifest kann valide sein, während die zugehörigen Scans (noch) NICHT
	 * auf Cantaloupe liegen (z. B. ABl-Frühbestand ~1910er) oder der Bildserver
	 * gerade down ist. Mirador holt dann pro Canvas die info.json via
	 * `fetch(...).then(r => r.json())`; Cantaloupe antwortet bei fehlendem Scan
	 * mit `404 text/plain` („Failed to resolve …"), `r.json()` wirft denselben
	 * WebKit-SyntaxError, der als rote „An error occurred"-Box landet
	 * (RECEIVE_INFO_RESPONSE_FAILURE → errors-Slice → ErrorDialog).
	 *
	 * Wir prüfen darum vorab die info.json des ersten Bildes. JEDER Negativ-Fall
	 * (404 = Scan fehlt, kein JSON, Netzfehler/Timeout = Bildserver down) ⇒
	 * `false` ⇒ ruhige „nicht verfügbar"-Box statt Fehlermeldung, und Mirador
	 * wird gar nicht erst geladen. Sobald die Bilder wieder da bzw. der Server
	 * erreichbar ist, greift der Check beim nächsten Laden und der Viewer läuft
	 * unverändert.
	 *
	 * Toleranter als der Manifest-Check: Der Transkribus-Bildserver der
	 * Ratsmanuale antwortet im Median in 0,2 s, vereinzelt aber erst nach 15–29 s.
	 * Darum 30 s Frist und ein zweiter Versuch nach einem schnellen Netzfehler
	 * oder 5xx – nicht nach einer abgelaufenen Frist und nicht nach 404 (Scan
	 * fehlt), sonst stünde der Spinner eine Minute.
	 */
	async function imageAvailable(infoUrl: string): Promise<boolean> {
		for (let attempt = 1; attempt <= IMAGE_CHECK_ATTEMPTS; attempt++) {
			try {
				const res = await fetch(infoUrl, {
					headers: { accept: "application/json" },
					signal: AbortSignal.timeout(IMAGE_CHECK_TIMEOUT_MS),
				});
				if (res.status >= 500 && attempt < IMAGE_CHECK_ATTEMPTS && !destroyed) continue;
				if (!res.ok) return false;
				return (res.headers.get("content-type") ?? "").toLowerCase().includes("json");
			} catch (err) {
				const timedOut = err instanceof DOMException && err.name === "TimeoutError";
				if (timedOut || attempt >= IMAGE_CHECK_ATTEMPTS || destroyed) return false;
				await new Promise((resolve) => setTimeout(resolve, 1_000));
			}
		}
		return false;
	}

	/**
	 * Findet den OpenSeadragon-Viewer, den Mirador intern erzeugt hat – er
	 * hängt an einem Kind-Element unseres Containers. OSD führt eine
	 * `_viewers`-Map (Element → Viewer-Instance), die wir iterieren.
	 */
	function findOsdViewer(): { viewport: { goHome: (immediately?: boolean) => void; update: () => void; getZoom?: () => number }; world: { getItemCount: () => number; getItemAt: (i: number) => unknown; addHandler?: (n: string, f: () => void) => void }; forceRedraw: () => void; addHandler: (name: string, fn: () => void) => void } | null {
		const OSD = (window as unknown as { OpenSeadragon?: { _viewers?: Map<Element, unknown> } }).OpenSeadragon;
		const viewers = OSD?._viewers;
		if (!viewers) return null;
		for (const [el, v] of viewers) {
			if (container.contains(el)) {
				return v as ReturnType<typeof findOsdViewer> extends infer R ? NonNullable<R> : never;
			}
		}
		return null;
	}

	/**
	 * Wartet bis OSD initialisiert ist, dann re-fittet die Ansicht. Mirador
	 * ruft `goHome()` zwar selber auf, aber die initiale Container-Größe ist
	 * oft noch nicht final (Side-by-Side-Layout, Sticky-Positioning, async
	 * Hydration). Ergebnis sonst: User sieht graue Fläche bis er scrollt.
	 */
	function pinToHome() {
		const osd = findOsdViewer();
		if (!osd) return;
		osd.viewport.goHome(true);
		osd.viewport.update();
		osd.forceRedraw();
	}

	onMount(async () => {
		try {
			// Erst prüfen, ob das Faksimile wirklich anzeigbar ist – sonst ruhige
			// Hinweisbox statt Miradors roter Fehlerbox, und der schwere
			// Mirador-/OSD-Bundle wird gar nicht erst geladen.
			const resolved = resolveForViewer(manifestUrl);
			// (1) Liegt das Manifest vor?
			const manifest = await fetchManifest(resolved);
			if (!manifest) {
				if (destroyed) return;
				loading = false;
				unavailable = true;
				return;
			}
			// (2) Liegt das (erste) Digitalisat auf dem erreichbaren Bildserver?
			// Fehlende Scans (ABl-Frühbestand) oder ein down/blockierter
			// Bildserver lassen Miradors info.json-Fetch in den WebKit-
			// SyntaxError laufen – das fangen wir hier ab.
			const infoUrl = firstImageInfoUrl(manifest);
			if (infoUrl && !(await imageAvailable(infoUrl))) {
				if (destroyed) return;
				loading = false;
				unavailable = true;
				return;
			}
			if (destroyed) return;

			// Mirador exportiert OpenSeadragon nicht – wir laden es separat und
			// hängen es ans window, damit wir später die OSD-Instance finden.
			const [Mirador, OpenSeadragon] = await Promise.all([
				// @ts-expect-error optional runtime dependency
				import("mirador").catch(() => null),
				// @ts-expect-error optional runtime dependency
				import("openseadragon").catch(() => null),
			]) as [
				MiradorModule | null,
				{ default?: unknown } | null,
			];
			if (OpenSeadragon?.default) {
				(window as unknown as { OpenSeadragon: unknown }).OpenSeadragon = OpenSeadragon.default;
			}

			// Mirador 4 hat einen Bug in CanvasWorld.contentResourceToWorldCoordinates
			// bzw. Canvas.onFragment: ruft `(on || target).match()` blind auf,
			// ohne zu prüfen ob beide undefined sind. Bei IIIF-Presentation-2-
			// Manifesten, die kein xywh-Fragment haben (was 99% der Fälle ist),
			// crasht das. Patch der Prototype-Methoden gegen die häufigsten
			// Crash-Pfade. Defensive Variante der originalen Logik.
			const M = Mirador as Record<string, unknown> | null;
			if (M) {
				type ProtoHolder = { prototype: { onFragment?: (id: unknown) => unknown; resourceAnnotation?: (id: unknown) => { getProperty: (n: string) => unknown } | undefined } };
				const safeOnFragment = function (this: { resourceAnnotation: (id: unknown) => { getProperty: (n: string) => unknown } | undefined }, t: unknown) {
					const n = this.resourceAnnotation(t);
					if (!n) return undefined;
					const r = n.getProperty("on") as string | undefined;
					const i = n.getProperty("target") as string | undefined;
					const src = r || i;
					if (typeof src !== "string") return undefined;
					const m = src.match(/xywh=(.*)$/);
					if (!m) return undefined;
					return m[1].split(",").map((a: string) => parseInt(a, 10));
				};
				for (const key of Object.keys(M)) {
					const c = M[key] as ProtoHolder | undefined;
					if (c && c.prototype && typeof c.prototype.onFragment === "function") {
						c.prototype.onFragment = safeOnFragment;
					}
				}
			}

			if (Mirador?.default) {
				miradorModule = Mirador as MiradorModule;
				viewer = Mirador.default.viewer({
					id: container.id,
					// Beschriftungen auf Deutsch (auch für Screenreader), Schweizer Schreibung.
					language: "de",
					translations: {
						de: { close: "Schliessen", closeCompanionWindow: "Hilfsfenster schliessen", closeWindow: "Fenster schliessen", zoomIn: "Vergrössern" },
					},
					windows: [{ manifestId: resolved }],
					workspace: { type: "mosaic" },
					workspaceControlPanel: { enabled: false },
					window: {
						allowClose: false,
						allowFullscreen: true,
						// In Mirador 4 muss osdConfig unter `window` stehen – als
						// top-level Property wird sie still ignoriert, dann landet
						// jedes Window beim default-osdConfig (kein crossOrigin,
						// WebGL-Drawer). Folge: Tile-Images von
						// media.sources-online.org tainten den Canvas → WebGL
						// streikt → Bild bleibt grau bis User dragged.
						// `drawer: "canvas"` als Sicherheitsnetz: Canvas2D-Drawer
						// stört sich nicht an tainted Bildern, sodass selbst wenn
						// crossOrigin fehlschlägt das Bild trotzdem erscheint.
						osdConfig: {
							crossOriginPolicy: "Anonymous",
							drawer: "canvas",
							preserveImageSizeOnResize: true,
							immediateRender: true,
						},
					},
				});
				loading = false;

				// Window-ID aus dem Mirador-Redux-Store ziehen, sobald sie auftaucht.
				// Mirador erzeugt die Initial-Windows asynchron – Manifest-Fetch
				// kann beim ersten getState() noch nicht durch sein. Daher polling
				// bis sowohl windowId als auch Canvas-Liste verfügbar sind, dann
				// ggf. pending pb-Click anwenden.
				const windowIdInterval = setInterval(() => {
					try {
						const state = viewer!.store.getState() as { windows?: Record<string, unknown> };
						const wins = state.windows;
						const firstId = wins ? Object.keys(wins)[0] : null;
						if (firstId) {
							viewerWindowId = firstId;
							clearInterval(windowIdInterval);
							if (pendingTarget != null) {
								const t = pendingTarget;
								pendingTarget = null;
								// Manifest evtl. noch nicht geladen; goToCanvas
								// pollt selbst auf getCanvases.
								goToCanvas(t);
							}
						}
					} catch {
						// Store-Shape unerwartet – silent fail, Polling läuft weiter bis Timeout.
					}
				}, 100);
				setTimeout(() => clearInterval(windowIdInterval), 10000);

				// OpenSeadragon (in Mirador) ermittelt seine Größe nur beim Init
				// und beim Window-Resize. Container im Side-by-Side-Layout ist
				// initial nicht final layoutet (Sticky, Mosaic-Calc) → leeres
				// Canvas bis User scrollt/zoomt.
				await tick();
				if (typeof ResizeObserver !== "undefined") {
					resizeObserver = new ResizeObserver(() => {
						window.dispatchEvent(new Event("resize"));
						pinToHome();
					});
					resizeObserver.observe(container);
				}

				// Polling: warten bis OSD-Instance existiert, dann an OSDs
				// open-Event hängen – dort steht das Bild fest und wir können
				// sauber re-fitten. Plus zusätzlicher Re-Fit nach 1.5s als
				// Sicherheitsnetz, falls open-Event vor unserer Subscription
				// gefeuert hat.
				let attached = false;
				const attachInterval = setInterval(() => {
					const osd = findOsdViewer();
					if (osd && !attached) {
						attached = true;
						clearInterval(attachInterval);
						osd.addHandler("open", pinToHome);
						osd.addHandler("resize", pinToHome);
						// Falls open bereits gefeuert hat:
						setTimeout(pinToHome, 100);
						setTimeout(pinToHome, 500);
						setTimeout(pinToHome, 1500);
					}
				}, 50);
				// Polling abbrechen nach 10s, falls Mirador nicht initialisiert
				setTimeout(() => clearInterval(attachInterval), 10000);

				// Window-resize-Events trotzdem feuern (Mirador internal handlers)
				for (const delay of [50, 200, 500, 1000]) {
					setTimeout(() => window.dispatchEvent(new Event("resize")), delay);
				}

				// Mirador bundled sein eigenes OSD; `OpenSeadragon._viewers` aus
				// unserem separaten Import bleibt leer, also greift `findOsdViewer`
				// und damit `pinToHome` nicht. Beim Re-Mount via Client-Nav
				// (Suchresultat → Doc) lädt OSD nur info.json und wartet dann auf
				// Interaktion, bevor Tiles gefetcht werden – Bild bleibt grau bis
				// User dragged. Workaround: Sobald das Canvas im DOM ist, einen
				// synthetischen 1px-Mikro-Drag dispatchen. Das triggert OSDs
				// MouseTracker → viewport.update() → tile-fetch, ohne den
				// Bildausschnitt sichtbar zu verschieben.
				let kickTries = 0;
				let kickedOnce = false;
				const kickInterval = setInterval(() => {
					// Unmount (Client-Navigation, Layout-Wechsel) vor dem Canvas:
					// sonst liefe das Intervall ~20 s gegen container = null weiter.
					if (destroyed) {
						clearInterval(kickInterval);
						return;
					}
					kickTries++;
					// MouseTracker hängt am .openseadragon-canvas DIV, nicht am
					// inneren <canvas>. Drag-Events ans Canvas selbst kommen
					// nirgends an.
					const target = container.querySelector(".openseadragon-canvas") as HTMLElement | null;
					const r = target?.getBoundingClientRect();
					if (target && r && r.width > 0) {
						const cx = r.left + r.width / 2;
						const cy = r.top + r.height / 2;
						const base = { bubbles: true, cancelable: true, button: 0, view: window };
						// Wheel mit deltaY=0 triggert OSDs scroll-handler →
						// viewport.update() → tile-fetch, ohne zu zoomen.
						target.dispatchEvent(new WheelEvent("wheel", { ...base, clientX: cx, clientY: cy, deltaX: 0, deltaY: 0 }));
						// Plus Mikro-Drag als Backup.
						target.dispatchEvent(new MouseEvent("mousedown", { ...base, clientX: cx, clientY: cy }));
						target.dispatchEvent(new MouseEvent("mousemove", { ...base, clientX: cx + 1, clientY: cy }));
						target.dispatchEvent(new MouseEvent("mouseup", { ...base, clientX: cx + 1, clientY: cy }));
						// Plus window-resize, falls OSD darauf hört.
						window.dispatchEvent(new Event("resize"));
						kickedOnce = true;
						// Mehrfach kicken (Race-Schutz: OSD braucht manchmal 2-3
						// Versuche bis der draw-loop wirklich startet).
						if (kickTries > 6) clearInterval(kickInterval);
					} else if (!kickedOnce && kickTries > 200) {
						clearInterval(kickInterval);
					}
				}, 100);
			} else {
				loading = false;
				error = "Mirador noch nicht installiert. Manifest-URL ist verlinkt.";
			}
		} catch (err) {
			loading = false;
			error = `Faksimile konnte nicht geladen werden: ${err}`;
		}
	});

	onDestroy(() => {
		destroyed = true;
		resizeObserver?.disconnect();
		viewer?.unmount?.();
	});
</script>

{#if unavailable}
	<!--
		Manifest (noch) nicht auf dem Bildserver – kein Fehler, sondern
		erwarteter Zwischenzustand. Ruhiger Hinweis statt Miradors roter Box;
		der Volltext steht weiterhin daneben/darüber.
	-->
	<div
		class="flex items-center justify-center bg-zszh-50 border border-zszh-200 rounded-md text-center px-6"
		style={fillHeight ? "height: 100%; min-height: 60vh;" : "height: 80vh;"}
	>
		<div class="max-w-sm">
			<p class="text-zszh-700 font-medium">Faksimile zurzeit nicht verfügbar</p>
			<p class="text-sm text-zszh-600 mt-1.5">
				Das Digitalisat liegt noch nicht auf dem Bildserver oder dieser ist
				gerade nicht erreichbar. Der Volltext steht weiterhin zur Verfügung.
			</p>
		</div>
	</div>
{:else}
	<div
		class="relative bg-zszh-900 rounded-md overflow-hidden"
		style={fillHeight ? "height: 100%; min-height: 60vh;" : "height: 80vh;"}
	>
		<div bind:this={container} id={containerId} style="position: absolute; inset: 0;"></div>
		{#if loading}
			<div class="absolute inset-0 flex items-center justify-center text-zszh-100 pointer-events-none">
				<div>Faksimile lädt …</div>
			</div>
		{/if}
	</div>

	{#if error}
		<div class="bg-yellow-50 border border-yellow-200 text-yellow-900 px-4 py-3 rounded-md mt-2">
			<p>{error}</p>
			<p class="text-sm mt-2">
				Manifest:
				<a href={manifestUrl} class="underline" target="_blank" rel="noopener">{manifestUrl}</a>
			</p>
		</div>
	{/if}
{/if}

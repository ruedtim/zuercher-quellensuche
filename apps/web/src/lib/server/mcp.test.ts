// Lauf: npx tsx --test src/lib/server/mcp.test.ts
// Deckt den NETZFREIEN MCP-Protokoll-Layer ab (protocol.ts): JSON-RPC-Dispatch,
// tools/list, prompts/*, Fehlercodes, Notifications, Batch. Der I/O-Teil (tools.ts) zieht
// den `$env`-Pfad (meili/embed) und ist – wie im Repo üblich – nicht direkt
// tsx-testbar; die Dokument-Allowlist (toListHit/toDetailDoc) ist über
// apiV1/respond.test.ts abgedeckt. Liegt bewusst unter src/lib/server/ (nicht
// mcp/), damit der CI-Glob `src/lib/server/*.test.ts` greift (typecheck.yml).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	handleRpc,
	listTools,
	documentUri,
	parseDocumentUri,
	MCP_PROTOCOL_VERSION,
	SERVER_INFO,
	SERVER_INSTRUCTIONS,
	RESEARCH_PROMPT,
	researchPromptText,
	INVALID_REQUEST,
	METHOD_NOT_FOUND,
	INVALID_PARAMS,
	type CallTool,
	type McpToolOutput,
	type ReadResource,
} from "./mcp/protocol";
import { alternativesCountOutput, alternativesSearchOutput, mcpCatalogFilters } from "./mcp/protocol";
import { PASSAGE_WINDOW_MAX } from "./searchTools";
import { buildCoverage, COVERAGE_AS_OF, COVERAGE_URI, gapLabel, yearRuns, type CoverageLive } from "./mcp/coverage";
import { LICENSE } from "./apiV1/constants";
import { EHEDATEN_ATTRIBUTION, EHEDATEN_LICENSE } from "$lib/ehedaten";
import { EDITIONS } from "$lib/editions";
import {
	catalogFetchText,
	editionFetchText,
	ehedatenFetchText,
	FEDERATED_COLLECTIONS,
	FEDERATED_SEARCH_NOTE,
	FEDERATED_ZERO_HINT,
	federatedFetchDoc,
	federatedId,
	federatedSearchOutput,
	leanCatalogResult,
	parseFederatedId,
	type FederatedBlock,
} from "./mcp/federated";

// Stub-CallTool: gibt die Argumente strukturiert zurück, ohne I/O.
const stubCall: CallTool = async (name, args): Promise<McpToolOutput> => ({
	structuredContent: { echoed: name, args },
});

// Stub-ReadResource: liefert für bekannte URIs Inhalt, sonst null.
const stubRead: ReadResource = async (uri) =>
	uri === documentUri("DOC1") ? { uri, mimeType: "text/plain", text: "Titel\n\nVolltext" } : null;

test("listTools: genau 16; der föderierte Einstieg und die Bestands-Einstiege vorn, coverage als Rückfall am Ende (die Reihenfolge zeigen die Clients)", () => {
	const tools = listTools();
	const names = tools.map((t) => t.name);
	assert.equal(tools.length, 16);
	assert.deepEqual(names, [
		"search",
		"fetch",
		"fetch_many",
		"catalog_search",
		"passage_search",
		"ehedaten_search",
		"edition_search",
		"keyword_search",
		"semantic_search",
		"list_documents",
		"count_documents",
		"timeline",
		"overview",
		"similar_documents",
		"vector_search",
		// Selbstbeschreibung als Rückfall für Clients ohne `instructions`: am Ende.
		"coverage",
	]);
	// Kein Dokument-Werkzeug vor dem Einstieg in den grössten Bestand (Befund 2026-11-17:
	// catalog_search stand an Stelle 13 von 15).
	assert.ok(names.indexOf("catalog_search") < names.indexOf("keyword_search"), "catalog_search vor den Dokument-Werkzeugen");
	assert.ok(!names.includes("ask_user"), "ask_user nicht exponiert");
	assert.ok(!names.includes("get_document"), "get_document durch fetch ersetzt");
	for (const t of tools) {
		assert.equal(typeof t.name, "string");
		assert.equal(typeof t.description, "string");
		assert.equal((t.inputSchema as { type?: string }).type, "object");
		// Keine Reste des Recherche-Modus: Quellennummern und get_document gibt es über MCP nicht.
		assert.doesNotMatch(t.description, /\[n\]|get_document|Quellennummer/, `${t.name}: keine Agent-Reste`);
	}
});

test("listTools: passage_search verlangt query, nur Serien mit Passagen, Beschreibung nennt Originalwortlaut und Ratsmanuale", () => {
	const t = listTools().find((x) => x.name === "passage_search")!;
	const schema = t.inputSchema as { properties: Record<string, { items?: { enum?: string[] } }>; required: string[] };
	assert.deepEqual(schema.required, ["query"]);
	assert.deepEqual(schema.properties.series.items?.enum, ["ABl", "KRP", "OS", "RRB"]);
	for (const k of ["query", "series", "dateFrom", "dateTo", "topK"]) assert.ok(k in schema.properties, k);
	assert.match(t.description, /Originalwortlaut/);
	assert.match(t.description, /Ratsmanuale/);
});

test("listTools: semantic_search verspricht Dokumente (keine Passagen mit Nummern), topK bis 25", () => {
	const t = listTools().find((x) => x.name === "semantic_search")!;
	assert.match(t.description, /DOKUMENTE nach Bedeutung/);
	assert.match(t.description, /passage_search/);
	const topK = (t.inputSchema as { properties: { topK: { description: string } } }).properties.topK;
	assert.match(topK.description, /1–25, Default 10/);
});

test("listTools: catalog_search mit semantic, query nicht Pflicht (Namen allein genügen)", () => {
	const t = listTools().find((x) => x.name === "catalog_search")!;
	const schema = t.inputSchema as { properties: Record<string, unknown>; required: string[] };
	assert.ok("semantic" in schema.properties);
	assert.deepEqual(schema.required, []);
	assert.match(t.description, /semantic=true/);
});

test("SERVER_INSTRUCTIONS: Entscheidungshilfe, Grössenordnungen, Bestände, Lücken, Vorgehen und Zitierregeln", () => {
	for (const needle of [
		/Wohin die Frage führt/,
		// Grössenordnungen: Modelle kalibrieren daran, welcher Bestand der grosse ist.
		/1,26 Mio\. Verzeichnungseinheiten/,
		/Zentrale Serien \(Volltexte\) ab 1803: 0,62 Mio\. Dokumente in VIER Serien/,
		/ALLE Bestände parallel/,
		/catalog:/,
		/passage_search/,
		/Lücke 1996–2007/,
		/phrase=true/,
		/alternatives/,
		/alten Stil/,
		/Belege jede Aussage/,
		/hint, caveat oder note/,
		/recherche/,
	]) {
		assert.match(SERVER_INSTRUCTIONS, needle);
	}
	assert.doesNotMatch(SERVER_INSTRUCTIONS, /—/, "kein Geviertstrich");
});

test("researchPromptText: beginnt bei search über alle Bestände und nennt den Katalog als grössten", () => {
	const txt = researchPromptText("Wann gab es in Zürich Lichtpausen?");
	assert.match(txt, /Beginne mit search/);
	assert.match(txt, /1,26 Mio\. Verzeichnungseinheiten/);
	assert.match(txt, /catalog_search/);
	assert.doesNotMatch(txt, /—/, "kein Geviertstrich");
});

test("listTools: jedes Tool trägt readOnly-Annotationen", () => {
	for (const t of listTools()) {
		assert.equal(t.annotations?.readOnlyHint, true, `${t.name}: readOnlyHint`);
		assert.equal(t.annotations?.openWorldHint, false, `${t.name}: openWorldHint`);
	}
});

// --- Föderierter Einstieg `search` und die ID-Auflösung von `fetch` ----------
// Befund 2026-11-17: `search` versprach «Durchsucht das Archiv», suchte aber nur in den
// vier Serien der Volltexte; `fetch` konnte nur Dokument-ids auflösen.

test("listTools: search nennt alle Bestände, beide Arme und die Präfixe der ids", () => {
	const t = listTools().find((x) => x.name === "search")!;
	for (const needle of [/ALLE Bestände/, /Archivkatalog/, /Ehedaten/, /Editionen/, /collection/, /ranking/, /totals/, /catalog:669821/, /edition:QZH_401/]) {
		assert.match(t.description, needle, String(needle));
	}
	// Das alte Versprechen «Standard-Einstieg» bleibt, aber ohne «nur Dokumente» zu meinen.
	assert.match(t.description, /Standard-Einstieg/);
});

test("listTools: fetch und fetch_many lösen jede id auf, nackte ids bleiben Dokumente", () => {
	for (const name of ["fetch", "fetch_many"]) {
		const t = listTools().find((x) => x.name === name)!;
		for (const needle of [/catalog:/, /ehe:/, /edition:/, /NACKTE id ist ein Dokument|Dokumente ohne Präfix/]) {
			assert.match(t.description, needle, `${name}: ${String(needle)}`);
		}
	}
});

test("parseFederatedId: Präfixe je Bestand, nackte id = Dokument, Rundlauf mit federatedId", () => {
	assert.deepEqual(parseFederatedId("MM_3_1_RRB_1887_2264"), { collection: "documents", id: "MM_3_1_RRB_1887_2264" });
	assert.deepEqual(parseFederatedId("catalog:669821"), { collection: "catalog", id: "669821" });
	assert.deepEqual(parseFederatedId("ehe:4505350"), { collection: "ehedaten", id: "4505350" });
	assert.deepEqual(parseFederatedId("edition:QZH_401"), { collection: "editions", id: "QZH_401" });
	assert.deepEqual(parseFederatedId("edition:SSRQ_ZH_NF_II_3_047"), { collection: "editions", id: "SSRQ_ZH_NF_II_3_047" });
	// Gross-/Kleinschreibung des Präfixes und Leerzeichen verzeihen.
	assert.deepEqual(parseFederatedId(" Catalog:669821 "), { collection: "catalog", id: "669821" });
	// Leer bzw. nur das Präfix: keine id.
	assert.equal(parseFederatedId(""), null);
	assert.equal(parseFederatedId("   "), null);
	assert.equal(parseFederatedId("catalog:"), null);
	assert.equal(parseFederatedId(42), null);
	// Ein Dokument behält seine nackte id (Rückwärtskompatibilität, Resource-URIs).
	assert.equal(federatedId("documents", "OS_2025_131_1-81-75"), "OS_2025_131_1-81-75");
	for (const c of FEDERATED_COLLECTIONS) {
		const id = federatedId(c, c === "editions" ? "QZH_401" : 669821);
		assert.deepEqual(parseFederatedId(id)?.collection, c, c);
	}
});

test("federatedSearchOutput: Bestands-Reihenfolge, totals nur für Abgefragtes, Hinweise und Notiz", () => {
	const hit = (collection: string, id: string) => ({ collection, ranking: "keyword", id, title: `T ${id}` });
	const blocks: FederatedBlock[] = [
		// Absichtlich in falscher Reihenfolge übergeben.
		{ collection: "documents", total: 841, results: [hit("documents", "D1")] },
		{ collection: "editions", total: 0, results: [] },
		{ collection: "catalog", total: 83, results: [hit("catalog", "catalog:1")], hint: "Wortanfang-Hinweis." },
		{ collection: "ehedaten", total: null, results: [], unavailable: "not_available" },
	];
	const out = federatedSearchOutput("Pause", blocks) as Record<string, any>;
	assert.equal(out.query, "Pause");
	// Reihenfolge der Reiter der Website: Archivkatalog, Zentrale Serien, Ehedaten, Editionen.
	assert.deepEqual(out.results.map((r: any) => r.collection), ["catalog", "documents"]);
	assert.equal(out.count, 2);
	// 0 heisst «nichts gefunden», ein fehlender Eintrag «nicht abgesucht».
	assert.deepEqual(out.totals, { catalog: 83, documents: 841, editions: 0 });
	assert.deepEqual(out.unavailable, [{ collection: "ehedaten", reason: "not_available" }]);
	assert.equal(out.hint, "Wortanfang-Hinweis.");
	assert.equal(out.note, FEDERATED_SEARCH_NOTE);
});

test("federatedSearchOutput: ein abgesuchter Bestand ohne Treffer steht mit 0 in totals", () => {
	const out = federatedSearchOutput("Lichtpause", [
		{ collection: "documents", total: 121, results: [{ collection: "documents", ranking: "keyword", id: "D1" }] },
		{ collection: "catalog", total: 34, results: [{ collection: "catalog", ranking: "keyword", id: "catalog:1" }] },
		{ collection: "ehedaten", total: 0, results: [] },
		{ collection: "editions", total: 0, results: [] },
	]) as Record<string, any>;
	// «Dort habe ich nachgesehen» ist für ein Modell eine Information: ohne sie schliesst es aus
	// einem Bestand ohne Treffer in der Liste auf «gibt es nicht».
	assert.deepEqual(out.totals, { catalog: 34, documents: 121, ehedaten: 0, editions: 0 });
	assert.equal(out.unavailable, undefined);
	assert.match(out.note, /eine 0 heisst/);
});

test("federatedSearchOutput: ohne jeden Treffer ein Hinweis, mit Treffern keiner", () => {
	const empty = federatedSearchOutput("xyzabc", [
		{ collection: "documents", total: 0, results: [] },
		{ collection: "catalog", total: 0, results: [] },
	]) as Record<string, any>;
	assert.match(empty.hint, /Kein Bestand hat einen Treffer/);
	assert.equal(empty.hint, FEDERATED_ZERO_HINT);
	// Kein Bestand abgefragt (alle ausgefallen): dann ist nichts «nicht gefunden».
	const down = federatedSearchOutput("x", [
		{ collection: "documents", total: null, results: [], unavailable: "failed" },
	]) as Record<string, any>;
	assert.equal(down.hint, undefined);
	assert.deepEqual(down.totals, {});
});

test("federatedFetchDoc: id mit Präfix, nackte Kennung in metadata, Form wie fetch", () => {
	const out = federatedFetchDoc("catalog", 669821, { title: "PLAN H 51 – Pause der Karte", text: "Signatur: PLAN H 51", url: "https://example.test/detail.aspx?ID=669821" }, {
		id: 669821,
		signature: "PLAN H 51",
	}) as Record<string, any>;
	assert.deepEqual(Object.keys(out), ["id", "title", "text", "url", "metadata"]);
	assert.equal(out.id, "catalog:669821");
	assert.equal(out.metadata.collection, "catalog");
	assert.equal(out.metadata.id, 669821);
});

test("leanCatalogResult: dieselbe schlanke Form wie catalog_search, ohne die Dateiliste", () => {
	const item = {
		id: 669821,
		signature: "PLAN H 51",
		title: "Pause der Karte",
		level: "Dokument",
		bestand: "PLAN H",
		fileCount: 2,
		hasDigitization: true,
		path: [{ id: 1, label: "Sammlungen", url: "…" }],
		files: [{ name: "a.jpg", url: "…", kind: "image" }],
		links: { web: "…" },
	};
	const lean = leanCatalogResult(item);
	assert.ok(!("path" in lean) && !("files" in lean), "Pfad-Array und Dateiliste fallen weg");
	// Zum Einordnen bleibt alles Übrige, inkl. der Zahl der Digitalisate.
	assert.equal(lean.fileCount, 2);
	assert.equal(lean.hasDigitization, true);
	assert.equal(lean.signature, "PLAN H 51");
	// Dieselbe Form wie catalog_search (leanCatalogItem): lesbarer Pfad, ohne links.
	assert.match(String(lean.pathText), /Sammlungen/);
	assert.equal(lean.links, undefined);
	// Das Original bleibt unberührt (catalog_search und fetch liefern den Pfad weiter).
	assert.equal(item.path.length, 1);
});

test("catalogFetchText: Kopfangaben, Archivplan und der Vermerk, dass der Katalog keinen Volltext hat", () => {
	const text = catalogFetchText({
		signature: "PLAN H 51",
		level: "Dokument",
		dateText: "1938",
		bestand: "Pläne",
		provenienz: null,
		path: ["Staatsarchiv", "Pläne", "PLAN H"],
		text: "Lichtpause der Karte.",
		fileCount: 2,
	});
	assert.match(text, /Signatur: PLAN H 51/);
	assert.match(text, /Stufe: Dokument/);
	assert.match(text, /Entstehungszeitraum: 1938/);
	assert.match(text, /Digitalisat: 2 Datei\(en\)/);
	assert.match(text, /Archivplan: Staatsarchiv › Pläne › PLAN H/);
	assert.match(text, /Lichtpause der Karte\./);
	assert.match(text, /keinen Volltext/);
	// Leere Angaben erzeugen keine leeren Zeilen.
	const sparse = catalogFetchText({ signature: "C I 1", title: "x" } as Parameters<typeof catalogFetchText>[0]);
	assert.doesNotMatch(sparse, /\n\n\n/);
	assert.match(sparse, /^Signatur: C I 1/);
});

test("ehedatenFetchText und editionFetchText: lesbare Texte aus den Angaben", () => {
	const ehe = ehedatenFetchText({
		title: "Meier, Hans, von Uster, getraut mit Müller, Anna",
		typeLabel: "Trauung",
		date: "12.05.1623",
		parish: "Uster",
		signature: "E III 125.1, EDB 42",
		notes: ["Witwer", null],
	});
	assert.match(ehe, /^Meier, Hans/);
	assert.match(ehe, /Trauung · 12\.05\.1623 · Kirchgemeinde Uster · Signatur E III 125\.1, EDB 42/);
	assert.match(ehe, /Zusatzinformation: Witwer/);
	const ed = editionFetchText({ regest: "Der Rat verbietet …", text: "Wir der Burgermeister …" });
	assert.match(ed, /^Regest: Der Rat verbietet …/);
	assert.match(ed, /Wir der Burgermeister …/);
	assert.equal(editionFetchText({ regest: null, text: "Nur Text" }), "Nur Text");
});

test("listTools: overview trägt query/series/dateFrom/dateTo/phrase/exact/field", () => {
	const ov = listTools().find((t) => t.name === "overview");
	assert.ok(ov);
	const props = (ov!.inputSchema as { properties: Record<string, unknown> }).properties;
	for (const k of ["query", "series", "dateFrom", "dateTo", "phrase", "exact", "field"]) {
		assert.ok(k in props, `overview.${k} vorhanden`);
	}
});

test("listTools: count_documents/timeline tragen field; keyword/list zusätzlich offset (MCP-Erweiterung)", () => {
	const byName = (n: string) =>
		(listTools().find((t) => t.name === n)!.inputSchema as { properties: Record<string, unknown> }).properties;
	assert.ok("field" in byName("count_documents"), "count_documents.field");
	assert.ok("field" in byName("timeline"), "timeline.field");
	for (const n of ["keyword_search", "list_documents"]) {
		assert.ok("field" in byName(n), `${n}.field`);
		assert.ok("offset" in byName(n), `${n}.offset`);
	}
});

test("listTools: passage_search/semantic_search tragen offset (Blättern statt topK erhöhen)", () => {
	const byName = (n: string) =>
		(listTools().find((t) => t.name === n)!.inputSchema as { properties: Record<string, { description?: string }> }).properties;
	const passage = byName("passage_search");
	assert.ok("offset" in passage, "passage_search.offset");
	// Enger gedeckeltes Fenster als bei den Dokument-Werkzeugen, mit Verweis dorthin.
	assert.match(passage.offset.description ?? "", new RegExp(String(PASSAGE_WINDOW_MAX)));
	assert.match(passage.offset.description ?? "", /keyword_search|list_documents/);
	assert.ok("offset" in byName("semantic_search"), "semantic_search.offset");
});

test("listTools: list_documents/count_documents/overview tragen alternatives (dieselbe Beschreibung wie keyword_search)", () => {
	const props = (n: string) =>
		(listTools().find((t) => t.name === n)!.inputSchema as { properties: Record<string, { description?: string }> }).properties;
	const desc = props("keyword_search").alternatives.description;
	assert.match(desc ?? "", /EIGENE Suche/, "ALTERNATIVES_DESC erklärt die eigene Suche je Variante");
	for (const n of ["list_documents", "count_documents", "overview", "timeline"]) {
		assert.ok("alternatives" in props(n), `${n}.alternatives`);
	}
	// Wiederverwendet, nicht neu geschrieben (timeline hat bewusst einen eigenen Text).
	for (const n of ["list_documents", "count_documents", "overview"]) {
		assert.equal(props(n).alternatives.description, desc, n);
	}
	// Die Zahlen mit Varianten erklären sich in der Werkzeug-Beschreibung.
	for (const n of ["count_documents", "overview"]) {
		assert.match(listTools().find((t) => t.name === n)!.description, /untere Grenze der Vereinigung/, n);
	}
});

test("listTools: keyword_search/count_documents/timeline/list_documents/overview nennen «alle Wörter»", () => {
	// aggregateSearch bzw. rankingSearch (keyword_search, auch sein total).
	for (const n of ["keyword_search", "count_documents", "timeline", "list_documents", "overview"]) {
		const t = listTools().find((x) => x.name === n);
		assert.ok(t, n);
		assert.match(t!.description, /ALLEN Wörtern der query \(Reihenfolge egal\)/, n);
	}
	// semantic_search rankt nach Bedeutung und verspricht das nicht.
	assert.doesNotMatch(listTools().find((x) => x.name === "semantic_search")!.description, /ALLEN Wörtern/);
});

test("listTools: keyword_search trägt alternatives + sort + phrase", () => {
	const kw = listTools().find((t) => t.name === "keyword_search");
	assert.ok(kw);
	const props = (kw!.inputSchema as { properties: Record<string, unknown> }).properties;
	assert.ok("alternatives" in props, "alternatives vorhanden");
	assert.ok("sort" in props, "sort vorhanden");
	assert.ok("phrase" in props, "phrase vorhanden");
	assert.ok("exact" in props, "exact vorhanden");
});

test("listTools: vector_search verlangt exakt 1024-dim vector, trägt limit, Beschreibung nennt Qwen3", () => {
	const vs = listTools().find((t) => t.name === "vector_search");
	assert.ok(vs);
	const schema = vs!.inputSchema as {
		properties: Record<string, { minItems?: number; maxItems?: number }>;
		required: string[];
	};
	assert.deepEqual(schema.required, ["vector"]);
	assert.equal(schema.properties.vector.minItems, 1024);
	assert.equal(schema.properties.vector.maxItems, 1024);
	assert.ok("limit" in schema.properties, "limit vorhanden");
	assert.ok(vs!.description.includes("Qwen3"), "Beschreibung nennt das Embedding-Modell");
	// Partner-Tool: LLM-Clients sollen auf passage_search verwiesen werden.
	assert.ok(vs!.description.includes("passage_search"), "Beschreibung verweist auf passage_search");
});

test("listTools: list_documents trägt limit + phrase, Beschreibung nennt fetch", () => {
	const ld = listTools().find((t) => t.name === "list_documents");
	assert.ok(ld);
	const props = (ld!.inputSchema as { properties: Record<string, unknown> }).properties;
	assert.ok("limit" in props, "limit vorhanden");
	assert.ok("phrase" in props, "phrase vorhanden");
	assert.ok("exact" in props, "exact vorhanden");
	assert.ok(ld!.description.includes("fetch"), "Beschreibung nennt fetch");
	assert.ok(!ld!.description.includes("get_document"), "Beschreibung nennt get_document NICHT");
});

// Die sechs lexikalischen Werkzeuge müssen exakt suchen KÖNNEN – ohne den
// Parameter bleibt Meilis Tippfehler-Toleranz unausweichlich (Prod 2026-11-17:
// «Pause» 8'066 statt 841 Dokumente vor #259, danach noch 3'017; Katalog 663 statt 83).
test("listTools: die sechs lexikalischen Werkzeuge tragen exact", () => {
	const tools = listTools();
	for (const n of ["keyword_search", "list_documents", "count_documents", "timeline", "overview", "catalog_search"]) {
		const t = tools.find((x) => x.name === n);
		assert.ok(t, n);
		const props = (t!.inputSchema as { properties: Record<string, unknown> }).properties;
		assert.ok("exact" in props, `${n}.exact vorhanden`);
		assert.equal((props.exact as { type: string }).type, "boolean", `${n}.exact ist boolean`);
	}
	// Werkzeuge ohne lexikalische Treffermenge bleiben ohne exact.
	for (const n of ["semantic_search", "passage_search", "vector_search", "search", "fetch", "similar_documents"]) {
		const props = (tools.find((x) => x.name === n)!.inputSchema as { properties: Record<string, unknown> }).properties;
		assert.ok(!("exact" in props), `${n} ohne exact`);
	}
});

test("listTools: exact nennt Mechanismus, Zahlen und die Gegenrichtung; phrase nennt das einzelne Wort", () => {
	const props = (listTools().find((t) => t.name === "count_documents")!.inputSchema as {
		properties: Record<string, { description: string }>;
	}).properties;
	// Tool-Beschreibungen sind der Prompt des fremden Modells: knapp, konkret, mit Zahlen.
	assert.match(props.exact.description, /Tippfehler-Toleranz/);
	assert.match(props.exact.description, /Wortanfang/);
	assert.match(props.exact.description, /exactTotal/);
	// Gegenseite: Meili stemmt kein Deutsch, exakt verliert Plurale ⇒ kein Default.
	assert.match(props.exact.description, /gestemmt/);
	assert.match(props.exact.description, /alternatives/);
	assert.match(props.exact.description, /kein Default/);
	// phrase=true ist bei einem Wort kein No-op mehr, und die Rangfolge steht dort.
	assert.match(props.phrase.description, /EINEM Wort/);
	assert.match(props.phrase.description, /gewinnt phrase/);
});

test("initialize: spiegelt angefragte protocolVersion, liefert serverInfo + capabilities.tools", async () => {
	const resp = await handleRpc(
		{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } },
		{ callTool: stubCall },
	);
	assert.ok(resp && "result" in resp);
	const r = resp!.result as Record<string, unknown>;
	assert.equal(r.protocolVersion, "2099-01-01", "angefragte Version zurückgespiegelt");
	assert.deepEqual(r.serverInfo, SERVER_INFO);
	const caps = r.capabilities as object;
	assert.ok(caps && typeof caps === "object" && "tools" in caps);
	assert.ok("resources" in caps, "capabilities.resources angekündigt");
	assert.ok("prompts" in caps, "capabilities.prompts angekündigt");
	assert.equal(r.instructions, SERVER_INSTRUCTIONS);
});

test("initialize: ohne protocolVersion → Server-Default", async () => {
	const resp = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, { callTool: stubCall });
	const r = (resp as { result: Record<string, unknown> }).result;
	assert.equal(r.protocolVersion, MCP_PROTOCOL_VERSION);
});

test("tools/list → { tools: [...16] }", async () => {
	const resp = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { callTool: stubCall });
	const r = (resp as { result: { tools: unknown[] } }).result;
	assert.equal(r.tools.length, 16);
});

test("prompts/list → der Prompt «recherche» mit Pflicht-Argument frage", async () => {
	const resp = await handleRpc({ jsonrpc: "2.0", id: 3, method: "prompts/list" }, { callTool: stubCall });
	const r = (resp as { result: { prompts: Array<{ name: string; arguments: Array<{ name: string; required: boolean }> }> } }).result;
	assert.deepEqual(r.prompts.map((p) => p.name), ["recherche"]);
	assert.deepEqual(r.prompts[0].arguments, [{ name: "frage", description: RESEARCH_PROMPT.arguments[0].description, required: true }]);
});

test("prompts/get recherche: eine Nutzer-Nachricht mit Arbeitsweise, Zitierregeln und der Frage", async () => {
	const resp = await handleRpc(
		{ jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "recherche", arguments: { frage: "Wann wurde die Tollwut bekämpft?" } } },
		{ callTool: stubCall },
	);
	const r = (resp as { result: { messages: Array<{ role: string; content: { type: string; text: string } }> } }).result;
	assert.equal(r.messages.length, 1);
	assert.equal(r.messages[0].role, "user");
	const text = r.messages[0].content.text;
	assert.match(text, /Frage: Wann wurde die Tollwut bekämpft\?$/);
	for (const needle of [/list_documents/, /timeline mit alternatives/, /verbindlich/, /Signatur \(stazhIdent\)/, /Erfinde nichts/]) assert.match(text, needle);
	assert.doesNotMatch(text, /—/, "kein Geviertstrich");
	assert.equal(researchPromptText("x").endsWith("Frage: x"), true);
});

test("prompts/get: unbekannter Prompt → -32602", async () => {
	const resp = await handleRpc({ jsonrpc: "2.0", id: 5, method: "prompts/get", params: { name: "nope" } }, { callTool: stubCall });
	assert.equal((resp as { error: { code: number } }).error.code, INVALID_PARAMS);
});

test("listTools: edition_search mit id und offset, Lizenz in der Beschreibung", () => {
	const t = listTools().find((x) => x.name === "edition_search");
	assert.ok(t);
	assert.deepEqual(t.annotations, { readOnlyHint: true, openWorldHint: false });
	const schema = t.inputSchema as { properties: Record<string, unknown>; required: readonly string[] };
	for (const k of ["query", "semantic", "edition", "person", "place", "keyword", "dateFrom", "dateTo", "sort", "topK", "id", "offset"]) {
		assert.ok(k in schema.properties, k);
	}
	assert.deepEqual([...schema.required], []);
	assert.doesNotMatch(t.description, /zitierbar|\[n\]|get_document/);
	assert.match(t.description, /CC BY 4\.0/);
	assert.match(t.description, /QZH_401/);
});

test("listTools: ehedaten_search mit offset, Lizenz und Namensvettern-Hinweis in der Beschreibung", () => {
	const t = listTools().find((x) => x.name === "ehedaten_search");
	assert.ok(t);
	assert.deepEqual(t.annotations, { readOnlyHint: true, openWorldHint: false });
	const schema = t.inputSchema as { properties: Record<string, unknown>; required: readonly string[] };
	for (const k of ["name", "braeutigam", "braut", "herkunft", "raum", "kirchgemeinde", "query", "dateFrom", "dateTo", "art", "groupBy", "sort", "topK", "offset"]) {
		assert.ok(k in schema.properties, k);
	}
	assert.deepEqual([...schema.required], []);
	assert.doesNotMatch(t.description, /zitierbar|\[n\]/);
	assert.match(t.description, /CC BY 4\.0/);
	assert.match(t.description, /Staatsarchiv des Kantons Zürich, Zürcher Ehedaten 16\.–18\. Jahrhundert, CC BY 4\.0/);
});

test("tools/call ehedaten_search: Argumente gehen unverändert an das Werkzeug", async () => {
	const resp = await handleRpc(
		{ jsonrpc: "2.0", id: 30, method: "tools/call", params: { name: "ehedaten_search", arguments: { name: "Heusser", groupBy: "kirchgemeinde", topK: 2 } } },
		{ callTool: stubCall },
	);
	const r = (resp as { result: Record<string, unknown> }).result;
	assert.equal(r.isError, false);
	assert.deepEqual(r.structuredContent, { echoed: "ehedaten_search", args: { name: "Heusser", groupBy: "kirchgemeinde", topK: 2 } });
});

test("tools/call: wickelt structuredContent + JSON-Text-content, isError=false", async () => {
	const resp = await handleRpc(
		{ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search", arguments: { query: "x" } } },
		{ callTool: stubCall },
	);
	const r = (resp as { result: Record<string, unknown> }).result;
	assert.equal(r.isError, false);
	const content = r.content as Array<{ type: string; text: string }>;
	assert.equal(content[0].type, "text");
	// content[0].text ist exakt JSON.stringify(structuredContent) (ChatGPT-Anforderung).
	assert.deepEqual(JSON.parse(content[0].text), r.structuredContent);
	assert.deepEqual(r.structuredContent, { echoed: "search", args: { query: "x" } });
});

test("tools/call: unbekanntes Tool → -32602", async () => {
	const resp = await handleRpc(
		{ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } },
		{ callTool: stubCall },
	);
	assert.equal((resp as { error: { code: number } }).error.code, INVALID_PARAMS);
});

test("tools/call: Tool-Laufzeitfehler → result mit isError=true (kein Protokollfehler)", async () => {
	const throwing: CallTool = async () => {
		throw new Error("boom");
	};
	const resp = await handleRpc(
		{ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "search", arguments: {} } },
		{ callTool: throwing },
	);
	const r = (resp as { result: Record<string, unknown> }).result;
	assert.equal(r.isError, true);
});

test("unbekannte Methode → -32601", async () => {
	const resp = await handleRpc({ jsonrpc: "2.0", id: 6, method: "does/not/exist" }, { callTool: stubCall });
	assert.equal((resp as { error: { code: number } }).error.code, METHOD_NOT_FOUND);
});

test("malformed (kein jsonrpc/method) mit id → -32600", async () => {
	const resp = await handleRpc({ id: 7, foo: "bar" }, { callTool: stubCall });
	assert.equal((resp as { error: { code: number } }).error.code, INVALID_REQUEST);
});

test("Nicht-Objekt → -32600 mit id null", async () => {
	const resp = await handleRpc("nope", { callTool: stubCall });
	assert.ok(resp && "error" in resp);
	assert.equal(resp!.id, null);
	assert.equal((resp as { error: { code: number } }).error.code, INVALID_REQUEST);
});

test("notifications/initialized (keine id) → keine Antwort (null)", async () => {
	const resp = await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, { callTool: stubCall });
	assert.equal(resp, null);
});

test("ping → leeres Ergebnis", async () => {
	const resp = await handleRpc({ jsonrpc: "2.0", id: 8, method: "ping" }, { callTool: stubCall });
	assert.deepEqual((resp as { result: unknown }).result, {});
});

// --- Resources ---------------------------------------------------------------

test("parseDocumentUri/documentUri: Round-Trip, dekodiert; Fremd-URI → null", () => {
	assert.equal(documentUri("MM_24_1"), "zszh://document/MM_24_1");
	assert.equal(parseDocumentUri("zszh://document/MM_24_1"), "MM_24_1");
	// Sonderzeichen in der id überleben Encode→Decode.
	const id = "OS 81 (S. 1/2)";
	assert.equal(parseDocumentUri(documentUri(id)), id);
	assert.equal(parseDocumentUri("zszh://document/"), null, "leere id → null");
	assert.equal(parseDocumentUri("http://example/x"), null, "fremdes Schema → null");
	assert.equal(parseDocumentUri(42), null, "Nicht-String → null");
});

test("resources/list → nur die Selbstbeschreibung (Dokumente über das Template)", async () => {
	const resp = await handleRpc({ jsonrpc: "2.0", id: 20, method: "resources/list" }, { callTool: stubCall });
	const resources = (resp as { result: { resources: Array<{ uri: string; name: string; mimeType: string }> } }).result.resources;
	assert.equal(resources.length, 1);
	assert.equal(resources[0].uri, COVERAGE_URI);
	assert.equal(resources[0].mimeType, "application/json");
	assert.ok(resources[0].name.length > 0);
});

test("resources/templates/list → Dokument-URI-Template", async () => {
	const resp = await handleRpc({ jsonrpc: "2.0", id: 21, method: "resources/templates/list" }, { callTool: stubCall });
	const tpls = (resp as { result: { resourceTemplates: Array<{ uriTemplate: string }> } }).result.resourceTemplates;
	assert.equal(tpls.length, 1);
	assert.equal(tpls[0].uriTemplate, "zszh://document/{id}");
});

test("resources/read: bekannte URI → contents", async () => {
	const resp = await handleRpc(
		{ jsonrpc: "2.0", id: 22, method: "resources/read", params: { uri: documentUri("DOC1") } },
		{ callTool: stubCall, readResource: stubRead },
	);
	const contents = (resp as { result: { contents: Array<{ uri: string; text: string }> } }).result.contents;
	assert.equal(contents.length, 1);
	assert.equal(contents[0].uri, documentUri("DOC1"));
	assert.match(contents[0].text, /Volltext/);
});

test("resources/read: unbekannte URI → INVALID_PARAMS", async () => {
	const resp = await handleRpc(
		{ jsonrpc: "2.0", id: 23, method: "resources/read", params: { uri: documentUri("NOPE") } },
		{ callTool: stubCall, readResource: stubRead },
	);
	assert.equal((resp as { error: { code: number } }).error.code, INVALID_PARAMS);
});

test("resources/read: fehlende uri → INVALID_PARAMS", async () => {
	const resp = await handleRpc(
		{ jsonrpc: "2.0", id: 24, method: "resources/read", params: {} },
		{ callTool: stubCall, readResource: stubRead },
	);
	assert.equal((resp as { error: { code: number } }).error.code, INVALID_PARAMS);
});

test("resources/read: ohne readResource-Dep → METHOD_NOT_FOUND", async () => {
	const resp = await handleRpc(
		{ jsonrpc: "2.0", id: 25, method: "resources/read", params: { uri: documentUri("DOC1") } },
		{ callTool: stubCall },
	);
	assert.equal((resp as { error: { code: number } }).error.code, METHOD_NOT_FOUND);
});

test("keyword_search mit alternatives: total = grösste Variante (untere Grenze), nicht die Seitenlänge", () => {
	const out = alternativesSearchOutput(["Tollwut", "Tollwuth", "Hundswuth"], [412, 1287, 35], ["a", "b", "c"]);
	assert.equal(out.count, 3);
	assert.equal(out.total, 1287);
	assert.equal(out.totalIsLowerBound, true);
	assert.deepEqual(out.totals, [
		{ term: "Tollwut", total: 412 },
		{ term: "Tollwuth", total: 1287 },
		{ term: "Hundswuth", total: 35 },
	]);
	assert.deepEqual(out.terms, ["Tollwut", "Tollwuth", "Hundswuth"]);
	assert.equal(alternativesSearchOutput(["a", "b"], [0, 0], []).total, 0);
});

test("alternativesCountOutput: total = grösste Variante, Verteilungen summiert, note warnt vor der Summe", () => {
	const out = alternativesCountOutput([
		{ term: "Tollwut", total: 412, bySeries: { RRB: 400, KRP: 12 }, byYear: { "1900": 12 } },
		{ term: "Tollwuth", total: 1287, bySeries: { RRB: 1280, ABl: 7 }, byYear: { "1900": 30, "1875": 5 } },
	]);
	assert.equal(out.total, 1287, "grösste Variante");
	assert.equal(out.totalIsLowerBound, true);
	assert.deepEqual(out.totals, [
		{ term: "Tollwut", total: 412 },
		{ term: "Tollwuth", total: 1287 },
	]);
	assert.deepEqual(out.terms, ["Tollwut", "Tollwuth"]);
	assert.deepEqual(out.bySeries, { RRB: 1680, KRP: 12, ABl: 7 }, "Verteilung summiert");
	assert.deepEqual(out.byYear, { "1900": 42, "1875": 5 });
	assert.match(out.note, /Summe der `totals` wäre zu gross/);
	assert.match(out.note, /`bySeries` und `byYear` sind/);
	// count_documents zählt keine Jahre: ohne byYear fehlt der Schlüssel ganz.
	const ohneJahre = alternativesCountOutput([
		{ term: "a", total: 3, bySeries: { OS: 3, RM: 0 } },
		{ term: "b", total: 1, bySeries: { OS: 1 } },
	]);
	assert.equal("byYear" in ohneJahre, false);
	assert.deepEqual(ohneJahre.bySeries, { OS: 4 }, "Nullwerte fallen weg");
	assert.match(ohneJahre.note, /`bySeries` ist/);
});

test("catalog_search: Name ohne Vergleichsschlüssel ist ein Fehler, unbekannte Stufe eine Warnung", () => {
	const nachname = mcpCatalogFilters({ query: "", person: "Heusser" });
	assert.ok("error" in nachname && nachname.error === "invalid_parameter" && /person/.test(nachname.message));
	const kuerzel = mcpCatalogFilters({ query: "Bahn", organization: "AG" });
	assert.ok("error" in kuerzel && /organization/.test(kuerzel.message));
	const ok = mcpCatalogFilters({ query: "", person: "Anna Meier", level: "dossier" });
	assert.ok(!("error" in ok));
	assert.deepEqual(ok.level, ["Dossier"]);
	assert.deepEqual(ok.entities.person, ["Anna Meier"]);
	assert.equal(ok.warning, undefined);
	const plan = mcpCatalogFilters({ query: "Rüti", level: "Plan" });
	assert.ok(!("error" in plan));
	assert.deepEqual(plan.level, []);
	assert.match(plan.warning ?? "", /Unbekannte Stufe «Plan» ignoriert/);
	assert.deepEqual(mcpCatalogFilters({ query: "x" }), { level: [], entities: { person: [], place: [], org: [] } });
});

test("rateLimitedRpc: tools/call als lesbares Werkzeug-Ergebnis, andere Methoden als JSON-RPC-Fehler, Notifications ohne Antwort", async () => {
	const { rateLimitedRpc, RATE_LIMITED } = await import("./mcp/protocol");
	const call = rateLimitedRpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "search" } }, 12, 300, 60)!;
	const r = call.result as { isError: boolean; structuredContent: { error: string; retryAfterS: number; message: string } };
	assert.equal(r.isError, true);
	assert.equal(r.structuredContent.error, "rate_limited");
	assert.equal(r.structuredContent.retryAfterS, 12);
	assert.match(r.structuredContent.message, /höchstens 300 Aufrufe in 60 s/);
	const list = rateLimitedRpc({ jsonrpc: "2.0", id: 8, method: "tools/list" }, 5, 300, 60)!;
	assert.equal(list.error?.code, RATE_LIMITED);
	assert.equal(rateLimitedRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, 5, 300, 60), null);
});

test("rpcLabel und hitCount: Methode, Werkzeug ohne Argumente, Trefferzahl je Ergebnisform", async () => {
	const { rpcLabel, hitCount } = await import("./mcp/protocol");
	assert.deepEqual(rpcLabel({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "passage_search", arguments: { query: "geheim" } } }), {
		method: "tools/call",
		tool: "passage_search",
	});
	assert.deepEqual(rpcLabel({ jsonrpc: "2.0", id: 1, method: "prompts/get", params: { name: "recherche" } }), { method: "prompts/get", prompt: "recherche" });
	assert.deepEqual(rpcLabel("x"), { method: "(invalid)" });
	assert.equal(hitCount({ results: [1, 2, 3] }), 3);
	assert.equal(hitCount({ documents: [1], notFound: [] }), 1);
	assert.equal(hitCount({ total: 42, bySeries: {} }), 42);
	assert.equal(hitCount({ total: 9, top: [1, 2] }), 9);
	assert.equal(hitCount({ piece: { id: "QZH_401" } }), 1);
	assert.equal(hitCount({ id: "x", text: "Volltext" }), 1);
	assert.equal(hitCount(null), undefined);
});

// --- coverage (Selbstbeschreibung) -------------------------------------------

test("yearRuns: zusammenhängende Jahre werden ein Lauf, Leerjahre trennen", () => {
	assert.deepEqual(yearRuns({ "1803": 5, "1804": 1, "1805": 2 }), [{ from: 1803, to: 1805 }]);
	// RRB-Fall: 1803–1995 und 2008–…, dazwischen die Digitalisierungslücke.
	assert.deepEqual(yearRuns({ "1995": 7, "2008": 3, "2009": 1 }), [
		{ from: 1995, to: 1995 },
		{ from: 2008, to: 2009 },
	]);
	assert.deepEqual(yearRuns({ "1900": 0, "1901": 4 }), [{ from: 1901, to: 1901 }], "Jahre ohne Dokumente zählen nicht");
	assert.deepEqual(yearRuns({ "1902": 1, "1900": 1 }), [{ from: 1900, to: 1900 }, { from: 1902, to: 1902 }], "unsortierte Facette");
	assert.deepEqual(yearRuns({}), []);
	assert.deepEqual(yearRuns(null), []);
	assert.deepEqual(yearRuns({ keinJahr: 3 }), [], "nicht-numerische Schlüssel");
});

test("gapLabel: die Jahre zwischen den Läufen, mit Halbgeviertstrich", () => {
	assert.equal(gapLabel([{ from: 1803, to: 1995 }, { from: 2008, to: 2026 }]), "1996–2007");
	assert.equal(
		gapLabel([{ from: 1484, to: 1515 }, { from: 1545, to: 1700 }, { from: 1702, to: 1798 }]),
		"1516–1544 und 1701",
		"mehrere Lücken, letzte mit «und»; Einzeljahr ohne Strich",
	);
	assert.equal(gapLabel([{ from: 1803, to: 2026 }]), null);
	assert.equal(gapLabel([]), null);
	// Teilstand mit vielen Löchern: nur die grössten, chronologisch, plus ihre Zahl.
	const streuung = [1550, 1552, 1600, 1602, 1700, 1702, 1790].map((y) => ({ from: y, to: y }));
	assert.equal(gapLabel(streuung), "1553–1599, 1603–1699 und 1703–1789 sowie 3 weitere Lücken");
	assert.equal(gapLabel(streuung, 1), "1603–1699 sowie 5 weitere Lücken");
});

// Live-Zahlen wie auf Prod (2026-11-17), damit der Bericht an echten Werten hängt.
const liveFixture: CoverageLive = {
	series: [
		{ abbr: "ABl", name: "Amtsblatt", description: "Amtliche Mitteilungen.", documents: 45218, years: { from: 1883, to: 2001 }, runs: [{ from: 1883, to: 2001 }] },
		{ abbr: "KRP", name: "Kantonsratsprotokolle", description: "Legislative.", documents: 57511, years: { from: 1803, to: 2026 }, runs: [{ from: 1803, to: 2026 }] },
		{ abbr: "OS", name: "Gesetzessammlung", description: "Kantonales Recht.", documents: 14652, years: { from: 1803, to: 2026 }, runs: [{ from: 1803, to: 2026 }] },
		{
			abbr: "RRB",
			name: "Regierungsratsbeschlüsse",
			description: "Exekutive.",
			documents: 504942,
			years: { from: 1803, to: 2026 },
			runs: [{ from: 1803, to: 1995 }, { from: 2008, to: 2026 }],
		},
		{
			abbr: "RM",
			name: "Ratsmanuale",
			description: "Ratssitzungen.",
			documents: 75179,
			years: { from: 1484, to: 1798 },
			runs: [{ from: 1484, to: 1515 }, { from: 1545, to: 1798 }],
		},
	],
	catalog: { units: 1263651 },
	ehedaten: { entries: 296293 },
	editions: { pieces: 1687, byEdition: { qzh: 790, ssrq: 897 } },
};

test("buildCoverage: alle fünf Bestände mit Umfang, Zeitspanne, Lücken, Suchart und Lizenz", () => {
	const report = buildCoverage(liveFixture);
	assert.deepEqual(report.collections.map((c) => c.id), ["serien", "rm", "catalog", "ehedaten", "editions"]);
	assert.equal(report.asOf, COVERAGE_AS_OF);
	for (const c of report.collections) {
		assert.ok(c.about.length > 20, `${c.id}: ein Satz dazu, was der Bestand ist`);
		assert.ok(c.years && c.years.length > 0, `${c.id}: Zeitspanne`);
		assert.ok(c.gaps.length > 0, `${c.id}: Lücken-Angabe`);
		assert.ok(Object.keys(c.search.byMode).length > 0 && c.search.note.length > 0, `${c.id}: Suche`);
		assert.ok(c.license.length > 0 && c.attribution.length > 0, `${c.id}: Lizenz und Nennung`);
		assert.equal(c.error, undefined, `${c.id}: kein Fehler bei lesbaren Quellen`);
		assert.equal(typeof c.count, "number", `${c.id}: Umfang live`);
	}

	const by = new Map(report.collections.map((c) => [c.id, c]));
	// Umfang: Summe der vier Serien; RM separat.
	assert.equal(by.get("serien")!.count, 45218 + 57511 + 14652 + 504942);
	assert.equal(by.get("serien")!.years, "1803–2026");
	assert.equal(by.get("rm")!.count, 75179);
	assert.equal(by.get("rm")!.years, "1484–1798");
	assert.equal(by.get("catalog")!.count, 1263651);
	assert.equal(by.get("ehedaten")!.count, 296293);
	assert.equal(by.get("ehedaten")!.years, "1524–1800");
	assert.equal(by.get("editions")!.count, 1687);
	assert.equal(by.get("editions")!.years, "1180–1800");

	// Lücken live aus den Jahresläufen, nicht als Konstante im Code.
	const serien = new Map(by.get("serien")!.parts!.map((p) => [p.id, p]));
	assert.match(serien.get("RRB")!.gaps!, /1996–2007/);
	assert.ok(!serien.get("KRP")!.gaps!.includes("Keine Dokumente"), "KRP durchgehend");
	assert.match(serien.get("ABl")!.gaps!, /1834/, "ABl: die Serie reicht über die digitalisierte Spanne hinaus");
	assert.equal(serien.get("ABl")!.count, 45218);
	assert.equal(serien.get("ABl")!.years, "1883–2001");
	assert.match(by.get("rm")!.gaps, /1516–1544/);

	// Suchart je Bestand: Ratsmanuale nur wörtlich, Katalog ohne Volltext.
	assert.deepEqual(Object.keys(by.get("rm")!.search.byMode), ["wörtlich"], "RM: keine Vektoren, keine Passagen");
	assert.deepEqual(Object.keys(by.get("ehedaten")!.search.byMode), ["wörtlich"]);
	assert.deepEqual(by.get("serien")!.search.byMode["Passagen"], ["passage_search"]);
	assert.ok(by.get("serien")!.search.byMode["wörtlich"].includes("count_documents"));
	assert.deepEqual(by.get("catalog")!.search.byMode["wörtlich"], ["catalog_search"]);
	assert.match(by.get("catalog")!.search.byMode["nach Bedeutung"][0], /semantic=true/);
	assert.match(by.get("catalog")!.gaps, /KEIN Volltext/);

	// Lizenzen, wo sie abweichen: Ehedaten CC BY, Katalog-Metadaten ohne Angabe, Editionen je Edition.
	assert.equal(by.get("serien")!.license, LICENSE);
	assert.equal(by.get("rm")!.license, LICENSE);
	assert.equal(by.get("ehedaten")!.license, EHEDATEN_LICENSE);
	assert.equal(by.get("ehedaten")!.attribution, EHEDATEN_ATTRIBUTION);
	assert.equal(by.get("catalog")!.license, "keine Lizenzangabe");
	const editionen = new Map(by.get("editions")!.parts!.map((p) => [p.id, p]));
	assert.equal(editionen.get("qzh")!.count, 790);
	assert.equal(editionen.get("ssrq")!.count, 897);
	assert.equal(editionen.get("qzh")!.license, EDITIONS.qzh.license);
	assert.equal(editionen.get("ssrq")!.attribution, EDITIONS.ssrq.attribution);
	assert.equal(editionen.get("qzh")!.images, EDITIONS.qzh.images!.label);
	assert.match(by.get("editions")!.license, /QZH/);

	// Hausregel: Halbgeviertstrich, nie Geviertstrich.
	// U+2014 als Escape, damit der Geviertstrich nicht einmal in der Quelle steht.
	assert.ok(!JSON.stringify(report).includes("\u2014"), "kein Geviertstrich im Bericht");
});

test("buildCoverage: fällt eine Quelle aus, antwortet der Bericht trotzdem", () => {
	const report = buildCoverage({ series: null, catalog: null, ehedaten: null, editions: null });
	assert.equal(report.collections.length, 5, "alle Bestände bleiben beschrieben");
	assert.deepEqual(
		report.collections.map((c) => c.error),
		["documents_unavailable", "documents_unavailable", "catalog_unavailable", "ehedaten_unavailable", "editions_unavailable"],
	);
	for (const c of report.collections) {
		assert.equal(c.count, null, `${c.id}: Umfang unbekannt statt erfunden`);
		assert.ok(c.about.length > 20 && c.gaps.length > 0 && Object.keys(c.search.byMode).length > 0, `${c.id}: Beschreibung bleibt`);
	}
	// Die Serien-Teile fehlen ganz (keine Platzhalter-Zahlen), die Editionen bleiben bekannt.
	assert.deepEqual(report.collections[0].parts, []);
	assert.deepEqual(report.collections[4].parts!.map((p) => p.count), [null, null]);

	// Nur eine Quelle weg: die übrigen Zahlen gelten weiter.
	const partial = buildCoverage({ ...liveFixture, catalog: null });
	const byPartial = new Map(partial.collections.map((c) => [c.id, c]));
	assert.equal(byPartial.get("catalog")!.error, "catalog_unavailable");
	assert.equal(byPartial.get("catalog")!.count, null);
	assert.equal(byPartial.get("ehedaten")!.count, 296293);
	assert.equal(byPartial.get("ehedaten")!.error, undefined);
});

test("coverage: tools/call ohne Argumente und resources/read liefern denselben Inhalt", async () => {
	const report = buildCoverage(liveFixture);
	// Beide Wege gehen über dieselbe Quelle (tools.ts: coverageData) – hier als Stub.
	const call: CallTool = async (name) => ({ structuredContent: name === "coverage" ? report : { error: "unexpected" } });
	const read: ReadResource = async (uri) =>
		uri === COVERAGE_URI ? { uri, mimeType: "application/json", text: JSON.stringify(report, null, 2) } : null;

	const tool = await handleRpc({ jsonrpc: "2.0", id: 30, method: "tools/call", params: { name: "coverage" } }, { callTool: call, readResource: read });
	const toolResult = (tool as { result: { structuredContent: unknown; isError: boolean } }).result;
	assert.equal(toolResult.isError, false);
	assert.deepEqual(toolResult.structuredContent, report);

	const res = await handleRpc({ jsonrpc: "2.0", id: 31, method: "resources/read", params: { uri: COVERAGE_URI } }, { callTool: call, readResource: read });
	const contents = (res as { result: { contents: Array<{ uri: string; mimeType: string; text: string }> } }).result.contents;
	assert.equal(contents[0].mimeType, "application/json");
	assert.deepEqual(JSON.parse(contents[0].text), report, "Ressource = Werkzeug-Inhalt");
});

// --- Schlanke Trefferform (mcp/lean.ts) --------------------------------------
// Die Projektionen bekommen hier Objekte in der Form, die die /api/v1-Mapper
// liefern (toListHit + url, toCatalogItem, toEhedatenItem, toEditionListItem);
// die Werte stammen aus echten Prod-Antworten vom 2026-11-17.

test("leanListHit: ohne links und dateYear neben date, ohne leere Felder, Score gerundet", async () => {
	const { leanListHit } = await import("./mcp/lean");
	const full = {
		id: "MM_3_9_RRB_1895_2061",
		series: "RRB",
		title: "Eisenbahn.",
		date: "1895-12-14",
		dateYear: 1895,
		volumeNr: null,
		serialNr: null,
		resolutionId: "1895/2061",
		startPg: null,
		stazhIdent: "StAZH MM 3.9 RRB 1895/2061",
		subset: null,
		excerpt: "…Vernehmlassungen der Eisenbahngesellschaften…",
		score: 0.8765432109876543,
		links: { self: "https://x/api/v1/documents/MM_3_9_RRB_1895_2061", web: "https://x/documents/RRB/MM_3_9_RRB_1895_2061" },
		url: "https://x/documents/RRB/MM_3_9_RRB_1895_2061",
	};
	const lean = leanListHit(full);
	assert.deepEqual(lean, {
		id: "MM_3_9_RRB_1895_2061",
		series: "RRB",
		title: "Eisenbahn.",
		date: "1895-12-14",
		resolutionId: "1895/2061",
		stazhIdent: "StAZH MM 3.9 RRB 1895/2061",
		excerpt: "…Vernehmlassungen der Eisenbahngesellschaften…",
		score: 0.8765,
		url: "https://x/documents/RRB/MM_3_9_RRB_1895_2061",
	});
	// Nie ein Feld, das die Allowlist nicht schon hatte (keine zweite Allowlist).
	for (const key of Object.keys(lean)) assert.ok(key in full, `unerwartetes Feld ${key}`);
});

test("leanListHit: undatierte Ratsmanual-Sitzung behält dateYear", async () => {
	const { leanListHit } = await import("./mcp/lean");
	const lean = leanListHit({ id: "RM_1552_0001_0003", series: "RM", title: "Sitzung", date: null, dateYear: 1552, volumeNr: 6, startPg: 3, score: null, url: "https://x/documents/RM/RM_1552_0001_0003" });
	assert.deepEqual(lean, { id: "RM_1552_0001_0003", series: "RM", title: "Sitzung", dateYear: 1552, volumeNr: 6, startPg: 3, url: "https://x/documents/RM/RM_1552_0001_0003" });
});

test("catalogPathText: Archivplan-Stufen ohne IDs, URLs, Zeiträume und Stufen", async () => {
	const { catalogPathText } = await import("./mcp/lean");
	const path = [
		{ id: 326413, label: "Sammlungen, 1347- (Hauptabteilung)", url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=326413" },
		{ id: 3017, label: "PLAN Karten und Pläne, 1600 (ca.)-2016 (Bestand)", url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=3017" },
		{ id: 315908, label: "PLAN H Ausland, 18. Jh.-1859 (Bestand)", url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=315908" },
	];
	assert.equal(catalogPathText(path), "Sammlungen › PLAN Karten und Pläne › PLAN H Ausland");
	// Etikett mit Kommas im Titel: nur das Datumsglied am Ende fällt weg.
	assert.equal(
		catalogPathText([{ id: 1, label: "Bühler, Besitzerfamilie des Oberhaushofs in Feldbach, von Hombrechtikon, 1551-2014 (ca.) (Bestand)" }]),
		"Bühler, Besitzerfamilie des Oberhaushofs in Feldbach, von Hombrechtikon",
	);
	assert.equal(catalogPathText([]), "");
	assert.equal(catalogPathText(undefined), "");
});

test("leanCatalogItem: pathText statt path, ohne links, Dokument auf id/series/relation", async () => {
	const { leanCatalogItem } = await import("./mcp/lean");
	const full = {
		id: 669821,
		signature: "[PLAN H 51]",
		title: "Pause der Karte des deutschen Südwestens am Ende des alten Reiches: Blatt 1",
		level: "Dokument",
		dateText: "1938",
		dateFrom: 1938,
		dateTo: 1938,
		bestand: "PLAN H Ausland, 18. Jh.-1859 (Bestand)",
		path: [
			{ id: 326413, label: "Sammlungen, 1347- (Hauptabteilung)", url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=326413" },
			{ id: 315908, label: "PLAN H Ausland, 18. Jh.-1859 (Bestand)", url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=315908" },
		],
		provenienz: null,
		hasDigitization: false,
		files: [],
		fileCount: 0,
		url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=669821",
		document: null,
		links: { self: "https://x/api/v1/catalog/669821", web: "https://x/archivkatalog/669821", catalog: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=669821" },
		excerpt: "Versetzt nach: StAZH Bib. Eh 27.36 (1-3) BD.",
	};
	assert.deepEqual(leanCatalogItem(full), {
		id: 669821,
		signature: "[PLAN H 51]",
		title: "Pause der Karte des deutschen Südwestens am Ende des alten Reiches: Blatt 1",
		level: "Dokument",
		dateText: "1938",
		bestand: "PLAN H Ausland, 18. Jh.-1859 (Bestand)",
		pathText: "Sammlungen › PLAN H Ausland",
		url: "https://suche.staatsarchiv.djiktzh.ch/detail.aspx?ID=669821",
		excerpt: "Versetzt nach: StAZH Bib. Eh 27.36 (1-3) BD.",
	});
	// Spannweite, die dateText nicht wiederholt, bleibt; Digitalisat und Dokument auch.
	const range = leanCatalogItem({
		...full,
		dateText: "1850 – 1870",
		dateFrom: 1850,
		dateTo: 1870,
		hasDigitization: true,
		files: [{ name: "Scan", url: "https://suche.staatsarchiv.djiktzh.ch/getimage.aspx?x=1", kind: "image" }],
		fileCount: 1,
		document: { id: "MM_1_1_RRB_1803_0001", series: "RRB", relation: "depicts", links: { self: "https://x/api/v1/documents/MM_1_1_RRB_1803_0001", web: "https://x/documents/RRB/MM_1_1_RRB_1803_0001" } },
	});
	assert.equal(range.dateFrom, 1850);
	assert.equal(range.dateTo, 1870);
	assert.equal(range.hasDigitization, true);
	assert.equal((range.files as unknown[]).length, 1);
	assert.equal("fileCount" in range, false, "fileCount ist nur die Länge von files");
	assert.deepEqual(range.document, { id: "MM_1_1_RRB_1803_0001", series: "RRB", relation: "depicts" });
	assert.equal("links" in range, false);
});

test("leanEhedatenItem: ohne typeLabel und links, Datum ohne Jahre, Personen ohne Vor-/Nachname", async () => {
	const { leanEhedatenItem } = await import("./mcp/lean");
	const lean = leanEhedatenItem({
		id: 1977577,
		signature: "E III 148.1, EDB 660",
		volume: "E III 148.1",
		entry: 660,
		page: "S. 344",
		source: "E III",
		parish: "Zollikon",
		type: "trauung",
		typeLabel: "Trauung",
		date: { text: "11.03.1662", from: "1662-03-11", to: "1662-03-11", yearFrom: 1662, yearTo: 1662, calendar: "julian" },
		groom: { firstName: "Felix", lastName: "Grebel", name: "Felix Grebel", origin: null, originNormalized: null, note: "Herr; Leutnant", hls: null, gnd: null },
		bride: { firstName: "Anna", lastName: "Hess", name: "Anna Hess", origin: null, originNormalized: null, note: null, hls: null, gnd: null },
		title: "Grebel, Felix, getraut mit Hess, Anna",
		uncertain: false,
		sameMarriage: {
			certainty: "certain",
			entries: [
				{
					id: 1977578,
					signature: "E III 1.1, EDB 12",
					parish: "Zürich",
					type: "verkuendung",
					typeLabel: "Verkündung",
					date: { text: "02.03.1662", from: "1662-03-02", to: "1662-03-02", yearFrom: 1662, yearTo: 1662, calendar: "julian" },
					links: { self: "https://x/api/v1/ehedaten/1977578", web: "https://x/archivkatalog/1977578", catalog: "https://archivkatalog.ji.zh.ch/detail.aspx?ID=1977578" },
				},
			],
		},
		url: "https://archivkatalog.ji.zh.ch/detail.aspx?ID=1977577",
		links: { self: "https://x/api/v1/ehedaten/1977577", web: "https://x/archivkatalog/1977577", catalog: "https://archivkatalog.ji.zh.ch/detail.aspx?ID=1977577" },
	});
	assert.equal("typeLabel" in lean, false);
	assert.equal("links" in lean, false);
	assert.equal("uncertain" in lean, false, "false fällt weg");
	assert.deepEqual(lean.date, { text: "11.03.1662", from: "1662-03-11", calendar: "julian" });
	assert.deepEqual(lean.groom, { name: "Felix Grebel", note: "Herr; Leutnant" });
	assert.deepEqual(lean.bride, { name: "Anna Hess" });
	assert.equal(lean.signature, "E III 148.1, EDB 660");
	assert.equal(lean.title, "Grebel, Felix, getraut mit Hess, Anna");
	assert.equal(lean.url, "https://archivkatalog.ji.zh.ch/detail.aspx?ID=1977577");
	const same = lean.sameMarriage as { certainty: string; entries: Array<Record<string, unknown>> };
	assert.equal(same.certainty, "certain");
	assert.deepEqual(same.entries[0], {
		id: 1977578,
		signature: "E III 1.1, EDB 12",
		parish: "Zürich",
		type: "verkuendung",
		date: { text: "02.03.1662", from: "1662-03-02", calendar: "julian" },
		url: "https://archivkatalog.ji.zh.ch/detail.aspx?ID=1977578",
	});
});

test("leanEditionItem/editionRights: Lizenz und Nennung am Stück, URLs einmal je Edition", async () => {
	const { leanEditionItem, editionRights } = await import("./mcp/lean");
	const lean = leanEditionItem({
		edition: "qzh",
		editionName: "Quellen zur Zürcher Geschichte",
		id: "QZH_779",
		label: "QZH_779",
		title: "Täufer in Horgen",
		part: "Quellen zur Geschichte der Täufer in der Schweiz, Bd. 5",
		date: { text: "Oktober 1608", from: "1608-10-01", to: "1608-10-31", yearFrom: 1608, yearTo: 1608 },
		signature: "StAZH E I 7.3, Nr. 127",
		keywords: ["Täufertum"],
		hasFacsimile: true,
		excerpt: null,
		url: "https://qzh.sources-online.org/quellenstuecke/QZH_779",
		license: "CC BY 4.0",
		licenseUrl: "https://creativecommons.org/licenses/by/4.0/deed.de",
		attribution: "Staatsarchiv des Kantons Zürich, Quellen zur Zürcher Geschichte (QZH)",
		imagesLicense: "gemeinfrei",
		imagesLicenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/deed.de",
		links: { self: "https://x/api/v1/editions/qzh/QZH_779", web: "https://x/editionen/qzh/QZH_779", edition: "https://qzh.sources-online.org/quellenstuecke/QZH_779", iiifManifest: "https://x/editionen/qzh/QZH_779/manifest.json" },
	});
	assert.equal(lean.license, "CC BY 4.0");
	assert.equal(lean.attribution, "Staatsarchiv des Kantons Zürich, Quellen zur Zürcher Geschichte (QZH)");
	assert.equal(lean.imagesLicense, "gemeinfrei");
	assert.equal(lean.url, "https://qzh.sources-online.org/quellenstuecke/QZH_779");
	for (const gone of ["editionName", "licenseUrl", "imagesLicenseUrl", "links", "excerpt"]) assert.equal(gone in lean, false, gone);
	assert.deepEqual(lean.date, { text: "Oktober 1608", from: "1608-10-01", to: "1608-10-31" });
	const rights = editionRights(["qzh", "ssrq", "qzh", "unbekannt"]) as Record<string, Record<string, string>>;
	assert.deepEqual(Object.keys(rights), ["qzh", "ssrq"], "je Edition einmal, Unbekanntes weg");
	assert.equal(rights.qzh.license, "CC BY 4.0");
	assert.equal(rights.qzh.licenseUrl, "https://creativecommons.org/licenses/by/4.0/deed.de");
	assert.equal(rights.qzh.imagesLicense, "gemeinfrei");
	assert.ok(rights.ssrq.attribution.length > 0);
	assert.equal("imagesLicense" in rights.ssrq, false, "Rechtsquellen ohne Angabe zu den Bildern");
});

test("MCP-Hinweise: knapper als die /api/v1-Fassung, Vorbehalte und Lizenzpflicht bleiben", async () => {
	const { MCP_CATALOG_NOTE, MCP_EHEDATEN_NOTE, MCP_EDITIONS_NOTE } = await import("./mcp/lean");
	const { CATALOG_NOTE, EHEDATEN_NOTE, EDITIONS_NOTE } = await import("./apiV1/constants");
	for (const [lean, long] of [
		[MCP_CATALOG_NOTE, CATALOG_NOTE],
		[MCP_EHEDATEN_NOTE, EHEDATEN_NOTE],
		[MCP_EDITIONS_NOTE, EDITIONS_NOTE],
	] as const) {
		assert.ok(lean.length < long.length, "knapper als /api/v1");
	}
	assert.match(MCP_CATALOG_NOTE, /Signatur und Permalink/);
	assert.match(MCP_EHEDATEN_NOTE, /julianisch/);
	assert.match(MCP_EHEDATEN_NOTE, /Einträge, nicht Ehen/);
	assert.match(MCP_EHEDATEN_NOTE, /attribution/);
	assert.match(MCP_EDITIONS_NOTE, /license und attribution stehen an jedem Stück/);
	assert.match(MCP_EDITIONS_NOTE, /alter Stil, nicht umgerechnet/);
});

test("Schema: catalog_search, ehedaten_search und edition_search kennen verbose", () => {
	for (const name of ["catalog_search", "ehedaten_search", "edition_search"]) {
		const tool = listTools().find((t) => t.name === name);
		const props = (tool?.inputSchema as { properties: Record<string, { type: string; description: string }> }).properties;
		assert.equal(props.verbose?.type, "boolean", `${name} braucht verbose`);
		// Die Formregeln stehen EINMAL im Schema (tools/list), nicht in jeder Antwort.
		assert.match(props.verbose.description, /LEERE FELDER FEHLEN/);
		assert.match(props.verbose.description, /pathText/);
	}
	// Die Dokument-Werkzeuge bleiben ohne verbose: schlank fallen dort nur die
	// /api/v1-Links, das doppelte url und leere Felder weg – den Volltext holt fetch.
	const keyword = listTools().find((t) => t.name === "keyword_search");
	assert.equal("verbose" in (keyword?.inputSchema as { properties: Record<string, unknown> }).properties, false);
});

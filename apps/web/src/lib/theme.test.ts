// Lauf: npx tsx --test src/lib/theme.test.ts
// Kontraste der Farbtokens aus app.css (WCAG 2.2 AA): Text ≥ 4.5 : 1, Bedienelemente ≥ 3 : 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
const stamp = readFileSync(new URL("./components/PrototypeStamp.svelte", import.meta.url), "utf8");

function token(name: string): string {
	const m = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css);
	assert.ok(m, `Token --color-${name} fehlt in app.css`);
	return m[1];
}
function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
}
function atLeast(min: number, fg: string, bg: string, what: string) {
	const c = contrast(fg, bg);
	assert.ok(c >= min, `${what}: ${fg} auf ${bg} = ${c.toFixed(2)}, nötig ${min}`);
}

const z = (n: number) => token(`zszh-${n}`);
const WHITE = "#ffffff";

test("Rechnung stimmt an bekannten Werten", () => {
	assert.equal(contrast("#000000", WHITE).toFixed(1), "21.0");
	assert.equal(contrast("#767676", WHITE).toFixed(2), "4.54");
});

test("Text auf hellem Grund", () => {
	for (const bg of [WHITE, z(50)]) {
		for (const n of [400, 500, 600, 700, 800, 900]) atLeast(4.5, z(n), bg, `zszh-${n}`);
		for (const n of [600, 700]) atLeast(4.5, token(`accent-${n}`), bg, `accent-${n}`);
		atLeast(4.5, token("accent-500"), bg, "accent-500");
	}
	for (const n of [500, 600, 700, 800, 900]) atLeast(4.5, z(n), z(100), `zszh-${n} auf 100`);
	atLeast(4.5, token("accent-600"), z(100), "accent-600 auf 100");
});

test("Schrift auf Knöpfen und auf Dunkel", () => {
	for (const fg of [WHITE, z(50)]) for (const n of [500, 600, 700]) atLeast(4.5, fg, token(`accent-${n}`), `Knopf accent-${n}`);
	for (const n of [50, 100, 200]) atLeast(4.5, z(n), z(900), `zszh-${n} auf 900`);
	atLeast(3, token("line"), z(900), "Linie im Kopf");
	const ink = /color:\s*(#[0-9a-f]{6});\s*border: 5px double/i.exec(stamp);
	assert.ok(ink, "Stempelfarbe in PrototypeStamp.svelte");
	atLeast(4.5, ink[1], z(900), "Stempel");
});

test("Aussetzer des Stempels in der Farbe des Kopfs", () => {
	const m = /feColorMatrix values='0 0 0 0 ([\d.]+)\s+0 0 0 0 ([\d.]+)\s+0 0 0 0 ([\d.]+)/.exec(stamp);
	assert.ok(m, "feColorMatrix in PrototypeStamp.svelte");
	const kopf = [1, 3, 5].map((i) => Number.parseInt(z(900).slice(i, i + 2), 16));
	assert.deepEqual(m.slice(1, 4).map((v) => Math.round(Number(v) * 255)), kopf);
});

test("Hervorhebung von Treffern", () => {
	const mark = /\n\tmark \{\s*background-color: (#[0-9a-f]{6})/i.exec(css)?.[1];
	assert.ok(mark, "mark-Farbe in app.css");
	for (const fg of [z(600), z(700), z(900), token("accent-600"), token("accent-700")]) atLeast(4.5, fg, mark, "mark");
});

test("Felder der Oberfläche nutzen einen Rand ab zszh-300", () => {
	const src = fileURLToPath(new URL("../", import.meta.url));
	const tag = /<(?:input|textarea|select)\b(?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})*>/g;
	let found = 0;
	for (const f of readdirSync(src, { recursive: true, encoding: "utf8" })) {
		if (!f.endsWith(".svelte")) continue;
		for (const [field] of readFileSync(join(src, f), "utf8").matchAll(tag)) {
			found++;
			assert.doesNotMatch(field, /(?<![\w-])border-zszh-(?:50|100|200)\b/, `${f}: Feldrand heller als zszh-300`);
		}
	}
	assert.ok(found > 20, `nur ${found} Felder gefunden`);
});

test("Ränder von Feldern und Knöpfen, Balken der Zeitleiste", () => {
	for (const bg of [WHITE, z(50)]) {
		atLeast(3, z(300), bg, "Rand zszh-300");
		atLeast(3, token("accent-500"), bg, "accent-500");
	}
});

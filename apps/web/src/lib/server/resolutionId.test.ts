import test from "node:test";
import assert from "node:assert/strict";
import { resolutionIdCandidates } from "./resolutionId";

test("resolutionIdCandidates: ein getippte Ziffer → 1000 IDs des Tausenders", () => {
	const r = resolutionIdCandidates("1958/4");
	assert.ok(r);
	assert.equal(r.year, 1958);
	assert.equal(r.ids.length, 1000);
	assert.equal(r.ids[0], "1958/4000");
	assert.equal(r.ids.at(-1), "1958/4999");
	assert.ok(r.ids.includes("1958/4023"));
});

test("resolutionIdCandidates: zwei Ziffern → 100 IDs", () => {
	const r = resolutionIdCandidates("1958/40");
	assert.ok(r);
	assert.equal(r.ids.length, 100);
	assert.equal(r.ids[0], "1958/4000");
	assert.equal(r.ids.at(-1), "1958/4099");
	assert.ok(r.ids.includes("1958/4023"));
});

test("resolutionIdCandidates: drei Ziffern → 10 IDs", () => {
	const r = resolutionIdCandidates("1958/402");
	assert.ok(r);
	assert.deepEqual(r.ids, [
		"1958/4020",
		"1958/4021",
		"1958/4022",
		"1958/4023",
		"1958/4024",
		"1958/4025",
		"1958/4026",
		"1958/4027",
		"1958/4028",
		"1958/4029",
	]);
});

test("resolutionIdCandidates: volle Nummer → genau eine ID", () => {
	const r = resolutionIdCandidates("1958/4023");
	assert.ok(r);
	assert.deepEqual(r.ids, ["1958/4023"]);
});

test("resolutionIdCandidates: führende Null im Nummern-Teil bleibt erhalten", () => {
	assert.deepEqual(resolutionIdCandidates("1958/04")?.ids.slice(0, 2), [
		"1958/0400",
		"1958/0401",
	]);
	assert.deepEqual(resolutionIdCandidates("1958/004")?.ids, [
		"1958/0040",
		"1958/0041",
		"1958/0042",
		"1958/0043",
		"1958/0044",
		"1958/0045",
		"1958/0046",
		"1958/0047",
		"1958/0048",
		"1958/0049",
	]);
});

test("resolutionIdCandidates: null ohne Slash+Ziffer, bei >4 Ziffern, Suffix oder Müll", () => {
	assert.equal(resolutionIdCandidates("1958"), null);
	assert.equal(resolutionIdCandidates("1958/"), null);
	assert.equal(resolutionIdCandidates("1958/40235"), null);
	assert.equal(resolutionIdCandidates("1848/0001a"), null);
	assert.equal(resolutionIdCandidates("abc/4"), null);
	assert.equal(resolutionIdCandidates(""), null);
});

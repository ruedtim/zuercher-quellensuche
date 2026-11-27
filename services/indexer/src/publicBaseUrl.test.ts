import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  isLocalHostname,
  isLocalUrl,
  LOCAL_DEV_BASE_URL,
  resolvePublicBaseUrl,
} from "./publicBaseUrl.ts";

const strict = { allowLocal: false };
const optIn = { allowLocal: true };

test("resolvePublicBaseUrl: öffentliche Basis, abschliessender Slash entfernt", () => {
  assert.equal(resolvePublicBaseUrl("https://zentraleserien.ch", strict), "https://zentraleserien.ch");
  assert.equal(resolvePublicBaseUrl(" https://zentraleserien.ch/ ", strict), "https://zentraleserien.ch");
  assert.equal(resolvePublicBaseUrl("https://example.org/zszh//", strict), "https://example.org/zszh");
});

test("resolvePublicBaseUrl: fehlend/leer bricht ab, Opt-in fällt auf den Dev-Server zurück", () => {
  assert.throws(() => resolvePublicBaseUrl(undefined, strict), /PUBLIC_BASE_URL fehlt/);
  assert.throws(() => resolvePublicBaseUrl("  ", strict), /PUBLIC_BASE_URL fehlt/);
  assert.equal(resolvePublicBaseUrl(undefined, optIn), LOCAL_DEV_BASE_URL);
});

test("resolvePublicBaseUrl: lokale Hosts nur mit Opt-in", () => {
  for (const base of [
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://[::1]:5173",
    "http://0.0.0.0",
    "http://zszh.localhost",
  ]) {
    assert.throws(() => resolvePublicBaseUrl(base, strict), /lokalen Host/, base);
    assert.equal(resolvePublicBaseUrl(base, optIn), base);
  }
});

test("resolvePublicBaseUrl: keine URL bzw. kein http(s) bricht auch mit Opt-in ab", () => {
  assert.throws(() => resolvePublicBaseUrl("zentraleserien.ch", optIn), /keine gültige URL/);
  assert.throws(() => resolvePublicBaseUrl("ftp://zentraleserien.ch", optIn), /http\(s\)/);
});

test("isLocalHostname: nur Loopback/localhost, keine Lookalikes", () => {
  assert.ok(isLocalHostname("LOCALHOST"));
  assert.ok(isLocalHostname("127.0.1.1"));
  assert.ok(!isLocalHostname("localhost.example.org"));
  assert.ok(!isLocalHostname("127.example.org"));
  assert.ok(!isLocalHostname("zentraleserien.ch"));
});

test("isLocalUrl: Manifest-URLs aus dem Index", () => {
  assert.ok(isLocalUrl("http://localhost:5173/iiif/ABl/ABl_1930__S__1-3_/manifest.json"));
  assert.ok(!isLocalUrl("https://zentraleserien.ch/iiif/ABl/ABl_1930__S__1-3_/manifest.json"));
  assert.ok(!isLocalUrl("https://zszh.sources-online.org/manifests/KRP/x/info.json"));
  assert.ok(!isLocalUrl("/iiif/ABl/x/manifest.json"));
});

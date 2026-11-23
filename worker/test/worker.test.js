// node --test sharing/worker/test  (no Cloudflare needed: KV is faked in memory)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import worker, { validate } from "../src/index.js";

const EX = JSON.parse(readFileSync(new URL("../../format/examples.json", import.meta.url)));

function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k).v : null; },
    async put(k, v, o = {}) { m.set(k, { v, meta: o.metadata }); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) {
      return { keys: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.meta })), list_complete: true };
    },
  };
}
const req = (method, path, body, headers = {}) =>
  new Request("https://share.example" + path, { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers } });
const RL = { limit: async () => ({ success: true }) };
const sha = s => createHash("sha256").update(s).digest("hex");

test("validate accepts the examples and refuses anything identifying or too precise", () => {
  for (const r of EX.valid) assert.equal(validate(r), null);
  for (const [change, why] of EX.invalid) assert.match(validate({ ...EX.valid[0], ...change }) || "", new RegExp(why));
});

test("upload, released, deleted", async () => {
  const env = { COOKS: fakeKV(), RL };
  const rec = EX.valid[0], key = "secret-delete-key";
  let r = await worker.fetch(req("POST", "/v1/cooks", { record: rec, key_hash: sha(key), test: true }), env);
  assert.equal(r.status, 202);
  assert.equal(env.COOKS.m.size, 0, "test uploads store nothing");
  r = await worker.fetch(req("POST", "/v1/cooks", { record: rec, key_hash: sha(key) }), env);
  assert.equal(r.status, 201);
  // Stored: the record only (no IP, no time received), plus the key's hash.
  const c = env.COOKS.m.get("c:" + rec.id);
  assert.deepEqual(Object.keys(c.meta), ["r"]);
  assert.equal(env.COOKS.m.get("k:" + rec.id).v, sha(key));
  let rel = await (await worker.fetch(req("GET", "/v1/released"), env)).json();
  assert.deepEqual(rel.records, [rec]);
  // Same id again: refused.
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: rec, key_hash: sha(key) }), env)).status, 409);
  // Deletion needs the key.
  assert.equal((await worker.fetch(req("DELETE", "/v1/cooks/" + rec.id, undefined, { "x-delete-key": "wrong" }), env)).status, 403);
  assert.equal((await worker.fetch(req("DELETE", "/v1/cooks/" + rec.id, undefined, { "x-delete-key": key }), env)).status, 200);
  env.COOKS.m.delete("s:released");  // the next day's snapshot
  rel = await (await worker.fetch(req("GET", "/v1/released"), env)).json();
  assert.deepEqual(rel.records, []);
  assert.deepEqual(rel.deleted, [rec.id]);
  // A deleted id can't be re-uploaded.
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: rec, key_hash: sha(key) }), env)).status, 409);
});

test("refuses bad uploads", async () => {
  const env = { COOKS: fakeKV(), RL };
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: { ...EX.valid[0], note: "x" }, key_hash: sha("k") }), env)).status, 400);
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: EX.valid[0], key_hash: "short" }), env)).status, 400);
  assert.equal((await worker.fetch(new Request("https://share.example/v1/cooks", { method: "POST", body: "x".repeat(5000), headers: { "content-type": "application/json" } }), env)).status, 413);
  // Not JSON (a cross-site form or no-cors fetch): refused before anything is read.
  assert.equal((await worker.fetch(new Request("https://share.example/v1/cooks", { method: "POST", body: JSON.stringify({ record: EX.valid[0], key_hash: sha("k") }), headers: { "content-type": "text/plain" } }), env)).status, 415);
  // No rate limiter configured: uploads are refused (fails closed).
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: EX.valid[0], key_hash: sha("k") }), { COOKS: fakeKV() })).status, 503);
  // Names that exist on every object aren't fields.
  for (const k of ["constructor", "toString", "hasOwnProperty"])
    assert.match(validate({ ...EX.valid[0], [k]: "my name and address" }) || "", /unexpected field/);
  assert.match(validate(JSON.parse(JSON.stringify(EX.valid[0]).replace("{", '{"__proto__":"x",'))) || "", /unexpected field/);
  assert.equal((await worker.fetch(req("GET", "/nope"), env)).status, 404);
  const limited = { COOKS: fakeKV(), RL: { limit: async () => ({ success: false }) } };
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: EX.valid[0], key_hash: sha("k") }), limited)).status, 429);
});

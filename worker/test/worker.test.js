// node --test sharing/worker/test  (no Cloudflare needed: KV is faked in memory)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import worker, { validate, clientKey, DailyCap, DAILY_CAP } from "../src/index.js";

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
// The DailyCap Durable Object, run for real over an in-memory storage (one instance: the global counter). Requests
// are handled one at a time, as a Durable Object's input gates do while it waits on its storage.
function fakeCap() {
  const store = new Map();
  const tick = () => new Promise(r => setTimeout(r, 0));  // storage calls really are asynchronous
  const obj = new DailyCap({ storage: { async get(k) { await tick(); return store.get(k); }, async put(k, v) { await tick(); store.set(k, structuredClone(v)); } } });
  let gate = Promise.resolve();
  return {
    store,
    idFromName: name => ({ name }),
    get: id => ({
      fetch: (u, init) => {
        assert.equal(id.name, "global");
        const run = gate.then(() => obj.fetch(new Request(u, init)));
        gate = run.catch(() => {});
        return run;
      },
    }),
  };
}
const envOK = (extra = {}) => ({ COOKS: fakeKV(), RL, RL_UPLOAD: RL, CAP: fakeCap(), ...extra });
const rec32 = i => ({ ...EX.valid[0], id: i.toString(16).padStart(32, "0") });
const sha = s => createHash("sha256").update(s).digest("hex");

test("validate accepts the examples and refuses anything identifying or too precise", () => {
  for (const r of EX.valid) assert.equal(validate(r), null);
  for (const [change, why] of EX.invalid) assert.match(validate({ ...EX.valid[0], ...change }) || "", new RegExp(why));
});

test("upload, released, deleted", async () => {
  const env = envOK();
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
  // Deleting again (e.g. a retry whose reply was lost) is fine.
  const again = await worker.fetch(req("DELETE", "/v1/cooks/" + rec.id, undefined, { "x-delete-key": key }), env);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).already, true);
  // Never stored: 404.
  assert.equal((await worker.fetch(req("DELETE", "/v1/cooks/" + "f".repeat(32), undefined, { "x-delete-key": key }), env)).status, 404);
  // A deleted id can't be re-uploaded.
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: rec, key_hash: sha(key) }), env)).status, 409);
});

test("refuses bad uploads", async () => {
  const env = envOK();
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: { ...EX.valid[0], note: "x" }, key_hash: sha("k") }), env)).status, 400);
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: EX.valid[0], key_hash: "short" }), env)).status, 400);
  assert.equal((await worker.fetch(new Request("https://share.example/v1/cooks", { method: "POST", body: "x".repeat(5000), headers: { "content-type": "application/json" } }), env)).status, 413);
  // Not JSON (a cross-site form or no-cors fetch): refused before anything is read.
  assert.equal((await worker.fetch(new Request("https://share.example/v1/cooks", { method: "POST", body: JSON.stringify({ record: EX.valid[0], key_hash: sha("k") }), headers: { "content-type": "text/plain" } }), env)).status, 415);
  // No rate limiter or daily counter configured: uploads are refused (fails closed).
  for (const missing of ["RL", "RL_UPLOAD", "CAP"])
    assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: EX.valid[0], key_hash: sha("k") }), envOK({ [missing]: undefined }))).status, 503);
  // The counter failing: refused too, nothing stored.
  const broken = envOK({ CAP: { idFromName: () => ({}), get: () => ({ fetch: async () => { throw new Error("down"); } }) } });
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: EX.valid[0], key_hash: sha("k") }), broken)).status, 503);
  assert.equal(broken.COOKS.m.size, 0);
  // Names that exist on every object aren't fields.
  for (const k of ["constructor", "toString", "hasOwnProperty"])
    assert.match(validate({ ...EX.valid[0], [k]: "my name and address" }) || "", /unexpected field/);
  assert.match(validate(JSON.parse(JSON.stringify(EX.valid[0]).replace("{", '{"__proto__":"x",'))) || "", /unexpected field/);
  assert.equal((await worker.fetch(req("GET", "/nope"), env)).status, 404);
  const no = { limit: async () => ({ success: false }) };
  for (const limited of [envOK({ RL: no }), envOK({ RL_UPLOAD: no })]) {
    assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: EX.valid[0], key_hash: sha("k") }), limited)).status, 429);
    assert.equal(limited.COOKS.m.size, 0);
  }
  // A test upload isn't held back by the store limit (it stores nothing).
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: EX.valid[0], key_hash: sha("k"), test: true }), envOK({ RL_UPLOAD: no }))).status, 202);
});

test("the daily cap is one count for the whole service, per UTC day, and fails closed", async () => {
  const env = envOK();
  for (let i = 0; i < DAILY_CAP; i++)
    assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: rec32(i + 1), key_hash: sha("k" + i) }), env)).status, 201);
  const r = await worker.fetch(req("POST", "/v1/cooks", { record: rec32(DAILY_CAP + 1), key_hash: sha("k") }), env);
  assert.equal(r.status, 503);
  assert.equal(env.COOKS.m.has("c:" + rec32(DAILY_CAP + 1).id), false);
  // A duplicate doesn't use up the allowance (409 before counting).
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: rec32(1), key_hash: sha("k0") }), env)).status, 409);
  // A new day starts again.
  const [entry] = env.CAP.store.values();
  assert.equal(entry.n, DAILY_CAP);
  env.CAP.store.set("count", { day: "2000-01-01", n: DAILY_CAP });
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: rec32(DAILY_CAP + 1), key_hash: sha("k") }), env)).status, 201);
  assert.equal(env.CAP.store.get("count").n, 1);
});

test("concurrent uploads can't overshoot the cap", async () => {
  const env = envOK();
  env.CAP.store.set("count", { day: new Date().toISOString().slice(0, 10), n: DAILY_CAP - 3 });
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    worker.fetch(req("POST", "/v1/cooks", { record: rec32(500 + i), key_hash: sha("c" + i) }), env)));
  assert.equal(rs.filter(r => r.status === 201).length, 3);
  assert.equal(env.CAP.store.get("count").n, DAILY_CAP);
});

test("the deletion key's hash doesn't expire", async () => {
  const env = envOK();
  const puts = [];
  const put = env.COOKS.put;
  env.COOKS.put = async (k, v, o = {}) => { puts.push([k, o]); return put(k, v, o); };
  assert.equal((await worker.fetch(req("POST", "/v1/cooks", { record: EX.valid[0], key_hash: sha("k") }), env)).status, 201);
  const [, opts] = puts.find(([k]) => k.startsWith("k:"));
  assert.equal(opts.expiration, undefined);
  assert.equal(opts.expirationTtl, undefined);
});

test("rate limits count an IPv6 /64 as one sender, an IPv4 address whole", async () => {
  assert.equal(clientKey("203.0.113.7"), "203.0.113.7");
  assert.equal(clientKey("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(clientKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
  assert.equal(clientKey("2001:0db8:0001:0002::1"), "2001:db8:1:2::/64");
  assert.equal(clientKey("2001:DB8:1:2::ffff"), "2001:db8:1:2::/64");
  assert.equal(clientKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(clientKey("::1"), "0:0:0:0::/64");
  assert.equal(clientKey(""), "x");
  assert.equal(clientKey(null), "x");
  const keys = [];
  const env = envOK({ RL_UPLOAD: { limit: async ({ key }) => { keys.push(key); return { success: true }; } } });
  await worker.fetch(req("POST", "/v1/cooks", { record: rec32(1), key_hash: sha("a") }, { "cf-connecting-ip": "2001:db8:1:2::1" }), env);
  await worker.fetch(req("POST", "/v1/cooks", { record: rec32(2), key_hash: sha("b") }, { "cf-connecting-ip": "2001:db8:1:2:ffff::9" }), env);
  assert.deepEqual(keys, ["2001:db8:1:2::/64", "2001:db8:1:2::/64"]);
});

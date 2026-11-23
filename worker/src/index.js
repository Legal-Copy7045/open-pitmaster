import { SITE } from "./site.js";
// Open Pitmaster: receives anonymous cook summaries (opt-in, from the Smoker integration for the Gravity 980) for the
// open dataset (data/ in github.com/Legal-Copy7045/open-pitmaster, built nightly in one shuffled batch). Format and privacy rules: PRIVACY.md and format/README.md in that repository.
//
// Privacy: this Worker never stores or logs IP addresses, request times or headers. A record is stored with only its
// own fields; the deletion key is stored only as a SHA-256 hash.
//
// Routes:
//   POST   /v1/cooks              {record, key_hash}   -> 201 stored; test records -> 202, not stored
//   DELETE /v1/cooks/<id>         header X-Delete-Key   -> 200 deleted (and listed as deleted for the dataset build)
//   GET    /v1/released                                 -> {records: [...shuffled], deleted: [ids]}
//   GET    /                                            -> what this is
//
// Storage (KV binding COOKS): c:<id> = "" with metadata {r: record} (kept 30 days: the nightly build copies it into
// data/ long before); k:<id> = hash of the deletion key (no expiry: the owner can remove the cook from the dataset for
// as long as it's published); d:<id> = deleted marker (1 year). The daily store count lives in the DailyCap Durable
// Object (binding CAP); rate limits: RL_UPLOAD for POST, RL for DELETE and the snapshot.

export const CUTS = ["Pork shoulder", "Brisket", "Ribs", "Beef roast", "Poultry", "Sausage", "Fish", "Auto"];
export const SEASONS = ["winter", "spring", "summer", "autumn"];
// "How was it?": cooking outcomes only.
export const TAGS = ["juicy", "tender", "dry", "tough", "undercooked", "just right", "overcooked", "great bark", "soft bark", "good smoke", "too smoky", "too little smoke", "fat rendered", "fat not rendered"];
const DAY = 86400;

const isNum = v => typeof v === "number" && Number.isFinite(v);
const onStep = (v, step) => Math.abs(Math.round(v / step) * step - v) < 1e-6;
const numOrNull = (v, lo, hi, step) => v === null || (isNum(v) && v >= lo && v <= hi && onStep(v, step));

// Exactly these fields, these ranges, these steps: anything more precise or extra is refused, so nothing identifying
// can slip through by accident (the integration rounds before sending).
export const FIELDS = {
  v: v => v === 1,
  id: v => typeof v === "string" && /^[0-9a-f]{32}$/.test(v),
  grill: v => v === "gravity980",
  release: v => typeof v === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(v),
  season: v => SEASONS.includes(v),
  cut: v => CUTS.includes(v),
  weight_lb: v => numOrNull(v, 0.5, 25, 0.5),
  wrapped: v => v === null || typeof v === "boolean",
  pit_f: v => numOrNull(v, 200, 700, 5),
  target_f: v => numOrNull(v, 100, 250, 1),
  stall_h: v => numOrNull(v, 0, 24, 0.1),
  total_h: v => isNum(v) && v >= 0.5 && v <= 36 && onStep(v, 0.1),
  outside_f: v => numOrNull(v, -10, 110, 5),
  rating: v => v === null || (Number.isInteger(v) && v >= 1 && v <= 5),
  tags: v => Array.isArray(v) && v.length <= TAGS.length && v.every(t => TAGS.includes(t)) && new Set(v).size === v.length,
};

export function validate(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "record must be an object";
  const keys = Object.keys(record);
  // (own properties only: "constructor", "__proto__"... are not fields)
  for (const k of keys) if (!Object.hasOwn(FIELDS, k)) return `unexpected field ${k}`;
  for (const [k, ok] of Object.entries(FIELDS)) {
    if (!Object.hasOwn(record, k)) return `missing field ${k}`;
    if (!ok(record[k])) return `bad value for ${k}`;
  }
  // Plausibility: a stall can't be longer than the cook.
  if (record.stall_h !== null && record.stall_h > record.total_h) return "stall longer than the cook";
  return null;
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Stores per UTC day, counted once for the whole service by one Durable Object (DailyCap below): atomic, so a flood
// from many addresses can't use up the KV write quota (each stored cook is 2 KV writes; the free plan allows 1,000 a
// day, and deletions and the daily snapshot need some too). Real use is a handful a day. The counter holds only the
// day and a number: nothing about who sent what.
export const DAILY_CAP = 150;

export class DailyCap {
  constructor(ctx) { this.storage = ctx.storage; }
  // POST /take?day=YYYY-MM-DD&cap=N -> {ok}: counts one store if today is under the cap. A Durable Object handles one
  // request's storage calls at a time (input gates), so the read and the write can't interleave with another upload.
  async fetch(request) {
    const u = new URL(request.url);
    const day = u.searchParams.get("day") || "", cap = parseInt(u.searchParams.get("cap"), 10) || 0;
    const cur = (await this.storage.get("count")) || { day: "", n: 0 };
    const n = cur.day === day ? cur.n : 0;
    if (n >= cap) return Response.json({ ok: false });
    await this.storage.put("count", { day, n: n + 1 });
    return Response.json({ ok: true });
  }
}

async function underDailyCap(env) {
  // Fails closed: no counter configured, or it can't be reached -> no store.
  if (!env.CAP) return false;
  try {
    const stub = env.CAP.get(env.CAP.idFromName("global"));
    const day = new Date().toISOString().slice(0, 10);
    const r = await stub.fetch(`https://cap.invalid/take?day=${day}&cap=${DAILY_CAP}`, { method: "POST" });
    return r.ok && (await r.json()).ok === true;
  } catch {
    return false;
  }
}

// The rate limiter's key for an address: IPv4 whole, IPv6 by its /64 (one home or phone usually gets a whole /64, so
// keying on the full address would give it 2^64 separate allowances). Used only as the limiter's key, never stored.
export function clientKey(ip) {
  ip = String(ip || "").trim().toLowerCase().replace(/%.*$/, "");
  if (!ip) return "x";
  const v4 = ip.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) return v4[1];
  if (!ip.includes(":")) return "x";
  let [head, tail] = ip.includes("::") ? ip.split("::") : [ip, null];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  if (t.length && t[t.length - 1].includes(".")) t.splice(t.length - 1, 1, "0", "0");  // embedded IPv4 tail
  const full = tail === null ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return full.slice(0, 4).map(x => (parseInt(x, 16) || 0).toString(16)).join(":") + "::/64";
}

// The public page's one inline script, allowed by its hash (no 'unsafe-inline' for scripts).
let pageCsp = null;
async function csp() {
  if (pageCsp) return pageCsp;
  const m = SITE.match(/<script>([\s\S]*?)<\/script>/);
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(m ? m[1] : ""));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(d)));
  pageCsp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${b64}'; connect-src https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  return pageCsp;
}

async function limited(rl, key) {
  // Cloudflare's rate limiter: counted at the edge, nothing stored here. Without it the Worker refuses (fails closed).
  if (!rl) return true;
  try {
    const { success } = await rl.limit({ key });
    return !success;
  } catch {
    return true;
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

async function listAll(kv, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    out.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const now = Math.floor(Date.now() / 1000);
    try {
      // The public page for people (browsers); the short JSON description for anything else.
      if ((url.pathname === "/" || url.pathname === "/index.html") && request.method === "GET") {
        if ((request.headers.get("accept") || "").includes("text/html"))
          return new Response(SITE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600",
            "content-security-policy": await csp(), "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
        return json({ what: "Open Pitmaster: anonymous, opt-in shared smoker cooks", page: url.origin + "/", privacy: "https://github.com/Legal-Copy7045/open-pitmaster/blob/main/PRIVACY.md" });
      }

      if (url.pathname === "/v1/cooks" && request.method === "POST") {
        // JSON only: a cross-site form or no-cors fetch from some web page can't send this type without a CORS
        // preflight, which this Worker never answers, so other sites can't make their visitors upload.
        if (!/^application\/json\b/i.test(request.headers.get("content-type") || "")) return json({ error: "send application/json" }, 415);
        // Two limits per address (IPv4) or IPv6 /64: RL (10 a minute) for any upload, before the body is read, and
        // RL_UPLOAD (1 a minute) for one that would be stored; plus the daily cap for the whole service.
        if (!env.RL || !env.RL_UPLOAD || !env.CAP) return json({ error: "uploads are paused" }, 503);
        const who = clientKey(request.headers.get("cf-connecting-ip"));
        if (await limited(env.RL, "up:" + who)) return json({ error: "too many uploads, try later" }, 429);
        const text = await request.text();
        if (text.length > 4096) return json({ error: "too large" }, 413);
        let body;
        try { body = JSON.parse(text); } catch { return json({ error: "invalid JSON" }, 400); }
        const rec = body && body.record, kh = body && body.key_hash;
        const err = validate(rec) || (typeof kh === "string" && /^[0-9a-f]{64}$/.test(kh) ? null : "bad key_hash");
        if (err) return json({ error: err }, 400);
        if (body.test === true) return json({ ok: true, test: true }, 202);  // checks the path end to end, stores nothing
        if (await env.COOKS.get("k:" + rec.id) !== null || await env.COOKS.get("d:" + rec.id) !== null)
          return json({ error: "already received" }, 409);
        if (await limited(env.RL_UPLOAD, who)) return json({ error: "too many uploads, try later" }, 429);
        if (!(await underDailyCap(env))) return json({ error: "too many uploads today, try tomorrow" }, 503);
        const clean = Object.fromEntries(Object.keys(FIELDS).map(k => [k, rec[k]]));  // exactly the published fields
        await env.COOKS.put("c:" + rec.id, "", { metadata: { r: clean }, expiration: now + 30 * DAY });
        // The key's hash is kept for as long as the cook can be in the dataset (no expiry), so its owner can always
        // remove it; it goes when the cook is deleted.
        await env.COOKS.put("k:" + rec.id, kh);
        return json({ ok: true }, 201);
      }

      const del = url.pathname.match(/^\/v1\/cooks\/([0-9a-f]{32})$/);
      if (del && request.method === "DELETE") {
        if (await limited(env.RL, "del:" + clientKey(request.headers.get("cf-connecting-ip")))) return json({ error: "too many requests, try later" }, 429);
        const id = del[1], key = request.headers.get("x-delete-key") || "";
        const stored = await env.COOKS.get("k:" + id);
        if (stored === null) {
          // Already deleted (the deleted list is public anyway): done. Otherwise it was never stored.
          if (await env.COOKS.get("d:" + id) !== null) return json({ ok: true, deleted: id, already: true });
          return json({ error: "not found" }, 404);
        }
        if (stored !== await sha256hex(key)) return json({ error: "wrong key" }, 403);
        await env.COOKS.delete("c:" + id);
        await env.COOKS.delete("k:" + id);
        await env.COOKS.put("d:" + id, "", { expirationTtl: 365 * DAY });
        return json({ ok: true, deleted: id });
      }

      // A once-a-day snapshot, not a live list: polling it can't tell when a cook arrived (only the day, as the
      // privacy policy says), and the store is listed at most once a day however often it's asked.
      if (url.pathname === "/v1/released" && request.method === "GET") {
        const snap = await env.COOKS.get("s:released");
        if (snap !== null) return new Response(snap, { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
        if (await limited(env.RL, "rel:" + clientKey(request.headers.get("cf-connecting-ip")))) return json({ error: "too many requests, try later" }, 429);
        const cooks = await listAll(env.COOKS, "c:");
        const records = shuffle(cooks.filter(k => k.metadata && k.metadata.r).map(k => k.metadata.r));
        const deleted = (await listAll(env.COOKS, "d:")).map(k => k.name.slice(2));
        const body = JSON.stringify({ records, deleted });
        try { await env.COOKS.put("s:released", body, { expirationTtl: DAY }); } catch { /* still served; listed again next time */ }
        return new Response(body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "server error" }, 500);  // no details: nothing about the request is echoed or logged
    }
  },
};

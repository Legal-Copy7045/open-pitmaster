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
// data/ long before); k:<id> = hash of the deletion key; d:<id> = deleted marker (1 year).

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
  for (const k of keys) if (!(k in FIELDS)) return `unexpected field ${k}`;
  for (const [k, ok] of Object.entries(FIELDS)) {
    if (!(k in record)) return `missing field ${k}`;
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

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

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
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'" } });
        return json({ what: "Open Pitmaster: anonymous, opt-in shared smoker cooks", page: url.origin + "/", privacy: "https://github.com/Legal-Copy7045/open-pitmaster/blob/main/PRIVACY.md" });
      }

      if (url.pathname === "/v1/cooks" && request.method === "POST") {
        if (env.RL) {  // Cloudflare's rate limiter: counted at the edge, nothing stored here
          const { success } = await env.RL.limit({ key: request.headers.get("cf-connecting-ip") || "x" });
          if (!success) return json({ error: "too many uploads, try later" }, 429);
        }
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
        await env.COOKS.put("c:" + rec.id, "", { metadata: { r: rec }, expiration: now + 30 * DAY });
        await env.COOKS.put("k:" + rec.id, kh);
        return json({ ok: true }, 201);
      }

      const del = url.pathname.match(/^\/v1\/cooks\/([0-9a-f]{32})$/);
      if (del && request.method === "DELETE") {
        const id = del[1], key = request.headers.get("x-delete-key") || "";
        const stored = await env.COOKS.get("k:" + id);
        if (stored === null) return json({ error: "not found" }, 404);
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
        const cooks = await listAll(env.COOKS, "c:");
        const records = shuffle(cooks.filter(k => k.metadata && k.metadata.r).map(k => k.metadata.r));
        const deleted = (await listAll(env.COOKS, "d:")).map(k => k.name.slice(2));
        const body = JSON.stringify({ records, deleted });
        await env.COOKS.put("s:released", body, { expirationTtl: DAY });
        return new Response(body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "server error" }, 500);  // no details: nothing about the request is echoed or logged
    }
  },
};

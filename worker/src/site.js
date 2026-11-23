// The public Open Pitmaster page, served by the Worker at / (no build step, no tracking, no cookies).
// It reads the published averages (data/aggregates.json in the GitHub repository) in the visitor's browser.
export const SITE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open Pitmaster</title>
<meta name="description" content="How long smoker cooks really take: open, anonymous data shared by Char-Griller Gravity 980 owners.">
<style>
:root{--ground:#f6f4f1;--surface:#fff;--ink:#1f1a16;--ink2:#5b524a;--line:#e6dfd7;--accent:#c2410c;--bar:#f3c9ad;--barin:#c2410c}
@media (prefers-color-scheme:dark){:root{--ground:#14110f;--surface:#1d1916;--ink:#f1ebe5;--ink2:#b5aaa0;--line:#332c26;--accent:#fb8a3c;--bar:#5a3a26;--barin:#fb8a3c}}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:clamp(28px,5vw,40px);line-height:1.1;margin:8px 0}h2{font-size:20px;margin:32px 0 8px}
p{color:var(--ink2);margin:6px 0}a{color:var(--accent)}
.kpis{display:flex;flex-wrap:wrap;gap:12px;margin:18px 0}.kpi{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 16px;flex:1 1 160px}
.kpi b{display:block;font-size:26px}.kpi span{color:var(--ink2);font-size:13px}
.bar-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,2fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
.bar-row:first-of-type{border-top:0}.lab{font-size:14px}.lab small{display:block;color:var(--ink2)}
.track{position:relative;height:14px;background:var(--line);border-radius:999px}.rng{position:absolute;top:0;bottom:0;background:var(--bar);border-radius:999px}
.med{position:absolute;top:-3px;bottom:-3px;width:4px;margin-left:-2px;background:var(--barin);border-radius:2px}
.val{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:6px 16px;margin:10px 0}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 4px}.tags span{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--ink2)}
select{font:inherit;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
.empty{padding:24px;text-align:center;color:var(--ink2);background:var(--surface);border:1px dashed var(--line);border-radius:12px}
footer{margin-top:40px;font-size:14px;color:var(--ink2)}
@media (max-width:560px){.bar-row{grid-template-columns:1fr auto}.track{grid-column:1/-1;order:3}}
</style></head><body><main>
<p style="text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:700;color:var(--accent)">Open Pitmaster</p>
<h1>How long smoker cooks really take</h1>
<p>Real cooks on Char-Griller Gravity 980 smokers, shared anonymously by their owners: no names, places, dates or notes,
just rounded numbers and how it turned out. Groups appear once 5 or more cooks are alike.</p>
<div class="kpis" id="kpis"></div>
<div id="filter" style="display:none"><label>Cut <select id="cut"></select></label></div>
<div id="groups"><div class="empty">Loading…</div></div>
<footer>
<p><a href="https://github.com/Legal-Copy7045/open-pitmaster/tree/main/data">Download the data</a> (CC0, public domain) ·
<a href="https://github.com/Legal-Copy7045/open-pitmaster/blob/main/PRIVACY.md">Privacy</a> ·
<a href="https://github.com/Legal-Copy7045/gravity-controller">The smoker controller</a></p>
<p>Times are the middle cook (median); the bar shows where the middle half of cooks finished. Shared cooks are not
checked by hand: treat them as a guide.</p>
</footer></main>
<script>
var URL_AGG = "https://raw.githubusercontent.com/Legal-Copy7045/open-pitmaster/main/data/aggregates.json";
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); }
function h(v) { return v == null ? "--" : (Math.round(v * 10) / 10) + " h"; }
function draw(d) {
  var groups = d.groups || [];
  document.getElementById("kpis").innerHTML =
    '<div class="kpi"><b>' + esc(d.cooks || 0) + '</b><span>cooks shared</span></div>' +
    '<div class="kpi"><b>' + esc(groups.length) + '</b><span>groups with ' + esc(d.min_n || 3) + '+ cooks</span></div>' +
    '<div class="kpi"><b>' + esc(d.updated || "--") + '</b><span>last updated</span></div>';
  if (!groups.length) {
    document.getElementById("groups").innerHTML = '<div class="empty">No groups yet: each needs ' + esc(d.min_n || 3) +
      ' similar cooks. Share yours from the Smoker integration or the controller\\'s page (it\\'s off unless you turn it on).</div>';
    return;
  }
  var cuts = groups.map(function (g) { return g.cut; }).filter(function (c, i, a) { return a.indexOf(c) === i; });
  var sel = document.getElementById("cut");
  sel.innerHTML = '<option value="">All cuts</option>' + cuts.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join("");
  document.getElementById("filter").style.display = "";
  var max = Math.max.apply(null, groups.map(function (g) { return g.total_p75 || g.total_h || 0; })) || 1;
  function render() {
    var want = sel.value, out = "";
    cuts.forEach(function (cut) {
      if (want && cut !== want) return;
      var rows = groups.filter(function (g) { return g.cut === cut; });
      out += '<h2>' + esc(cut) + '</h2><div class="card">' + rows.map(function (g) {
        var lo = (g.total_p25 || g.total_h) / max * 100, hi = (g.total_p75 || g.total_h) / max * 100, md = g.total_h / max * 100;
        var tags = Object.keys(g.tags || {}).slice(0, 4).map(function (t) { return '<span>' + esc(t) + ' ' + esc(g.tags[t]) + '%</span>'; }).join("");
        var extra = [g.stall_h != null ? "stall " + h(g.stall_h) : "", g.wrapped_pct != null ? g.wrapped_pct + "% wrapped" : "",
          g.rating != null ? g.rating + "★" : "", g.n + " cooks"].filter(Boolean).join(" · ");
        return '<div class="bar-row"><div class="lab">' + esc(g.weight) + ', ' + esc(g.pit) + ', ' + esc(g.outside) +
          '<small>' + esc(extra) + '</small>' + (tags ? '<div class="tags">' + tags + '</div>' : '') + '</div>' +
          '<div class="track" aria-hidden="true"><div class="rng" style="left:' + lo + '%;width:' + Math.max(1, hi - lo) + '%"></div>' +
          '<div class="med" style="left:' + md + '%"></div></div><div class="val">' + h(g.total_h) + '</div></div>';
      }).join("") + '</div>';
    });
    document.getElementById("groups").innerHTML = out;
  }
  sel.onchange = render;
  render();
}
fetch(URL_AGG, {cache: "no-store"}).then(function (r) { return r.json(); }).then(draw).catch(function () {
  document.getElementById("groups").innerHTML = '<div class="empty">Couldn\\'t load the averages right now. <a href="' + URL_AGG + '">The data file</a> is here.</div>';
});
</script></body></html>`;

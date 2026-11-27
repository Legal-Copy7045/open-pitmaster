// The walkthrough (STANDARD.md 3.5): one role (a visitor: the page has no sign-in), desktop and phone. Records every
// view of the public page with a screenshot and runs the WALK- checks. Writes out/walkthrough.json (the inventory),
// out/walkthrough-checks.json and out/walkthrough/*.png. Made-up data only (page/aggregates.fixture.json).
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, open, layout, smallTargets, EMPTY, VIEWPORTS, ORIGIN } from "./page/lib.mjs";

const OUT = new URL("./out/", import.meta.url);
mkdirSync(new URL("walkthrough/", OUT), { recursive: true });
const VIEWS = [  // name -> [data, step]
  ["averages", undefined, null],
  ["averages, one cut", undefined, p => p.selectOption("#cut", "Brisket")],
  ["no groups yet", EMPTY, null],
  ["data can't be loaded", null, null],
];
const inventory = { visitor: {} }, results = [];
const check = (key, ok, detail = "") => results.push({ key, status: ok ? "pass" : "fail", detail: ok ? "" : detail });

const browser = await chromium.launch();
try {
  for (const vp of Object.keys(VIEWPORTS)) {
    const pages = [];
    for (const [name, data, step] of VIEWS) {
      const page = await open(browser, vp, data === undefined ? undefined : data);
      if (step) await step(page);
      const shot = `walkthrough/visitor-${vp}-${name.replace(/[^a-z]+/g, "-")}.png`;
      await page.screenshot({ path: fileURLToPath(new URL(shot, OUT)), fullPage: true });
      const heading = await page.locator("h1").first().innerText();
      const links = await page.locator("a[href]").evaluateAll(as => as.map(a => ({ label: a.textContent.trim(), href: a.href })));
      pages.push({ name, url: ORIGIN + "/", heading, screenshot: shot, links });
      const l = await layout(page);
      check(`${vp}:${name}:no sideways scroll`, !l.sideways, "the page scrolls sideways");
      check(`${vp}:${name}:nothing off screen`, !l.wide.length, l.wide.slice(0, 5).join(", "));
      // In the "can't be loaded" view the failed fetch is the point: only that one error is expected.
      const errors = data === null ? page.errors.filter(e => !/Failed to load resource/.test(e)) : page.errors;
      check(`${vp}:${name}:no console errors`, !errors.length, errors.slice(0, 2).join(" | "));
      if (vp === "phone") {
        const small = await smallTargets(page);
        check(`${vp}:${name}:tap targets 44x44`, !small.length, small.join(", "));
      }
      check(`${vp}:${name}:links are https`, links.every(x => x.href.startsWith("https://")),
        links.filter(x => !x.href.startsWith("https://")).map(x => x.href).join(", "));
      await page.context().close();
    }
    inventory.visitor[vp] = { menu: [], pages };
  }
  const labels = inventory.visitor.desktop.pages[0].links.map(x => x.label);
  check("no duplicate link labels", new Set(labels).size === labels.length, labels.join(", "));
} catch (e) {
  results.push({ key: "RUN", status: "fail", detail: String(e).slice(0, 300) });
} finally {
  await browser.close();
}
writeFileSync(new URL("walkthrough.json", OUT), JSON.stringify(inventory, null, 1));
writeFileSync(new URL("walkthrough-checks.json", OUT), JSON.stringify({ results }, null, 1));
const failed = results.filter(r => r.status === "fail");
console.log(`walkthrough: ${results.length} checks, ${failed.length} failing`);
process.exit(failed.some(r => r.key === "RUN") ? 1 : 0);

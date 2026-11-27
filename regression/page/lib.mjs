// Shared by the page check (page.test.mjs) and the walkthrough (../walkthrough.mjs): the Worker's public page served
// offline, with data/aggregates.json replaced by a made-up fixture (or an empty or failing one).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { SITE } from "../../worker/src/site.js";

const require = createRequire(import.meta.url);
export const { chromium } = require("playwright");  // CI installs it here; a session finds the preinstalled one
export const FIXTURE = JSON.parse(readFileSync(new URL("./aggregates.fixture.json", import.meta.url)));
export const EMPTY = { v: 1, cooks: 0, min_n: 5, updated: "2026-11-20", groups: [] };
export const VIEWPORTS = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };
export const ORIGIN = "https://pitmaster.example";
const AGG = "https://raw.githubusercontent.com/Legal-Copy7045/open-pitmaster/main/data/aggregates.json";

// A page showing the site with `data` as the averages (null: the data file can't be loaded). Collects console and
// page errors in page.errors. Nothing leaves the machine: every other request is refused.
export async function open(browser, viewport, data = FIXTURE) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[viewport] });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", m => { if (m.type() === "error") page.errors.push(m.text()); });
  page.on("pageerror", e => page.errors.push(String(e)));
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url === ORIGIN + "/") return route.fulfill({ contentType: "text/html; charset=utf-8", body: SITE });
    if (url === AGG && data) return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    return route.abort();
  });
  await page.goto(ORIGIN + "/");
  await page.waitForFunction(() => !document.querySelector("#groups .empty") ||
    !/Loading/.test(document.querySelector("#groups .empty").textContent));
  return page;
}

// Layout problems a visitor would notice: sideways scroll, and elements wider than the window.
export async function layout(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth, wide = [];
    for (const el of document.querySelectorAll("main *")) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > w + 1 || r.left < -1)) wide.push(el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""));
    }
    return { sideways: document.documentElement.scrollWidth > w + 1, wide };
  });
}

// Controls smaller than 44x44 px (form controls and stand-alone links; links inside a sentence are exempt, as in WCAG 2.5.8).
export async function smallTargets(page) {
  return page.evaluate(() => [...document.querySelectorAll("select, button, input, a")]
    .filter(el => el.offsetParent !== null && !(el.tagName === "A" && el.closest("p, .empty")))
    .map(el => ({ el: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""), r: el.getBoundingClientRect() }))
    .filter(x => x.r.width < 44 || x.r.height < 44).map(x => `${x.el} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`));
}

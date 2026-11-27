// The public page (worker/src/site.js) in a browser, desktop and phone, from a made-up aggregates.json.
// node --test regression/page/page.test.mjs   (the regression's `page` stage, and CI's page job)
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { chromium, open, layout, FIXTURE, EMPTY, VIEWPORTS } from "./lib.mjs";

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

for (const vp of Object.keys(VIEWPORTS)) {
  test(`${vp}: the averages from aggregates.json`, async () => {
    const page = await open(browser, vp);
    const kpis = await page.locator("#kpis .kpi b").allTextContents();
    assert.deepEqual(kpis, [String(FIXTURE.cooks), String(FIXTURE.groups.length), FIXTURE.updated]);
    const cuts = [...new Set(FIXTURE.groups.map(g => g.cut))];
    assert.deepEqual(await page.locator("#groups h2").allTextContents(), cuts);
    assert.equal(await page.locator("#groups .bar-row").count(), FIXTURE.groups.length);
    assert.match(await page.locator("#groups").innerText(), /11\.2 h/);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test(`${vp}: the cut filter shows one cut`, async () => {
    const page = await open(browser, vp);
    await page.selectOption("#cut", "Brisket");
    assert.deepEqual(await page.locator("#groups h2").allTextContents(), ["Brisket"]);
    await page.selectOption("#cut", "");
    assert.equal(await page.locator("#groups h2").count(), 4);
    await page.context().close();
  });

  test(`${vp}: fits the screen`, async () => {
    const page = await open(browser, vp);
    const l = await layout(page);
    assert.equal(l.sideways, false, "sideways scroll");
    assert.deepEqual(l.wide, []);
    await page.context().close();
  });

  test(`${vp}: no groups yet`, async () => {
    const page = await open(browser, vp, EMPTY);
    assert.match(await page.locator("#groups").innerText(), /No groups yet: each needs 5 similar cooks/);
    assert.equal(await page.locator("#filter").isVisible(), false);
    await page.context().close();
  });

  test(`${vp}: the data file can't be loaded`, async () => {
    const page = await open(browser, vp, null);
    assert.match(await page.locator("#groups").innerText(), /Couldn't load the averages/);
    await page.context().close();
  });
}

test("data from the file is shown as text, never as markup", async () => {
  const evil = { ...FIXTURE, groups: [{ ...FIXTURE.groups[0], cut: '<img src=x onerror="window.pwned=1">' }] };
  const page = await open(browser, "desktop", evil);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.locator("#groups img").count(), 0);
  await page.context().close();
});

test("the page loads nothing but itself and the data file, and sets no cookies", async () => {
  const page = await open(browser, "desktop");
  const requests = [];
  page.on("request", r => requests.push(r.url()));
  await page.reload();
  await page.waitForSelector("#groups h2");
  assert.deepEqual(requests.map(u => new URL(u).host).sort(), ["pitmaster.example", "raw.githubusercontent.com"]);
  assert.deepEqual(await page.context().cookies(), []);
  await page.context().close();
});

// Optional browser check (not part of npm test): needs Playwright and the app on http://localhost:8080.
// Makes the browser storage refuse writes, presses Save, and checks the message, the unsaved state and the retry.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 }, timezoneId: 'Asia/Bangkok' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8080/index.html#settings');
  await page.waitForSelector('.tabs');
  const fail = (on, kind = 'QuotaExceededError') => page.evaluate(([on, kind]) => {
    const P = IDBObjectStore.prototype;
    if (!P.__put) { P.__put = P.put; P.__add = P.add; }
    if (!on) { P.put = P.__put; P.add = P.__add; return; }
    const boom = function (...a) { if (this.name === 'settings') throw new DOMException(kind === 'QuotaExceededError' ? 'The quota has been exceeded.' : 'The database connection is closing.', kind); return P.__put.apply(this, a); };
    P.put = boom; P.add = boom;
  }, [on, kind]);
  const text = async (sel) => ((await page.locator(sel).first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  const out = {};
  await page.selectOption('[data-path="race.mode"]', 'road');
  await page.fill('[data-path="race.date"]', '2027-03-07');
  await page.fill('[data-path="race.distanceKm"]', '10');
  await page.click('[data-tab="thresholds"]');
  await page.fill('[data-draft="lthr"]', '171'); await page.fill('[data-draft="pace"]', '6:26');
  await page.click('[data-action="add-threshold"]');
  await page.click('[data-action="save"]'); await page.waitForTimeout(400);
  await page.click('[data-tab="race"]');
  await page.fill('[data-path="race.distanceKm"]', '21.1');
  await fail(true);
  await page.click('[data-action="save"]'); await page.waitForTimeout(400);
  out.message = await text('#save-error');
  out.bar = await text('#savebar');
  await page.click('[data-tab="schedule"]');
  out.onOtherTab = await page.locator('#save-error').count();
  await page.click('[data-tab="race"]');
  out.valueKept = await page.inputValue('[data-path="race.distanceKm"]');
  await fail(true, 'InvalidStateError');
  await page.click('[data-action="save"]'); await page.waitForTimeout(400);
  out.closedMessage = await text('#save-error');
  await fail(false);
  await page.click('[data-action="save"]'); await page.waitForTimeout(400);
  out.afterRetry = { banner: await page.locator('#save-error').count(), bar: await text('#savebar') };
  await page.reload(); await page.waitForSelector('.tabs');
  out.afterReload = await page.inputValue('[data-path="race.distanceKm"]');
  out.pageErrors = errors;
  console.log(JSON.stringify(out, null, 1));
  const ok = /storage for this app is full/.test(out.message) && /Not saved/.test(out.bar) && out.onOtherTab === 1 && out.valueKept === '21.1'
    && /closed the app's storage/.test(out.closedMessage) && out.afterRetry.banner === 0 && /Saved /.test(out.afterRetry.bar) && out.afterReload === '21.1' && !errors.length;
  console.log(ok ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();

// Optional browser check: the Plan overview chart (bars per week, current week, click opens the week, table view).
const { chromium } = require('playwright');
const fx = require('./fixtures.cjs');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1000 }, timezoneId: 'Asia/Bangkok' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-11T08:00:00+07:00') });
  await page.goto('http://localhost:8080/index.html#settings');
  await page.waitForSelector('.tabs');
  await page.selectOption('[data-path="race.mode"]', 'road');
  await page.fill('[data-path="race.date"]', '2027-03-07'); await page.fill('[data-path="race.distanceKm"]', '21.1');
  await page.click('[data-tab="thresholds"]'); await page.fill('[data-draft="lthr"]', '171'); await page.fill('[data-draft="pace"]', '6:26');
  await page.click('[data-action="add-threshold"]'); await page.click('[data-action="save"]'); await page.waitForTimeout(300);
  await page.click('[data-page="history"]');
  await page.setInputFiles('#hist-files', fx.all());
  await page.waitForFunction(() => document.querySelectorAll('.results li').length >= 11, null, { timeout: 60000 }); await page.waitForTimeout(500);
  await page.click('[data-page="plan"]'); await page.click('[data-act="generate"]'); await page.waitForTimeout(1200);
  if (await page.locator('[data-act="generate-override"]').count()) { await page.click('[data-act="generate-override"]'); await page.waitForTimeout(1200); }
  const out = {};
  await page.waitForSelector('.overview');
  out.weeks = await page.locator('.overview-svg').first().locator('.ov-week').count();
  out.charts = await page.locator('.overview-svg').count();
  await page.clock.setFixedTime(new Date('2026-12-02T08:00:00+07:00')); await page.reload(); await page.waitForSelector('.overview');
  out.now = await page.locator('.overview-svg').first().locator('.ov-week.now').count();
  out.done = await page.locator('.overview-svg').first().locator('.ov-done').count();
  await page.locator('.overview').screenshot({ path: '/tmp/shots/overview.png' });
  const before = await page.locator('details.week[open]').count();
  await page.locator('.overview-svg').first().locator('.ov-week').nth(9).click();
  out.opened = await page.locator('details.week[data-week="10"][open]').count();
  await page.locator('.ov-table summary').click();
  out.tableRows = await page.locator('.ov-table tbody tr').count();
  console.log(JSON.stringify(out), errors);
  await browser.close();
  const ok = out.weeks > 4 && out.weeks === out.tableRows && out.now === 1 && out.opened === 1 && !errors.length;
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
})();

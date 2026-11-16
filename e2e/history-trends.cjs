// Optional browser check: the Trends card on History (weekly bars, table view, mode switch).
const { chromium } = require('playwright');
const fx = require('./fixtures.cjs');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1000 }, timezoneId: 'Asia/Bangkok' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-11T08:00:00+07:00') });
  await page.goto('http://localhost:8080/index.html#history');
  await page.waitForSelector('#hist-files');
  const out = {};
  out.emptyCard = await page.locator('.trends').count();
  await page.setInputFiles('#hist-files', fx.all());
  await page.waitForFunction(() => document.querySelectorAll('.results li').length >= 11, null, { timeout: 60000 }); await page.waitForTimeout(500);
  await page.waitForSelector('.trends');
  out.charts = await page.locator('.trends .overview-svg').count();
  out.weeks = await page.locator('.trends .overview-svg').first().locator('.tr-week').count();
  out.bars = await page.locator('.trends .overview-svg').first().locator('rect.ov-done, rect.ov-plan').count();
  out.lead = (await page.locator('.trends p').first().textContent()).replace(/\s+/g, ' ').trim();
  await page.locator('.trends .ov-table summary').click();
  out.tableRows = await page.locator('.trends .ov-table tbody tr').count();
  out.tableKm = (await page.locator('.trends .ov-table tbody tr td:nth-child(3)').allTextContents()).reduce((s, t) => s + Number(t), 0);
  out.listKm = (await page.locator('#page-history table.list').last().locator('tbody tr td:nth-child(2)').allTextContents()).reduce((s, t) => s + Number(t), 0);
  await page.locator('.trends').screenshot({ path: '/tmp/shots/trends.png' });
  await page.click('[data-page="settings"]'); await page.selectOption('[data-path="race.mode"]', 'road');
  await page.fill('[data-path="race.date"]', '2027-03-07'); await page.fill('[data-path="race.distanceKm"]', '21.1');
  await page.click('#page-settings [data-tab="thresholds"]'); await page.fill('[data-draft="lthr"]', '171'); await page.fill('[data-draft="pace"]', '6:26');
  await page.click('[data-action="add-threshold"]'); await page.click('[data-action="save"]'); await page.waitForTimeout(300);
  await page.click('[data-page="history"]'); await page.waitForSelector('.trends');
  await page.waitForFunction(() => document.querySelectorAll('.trends .overview-svg').length === 1, null, { timeout: 5000 }).catch(() => {});
  out.roadCharts = await page.locator('.trends .overview-svg').count();
  console.log(JSON.stringify(out), errors);
  await browser.close();
  const ok = out.emptyCard === 0 && out.charts === 2 && out.weeks === 16 && out.bars >= 2 && out.tableRows === 16
    && Math.abs(out.tableKm - out.listKm) < 0.6 && out.roadCharts === 1 && /Last 4 full weeks average/.test(out.lead) && !errors.length;
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
})();

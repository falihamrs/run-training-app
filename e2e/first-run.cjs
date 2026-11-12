// Optional browser check: first-run checklist, wide two-column Plan layout, Settings > Backup danger zone, date style.
const { chromium } = require('playwright');
const fx = require('./fixtures.cjs');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'Asia/Bangkok' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-11T08:00:00+07:00') });
  await page.goto('http://localhost:8080/index.html#plan');
  await page.waitForSelector('.checklist');
  const out = {};
  out.steps = await page.locator('.checklist li').count();
  out.doneAtStart = await page.locator('.checklist li.done').count();
  out.red = await page.locator('#page-plan .checks li.err').count();
  out.generateDisabled = await page.locator('[data-act="generate"]').isDisabled();
  await page.screenshot({ path: '/tmp/shots/first_run.png' });
  // follow the first step into Settings
  await page.locator('.checklist button[data-tab="race"]').click();
  await page.waitForSelector('[data-path="race.mode"]');
  await page.selectOption('[data-path="race.mode"]', 'road');
  await page.fill('[data-path="race.date"]', '2027-03-07'); await page.fill('[data-path="race.distanceKm"]', '21.1');
  await page.click('#page-settings [data-tab="thresholds"]'); await page.fill('[data-draft="lthr"]', '171'); await page.fill('[data-draft="pace"]', '6:26');
  await page.click('[data-action="add-threshold"]'); await page.click('[data-action="save"]'); await page.waitForTimeout(300);
  await page.click('[data-page="plan"]'); await page.waitForTimeout(300);
  out.doneAfterSettings = await page.locator('.checklist li.done').count();
  out.generateEnabled = await page.locator('[data-act="generate"]').isEnabled();
  await page.click('[data-page="history"]');
  await page.setInputFiles('#hist-files', fx.all());
  await page.waitForFunction(() => document.querySelectorAll('.results li').length >= 11, null, { timeout: 60000 }); await page.waitForTimeout(500);
  await page.click('[data-page="plan"]'); await page.click('[data-act="generate"]'); await page.waitForTimeout(1500);
  if (await page.locator('[data-act="generate-override"]').count()) { await page.click('[data-act="generate-override"]'); await page.waitForTimeout(1500); }
  await page.waitForSelector('.plan-cols .plan-side .this-week');
  const box = async (sel) => page.locator(sel).first().boundingBox();
  const side = await box('.plan-side'); const main = await box('.plan-main');
  out.twoColumns = side.x > main.x + main.width - 5;
  out.hints = await page.locator('text=On a phone').count();
  out.hintLines = await page.locator('.weeks-hint').count();
  out.isoDatesInHeader = /\d{4}-\d{2}-\d{2}/.test(await page.locator('.plan-main section.card').first().locator('h2').first().textContent());
  await page.screenshot({ path: '/tmp/shots/wide.png' });
  await page.click('[data-page="settings"]'); await page.click('#page-settings [data-tab="backup"]'); await page.waitForTimeout(600);
  out.dangerCards = await page.locator('#page-settings .danger-zone').count();
  out.dangerBtns = await page.locator('#page-settings button.danger').count();
  await page.locator('#page-settings .zone-title').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/shots/backup.png', fullPage: true });
  out.historyHasHousekeeping = await page.locator('#page-history >> text=Housekeeping').count();
  console.log(JSON.stringify(out), errors);
  await browser.close();
  const ok = out.steps === 3 && out.doneAtStart === 0 && out.red === 0 && out.generateDisabled && out.doneAfterSettings === 2 && out.generateEnabled
    && out.twoColumns && out.hints === 0 && out.hintLines === 1 && !out.isoDatesInHeader && out.dangerCards === 2 && out.dangerBtns >= 2 && out.historyHasHousekeeping === 0 && !errors.length;
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
})();

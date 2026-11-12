// Optional browser check: export date range (plan CSV, planned-vs-actual CSV, text copy, AI report).
const { chromium } = require('playwright');
const fs = require('fs');
const fx = require('./fixtures.cjs');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, timezoneId: 'Asia/Bangkok', acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-11T08:00:00+07:00') });
  await page.goto('http://localhost:8080/index.html#settings');
  await page.waitForSelector('.tabs');
  await page.selectOption('[data-path="race.mode"]', 'road');
  await page.fill('[data-path="race.date"]', '2027-03-07'); await page.fill('[data-path="race.distanceKm"]', '21.1');
  await page.click('#page-settings [data-tab="thresholds"]'); await page.fill('[data-draft="lthr"]', '171'); await page.fill('[data-draft="pace"]', '6:26');
  await page.click('[data-action="add-threshold"]'); await page.click('[data-action="save"]'); await page.waitForTimeout(300);
  await page.click('[data-page="history"]');
  await page.setInputFiles('#hist-files', fx.all());
  await page.waitForFunction(() => document.querySelectorAll('.results li').length >= 11, null, { timeout: 60000 }); await page.waitForTimeout(500);
  await page.click('[data-page="plan"]'); await page.click('[data-act="generate"]'); await page.waitForTimeout(1500);
  if (await page.locator('[data-act="generate-override"]').count()) { await page.click('[data-act="generate-override"]'); await page.waitForTimeout(1500); }
  const out = {};
  const download = async (sel) => { const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const path = '/tmp/e2e/' + dl.suggestedFilename(); await dl.saveAs(path); return { name: dl.suggestedFilename(), text: fs.readFileSync(path, 'utf8') }; };
  fs.mkdirSync('/tmp/e2e', { recursive: true });
  const dates = (t) => t.trim().split('\n').slice(1).map((l) => l.split(',')[0]);

  const whole = await download('[data-act="csv"]');
  out.wholeRows = dates(whole.text).length; out.wholeName = whole.name;

  await page.selectOption('[data-file-range]', 'custom');
  out.customInputs = await page.locator('[data-exp]').count();
  await page.fill('[data-exp="from"]', '2026-11-30'); await page.fill('[data-exp="to"]', '2026-12-13');
  const part = await download('[data-act="csv"]');
  const pd = dates(part.text);
  out.partRows = pd.length; out.partName = part.name;
  out.partInside = pd.every((d) => d >= '2026-11-30' && d <= '2026-12-13');

  const act = await download('[data-act="actual-csv"]');
  const ad = dates(act.text);
  out.actualRows = ad.length; out.actualName = act.name;
  out.actualInside = ad.every((d) => d >= '2026-11-30' && d <= '2026-12-13');
  out.actualHeader = act.text.split('\n')[0].includes('planned_min') && act.text.split('\n')[0].includes('actual_km');

  await page.locator('.plan-main section.card').first().screenshot({ path: '/tmp/shots/export_range.png' });
  await page.selectOption('[data-ai-range]', 'custom');
  const ai = await download('[data-act="ai-download"]');
  out.aiCustom = /Only 2026-11-30 to 2026-12-13/.test(ai.text) && !/### Week 1 /.test(ai.text);

  await page.selectOption('[data-file-range]', 'recent');
  const rec = await download('[data-act="actual-csv"]');
  out.recentRows = dates(rec.text).length;

  console.log(JSON.stringify(out), errors);
  await browser.close();
  const ok = out.partRows > 0 && out.partRows < out.wholeRows && out.partInside && out.customInputs === 2 && out.actualRows >= out.partRows
    && out.actualInside && out.actualHeader && out.aiCustom && out.recentRows > 0 && out.recentRows <= out.wholeRows && /-2026-11-30_2026-12-13/.test(out.partName) && !errors.length;
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
})();

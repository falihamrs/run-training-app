// Optional browser check: calendar (.ics) download and the Race readiness card.
const { chromium } = require('playwright');
const fs = require('fs');
const fx = require('./fixtures.cjs');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, timezoneId: 'Asia/Bangkok', acceptDownloads: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-11T08:00:00+07:00') });
  await page.goto('http://localhost:8080/index.html#settings');
  await page.waitForSelector('.tabs');
  await page.fill('[data-path="race.date"]', '2027-06-26'); await page.fill('[data-path="race.distanceKm"]', '25');
  await page.fill('[data-path="race.elevationGainM"]', '2300');
  await page.click('#page-settings [data-tab="thresholds"]'); await page.fill('[data-draft="lthr"]', '171'); await page.fill('[data-draft="pace"]', '6:26');
  await page.click('[data-action="add-threshold"]'); await page.click('[data-action="save"]'); await page.waitForTimeout(300);
  await page.click('[data-page="history"]');
  await page.setInputFiles('#hist-files', fx.all());
  await page.waitForFunction(() => document.querySelectorAll('.results li').length >= 11, null, { timeout: 60000 }); await page.waitForTimeout(500);
  await page.click('[data-page="plan"]'); await page.click('[data-act="generate"]'); await page.waitForTimeout(1500);
  if (await page.locator('[data-act="generate-override"]').count()) { await page.click('[data-act="generate-override"]'); await page.waitForTimeout(1500); }
  const out = {};
  await page.waitForSelector('.readiness');
  out.rowsBefore = await page.locator('.rd-row').count();
  out.statusBefore = await page.locator('.rd-row').evaluateAll((n) => n.map((x) => x.dataset.status));
  out.mode = (await page.locator('.plan-main section.card h2').first().textContent()).trim().slice(0, 10);

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="ics"]')]);
  fs.mkdirSync('/tmp/e2e', { recursive: true });
  const path = '/tmp/e2e/' + dl.suggestedFilename(); await dl.saveAs(path);
  const ics = fs.readFileSync(path, 'utf8');
  out.icsName = dl.suggestedFilename();
  out.events = (ics.match(/BEGIN:VEVENT/g) || []).length;
  out.hasRace = /SUMMARY:RACE: /.test(ics);
  out.longLines = ics.split('\r\n').filter((l) => Buffer.byteLength(l) > 75).length;

  // three weeks in: finished plan weeks exist, no runs matched since, so readiness is behind
  await page.clock.setFixedTime(new Date('2026-12-09T08:00:00+07:00')); await page.reload(); await page.waitForSelector('.readiness');
  out.statusAfter = await page.locator('.rd-row').evaluateAll((n) => n.map((x) => x.dataset.status));
  out.lead = (await page.locator('.readiness p').first().textContent()).trim();
  const side = await page.locator('.plan-side').boundingBox(); const rd = await page.locator('.readiness').boundingBox();
  out.inSide = rd.x >= side.x - 1;
  await page.locator('.plan-side').screenshot({ path: '/tmp/shots/readiness.png' });
  console.log(JSON.stringify(out), errors);
  await browser.close();
  const ok = out.rowsBefore === 3 && out.statusBefore.every((s) => s === 'none') && out.events > 100 && out.hasRace && out.longLines === 0
    && /\.ics$/.test(out.icsName) && out.statusAfter.includes('behind') && out.inSide && !errors.length;
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
})();

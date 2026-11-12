// Optional browser check (not part of npm test): needs Playwright and the app on http://localhost:8080.
// Import results (one summary, grey skipped files, Add anyway) and the plan page notices (one collapsible
// Plan notes block, no repeated race duration, a success message that fades).
const { chromium } = require('playwright');
const fx = require('./fixtures.cjs');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1000 }, timezoneId: 'Asia/Bangkok' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.install({ time: new Date('2026-11-11T08:00:00+07:00') });
  await page.goto('http://localhost:8080/index.html#settings');
  await page.waitForSelector('.tabs');
  await page.selectOption('[data-path="race.mode"]', 'trail');
  await page.fill('[data-path="race.date"]', '2027-06-26'); await page.fill('[data-path="race.distanceKm"]', '25'); await page.fill('[data-path="race.elevationGainM"]', '2300');
  await page.click('[data-tab="thresholds"]'); await page.fill('[data-draft="lthr"]', '171'); await page.fill('[data-draft="pace"]', '6:26');
  await page.click('[data-action="add-threshold"]'); await page.click('[data-action="save"]'); await page.waitForTimeout(300);
  const out = {};
  // --- History: import everything, including the 5 walks/hikes the watch labels "Other"
  await page.click('[data-page="history"]');
  await page.setInputFiles('#hist-files', fx.all());
  await page.waitForFunction(() => document.querySelectorAll('.results li').length >= 11, null, { timeout: 60000 }); await page.waitForTimeout(500);
  const count = () => page.locator('tr:has([data-climb])').count();
  out.import = {
    summary: ((await page.locator('.import-summary').textContent()) || '').replace(/\s+/g, ' ').trim(),
    red: await page.locator('.results li.bad').count(), grey: await page.locator('.results li.skip').count(), green: await page.locator('.results li.ok').count(),
    detailsOpen: await page.locator('details.results-detail[open]').count(), runs: await count(),
  };
  // one file: Add anyway
  await page.locator('details.results-detail summary').click();
  await page.locator('li.skip', { hasText: '2026-11-01-0715' }).locator('[data-skip-add]').click(); await page.waitForTimeout(700);
  out.addOne = { runs: await count(), grey: await page.locator('.results li.skip').count(), unusable: await page.locator('.results li.unusable').count(), rows: await page.locator('.results li').count(), summary: ((await page.locator('.import-summary').textContent()) || '').replace(/\s+/g, ' ').trim() };
  // the rest
  await page.locator('[data-skip-all]').click(); await page.waitForTimeout(1200);
  out.addAll = { runs: await count(), grey: await page.locator('.results li.skip').count(), unusable: await page.locator('.results li.unusable').count(), red: await page.locator('.results li.bad').count(), rows: await page.locator('.results li').count(), summary: ((await page.locator('.import-summary').textContent()) || '').replace(/\s+/g, ' ').trim() };
  await page.screenshot({ path: '/tmp/shots/import_summary.png', clip: { x: 0, y: 0, width: 1100, height: 520 } });

  // --- Plan: notes block and the fading message (all days flat on purpose: the two climbing notices used to repeat)
  await page.click('[data-page="plan"]'); await page.click('[data-act="generate"]'); await page.waitForTimeout(1500);
  if (await page.locator('[data-act="generate-override"]').count()) { await page.click('[data-act="generate-override"]'); await page.waitForTimeout(1500); }
  const card = (await page.locator('section.card:has(details.plan-notes)').first().textContent()).replace(/\s+/g, ' ');
  out.plan = {
    notesBlocks: await page.locator('details.plan-notes').count(),
    overviewCharts: await page.locator('.overview-svg').count(),
    openAfterGenerate: await page.locator('details.plan-notes[open]').count(),
    summary: ((await page.locator('details.plan-notes > summary').textContent()) || '').replace(/\s+/g, ' ').trim().slice(0, 140),
    durationMentions: (card.match(/Expected (race )?duration/g) ?? []).length,
    hillsNoticeAndNoClimbDays: /No hills day is set/.test(card) && /None of your available days is set to hills/.test(card),
    saved: await page.locator('[data-notice]').count(),
  };
  await page.screenshot({ path: '/tmp/shots/plan_notes_open.png', clip: { x: 0, y: 0, width: 1100, height: 640 } });
  await page.clock.fastForward(7000); await page.waitForTimeout(700);
  out.plan.savedAfter = await page.locator('[data-notice]').count();
  await page.locator('details.plan-notes > summary').click();
  out.plan.closedByClick = await page.locator('details.plan-notes[open]').count();
  await page.screenshot({ path: '/tmp/shots/plan_notes_closed.png', clip: { x: 0, y: 0, width: 1100, height: 520 } });
  await page.reload(); await page.waitForTimeout(1000); await page.click('[data-page="plan"]'); await page.waitForTimeout(400);
  out.plan.afterReloadOpen = await page.locator('details.plan-notes[open]').count();
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
  const ok = /6 runs added/.test(out.import.summary) && /5 files skipped: not a run \(Other\)/.test(out.import.summary)
    && out.import.red === 0 && out.import.grey === 5 && out.import.green === 6 && out.import.runs === 6
    && out.addOne.runs === 7 && out.addOne.grey === 4 && out.addOne.rows === 11
    && out.addAll.grey === 0 && out.addAll.unusable === 4 && out.addAll.red === 0 && out.addAll.rows === 11 && out.addAll.runs === 7
    && /7 runs added · 4 files not usable \(Shorter than 1 km, No distance in file\)/.test(out.addAll.summary)
    && out.plan.notesBlocks === 1 && out.plan.openAfterGenerate === 1 && /warning/.test(out.plan.summary)
    && out.plan.overviewCharts === 2 && out.plan.durationMentions === 1 && !out.plan.hillsNoticeAndNoClimbDays
    && out.plan.saved === 1 && out.plan.savedAfter === 0 && out.plan.closedByClick === 0 && out.plan.afterReloadOpen === 0 && !errors.length;
  console.log(ok ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();

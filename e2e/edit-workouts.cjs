// Optional browser check (not part of npm test): needs Playwright and the app on http://localhost:8080.
// Builds a plan, edits workouts by hand (length, move, easy, rest, adjust week), undoes, and reloads.
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
  const art = (id) => page.locator(`article:has([data-copy-workout="${id}"])`);
  const head = async (id) => ((await art(id).locator('header').textContent()) || '').replace(/\s+/g, ' ').trim();
  // open week 2 and edit its easy run
  await page.locator('details[data-week="4"] > summary').click();
  const ids = await page.locator('details[data-week="4"] [data-edit]').evaluateAll((b) => b.map((x) => x.dataset.edit));
  out.editable = ids;
  const easyId = (await page.locator('details[data-week="4"] article.role-E [data-edit]').first().getAttribute('data-edit'));
  const before = await head(easyId);
  await page.click(`[data-edit="${easyId}"]`);
  const min0 = Number(await page.inputValue(`[data-edit-form="${easyId}"] [data-edit-min]`));
  await page.fill(`[data-edit-form="${easyId}"] [data-edit-min]`, String(min0 + 10));
  await page.click(`[data-edit-form="${easyId}"] [data-edit-do="save"]`); await page.waitForTimeout(300);
  out.length = { before, after: await head(easyId), msg: (await art(easyId).locator('[role=status]').textContent().catch(() => '')).trim() };
  // move it to a free day
  const taken = await page.locator('details[data-week="4"] article:not(.role-S) header strong').allTextContents();
  const takenDays = taken.map((t) => t.slice(0, 3));
  await page.click(`[data-edit="${easyId}"]`);
  const options = await page.locator(`[data-edit-form="${easyId}"] [data-edit-day] option`).evaluateAll((o) => o.map((x) => x.value));
  const free = options.find((d) => !takenDays.includes(d));
  await page.selectOption(`[data-edit-form="${easyId}"] [data-edit-day]`, free);
  await page.click(`[data-edit-form="${easyId}"] [data-edit-do="save"]`); await page.waitForTimeout(300);
  const newId = easyId.replace(/^(w\d+-)\w{3}/, `$1${free}`);
  out.move = { to: free, found: await art(newId).count(), msg: (await art(newId).locator('[role=status]').textContent().catch(() => '')).trim() };
  // quality session: make it easy
  const qId = await page.locator('details[data-week="4"] article.role-Q1 [data-edit]').first().getAttribute('data-edit');
  await page.click(`[data-edit="${qId}"]`); await page.click(`[data-edit-form="${qId}"] [data-edit-do="easy"]`); await page.waitForTimeout(300);
  out.easy = await head(qId);
  // adjust week 3
  await page.locator('details[data-week="5"] > summary').click();
  const w3 = async () => (await page.locator('details[data-week="5"] > summary').textContent()).replace(/\s+/g, ' ').match(/planned [\d.]+ km/)[0];
  const w3before = await w3();
  await page.selectOption('[data-scale="5"]', '0.8'); await page.click('[data-scale-do="5"]'); await page.waitForTimeout(300);
  out.scale = { before: w3before, after: await w3() };
  // undo, then reload
  await page.click('[data-act="undo"]'); await page.waitForTimeout(300);
  out.undo = { week3: await w3(), notice: (await page.textContent('#page-plan')).match(/Undone:[^.]*\./)?.[0] };
  await page.reload(); await page.waitForTimeout(1000);
  await page.click('[data-page="plan"]'); await page.waitForTimeout(400);
  out.afterReload = { movedStillThere: await page.locator(`[data-copy-workout="${newId}"]`).count(), easyTag: await art(qId).locator('.tag', { hasText: 'edited' }).count(), undoButton: await page.locator('[data-act="undo"]').count() };
  await page.click('[data-act="regen"]');
  out.regenWarning = (await page.textContent('#page-plan')).match(/Your \d+ edits? in those weeks will be replaced\./)?.[0] ?? null;
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
  const ok = /→|Saved/.test(out.length.msg) && out.move.found === 1 && /Easy run/.test(out.easy) && out.scale.after !== out.scale.before
    && out.undo.week3 === out.scale.before && out.afterReload.movedStillThere === 1 && out.afterReload.easyTag === 1 && out.regenWarning && !errors.length;
  console.log(ok ? 'PASS' : 'FAIL');
  await page.screenshot({ path: '/tmp/shots/edit_workouts.png', fullPage: false });
  await browser.close();
  process.exit(ok ? 0 : 1);
})();

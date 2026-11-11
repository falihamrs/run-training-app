// Optional browser check (not part of npm test): needs Playwright, the app on http://localhost:8080 and an
// unzipped Coros TCX export in /tmp/coros/export/x. Builds the trail plan, copies the report, writes an AI-style
// answer with a plan-changes block, uploads it as .md, applies it, checks Settings and undo.
const { chromium } = require('playwright');
const fs = require('fs');
const DIR = process.env.TCX_DIR || '/tmp/coros/export/x/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 }, timezoneId: 'Asia/Bangkok' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8080' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.install({ time: new Date('2026-11-11T08:00:00+07:00') });
  await page.goto('http://localhost:8080/index.html#settings');
  await page.waitForSelector('.tabs');
  await page.selectOption('[data-path="race.mode"]', 'trail');
  await page.fill('[data-path="race.date"]', '2027-06-26'); await page.fill('[data-path="race.distanceKm"]', '25'); await page.fill('[data-path="race.elevationGainM"]', '2300');
  await page.click('[data-tab="schedule"]'); await page.selectOption('[data-path="schedule.runsPerWeek"]', '4');
  for (const [d, t] of [['Mon', 'incline'], ['Wed', 'incline'], ['Sat', 'hills'], ['Sun', 'hills']]) await page.selectOption(`[data-path="schedule.dayTerrain.${d}"]`, t);
  await page.click('[data-tab="thresholds"]'); await page.fill('[data-draft="lthr"]', '171'); await page.fill('[data-draft="pace"]', '6:26');
  await page.click('[data-action="add-threshold"]'); await page.click('[data-action="save"]'); await page.waitForTimeout(300);
  await page.click('[data-page="history"]');
  await page.setInputFiles('#hist-files', fs.readdirSync(DIR).map((f) => DIR + f));
  await page.waitForFunction(() => document.querySelectorAll('.results li').length >= 11, null, { timeout: 60000 }); await page.waitForTimeout(500);
  await page.click('[data-page="plan"]'); await page.click('[data-act="generate"]'); await page.waitForTimeout(1500);
  // the report names the workouts by id
  await page.selectOption('[data-ai-range]', 'all');
  await page.click('[data-act="ai-copy"]'); await page.waitForTimeout(300);
  const report = await page.evaluate(() => navigator.clipboard.readText());
  const ids = [...report.matchAll(/\*\*(\w{3}) (\d{4}-\d\d-\d\d) · ([^*]+)\*\* \((\w+)\) \[([\w-]+)\]/g)].map((m) => ({ day: m[1], date: m[2], name: m[3], code: m[4], id: m[5] }));
  const w = (n, code) => ids.find((x) => x.id.startsWith(`w${n}-`) && x.code === code);
  const long3 = w(3, 'LR'), q3 = ids.find((x) => x.id.startsWith('w3-') && ['FAR', 'INC', 'TMP', 'HIL'].includes(x.code) && x.code !== 'INC') ?? w(3, 'INC');
  const answer = `Thanks for the report. Overall the plan is sensible, but you are coming from a low base.

### What I would change
1. Week 3: shorten the long run slightly and make the fartlek easy, as you are still adapting.
2. Week 4: about 10% less overall.
3. Run Thursdays on hills, since that is where you have time.

\`\`\`plan-changes
{
  "changes": [
    { "op": "duration", "workout": "${long3.id}", "minutes": 50, "reason": "Long run is a big jump for your base" },
    { "op": "easy", "workout": "${q3.id}", "minutes": 30, "reason": "Still adapting" },
    { "op": "scaleWeek", "week": 4, "factor": 0.9, "reason": "Absorb the first block" },
    { "op": "duration", "workout": "${long3.id}", "minutes": 200, "reason": "this should be refused" },
    { "op": "setting", "field": "terrain.Thu", "value": "hills", "reason": "More climbing" },
    { "op": "threshold", "lthr": 172, "pace": "6:20", "from": "2026-12-07", "reason": "Race on 8 Nov suggests a slightly higher LTHR" },
    { "op": "teleport", "workout": "w2-Mon" }
  ]
}
\`\`\`
`;
  fs.writeFileSync('/tmp/e2e/ai-answer.md', answer);
  await page.locator('#ai-feedback > summary').click();
  await page.setInputFiles('[data-ai-file]', '/tmp/e2e/ai-answer.md');
  await page.waitForSelector('.ai-items li'); await page.waitForTimeout(300);
  const out = {};
  out.preview = (await page.locator('.ai-items li').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
  out.checked = await page.locator('[data-ai-item]:checked').count();
  await page.screenshot({ path: '/tmp/shots/ai_feedback_preview.png', fullPage: false, clip: { x: 0, y: 0, width: 1100, height: 1000 } });
  await page.locator('#ai-feedback').screenshot({ path: '/tmp/shots/ai_feedback_preview.png' });
  await page.click('[data-act="ai-apply"]'); await page.waitForTimeout(1500);
  out.result = (await page.locator('#ai-feedback [role=status]').textContent().catch(() => '')).trim();
  const plan = await page.textContent('#page-plan');
  out.editedTags = await page.locator('.tag', { hasText: 'edited' }).count();
  out.long3 = (await page.locator(`article:has([data-copy-workout="${long3.id}"]) header`).textContent()).replace(/\s+/g, ' ').trim();
  await page.click('[data-page="settings"]'); await page.click('[data-tab="schedule"]');
  out.thuTerrain = await page.inputValue('[data-path="schedule.dayTerrain.Thu"]');
  await page.click('[data-page="plan"]'); await page.waitForTimeout(300);
  // threshold suggestion opens Settings with the values filled in, nothing saved yet
  // (the preview is cleared after applying, so read it again)
  await page.locator('#ai-feedback > summary').click().catch(() => {});
  await page.setInputFiles('[data-ai-file]', '/tmp/e2e/ai-answer.md'); await page.waitForSelector('[data-ai-threshold]');
  await page.click('[data-ai-threshold]'); await page.waitForTimeout(300);
  out.thresholdDraft = { lthr: await page.inputValue('[data-draft="lthr"]'), pace: await page.inputValue('[data-draft="pace"]'), tab: await page.locator('[role=tab][aria-selected=true]').textContent() };
  // undo restores the plan
  await page.click('[data-page="plan"]'); await page.waitForTimeout(300);
  await page.click('[data-act="undo"]'); await page.waitForTimeout(400);
  out.afterUndoEdited = await page.locator('.tag', { hasText: 'edited' }).count();
  out.afterUndoLong3 = (await page.locator(`article:has([data-copy-workout="${long3.id}"]) header`).textContent()).replace(/\s+/g, ' ').trim();
  // the next report lists the AI changes with their reasons
  await page.click('[data-act="ai-copy"]'); await page.waitForTimeout(300);
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
  const ok = out.preview.length === 7 && out.checked >= 3 && /Applied/.test(out.result) && !/Not applied/.test(out.result) && out.preview.some((p) => /in the rebuilt plan/.test(p)) && out.editedTags >= 3 && /50 min/.test(out.long3)
    && out.thuTerrain === 'hills' && out.thresholdDraft.lthr === '172' && out.thresholdDraft.pace === '6:20' && out.afterUndoEdited === 0 && /60 min/.test(out.afterUndoLong3) && !errors.length;
  console.log(ok ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();

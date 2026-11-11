// Optional browser check (not part of npm test): needs Playwright and the app on http://localhost:8080.
// Builds a plan, then changes the week by dragging sessions on the week strip (move, swap), by tapping
// (pick a session, press a day), checks refusals, undoes, and reloads.
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
  const W = 'details[data-week="4"]';
  await page.locator(`${W} > summary`).click();
  // what the strip shows: day -> [labels]
  const strip = async () => page.locator(`${W} .daystrip .day`).evaluateAll((cells) => Object.fromEntries(cells.map((c) => [c.dataset.day, [...c.querySelectorAll('.item')].map((i) => i.textContent.trim())])));
  const msg = async () => ((await page.locator(`${W} [role=status]`).first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  const day = (d) => page.locator(`${W} .daystrip .day[data-day="${d}"]`);
  const s0 = await strip();
  const runDays = Object.keys(s0).filter((d) => s0[d].some((l) => !/^S/.test(l)));
  const restDays = Object.keys(s0).filter((d) => !s0[d].length);
  out.start = s0;
  // 1. drag a run onto a rest day: a move
  const fromDay = runDays[0]; const toRest = restDays[0];
  await day(fromDay).locator('button.item').first().dragTo(day(toRest));
  await page.waitForTimeout(300);
  const s1 = await strip();
  out.drag = { from: fromDay, to: toRest, after: s1, msg: await msg() };
  // 2. drag a run onto another run: a swap
  const [d1, d2] = Object.keys(s1).filter((d) => s1[d].some((l) => !/^S/.test(l)));
  const l1 = s1[d1].find((l) => !/^S/.test(l)); const l2 = s1[d2].find((l) => !/^S/.test(l));
  await day(d1).locator('button.item', { hasText: l1 }).first().dragTo(day(d2));
  await page.waitForTimeout(300);
  const s2 = await strip();
  out.swap = { d1, d2, l1, l2, after: s2, msg: await msg() };
  // the workout list below agrees with the strip and the dates are in order
  const heads = await page.locator(`${W} article header strong`).allTextContents();
  out.listDays = heads.map((h) => h.slice(0, 3));
  // 3. tap flow: pick a session, press an empty day
  const empty = Object.keys(s2).find((d) => !s2[d].length);
  const tapFrom = Object.keys(s2).find((d) => s2[d].some((l) => !/^S/.test(l)));
  await day(tapFrom).locator('button.item').first().click();
  out.picked = { pressed: await day(tapFrom).locator('button.item[aria-pressed="true"]').count(), hint: /Now press the day/.test((await page.textContent(W)) ?? '') };
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  out.escaped = await page.locator(`${W} button.item[aria-pressed="true"]`).count();
  await day(tapFrom).locator('button.item').first().click();
  await day(empty).click(); await page.waitForTimeout(300);
  const s3 = await strip();
  out.tapMove = { from: tapFrom, to: empty, after: s3 };
  // 4. tap a session, then another session: a swap
  const [t1, t2] = Object.keys(s3).filter((d) => s3[d].some((l) => !/^S/.test(l)));
  const m1 = s3[t1].find((l) => !/^S/.test(l)); const m2 = s3[t2].find((l) => !/^S/.test(l));
  await day(t1).locator('button.item', { hasText: m1 }).first().click();
  await day(t2).locator('button.item', { hasText: m2 }).first().click(); await page.waitForTimeout(300);
  const s4 = await strip();
  out.tapSwap = { t1, t2, m1, m2, after: s4 };
  // 5. a session cannot go to another week, and the first week keeps no drop target for past days
  const otherWeek = page.locator('details[data-week="5"]');
  await page.locator('details[data-week="5"] > summary').click();
  await day(Object.keys(s4).find((d) => s4[d].some((l) => !/^S/.test(l)))).locator('button.item').first().click();
  await otherWeek.locator('.daystrip .day.empty[data-drop]').first().click(); await page.waitForTimeout(250);
  out.crossWeek = ((await page.locator(`${W} [role=status]`).first().textContent().catch(() => '')) || '').trim();
  out.pastDropTargets = await page.locator('.daystrip .day.fixed[data-drop]').count();
  // 6. undo each step, then reload keeps the changes made so far
  const snapshot = JSON.stringify(await strip());
  let undone = 0;
  for (let i = 0; i < 4; i++) { if (await page.locator('[data-act="undo"]').count()) { await page.click('[data-act="undo"]'); await page.waitForTimeout(250); undone++; } }
  out.undone = { steps: undone, back: JSON.stringify(await strip()) === JSON.stringify(s0) };
  await day('Wed').locator('button.item').first().click();
  await page.locator(W).screenshot({ path: '/tmp/shots/drag_week_desktop.png' });
  await page.setViewportSize({ width: 380, height: 900 }); await page.waitForTimeout(200);
  await page.locator(W).screenshot({ path: '/tmp/shots/drag_week_phone.png' });
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
  const items = (s) => Object.values(s).flat().sort().join(',');
  const ok = items(s1) === items(s0) && s1[toRest].length === 1 && !s1[fromDay].some((l) => !/^S/.test(l)) && /moved to/.test(out.drag.msg)
    && s2[d1].includes(l2) && s2[d2].includes(l1) && /swapped with/.test(out.swap.msg)
    && out.listDays.join() === [...out.listDays].sort((a, b) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(a) - ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(b)).join()
    && out.picked.pressed === 1 && out.picked.hint && out.escaped === 0
    && s3[empty].length === 1 && s4[t1].includes(m2) && s4[t2].includes(m1)
    && /only move within its own week/.test(out.crossWeek) && out.pastDropTargets === 0
    && out.undone.back && !errors.length;
  console.log(ok ? 'PASS' : 'FAIL');
  await page.screenshot({ path: '/tmp/shots/drag_drop.png', fullPage: false });
  await browser.close();
  process.exit(ok ? 0 : 1);
})();

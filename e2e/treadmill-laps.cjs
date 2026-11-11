// Optional browser check (not part of npm test): needs Playwright, the app on http://localhost:8080 and a treadmill TCX with laps.
const { chromium } = require('playwright');
const fx = require('./fixtures.cjs');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1000 }, timezoneId: 'Asia/Jakarta' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
  await page.addInitScript(() => window.addEventListener('unhandledrejection', (e) => console.error('UNHANDLED', e.reason?.message, e.reason?.stack)));
  await page.goto('http://localhost:8080/index.html#history');
  await page.waitForSelector('#hist-files');
  await page.setInputFiles('#hist-files', [fx.tm('2026-11-10')]);
  await page.waitForSelector('.results li'); await page.waitForTimeout(600);
  const row = async () => (await page.locator('tr:has([data-climb])').first().textContent()).replace(/\s+/g, ' ').trim();
  console.log('row    :', await row());
  await page.locator('[data-climb]').first().click();
  await page.waitForSelector('#climb-editor');
  console.log('rows   :', await page.locator('[data-climb-val]').count(), '| basis', await page.locator('[data-climb-basis]').inputValue());
  const vals = [0, 6, 1, 7, 1, 7, 1, 7, 1, 8, 1, 8, 1, 0];
  for (let i = 0; i < vals.length; i++) await page.locator('[data-climb-val]').nth(i).fill(String(vals[i]));
  console.log('total  :', await page.textContent('#climb-total'));

  console.log('save buttons', await page.locator('[data-climb-do="save"]').count(), await page.locator('[data-climb-do="save"]').isVisible());

  await page.click('[data-climb-do="save"]'); await page.waitForTimeout(500);
  console.log('editor after save:', await page.locator('#climb-editor').count(), ((await page.locator('#climb-editor').textContent().catch(() => '')) || '').match(/(Use numbers|Incline cannot|One split)[^.]*./)?.[0]);
  console.log('saved  :', await row());
  console.log('stored :', JSON.stringify(await page.evaluate(() => new Promise((res) => { const rq = indexedDB.open('RunTrainingApp'); rq.onsuccess = () => { const tx = rq.result.transaction('runs'); const g = tx.objectStore('runs').getAll(); g.onsuccess = () => res(g.result.map((r) => ({ gain: r.gainM, mc: r.manualClimb && { unit: r.manualClimb.unit, basis: r.manualClimb.basis, values: r.manualClimb.values } }))); }; }))));
  await page.reload(); await page.waitForTimeout(800);
  await page.locator('[data-climb]').first().click(); await page.waitForSelector('#climb-editor');
  console.log('reopen : basis', await page.locator('[data-climb-basis]').inputValue(), 'lap 2 =', await page.locator('[data-climb-val]').nth(1).inputValue());
  await page.screenshot({ path: '/tmp/shots/treadmill_laps.png', fullPage: true });
  await page.selectOption('[data-climb-basis]', 'km');
  console.log('km view:', await page.textContent('#climb-total'), '| km 3 =', await page.locator('[data-climb-val]').nth(2).inputValue());
  console.log('km rows:', await page.locator('[data-climb-val]').count());
  await browser.close();
})();

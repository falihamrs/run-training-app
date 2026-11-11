// Optional browser check (not part of npm test): needs Playwright, the app on http://localhost:8080 and an unzipped Coros TCX export in /tmp/coros/export/x.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1000 }, timezoneId: 'Asia/Jakarta' })).newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
  await page.clock.install({ time: new Date('2026-11-11T08:00:00+07:00') });
  await page.goto('http://localhost:8080/index.html#history');
  await page.waitForSelector('#hist-files');
  const dir = '/tmp/coros/export/x/';
  await page.setInputFiles('#hist-files', fs.readdirSync(dir).map((f) => dir + f));
  await page.waitForFunction(() => document.querySelectorAll('.results li').length >= 11, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const res = await page.locator('.results li').allTextContents();
  console.log('upload results:\n  ' + res.map((x) => x.replace(/\s+/g, ' ').trim()).join('\n  '));
  const t = (await page.textContent('#page-history')).replace(/\s+/g, ' ');
  console.log('summary:', t.match(/Summary.{0,230}/)?.[0]);
  console.log('suggestion:', t.match(/(Suggested|suggest)[^.]{0,200}\./i)?.[0] ?? 'none');
  const rows = await page.locator('tr:has([data-climb])').allTextContents();
  console.log('runs table:\n  ' + rows.map((x) => x.replace(/\s+/g, ' ').trim()).join('\n  '));
  // treadmill run: open the editor
  const idx = rows.findIndex((r) => /indoor/.test(r));
  await page.locator('[data-climb]').nth(idx).click(); await page.waitForSelector('#climb-editor');
  console.log('treadmill editor rows:', await page.locator('[data-climb-val]').count(), '| basis', await page.locator('[data-climb-basis]').inputValue());
  const vals = [0, 6, 1, 7, 1, 7, 1, 7, 1, 8, 1, 8, 1, 0];
  for (let i = 0; i < vals.length; i++) await page.locator('[data-climb-val]').nth(i).fill(String(vals[i]));
  await page.click('[data-climb-do="save"]'); await page.waitForTimeout(500);
  const rows2 = await page.locator('tr:has([data-climb])').allTextContents();
  console.log('after typing:', rows2.find((r) => /indoor/.test(r)).replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: '/tmp/shots/coros_export_history.png', fullPage: true });
  await browser.close();
})();

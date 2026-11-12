// Optional browser check (not part of npm test): needs Playwright, the app on http://localhost:8080 and the sample runs in e2e/fixtures.
const { chromium } = require('playwright');
const fx = require('./fixtures.cjs');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
  await page.goto('http://localhost:8080/index.html#history');
  await page.waitForSelector('#hist-files');
  await page.setInputFiles('#hist-files', fx.outdoor());
  await page.waitForSelector('.results li', { state: 'attached' });
  await page.waitForTimeout(600);
  const txt = async () => (await page.textContent('#page-settings')).replace(/\s+/g, ' ');
  const hist = async () => (await page.textContent('#page-history')).replace(/\s+/g, ' ');
  // mark 8 Nov as race, then go to Settings > Backup where housekeeping lives
  await page.locator('[data-race]').first().check();
  await page.waitForTimeout(300);
  await page.click('[data-page="settings"]'); await page.click('#page-settings [data-tab="backup"]'); await page.waitForTimeout(600);
  console.log('usage:', (await txt()).match(/Stored data.{0,200}/)[0]);
  await page.fill('[data-hk-field="to"]', '2026-11-30'); await page.fill('[data-hk-field="from"]', '2026-10-01');
  await page.waitForTimeout(300);
  console.log('range msg:', (await txt()).match(/\d+ runs? in [^.]*\./)[0]);
  await page.click('[data-hk="delete"]');
  await page.click('[data-hk="delete-confirm"]');
  await page.waitForTimeout(600);
  console.log('after delete:', (await txt()).match(/\d+ runs? deleted\./)?.[0], '| activities:', (await (async () => { await page.click('[data-page="history"]'); await page.waitForTimeout(400); const t = (await hist()).match(/Activities \(\d+\)/)?.[0]; await page.click('[data-page="settings"]'); await page.click('#page-settings [data-tab="backup"]'); await page.waitForTimeout(500); return t; })()));
  await page.click('[data-hk="check"]'); await page.waitForTimeout(400);
  console.log('check:', (await txt()).match(/Everything is consistent[^.]*\./)?.[0] ?? (await txt()).match(/Check stored data.{0,200}/)[0]);
  // plant an orphan stream directly and re-check
  await page.evaluate(() => new Promise((res, rej) => { const rq = indexedDB.open('RunTrainingApp'); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction('streams', 'readwrite'); tx.objectStore('streams').put({ runId: 9999, t: [] }); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; rq.onerror = () => rej(rq.error); }));
  await page.click('[data-hk="check"]'); await page.waitForTimeout(400);
  console.log('with orphan:', (await txt()).match(/\d+ leftover[^.]*\./)?.[0]);
  await page.click('[data-hk="fix"]'); await page.waitForTimeout(600);
  console.log('after fix:', (await txt()).match(/Cleaned up[^.]*\./)?.[0], '|', (await txt()).match(/Everything is consistent[^.]*\./)?.[0]);
  await page.screenshot({ path: '/tmp/shots/hk.png', fullPage: true });
  await browser.close();
})();

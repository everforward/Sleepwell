const { createRequire } = require('node:module');
const path = require('node:path');
const assert = require('node:assert/strict');
const dependencyRoot = process.env.NIGHTCAT_NODE_MODULES || 'C:/Users/19237/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const runtime = createRequire(path.join(dependencyRoot, 'runtime.js'));
const BASE = 'http://127.0.0.1:' + (process.env.NIGHTCAT_PREVIEW_PORT || 4180);
async function main() {
  const browser = await runtime('playwright').chromium.launch({ headless: true, executablePath: process.env.NIGHTCAT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const width of [375,390]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 844 });
      await page.goto(BASE + '/record');
      await page.evaluate(() => {
        localStorage.setItem('sleepwell.sleep.v1', JSON.stringify([{ id: 'test', nightDate: '2026-08-01', bedTime: '22:00', wakeTime: '07:00', feeling: 4 }]));
        localStorage.setItem('sleepwell.journal.v1', JSON.stringify([{ id: 'journal-test', createdAt: Date.now(), date: '10 月 11 日', items: ['感谢今天完成实验。'.repeat(12)] }]));
        previewPage.setData({ year:2026,month:7 }); previewPage.refresh();
      });
      assert.equal(await page.locator('.day').count(),42);
      assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth),false);
      assert.equal(await page.evaluate(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0)),true);
      await page.locator('.day--early').click();
      assert.match(await page.locator('.detail-sheet').innerText(),/上床 22:00 · 早睡/);
      await page.getByRole('button',{ name:'关闭详情',exact:true }).click();
      await page.locator('.record-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const box = await page.locator('.journal-summary').boundingBox();
      assert.ok(box.height <= 40.1);
      const note = await page.locator('.record-note').last().boundingBox();
      const nav = await page.locator('.record-nav').boundingBox();
      assert.ok(note.y + note.height <= nav.y);
      await page.screenshot({ path: path.resolve(__dirname,'../docs/design/record-data-' + width + '.png') });
      await page.locator('.journal-row').click();
      assert.match(await page.locator('.journal-full').innerText(),/感谢今天完成实验/);
      await page.getByRole('button',{ name:'关闭详情',exact:true }).click();
      await page.getByRole('button',{ name:'全部',exact:true }).click();
      assert.equal(await page.locator('.journal-all .journal-row').count(),1);
      await page.getByRole('button',{ name:'返回记录',exact:true }).click();
      await page.getByRole('button',{ name:'呼吸',exact:true }).click();
      assert.equal(await page.evaluate(() => lastNavigation.url),'/pages/breathe/index');
      console.log(width + ': six-row calendar, assets, details, long journals, safe area and navigation passed');
    }
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

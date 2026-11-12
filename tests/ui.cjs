'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '..', 'container-opener.user.js'), 'utf8');
async function run() {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined });
    try {
        for (const width of [1280, 390, 320]) {
            const page = await browser.newPage({ viewport: { width, height: width === 320 ? 568 : 900 } });
            const errors = []; page.on('pageerror', error => errors.push(error.message));
            await page.context().addCookies([{ name: 'rfc_v', value: 'fixture-token', domain: 'www.torn.com', path: '/' }]);
            await page.addInitScript(() => {
                const values = { ql_container_opener_settings_v2: { blacklist: ['Donator Pack'], plans: { 'Zip Wallet': { selected: true, limit: 2, keep: 0 } } },
                    ql_container_opener_prices_v1: { fetchedAt: Date.now(), items: { 1082: { name: 'Zip Wallet', price: 1000 }, 199: { name: 'LSD', price: 2000 } } } };
                window.GM_getValue = (key, fallback) => key in values ? values[key] : fallback;
                window.GM_setValue = (key, value) => values[key] = value;
            });
            let calls = 0;
            await page.route('https://www.torn.com/**', async route => {
                if (route.request().method() !== 'POST') {
                    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#ddd"><h1>Offline inventory fixture</h1><ul><li data-item="1082" data-qty="3" data-category="Supply Pack"><span class="name-wrap">Zip Wallet</span><span class="item-amount qty">3</span></li><li data-item="199" data-qty="5"><span class="name-wrap">LSD</span><span class="item-amount qty">5</span></li></ul><div style="position:fixed;bottom:0;right:0"><button id="notes_panel_button" style="width:38px;height:38px">N</button><button id="flipr-dock-btn">F</button></div></body>' }); return;
                }
                if (new URLSearchParams(route.request().postData()).get('step') === 'getCategoryList') {
                    await route.fulfill({contentType:'application/json',body:JSON.stringify({count:1,list:[{ID:1082,name:'Zip Wallet',Qty:3-calls}]})}); return;
                }
                calls++;
                assert.equal(route.request().postData(), 'step=useItem&id=1082&itemID=1082');
                await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, itemID: 1082,
                    armoryID: calls === 1 ? 21899289699 : 21868925758, nextArmoryId: calls === 1 ? 21868925758 : 21868925759, isAnotherAvailable: true,
                    text: calls === 1 ? 'You received $130 and 1x LSD' : 'You received $10', items: { itemDisappear: [{ ID: 1082, qty: 1 }],
                        itemAppear: calls === 1 ? [{ isMoney: true, moneyGain: '$130' }, { ID: 199, qty: 1, name: 'LSD' }] : [{ isMoney: true, moneyGain: '$10' }] } }) });
            });
            await page.goto('https://www.torn.com/item.php'); await page.bringToFront(); await page.addScriptTag({ content: source });
            assert.equal(calls, 0); assert.equal(await page.locator('#chatRoot #qlco-dock-button').count(), 0);
            await page.locator('#ql-open').click();
            await page.waitForSelector('#qlco-result-overlay .jackpot');
            assert.match(await page.locator('.ql-result-number').innerText(), /1,130/);
            assert.match(await page.locator('.ql-loot').innerText(), /LSD/);
            assert.equal(calls, 1);
            assert.equal(await page.locator('li[data-item="1082"]').getAttribute('data-qty'), '2');
            assert.equal(await page.locator('li[data-item="1082"] .qty').textContent(), '2');
            assert.equal(await page.locator('li[data-item="199"] .qty').textContent(), '6');
            const bounds = await page.locator('.ql-dialog').boundingBox();
            assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1);
            assert.equal(await page.locator('.ql-dialog').evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
            const primaryBounds = await page.locator('.ql-dialog-actions .primary').boundingBox();
            assert(primaryBounds.y + primaryBounds.height <= (width === 320 ? 568 : 900), 'CTA stays on screen');
            await page.screenshot({ path: path.join(__dirname, `preview-3.0.2-win-${width}.png`), animations: 'disabled' });
            await page.locator('.ql-dialog-actions .primary').click();
            await page.waitForFunction(() => document.querySelector('#ql-dialog-title')?.textContent === '2 containers opened');
            assert.equal(await page.locator('li[data-item="1082"] .qty').textContent(), '1');
            assert.equal(await page.locator('li[data-item="199"] .qty').textContent(), '6');
            assert.equal(calls, 2); assert.match(await page.locator('.ql-result-number').innerText(), /140/);
            assert.match(await page.locator('.ql-consumed').innerText(), /2× Zip Wallet.*2,000/s);
            await page.screenshot({ path: path.join(__dirname, `preview-3.0.2-summary-${width}.png`), animations: 'disabled' });
            await page.locator('.ql-dialog-close').click();
            assert.equal(await page.locator('#ql-open').isDisabled(), true, 'round limit respected');
            await page.locator('[data-action=finish]').click();
            assert.equal(calls, 2, 'summary dispatches no game requests');
            await page.locator('.ql-dialog-actions .primary').click();
            assert.equal(await page.locator('#ql-count').textContent(), '0');
            await page.locator('[data-action=collapse]').click(); await page.locator('#qlco-dock-button').click();
            assert.equal(await page.locator('#qlco-v2').isVisible(), true);
            assert.deepEqual(errors, []);
            console.log(`PASS ${width}px: jackpot popup, next-click request, automatic complete summary, accounting, mobile bounds, fresh round and docking`);
            await page.close();
        }
        // Missing prices must never produce a loss/win claim. Exercise API opt-in without a real key.
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.context().addCookies([{ name: 'rfc_v', value: 'fixture-token', domain: 'www.torn.com', path: '/' }]);
        await page.addInitScript(() => {
            const values = {};
            window.GM_getValue = (key, fallback) => values[key] ?? fallback;
            window.GM_setValue = (key, value) => values[key] = value;
            window.GM_xmlhttpRequest = options => {
                if (!options.url.startsWith('https://api.torn.com/torn/')) throw new Error('unexpected destination');
                options.onload({ status: 200, responseText: JSON.stringify({ items: { 1082: { name: 'Zip Wallet', market_value: 1000 } } }) });
            };
        });
        let calls = 0;
        await page.route('https://www.torn.com/**', async route => {
            if (route.request().method() !== 'POST') { await route.fulfill({ contentType: 'text/html', body: '<!doctype html><body><li data-item="1082" data-qty="3"><span class="name-wrap">Zip Wallet</span></li></body>' }); return; }
            if (new URLSearchParams(route.request().postData()).get('step') === 'getCategoryList') {
                await route.fulfill({contentType:'application/json',body:JSON.stringify({count:1,list:[{ID:1082,name:'Zip Wallet',Qty:3-calls}]})}); return;
            }
            calls++;
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, itemID: 1082, armoryID: calls === 1 ? 21899289699 : 21868925758,
                nextArmoryId: calls === 1 ? 21868925758 : 21868925759, isAnotherAvailable: true, text: 'You received $10', items: { itemDisappear: [{ ID: 1082, qty: 1 }], itemAppear: [{ isMoney: true, moneyGain: '$10' }] } }) });
        });
        await page.goto('https://www.torn.com/item.php'); await page.bringToFront(); await page.addScriptTag({ content: source });
        await page.locator('[data-allow="Zip Wallet"]').check(); await page.locator('#ql-open').click();
        await page.waitForSelector('.ql-dialog.neutral'); assert.match(await page.locator('.ql-result-number').innerText(), /Price unavailable/);
        await page.locator('.ql-dialog-close').click();
        await page.locator('[data-action=api-settings]').click();
        assert.equal(await page.locator('#ql-pricing').getAttribute('open'), '');
        assert.equal(await page.locator('#ql-api-key').evaluate(node => node === document.activeElement), true);
        await page.locator('#ql-api-key').fill('fixtureKey123456'); await page.locator('[data-action=prices]').click();
        await page.waitForFunction(() => document.querySelector('#ql-price-status').textContent.includes('Prices fetched'));
        await page.locator('#ql-open').click(); await page.waitForSelector('.ql-dialog.loss');
        assert.match(await page.locator('.ql-result-number').innerText(), /990/);
        await page.screenshot({ path: path.join(__dirname, 'preview-3.0.2-loss-390.png'), animations: 'disabled' });
        await page.locator('.ql-dialog-close').click(); await page.locator('[data-action=finish]').click();
        assert.match(await page.locator('.ql-result-number').innerText(), /Price unavailable/, 'earlier unknown result must not be silently repriced');
        assert.equal(calls, 2); console.log('PASS missing-price neutrality, API opt-in, loss popup and immutable historical valuation');
        await page.close();
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

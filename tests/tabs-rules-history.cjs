const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'container-opener.user.js'), 'utf8');
(async () => {
 const browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined});
 try {
  for (const width of [320, 390, 1280]) for (const upgrade of [false, true]) {
   const page = await browser.newPage({viewport: {width, height: 844}});
   const errors = []; page.on('pageerror', e => errors.push(e.message));
   await page.context().addCookies([{name:'rfc_v', value:'fixture-token', domain:'.torn.com', path:'/'}]);
   await page.addInitScript(() => {
    window.GM_getValue = (k,d) => JSON.parse(localStorage.getItem(k)) ?? d;
    window.GM_setValue = (k,v) => localStorage.setItem(k,JSON.stringify(v));
   });
   let calls = 0;
   await page.route('https://www.torn.com/**', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><ul class="items-cont" id="supply-pack-items"><li data-item="1082" data-qty="3"><span class="name-wrap">Zip Wallet</span></li><li data-item="999" data-qty="8"><span class="name-wrap">Old Wallet</span></li></ul></body>'});
    if (new URLSearchParams(route.request().postData()).get('step') === 'getCategoryList')
     return route.fulfill({contentType:'application/json',body:JSON.stringify({count:2,list:[{ID:1082,name:'Zip Wallet',Qty:3-calls},{ID:999,name:'Old Wallet',Qty:8}]})});
    calls++;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({
     success:true, itemID:1082, armoryID:21899289699, nextArmoryId:21868925758,
     isAnotherAvailable:true, text:'You received $130',
     items:{itemDisappear:[{ID:1082,qty:1}],itemAppear:[{isMoney:true,moneyGain:'$130'}]}
    })});
   });
   await page.goto('https://www.torn.com/item.php');
   if (upgrade) await page.evaluate(() => {
    GM_setValue('ql_container_opener_settings_v2',{blacklist:['Donator Pack'],plans:{'Zip Wallet':{selected:false,limit:4,keep:2}}});
    GM_setValue('ql_container_opener_api_key_v1','fixtureKey123456');
    GM_setValue('ql_container_opener_prices_v1',{fetchedAt:Date.now(),items:{1082:{name:'Zip Wallet',price:100}}});
   });
   await page.addScriptTag({content:source});
   assert.equal(await page.locator('#qlco-quick-open').isVisible(),false);
   if (!upgrade) {
    assert.equal(await page.locator('[data-allow]:checked').count(),0,'new installations start with no items selected');
    assert.equal(await page.locator('#ql-open').isDisabled(),false,'inventory loading stays available');
    assert.equal(await page.locator('[data-field=keep]').count(),0);
    for (const name of ['Zip Wallet','Old Wallet','Clutch']) await page.locator('[data-allow="'+name+'"]').check();
   } else {
    assert.equal(await page.locator('[data-allow="Donator Pack"]').isChecked(),false,'old blacklist remains excluded');
   }

   assert.equal(await page.locator('[data-field=selected]').count(),0,'no per-item opt-in');
   assert.equal(await page.locator('#ql-open').textContent(),'Open Zip Wallet','selected and migrated containers are eligible');
   await page.locator('[data-allow="Zip Wallet"]').uncheck();
   assert.equal(await page.locator('[data-name="Zip Wallet"] [data-field=keep]').count(),0,'blocked items have no minimum field');
   assert.equal(await page.locator('#ql-open').textContent(),'Open Old Wallet','automatically moves to next selected type');
   await page.locator('[data-allow="Old Wallet"]').uncheck();
   assert.equal(calls,0,'changing selections never opens anything');
   await page.locator('[data-allow="Zip Wallet"]').check();
   assert.equal(await page.locator('#ql-open').textContent(),'Open Zip Wallet');
   assert.equal(await page.locator('[data-name="Zip Wallet"] [data-field=keep]').inputValue(),upgrade?'2':'0','unblocking preserves minimum');
   assert.equal(await page.locator('[data-name="Clutch"] [data-field=keep]').count(),1,'rules available before item is owned');
   await page.locator('[data-name="Clutch"] [data-field=keep]').fill('7');
   await page.locator('[data-name="Clutch"] [data-field=keep]').press('Tab');
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   if (await page.locator('.ql-edit-done').isVisible()) await page.locator('.ql-edit-done').click();
   await page.locator('[data-allow="Clutch"]').uncheck();
   assert.equal(await page.locator('[data-name="Clutch"] [data-field=keep]').count(),0);
   await page.locator('[data-allow="Clutch"]').check();
   assert.equal(await page.locator('[data-name="Clutch"] [data-field=keep]').inputValue(),'7');


   if (!upgrade) {
    await page.locator('[data-name="Zip Wallet"] [data-field=keep]').fill('2');
    await page.locator('[data-name="Zip Wallet"] [data-field=keep]').press('Tab');
   }
   assert.equal(await page.locator('[data-name="Zip Wallet"] [data-field=keep]').inputValue(),'2');
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   if (await page.locator('.ql-edit-done').isVisible()) await page.locator('.ql-edit-done').click();
   await page.screenshot({path:path.join(__dirname,'items-to-open-'+width+'-'+upgrade+'.png')});
   await page.locator('[data-tab=settings]').click();
   assert.equal(await page.locator('#ql-api-key').isVisible(),true);
   await page.locator('#ql-quick-enabled').check();
   assert.equal(await page.locator('#qlco-quick-open').isVisible(),true);
   await page.locator('[data-tab=history]').click();
   assert.match(await page.locator('#ql-history').textContent(),/No saved/);
   for (const tab of ['rules','settings','history']) {
    await page.locator('[data-tab='+tab+']').click();
    assert.equal(await page.locator('[role=tabpanel]:visible').count(),1);
    assert.equal(await page.locator('#qlco-v2').evaluate(n => n.scrollWidth > n.clientWidth + 1),false);
   }
   await page.locator('[data-tab=history]').press('ArrowRight');
   assert.equal(await page.locator('[data-tab=rules]').getAttribute('aria-selected'),'true');
   await page.locator('[data-action=collapse]').click();
   assert.equal(calls,0,'no opening from navigation/settings');
   await page.locator('#qlco-quick-open').click();
   await page.waitForSelector('#qlco-result-overlay');
   assert.equal(calls,1);
   await page.locator('.ql-dialog-close').click();
   await page.locator('#qlco-quick-open').click();
   await page.waitForFunction(()=>document.querySelector('#ql-status').textContent.startsWith('Supply Packs loaded.'));
   assert.equal(calls,1,'keep minimum prevents second opening');
   await page.locator('#qlco-dock-button').click();
   assert.equal(await page.locator('#ql-open').isDisabled(),false,'inventory loading stays available');
   await page.locator('[data-tab=history]').click();
   assert.match(await page.locator('#ql-history').textContent(),/Zip Wallet.*130/s);
   await page.locator('[data-action=finish]').click();
   await page.locator('.ql-dialog-actions .primary').click();
   assert.match(await page.locator('#ql-history').textContent(),/Zip Wallet/,'new round preserves history');
   await page.locator('#qlco-quick-open').click();
   await page.waitForFunction(()=>document.querySelector('#ql-status').textContent.startsWith('Supply Packs loaded.'));
   assert.equal(calls,1,'new round cannot bypass minimum');
   await page.reload(); await page.addScriptTag({content:source.replace("'Drug Pack',", "'Future Container', 'Drug Pack',")});
   assert.equal(await page.locator('[data-allow="Future Container"]').isChecked(),false,'new item types require explicit selection');

   assert.equal(await page.locator('[data-allow="Old Wallet"]').isChecked(),false,'unchecked selection survives reload');
   assert.equal(await page.locator('[data-name="Old Wallet"] [data-field=keep]').count(),0);
   assert.equal(await page.locator('[data-allow="Zip Wallet"]').isChecked(),true);
   assert.equal(await page.locator('[data-name="Zip Wallet"] [data-field=keep]').inputValue(),'2');

   await page.locator('[data-tab=history]').click();
   assert.match(await page.locator('#ql-history').textContent(),/Zip Wallet.*130/s);
   assert.equal(await page.locator('#ql-history li').count(),1);
   await page.locator('[data-tab=settings]').click();
   assert.equal(await page.locator('#ql-quick-enabled').isChecked(),true);
   if (upgrade) assert.match(await page.locator('#ql-key-state').textContent(),/Key saved/);
   await page.locator('#ql-quick-enabled').uncheck();
   assert.equal(await page.locator('#qlco-quick-open').isVisible(),false);
   assert.equal(calls,1);
   assert.deepEqual(errors,[]);
   await page.screenshot({path:path.join(__dirname,'tabs-'+width+'-'+upgrade+'.png')});
   console.log('PASS',width,upgrade?'upgrade':'fresh','tabs, button, minimum, history persistence, preferences');
   await page.close();
  }
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});

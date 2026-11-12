const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','container-opener.user.js'),'utf8');
(async()=>{const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});try{
for(const gm of [true,false]){
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body></body>'}));
 await page.addInitScript(gm=>{
  if(gm){window.GM_getValue=(k,d)=>JSON.parse(localStorage.getItem('fixture-gm-'+k))??d;window.GM_setValue=(k,v)=>localStorage.setItem('fixture-gm-'+k,JSON.stringify(v));}
  window.apiCalls=[];window.GM_xmlhttpRequest=o=>{const u=new URL(o.url);if(u.origin!=='https://api.torn.com')throw Error('Unexpected key destination');apiCalls.push(u.searchParams.get('key'));o.onload({status:200,responseText:JSON.stringify(window.rejectKey?{error:{code:13}}:{items:{1082:{name:'Zip Wallet',market_value:1000}}})});};
 },gm);
 await page.goto('https://www.torn.com/item.php');await page.addScriptTag({content:source});
 assert.match(await page.locator('#ql-key-state').textContent(),/No key/);
 await page.locator('[data-action=api-settings]').click();await page.locator('#ql-api-key').fill('fixtureKey123456');await page.locator('[data-action=prices]').click();
 assert.match(await page.locator('#ql-key-state').textContent(),/Key saved/);
 const prefix=gm?'fixture-gm-':'';
 assert.equal(await page.evaluate(prefix=>JSON.parse(localStorage.getItem(prefix+'ql_container_opener_api_key_v1')),prefix),'fixtureKey123456');
 // Reload with preserved storage models replacing script code in the same userscript identity.
 await page.reload();await page.addScriptTag({content:source});assert.match(await page.locator('#ql-key-state').textContent(),/Key saved/);assert.equal(await page.locator('#ql-api-key').inputValue(),'');
 assert.equal(await page.evaluate(()=>apiCalls.length),0,'fresh cache needs no key request');
 await page.evaluate(prefix=>localStorage.removeItem(prefix+'ql_container_opener_prices_v1'),prefix);await page.reload();await page.addScriptTag({content:source});assert.deepEqual(await page.evaluate(()=>apiCalls),['fixtureKey123456'],'saved key reused after update and cache expiry');
 await page.locator('[data-action=api-settings]').click();await page.evaluate(()=>window.rejectKey=true);await page.locator('[data-action=prices]').click();assert.match(await page.locator('#ql-price-status').textContent(),/rejected/);
 assert.equal(await page.evaluate(prefix=>JSON.parse(localStorage.getItem(prefix+'ql_container_opener_api_key_v1')),prefix),'fixtureKey123456','API errors must retain key');
 await page.locator('[data-action=forget-key]').click();assert.equal(await page.evaluate(prefix=>JSON.parse(localStorage.getItem(prefix+'ql_container_opener_api_key_v1')),prefix),'');
 assert.match(await page.locator('#ql-key-state').textContent(),/No key/);assert.deepEqual(errors,[]);console.log('PASS',gm?'GM storage':'localStorage fallback','save, retained on reload/update, automatic reuse, API error retention, explicit removal');await page.close();
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

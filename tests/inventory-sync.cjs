const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','container-opener.user.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
 try{
 for(const scenario of ['last','already-updated','failed']){
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.context().addCookies([{name:'rfc_v',value:'fixture-token',domain:'www.torn.com',path:'/'}]);
 await page.route('https://www.torn.com/**',async r=>{
  if(r.request().method()!=='POST')return r.fulfill({contentType:'text/html',body:'<!doctype html><body><ul><li data-item="1082" data-qty="'+(scenario==='last'?1:3)+'" data-armory-id="21899289699"><span class="name-wrap">Zip Wallet</span><span class="item-amount qty">'+(scenario==='last'?1:3)+'</span></li></ul></body>'});
  if(scenario==='failed')return r.fulfill({status:500,body:'error'});
  if(scenario==='already-updated')await page.evaluate(()=>{
   const row=document.querySelector('li[data-item]');
   row.dataset.qty='2';row.querySelector('.qty').textContent='2';
  });
  await r.fulfill({contentType:'application/json',body:JSON.stringify({success:true,itemID:1082,armoryID:21899289699,nextArmoryId:21868925758,isAnotherAvailable:scenario!=='last',text:'You received $10',items:{itemDisappear:[{ID:1082,qty:1}],itemAppear:[{isMoney:true,moneyGain:'$10'}]}})});
 });
 await page.goto('https://www.torn.com/item.php');await page.addScriptTag({content:source});
 await page.locator('#ql-open').click();
 if(scenario==='failed'){
  await page.waitForFunction(()=>document.querySelector('#ql-status').textContent.includes('HTTP 500'));
  assert.equal(await page.locator('li[data-item] .qty').textContent(),'3');
  assert.equal(await page.locator('#ql-count').textContent(),'0');
 }else{
  await page.waitForSelector('#qlco-result-overlay');
  if(scenario==='last')assert.equal(await page.locator('li[data-item]').count(),0);
  else assert.equal(await page.locator('li[data-item] .qty').textContent(),'2','native updates must not be counted twice');
 }
 assert.deepEqual(errors,[]);await page.close();console.log('PASS inventory sync:',scenario);
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

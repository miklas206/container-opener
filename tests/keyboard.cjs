const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});try{
for(const width of [320,390])for(const saved of [false,true]){
 const page=await browser.newPage({viewport:{width,height:844},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://www.torn.com/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><li data-item="1082" data-qty="3"><span class="name-wrap">Zip Wallet</span></li></body>'}));
 await page.goto('https://www.torn.com/item.php');
 await page.evaluate(saved=>{window.values=saved?{ql_container_opener_settings_v2:{blacklist:['Donator Pack'],plans:{}}}:{};window.GM_getValue=(k,d)=>k in values?values[k]:d;window.GM_setValue=(k,v)=>values[k]=v;const vv=new EventTarget();vv.height=844;vv.offsetTop=0;Object.defineProperty(window,'visualViewport',{value:vv});},saved);
 await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'..','container-opener.user.js'),'utf8')});
 await page.locator('[data-action=api-settings]').click();
 for(const [height,offset] of [[300,0],[260,90],[210,120]]){
  await page.evaluate(([h,o])=>{visualViewport.height=h;visualViewport.offsetTop=o;visualViewport.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('scroll'));},[height,offset]);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const box=await page.locator('#ql-api-key').boundingBox();assert(box.y>=offset&&box.y+box.height<=offset+height,JSON.stringify(box));
  assert.equal(await page.locator('#qlco-v2>footer').isVisible(),false);
  await page.locator('#ql-api-key').fill('fixtureKey123456');
 }
 await page.screenshot({path:path.join(__dirname,`keyboard-${width}-${saved?'upgrade':'fresh'}.png`)});
 await page.locator('.ql-edit-done').click();assert.equal(await page.locator('#qlco-v2>footer').isVisible(),true);
 await page.locator('#ql-pricing').evaluate(n=>n.open=false);
 await page.locator('[data-tab=rules]').click();
 const number=page.locator('[data-field=keep]').first();await number.focus();
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const box=await number.boundingBox();assert(box.y>=120&&box.y+box.height<=330,JSON.stringify(box));
 await page.locator('.ql-edit-done').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 console.log('PASS',width,saved?'upgrade':'fresh','API/number inputs visible with keyboard height and panning; Done restores footer');await page.close();
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','container-opener.user.js'),'utf8');
// Relevant desktop DOM supplied by the user: nested action LI repeats the item ID.
const row=`<li class="first-in-row m-first-in-row t-first-in-row" data-class="" data-equipped="false" data-loaded="0" data-item="1080" data-rowkey="g1080" data-category="Supply Pack" data-sort="1 Billfold" data-qty="4">
 <div class="thumbnail-wrap" tabindex="0" aria-label="Billfold"><div class="thumbnail">
  <span class="item-plate"><img class="torn-item medium" src="/images/items/1080/medium.png" alt="Billfold"></span>
  <div class="item-amount qty">4</div><div class="hover"><button class="item-info wai-btn">Info</button></div>
 </div></div>
 <div class="title-wrap" draggable="true"><div class="title left"><span class="image-wrap"><img src="/images/items/1080/medium.png" alt="Billfold"></span>
  <span class="name-wrap"><span class="qty bold d-hide">x4</span><span class="name">Billfold</span><span class="qty bold t-hide">x4</span><span class="tt-item-price"><span>$40,029 | </span><span class="tt-item-quantity">4x = </span><span>$160,116</span></span></span>
 </div></div>
 <div class="cont-wrap"><div class="actions right"><ul class="actions-wrap">
  <li class="left use t-overflow" data-action="use" data-id="1080" data-armory="21973179879"><span class="icon-h"><button class="option-use wai-btn" aria-label="Open Billfold"></button><span class="opt-name">Open <span class="t-hide">this Item</span></span></span></li>
  <li class="left send" data-action="send" data-name="Billfold" data-type="item" data-id="1080"><button class="option-send">Send</button></li>
  <li class="left dump" data-action="dump" data-type="item" data-type2="Supply Pack" data-item="1080" data-id="1080" data-name="Billfold"><button class="option-delete">Trash</button></li>
 </ul></div></div>
</li>`;
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
 try{const page=await browser.newPage();let opens=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.context().addCookies([{name:'rfc_v',value:'fixture-token',domain:'www.torn.com',path:'/'}]);
 await page.addInitScript(()=>{
  const values={ql_container_opener_settings_v2:{speedOpen:true,allowedItems:['Billfold'],plans:{Billfold:{keep:3}}}};
  window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;
 });
 await page.route('https://www.torn.com/**',r=>{
  if(r.request().resourceType()==='image')return r.fulfill({status:204,body:''});
  if(r.request().method()!=='POST')return r.fulfill({contentType:'text/html; charset=utf-8',body:`<body><ul class="items-cont" id="supply-pack-items">${row}</ul></body>`});
  opens++;assert.equal(new URLSearchParams(r.request().postData()).get('step'),'useItem');
  return r.fulfill({json:{success:true,itemID:1080,isAnotherAvailable:true,text:'Received $10',items:{itemDisappear:[{ID:1080,qty:1}],itemAppear:[{isMoney:true,moneyGain:'$10'}]}}});
 });
 await page.goto('https://www.torn.com/item.php');await page.addScriptTag({content:source});
 assert.match(await page.locator('#qlco-v2 [data-name="Billfold"]').textContent(),/4 remaining/);
 await page.locator('#ql-find').click();
 assert.match(await page.locator('#qlco-v2 [data-name="Billfold"]').textContent(),/4 remaining/,'rescan must not replace item with nested Trash action');
 await page.locator('#ql-open').click();await page.waitForFunction(()=>document.querySelector('#ql-count').textContent==='1');
 assert.match(await page.locator('#qlco-v2 [data-name="Billfold"]').textContent(),/3 remaining/);
 assert.equal(await page.locator('#supply-pack-items > li').getAttribute('data-qty'),'3');
 await page.locator('#ql-find').click();await page.locator('#ql-open').click();
 await page.waitForTimeout(300);assert.equal(opens,1,'keep minimum survives observer and manual rescans');
 assert.equal(await page.locator('.actions-wrap [data-action=dump]').count(),1,'native actions preserved');
 assert.deepEqual(errors,[]);console.log('PASS supplied desktop row: nested action IDs, rescans and keep minimum');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

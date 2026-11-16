const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','container-opener.user.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
 try {for(const [label,markup,count] of [
  ['inline','<span class="name-wrap">Zip Wallet x4</span><span class="price">$6,052 | 4x = $24,208</span>',4],
  ['nested','<span class="name-wrap"><b class="name">Zip Wallet</b><span>x4</span></span>',4],
  ['empty-first','<span class="item-amount"></span><span class="name-wrap">Zip Wallet ×4</span>',4],
  ['suffix','<span class="name-wrap">Zip Wallet</span><span class="item-amount">4x</span>',4],
  ['no-space','<span class="name-wrap"><b>Zip Wallet</b><span>x4</span></span>',4],
  ['grouped','<span class="name-wrap">Zip Wallet x1,004</span>',1004],
  ['price-only','<span class="name-wrap">Zip Wallet</span><span class="price">$6,052 | 4x = $24,208</span>',null],
  ['invalid','<span class="name-wrap">Zip Wallet x1,2</span>',null],
 ]){
  const page=await browser.newPage();let requests=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:'rfc_v',value:'fixture-token',domain:'www.torn.com',path:'/'}]);
  await page.addInitScript(keep=>{
   const values={ql_container_opener_settings_v2:{speedOpen:true,allowedItems:['Zip Wallet'],plans:{'Zip Wallet':{keep}}}};
   window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;
  },count===null?0:count-1);
  await page.route('https://www.torn.com/**',async r=>{
   if(r.request().method()!=='POST')return r.fulfill({contentType:'text/html; charset=utf-8',body:`<body><ul class="items-cont" id="supply-pack-items"><li data-item="1082">${markup}</li><li data-item="1081"><span class="name-wrap">Billfold x3</span></li></ul></body>`});
   requests++;assert.equal(new URLSearchParams(r.request().postData()).get('step'),'useItem');
   return r.fulfill({json:{success:true,itemID:1082,isAnotherAvailable:true,text:'Received $10',items:{itemDisappear:[{ID:1082,qty:1}],itemAppear:[{isMoney:true,moneyGain:'$10'}]}}});
  });
  await page.goto('https://www.torn.com/item.php');await page.addScriptTag({content:source});
  assert.match(await page.locator('[data-name="Billfold"]').textContent(),/3 remaining/);
  assert.match(await page.locator('[data-name="Zip Wallet"]').textContent(),count===null?/Quantity unknown/:new RegExp(count+' remaining'));
  await page.locator('#ql-open').click();
  if(count!==null){
   await page.waitForFunction(()=>document.querySelector('#ql-count').textContent==='1');
   assert.match(await page.locator('[data-name="Zip Wallet"]').textContent(),new RegExp((count-1)+' remaining'));
   assert.match(await page.locator('li[data-item="1082"]').textContent(),new RegExp((count-1).toLocaleString('en-US')));
   if(label==='nested'||label==='no-space')assert.equal(await page.locator('li[data-item="1082"] b').count(),1,'native name markup retained');
   if(label==='inline')assert.equal(await page.locator('.price').textContent(),'$6,052 | 4x = $24,208','price text is never used or overwritten as quantity');
   await page.locator('#ql-open').click();
  }
  await page.waitForTimeout(100);
  assert.equal(requests,count===null?0:1,'no automatic repeats or opening below keep minimum');
  assert.deepEqual(errors,[]);await page.close();console.log('PASS visible quantity:',label);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

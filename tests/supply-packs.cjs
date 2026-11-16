const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','container-opener.user.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
 try{for(const scenario of ['visible','hidden','missing','busy','minimum','no-selection','unknown-quantity','faction','switched-away']){
  const page=await browser.newPage();let requests=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:'rfc_v',value:'fixture-token',domain:'www.torn.com',path:'/'}]);
  await page.addInitScript(s=>{
   const values={ql_container_opener_settings_v2:{speedOpen:true,allowedItems:s==='no-selection'?[]:['Zip Wallet'],plans:{'Zip Wallet':{keep:s==='minimum'?3:0}}}};
   window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;
  },scenario);
  await page.route('https://www.torn.com/**',async route=>{
   if(route.request().method()!=='POST')return route.fulfill({contentType:'text/html',body:`<body><button data-type="Supply Pack" onclick="window.categoryClicks=(window.categoryClicks||0)+1">Supply Packs</button>${scenario==='missing'?'':`<ul class="items-cont" id="supply-pack-items" ${scenario==='hidden'?'hidden':''} ${scenario==='busy'?'aria-busy="true"':''}><li data-item="1082" ${scenario==='unknown-quantity'?'':'data-qty="3"'} ${scenario==='faction'?'data-faction-id="123"':''}><span class="name-wrap">Zip Wallet</span></li></ul>`}</body>`});
   requests++;
   assert.equal(new URLSearchParams(route.request().postData()).get('step'),'useItem');
   return route.fulfill({json:{success:true,itemID:1082,isAnotherAvailable:true,text:'Received $10',items:{itemDisappear:[{ID:1082,qty:1}],itemAppear:[{isMoney:true,moneyGain:'$10'}]}}});
  });
  await page.goto('https://www.torn.com/item.php');await page.addScriptTag({content:source});
  await page.locator('#ql-find').click();
  assert.equal(requests,0,'reading visible rows sends no requests');
  if(scenario==='switched-away')await page.evaluate(()=>document.querySelector('ul').hidden=true);
  await page.locator('#ql-open').click();
  if(scenario==='visible')await page.waitForFunction(()=>document.querySelector('#ql-count').textContent==='1');
  await page.waitForTimeout(300);
  assert.equal(requests,scenario==='visible'?1:0);
  assert.equal(await page.evaluate(()=>window.categoryClicks||0),['hidden','missing','busy','switched-away'].includes(scenario)?1:0,'category switch uses one separate manual press');
  assert.deepEqual(errors,[]);await page.close();console.log('PASS visible inventory only:',scenario);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

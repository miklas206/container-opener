const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','container-opener.user.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
 try { for(const scenario of ['complete','failure','stop','blur']) {
  const page=await browser.newPage({viewport:{width:390,height:844}});let calls=[],loads=0,release;
  const gate=new Promise(r=>release=r),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:'rfc_v',value:'fixture-token',domain:'www.torn.com',path:'/'}]);
  await page.addInitScript(()=>{
   window.values={ql_container_opener_settings_v2:{allowedItems:['Zip Wallet','Old Wallet'],plans:{'Zip Wallet':{keep:2},'Old Wallet':{limit:1}},quickButton:true}};
   window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;
  });
  await page.route('https://www.torn.com/**',async r=>{
   if(r.request().method()!=='POST')return r.fulfill({contentType:'text/html',body:'<body><ul class="items-cont" id="supply-pack-items"></ul></body>'});
   const params=new URLSearchParams(r.request().postData());
   if(params.get('step')==='getCategoryList'){loads++;return r.fulfill({json:{count:3,list:[{ID:1082,name:'Zip Wallet',Qty:5},{ID:1080,name:'Old Wallet',Qty:5},{ID:1083,name:'Billfold',Qty:5}]}});}
   calls.push(params.get('XID')||params.get('id'));
   if(calls.length===2){await gate;if(scenario==='failure')return r.fulfill({status:500,body:'error'});}
   const itemID=calls.length<=3?1082:1080;
   return r.fulfill({json:{success:true,itemID,armoryID:params.get('XID')||'90000',nextArmoryId:String(90000+calls.length),isAnotherAvailable:true,text:'Received $10',items:{itemDisappear:[{ID:itemID,qty:1}],itemAppear:[{isMoney:true,moneyGain:'$10'}]}}});
  });
  await page.goto('https://www.torn.com/item.php');await page.addScriptTag({content:source});
  await page.locator('[data-tab=settings]').click();
  assert.equal(await page.locator('#ql-speed-open').isChecked(),false,'upgrade defaults off');
  await page.locator('#ql-speed-open').check();
  assert.equal(await page.evaluate(()=>values.ql_container_opener_settings_v2.speedOpen),true);
  await page.locator('#ql-open').click();
  await page.waitForFunction(()=>document.querySelector('#ql-count').textContent==='1');
  assert.equal(await page.locator('.ql-opening').count(),0);
  assert.equal(await page.locator('#ql-latest').isHidden(),true);
  assert.equal(await page.locator('#ql-open').isDisabled(),true);
  if(scenario==='stop')await page.locator('#ql-stop').click();
  if(scenario==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  release();await page.waitForSelector('.ql-summary');
  assert.equal(loads,1,'one inventory refresh for the whole batch');
  assert.deepEqual(calls,scenario==='complete'?['1082','90001','90002','1080']:['1082','90001']);
  const expected=scenario==='complete'?4:scenario==='failure'?1:2;
  assert.equal(await page.locator('#ql-count').textContent(),String(expected));
  assert.equal(await page.evaluate(()=>values.ql_container_opener_history_v1.length),expected);
  if(scenario==='failure')assert.match(await page.locator('.ql-summary').textContent(),/outcome is unknown/);
  if(['stop','blur'].includes(scenario))assert.match(await page.locator('.ql-summary').textContent(),/stopped/);
  await page.getByRole('button',{name:'Done',exact:true}).click();
  const stored=await page.evaluate(()=>values);
  await page.reload();
  await page.evaluate(data=>{window.values=data;},stored);
  await page.addScriptTag({content:source});
  assert.equal(await page.locator('#ql-speed-open').isChecked(),true,'Speed open retained after reload');
  assert.deepEqual(errors,[]);await page.close();console.log('PASS Speed open:',scenario);
 }} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

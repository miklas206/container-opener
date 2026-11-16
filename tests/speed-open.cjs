const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','container-opener.user.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
 try { for(const width of [320,390,1280]) for(const scenario of ['fresh','upgrade','failure','hidden-button']) {
  const page=await browser.newPage({viewport:{width,height:844}});let calls=[],release;
  const gate=new Promise(r=>release=r),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:'rfc_v',value:'fixture-token',domain:'www.torn.com',path:'/'}]);
  await page.addInitScript(upgrade=>{
   window.values={ql_container_opener_settings_v2:{speedOpen:upgrade,allowedItems:['Zip Wallet','Old Wallet'],plans:{'Zip Wallet':{keep:2},'Old Wallet':{limit:1}},quickButton:true}};
   window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;
  },scenario!=='fresh');
  await page.route('https://www.torn.com/**',async r=>{
   if(r.request().method()!=='POST')return r.fulfill({contentType:'text/html',body:'<body><ul class="items-cont" id="supply-pack-items"><li data-item="1082" data-qty="4"><span class="name-wrap">Zip Wallet</span></li><li data-item="1080" data-qty="5"><span class="name-wrap">Old Wallet</span></li><li data-item="1083" data-qty="5"><span class="name-wrap">Billfold</span></li></ul></body>'});
   const params=new URLSearchParams(r.request().postData());
   assert.equal(params.get('step'),'useItem','only opening requests, never inventory requests');
   calls.push(params.get('XID')||params.get('id'));
   if(calls.length===1){await gate;if(scenario==='failure')return r.fulfill({status:500,body:'error'});}
   const itemID=calls.length<=2?1082:1080;
   return r.fulfill({json:{success:true,itemID,armoryID:params.get('XID')||'90000',nextArmoryId:String(90000+calls.length),isAnotherAvailable:true,text:'Received $10',items:{itemDisappear:[{ID:itemID,qty:1}],itemAppear:calls.length===1?[{isMoney:true,moneyGain:'$10'}]:[{ID:199,name:'A very long reward name <b>kept as text</b> with extra descriptive words',qty:2}]}}});
  });
  await page.goto('https://www.torn.com/item.php');await page.addScriptTag({content:source});
  await page.locator('[data-tab=settings]').click();
  assert.equal(await page.locator('#ql-speed-open').isChecked(),scenario!=='fresh');
  await page.locator('#ql-speed-open').check();
  let button=page.locator('#ql-open');
  if(scenario==='hidden-button'){
   await page.locator('[data-action=collapse]').click();
   button=page.locator('#qlco-quick-open');
  }
  // DOM mutations, scans, synthetic clicks and held keys cannot open containers.
  await page.evaluate(()=>document.querySelector('#ql-open').click());
  await page.waitForTimeout(300);assert.equal(calls.length,0);
  await button.click();await page.waitForTimeout(100);
  const bounds=await button.boundingBox();
  for(let i=0;i<5;i++)await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  assert.equal(calls.length,1,'pending presses are discarded');
  release();await page.waitForFunction(()=>!document.querySelector('#ql-open').disabled || document.querySelector('#ql-status').textContent.includes('HTTP 500'));
  await page.waitForTimeout(350);assert.equal(calls.length,1,'no queued or automatic repeat');
  assert.equal(await page.locator('#qlco-result-overlay').count(),0,'no automatic popup');
  if(scenario==='failure'){
   assert.equal(await page.locator('#ql-count').textContent(),'0');
   assert.equal(await button.isDisabled(),true);
  }else{
   assert.match(await button.locator('.ql-open-reward').textContent(),/Zip Wallet: \$10/);
   const confirmed=await button.boundingBox();
   assert(Math.abs(confirmed.y-bounds.y)<2 && Math.abs(confirmed.height-bounds.height)<2,'reward does not move or resize button');
   await button.focus();await page.keyboard.down('Enter');
   await page.waitForFunction(()=>document.querySelector('#ql-count').textContent==='2');
   assert.match(await button.locator('.ql-open-reward').textContent(),/2× A very long reward name/);
   assert.equal(await button.locator('.ql-open-reward b').count(),0);
   const long=await button.boundingBox();
   assert(Math.abs(long.y-confirmed.y)<2 && Math.abs(long.height-confirmed.height)<2,'long reward keeps button stationary');
   assert(long.x>=0 && long.x+long.width<=width+1,'button stays within viewport');
   await page.screenshot({path:require('node:path').join(__dirname,`speed-rewards-${width}-${scenario}.png`)});
   await page.keyboard.down('Enter');await page.keyboard.up('Enter');
   await page.waitForTimeout(100);assert.equal(calls.length,2,'held key is not a new press');
   await button.click();await page.waitForFunction(()=>document.querySelector('#ql-count').textContent==='3');
   await button.click();await page.waitForTimeout(100);
   assert.deepEqual(calls,['1082','90001','1080'],'keep, round limit and allow list are enforced');
   assert.equal(await page.locator('#qlco-result-overlay').count(),0);
   if(scenario==='hidden-button')await page.locator('#qlco-dock-button').click();
   await page.locator('#ql-finish').click();await page.waitForSelector('.ql-summary');
   assert.match(await page.locator('#ql-dialog-title').textContent(),/3 containers/);
   assert.equal(await page.evaluate(()=>values.ql_container_opener_history_v1.length),3);
   await page.getByRole('button',{name:'Done',exact:true}).click();
  }
  assert.deepEqual(errors,[]);await page.close();console.log('PASS manual Speed open and inline rewards:',width,scenario);
 }} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

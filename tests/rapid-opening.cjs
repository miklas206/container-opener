const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','container-opener.user.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
 try{for(const fail of [false,true]){
  const page=await browser.newPage({viewport:{width:390,height:844}});let calls=0,release;
  const gate=new Promise(resolve=>release=resolve),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:'rfc_v',value:'fixture-token',domain:'www.torn.com',path:'/'}]);
  await page.addInitScript(()=>{
   const values={ql_container_opener_settings_v2:{allowedItems:['Zip Wallet'],plans:{'Zip Wallet':{limit:3,keep:0}}}};
   window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;
  });
  await page.route('https://www.torn.com/**',async r=>{
   if(r.request().method()!=='POST')return r.fulfill({contentType:'text/html',body:'<body><ul class="items-cont" id="supply-pack-items"><li data-item="1082" data-qty="4"><span class="name-wrap">Zip Wallet</span></li></ul></body>'});
   const params=new URLSearchParams(r.request().postData());
   if(params.get('step')==='getCategoryList')return r.fulfill({json:{count:1,list:[{ID:1082,name:'Zip Wallet',Qty:4-calls}]}});
   calls++;if(calls===2){await gate;if(fail)return r.fulfill({status:500,body:'error'});}
   return r.fulfill({json:{success:true,itemID:1082,isAnotherAvailable:true,text:calls===1?'You received $10. '+ 'First opening details. '.repeat(30):'You received $10',items:{itemDisappear:[{ID:1082,qty:1}],itemAppear:[{isMoney:true,moneyGain:'$10'}]}}});
  });
  await page.goto('https://www.torn.com/item.php');await page.addScriptTag({content:source});
  await page.locator('#ql-open').click();await page.waitForSelector('.ql-opening');
  await page.locator('.ql-dialog').evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished)));
  await page.evaluate(()=>{
   window.originalOverlay=document.querySelector('#qlco-result-overlay');window.originalDialog=document.querySelector('.ql-dialog');
   window.removedPopup=false;
   new MutationObserver(records=>{for(const r of records)for(const n of r.removedNodes)if(n===originalOverlay||n===originalDialog)window.removedPopup=true}).observe(document.body,{childList:true,subtree:true});
  });
  const target=await page.locator('.ql-dialog-actions .primary').boundingBox(),x=target.x+target.width/2,y=target.y+target.height/2;
  await page.mouse.click(x,y);
  await page.waitForFunction(()=>document.querySelector('#qlco-result-overlay').getAttribute('aria-busy')==='true');
  for(let i=0;i<6;i++)await page.mouse.click(x,y);
  await page.keyboard.press('Tab');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#qlco-result-overlay').count(),1,'pending dialog stays visible');
  release();
  await page.waitForFunction(()=>!document.querySelector('#qlco-result-overlay').hasAttribute('aria-busy'));
  assert.equal(calls,2,'rapid pending taps never queue extra openings');
  if(fail){
   assert.equal(await page.locator('.ql-dialog-actions .primary').isDisabled(),true);
   assert.match(await page.locator('.ql-popup-status').textContent(),/reload/);
  }else{
   const next=await page.locator('.ql-dialog-actions .primary').boundingBox();
   assert(Math.abs(next.y-target.y)<2,'next button stays in place across rewards');
   await page.mouse.click(x,y);await page.waitForSelector('.ql-summary');
   for(let i=0;i<6;i++)await page.mouse.click(x,y);
   assert.equal(await page.locator('.ql-summary').count(),1,'old next coordinates cannot dismiss summary');
   assert.equal(calls,3);assert.equal(await page.locator('#ql-count').textContent(),'3');
   const done=await page.getByRole('button',{name:'Done',exact:true}).boundingBox();
   assert(done.y+done.height<y,'summary actions moved above old next target');
  }
  assert.equal(await page.evaluate(()=>originalOverlay===document.querySelector('#qlco-result-overlay')&&originalDialog===document.querySelector('.ql-dialog')&&!removedPopup),true,'overlay and frame never replaced');
  assert.deepEqual(errors,[]);await page.close();console.log('PASS persistent popup:',fail?'failure with no retry':'rapid taps, stable target and protected summary');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

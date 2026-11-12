const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','container-opener.user.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
 try{
 for(const scenario of ['large','minimum','incomplete']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),steps=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:'rfc_v',value:'fixture-token',domain:'www.torn.com',path:'/'}]);
  await page.addInitScript(keep=>{
   const values={ql_container_opener_settings_v2:{allowedItems:['Zip Wallet'],plans:{'Zip Wallet':{keep}}}};
   window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;
  },scenario==='minimum'?3:2);
  await page.route('https://www.torn.com/**',async r=>{
   if(r.request().method()!=='POST')return r.fulfill({contentType:'text/html',body:'<!doctype html><body><div id="mainContainer"><h1>Items</h1><button id="categoriesItem" data-type="Supply Pack" onclick="window.supplySelected=true;this.setAttribute(\'aria-expanded\',\'true\')">Supply Packs</button><div id="category-wrap">Another category is currently displayed</div></div></body>'});
   const params=new URLSearchParams(r.request().postData());
   assert.equal(await page.evaluate(()=>window.supplySelected),true,'native Supply Packs category selected before fetching');
   steps.push(params.get('step')+':'+(params.get('start')||''));
   if(params.get('step')==='getCategoryList'){
    const start=Number(params.get('start'));
    const list=start===0?[{ID:999,name:'Other item',Qty:5000}]:scenario==='incomplete'?[]:[{ID:1082,name:'Zip Wallet',Qty:3}];
    return r.fulfill({contentType:'application/json',body:JSON.stringify({count:2,list})});
   }
   assert.equal(params.get('step'),'useItem');assert.equal(params.get('itemID'),'1082');
   return r.fulfill({contentType:'application/json',body:JSON.stringify({success:true,itemID:1082,armoryID:21899289699,nextArmoryId:21868925758,isAnotherAvailable:true,text:'You received $10',items:{itemDisappear:[{ID:1082,qty:1}],itemAppear:[{isMoney:true,moneyGain:'$10'}]}})});
  });
  await page.goto('https://www.torn.com/item.php');await page.addScriptTag({content:source});
  assert.equal(await page.locator('#ql-open').isDisabled(),false,'can load inventory even when selected items are not in the DOM');
  await page.locator('#ql-open').click();
  if(scenario==='large'){
   await page.waitForSelector('#qlco-result-overlay');
   assert.deepEqual(steps,['getCategoryList:0','getCategoryList:1','useItem:']);
   assert.equal(await page.locator('#ql-count').textContent(),'1');
   await page.locator('.ql-dialog-close').click();
   assert.equal(await page.locator('#ql-open').isDisabled(),true,'fresh quantity obeys keep minimum');
  }else{
   await page.waitForFunction(()=>/No selected containers|incomplete/.test(document.querySelector('#ql-status').textContent));
   assert.deepEqual(steps,['getCategoryList:0','getCategoryList:1']);
   assert.equal(await page.locator('#ql-count').textContent(),'0');
  }
  assert.deepEqual(errors,[]);await page.close();console.log('PASS Supply Packs:',scenario);
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

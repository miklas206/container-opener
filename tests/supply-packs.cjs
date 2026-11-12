const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','container-opener.user.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
 try{
 for(const scenario of ['nested-link','delayed','already-open','minimum','no-selection','incomplete','missing','inert','switch-away']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),steps=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:'rfc_v',value:'fixture-token',domain:'www.torn.com',path:'/'}]);
  await page.addInitScript(({keep,selected})=>{
   const values={ql_container_opener_settings_v2:{quickButton:true,allowedItems:selected?['Zip Wallet']:[],plans:{'Zip Wallet':{keep}}}};
   window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;
   window.categoryClicks=0;
  },{keep:scenario==='minimum'?3:2,selected:scenario!=='no-selection'});
  const category=scenario==='missing'?'':`<ul><li ${scenario==='delayed'?'id="categoriesItem"':''} data-type="Supply Pack"><a href="#supply-pack-items" aria-controls="supply-pack-items"><span class="supply-pck-category-icon">Supply Packs</span></a></li></ul>`;
  const html=`<!doctype html><body><div id="mainContainer"><h1>Items</h1>${category}<div id="category-wrap"><ul class="items-cont" id="supply-pack-items" ${scenario==='already-open'?'':'hidden'}><li class="ajax-item-loader" ${scenario==='already-open'?'hidden':''}>Loading…</li><li class="empty">Inventory contents</li></ul></div></div></body>`;
  await page.route('https://www.torn.com/**',async r=>{
   if(r.request().method()!=='POST')return r.fulfill({contentType:'text/html',body:html});
   const params=new URLSearchParams(r.request().postData());
   assert.equal(await page.locator('#supply-pack-items').isVisible(),true,'category must be visible before requesting inventory or opening');
   assert.equal(await page.locator('.ajax-item-loader').isVisible(),false,'native loader must finish first');
   steps.push(params.get('step')+':'+(params.get('start')||''));
   if(params.get('step')==='getCategoryList'){
    const start=Number(params.get('start'));
    const list=start===0?[{ID:999,name:'Other item',Qty:5000}]:scenario==='incomplete'?[]:[{ID:1082,name:'Zip Wallet',Qty:3}];
    if(scenario==='switch-away'&&start===1)await page.locator('#supply-pack-items').evaluate(n=>n.hidden=true);
    return r.fulfill({contentType:'application/json',body:JSON.stringify({count:2,list})});
   }
   assert.equal(params.get('step'),'useItem');assert.equal(params.get('itemID'),'1082');
   return r.fulfill({contentType:'application/json',body:JSON.stringify({success:true,itemID:1082,armoryID:21899289699,nextArmoryId:21868925758,isAnotherAvailable:true,text:'You received $10',items:{itemDisappear:[{ID:1082,qty:1}],itemAppear:[{isMoney:true,moneyGain:'$10'}]}})});
  });
  await page.goto('https://www.torn.com/item.php');
  await page.evaluate(scenario=>{
   const link=document.querySelector('a[aria-controls]');
   link?.addEventListener('click',e=>{
    e.preventDefault();window.categoryClicks++;
    if(scenario==='inert')return;
    const list=document.querySelector('#supply-pack-items');
    if(scenario==='delayed'){
     setTimeout(()=>{list.hidden=false;setTimeout(()=>list.querySelector('.ajax-item-loader').hidden=true,200)},150);
    }else{
     list.hidden=false;list.querySelector('.ajax-item-loader').hidden=true;
    }
   });
  },scenario);
  await page.addScriptTag({content:source});
  await page.locator('#ql-open').click();
  if(['nested-link','delayed','already-open'].includes(scenario)){
   await page.waitForSelector('#qlco-result-overlay');
   assert.deepEqual(steps,['getCategoryList:0','getCategoryList:1','useItem:']);
   assert.equal(await page.evaluate(()=>window.categoryClicks),scenario==='already-open'?0:1);
  }else{
   await page.waitForFunction(()=>/No selected containers|incomplete|not found|did not finish|no longer visible/.test(document.querySelector('#ql-status').textContent),null,{timeout:15000});
   assert.deepEqual(steps,['missing','inert'].includes(scenario)?[]:['getCategoryList:0','getCategoryList:1']);
   assert.equal(await page.locator('#ql-count').textContent(),'0');
   assert.equal(await page.locator('#ql-open').textContent()==='Loading Supply Packs…',false,'loading lock released');
  }
  if(['minimum','no-selection'].includes(scenario)){
   // A previous empty/limited result must not disable category navigation.
   await page.locator('#supply-pack-items').evaluate(n=>n.hidden=true);
   await page.locator('[data-action=collapse]').click();
   await page.locator('#qlco-quick-open').click();
   await page.waitForFunction(()=>document.querySelector('#ql-status').textContent.startsWith('Supply Packs loaded.'));
   assert.equal(await page.evaluate(()=>window.categoryClicks),2);
   assert.deepEqual(steps,['getCategoryList:0','getCategoryList:1','getCategoryList:0','getCategoryList:1']);
  }
  assert.deepEqual(errors,[]);await page.close();console.log('PASS Supply Packs:',scenario);
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

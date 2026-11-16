const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','container-opener.user.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
 try{for(const scenario of ['panel','quick','cached','heading','already-open']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),requests=[],errors=[];let release;
  const gate=new Promise(r=>release=r);
  page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:'rfc_v',value:'fixture-token',domain:'www.torn.com',path:'/'}]);
  await page.addInitScript(()=>{
   const values={ql_container_opener_settings_v2:{quickButton:true,speedOpen:true,allowedItems:['Zip Wallet'],plans:{}}};
   window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;
  });
  await page.route('https://www.torn.com/**',async r=>{
   if(r.request().method()!=='POST')return r.fulfill({contentType:'text/html',body:`<body><main id="mainContainer"><h4 class="title-black">Your items - ${scenario==='already-open'?'Supply Packs':'All'}</h4><ul><li data-type="All" class="${scenario==='already-open'||scenario==='heading'?'':'selected'}">All</li><li data-type="Supply Pack" ${scenario==='heading'?'':`aria-selected="${scenario==='already-open'}"`}><a href="#supply-pack-items"><span class="supply-pck-category-icon">Supply Packs</span></a></li></ul><ul class="items-cont" id="supply-pack-items" ${['cached','heading','already-open'].includes(scenario)?'':'hidden'}><li data-item="1082" data-qty="3"><span class="name-wrap">Zip Wallet</span></li></ul></main></body>`});
   const step=new URLSearchParams(r.request().postData()).get('step');requests.push(step);
   if(step==='nativeCategory'){await gate;return r.fulfill({json:{ok:true}});}
   assert.equal(step,'useItem');return r.fulfill({json:{success:true,itemID:1082,isAnotherAvailable:true,text:'Received $10',items:{itemDisappear:[{ID:1082,qty:1}],itemAppear:[{isMoney:true,moneyGain:'$10'}]}}});
  });
  await page.goto('https://www.torn.com/item.php');
  await page.evaluate(()=>{
   document.querySelector('a').addEventListener('click',async e=>{
    e.preventDefault();const list=document.querySelector('.items-cont');list.setAttribute('aria-busy','true');
    await fetch('/item.php',{method:'POST',body:'step=nativeCategory'});
    document.querySelector('[data-type="All"]').className='';
    document.querySelector('[data-type="Supply Pack"]').setAttribute('aria-selected','true');
    document.querySelector('h4').textContent='Your items - Supply Packs';
    list.hidden=false;list.removeAttribute('aria-busy');
   });
  });
  await page.addScriptTag({content:source});
  let button=page.locator('#ql-open');
  if(scenario==='quick'){await page.locator('[data-action=collapse]').click();button=page.locator('#qlco-quick-open');}
  if(scenario!=='already-open'){
   assert.match(await button.textContent(),/Go to Supply Packs/);
   await button.click();await page.waitForTimeout(100);
   assert.deepEqual(requests,['nativeCategory']);
   assert.equal(await button.isDisabled(),true);
   const b=await button.boundingBox();for(let i=0;i<4;i++)await page.mouse.click(b.x+b.width/2,b.y+b.height/2);
   release();await page.waitForFunction(()=>!document.querySelector('#ql-open').disabled);
   await page.waitForTimeout(300);
   assert.deepEqual(requests,['nativeCategory'],'category response must never trigger opening or queue repeats');
   assert.equal(await page.locator('#ql-count').textContent(),'0');
  }
  await button.click();await page.waitForFunction(()=>document.querySelector('#ql-count').textContent==='1');
  assert.deepEqual(requests,scenario==='already-open'?['useItem']:['nativeCategory','useItem']);
  assert.deepEqual(errors,[]);await page.close();console.log('PASS separate category/open presses:',scenario);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

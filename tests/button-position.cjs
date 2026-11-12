const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','container-opener.user.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
 try {
 for(const width of [320,1280]){
 const page=await browser.newPage({viewport:{width,height:844}});const errors=[];let posts=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.GM_getValue=(k,d)=>JSON.parse(localStorage.getItem(k))??d;
  window.GM_setValue=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
 });
 await page.route('**/*',r=>{
  if(r.request().method()==='POST')posts++;
  return r.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0"><main id="mainContainer"><h1>Items</h1><section style="height:100px">Equipped items</section><nav id="inventory-controls"><button>Supply Packs</button><input type="search" placeholder="Search items"></nav><div id="category-wrap"><ul><li data-item="1082" data-qty="3"><span class="name-wrap">Zip Wallet</span></li></ul></div></main></body>'});
 });
 await page.goto('https://www.torn.com/item.php');
 await page.evaluate(()=>{
  GM_setValue('ql_container_opener_settings_v2',{quickButton:true,blacklist:[],plans:{}});
  GM_setValue('ql_container_opener_panel_v2',{hidden:true});
 });
 await page.addScriptTag({content:source});
 assert.equal(await page.locator('#inventory-controls + #qlco-quick-bar + #category-wrap').count(),1);
 assert.equal(await page.locator('#qlco-quick-bar').evaluate(n=>getComputedStyle(n).position),'static');
 assert.equal(await page.locator('#qlco-move-handle').isVisible(),false);
 await page.locator('#qlco-dock-button').click();
 await page.locator('[data-tab=settings]').click();
 await page.locator('#ql-quick-placement').selectOption('floating');
 await page.locator('[data-action=collapse]').click();
 const handle=page.locator('#qlco-move-handle'), bar=page.locator('#qlco-quick-bar');
 const before=await bar.boundingBox(),h=await handle.boundingBox();
 await page.mouse.move(h.x+h.width/2,h.y+h.height/2);
 await page.mouse.down();await page.mouse.move(h.x+55,h.y-180,{steps:10});await page.mouse.up();
 const after=await bar.boundingBox();
 assert(after.y<before.y-100,'mouse drag moves bar even when Open is disabled');
 assert.equal(posts,0,'moving never opens anything');
 await handle.focus();await handle.press('ArrowUp');
 const moved=await bar.boundingBox();assert(moved.y<after.y);
 await page.reload();await page.addScriptTag({content:source});
 const restored=await bar.boundingBox();assert(Math.abs(restored.y-moved.y)<3,'position restored after reload');
 await page.setViewportSize({width:320,height:480});
 await page.waitForTimeout(100);
 const small=await bar.boundingBox();
 assert(small.x>=0&&small.y>=0&&small.x+small.width<=320&&small.y+small.height<=480,'resize stays within screen');
 // Touch uses the same pointer capture path, without sending an opening click.
 const session=await page.context().newCDPSession(page);
 const touch=await handle.boundingBox(),x=touch.x+10,y=touch.y+10;
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:Math.max(20,y-60)}]});
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert((await bar.boundingBox()).y<small.y-20,'touch drag moves bar');
 assert.equal(posts,0);
 await page.screenshot({path:path.join(__dirname,'button-floating-'+width+'.png')});
 await page.locator('#qlco-dock-button').click();await page.locator('[data-tab=settings]').click();
 await page.locator('#ql-quick-placement').selectOption('inventory');
 await page.locator('[data-action=collapse]').click();
 await page.evaluate(()=>document.querySelector('#mainContainer').innerHTML='<h1>Items refreshed</h1><nav id="inventory-controls"><input type="search" placeholder="Search items"></nav><div id="category-wrap"><ul><li data-item="1082" data-qty="2"><span class="name-wrap">Zip Wallet</span></li></ul></div>');
 await page.waitForSelector('#inventory-controls + #qlco-quick-bar + #category-wrap');
 // An empty category still provides the anchor, and controls remain usable.
 await page.locator('#category-wrap').evaluate(n=>n.innerHTML='<p>No items found</p>');
 await page.locator('#inventory-controls input').fill('wallet');
 assert.equal(await page.locator('#inventory-controls + #qlco-quick-bar + #category-wrap').count(),1);
 assert.equal(await page.locator('#qlco-quick-bar').count(),1);
 assert.equal(posts,0);
 await page.screenshot({path:path.join(__dirname,'button-inventory-'+width+'.png')});
 assert.deepEqual(errors,[]);await page.close();
 console.log('PASS',width,'inventory anchoring, mouse/touch/keyboard movement, persistence, resize and remount');
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

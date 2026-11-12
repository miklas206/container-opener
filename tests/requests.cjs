'use strict';
const assert = require('node:assert/strict');
const { createClient, readSuccess, id, valueOpening, sumOpenings } = require('../container-opener.user.js');
const fixture = {
    items: { itemAppear: [{ moneyGain: '$130', isMoney: true }, { ID: 199, qty: 1, type: 'Drug', aan: 'some', name: 'LSD', itemID: 199 }],
        itemDisappear: [{ ID: 1082, qty: 1, type: 'Supply Pack' }] },
    text: 'You opened the Zip Wallet and received $130, 1x LSD', isAnotherAvailable: true,
    nextArmoryId: 21868925758, isParcel: false, itemID: 1082, armoryID: 21899289699, success: true
};
const item = { itemID: '1082', xid: '21899289699' };
const response = data => ({ ok: true, text: async () => JSON.stringify(data) });
const make = (fetchFn, extra = {}) => createClient({ fetchFn, active: () => true, token: () => 'fixture-token', origin: 'https://www.torn.com', ...extra });
async function run() {
    let passed = 0;
    async function test(name, fn) { await fn(); console.log('PASS ' + name); passed++; }
    await test('real supplied outcome: money, item and next XID', () => {
        const value = readSuccess(fixture, item);
        assert.equal(value.cash, 130); assert.equal(value.next, '21868925758'); assert.equal(value.rewards[1].name, 'LSD');
    });
    await test('one POST, correct body, same-origin credentials, no extra requests', async () => {
        const calls = []; const client = make(async (...args) => { calls.push(args); return response(fixture); });
        await client.open(item); assert.equal(calls.length, 1);
        const [url, options] = calls[0]; assert.equal(new URL(url).pathname, '/item.php');
        assert.equal(new URL(url).searchParams.get('rfcv'), 'fixture-token');
        assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'same-origin');
        assert.equal(options.body, 'step=useItem&XID=21899289699'); assert.equal(client.busy, false);
    });
    await test('rapid second press cannot dispatch another request', async () => {
        let resolve, calls = 0; const client = make(() => { calls++; return new Promise(done => resolve = done); });
        const first = client.open(item); assert.equal(client.busy, true);
        await assert.rejects(client.open(item), /Wait/); assert.equal(calls, 1);
        resolve(response(fixture)); await first;
    });
    await test('confirmed next XID opens only on a new invocation', async () => {
        let calls = 0; const client = make(async () => response(++calls === 1 ? fixture : {
            ...fixture, armoryID: 21868925758, isAnotherAvailable: false, nextArmoryId: null
        }));
        const first = await client.open(item); assert.equal(calls, 1);
        const last = await client.open({ ...item, xid: first.next }); assert.equal(calls, 2); assert.equal(last.next, '');
    });
    await test('used XID is blocked', async () => {
        let calls = 0; const client = make(async () => { calls++; return response(fixture); });
        await client.open(item); await assert.rejects(client.open(item), /reload/); assert.equal(calls, 1);
    });
    await test('timeout: no retry and no XID reuse', async () => {
        let calls = 0; const client = make((url, options) => {
            calls++; return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' }))));
        }, { timeout: 5 });
        await assert.rejects(client.open(item), /timed out/); assert.equal(client.busy, false);
        await assert.rejects(client.open(item), /reload/); assert.equal(calls, 1);
    });
    await test('HTTP error stops without a retry', async () => {
        let calls = 0; const client = make(async () => { calls++; return { ok: false, status: 403 }; });
        await assert.rejects(client.open(item), /HTTP 403/); assert.equal(calls, 1); assert.equal(client.busy, false);
    });
    await test('HTML/login/CAPTCHA response is not reported as an opening', async () => {
        const client = make(async () => ({ ok: true, text: async () => '<html>Login</html>' }));
        await assert.rejects(client.open(item), /did not return JSON/);
    });
    await test('mismatching type or XID cannot count as a confirmed opening', () => {
        assert.throws(() => readSuccess({ ...fixture, itemID: 199 }, item));
        assert.throws(() => readSuccess({ ...fixture, armoryID: 99999999999 }, item));
        assert.throws(() => readSuccess({ ...fixture, success: false }, item));
    });
    await test('same/missing next XID halts', () => {
        assert.throws(() => readSuccess({ ...fixture, nextArmoryId: fixture.armoryID }, item));
        assert.throws(() => readSuccess({ ...fixture, nextArmoryId: null }, item));
    });
    await test('inactive tab or missing token dispatches nothing', async () => {
        let calls = 0; const fetchFn = async () => { calls++; return response(fixture); };
        await assert.rejects(make(fetchFn, { active: () => false }).open(item), /active/);
        await assert.rejects(make(fetchFn, { token: () => '' }).open(item), /not ready/);
        assert.equal(calls, 0);
    });
    await test('network error cannot be retried using the same XID', async () => {
        let calls = 0; const client = make(async () => { calls++; throw new Error('Network offline'); });
        await assert.rejects(client.open(item), /Network offline/);
        await assert.rejects(client.open(item), /reload/); assert.equal(calls, 1);
    });
    await test('structured cash excludes dollar figures in prose and item values', () => {
        assert.equal(readSuccess({ ...fixture, text: 'Worth $999999', items: { ...fixture.items,
            itemAppear: [{ moneyGain: '$1,234', isMoney: true }, { moneyGain: '$500', isMoney: false }] } }, item).cash, 1234);
    });
    await test('instance IDs preserve all digits', () => {
        assert.equal(id('21899289699'), '21899289699'); assert.equal(id('1082'), ''); assert.equal(id('21899bad'), '');
    });
    await test('opening by item type needs no XID and is reusable after success', async () => {
        const calls = []; const client = make(async (...args) => { calls.push(args); return response(fixture); });
        await client.open({ itemID: '1082' });
        assert.equal(calls[0][1].body, 'step=useItem&id=1082&itemID=1082');
        assert.equal(calls[0][1].headers['X-Requested-With'], 'XMLHttpRequest');
        await client.open({ itemID: '1082' }); assert.equal(calls.length, 2);
    });
    await test('failed type request cannot be repeated in this session', async () => {
        let calls = 0; const client = make(async () => { calls++; throw new Error('offline'); });
        await assert.rejects(client.open({ itemID: '1082' }), /offline/);
        await assert.rejects(client.open({ itemID: '1082' }), /reload/); assert.equal(calls, 1);
    });
    await test('string quantities and absent optional response IDs are supported', () => {
        const value = readSuccess({ ...fixture, itemID: undefined, armoryID: undefined,
            items: { ...fixture.items, itemDisappear: [{ ID: '1082', qty: '1' }] } }, { itemID: '1082' });
        assert.equal(value.cash, 130);
    });
    await test('discover fetches one inventory page without opening anything', async () => {
        const calls = []; const client = make(async (...args) => { calls.push(args); return response({ count: 1, list: [{ ID: 1082, name: 'Zip Wallet', Qty: 80 }] }); });
        const result = await client.discover(); assert.equal(result.list[0].Qty, 80);
        assert.equal(calls.length, 1); assert.equal(calls[0][1].body, 'step=getCategoryList&itemName=Supply+Pack&start=0');
        assert.equal(client.busy, false);
    });
    await test('discover and opening cannot run concurrently', async () => {
        let resolve; const client = make(() => new Promise(done => resolve = done));
        const pending = client.discover(); await assert.rejects(client.open(item), /Wait/);
        resolve(response({ list: [] })); await pending;
    });
    await test('discover loads all pages using row offsets, not item quantities', async () => {
        const starts = [];
        const client = make(async (url, options) => {
            const start = Number(new URLSearchParams(options.body).get('start')); starts.push(start);
            return response({count:3,list:start === 0 ? [{ID:1,Qty:999},{ID:2,Qty:100}] : [{ID:1082,Qty:5}]});
        });
        const result = await client.discover();
        assert.deepEqual(starts,[0,2]); assert.equal(result.list.length,3);
    });
    await test('discover rejects repeated pages and incomplete inventories', async () => {
        const repeated = make(async () => response({count:2,list:[{ID:1082,Qty:5}]}));
        await assert.rejects(repeated.discover(),/repeated/);
        let calls=0;
        const incomplete = make(async () => response({count:2,list:calls++ ? [] : [{ID:1082,Qty:5}]}));
        await assert.rejects(incomplete.discover(),/incomplete/);
    });
    await test('discover without a total reads until an empty page', async () => {
        let calls=0;const client=make(async()=>response({list:calls++ ? [] : [{ID:1082,Qty:5}]}));
        assert.equal((await client.discover()).list.length,1);assert.equal(calls,2);
    });
    await test('prices include quantity and cash minus consumed container value', () => {
        const result = valueOpening('1082', fixture.items.itemAppear, { 1082: { price: 1000 }, 199: { price: 2000 } });
        assert.equal(result.received, 2130); assert.equal(result.cost, 1000); assert.equal(result.net, 1130);
        assert.equal(valueOpening('1082', [{ ID: 199, qty: 3 }], { 1082: { price: 1000 }, 199: { price: 2000 } }).net, 5000);
        const loss = valueOpening('1082', [{ isMoney: true, moneyGain: '$10' }], { 1082: { price: 1000 } });
        assert.equal(loss.net, -990);
        const sum = sumOpenings([{ value: result }, { value: loss }]);
        assert.equal(sum.net, 140); assert.equal(sum.cost, 2000); assert.equal(sum.received, 2140);
        assert.equal(sum.wins, 1); assert.equal(sum.losses, 1);
    });
    await test('unknown prices stay unknown, including partly priced rewards', () => {
        const missingReward = valueOpening('1082', fixture.items.itemAppear, { 1082: { price: 1000 } });
        assert.equal(missingReward.net, null); assert.equal(missingReward.received, 130);
        const missingCost = valueOpening('1082', [{ isMoney: true, moneyGain: '$130' }], {});
        assert.equal(missingCost.cost, null); assert.equal(missingCost.net, null);
        assert.equal(sumOpenings([{ value: missingReward }]).net, null);
    });
    await test('custom purchase price overrides market price, including free items', () => {
        const market = { 1082: { price: 1000 } };
        assert.equal(valueOpening('1082', [{ isMoney: true, moneyGain: '$130' }], market, 100).net, 30);
        assert.equal(valueOpening('1082', [{ isMoney: true, moneyGain: '$130' }], market, 0).cost, 0);
        assert.equal(valueOpening('1082', [{ isMoney: true, moneyGain: '$130' }], market, -1).cost, 1000);
    });
    await test('historical results keep their price snapshot', () => {
        const catalog = { 1082: { price: 1000 }, 199: { price: 2000 } };
        const record = valueOpening('1082', fixture.items.itemAppear, catalog);
        catalog[1082].price = 8000; catalog[199].price = 1;
        assert.equal(record.net, 1130); assert.equal(record.entries[1].value, 2000);
    });
    console.log(`${passed} request/accounting tests passed.`);
    return passed;
}
module.exports = { run };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });

// ==UserScript==
// @name         Questionably Legal Container Opener PC & PDA
// @namespace    https://www.torn.com/
// @version      3.1.1
// @description  Automatically find containers in your inventory. One direct opening per press, with confirmed rewards.
// @author       slightlylegal
// @license      MIT
// @homepageURL  https://github.com/miklas206/container-opener
// @supportURL   https://github.com/miklas206/container-opener/issues
// @match        https://www.torn.com/item.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Pure request/state core, also exported to the offline regression harness.
    const id = value => /^\d{5,16}$/.test(String(value || '')) ? String(value) : '';
    function valueOpening(itemID, rewards, catalog, override) {
        const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
        const cost = valid(override) ? override : valid(catalog[itemID]?.price) ? catalog[itemID].price : null;
        let received = 0;
        const missing = [];
        const entries = rewards.map(reward => {
            if (reward.isMoney === true) {
                const text = String(reward.moneyGain || '');
                const value = /^\$[\d,]+(?:\.\d{1,2})?$/.test(text) ? Number(text.slice(1).replace(/,/g, '')) : null;
                if (value === null) missing.push('Cash amount'); else received += value;
                return { name: 'Cash', qty: 1, value, cash: true };
            }
            const item = String(reward.itemID || reward.ID || '');
            const qty = Number(reward.qty);
            const unit = catalog[item]?.price;
            const value = valid(unit) && valid(qty) ? unit * qty : null;
            const name = reward.name || catalog[item]?.name || `Item ${item || '?'}`;
            if (value === null) missing.push(name); else received += value;
            return { itemID: item, name, qty, value, cash: false };
        });
        return { cost, received, entries, missing, net: cost !== null && !missing.length ? received - cost : null,
            basis: valid(override) ? 'Your purchase cost' : 'Market value' };
    }
    function sumOpenings(records) {
        return { count: records.length, cost: records.reduce((sum, row) => sum + (row.value.cost ?? 0), 0),
            received: records.reduce((sum, row) => sum + row.value.received, 0),
            complete: records.every(row => row.value.net !== null),
            net: records.every(row => row.value.net !== null) ? records.reduce((sum, row) => sum + row.value.net, 0) : null,
            wins: records.filter(row => row.value.net > 0).length,
            losses: records.filter(row => row.value.net !== null && row.value.net < 0).length,
            unknown: records.filter(row => row.value.net === null).length };
    }
    function readSuccess(data, expected) {
        const removed = data?.items?.itemDisappear;
        if (data?.success !== true || !Array.isArray(removed) ||
            !removed.some(entry => String(entry.ID) === String(expected.itemID) && Number(entry.qty) === 1) ||
            (data.itemID != null && String(data.itemID) !== String(expected.itemID)) ||
            (expected.xid && String(data.armoryID) !== expected.xid)) {
            throw new Error('The result could not be matched to the selected container. Check your inventory.');
        }
        const another = data.isAnotherAvailable === true;
        const next = another ? id(data.nextArmoryId) : '';
        if (another && ((expected.xid && (!next || next === expected.xid)) || (next && next === String(data.armoryID)))) {
            throw new Error('Torn did not return a new, unique XID. Check your inventory.');
        }
        const rewards = Array.isArray(data.items.itemAppear) ? data.items.itemAppear : [];
        return { next, another, availabilityKnown: typeof data.isAnotherAvailable === 'boolean',
            text: typeof data.text === 'string' ? data.text : 'Container opened.',
            rewards, cash: rewards.reduce((sum, entry) => {
                const amount = String(entry.moneyGain || '');
                return sum + (entry.isMoney === true && /^\$[\d,]+(?:\.\d{1,2})?$/.test(amount)
                    ? Number(amount.slice(1).replace(/,/g, '')) : 0);
            }, 0) };
    }
    function createClient({ fetchFn, active, token, origin, timeout = 18000 }) {
        let busy = false;
        const spent = new Set();
        const uncertain = new Set();
        return {
            get busy() { return busy; },
            async discover() {
                if (busy) throw new Error('Wait for the current response.');
                if (!active()) throw new Error('Use the button on the active inventory page.');
                const rfcv = String(token() || '');
                if (!/^[a-zA-Z0-9_-]{4,200}$/.test(rfcv)) throw new Error('Torn is not ready. Reload the Items page and try again.');
                busy = true;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);
                try {
                    const url = new URL('/item.php', origin);
                    url.searchParams.set('rfcv', rfcv);
                    const response = await fetchFn(url.href, { method: 'POST', credentials: 'same-origin', redirect: 'error',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
                        body: new URLSearchParams({ step: 'getCategoryList', itemName: 'Supply Pack', start: '0' }).toString(), signal: controller.signal });
                    if (!response.ok) throw new Error('Torn could not load the list. Try opening Supply Packs in Torn.');
                    let data;
                    try { data = JSON.parse(await response.text()); }
                    catch { throw new Error('The list could not be read. Check your Torn login and reload the page.'); }
                    if (!Array.isArray(data.list)) throw new Error('Torn returned an unexpected list. Open Supply Packs in Torn and press Refresh.');
                    return data;
                } catch (error) {
                    if (error.name === 'AbortError') throw new Error('Torn did not respond in time. Try again when the page is working.');
                    throw error;
                } finally { clearTimeout(timer); busy = false; }
            },
            async open(item) {
                if (busy) throw new Error('Wait for the current response.');
                if (!active()) throw new Error('Use the button on the active inventory page.');
                const xid = id(item.xid);
                if (!/^\d+$/.test(String(item.itemID))) throw new Error('Open the category containing your containers in Torn first.');
                if ((xid && spent.has(xid)) || uncertain.has(String(item.itemID))) throw new Error('Check your inventory and reload the page before trying again.');
                const rfcv = String(token() || '');
                if (!/^[a-zA-Z0-9_-]{4,200}$/.test(rfcv)) throw new Error('Torn is not ready. Reload the Items page and try again.');
                busy = true;
                // Once dispatched, never reuse this XID or retry automatically, even after a timeout.
                if (xid) spent.add(xid);
                uncertain.add(String(item.itemID));
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);
                try {
                    const url = new URL('/item.php', origin);
                    url.searchParams.set('rfcv', rfcv);
                    const response = await fetchFn(url.href, {
                        method: 'POST', credentials: 'same-origin', redirect: 'error',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
                        body: new URLSearchParams(xid ? { step: 'useItem', XID: xid }
                            : { step: 'useItem', id: String(item.itemID), itemID: String(item.itemID) }).toString(),
                        signal: controller.signal
                    });
                    if (!response.ok) throw new Error(`HTTP ${response.status}. The outcome is unknown; check your inventory.`);
                    let data;
                    try { data = JSON.parse(await response.text()); }
                    catch { throw new Error('Torn did not return JSON. Check your login/CAPTCHA and inventory.'); }
                    const result = readSuccess(data, { itemID: item.itemID, xid });
                    uncertain.delete(String(item.itemID));
                    return result;
                } catch (error) {
                    if (error.name === 'AbortError') throw new Error('The response timed out. The container may have been opened; check your inventory.');
                    throw error;
                } finally { clearTimeout(timer); busy = false; }
            }
        };
    }
    if (typeof module === 'object' && module.exports) {
        module.exports = { id, readSuccess, createClient, valueOpening, sumOpenings };
        return;
    }
    if (location.origin !== 'https://www.torn.com' || location.pathname !== '/item.php') return;
    if (document.getElementById('qlco-v2')) return;

    const GROUPS = {
        wallets: { label: 'Wallets', items: ['Old Wallet', 'Zip Wallet', 'Billfold', 'Cardholder', 'Clutch', 'Coin Purse'] },
        packs: { label: 'Supply packs', items: ['Box of Grenades', 'Box of Medical Supplies', 'Drug Pack', 'Goodie Bag',
            'Six-Pack of Alcohol', 'Six-Pack of Energy Drink', 'Tin of Treats', 'Stash Box', 'Keg of Beer', 'Lottery Voucher', 'Donator Pack'] },
        caches: { label: 'Caches', items: ['Armor Cache', 'Collectible Cache', 'Cutesy Cache', 'Denim Cache', 'Elderly Cache',
            'Elegant Cache', 'Gentleman Cache', 'Heavy Arms Cache', 'Injury Cache', 'Medium Arms Cache', 'Melee Cache',
            'Naughty Cache', 'Small Arms Cache', 'Wannabe Cache', 'Lesser Arca Fortunae', 'Greater Arca Fortunae'] },
        gifts: { label: 'Gifts & parcels', items: ['Anniversary Present', 'Birthday Present', 'Christmas Present', 'Present', 'Parcel', "Duke's Safe"] }
    };
    const names = Object.values(GROUPS).flatMap(group => group.items);
    const defaults = ['Parcel', 'Present', 'Birthday Present', 'Christmas Present', 'Donator Pack'];
    const get = (key, fallback) => {
        try { return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : JSON.parse(localStorage.getItem(key)) ?? fallback; }
        catch { return fallback; }
    };
    const put = (key, value) => {
        try { if (typeof GM_setValue === 'function') GM_setValue(key, value); else localStorage.setItem(key, JSON.stringify(value)); }
        catch { status = 'Settings could not be saved on this device.'; }
    };
    const old = get('ql_container_opener_settings_v1', {});
    const saved = get('ql_container_opener_settings_v2', {});
    const blacklist = Array.isArray(saved.blacklist) ? saved.blacklist : Array.isArray(old.blacklist) ? old.blacklist : defaults;
    const prefs = { blacklist: blacklist.filter(name => names.includes(name)),
        quickButton: saved.quickButton === true,
        plans: saved.plans && typeof saved.plans === 'object' ? saved.plans : {} };
    // Runtime XIDs and rfcv are deliberately never persisted or included in diagnostics.
    const runtime = new Map();
    const log = [];
    let filter = 'all', status = 'Choose your containers. One press opens one item.', opened = 0, cash = 0;
    let halted = false, scanTimer, collapsed = get('ql_container_opener_panel_v2', {}).hidden === true, loading = false;
    const rewardTotals = new Map();
    const records = [];
    const storedHistory = get('ql_container_opener_history_v1', []);
    const history = Array.isArray(storedHistory) ? storedHistory.filter(entry =>
        entry && typeof entry.name === 'string' && typeof entry.text === 'string' &&
        Number.isFinite(entry.openedAt)).slice(0, 500) : [];
    let popup = null, popupReturnFocus = null, pricesLoading = false;
    const cachedPrices = get('ql_container_opener_prices_v1', {});
    let priceData = cachedPrices?.items && Number(cachedPrices.fetchedAt) > Date.now() - 3600000
        ? cachedPrices : { items: {}, fetchedAt: 0 };
    const savedCosts = get('ql_container_opener_costs_v1', {});
    const costs = savedCosts && typeof savedCosts === 'object' ? savedCosts : {};
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const norm = value => String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const money = value => '$' + value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const signedMoney = value => value === null ? 'Price unavailable' : `${value >= 0 ? '+' : '−'}${money(Math.abs(value))}`;
    const prices = () => priceData.fetchedAt > Date.now() - 3600000 ? priceData.items : {};
    const plainText = value => {
        const template = document.createElement('template');
        template.innerHTML = String(value || '').replace(/<br\s*\/?\s*>/gi, ' ');
        return template.content.textContent.trim();
    };
    const groupOf = name => Object.keys(GROUPS).find(key => GROUPS[key].items.includes(name));
    function plan(name) {
        const value = prefs.plans[name] || {};
        return { selected: value.selected === true, limit: Math.max(0, Math.floor(Number(value.limit) || 0)),
            keep: Math.max(0, Math.floor(Number(value.keep) || 0)) };
    }
    function save() { put('ql_container_opener_settings_v2', prefs); }
    function findToken() {
        // TornTools also reads rfc_v for direct item actions. Read only this cookie,
        // and never save or display its value.
        const cookie = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('rfc_v='));
        if (cookie) {
            try { const token = decodeURIComponent(cookie.slice(6)); if (/^[a-zA-Z0-9_-]{4,200}$/.test(token)) return token; } catch {}
        }
        const urls = [location.href];
        // Only inspect resources the current page already loaded; no fetches or background navigation.
        try { urls.push(...performance.getEntriesByType('resource').map(entry => entry.name).reverse()); } catch {}
        document.querySelectorAll('script[src], a[href*="rfcv="], form[action*="rfcv="]').forEach(node =>
            urls.push(node.src || node.href || node.action));
        for (const value of urls) {
            try {
                const url = new URL(value, location.href);
                if (url.origin === location.origin && url.searchParams.get('rfcv')) return url.searchParams.get('rfcv');
            } catch {}
        }
        return '';
    }
    const client = createClient({ fetchFn: (...args) => fetch(...args),
        active: () => document.visibilityState === 'visible' && document.hasFocus() && location.pathname === '/item.php',
        token: findToken, origin: location.origin });

    const panel = document.createElement('aside');
    panel.id = 'qlco-v2';
    panel.lang = 'en';
    panel.setAttribute('aria-label', 'Container Opener');
    // Keep the old DOM observer from scanning our new panel when upgrading without a refresh.
    panel.innerHTML = `<header><div><small>QUESTIONABLY LEGAL · v3.1.1</small><h2>Container Opener</h2></div>
        <button data-action="api-settings" aria-controls="ql-pricing">API key</button><button data-action="collapse" aria-label="Hide panel" title="Hide panel">−</button></header>
        <nav class="ql-tabs" role="tablist" aria-label="Container Opener tabs">
        <button id="ql-tab-rules" role="tab" aria-selected="true" aria-controls="ql-page-rules" data-tab="rules">Rules</button>
        <button id="ql-tab-settings" role="tab" aria-selected="false" aria-controls="ql-page-settings" tabindex="-1" data-tab="settings">Settings</button>
        <button id="ql-tab-history" role="tab" aria-selected="false" aria-controls="ql-page-history" tabindex="-1" data-tab="history">History</button></nav>
        <div class="ql-body"><section id="ql-page-rules" role="tabpanel" aria-labelledby="ql-tab-rules"><div class="ql-totals"><span>Opened <b id="ql-count">0</b></span><span>Cash <b id="ql-cash">$0</b></span></div>
        <nav aria-label="Categories"><select id="ql-filter"><option value="all">All categories</option>${Object.entries(GROUPS).map(([key, group]) => `<option value="${key}">${group.label}</option>`).join('')}</select><button data-action="scan">Refresh</button></nav>
        <p class="ql-help">1. Find your items &nbsp; 2. Select what to open &nbsp; 3. Press Open</p>
        <button id="ql-find" data-action="load">Find my containers</button>
        <details id="ql-total"><summary>Total rewards this session</summary><div id="ql-total-rewards">No openings yet.</div></details>
        <div class="ql-columns"><span>Container</span><span>Open up to</span><span>Keep at least</span></div>
        <div id="ql-list"></div><details><summary>Blocked containers</summary><div id="ql-blocks"></div></details>
        <p class="ql-help">Leave “Open up to” empty for no limit. “Keep at least” is the quantity to leave in your inventory.</p>
        </section>
        <section id="ql-page-settings" role="tabpanel" aria-labelledby="ql-tab-settings" hidden>
        <h3>Opening button</h3><label class="ql-button-setting"><input id="ql-quick-enabled" type="checkbox" ${prefs.quickButton ? 'checked' : ''}> Show a floating Open button on the Items page</label>
        <p class="ql-help">One press opens the next eligible container according to your Rules. The button also works with the panel hidden. Keep at least and Open up to apply to both buttons.</p>
        <details id="ql-pricing"><summary>API key, prices and purchase cost <span id="ql-price-state"></span></summary>
        <p>Compare reward market values with the container's market value or your purchase cost. Values are estimates before selling fees.</p>
        <label class="ql-key-label">Torn API key · Public Only<input id="ql-api-key" type="password" autocomplete="off" placeholder="Enter your key once"></label>
        <p id="ql-key-state" class="ql-help" role="status"></p>
        <p class="ql-help">Your key is stored locally and sent only to api.torn.com to fetch item names and market values (torn → items). Opening containers also works without a key.</p>
        <a href="https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=ContainerOpener&torn=items" target="_blank" rel="noopener noreferrer">Create an item-price API key in Torn</a>
        <div class="ql-price-actions"><button data-action="prices">Save and fetch prices</button><button data-action="forget-key">Forget key</button></div>
        <p id="ql-price-status" role="status">No prices loaded yet.</p><p class="ql-help">Bought a container at a different price? Enter your cost per item below. Leave it empty to use market value. New prices apply to future openings; past results retain their original valuation.</p><div id="ql-costs"></div></details>
        </section>
        <section id="ql-page-history" role="tabpanel" aria-labelledby="ql-tab-history" hidden>
        <h3>Opening history</h3><p class="ql-help">The last 500 confirmed openings are saved on this device, including after reloading or starting a new round. Openings from before this feature was installed cannot be recovered.</p>
        <ol id="ql-history"></ol><details><summary>Recent rewards this session</summary><ol id="ql-log"><li>No openings yet.</li></ol></details></section></div>
        <footer class="ql-body"><section id="ql-latest" hidden aria-live="polite" aria-label="Latest rewards"></section><p id="ql-status" role="status" aria-live="polite"></p><button id="ql-open">Open next</button><button id="ql-finish" data-action="finish">Finish and view summary</button><small>One press · one container · no automatic repeats</small></footer>`;
    document.body.appendChild(panel);

    function selectTab(tab) {
        if (!['rules', 'settings', 'history'].includes(tab)) return;
        panel.querySelectorAll('[data-tab]').forEach(button => {
            const selected = button.dataset.tab === tab;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
        });
        panel.querySelectorAll('[role=tabpanel]').forEach(section => section.hidden = section.id !== 'ql-page-' + tab);
        if (tab === 'settings') panel.querySelector('#ql-pricing').open = true;
    }
    panel.querySelector('.ql-tabs').addEventListener('keydown', event => {
        const tabs = [...panel.querySelectorAll('[data-tab]')];
        const index = tabs.indexOf(event.target);
        if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
            (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        selectTab(tabs[next].dataset.tab); tabs[next].focus();
    });
    const quickOpen = document.createElement('button');
    quickOpen.id = 'qlco-quick-open'; quickOpen.type = 'button';
    quickOpen.hidden = !prefs.quickButton;
    quickOpen.addEventListener('click', openOne);
    quickOpen.addEventListener('keydown', event => {
        if (event.repeat && ['Enter', ' '].includes(event.key)) event.preventDefault();
    });
    document.body.appendChild(quickOpen);

    // FLIPR reference: stable Notes/People IDs anchor custom buttons in Torn's bar.
    // Create our own button, without copying native handlers or changing other scripts.
    const launcher = document.createElement('button');
    launcher.id = 'qlco-dock-button';
    launcher.type = 'button';
    launcher.textContent = '📦';
    launcher.title = 'Container Opener — show/hide';
    launcher.setAttribute('aria-label', 'Container Opener — show/hide');
    launcher.setAttribute('aria-controls', panel.id);
    function ensureLauncher() {
        if (!quickOpen.isConnected) document.body.appendChild(quickOpen);
        const anchor = [document.getElementById('notes_panel_button'), document.getElementById('people_panel_button')]
            .find(node => node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
        const parent = anchor?.parentElement || document.body;
        const docked = !!anchor;
        if (launcher.parentElement !== parent || launcher.classList.contains('qlco-floating') === docked) {
            launcher.className = docked ? `${anchor.className} qlco-docked` : 'qlco-floating';
            if (docked) {
                const rect = anchor.getBoundingClientRect();
                launcher.style.width = `${Math.max(24, Math.min(44, rect.width))}px`;
                launcher.style.height = `${Math.max(24, Math.min(44, rect.height))}px`;
            } else { launcher.style.width = ''; launcher.style.height = ''; }
            parent.appendChild(launcher);
        }
    }
    function showPanel(show, persist = true) {
        collapsed = !show;
        panel.hidden = collapsed;
        launcher.setAttribute('aria-expanded', String(show));
        if (persist) put('ql_container_opener_panel_v2', { hidden: collapsed });
        if (show) { scan(); panel.querySelector('[data-action="collapse"]').focus({ preventScroll: true }); }
        else launcher.focus({ preventScroll: true });
    }
    launcher.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation(); showPanel(collapsed);
    });
    ensureLauncher();
    panel.hidden = collapsed;
    launcher.setAttribute('aria-expanded', String(!collapsed));

    function controlValues(row, attribute) {
        const values = [row, ...row.querySelectorAll(`[${attribute}]`)].map(node => node.getAttribute(attribute)).filter(Boolean);
        return [...new Set(values)];
    }
    function scan() {
        ensureLauncher();
        if (document.visibilityState !== 'visible' || !document.hasFocus() || client.busy || halted) return;
        const seen = new Set();
        document.querySelectorAll('li[data-item], [data-item-id], [data-itemid], img[src*="items/"], [data-armory-id], [data-armoryid]').forEach(node => {
            if (node.closest('#qlco-v2, #ql-container-opener, #qlco-modal')) return;
            const row = node.closest('li.torn-divider, li, tr, [data-armory-id], [data-armoryid], [class*="itemRow"], [class*="item-row"]');
            if (!row || seen.has(row)) return;
            seen.add(row);
            const image = node.matches('img') ? node : row.querySelector('img');
            const candidates = [image?.alt, image?.title, row.dataset.name,
                ...[...row.querySelectorAll('.name-wrap, .title-wrap .name, [class*="name"]')].map(node => node.textContent)];
            const byLength = [...names].sort((a, b) => b.length - a.length);
            const name = byLength.find(name => candidates.some(text => norm(text) === norm(name))) ||
                byLength.find(name => candidates.some(text => (` ${norm(text)} `).includes(` ${norm(name)} `)));
            if (!name) return;
            const current = runtime.get(name);
            // Never overwrite quantities or next XIDs from a confirmed response with stale inventory DOM.
            if (current?.touched || current?.manual) return;
            const ids = [...new Set([...controlValues(row, 'data-item'), ...controlValues(row, 'data-item-id'), ...controlValues(row, 'data-itemid')])];
            if (!ids.length && image) {
                const match = String(image.getAttribute('src')).match(/\/items\/(\d+)(?:[/.?]|$)/);
                if (match) ids.push(match[1]);
            }
            const xids = [...new Set([...controlValues(row, 'data-armory-id'), ...controlValues(row, 'data-armoryid'), ...controlValues(row, 'data-xid')])].filter(id);
            let quantity = null;
            const quantityNode = row.querySelector('[data-quantity], [data-qty], .b-item-amount, [class*="amount"], [class*="quantity"]');
            const quantityText = row.dataset.quantity || row.dataset.qty || quantityNode?.getAttribute('data-quantity') || quantityNode?.getAttribute('data-qty') || quantityNode?.textContent;
            const match = String(quantityText || '').trim().match(/^[x×]?\s*([\d,]+)\s*$/);
            if (match) quantity = Number(match[1].replace(/,/g, ''));
            // Multiple instance IDs in a row are ambiguous; ask for an explicit connection instead.
            runtime.set(name, { name, itemID: ids.length === 1 ? ids[0] : '', xid: xids.length === 1 ? xids[0] : '',
                quantity, opened: current?.opened || 0, touched: false, supplyPack: row.dataset.category === 'Supply Pack' });
        });
        render();
    }
    function eligible(item) {
        const p = plan(item.name);
        return p.selected && !prefs.blacklist.includes(item.name) && !!item.itemID &&
            (p.limit === 0 || item.opened < p.limit) &&
            (item.quantity === null ? p.keep === 0 : item.quantity > p.keep);
    }
    function next() { return [...runtime.values()].find(eligible); }
    function renderResults() {
        const latest = panel.querySelector('#ql-latest');
        latest.hidden = !log.length;
        if (log.length) {
            const entry = log[0];
            latest.innerHTML = `<strong>Latest rewards · ${esc(entry.name)}</strong><div class="ql-reward-line">${esc(entry.rewardText || 'See the Torn result below.')}</div><p>${esc(entry.text)}</p>`;
        }
        panel.querySelector('#ql-log').innerHTML = log.length ? log.map(entry => `<li><b>${esc(entry.name)}</b><span>${esc(entry.text)}</span><small>${esc(entry.rewardText)}</small></li>`).join('') : '<li>No openings yet.</li>';
        panel.querySelector('#ql-history').innerHTML = history.length ? history.map(entry =>
            `<li><time>${esc(new Date(entry.openedAt).toLocaleString('en-GB'))}</time><b>${esc(entry.name)}</b><span>${esc(entry.text)}</span><small>${esc(entry.rewardText || '')}</small><small>${entry.net === null || !Number.isFinite(entry.net) ? 'Price unavailable' : signedMoney(entry.net)}</small></li>`).join('') : '<li>No saved openings yet.</li>';
        panel.querySelector('#ql-total-rewards').textContent = opened
            ? [money(cash), ...[...rewardTotals.values()].map(item => `${item.qty}× ${item.name}`)].join(' · ') : 'No openings yet.';
    }
    function render(preserveList = false) {
        const focus = document.activeElement;
        const editing = panel.contains(focus) && focus.matches('input[type="number"]');
        panel.querySelector('#ql-key-state').textContent = get('ql_container_opener_api_key_v1', '')
            ? 'Key saved on this device. Retained when this script is updated.'
            : 'No key saved on this device.';
        panel.querySelector('#ql-count').textContent = opened;
        panel.querySelector('#ql-cash').textContent = money(cash);
        // Result UI must update even while quantity fields retain keyboard focus.
        renderResults();
        const item = next();
        panel.querySelector('#ql-status').textContent = !halted && !client.busy && item && !findToken()
            ? 'Torn is not ready yet. Reload the Items page if this message persists.' : status;
        const open = panel.querySelector('#ql-open');
        open.disabled = client.busy || pricesLoading || halted || !!popup || !item || !findToken();
        panel.querySelector('#ql-finish').disabled = client.busy || !records.length;
        panel.querySelector('#ql-price-state').textContent = pricesLoading ? '· loading…' : Object.keys(prices()).length ? '· ready' : '· not enabled';
        open.textContent = client.busy ? loading ? 'Finding your containers…' : 'Waiting for Torn…' : halted ? 'Stopped — reload the page' : item ? `Open ${item.name}` : 'Select a container in Rules';
        quickOpen.hidden = !prefs.quickButton;
        quickOpen.disabled = open.disabled;
        quickOpen.textContent = item || client.busy || halted ? open.textContent : 'None ready · see Rules';
        quickOpen.title = status;
        panel.querySelectorAll('[data-action="scan"], [data-action="load"]').forEach(button => button.disabled = client.busy || halted);
        panel.querySelector('#ql-find').textContent = loading ? 'Finding your containers…' : runtime.size ? 'Fetch a fresh list from Torn' : 'Find my containers';
        if (preserveList === true || editing) return;
        panel.querySelector('#ql-costs').innerHTML = [...runtime.values()].map(item => `<label class="ql-cost-row"><span>${esc(item.name)}</span><input type="number" min="0" step="0.01" inputmode="decimal" data-cost="${esc(item.itemID)}" aria-label="Your purchase cost per ${esc(item.name)}" placeholder="Market price" value="${typeof costs[item.itemID] === 'number' ? costs[item.itemID] : ''}"></label>`).join('');
        const visible = [...runtime.values()].filter(item => filter === 'all' || groupOf(item.name) === filter);
        panel.querySelector('#ql-list').innerHTML = visible.length ? visible.map(item => {
            const p = plan(item.name), blocked = prefs.blacklist.includes(item.name);
            return `<article data-name="${esc(item.name)}" class="${blocked ? 'ql-blocked' : ''}"><label><input type="checkbox" data-field="selected" ${p.selected ? 'checked' : ''} ${blocked ? 'disabled' : ''}><span><b>${esc(item.name)}</b><small>${item.quantity === null ? 'Quantity unknown' : `${item.quantity} remaining`} · ${item.opened} opened · ${blocked ? 'Blocked' : item.itemID ? p.keep && item.quantity === null ? 'Fetch the list to use Keep at least' : 'Ready' : 'Open the category in Torn'}</small></span></label><label class="ql-number"><small>Open up to</small><input aria-label="Maximum to open: ${esc(item.name)}" data-field="limit" type="number" min="0" step="1" placeholder="All" value="${p.limit || ''}"></label><label class="ql-number"><small>Keep at least</small><input aria-label="Keep at least ${esc(item.name)}" data-field="keep" type="number" min="0" step="1" value="${p.keep}"></label></article>`;
        }).join('') : `<p class="ql-empty">${filter === 'all' ? 'Press “Find my containers” to load your inventory without opening anything.' : 'Nothing found in this category. Select All categories or open the relevant category in Torn.'}</p>`;
        panel.querySelector('#ql-blocks').innerHTML = names.map(name => `<label><input type="checkbox" data-block="${esc(name)}" ${prefs.blacklist.includes(name) ? 'checked' : ''}>${esc(name)}</label>`).join('');
    }
    async function openOne(event) {
        // Reject programmatic clicks; holding a key does not generate repeated openings.
        if (!event.isTrusted || client.busy || pricesLoading || halted || popup) return;
        const item = next();
        if (!item) return;
        // Snapshot every available price before dispatch, so a later price refresh
        // cannot silently change the accounting for a completed opening.
        const catalog = prices();
        const override = costs[item.itemID];
        const pricedAt = priceData.fetchedAt;
        status = `Opening one ${item.name}…`;
        // createClient sets busy synchronously before its first await.
        try {
            const promise = client.open(item);
            render();
            const result = await promise;
            item.touched = true;
            item.xid = result.next;
            item.opened += 1;
            if (item.quantity !== null) item.quantity = Math.max(0, item.quantity - 1);
            if (result.availabilityKnown && !result.another) item.quantity = 0;
            opened += 1;
            cash += result.cash;
            for (const reward of result.rewards) {
                if (reward.isMoney || !Number.isFinite(Number(reward.qty))) continue;
                const key = String(reward.itemID || reward.ID || reward.name || 'unknown');
                const current = rewardTotals.get(key);
                rewardTotals.set(key, { name: plainText(reward.name) || plainText(catalog[key]?.name) || `Item ${key}`, qty: (current?.qty || 0) + Number(reward.qty) });
            }
            log.unshift({ name: item.name, text: plainText(result.text), rewardText: result.rewards.map(reward =>
                reward.isMoney ? plainText(reward.moneyGain) : `${reward.qty ?? '?'}× ${plainText(reward.name) || plainText(catalog[reward.itemID || reward.ID]?.name) || `Item ${reward.itemID || reward.ID || '?'}`}`).join(' · ') });
            if (log.length > 30) log.length = 30;
            const value = valueOpening(item.itemID, result.rewards, catalog, override);
            value.entries.forEach(entry => entry.name = plainText(entry.name));
            const record = { name: item.name, itemID: item.itemID, text: plainText(result.text), value, pricedAt };
            records.push(record);
            history.unshift({ ...log[0], openedAt: Date.now(), net: value.net });
            history.length = Math.min(history.length, 500);
            put('ql_container_opener_history_v1', history);
            status = result.availabilityKnown && !result.another ? 'Opened. None left of this type; the next selected type is ready.' : 'Opened. Press again when you want to open the next one.';
            showResult(record, !next());
        } catch (error) {
            halted = true;
            item.touched = true;
            item.xid = '';
            status = `${error.message} Check your inventory and reload the page to continue. No automatic retry will be made.`;
        }
        render();
    }
    panel.querySelector('#ql-open').addEventListener('click', openOne);
    panel.addEventListener('keydown', event => {
        if (event.target.id === 'ql-open' && event.repeat && ['Enter', ' '].includes(event.key)) event.preventDefault();
    });
    panel.addEventListener('change', event => {
        const target = event.target;
        if (target.id === 'ql-quick-enabled') {
            prefs.quickButton = target.checked; save(); render(true); return;
        }
        if (target.dataset.cost) {
            if (target.value.trim() === '') delete costs[target.dataset.cost];
            else if (Number.isFinite(Number(target.value)) && Number(target.value) >= 0) costs[target.dataset.cost] = Number(target.value);
            put('ql_container_opener_costs_v1', costs); return;
        }
        if (target.id === 'ql-filter') { filter = target.value; render(); return; }
        if (target.dataset.block) {
            const set = new Set(prefs.blacklist);
            target.checked ? set.add(target.dataset.block) : set.delete(target.dataset.block);
            prefs.blacklist = [...set]; save(); render(); return;
        }
        const row = target.closest('article[data-name]');
        if (row && target.dataset.field) {
            const p = plan(row.dataset.name);
            p[target.dataset.field] = target.type === 'checkbox' ? target.checked : Math.max(0, Math.floor(Number(target.value) || 0));
            prefs.plans[row.dataset.name] = p; save(); render(true);
        }
    });
    panel.addEventListener('click', event => {
        const tab = event.target.closest('[data-tab]')?.dataset.tab;
        if (tab) selectTab(tab);
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'api-settings') {
            selectTab('settings');
            panel.querySelector('#ql-pricing').open = true;
            panel.querySelector('#ql-api-key').focus({ preventScroll: true });
            panel.querySelector('#ql-api-key').scrollIntoView({ block: 'center' });
        }
        if (action === 'collapse') {
            showPanel(false);
        }
        if (action === 'scan') { status = 'List refreshed from the open inventory category.'; scan(); }
        if (action === 'load' && event.isTrusted) loadInventory();
        if (action === 'prices' && event.isTrusted) loadPrices();
        if (action === 'forget-key') { put('ql_container_opener_api_key_v1', ''); panel.querySelector('#ql-api-key').value = ''; panel.querySelector('#ql-price-status').textContent = 'Key removed. Cached prices remain available until they expire.'; render(true); }
        if (action === 'finish' && !client.busy && records.length) showSummary();
    });
    async function loadInventory() {
        if (client.busy || halted) return;
        loading = true;
        status = 'Loading your containers. Nothing will be opened.';
        try {
            const request = client.discover(); render();
            const data = await request;
            const found = new Map();
            for (const entry of data.list) {
                const name = names.find(name => norm(name) === norm(entry.name));
                const itemID = String(entry.ID ?? entry.itemID ?? '');
                const quantity = Number(entry.Qty);
                // Faction-loaned items must not become personal opening targets.
                if (!name || !/^\d+$/.test(itemID) || !Number.isSafeInteger(quantity) || quantity < 0 || entry.factionItem || Number(entry.factionID) > 0) continue;
                const previous = runtime.get(name);
                const current = found.get(name);
                if (current && current.itemID !== itemID) continue;
                found.set(name, { name, itemID, xid: '', quantity: Math.max(quantity, current?.quantity || 0),
                    opened: previous?.opened || 0, touched: true });
            }
            // Replace the known supply-pack rows, including entries no longer owned.
            for (const [name, item] of runtime) {
                if (item.supplyPack) runtime.delete(name);
            }
            for (const [name, item] of found) runtime.set(name, { ...item, supplyPack: true });
            status = found.size ? `${found.size} types found. Select what you want to open and press Open.` : 'No known containers found. Open the relevant category in Torn for the panel to detect them.';
            if (Number(data.count) > data.list.length) status += ' The list may be paginated; open the category in Torn to see more.';
        } catch (error) { status = error.message; }
        finally { loading = false; render(); }
    }
    async function loadPrices() {
        if (pricesLoading) return;
        const input = panel.querySelector('#ql-api-key');
        const key = input.value.trim() || get('ql_container_opener_api_key_v1', '');
        const message = panel.querySelector('#ql-price-status');
        if (!/^[A-Za-z0-9]{16,64}$/.test(key)) { message.textContent = 'Enter a valid Torn API key with access to torn → items.'; return; }
        put('ql_container_opener_api_key_v1', key);
        input.value = '';
        pricesLoading = true; message.textContent = 'Fetching market prices from Torn…'; render(true);
        try {
            const url = new URL('https://api.torn.com/torn/');
            url.search = new URLSearchParams({ selections: 'items', key, comment: 'QL Container Opener prices' }).toString();
            const data = await new Promise((resolve, reject) => {
                const fail = () => reject(new Error('Prices could not be fetched. Check your key permissions and try again.'));
                if (typeof GM_xmlhttpRequest === 'function') {
                    GM_xmlhttpRequest({ method: 'GET', url: url.href, anonymous: true, timeout: 15000,
                        onload: response => {
                            try { if (response.status !== 200) return fail(); resolve(JSON.parse(response.responseText)); } catch { fail(); }
                        }, onerror: fail, ontimeout: fail });
                } else {
                    fetch(url.href, { credentials: 'omit', signal: AbortSignal.timeout(15000) })
                        .then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(resolve).catch(fail);
                }
            });
            if (data.error || !data.items || typeof data.items !== 'object') {
                // Keep the user's saved key on API errors; only Forget key removes it.
                throw new Error(`Torn rejected the price request${data.error?.code ? ` (code ${Number(data.error.code)})` : ''}. Check access to torn → items.`);
            }
            const items = {};
            for (const [itemID, item] of Object.entries(data.items)) {
                if (/^\d+$/.test(itemID) && Number.isFinite(item.market_value) && item.market_value > 0)
                    items[itemID] = { name: String(item.name || `Item ${itemID}`), price: item.market_value };
            }
            if (!Object.keys(items).length) throw new Error('Torn returned no usable market prices.');
            priceData = { fetchedAt: Date.now(), items }; put('ql_container_opener_prices_v1', priceData);
            message.textContent = `Prices fetched ${new Date(priceData.fetchedAt).toLocaleTimeString('en-GB')}. Cached for up to one hour. Past openings are unchanged.`;
        } catch (error) { message.textContent = error.message; }
        finally { pricesLoading = false; render(true); }
    }
    function closePopup() {
        if (!popup) return;
        popup.remove(); popup = null; panel.inert = false; launcher.inert = false;
        render(true);
        const focus = popupReturnFocus?.isConnected && !popupReturnFocus.disabled ? popupReturnFocus : panel.hidden ? launcher : panel.querySelector('[data-action="collapse"]');
        if (!focus.disabled) focus.focus({ preventScroll: true });
    }
    function modal(tone, content, actions) {
        if (popup) popup.remove(); else popupReturnFocus = document.activeElement;
        popup = document.createElement('div'); popup.id = 'qlco-result-overlay';
        popup.lang = 'en';
        popup.innerHTML = `<section class="ql-dialog ${tone}" role="dialog" aria-modal="true" aria-labelledby="ql-dialog-title" tabindex="-1"><button class="ql-dialog-close" aria-label="Close result">×</button><div class="ql-dialog-scroll">${content}</div><div class="ql-dialog-actions">${actions.map((action, index) => `<button data-dialog-action="${index}" class="${index === actions.length - 1 ? 'primary' : ''}">${esc(action.label)}</button>`).join('')}</div></section>`;
        document.body.appendChild(popup); panel.inert = true; launcher.inert = true;
        popup.querySelector('.ql-dialog-close').addEventListener('click', closePopup);
        popup.querySelectorAll('[data-dialog-action]').forEach(button => button.addEventListener('click', event => actions[Number(button.dataset.dialogAction)].run(event)));
        popup.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); closePopup(); }
            if (event.key === 'Tab') {
                const buttons = [...popup.querySelectorAll('button:not(:disabled)')];
                const first = buttons[0], last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
            if (event.repeat && ['Enter', ' '].includes(event.key)) event.preventDefault();
        });
        popup.querySelector('.ql-dialog-close').focus({ preventScroll: true }); render(true);
    }
    function toneFor(net, cost) { return net === null ? 'neutral' : net < 0 ? 'loss' : net === 0 ? 'even' : cost > 0 && net >= cost * .5 ? 'jackpot' : 'win'; }
    function rewardRows(entries) {
        return `<ul class="ql-loot">${entries.map(entry => `<li><span class="ql-loot-icon">${entry.cash ? '$' : '◆'}</span><span><b>${entry.cash ? 'Cash' : `${entry.qty}× ${esc(entry.name)}`}</b></span><strong>${entry.value === null ? 'Price unavailable' : money(entry.value)}</strong></li>`).join('')}</ul>`;
    }
    function showResult(record, finished) {
        if (finished) { showSummary(record); return; }
        const value = record.value, tone = toneFor(value.net, value.cost);
        const heading = { neutral: 'Your rewards are ready', loss: 'This one made a loss', even: 'You broke even', jackpot: 'Big rewards!', win: 'You made a profit!' }[tone];
        modal(tone, `<div class="ql-result-hero"><div class="ql-result-emblem">${tone === 'jackpot' ? '✦' : tone === 'loss' ? '↘' : '◆'}</div><small>${esc(record.name)} opened</small><h2 id="ql-dialog-title">${heading}</h2><div class="ql-result-number">${signedMoney(value.net)}</div><span>${value.net === null ? 'Prices are missing to calculate the difference' : 'Estimated difference before selling fees'}</span></div>
            ${rewardRows(value.entries)}<div class="ql-result-stats"><span>Container cost<b>${value.cost === null ? 'Unknown' : money(value.cost)}</b><small>${value.basis}</small></span><span>Reward value<b>${value.missing.length ? 'At least ' : ''}${money(value.received)}</b><small>Cash + items</small></span></div><p class="ql-result-note">${esc(record.text)}</p>${value.net === null ? '<p class="ql-result-note">Enable prices in the panel for future openings. Missing prices are not counted as zero.</p>' : ''}`,
            [{ label: value.net === null ? 'Enable prices' : 'Back to the list', run: () => {
                closePopup();
                if (value.net === null) { showPanel(true); selectTab('settings'); panel.querySelector('#ql-pricing').open = true; panel.querySelector('#ql-pricing').scrollIntoView({ block: 'nearest' }); panel.querySelector('#ql-api-key').focus(); }
            } }, { label: 'Open next', run: event => { closePopup(); openOne(event); } }]);
    }
    function showSummary(last = null) {
        if (!records.length) return;
        const sum = sumOpenings(records), tone = toneFor(sum.net, sum.cost);
        const consumed = new Map(), loot = new Map();
        for (const record of records) {
            const old = consumed.get(record.itemID) || { name: record.name, qty: 0, value: 0, unknown: false };
            old.qty++; old.value += record.value.cost ?? 0; old.unknown ||= record.value.cost === null; consumed.set(record.itemID, old);
            for (const entry of record.value.entries) {
                const key = entry.cash ? 'cash' : entry.itemID;
                const oldLoot = loot.get(key);
                loot.set(key, { ...entry, qty: (oldLoot?.qty || 0) + entry.qty,
                    value: entry.value === null || oldLoot?.value === null ? null : (oldLoot?.value || 0) + entry.value });
            }
        }
        modal(tone, `<div class="ql-result-hero"><div class="ql-result-emblem">${sum.net !== null && sum.net > 0 ? '✦' : '▣'}</div><small>${last ? 'This round is complete' : 'Your summary'}</small><h2 id="ql-dialog-title">${sum.count} containers opened</h2><div class="ql-result-number">${signedMoney(sum.net)}</div><span>${sum.complete ? 'Total estimated profit / loss' : `${sum.unknown} openings have incomplete pricing`}</span></div>
            <div class="ql-result-stats"><span>Containers used<b>${sum.complete ? '' : 'Known: '}${money(sum.cost)}</b><small>Value spent</small></span><span>Rewards received<b>${sum.complete ? '' : 'Known: '}${money(sum.received)}</b><small>Cash + items</small></span><span>Profitable<b>${sum.wins}</b></span><span>Unprofitable<b>${sum.losses}</b></span></div>
            ${last ? `<p class="ql-result-note"><b>Last opening:</b> ${esc(last.text)}</p>` : ''}<h3>What you received</h3>${rewardRows([...loot.values()])}<h3>What you used</h3><ul class="ql-consumed">${[...consumed.values()].map(entry => `<li><span>${entry.qty}× ${esc(entry.name)}</span><b>${entry.unknown ? 'Partially unknown' : money(entry.value)}</b></li>`).join('')}</ul><p class="ql-result-note">Market values are estimates before fees. A purchase cost overrides the container's market value. Prices are recorded at the time of each opening.</p>`,
            [{ label: 'Close summary', run: closePopup }, { label: 'New round', run: () => {
                closePopup(); records.length = 0; log.length = 0; rewardTotals.clear(); opened = 0; cash = 0;
                for (const item of runtime.values()) item.opened = 0;
                status = 'New round. Choose the containers you want to open.'; render();
            } }]);
    }
    const observer = new MutationObserver(records => {
        ensureLauncher();
        if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
        if (!records.some(record => !panel.contains(record.target) && !quickOpen.contains(record.target) && !launcher.contains(record.target))) return;
        clearTimeout(scanTimer); scanTimer = setTimeout(scan, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['data-item', 'data-qty', 'data-quantity', 'data-name'] });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scan(); else clearTimeout(scanTimer); });
    window.addEventListener('focus', scan);
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Show Container Opener', () => showPanel(true));
    window.addEventListener('resize', ensureLauncher);

    const style = document.createElement('style');
    style.textContent = `
        #qlco-v2{--ql-bg:#151c25;--ql-line:#344150;--ql-muted:#a9b7c8;position:fixed;z-index:2147483000;left:16px;top:80px;width:min(460px,calc(100vw - 24px));max-height:83vh;display:flex;flex-direction:column;overflow:hidden;background:var(--ql-bg);color:#eef4fb;border:1px solid #43546a;border-radius:14px;box-shadow:0 14px 40px #0008;font:13px/1.45 Arial,sans-serif;color-scheme:dark}
        #qlco-v2 *{box-sizing:border-box}#qlco-v2 header{display:flex;justify-content:space-between;align-items:center;padding:13px 16px;border-bottom:1px solid var(--ql-line)}#qlco-v2 header small{color:#9ac8ff;font-size:9px;letter-spacing:.08em}#qlco-v2 h2{margin:2px 0 0;font-size:21px;color:#fff}#qlco-v2 button,#qlco-v2 select,#qlco-v2 input{font:inherit}#qlco-v2 button{cursor:pointer;background:#263548;border:1px solid #50637b;border-radius:7px;padding:7px 10px;color:#fff}#qlco-v2 button:disabled{opacity:.5;cursor:default}#qlco-v2 :focus-visible{outline:2px solid #9ac8ff;outline-offset:2px}#qlco-v2 header button{width:34px;height:34px}#qlco-v2 .ql-body{padding:12px 14px}#qlco-v2 div.ql-body{overflow:auto;min-height:0;overscroll-behavior:contain}#qlco-v2 .ql-totals{display:flex;gap:24px;color:var(--ql-muted);margin-bottom:12px}#qlco-v2 .ql-totals b{margin-left:6px;color:#fff}#qlco-v2 nav{display:flex;gap:6px}#qlco-v2 nav select{flex:1;min-width:0}#qlco-v2 input,#qlco-v2 select{background:#0d141d;border:1px solid #50637b;border-radius:5px;padding:6px;color:#fff;min-width:0}#qlco-v2 input[type=checkbox]{accent-color:#87bcff;width:17px;height:17px;flex-shrink:0}#qlco-v2 .ql-help{font-size:11px;color:var(--ql-muted)}#qlco-v2 .ql-columns,#qlco-v2 article{display:grid;grid-template-columns:minmax(0,1fr) 62px 62px;gap:7px;align-items:center}#qlco-v2 .ql-columns{font-size:10px;color:var(--ql-muted);padding:0 8px 5px}#qlco-v2 article{padding:9px 7px;border-top:1px solid var(--ql-line)}#qlco-v2 article label{display:flex;align-items:center;gap:7px;min-width:0}#qlco-v2 article b{display:block;font-size:12px;overflow-wrap:anywhere}#qlco-v2 article small{display:block;color:var(--ql-muted);font-size:10px}#qlco-v2 article input[type=number]{width:100%}#qlco-v2 .ql-blocked{opacity:.6}#qlco-v2 details{border-top:1px solid var(--ql-line);margin-top:10px;padding-top:10px}#qlco-v2 summary{cursor:pointer;color:#c3d9f4}#qlco-v2 #ql-blocks{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px}#qlco-v2 #ql-blocks label{display:flex;align-items:center;gap:6px;font-size:11px}#qlco-v2 form label{display:flex;flex-direction:column;gap:3px;margin:8px 0}#qlco-v2 form p{font-size:11px;color:var(--ql-muted)}#qlco-v2 #ql-log{padding:0;list-style:none;max-height:180px;overflow:auto}#qlco-v2 #ql-log li{padding:8px 0;border-bottom:1px solid var(--ql-line)}#qlco-v2 #ql-log span,#qlco-v2 #ql-log small{display:block;overflow-wrap:anywhere}#qlco-v2 #ql-log small{color:#98dbb1}#qlco-v2 footer{border-top:1px solid var(--ql-line);flex-shrink:0;background:#101721}#qlco-v2 #ql-status{margin:0 0 9px;font-size:12px;overflow-wrap:anywhere}#qlco-v2 #ql-open{width:100%;min-height:46px;background:#286341;border-color:#65b784;font-size:15px;font-weight:bold}#qlco-v2 footer>small{display:block;text-align:center;color:var(--ql-muted);font-size:10px;margin-top:7px}#qlco-v2.ql-collapsed .ql-body{display:none}#qlco-v2 .ql-empty{color:var(--ql-muted)}
        @media(max-width:759px){#qlco-v2{left:0;top:auto;bottom:0;width:100%;max-height:78dvh;border-radius:14px 14px 0 0}#qlco-v2 .ql-body{padding:10px 12px}#qlco-v2 input,#qlco-v2 select{font-size:16px}#qlco-v2 #ql-blocks{grid-template-columns:1fr}#qlco-v2 article{grid-template-columns:minmax(0,1fr) 56px 56px}#qlco-v2.ql-collapsed{width:280px}#qlco-v2 footer{padding-bottom:max(10px,env(safe-area-inset-bottom))}}
    `;
    document.head.appendChild(style);
    const resultStyle = document.createElement('style');
    resultStyle.textContent = `
        #qlco-v2[hidden],#qlco-v2 [hidden]{display:none!important}
        #qlco-v2 #ql-latest{margin:0 0 10px;padding:10px 11px;border:1px solid #4a9b6b;border-radius:8px;background:#173025;max-height:min(24vh,180px);overflow:auto;overscroll-behavior:contain}
        #qlco-v2 #ql-latest>strong{display:block;color:#b8eaca;font-size:11px}
        #qlco-v2 #ql-latest .ql-reward-line{font-size:16px;font-weight:bold;color:#fff;overflow-wrap:anywhere;margin-top:4px}
        #qlco-v2 #ql-latest p{margin:5px 0 0;font-size:11px;color:#c4d6cc;overflow-wrap:anywhere}
        #qlco-v2 #ql-total-rewards{padding:8px 0;color:#b8eaca;overflow-wrap:anywhere}
        #qlco-dock-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;min-width:24px;min-height:24px;cursor:pointer;border:1px solid #427356;border-radius:5px;background:#23553a;color:#fff;font:18px/1 Arial,sans-serif;padding:0;vertical-align:middle}
        #qlco-dock-button[aria-expanded="true"]{background:#347e54;border-color:#9bd1ae}
        #qlco-dock-button:focus-visible{outline:2px solid #b7d9ff;outline-offset:2px}
        #qlco-dock-button.qlco-floating{position:fixed;z-index:2147482999;right:12px;bottom:max(8px,env(safe-area-inset-bottom));width:42px;height:42px;box-shadow:0 3px 14px #0006}
        @media(max-width:759px){#qlco-v2{bottom:54px;max-height:min(78dvh,calc(100dvh - 80px))}#qlco-v2 #ql-latest{max-height:22dvh}}
    `;
    document.head.appendChild(resultStyle);
    const popupStyle = document.createElement('style');
    popupStyle.textContent = `
        #qlco-result-overlay{position:fixed;inset:0;z-index:2147483645;display:flex;align-items:center;justify-content:center;padding:20px;background:#030710cc;backdrop-filter:blur(6px);font:14px/1.45 Arial,sans-serif;color:#edf4ff;color-scheme:dark}
        #qlco-result-overlay *{box-sizing:border-box}#qlco-result-overlay .ql-dialog{--accent:#9bbce8;position:relative;display:flex;flex-direction:column;width:min(540px,100%);max-height:90dvh;border:1px solid #465c77;border-radius:22px;background:#111b29;box-shadow:0 24px 100px #000a;overflow:hidden;animation:ql-reveal .24s ease-out}
        #qlco-result-overlay .win{--accent:#73e4a3}#qlco-result-overlay .loss{--accent:#f19a9f}#qlco-result-overlay .jackpot{--accent:#ffd579;background:#201d18;border-color:#b78a3c}#qlco-result-overlay .even{--accent:#a7c7f1}
        #qlco-result-overlay .ql-dialog-scroll{padding:25px;overflow:auto;min-height:0;overscroll-behavior:contain}#qlco-result-overlay .ql-dialog-close{position:absolute;right:12px;top:10px;z-index:1;width:40px;height:40px;border:0;border-radius:50%;background:#ffffff0d;color:#fff;font-size:27px;cursor:pointer}
        #qlco-result-overlay .ql-result-hero{text-align:center;padding:8px 12px 20px}#qlco-result-overlay .ql-result-emblem{display:grid;place-items:center;width:70px;height:70px;margin:0 auto 14px;border:1px solid var(--accent);border-radius:22px;color:var(--accent);font-size:38px;background:#ffffff08;box-shadow:0 0 35px #ffffff09}
        #qlco-result-overlay .jackpot .ql-result-emblem{box-shadow:0 0 45px #ffd57933;transform:rotate(-8deg)}#qlco-result-overlay .ql-result-hero small{display:block;color:#b2c1d5;text-transform:uppercase;letter-spacing:.09em;font-size:10px}#qlco-result-overlay h2{font-size:clamp(21px,5vw,29px);margin:7px 0;line-height:1.15;color:#fff}#qlco-result-overlay h3{font-size:15px;margin:20px 0 8px}#qlco-result-overlay .ql-result-number{font-size:clamp(27px,7vw,43px);line-height:1.2;font-weight:bold;color:var(--accent);margin:10px 0 5px;overflow-wrap:anywhere}#qlco-result-overlay .ql-result-hero>span{font-size:11px;color:#b2c1d5}
        #qlco-result-overlay .ql-loot{list-style:none;padding:0;margin:0;display:grid;gap:8px}#qlco-result-overlay .ql-loot li{display:flex;align-items:center;gap:10px;padding:11px;border:1px solid #ffffff13;border-radius:11px;background:#ffffff05}#qlco-result-overlay .ql-loot-icon{display:grid;place-items:center;flex-shrink:0;width:34px;height:34px;border-radius:9px;background:#ffffff0b;color:var(--accent);font-size:21px}#qlco-result-overlay .ql-loot li>span:nth-child(2){flex:1;min-width:0;overflow-wrap:anywhere}#qlco-result-overlay .ql-loot strong{font-size:12px;color:var(--accent);text-align:right}
        #qlco-result-overlay .ql-result-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}#qlco-result-overlay .ql-result-stats>span{padding:12px;background:#0002;border-radius:10px;color:#b5c4d7;font-size:11px;min-width:0}#qlco-result-overlay .ql-result-stats b{display:block;font-size:19px;color:#fff;overflow-wrap:anywhere}#qlco-result-overlay .ql-result-stats small{display:block;font-size:10px}#qlco-result-overlay .ql-result-note{color:#b5c4d7;font-size:11px;overflow-wrap:anywhere}#qlco-result-overlay .ql-consumed{padding:0;list-style:none}#qlco-result-overlay .ql-consumed li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #ffffff10;font-size:12px}
        #qlco-result-overlay .ql-dialog-actions{display:flex;gap:9px;padding:14px 20px;border-top:1px solid #ffffff13;flex-shrink:0;background:#0002}#qlco-result-overlay .ql-dialog-actions button{flex:1;min-height:48px;padding:10px;border:1px solid #ffffff30;border-radius:10px;background:#ffffff08;color:#fff;font:700 13px Arial,sans-serif;cursor:pointer}#qlco-result-overlay .ql-dialog-actions .primary{background:var(--accent);border-color:var(--accent);color:#111923}#qlco-result-overlay :focus-visible{outline:2px solid #fff;outline-offset:2px}
        #qlco-v2 #ql-finish{width:100%;margin-top:7px;min-height:40px;background:transparent;font-size:12px}#qlco-v2 #ql-pricing p{font-size:11px;color:#b5c4d7}#qlco-v2 #ql-pricing a{color:#a6cdff;font-size:12px}#qlco-v2 .ql-key-label{display:grid;gap:5px;margin:10px 0}#qlco-v2 .ql-key-label input{width:100%}#qlco-v2 .ql-price-actions{display:flex;gap:7px;margin-top:10px}#qlco-v2 .ql-cost-row{display:flex;align-items:center;gap:8px;justify-content:space-between;margin:8px 0;font-size:12px}#qlco-v2 .ql-cost-row input{width:130px}
        @keyframes ql-reveal{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){#qlco-result-overlay .ql-dialog{animation:none}}
        @media(max-width:759px){#qlco-result-overlay{padding:8px;align-items:flex-end}#qlco-result-overlay .ql-dialog{max-height:calc(100dvh - 16px);border-radius:20px 20px 12px 12px}#qlco-result-overlay .ql-dialog-scroll{padding:22px 16px 16px}#qlco-result-overlay .ql-dialog-actions{padding:12px 14px max(12px,env(safe-area-inset-bottom))}#qlco-result-overlay .ql-dialog-actions button{font-size:14px;min-height:50px}#qlco-v2{max-height:calc(100dvh - 70px);width:100%;border-radius:18px 18px 0 0}#qlco-v2 article{grid-template-columns:1fr 1fr;gap:10px;padding:12px 4px}#qlco-v2 article>label{grid-column:1/-1;font-size:14px}#qlco-v2 article b{font-size:14px}#qlco-v2 article input[type=number]{min-height:44px}#qlco-v2 .ql-columns{display:none}#qlco-v2 article input[data-field=limit]{grid-column:1}#qlco-v2 article input[data-field=keep]{grid-column:2}#qlco-v2 #ql-open{min-height:52px}#qlco-v2 #ql-latest{display:none}#qlco-v2 #ql-finish{min-height:44px}}
    `;
    document.head.appendChild(popupStyle);
    const mobileLabels = document.createElement('style');
    mobileLabels.textContent = '#qlco-v2 article .ql-number{display:flex;flex-direction:column;align-items:stretch;gap:4px;min-width:0}#qlco-v2 .ql-number>small{display:none}@media(max-width:759px){#qlco-v2 article>.ql-number{grid-column:auto!important}#qlco-v2 .ql-number>small{display:block;color:#bccce0;font-size:11px}}';
    mobileLabels.textContent += `
        #qlco-v2 .ql-tabs{padding:8px 12px;flex-shrink:0;border-bottom:1px solid var(--ql-line)}
        #qlco-v2 .ql-tabs button{flex:1;min-height:42px}
        #qlco-v2 .ql-tabs [aria-selected=true]{background:#365a80;border-color:#9ac8ff}
        #qlco-v2 .ql-button-setting{display:flex;gap:8px;align-items:center}
        #qlco-v2 #ql-history{padding:0;list-style:none}
        #qlco-v2 #ql-history li{padding:10px 0;border-bottom:1px solid var(--ql-line);overflow-wrap:anywhere}
        #qlco-v2 #ql-history li>*{display:block}
        #qlco-v2 #ql-history time{font-size:11px;color:var(--ql-muted)}
        #qlco-v2 #ql-history small{color:#98dbb1}
        #qlco-quick-open{position:fixed;z-index:2147482998;bottom:max(8px,env(safe-area-inset-bottom));left:12px;max-width:calc(100vw - 76px);min-height:44px;padding:10px 14px;border:1px solid #65b784;border-radius:9px;background:#286341;color:white;font:bold 14px Arial,sans-serif;cursor:pointer}
        #qlco-quick-open[hidden]{display:none!important}
        #qlco-quick-open:disabled{background:#35433c;color:#c6d2cc;cursor:default}
        #qlco-quick-open:focus-visible{outline:2px solid #9ac8ff;outline-offset:2px}
        #qlco-v2.ql-editing .ql-tabs{display:none}
    `;
    mobileLabels.textContent += '#qlco-v2 header{gap:8px;flex-wrap:wrap}#qlco-v2 header>div{flex:1;min-width:160px}#qlco-v2 header button[data-action=api-settings]{width:auto;min-height:44px;height:auto;white-space:nowrap}#qlco-v2 .ql-price-actions{flex-wrap:wrap}#qlco-v2 .ql-price-actions button{min-height:44px}';
    // iOS keyboards resize/pan the visual viewport independently of CSS vh/dvh.
    // While editing, give its usable area to the form instead of the action footer.
    mobileLabels.textContent += `#qlco-v2 header button.ql-edit-done{display:none}@media(max-width:759px){
        #qlco-v2.ql-editing{top:var(--ql-edit-top);bottom:auto;height:var(--ql-edit-height);max-height:var(--ql-edit-height)}
        #qlco-v2.ql-editing>header{flex-shrink:0;padding:6px 12px;flex-wrap:nowrap}
        #qlco-v2.ql-editing>header>div,#qlco-v2.ql-editing>footer{display:none}
        #qlco-v2.ql-editing>div.ql-body{flex:1;min-height:0;scroll-padding:12px}
        #qlco-v2 header button.ql-edit-done{display:none;width:auto;min-height:44px}
        #qlco-v2.ql-editing header button.ql-edit-done{display:block;margin-left:auto}
    }`;
    const doneEditing = document.createElement('button');
    doneEditing.type = 'button'; doneEditing.className = 'ql-edit-done';
    doneEditing.textContent = 'Done';
    panel.querySelector('header').appendChild(doneEditing);
    doneEditing.addEventListener('pointerdown', event => event.preventDefault());
    doneEditing.addEventListener('click', () => {
        if (panel.contains(document.activeElement)) document.activeElement.blur();
        updateEditingViewport();
    });
    const editable = node => node instanceof Element && node.matches('input:not([type=checkbox]):not([type=radio]), textarea');
    function updateEditingViewport() {
        const field = document.activeElement;
        const editing = matchMedia('(max-width:759px)').matches && panel.contains(field) && editable(field);
        panel.classList.toggle('ql-editing', editing);
        if (!editing) return;
        const viewport = window.visualViewport;
        panel.style.setProperty('--ql-edit-top', `${(viewport?.offsetTop || 0) + 4}px`);
        panel.style.setProperty('--ql-edit-height', `${Math.max(0, (viewport?.height || window.innerHeight) - 8)}px`);
        // Scroll only our inner form; scrolling the document fights iOS keyboard panning.
        const body = panel.querySelector('div.ql-body');
        const rect = field.getBoundingClientRect(), bounds = body.getBoundingClientRect();
        if (rect.bottom > bounds.bottom - 12) body.scrollTop += rect.bottom - bounds.bottom + 12;
        else if (rect.top < bounds.top + 12) body.scrollTop -= bounds.top + 12 - rect.top;
    }
    let editingFrame;
    function scheduleEditingViewport() {
        cancelAnimationFrame(editingFrame);
        editingFrame = requestAnimationFrame(updateEditingViewport);
    }
    panel.addEventListener('focusin', scheduleEditingViewport);
    panel.addEventListener('focusout', scheduleEditingViewport);
    window.visualViewport?.addEventListener('resize', scheduleEditingViewport);
    window.visualViewport?.addEventListener('scroll', scheduleEditingViewport);
    window.addEventListener('resize', scheduleEditingViewport);
    document.head.appendChild(mobileLabels);
    if (Object.keys(prices()).length) panel.querySelector('#ql-price-status').textContent = 'Cached prices loaded. Last fetched: ' + new Date(priceData.fetchedAt).toLocaleTimeString('en-GB');
    render(); scan();
    if (!Object.keys(prices()).length && /^[A-Za-z0-9]{16,64}$/.test(get('ql_container_opener_api_key_v1', ''))) loadPrices();
})();

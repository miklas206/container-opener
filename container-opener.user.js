// ==UserScript==
// @name         Questionably Legal Container Opener PC & PDA
// @namespace    https://www.torn.com/
// @version      3.0.3
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
                if (value === null) missing.push('Kontantbeløb'); else received += value;
                return { name: 'Kontanter', qty: 1, value, cash: true };
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
            basis: valid(override) ? 'Din købspris' : 'Markedsværdi' };
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
            throw new Error('Resultatet kunne ikke knyttes sikkert til den valgte container. Kontrollér inventory.');
        }
        const another = data.isAnotherAvailable === true;
        const next = another ? id(data.nextArmoryId) : '';
        if (another && ((expected.xid && (!next || next === expected.xid)) || (next && next === String(data.armoryID)))) {
            throw new Error('Torn returnerede ikke et nyt, entydigt XID. Kontrollér inventory.');
        }
        const rewards = Array.isArray(data.items.itemAppear) ? data.items.itemAppear : [];
        return { next, another, availabilityKnown: typeof data.isAnotherAvailable === 'boolean',
            text: typeof data.text === 'string' ? data.text : 'Container åbnet.',
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
                if (busy) throw new Error('Afvent det igangværende svar.');
                if (!active()) throw new Error('Brug knappen på den aktive inventory-side.');
                const rfcv = String(token() || '');
                if (!/^[a-zA-Z0-9_-]{4,200}$/.test(rfcv)) throw new Error('Torn er ikke klar. Genindlæs Items-siden og prøv igen.');
                busy = true;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);
                try {
                    const url = new URL('/item.php', origin);
                    url.searchParams.set('rfcv', rfcv);
                    const response = await fetchFn(url.href, { method: 'POST', credentials: 'same-origin', redirect: 'error',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
                        body: new URLSearchParams({ step: 'getCategoryList', itemName: 'Supply Pack', start: '0' }).toString(), signal: controller.signal });
                    if (!response.ok) throw new Error('Torn kunne ikke hente listen. Prøv at åbne Supply Packs i Torn.');
                    let data;
                    try { data = JSON.parse(await response.text()); }
                    catch { throw new Error('Listen kunne ikke læses. Kontrollér login i Torn og genindlæs siden.'); }
                    if (!Array.isArray(data.list)) throw new Error('Torn gav en ukendt liste. Åbn Supply Packs i Torn og tryk Opdatér.');
                    return data;
                } catch (error) {
                    if (error.name === 'AbortError') throw new Error('Torn svarede ikke i tide. Prøv igen, når siden virker.');
                    throw error;
                } finally { clearTimeout(timer); busy = false; }
            },
            async open(item) {
                if (busy) throw new Error('Afvent det igangværende svar.');
                if (!active()) throw new Error('Brug knappen på den aktive inventory-side.');
                const xid = id(item.xid);
                if (!/^\d+$/.test(String(item.itemID))) throw new Error('Åbn kategorien med dine containere i Torn først.');
                if ((xid && spent.has(xid)) || uncertain.has(String(item.itemID))) throw new Error('Kontrollér inventory og genindlæs siden, før du prøver igen.');
                const rfcv = String(token() || '');
                if (!/^[a-zA-Z0-9_-]{4,200}$/.test(rfcv)) throw new Error('Torn er ikke klar. Genindlæs Items-siden og prøv igen.');
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
                    if (!response.ok) throw new Error(`HTTP ${response.status}. Udfaldet er ukendt; kontrollér inventory.`);
                    let data;
                    try { data = JSON.parse(await response.text()); }
                    catch { throw new Error('Torn gav ikke et JSON-svar. Kontrollér login/CAPTCHA og inventory.'); }
                    const result = readSuccess(data, { itemID: item.itemID, xid });
                    uncertain.delete(String(item.itemID));
                    return result;
                } catch (error) {
                    if (error.name === 'AbortError') throw new Error('Svaret tog for lang tid. Åbningen kan være sket; kontrollér inventory.');
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
        catch { status = 'Indstillinger kunne ikke gemmes på denne enhed.'; }
    };
    const old = get('ql_container_opener_settings_v1', {});
    const saved = get('ql_container_opener_settings_v2', {});
    const blacklist = Array.isArray(saved.blacklist) ? saved.blacklist : Array.isArray(old.blacklist) ? old.blacklist : defaults;
    const prefs = { blacklist: blacklist.filter(name => names.includes(name)),
        plans: saved.plans && typeof saved.plans === 'object' ? saved.plans : {} };
    // Runtime XIDs and rfcv are deliberately never persisted or included in diagnostics.
    const runtime = new Map();
    const log = [];
    let filter = 'all', status = 'Vælg dine containere. Ét tryk åbner én ting.', opened = 0, cash = 0;
    let halted = false, scanTimer, collapsed = get('ql_container_opener_panel_v2', {}).hidden === true, loading = false;
    const rewardTotals = new Map();
    const records = [];
    let popup = null, popupReturnFocus = null, pricesLoading = false;
    const cachedPrices = get('ql_container_opener_prices_v1', {});
    let priceData = cachedPrices?.items && Number(cachedPrices.fetchedAt) > Date.now() - 3600000
        ? cachedPrices : { items: {}, fetchedAt: 0 };
    const savedCosts = get('ql_container_opener_costs_v1', {});
    const costs = savedCosts && typeof savedCosts === 'object' ? savedCosts : {};
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const norm = value => String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const money = value => '$' + value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const signedMoney = value => value === null ? 'Pris mangler' : `${value >= 0 ? '+' : '−'}${money(Math.abs(value))}`;
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
    panel.setAttribute('aria-label', 'Container Opener');
    // Keep the old DOM observer from scanning our new panel when upgrading without a refresh.
    panel.innerHTML = `<header><div><small>QUESTIONABLY LEGAL · v3.0.3</small><h2>Container Opener</h2></div>
        <button data-action="api-settings" aria-controls="ql-pricing">API-nøgle</button><button data-action="collapse" aria-label="Skjul ved chatten" title="Skjul ved chatten">−</button></header>
        <div class="ql-body"><div class="ql-totals"><span>Åbnet <b id="ql-count">0</b></span><span>Kontanter <b id="ql-cash">$0</b></span></div>
        <nav aria-label="Kategorier"><select id="ql-filter"><option value="all">Alle kategorier</option>${Object.entries(GROUPS).map(([key, group]) => `<option value="${key}">${group.label}</option>`).join('')}</select><button data-action="scan">Opdatér</button></nav>
        <p class="ql-help">1. Find dine ting &nbsp; 2. Markér dem, du vil åbne &nbsp; 3. Tryk Åbn</p>
        <button id="ql-find" data-action="load">Find mine containere</button>
        <details id="ql-pricing"><summary>API-nøgle, priser og købspris <span id="ql-price-state"></span></summary>
        <p>Vi sammenligner udbyttets markedsværdi med containerens markedsværdi eller din egen købspris. Værdierne er estimater før salgsgebyrer.</p>
        <label class="ql-key-label">Torn API-nøgle · Public Only<input id="ql-api-key" type="password" autocomplete="off" placeholder="Indsæt nøgle én gang"></label>
        <p id="ql-key-state" class="ql-help" role="status"></p>
        <p class="ql-help">Nøglen gemmes kun lokalt og sendes kun til api.torn.com for at hente itemnavne og markedsværdier (torn → items). Ingen andre modtagere. Åbning virker også uden nøgle.</p>
        <a href="https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=ContainerOpener&torn=items" target="_blank" rel="noopener noreferrer">Opret en nøgle kun til itempriser i Torn</a>
        <div class="ql-price-actions"><button data-action="prices">Gem og hent priser</button><button data-action="forget-key">Glem nøgle</button></div>
        <p id="ql-price-status" role="status">Ingen priser indlæst endnu.</p><p class="ql-help">Har du købt en container til en anden pris? Angiv din pris pr. stk. nedenfor. Tomt felt bruger markedsværdi. Nye priser gælder fremtidige åbninger; tidligere resultater bevarer deres prisgrundlag.</p><div id="ql-costs"></div></details>
        <details id="ql-total"><summary>Samlet udbytte denne session</summary><div id="ql-total-rewards">Ingen åbninger endnu.</div></details>
        <div class="ql-columns"><span>Container</span><span>Åbn højst</span><span>Behold</span></div>
        <div id="ql-list"></div><details><summary>Blokeringer</summary><div id="ql-blocks"></div></details>
        <p class="ql-help">Lad “Åbn højst” stå tomt for alle. “Behold” er det antal, der skal blive liggende.</p>
        <details open><summary>Seneste gevinster</summary><ol id="ql-log"><li>Ingen åbninger endnu.</li></ol></details></div>
        <footer class="ql-body"><section id="ql-latest" hidden aria-live="polite" aria-label="Seneste udbytte"></section><p id="ql-status" role="status" aria-live="polite"></p><button id="ql-open">Åbn næste</button><button id="ql-finish" data-action="finish">Afslut og se opgørelse</button><small>Ét tryk · én container · ingen automatisk gentagelse</small></footer>`;
    document.body.appendChild(panel);

    // FLIPR reference: stable Notes/People IDs anchor custom buttons in Torn's bar.
    // Create our own button, without copying native handlers or changing other scripts.
    const launcher = document.createElement('button');
    launcher.id = 'qlco-dock-button';
    launcher.type = 'button';
    launcher.textContent = '📦';
    launcher.title = 'Container Opener — vis/skjul';
    launcher.setAttribute('aria-label', 'Container Opener — vis/skjul');
    launcher.setAttribute('aria-controls', panel.id);
    function ensureLauncher() {
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
            latest.innerHTML = `<strong>Seneste udbytte · ${esc(entry.name)}</strong><div class="ql-reward-line">${esc(entry.rewardText || 'Se Torns resultat nedenfor.')}</div><p>${esc(entry.text)}</p>`;
        }
        panel.querySelector('#ql-log').innerHTML = log.length ? log.map(entry => `<li><b>${esc(entry.name)}</b><span>${esc(entry.text)}</span><small>${esc(entry.rewardText)}</small></li>`).join('') : '<li>Ingen åbninger endnu.</li>';
        panel.querySelector('#ql-total-rewards').textContent = opened
            ? [money(cash), ...[...rewardTotals.values()].map(item => `${item.qty}× ${item.name}`)].join(' · ') : 'Ingen åbninger endnu.';
    }
    function render(preserveList = false) {
        const focus = document.activeElement;
        const editing = panel.contains(focus) && focus.matches('input[type="number"]');
        panel.querySelector('#ql-key-state').textContent = get('ql_container_opener_api_key_v1', '')
            ? 'Nøgle gemt på denne enhed. Bevares, når dette script opdateres.'
            : 'Ingen nøgle gemt på denne enhed.';
        panel.querySelector('#ql-count').textContent = opened;
        panel.querySelector('#ql-cash').textContent = money(cash);
        // Result UI must update even while quantity fields retain keyboard focus.
        renderResults();
        const item = next();
        panel.querySelector('#ql-status').textContent = !halted && !client.busy && item && !findToken()
            ? 'Torn er ikke klar endnu. Genindlæs Items-siden, hvis denne besked bliver stående.' : status;
        const open = panel.querySelector('#ql-open');
        open.disabled = client.busy || pricesLoading || halted || !!popup || !item || !findToken();
        panel.querySelector('#ql-finish').disabled = client.busy || !records.length;
        panel.querySelector('#ql-price-state').textContent = pricesLoading ? '· henter…' : Object.keys(prices()).length ? '· klar' : '· ikke aktiveret';
        open.textContent = client.busy ? loading ? 'Finder dine containere…' : 'Afventer Torn…' : halted ? 'Stoppet — genindlæs siden' : item ? `Åbn ${item.name}` : 'Markér en container ovenfor';
        panel.querySelectorAll('[data-action="scan"], [data-action="load"]').forEach(button => button.disabled = client.busy || halted);
        panel.querySelector('#ql-find').textContent = loading ? 'Finder dine containere…' : runtime.size ? 'Hent frisk liste fra Torn' : 'Find mine containere';
        if (preserveList === true || editing) return;
        panel.querySelector('#ql-costs').innerHTML = [...runtime.values()].map(item => `<label class="ql-cost-row"><span>${esc(item.name)}</span><input type="number" min="0" step="0.01" inputmode="decimal" data-cost="${esc(item.itemID)}" aria-label="Din købspris pr. ${esc(item.name)}" placeholder="Markedspris" value="${typeof costs[item.itemID] === 'number' ? costs[item.itemID] : ''}"></label>`).join('');
        const visible = [...runtime.values()].filter(item => filter === 'all' || groupOf(item.name) === filter);
        panel.querySelector('#ql-list').innerHTML = visible.length ? visible.map(item => {
            const p = plan(item.name), blocked = prefs.blacklist.includes(item.name);
            return `<article data-name="${esc(item.name)}" class="${blocked ? 'ql-blocked' : ''}"><label><input type="checkbox" data-field="selected" ${p.selected ? 'checked' : ''} ${blocked ? 'disabled' : ''}><span><b>${esc(item.name)}</b><small>${item.quantity === null ? 'Antal ukendt' : `${item.quantity} tilbage`} · ${item.opened} åbnet · ${blocked ? 'Blokeret' : item.itemID ? p.keep && item.quantity === null ? 'Hent listen for at bruge Behold' : 'Klar' : 'Åbn kategorien i Torn'}</small></span></label><label class="ql-number"><small>Åbn højst</small><input aria-label="Antal der skal åbnes af ${esc(item.name)}" data-field="limit" type="number" min="0" step="1" placeholder="Alle" value="${p.limit || ''}"></label><label class="ql-number"><small>Behold mindst</small><input aria-label="Behold mindst ${esc(item.name)}" data-field="keep" type="number" min="0" step="1" value="${p.keep}"></label></article>`;
        }).join('') : `<p class="ql-empty">${filter === 'all' ? 'Tryk “Find mine containere”. Så henter vi listen fra dit inventory uden at åbne noget.' : 'Ingen fund i denne kategori. Vælg Alle kategorier, eller åbn den relevante kategori i Torn.'}</p>`;
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
        status = `Åbner én ${item.name}…`;
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
            status = result.availabilityKnown && !result.another ? 'Åbnet. Ingen flere af denne type; næste valgte type er klar.' : 'Åbnet. Tryk igen, når du vil åbne den næste.';
            showResult(record, !next());
        } catch (error) {
            halted = true;
            item.touched = true;
            item.xid = '';
            status = `${error.message} Kontrollér dit inventory og genindlæs siden for at fortsætte. Der prøves ikke automatisk igen.`;
        }
        render();
    }
    panel.querySelector('#ql-open').addEventListener('click', openOne);
    panel.addEventListener('keydown', event => {
        if (event.target.id === 'ql-open' && event.repeat && ['Enter', ' '].includes(event.key)) event.preventDefault();
    });
    panel.addEventListener('change', event => {
        const target = event.target;
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
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'api-settings') {
            panel.querySelector('#ql-pricing').open = true;
            panel.querySelector('#ql-api-key').focus({ preventScroll: true });
            panel.querySelector('#ql-api-key').scrollIntoView({ block: 'center' });
        }
        if (action === 'collapse') {
            showPanel(false);
        }
        if (action === 'scan') { status = 'Listen er opdateret fra den åbne inventory-kategori.'; scan(); }
        if (action === 'load' && event.isTrusted) loadInventory();
        if (action === 'prices' && event.isTrusted) loadPrices();
        if (action === 'forget-key') { put('ql_container_opener_api_key_v1', ''); panel.querySelector('#ql-api-key').value = ''; panel.querySelector('#ql-price-status').textContent = 'Nøglen er fjernet. Allerede hentede priser kan bruges, indtil de udløber.'; render(true); }
        if (action === 'finish' && !client.busy && records.length) showSummary();
    });
    async function loadInventory() {
        if (client.busy || halted) return;
        loading = true;
        status = 'Henter dine containere. Der åbnes ikke noget.';
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
            status = found.size ? `${found.size} typer fundet. Markér dem, du vil åbne, og tryk Åbn.` : 'Ingen kendte containere fundet. Åbn den relevante kategori i Torn, så aflæser panelet den automatisk.';
            if (Number(data.count) > data.list.length) status += ' Listen kan være opdelt; åbn kategorien i Torn for at se flere.';
        } catch (error) { status = error.message; }
        finally { loading = false; render(); }
    }
    async function loadPrices() {
        if (pricesLoading) return;
        const input = panel.querySelector('#ql-api-key');
        const key = input.value.trim() || get('ql_container_opener_api_key_v1', '');
        const message = panel.querySelector('#ql-price-status');
        if (!/^[A-Za-z0-9]{16,64}$/.test(key)) { message.textContent = 'Indsæt en gyldig Torn API-nøgle med adgang til torn → items.'; return; }
        put('ql_container_opener_api_key_v1', key);
        input.value = '';
        pricesLoading = true; message.textContent = 'Henter markedspriser fra Torn…'; render(true);
        try {
            const url = new URL('https://api.torn.com/torn/');
            url.search = new URLSearchParams({ selections: 'items', key, comment: 'QL Container Opener prices' }).toString();
            const data = await new Promise((resolve, reject) => {
                const fail = () => reject(new Error('Priser kunne ikke hentes. Kontrollér nøglens adgang og prøv igen.'));
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
                // Keep the user's saved key on API errors; only Glem nøgle removes it.
                throw new Error(`Torn afviste prisopslaget${data.error?.code ? ` (kode ${Number(data.error.code)})` : ''}. Kontrollér adgang til torn → items.`);
            }
            const items = {};
            for (const [itemID, item] of Object.entries(data.items)) {
                if (/^\d+$/.test(itemID) && Number.isFinite(item.market_value) && item.market_value > 0)
                    items[itemID] = { name: String(item.name || `Item ${itemID}`), price: item.market_value };
            }
            if (!Object.keys(items).length) throw new Error('Torn returnerede ingen anvendelige markedspriser.');
            priceData = { fetchedAt: Date.now(), items }; put('ql_container_opener_prices_v1', priceData);
            message.textContent = `Priser hentet ${new Date(priceData.fetchedAt).toLocaleTimeString()}. Bruges i op til én time. Tidligere åbninger ændres ikke.`;
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
        popup.innerHTML = `<section class="ql-dialog ${tone}" role="dialog" aria-modal="true" aria-labelledby="ql-dialog-title" tabindex="-1"><button class="ql-dialog-close" aria-label="Luk resultat">×</button><div class="ql-dialog-scroll">${content}</div><div class="ql-dialog-actions">${actions.map((action, index) => `<button data-dialog-action="${index}" class="${index === actions.length - 1 ? 'primary' : ''}">${esc(action.label)}</button>`).join('')}</div></section>`;
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
        return `<ul class="ql-loot">${entries.map(entry => `<li><span class="ql-loot-icon">${entry.cash ? '$' : '◆'}</span><span><b>${entry.cash ? 'Kontanter' : `${entry.qty}× ${esc(entry.name)}`}</b></span><strong>${entry.value === null ? 'Pris mangler' : money(entry.value)}</strong></li>`).join('')}</ul>`;
    }
    function showResult(record, finished) {
        if (finished) { showSummary(record); return; }
        const value = record.value, tone = toneFor(value.net, value.cost);
        const heading = { neutral: 'Dit udbytte er klar', loss: 'Denne gav underskud', even: 'Det gik lige op', jackpot: 'Stort udbytte!', win: 'Du kom ud med overskud!' }[tone];
        modal(tone, `<div class="ql-result-hero"><div class="ql-result-emblem">${tone === 'jackpot' ? '✦' : tone === 'loss' ? '↘' : '◆'}</div><small>${esc(record.name)} åbnet</small><h2 id="ql-dialog-title">${heading}</h2><div class="ql-result-number">${signedMoney(value.net)}</div><span>${value.net === null ? 'Vi mangler priser for at beregne forskellen' : 'Estimeret forskel før salgsgebyrer'}</span></div>
            ${rewardRows(value.entries)}<div class="ql-result-stats"><span>Containerens pris<b>${value.cost === null ? 'Ukendt' : money(value.cost)}</b><small>${value.basis}</small></span><span>Udbyttets værdi<b>${value.missing.length ? 'Mindst ' : ''}${money(value.received)}</b><small>Kontanter + items</small></span></div><p class="ql-result-note">${esc(record.text)}</p>${value.net === null ? '<p class="ql-result-note">Aktivér priser i panelet for fremtidige åbninger. Manglende priser tælles ikke som nul.</p>' : ''}`,
            [{ label: value.net === null ? 'Aktivér priser' : 'Tilbage til listen', run: () => {
                closePopup();
                if (value.net === null) { panel.querySelector('#ql-pricing').open = true; panel.querySelector('#ql-pricing').scrollIntoView({ block: 'nearest' }); panel.querySelector('#ql-api-key').focus(); }
            } }, { label: 'Åbn næste', run: event => { closePopup(); openOne(event); } }]);
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
        modal(tone, `<div class="ql-result-hero"><div class="ql-result-emblem">${sum.net !== null && sum.net > 0 ? '✦' : '▣'}</div><small>${last ? 'Den valgte runde er færdig' : 'Din opgørelse'}</small><h2 id="ql-dialog-title">${sum.count} containere åbnet</h2><div class="ql-result-number">${signedMoney(sum.net)}</div><span>${sum.complete ? 'Samlet estimeret gevinst / tab' : `${sum.unknown} åbninger mangler fuldt prisgrundlag`}</span></div>
            <div class="ql-result-stats"><span>Containere brugt<b>${sum.complete ? '' : 'Kendt: '}${money(sum.cost)}</b><small>Forbrugt værdi</small></span><span>Modtaget udbytte<b>${sum.complete ? '' : 'Kendt: '}${money(sum.received)}</b><small>Kontanter + items</small></span><span>Med overskud<b>${sum.wins}</b></span><span>Med underskud<b>${sum.losses}</b></span></div>
            ${last ? `<p class="ql-result-note"><b>Sidste åbning:</b> ${esc(last.text)}</p>` : ''}<h3>Det fik du</h3>${rewardRows([...loot.values()])}<h3>Det brugte du</h3><ul class="ql-consumed">${[...consumed.values()].map(entry => `<li><span>${entry.qty}× ${esc(entry.name)}</span><b>${entry.unknown ? 'Delvist ukendt' : money(entry.value)}</b></li>`).join('')}</ul><p class="ql-result-note">Markedsværdier er estimater før gebyrer. En angivet købspris erstatter containerens markedsværdi. Prisgrundlaget fastlåses ved hver åbning.</p>`,
            [{ label: 'Luk opgørelse', run: closePopup }, { label: 'Ny runde', run: () => {
                closePopup(); records.length = 0; log.length = 0; rewardTotals.clear(); opened = 0; cash = 0;
                for (const item of runtime.values()) item.opened = 0;
                status = 'Ny runde. Vælg de containere, du vil åbne.'; render();
            } }]);
    }
    const observer = new MutationObserver(records => {
        ensureLauncher();
        if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
        if (!records.some(record => !panel.contains(record.target))) return;
        clearTimeout(scanTimer); scanTimer = setTimeout(scan, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['data-item', 'data-qty', 'data-quantity', 'data-name'] });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scan(); else clearTimeout(scanTimer); });
    window.addEventListener('focus', scan);
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Vis Container Opener', () => showPanel(true));
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
    doneEditing.textContent = 'Færdig';
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
    if (Object.keys(prices()).length) panel.querySelector('#ql-price-status').textContent = 'Gemte priser indlæst. Tidligere hentet: ' + new Date(priceData.fetchedAt).toLocaleTimeString();
    render(); scan();
    if (!Object.keys(prices()).length && /^[A-Za-z0-9]{16,64}$/.test(get('ql_container_opener_api_key_v1', ''))) loadPrices();
})();

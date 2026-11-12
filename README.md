# Questionably Legal Container Opener

A Torn userscript by **slightlylegal** for desktop browsers and Torn PDA.
Automatically detect eligible containers, keep a reserve in your inventory, and track
your rewards. One press opens one container.

[Install from Greasy Fork](https://greasyfork.org/en/scripts/605088) ·
[Script source](container-opener.user.js) ·
[Report an issue](https://github.com/miklas206/container-opener/issues)

## Features

- **Rules** — check a container in **Blacklist** to block it. Unchecked containers
  show a **Keep at least** field beside their name. Set rules even before you own
  the item. Optional **Round limit** controls are available for allowed items.
- **Settings** — manage your optional Torn API key, item prices, purchase costs
  and opening button position.
- **History** — view the last 500 confirmed openings with timestamps, rewards
  and estimated profit or loss, saved across page reloads and new rounds.
- **Positionable Open button** — open the next eligible container with the panel
  hidden. Place it by the inventory categories and search or use a movable floating button.
  Both opening buttons follow the same rules.
- **Results and summaries** — see rewards after each opening and review the
  containers consumed, cash received and item values for the round.
- **Mobile layout** — responsive tabs and forms, including adjustments for the
  on-screen keyboard.

Supports known wallets, supply packs, caches, gifts and parcels. Some container
types are blocked by default; review **Blacklist** before enabling them.

## Getting started

1. Install the script in your userscript manager or add it to Torn PDA.
2. Open Torn's **Items** page and select **Find my containers**. You can also
   open an inventory category for the panel to detect its containers.
3. All detected types are included automatically unless blacklisted. In **Rules**,
   check unwanted types in **Blacklist**. For unchecked types, enter **Keep at least**.
   Blocking a type hides its quantity controls without deleting the saved values.
4. Press **Open**. Each press opens one eligible container; nothing repeats
   automatically.

You do not need to select containers each time. Saved blacklists and limits apply
automatically, including to newly detected containers. Older per-item selection
flags are ignored; existing blacklists and quantity limits are preserved.

For example, if you have 10 wallets and set **Keep at least** to 3, opening stops
when 3 remain. If the quantity is unknown, a keep minimum blocks opening until
the inventory quantity is available. **Open up to** limits apply to the current
round and reset when you choose **New round**.

To open containers while the panel is hidden, enable **Show an Open button
on the Items page** in **Settings**. **Button position** defaults to **By categories and search**, placing the button below those controls and above
the item list without covering items.
Choose **Floating — movable** to drag its separate move handle with your mouse or
finger. You can also focus the handle and use arrow keys (Shift moves faster).
The floating position is saved on this device and kept within the screen when
resizing. **Reset floating position** restores its default position.
Use the box icon to reopen the panel.

Confirmed openings immediately update the visible inventory counts for consumed
containers and rewards already shown on the page. Failed or unconfirmed requests
do not change those counts.

## Optional prices

Opening containers does not require an API key. To estimate profit and loss,
open **Settings**, enter a Torn API key with access to `torn → items`, and select
**Save and fetch prices**. The panel includes a link to create a suitable key.

Market prices are cached for up to one hour. You can enter your own purchase cost
per container instead. Values are estimates before selling fees; missing prices
are shown as unavailable rather than zero. Each result retains the prices used
at the time of opening.

## Storage and updates

Rules, preferences, the API key and opening history are stored locally in your
userscript manager, with browser localStorage as a fallback. The key is sent only
to `api.torn.com` for prices. **Forget key** removes the saved key.

Update the existing installation to retain its saved data. Clearing browser or
app storage, uninstalling the script, or changing devices can remove or separate
that data. History records confirmed openings made with this feature installed;
it cannot recover older openings.

## Development

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

Tests use mocked inventory and API responses; they do not open real containers.
Coverage includes request handling, opening limits, rewards, persistent storage,
tabs, and browser layouts at 320, 390 and 1280 pixels. Keyboard tests simulate
viewport resizing and panning; physical Torn PDA behavior requires device testing.
Use `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE` to select an existing test runtime.

## License

[MIT](LICENSE) · Copyright 2026 slightlylegal.

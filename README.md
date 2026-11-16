# Questionably Legal Container Opener

A Torn userscript by **slightlylegal** for desktop browsers and Torn PDA.
Read eligible containers from your visible inventory, keep a reserve, and track
your rewards. One manual press opens one container. **Speed open** hides intermediate
result popups so you can repeatedly press the same button.

[Install from Greasy Fork](https://greasyfork.org/en/scripts/605088) ·
[Script source](container-opener.user.js) ·
[Report an issue](https://github.com/miklas206/container-opener/issues)

## Features

- **Rules** — choose containers in **Items to open**. Only checked items may be
  opened, and only checked items show **Keep at least** and optional **Round limit**
  controls. Your choices are saved, including for items you do not currently own.
- **Settings** — manage your optional Torn API key, item prices, purchase costs,
  popup behavior and opening button position.
- **History** — view the last 500 confirmed openings with timestamps, rewards
  and estimated profit or loss, saved across page reloads and new rounds.
- **Positionable Open button** — open the next eligible container with the panel
  hidden. Place it by the inventory categories and search or use a movable floating button.
  Both opening buttons follow the same rules.
- **Results and summaries** — see rewards after each opening and review the
  containers consumed, cash received and item values for the round.
- **Mobile layout** — responsive tabs and forms, including adjustments for the
  on-screen keyboard.

Supports known wallets, supply packs, caches, gifts and parcels. New installations
start with no items selected. Newly supported types stay off until you select them.

## Getting started

1. Install the script in your userscript manager or add it to Torn PDA.
2. Open Torn's **Items → Supply Packs** manually. The script reads the visible
   rows. **Read visible containers** rescans those rows without sending requests.
3. In **Rules → Items to open**, check the types you want to open and enter
   **Keep at least**. Unchecked items are never opened and have no quantity fields.
4. Press **Open**. Each new manual press sends at most one opening request for
   an eligible container in the visible Supply Packs list. The script does not load
   categories or inventory pages. Open additional inventory pages manually in Torn.
   Presses during an outstanding request are ignored, never queued. Holding a key
   does not repeat openings. Hidden, loading, missing, or unknown-quantity rows
   cannot be opened.

Selections and limits are saved for future visits. Unchecking an item hides its
quantity controls without deleting the saved values. Updating from the previous
blacklist version converts previously allowed types to checked items and leaves
previously blocked types unchecked. Existing minimums and round limits are retained.

For example, if you have 10 wallets and set **Keep at least** to 3, opening stops
when 3 remain. If the quantity is unknown, opening is blocked until
the inventory quantity is available on the visible page. **Open up to** limits apply to the current
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

## Speed open

Enable **Settings → Speed open**, then repeatedly press **Open next**.
Every opening requires a new manual press after the previous response. There is no
batch opening, queued input, timed repeat, inventory request, or category switching.
Intermediate result popups are hidden; **Finish and view summary** displays the
combined round results. Keep minimums, round limits, and saved selections still apply.
Errors stop further openings and are never retried automatically.

**Version 3.2.1 replaces the automatic batch behavior in 3.2.0.** Existing Speed open
preferences are retained, but now only control popup visibility. Update installations
of 3.2.0 before continuing. This implementation has not received Torn staff approval.

## Optional prices

Opening containers does not require an API key. The script reads only containers already shown on your active
Supply Packs page; it makes no inventory requests.
Your price key does not grant inventory access. Torn's separate API v2 inventory
endpoint requires at least Minimal Access and is cached for 15 minutes per
category, so it is not used to enforce immediate opening limits.
See the [official API specification](https://www.torn.com/swagger/openapi.json).
 To estimate profit and loss,
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

Result dialogs stay centered in the visible viewport on mobile and PDA. The combined
round summary uses a separate layout with **Done** and **New round** at the top,
away from the previous **Open next** position. The popup stays open while Torn
responds, updates in place, and ignores extra presses while a request is pending. **New round**
only resets the round counters; opening another container still requires a separate press.

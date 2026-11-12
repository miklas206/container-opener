# Container Opener — slightlylegal

Torn userscript for desktop and Torn PDA. One explicit press opens one container.
Includes item prices, session accounting and a mobile form that follows the visible
viewport while the keyboard is open.

## Install and update

Install from [Greasy Fork](https://greasyfork.org/en/scripts/605088).
Keep the same script installed when updating; do not delete and reinstall it.
The name and namespace remain stable so the script manager can retain its storage.

## Version 3.1.0: tabs, rules and opening history

- **Rules**: choose containers, set **Åbn højst** per round and **Behold mindst**
  per type. A keep minimum blocks opening when the quantity is unknown.
- **Settings**: API key, prices, purchase cost overrides and an optional floating
  opening button on the Items page. Enable **Vis en flydende Åbn-knap** to use it
  while the panel is hidden. Both buttons use the same rules; one press opens one
  container. There is no automatic opening loop.
- **History**: the last 500 confirmed openings, including date/time, rewards and
  the estimated gain/loss at the time. Saved locally across reloads and new rounds.
  Openings made before this version cannot be recovered.

Existing rules, blocklists, API key and price preferences are reused automatically.
The floating button is off until enabled. History uses a separate storage key and
does not contain API keys, request tokens or inventory instance IDs.

## Local API key

Press **API-nøgle**, enter a Torn key with access to `torn → items`, then press
**Gem og hent priser**. The key is stored in the userscript manager's local storage
(`GM_getValue`/`GM_setValue`). If unavailable, the fallback is Torn's localStorage
in that browser/webview. It is sent only to `api.torn.com` for item prices.

Updates reuse `ql_container_opener_api_key_v1`. The key is never included in this
repository or sent to GitHub/Greasy Fork. The UI reports whether a key is saved,
without showing it. API errors retain the key; **Glem nøgle** explicitly removes it.
Clearing browser/app storage, uninstalling the script, or changing browser/device
can remove or separate the stored key. A different device needs its own setup.

## Connect Greasy Fork once

Open the existing script's **Admin** page while logged in to its owner account.
In **Code syncing**, use this source URL:

```
https://raw.githubusercontent.com/miklas206/container-opener/main/container-opener.user.js
```

Select **Automatic** and **Update and sync**. This step requires the owner's
Greasy Fork session; publishing this repository alone does not enable syncing.
Keep the existing script ID 605088. Future script releases must increment
`@version` and the version displayed in the panel.

For push-triggered updates, Greasy Fork also supports a GitHub webhook.
The owner-specific payload URL and secret are available on
[Greasy Fork's webhook setup page](https://greasyfork.org/en/users/webhook-info).
Do not commit those values. Automatic URL syncing works without a webhook.

## Development and validation

```
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

Tests use fake inventory, keys and API responses; they never open real containers.
Browser tests cover 320/390/1280 px, keyboard viewport resizing/panning, local key
storage and reuse after reload with retained storage, API error retention, and
explicit key removal. Physical iPhone/Torn PDA behavior still needs live checking.
`PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE` can select an existing test runtime.

Source: `container-opener.user.js`. Local historical versions and the Studio copy
helper are not published. Git metadata stays outside the shared workspace.

## License

MIT, copyright 2026 slightlylegal. See LICENSE.

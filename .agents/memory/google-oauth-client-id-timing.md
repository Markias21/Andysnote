---
name: Google OAuth CLIENT_ID script-timing race
description: Why the login button can stay disabled with no console error in this static app
---

# Google OAuth login button stuck disabled (no error)

`btn-google-login` starts `disabled` in HTML and is only enabled by `maybeEnableButton()`
when both `gapiInited` && `gisInited` are true (set by `gapiLoaded()` / `gisLoaded()`).

`gisLoaded()` begins with `if (!window.GOOGLE_CLIENT_ID) return;` — a **silent** early
return. If `window.GOOGLE_CLIENT_ID` is not yet defined when `gisLoaded()` fires, the
button never enables and **nothing is logged to the console**.

## The race
The Google GSI script tag is `async ... onload="gisLoaded()"` and fires as soon as it
downloads. If `GOOGLE_CLIENT_ID` is assigned in a `<script type="module">`, that module
script is **deferred** (runs after full HTML parse), so the async `onload` can win the
race and call `gisLoaded()` before `GOOGLE_CLIENT_ID` exists.

**Why:** adding/removing plain external `<script>` tags shifts parse timing, so this race
is flaky — it can "work" then break after an unrelated change (e.g. splitting inline JS
into files). Diagnostic tell: login button disabled, forbidden cursor, but console is
error-free and the page's own DOMContentLoaded code (renderCalendar/updateTodayDate) ran
fine — which rules out a broken/stale JS file.

**How to apply:** assign `window.GOOGLE_CLIENT_ID` in a plain synchronous `<script>` in
`<head>` (NOT `type="module"`). A head sync script always runs before any `async` script's
onload can fire (async can't fire until it downloads), eliminating the race.

## Service worker caching (same app)
`sw.js` originally served same-origin assets **cache-first**, which serves stale JS during
active refactoring. Changed to **network-first with cache fallback** (offline still works)
and bump `CACHE_NAME` to force the `activate` handler to delete the poisoned old cache.
Google domains are already bypassed by the SW fetch handler.

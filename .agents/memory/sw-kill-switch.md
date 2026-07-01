---
name: Service worker stale-cache kill-switch
description: Why AndysNote' SW was removed and how to escape a stuck stale-cache state.
---

# Service worker stale-cache kill-switch

A caching service worker served a **mix of old and new files** to users (e.g. old
`app.js` referencing a deleted symbol, plus `gisLoaded`/`gapiLoaded` undefined
because the cached `index.html` didn't match the current module set). Symptom:
user sees errors/strings that **do not exist in the current source** — proof the
browser is running cached code, not a live bug.

**Hard refresh (Ctrl+Shift+R) does NOT reliably fix this** — a controlling SW can
keep serving stale assets across refreshes.

**Resolution:** `sw.js` was turned into a kill-switch (no caching): on `activate`
it deletes all Cache Storage keys, calls `self.registration.unregister()`, and
`client.navigate(client.url)` reloads open tabs. `js/app.js` no longer registers a
SW — it only unregisters existing ones and clears caches.

**Why it self-heals stuck users:** an affected browser still has the OLD
registration, so on next navigation the browser auto-byte-compares `sw.js`, fetches
the kill-switch, activates it (skipWaiting), cleans up, and reloads → fresh files.

**Why NOT to re-add `register('./sw.js')` in app.js:** it creates an infinite
reload loop (clean load → register kill-switch → activate → navigate/reload →
register again → …). If offline/PWA is ever wanted again, use a versioned cache
with a safe update path, not a re-registered kill-switch.

## HTTP cache was the second culprit
The SW was only half the problem. The default `python3 -m http.server` lets
browsers heuristically cache JS and serve it **without revalidating** — so even
after a fresh `GET /` (new index.html), the browser ran an OLD `js/app.js` from
memory cache (no request hit the server). Fix: serve via `server.py`, a
`SimpleHTTPRequestHandler` subclass that sends `Cache-Control: no-store, no-cache,
must-revalidate` + `Pragma: no-cache` + `Expires: 0` on every response. Workflow
"Start application" runs `python3 server.py` (not the bare http.server).
**Tell-tale sign of this bug:** `GET /` returns 200 but the stale JS file has NO
corresponding request in the server log — it came from browser memory cache.

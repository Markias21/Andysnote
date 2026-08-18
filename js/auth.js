"use strict";
async function handleAuthClick() {
    if (!tokenClient_tc) {
        alert(t("auth.notConfigured"));
        return;
    }
    // select_account forces Google's account chooser to actually show up.
    // Revoking a token on sign-out clears OUR app's grant, but the browser
    // stays logged into the underlying Google session — without
    // select_account, requestAccessToken silently re-issues a token for
    // that same still-logged-in account instead of prompting, which looks
    // exactly like "sign out did nothing" from the user's side.
    tokenClient_tc.requestAccessToken({
        prompt: "select_account consent",
    });
    }

/* ─── TOKEN PERSISTENCE (same-device auto sign-in) ───────────────────────
   The GIS token client is implicit-flow only (no refresh_token), so this
   cannot survive past the access token's own ~1h lifetime. What it buys us:
   reloading/reopening the app within that hour skips the login screen
   entirely, and once it expires, trySilentReauth() below re-issues a fresh
   token without prompting as long as the user hasn't revoked consent. */
function saveTokenToStorage(resp) {
    try {
        const expiresInSec = Number(resp.expires_in) || 3600;
        localStorage.setItem(
            DRIVE_TOKEN_STORAGE_KEY,
            JSON.stringify({
                access_token: resp.access_token,
                expires_at: Date.now() + expiresInSec * 1000,
            }),
        );
    } catch (e) {
        console.error("Failed to persist Drive token", e);
    }
}

function loadTokenFromStorage() {
    try {
        const raw = localStorage.getItem(DRIVE_TOKEN_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function clearTokenFromStorage() {
    try {
        localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
    } catch (e) {}
}

/* Called once on boot (from gisLoaded). Restores a still-valid cached token
   instantly, or falls back to a silent (no-popup) reauth for an expired/
   missing one. Both paths leave the app in the normal logged-out state on
   any failure — same as if this function didn't run at all. */
async function attemptAutoSignIn() {
    const SKEW_MS = 60 * 1000; // treat a token expiring within the next minute as already-expired
    const cached = loadTokenFromStorage();
    if (cached && cached.access_token && cached.expires_at > Date.now() + SKEW_MS) {
        driveAccessToken = cached.access_token;
        // onSignedIn()/initDriveFilesystem() swallow their own request errors
        // (they render a "load failed / retry" state instead of throwing), so a
        // revoked/invalid cached token would otherwise never be detected here.
        // Verify it against a cheap endpoint first.
        try {
            await driveGet("https://www.googleapis.com/oauth2/v3/userinfo");
            const proceed = await requireAppLock();
            if (!proceed) return;
            await onSignedIn();
            return;
        } catch (e) {
            if (e.status === 401) {
                // Cached token actually rejected by Google (revoked elsewhere, etc.) —
                // drop it and fall through to a silent reauth attempt below.
                console.error("Cached Drive token rejected, retrying sign-in", e);
                driveAccessToken = null;
                clearTokenFromStorage();
            } else {
                // Transient failure (offline, CORS hiccup, Google 5xx) — the cached
                // token itself may still be perfectly valid. Leave it in storage so a
                // later reload can retry instead of forcing the user through a fresh
                // (possibly silently-failing) reauth every time the network blips.
                console.error("Drive token check failed transiently, will retry on next load", e);
                driveAccessToken = null;
                return;
            }
        }
    }
    trySilentReauth();
}

function trySilentReauth() {
    if (!tokenClient_tc) return;
    isSilentAuthAttempt = true;
    tokenClient_tc.requestAccessToken({ prompt: "" });
}

/* Mid-session counterpart to attemptAutoSignIn()'s boot-time reauth. GIS
   access tokens last ~1h and this app has no refresh_token, so leaving a
   tab open past that window used to make every Drive save fail with 401
   forever (nothing ever asked for a new token again). js/drive.js's
   driveFetch() calls this on a 401 and retries once.
   Deliberately does NOT call onSignedIn() the way the boot-time path does —
   that resets currentFileId/expandedFolders/etc., which would yank the
   user out of the note they're editing just to renew a token quietly in
   the background. */
function refreshDriveTokenSilently() {
    if (!tokenClient_tc) return Promise.resolve(false);
    if (driveTokenRefreshPromise) return driveTokenRefreshPromise; // dedup concurrent 401s onto one reauth
    driveTokenRefreshPromise = new Promise((resolve) => {
        midSessionRefreshResolve = resolve;
        isSilentAuthAttempt = true;
        isMidSessionRefresh = true;
        tokenClient_tc.requestAccessToken({ prompt: "" });
    }).finally(() => {
        driveTokenRefreshPromise = null;
    });
    return driveTokenRefreshPromise;
}

async function handleSignoutClick() {
    // Flush any pending planner paint save while the token is still valid —
    // otherwise the debounce timer would fire after revoke() and silently
    // fail (or worse, write against a stale plannerFolderId next sign-in).
    await flushPlannerSave();
    // Defensive: if the GIS script hasn't loaded (or revoke itself errors),
    // this must not throw and abort before the state below gets cleared —
    // that would leave the app showing "signed in" with a token we already
    // consider gone, i.e. exactly the "sign out doesn't work" symptom.
    try {
        if (
            driveAccessToken &&
            typeof google !== "undefined" &&
            google.accounts &&
            google.accounts.oauth2
        ) {
            google.accounts.oauth2.revoke(driveAccessToken, () => {});
        }
    } catch (e) {
        console.error("Token revoke failed (continuing sign-out anyway)", e);
    }
    driveAccessToken = null;
    clearTokenFromStorage();
    updateDriveUI(false, null);
    andysNoteRootId = null;
    driveTree = [];
    expandedFolders = new Set();
    driveTreeFullyLoaded = false;
    driveFullLoadPromise = null;
    plannerResetCaches(); // the planner now switches to the IndexedDB backend
    // Keep any open local note; only clear the editor if a Drive doc was open.
    if (storageMode !== "local") {
        currentFileId = null;
        showEmptyState();
    }
    renderSidebar();
    }


async function onSignedIn() {
    let user = null;
    try {
        const r = await driveGet(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        );
        user = r;
    } catch (e) {
        console.error("Profile fetch failed", e);
    }
    updateDriveUI(true, user);
    storageMode = "drive";
    currentFileId = null;
    expandedFolders = new Set();
    plannerResetCaches(); // switch the planner from the IndexedDB backend to Drive
    await initDriveFilesystem();
    }

/* ─── OAUTH / GAPI BOOT ─── */
function gapiLoaded() {
  gapi.load("client", async () => {
    await gapi.client.init({ discoveryDocs: [] });
    gapiInited = true;
    maybeEnableButton();
  });
}

function gisLoaded() {
  if (!window.GOOGLE_CLIENT_ID) return;
  tokenClient_tc = google.accounts.oauth2.initTokenClient({
    client_id: window.GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: handleTokenResponse,
  });
  gisInited = true;
  maybeEnableButton();
  attemptAutoSignIn();
}

function maybeEnableButton() {
  if (gapiInited && gisInited) {
    const btn = document.getElementById("btn-google-login");
    if (btn) btn.disabled = false;
  }
}

async function handleTokenResponse(resp) {
  const wasSilentAttempt = isSilentAuthAttempt;
  const wasMidSessionRefresh = isMidSessionRefresh;
  isSilentAuthAttempt = false;
  isMidSessionRefresh = false;
  if (resp.error) {
    if (wasMidSessionRefresh && midSessionRefreshResolve) {
      midSessionRefreshResolve(false);
      midSessionRefreshResolve = null;
    }
    // A silent auto-restore attempt failing just means "not previously signed
    // in" or "consent was revoked" — that's the normal logged-out state, not
    // an error the user needs to see.
    if (wasSilentAttempt) return;
    console.error("OAuth error", resp);
    setSyncStatus("error", t("sync.signInFailed"), true);
    return;
  }
  driveAccessToken = resp.access_token;
  saveTokenToStorage(resp);
  console.log("Granted OAuth scopes:", resp.scope);
  if (wasMidSessionRefresh) {
    // Just renewing the token in the background for driveFetch's caller to
    // retry with — skip the full onSignedIn() sign-in flow below entirely.
    if (midSessionRefreshResolve) {
      midSessionRefreshResolve(true);
      midSessionRefreshResolve = null;
    }
    return;
  }
  const hasDrive =
    typeof google !== "undefined" &&
    google.accounts &&
    google.accounts.oauth2 &&
    google.accounts.oauth2.hasGrantedAllScopes(
      resp,
      "https://www.googleapis.com/auth/drive",
    );
  if (!hasDrive) {
    console.error(
      "Drive scope NOT granted. Token scopes:",
      resp.scope,
    );
  }
  const proceed = await requireAppLock();
  if (!proceed) return;
  await onSignedIn();
}

function updateDriveUI(signedIn, user) {
  const loginBtn = document.getElementById("btn-google-login");
  const foldersHeader = document.getElementById("sidebar-folders-header");
  const userInfo = document.getElementById("user-info");
  const nameLabel = document.getElementById("user-name-label");
  const initials = document.getElementById("user-initials");
  const avatar = document.getElementById("user-avatar");
  if (!loginBtn || !foldersHeader || !userInfo || !nameLabel || !initials || !avatar)
    return;
  if (signedIn && user) {
    loginBtn.style.display = "none";
    foldersHeader.style.display = "flex";
    userInfo.style.display = "flex";
    const name = user.name || user.email || "User";
    nameLabel.textContent = name;
    initials.textContent = name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    if (user.picture) {
      avatar.innerHTML = `<img src="${user.picture}" alt="${name}">`;
    }
    setSyncStatus("saving", t("sync.connecting"));
  } else {
    loginBtn.style.display = "flex";
    foldersHeader.style.display = "none";
    userInfo.style.display = "none";
    setSyncStatus("local", t("sync.local"));
  }
}

/* ─── OAUTH BOOT (assigned to window so Google scripts can call them) ─── */
window.gapiLoaded = gapiLoaded;
window.gisLoaded = gisLoaded;
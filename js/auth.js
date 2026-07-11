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
}

function maybeEnableButton() {
  if (gapiInited && gisInited) {
    const btn = document.getElementById("btn-google-login");
    if (btn) btn.disabled = false;
  }
}

async function handleTokenResponse(resp) {
  if (resp.error) {
    console.error("OAuth error", resp);
    setSyncStatus("error", t("sync.signInFailed"), true);
    return;
  }
  driveAccessToken = resp.access_token;
  console.log("Granted OAuth scopes:", resp.scope);
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
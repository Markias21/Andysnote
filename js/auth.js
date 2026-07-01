"use strict";
async function handleAuthClick() {
    if (!tokenClient_tc) {
        alert(
        "Google Sign-In is not configured. Please set window.GOOGLE_CLIENT_ID in js/config.js.",
        );
        return;
    }
    tokenClient_tc.requestAccessToken({
        prompt: "consent",
    });
    }

async function handleSignoutClick() {
    if (driveAccessToken)
        google.accounts.oauth2.revoke(driveAccessToken, () => {});
    driveAccessToken = null;
    updateDriveUI(false, null);
    writerRootId = null;
    driveTree = [];
    expandedFolders = new Set();
    driveTreeFullyLoaded = false;
    driveFullLoadPromise = null;
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
    setSyncStatus("error", "Sign-in failed", true);
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
  const userInfo = document.getElementById("user-info");
  const nameLabel = document.getElementById("user-name-label");
  const initials = document.getElementById("user-initials");
  const avatar = document.getElementById("user-avatar");
  if (!loginBtn || !userInfo || !nameLabel || !initials || !avatar)
    return;
  if (signedIn && user) {
    loginBtn.style.display = "none";
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
    setSyncStatus("saving", "Connecting...");
  } else {
    loginBtn.style.display = "flex";
    userInfo.style.display = "none";
    setSyncStatus("local", "Local only");
  }
}

/* ─── OAUTH BOOT (assigned to window so Google scripts can call them) ─── */
window.gapiLoaded = gapiLoaded;
window.gisLoaded = gisLoaded;
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
    writerRootId = null;
    driveTree = [];
    expandedFolders = new Set();
    currentFileId = null;
    updateDriveUI(false, null);
    showEmptyState();
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
    await initDriveFilesystem();
    }
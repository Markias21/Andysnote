"use strict";
/* ─── APP LOCK (4-digit PIN) ─────────────────────────────────────────────
   Single responsibility: gate entry into a Google-signed-in session behind
   a 4-digit PIN, and let Settings turn that gate on/off. Nothing here
   touches Markdown, storage, or rendering of user documents — see
   .claude/CLAUDE.md's module boundaries.

   Only the PIN's SHA-256 hash is ever persisted (in appSettings.security,
   via setSetting()) — the plaintext PIN never leaves this file. There is no
   server to verify against, so this is a local speed-bump, not real
   authentication; recovery when the PIN is forgotten is to sign out of
   Google and sign back in (see lockScreenForgotPin below), which also
   clears the PIN so it can be set again. */

async function hashPin(pin) {
  const bytes = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* Called from auth.js right before either sign-in path (cached-token
   restore, silent reauth, or an explicit login click) hands control to
   onSignedIn(). Resolves true to let sign-in proceed, or false when the
   user chose "forgot PIN" — auth.js must then just return, since
   lockScreenForgotPin() already drove a full sign-out itself. */
function requireAppLock() {
  if (appLockRecoveryArmed) {
    appLockRecoveryArmed = false;
    disablePinLock();
    return Promise.resolve(true);
  }
  if (!getSetting("security.pinEnabled")) return Promise.resolve(true);
  return new Promise((resolve) => {
    appLockPendingResolve = resolve;
    showLockScreen();
  });
}

function showLockScreen() {
  const input = document.getElementById("lock-pin-input");
  document.getElementById("lock-error").textContent = "";
  input.value = "";
  document.getElementById("app-lock-overlay").classList.add("open");
  setTimeout(() => input.focus(), 50);
}

function hideLockScreen() {
  document.getElementById("app-lock-overlay").classList.remove("open");
}

/* Digits only, capped at 4 — shared by the lock screen and PIN setup inputs. */
function restrictToPinDigits(input) {
  input.value = input.value.replace(/\D/g, "").slice(0, 4);
}

async function submitLockPin() {
  const input = document.getElementById("lock-pin-input");
  const errEl = document.getElementById("lock-error");
  const pin = input.value;
  if (!/^\d{4}$/.test(pin)) {
    errEl.textContent = t("lock.invalid");
    return;
  }
  const hash = await hashPin(pin);
  if (hash === getSetting("security.pinHash")) {
    hideLockScreen();
    const resolve = appLockPendingResolve;
    appLockPendingResolve = null;
    if (resolve) resolve(true);
  } else {
    errEl.textContent = t("lock.wrong");
    input.value = "";
    input.focus();
  }
}

/* "Forgot PIN" recovery: fully sign out (revokes the Google token) and arm
   a one-time flag so the *next* successful sign-in clears the PIN instead
   of asking for it — see requireAppLock() above. */
async function lockScreenForgotPin() {
  appLockRecoveryArmed = true;
  hideLockScreen();
  const resolve = appLockPendingResolve;
  appLockPendingResolve = null;
  await handleSignoutClick();
  if (resolve) resolve(false);
}

/* ─── SETTINGS-PANEL INTEGRATION ─────────────────────────────────────────
   Rendered by settings.js's "pin-lock" field type (js/settings.js:
   renderSettingsGroups). Only usable while signed in to Google — enabling
   it is what makes the gate above apply the next time a Drive session is
   entered. */
function renderPinLockControl(enabled) {
  if (!driveAccessToken) {
    return (
      '<div class="settings-pin-locked-note">' +
      '<label class="switch disabled"><input type="checkbox" disabled><span class="slider"></span></label>' +
      '<span class="settings-pin-hint">' +
      escapeHtml(t("settings.pinNeedsLogin")) +
      "</span></div>"
    );
  }
  return (
    '<label class="switch"><input type="checkbox" ' +
    (enabled ? "checked" : "") +
    ' onchange="onTogglePinLock(this.checked)"><span class="slider"></span></label>'
  );
}

function onTogglePinLock(checked) {
  if (checked) {
    openPinSetup();
    return;
  }
  if (!confirm(t("settings.pinDisableConfirm"))) {
    renderSettings(); // revert the checkbox — the setting itself never changed
    return;
  }
  disablePinLock();
  renderSettings();
}

function disablePinLock() {
  setSetting("security.pinEnabled", false);
  setSetting("security.pinHash", "");
}

function openPinSetup() {
  document.getElementById("pin-setup-new").value = "";
  document.getElementById("pin-setup-confirm").value = "";
  document.getElementById("pin-setup-error").textContent = "";
  document.getElementById("pin-setup-overlay").classList.add("open");
  setTimeout(() => document.getElementById("pin-setup-new").focus(), 50);
}

function closePinSetup() {
  document.getElementById("pin-setup-overlay").classList.remove("open");
  renderSettings(); // reverts the checkbox since pinEnabled never actually flipped
}

function closePinSetupOutside(e) {
  if (e.target === document.getElementById("pin-setup-overlay")) closePinSetup();
}

async function submitPinSetup() {
  const pin = document.getElementById("pin-setup-new").value;
  const confirmPin = document.getElementById("pin-setup-confirm").value;
  const errEl = document.getElementById("pin-setup-error");
  if (!/^\d{4}$/.test(pin)) {
    errEl.textContent = t("settings.pinInvalid");
    return;
  }
  if (pin !== confirmPin) {
    errEl.textContent = t("settings.pinMismatch");
    return;
  }
  const hash = await hashPin(pin);
  setSetting("security.pinHash", hash);
  setSetting("security.pinEnabled", true);
  document.getElementById("pin-setup-overlay").classList.remove("open");
  renderSettings();
}

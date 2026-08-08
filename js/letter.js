/* ─── ANDYSLETTER: VIEW ENTRY POINT ────────────────────────────────────────
   Third top-level view, sibling to Library and Calendar (js/ui.js:
   switchView). Owns: sign-in/sign-up, first-run mailbox setup, the
   pending-approval gate, the inbox/sent/contacts/admin tab shell, and the
   letter detail view. Compose (js/letter/compose.js), the admin panel
   (js/letter/admin.js) and Drive/local export (js/letter/export.js) are
   split out because each has its own non-trivial logic, but they all share
   this file's letterRenderBody()/letterOpenId/letterComposeOpen state.

   Every Supabase/Google-identity call goes through js/letter/api.js — this
   file only builds HTML and reacts to clicks. */

const LETTER_BACK_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';

/* ─── INIT (called once from app.js's DOMContentLoaded) ─── */
async function initLetter() {
  if (!letterIsConfigured()) return; // SUPABASE_URL/ANON_KEY not set yet — tab still works, shows a notice
  try {
    await letterApiInitAuth((event, session) => {
      letterSession = session;
      if (event === "SIGNED_OUT") {
        letterProfile = null;
        letterInbox = null;
        letterSent = null;
        letterContacts = null;
        letterAdminUsers = null;
      }
      if (isLetterViewVisible()) renderLetterView();
    });
    if (letterSession) {
      await letterApiLoadProfile();
    }
  } catch (e) {
    console.error("initLetter failed", e);
  }
}

function isLetterViewVisible() {
  const el = document.getElementById("letter-view");
  return !!el && !el.classList.contains("hidden");
}

/* ─── TOP-LEVEL DISPATCH ─── */
async function renderLetterView() {
  const root = document.getElementById("letter-view");
  if (!root) return;

  if (!letterIsConfigured()) {
    root.innerHTML = letterRenderNotice(t("letter.notConfigured"));
    return;
  }

  if (!letterSession) {
    letterRenderSignIn(root);
    return;
  }

  if (!letterProfile) {
    root.innerHTML = letterRenderLoading();
    try {
      await letterApiLoadProfile();
    } catch (e) {
      console.error("letterApiLoadProfile failed", e);
    }
    if (!letterProfile) {
      letterRenderSetup(root);
      return;
    }
  }

  if (letterProfile.status === "pending") {
    letterRenderPending(root);
    return;
  }
  if (letterProfile.status === "rejected") {
    letterRenderRejected(root);
    return;
  }

  letterRenderShell(root);
}

function letterRenderNotice(msg) {
  return `<div class="letter-auth-screen"><p class="letter-auth-desc">${escapeHtml(msg)}</p></div>`;
}

function letterRenderLoading() {
  return `<div class="letter-loading">${escapeHtml(t("letter.loading"))}</div>`;
}

/* ─── SIGN IN ─── */
function letterRenderSignIn(root) {
  root.innerHTML = `
    <div class="letter-auth-screen">
      <h2>${escapeHtml(t("letter.signInHeading"))}</h2>
      <p class="letter-auth-desc">${escapeHtml(t("letter.signInDesc"))}</p>
      <div id="letter-google-btn" class="letter-google-btn"></div>
      <div class="letter-auth-sep">${escapeHtml(t("letter.signInOr"))}</div>
      <form class="letter-auth-form" onsubmit="letterSubmitEmailAuth(event)">
        <input type="email" id="letter-auth-email" placeholder="${escapeHtml(t("letter.email"))}" required />
        <input type="password" id="letter-auth-password" placeholder="${escapeHtml(t("letter.password"))}" minlength="6" required />
        <button type="submit" class="btn btn-accent">${escapeHtml(letterAuthMode === "signup" ? t("letter.signUpEmail") : t("letter.signInEmail"))}</button>
      </form>
      <button type="button" class="letter-auth-switch" onclick="letterToggleAuthMode()">${escapeHtml(letterAuthMode === "signup" ? t("letter.switchToSignIn") : t("letter.switchToSignUp"))}</button>
      <div class="letter-auth-error" id="letter-auth-error"></div>
    </div>
  `;

  const googleContainer = document.getElementById("letter-google-btn");
  const credentialPromise = letterRenderGoogleButton(googleContainer);
  if (!credentialPromise) {
    googleContainer.textContent = t("letter.googleUnavailable");
    return;
  }
  credentialPromise.then(async (idToken) => {
    try {
      await letterApiSignInWithGoogleIdToken(idToken);
      await letterApiLoadProfile();
      renderLetterView();
    } catch (e) {
      console.error("letterApiSignInWithGoogleIdToken failed", e);
      const errEl = document.getElementById("letter-auth-error");
      if (errEl) errEl.textContent = t("letter.signInError");
    }
  });
}

function letterToggleAuthMode() {
  letterAuthMode = letterAuthMode === "signup" ? "signin" : "signup";
  renderLetterView();
}

async function letterSubmitEmailAuth(event) {
  event.preventDefault();
  const email = document.getElementById("letter-auth-email").value.trim();
  const password = document.getElementById("letter-auth-password").value;
  const errEl = document.getElementById("letter-auth-error");
  errEl.textContent = "";
  try {
    if (letterAuthMode === "signup") {
      const result = await letterApiSignUpEmail(email, password);
      if (!result.session) {
        errEl.textContent = t("letter.signUpCheckEmail");
        return;
      }
    } else {
      await letterApiSignInEmail(email, password);
    }
    await letterApiLoadProfile();
    renderLetterView();
  } catch (e) {
    console.error("letterSubmitEmailAuth failed", e);
    errEl.textContent = t("letter.signInError");
  }
}

async function letterHandleSignOut() {
  try {
    await letterApiSignOut();
  } catch (e) {
    console.error("letterApiSignOut failed", e);
  }
  letterViewMode = "inbox";
  letterOpenId = null;
  letterComposeOpen = false;
  renderLetterView();
}

/* ─── FIRST-RUN MAILBOX SETUP (postcode + name) ─── */
function letterRenderSetup(root) {
  root.innerHTML = `
    <div class="letter-auth-screen">
      <h2>${escapeHtml(t("letter.setupHeading"))}</h2>
      <p class="letter-auth-desc">${escapeHtml(t("letter.setupDesc"))}</p>
      <form class="letter-auth-form" onsubmit="letterSubmitSetup(event)">
        <label class="letter-form-label">${escapeHtml(t("letter.postcodeLabel"))}</label>
        <div class="letter-postcode-row">
          <input type="text" id="letter-setup-postcode" maxlength="5" inputmode="numeric" required />
          <button type="button" class="btn btn-ghost" onclick="letterSuggestPostcode()">${escapeHtml(t("letter.postcodeRandom"))}</button>
        </div>
        <label class="letter-form-label">${escapeHtml(t("letter.nameLabel"))}</label>
        <input type="text" id="letter-setup-name" maxlength="30" required />
        <button type="submit" class="btn btn-accent">${escapeHtml(t("letter.setupSubmit"))}</button>
      </form>
      <div class="letter-auth-error" id="letter-setup-error"></div>
    </div>
  `;
}

function letterSuggestPostcode() {
  const code = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
  document.getElementById("letter-setup-postcode").value = code;
}

async function letterSubmitSetup(event) {
  event.preventDefault();
  const postcode = document.getElementById("letter-setup-postcode").value.trim();
  const name = document.getElementById("letter-setup-name").value.trim();
  const errEl = document.getElementById("letter-setup-error");
  errEl.textContent = "";

  if (!LETTER_POSTCODE_REGEX.test(postcode)) {
    errEl.textContent = t("letter.postcodeInvalid");
    return;
  }
  if (!name || name.length > 30) {
    errEl.textContent = t("letter.nameInvalid");
    return;
  }

  try {
    await letterApiClaimPostcode(postcode, name);
    renderLetterView();
  } catch (e) {
    console.error("letterApiClaimPostcode failed", e);
    const msg = e.message || "";
    if (msg.includes("POSTCODE_TAKEN")) errEl.textContent = t("letter.postcodeTaken");
    else if (msg.includes("RESERVED_NAME")) errEl.textContent = t("letter.nameReserved");
    else if (msg.includes("BAD_NAME")) errEl.textContent = t("letter.nameInvalid");
    else if (msg.includes("BAD_POSTCODE")) errEl.textContent = t("letter.postcodeInvalid");
    else errEl.textContent = t("letter.setupFailed");
  }
}

/* ─── PENDING / REJECTED (admin-approval gate) ─── */
function letterRenderPending(root) {
  root.innerHTML = `
    <div class="letter-auth-screen">
      <h2>${escapeHtml(t("letter.pendingHeading"))}</h2>
      <p class="letter-auth-desc">${escapeHtml(t("letter.pendingDesc"))}</p>
      <button type="button" class="btn btn-ghost" onclick="letterRecheckStatus()">${escapeHtml(t("letter.recheck"))}</button>
      <button type="button" class="letter-auth-switch" onclick="letterHandleSignOut()">${escapeHtml(t("letter.signOut"))}</button>
    </div>
  `;
}

async function letterRecheckStatus() {
  try {
    await letterApiLoadProfile();
  } catch (e) {
    console.error("letterRecheckStatus failed", e);
  }
  renderLetterView();
}

function letterRenderRejected(root) {
  root.innerHTML = `
    <div class="letter-auth-screen">
      <h2>${escapeHtml(t("letter.rejectedHeading"))}</h2>
      <p class="letter-auth-desc">${escapeHtml(t("letter.rejectedDesc"))}</p>
      <button type="button" class="letter-auth-switch" onclick="letterHandleSignOut()">${escapeHtml(t("letter.signOut"))}</button>
    </div>
  `;
}

/* ─── SHELL (tabs + postcode chip + compose button) ─── */
function letterRenderShell(root) {
  const isAdmin = !!(letterProfile && letterProfile.is_admin);
  root.innerHTML = `
    <div class="letter-topbar">
      <div class="letter-tabs">
        <button class="letter-tab ${letterViewMode === "inbox" ? "active" : ""}" onclick="letterSwitchTab('inbox')">${escapeHtml(t("letter.tabInbox"))}</button>
        <button class="letter-tab ${letterViewMode === "sent" ? "active" : ""}" onclick="letterSwitchTab('sent')">${escapeHtml(t("letter.tabSent"))}</button>
        <button class="letter-tab ${letterViewMode === "contacts" ? "active" : ""}" onclick="letterSwitchTab('contacts')">${escapeHtml(t("letter.tabContacts"))}</button>
        ${isAdmin ? `<button class="letter-tab ${letterViewMode === "admin" ? "active" : ""}" onclick="letterSwitchTab('admin')">${escapeHtml(t("letter.tabAdmin"))}</button>` : ""}
      </div>
      <div class="letter-topbar-right">
        <span class="letter-postcode-chip">${escapeHtml(t("letter.myPostcode"))}: ${escapeHtml(letterProfile.postcode)}</span>
        <button class="btn btn-accent" onclick="letterOpenCompose()">${escapeHtml(t("letter.compose"))}</button>
        <button class="letter-signout-btn" title="${escapeHtml(t("letter.signOut"))}" onclick="letterHandleSignOut()">✕</button>
      </div>
    </div>
    <div class="letter-body" id="letter-body"></div>
  `;
  letterRenderBody();
}

function letterSwitchTab(tab) {
  letterViewMode = tab;
  letterOpenId = null;
  letterComposeOpen = false;
  // Force a fresh fetch for the tab being entered, same idea as
  // switchView('calendar') always calling renderCalendar() on entry.
  if (tab === "inbox") letterInbox = null;
  if (tab === "sent") letterSent = null;
  if (tab === "contacts") letterContacts = null;
  if (tab === "admin") letterAdminUsers = null;
  letterRenderShell(document.getElementById("letter-view"));
}

async function letterRenderBody() {
  const body = document.getElementById("letter-body");
  if (!body) return;

  if (letterComposeOpen) {
    renderLetterCompose(body);
    return;
  }
  if (letterOpenId) {
    await letterRenderDetail(body);
    return;
  }
  if (letterViewMode === "inbox") return letterRenderList(body, "inbox");
  if (letterViewMode === "sent") return letterRenderList(body, "sent");
  if (letterViewMode === "contacts") return letterRenderContacts(body);
  if (letterViewMode === "admin") return renderLetterAdmin(body);
}

/* ─── INBOX / SENT LISTS ─── */
async function letterRenderList(body, kind) {
  body.innerHTML = letterRenderLoading();
  let items;
  try {
    items = kind === "inbox" ? letterInbox || (await letterApiLoadInbox()) : letterSent || (await letterApiLoadSent());
  } catch (e) {
    console.error("letterRenderList failed", e);
    body.innerHTML = letterRenderNotice(t("letter.loadFailed"));
    return;
  }
  body.innerHTML = letterBuildEnvelopeList(items, kind);
}

function letterBuildEnvelopeList(items, kind) {
  if (!items.length) {
    return `<div class="letter-empty">${escapeHtml(t(kind === "inbox" ? "letter.inboxEmpty" : "letter.sentEmpty"))}</div>`;
  }
  return (
    '<div class="letter-envelope-list">' +
    items
      .map((letter) => {
        const counterpartName = kind === "inbox" ? letter.sender_name : letter.recipient_name;
        const counterpartPostcode = kind === "inbox" ? letter.sender_postcode : letter.recipient_postcode;
        const unread = kind === "inbox" && !letter.read_at;
        return `
          <div class="letter-envelope ${letterEnvelopeClass(letter.envelope_color)}${unread ? " unread" : ""}" onclick="letterOpenDetail('${letter.id}')">
            <div class="letter-envelope-row">
              <span class="letter-envelope-name">${escapeHtml(counterpartName)} (${escapeHtml(counterpartPostcode)})</span>
              ${unread ? `<span class="letter-envelope-badge">${escapeHtml(t("letter.unread"))}</span>` : ""}
            </div>
            <div class="letter-envelope-subject">${escapeHtml(letter.subject || "")}</div>
            <div class="letter-envelope-date">${letterFormatDateTime(letter.sent_at)}</div>
          </div>
        `;
      })
      .join("") +
    "</div>"
  );
}

function letterOpenDetail(id) {
  letterOpenId = id;
  letterComposeOpen = false;
  letterRenderBody();
}

function letterCloseDetail() {
  letterOpenId = null;
  letterRenderBody();
}

/* Looks the currently-open (or given) letter up in whichever cached list
   matches the active tab — inbox/sent are fetched separately (js/letter/
   api.js) so a letter only lives in one of the two caches. */
function letterFindOpenLetter(id) {
  const list = letterViewMode === "sent" ? letterSent : letterInbox;
  return (list || []).find((l) => l.id === id);
}

function letterRemoveFromCache(id) {
  if (letterInbox) letterInbox = letterInbox.filter((l) => l.id !== id);
  if (letterSent) letterSent = letterSent.filter((l) => l.id !== id);
}

function letterFormatDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(localeTag(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ─── LETTER DETAIL ─── */
async function letterRenderDetail(body) {
  const letter = letterFindOpenLetter(letterOpenId);
  if (!letter) {
    letterOpenId = null;
    return letterRenderBody();
  }

  if (letterViewMode === "inbox" && !letter.read_at) {
    try {
      letter.read_at = await letterApiMarkRead(letter.id);
    } catch (e) {
      console.error("letterApiMarkRead failed", e);
    }
  }

  const paperClass = letterPaperClass(letter.paper_id);
  const fontStack = letterFontStack(letter.font_id);
  const readLine =
    letterViewMode === "sent"
      ? letter.read_at
        ? escapeHtml(t("letter.readAt").replace("{time}", letterFormatDateTime(letter.read_at)))
        : escapeHtml(t("letter.notReadYet"))
      : "";

  body.innerHTML = `
    <button type="button" class="letter-back-btn" onclick="letterCloseDetail()">${LETTER_BACK_ICON_SVG}<span>${escapeHtml(t("letter.backToList"))}</span></button>
    <div class="letter-detail-actions">
      <button class="btn btn-ghost" onclick="letterAddContactFromOpenLetter()">${escapeHtml(t("letter.addToContacts"))}</button>
      ${
        driveAccessToken
          ? `<button class="btn btn-accent" onclick="letterExportToDrive('${letter.id}')">${escapeHtml(t("letter.exportToDrive"))}</button>`
          : `<button class="btn btn-accent" onclick="letterExportToLocal('${letter.id}')">${escapeHtml(t("letter.exportToLocal"))}</button>`
      }
      <button class="btn btn-ghost" onclick="letterDeleteOpenLetter()">${escapeHtml(t("letter.delete"))}</button>
    </div>
    <div class="letter-paper ${paperClass}"${fontStack ? ` style="font-family:${fontStack},sans-serif;"` : ""}>
      <div class="letter-paper-meta">
        <div><span>${escapeHtml(t("letter.fromLabel"))}</span> ${escapeHtml(letter.sender_name)} (${escapeHtml(letter.sender_postcode)})</div>
        <div><span>${escapeHtml(t("letter.toLabel"))}</span> ${escapeHtml(letter.recipient_name)} (${escapeHtml(letter.recipient_postcode)})</div>
        <div class="letter-paper-date">${letterFormatDateTime(letter.sent_at)}</div>
      </div>
      ${letter.subject ? `<h3 class="letter-paper-subject">${escapeHtml(letter.subject)}</h3>` : ""}
      <div class="letter-paper-body">${escapeHtml(letter.body).replace(/\n/g, "<br>")}</div>
    </div>
    <div class="letter-read-receipt">${readLine}</div>
  `;
}

async function letterAddContactFromOpenLetter() {
  const letter = letterFindOpenLetter(letterOpenId);
  if (!letter) return;
  const isSent = letterViewMode === "sent";
  const postcode = isSent ? letter.recipient_postcode : letter.sender_postcode;
  const name = isSent ? letter.recipient_name : letter.sender_name;
  try {
    await letterApiAddContact(name, postcode, "");
    letterContacts = null;
    setSyncStatus("saved", t("letter.addedToContacts"));
  } catch (e) {
    console.error("letterAddContactFromOpenLetter failed", e);
    const dup = (e.message || "").toLowerCase().includes("duplicate");
    setSyncStatus("error", dup ? t("letter.contactDuplicate") : t("letter.actionFailed"));
  }
}

/* ─── COMPOSE OPEN/CLOSE (form rendering lives in js/letter/compose.js) ─── */
function letterOpenCompose(prefill) {
  letterComposeDraft = Object.assign(
    {
      toPostcode: "",
      senderName: (letterProfile && letterProfile.display_name) || "",
      recipientName: "",
      subject: "",
      body: "",
      paperId: DEFAULT_LETTER_PAPER,
      envelopeColor: DEFAULT_LETTER_ENVELOPE,
      fontId: "",
    },
    prefill || {},
  );
  letterComposeOpen = true;
  letterOpenId = null;
  letterRenderBody();
}

function letterCloseCompose() {
  letterComposeOpen = false;
  letterComposeDraft = null;
  letterRenderBody();
}

/* ─── ADDRESS BOOK (letter_contacts) ─── */
async function letterRenderContacts(body) {
  body.innerHTML = letterRenderLoading();
  let contacts;
  try {
    contacts = letterContacts || (await letterApiLoadContacts());
  } catch (e) {
    console.error("letterApiLoadContacts failed", e);
    body.innerHTML = letterRenderNotice(t("letter.loadFailed"));
    return;
  }

  const rows = contacts.length
    ? contacts
        .map(
          (c) => `
        <div class="letter-contact-row">
          <div class="letter-contact-info" onclick="letterComposeFromContactId('${c.id}')">
            <span class="letter-contact-name">${escapeHtml(c.name)}</span>
            <span class="letter-contact-postcode">${escapeHtml(c.postcode)}</span>
            ${c.memo ? `<span class="letter-contact-memo">${escapeHtml(c.memo)}</span>` : ""}
          </div>
          <button class="letter-contact-delete" title="${escapeHtml(t("letter.contactDelete"))}" onclick="letterDeleteContact('${c.id}')">✕</button>
        </div>
      `,
        )
        .join("")
    : `<div class="letter-empty">${escapeHtml(t("letter.contactsEmpty"))}</div>`;

  body.innerHTML = `
    <div class="letter-contacts-list">${rows}</div>
    <h3>${escapeHtml(t("letter.contactsAdd"))}</h3>
    <form class="letter-contact-form" onsubmit="letterSubmitContact(event)">
      <input type="text" id="letter-contact-name" placeholder="${escapeHtml(t("letter.contactName"))}" maxlength="30" required />
      <input type="text" id="letter-contact-postcode" placeholder="${escapeHtml(t("letter.contactPostcode"))}" maxlength="5" inputmode="numeric" required />
      <input type="text" id="letter-contact-memo" placeholder="${escapeHtml(t("letter.contactMemo"))}" maxlength="60" />
      <button type="submit" class="btn btn-accent">${escapeHtml(t("letter.contactSave"))}</button>
    </form>
  `;
}

async function letterSubmitContact(event) {
  event.preventDefault();
  const name = document.getElementById("letter-contact-name").value.trim();
  const postcode = document.getElementById("letter-contact-postcode").value.trim();
  const memo = document.getElementById("letter-contact-memo").value.trim();
  if (!name) return;
  if (!LETTER_POSTCODE_REGEX.test(postcode)) {
    setSyncStatus("error", t("letter.postcodeInvalid"));
    return;
  }
  try {
    await letterApiAddContact(name, postcode, memo);
    letterContacts = null;
    letterRenderBody();
    setSyncStatus("saved", t("letter.addedToContacts"));
  } catch (e) {
    console.error("letterSubmitContact failed", e);
    const dup = (e.message || "").toLowerCase().includes("duplicate");
    setSyncStatus("error", dup ? t("letter.contactDuplicate") : t("letter.actionFailed"));
  }
}

async function letterDeleteContact(id) {
  if (!confirm(t("letter.contactDeleteConfirm"))) return;
  try {
    await letterApiDeleteContact(id);
    letterContacts = null;
    letterRenderBody();
  } catch (e) {
    console.error("letterDeleteContact failed", e);
    setSyncStatus("error", t("letter.actionFailed"));
  }
}

function letterComposeFromContactId(id) {
  const contact = (letterContacts || []).find((c) => c.id === id);
  if (!contact) return;
  letterOpenCompose({ toPostcode: contact.postcode, recipientName: contact.name });
}

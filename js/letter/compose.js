/* ─── ANDYSLETTER: COMPOSE FORM ─────────────────────────────────────────────
   Renders/validates/sends the "write a letter" form. Opening/closing the
   form (letterOpenCompose/letterCloseCompose, which flip letterComposeOpen +
   letterComposeDraft) lives in js/letter.js since several screens there
   trigger it (the compose button, a contact row); this file only owns what
   happens once the form is on screen. */

function renderLetterCompose(body) {
  const d = letterComposeDraft;
  body.innerHTML = `
    <button type="button" class="letter-back-btn" onclick="letterCloseCompose()">${LETTER_BACK_ICON_SVG}<span>${escapeHtml(t("letter.backToList"))}</span></button>
    <h2>${escapeHtml(t("letter.composeHeading"))}</h2>
    <form class="letter-compose-form" onsubmit="letterSubmitCompose(event)">
      <div class="letter-compose-row">
        <label>${escapeHtml(t("letter.fromLabel"))}</label>
        <input type="text" id="letter-compose-sender" maxlength="30" value="${escapeHtml(d.senderName)}" />
      </div>
      <div class="letter-compose-row">
        <label>${escapeHtml(t("letter.toLabel"))}</label>
        <input type="text" id="letter-compose-recipient" maxlength="30" value="${escapeHtml(d.recipientName)}" />
      </div>
      <div class="letter-compose-row">
        <label>${escapeHtml(t("letter.toPostcodeLabel"))}</label>
        <input type="text" id="letter-compose-postcode" maxlength="5" inputmode="numeric" value="${escapeHtml(d.toPostcode)}" oninput="letterCheckComposePostcode()" required />
        <span class="letter-postcode-status" id="letter-postcode-status"></span>
      </div>
      <div class="letter-compose-row">
        <label>${escapeHtml(t("letter.subjectLabel"))}</label>
        <input type="text" id="letter-compose-subject" maxlength="100" value="${escapeHtml(d.subject)}" />
      </div>
      <div class="letter-compose-picks">
        <div class="letter-compose-row">
          <label>${escapeHtml(t("letter.paperLabel"))}</label>
          <select id="letter-compose-paper" onchange="letterOnComposePaperChange(this.value)">
            ${letterPaperOptions()
              .map((o) => `<option value="${o.value}"${o.value === d.paperId ? " selected" : ""}>${escapeHtml(o.label)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="letter-compose-row">
          <label>${escapeHtml(t("letter.envelopeLabel"))}</label>
          <select id="letter-compose-envelope">
            ${letterEnvelopeOptions()
              .map((o) => `<option value="${o.value}"${o.value === d.envelopeColor ? " selected" : ""}>${escapeHtml(o.label)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="letter-compose-row">
          <label>${escapeHtml(t("letter.fontLabel"))}</label>
          <select id="letter-compose-font">
            <option value="">—</option>
            ${letterFontOptions()
              .map((o) => `<option value="${o.value}"${o.value === d.fontId ? " selected" : ""}>${escapeHtml(o.label)}</option>`)
              .join("")}
          </select>
        </div>
      </div>
      <textarea
        id="letter-compose-body"
        class="letter-compose-body ${letterPaperClass(d.paperId)}"
        maxlength="20000"
        placeholder="${escapeHtml(t("letter.bodyLabel"))}"
        required
      >${escapeHtml(d.body)}</textarea>
      <div class="letter-compose-actions">
        <button type="submit" class="btn btn-accent" id="letter-compose-submit">${escapeHtml(t("letter.send"))}</button>
      </div>
      <div class="letter-auth-error" id="letter-compose-error"></div>
    </form>
  `;

  if (d.toPostcode) letterCheckComposePostcode();
}

function letterOnComposePaperChange(paperId) {
  const textarea = document.getElementById("letter-compose-body");
  if (textarea) textarea.className = "letter-compose-body " + letterPaperClass(paperId);
}

/* Debounced "does this postcode exist" check — mirrors the app's existing
   debounce-timer pattern (js/local.js: searchDebounceTimer) rather than
   firing a request on every keystroke. */
async function letterCheckComposePostcode() {
  const input = document.getElementById("letter-compose-postcode");
  const status = document.getElementById("letter-postcode-status");
  if (!input || !status) return;
  const postcode = input.value.trim();

  if (letterPostcodeCheckTimer) clearTimeout(letterPostcodeCheckTimer);
  if (!LETTER_POSTCODE_REGEX.test(postcode)) {
    status.textContent = "";
    status.className = "letter-postcode-status";
    return;
  }

  status.textContent = t("letter.postcodeChecking");
  status.className = "letter-postcode-status checking";
  letterPostcodeCheckTimer = setTimeout(async () => {
    try {
      const exists = await letterApiPostcodeExists(postcode);
      status.textContent = exists ? t("letter.postcodeOk") : t("letter.postcodeNotFound");
      status.className = "letter-postcode-status " + (exists ? "ok" : "bad");
    } catch (e) {
      console.error("letterApiPostcodeExists failed", e);
      status.textContent = "";
      status.className = "letter-postcode-status";
    }
  }, 400);
}

async function letterSubmitCompose(event) {
  event.preventDefault();
  const errEl = document.getElementById("letter-compose-error");
  errEl.textContent = "";

  const toPostcode = document.getElementById("letter-compose-postcode").value.trim();
  const senderName = document.getElementById("letter-compose-sender").value.trim();
  const recipientName = document.getElementById("letter-compose-recipient").value.trim();
  const subject = document.getElementById("letter-compose-subject").value.trim();
  const bodyText = document.getElementById("letter-compose-body").value;
  const paperId = document.getElementById("letter-compose-paper").value;
  const envelopeColor = document.getElementById("letter-compose-envelope").value;
  const fontId = document.getElementById("letter-compose-font").value;

  if (!LETTER_POSTCODE_REGEX.test(toPostcode)) {
    errEl.textContent = t("letter.postcodeInvalid");
    return;
  }
  if (!bodyText.trim()) return;

  const submitBtn = document.getElementById("letter-compose-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = t("letter.sending");

  try {
    await letterApiSend({
      toPostcode,
      senderName,
      recipientName,
      subject,
      body: bodyText,
      paperId,
      envelopeColor,
      fontId,
    });
    letterSent = null; // force a refetch next time the Sent tab is opened
    letterCloseCompose();
    setSyncStatus("saved", t("letter.sent"));
  } catch (e) {
    console.error("letterApiSend failed", e);
    const msg = e.message || "";
    if (msg.includes("NO_SUCH_POSTCODE")) errEl.textContent = t("letter.postcodeNotFound");
    else if (msg.includes("RATE_LIMITED")) errEl.textContent = t("letter.rateLimited");
    else if (msg.includes("TOO_LONG")) errEl.textContent = t("letter.tooLong");
    else if (msg.includes("NOT_APPROVED")) errEl.textContent = t("letter.pendingDesc");
    else errEl.textContent = t("letter.sendFailed");
    submitBtn.disabled = false;
    submitBtn.textContent = t("letter.send");
  }
}

/* ─── ANDYSLETTER: NOTIFICATIONS ─────────────────────────────────────────────
   The small panel under the compose/sign-out buttons (js/letter.js:
   letterRenderShell) plus the "(N)" unread count on the Inbox tab. Only two
   kinds of notification exist: a letter arrived, or a letter you sent got
   read. No Supabase Realtime subscription — AndysLetter has no live push
   anywhere else either, so this just re-fetches on a timer while the
   AndysLetter tab is open (letterStartNotifyPolling/letterStopNotifyPolling,
   driven by js/ui.js's switchView and this file's own render calls).

   "Arrived" notifications disappear on their own once letterApiMarkRead
   fires (js/letter.js: letterRenderDetail calls letterRefreshNotifications
   right after). "Read" notifications need an explicit ack because there's no
   equivalent read action on the sender's side — letter_ack_read_notification
   records that server-side (not just in this browser) so the notification
   disappears on every device, the same way read_at itself already does. */

const LETTER_NOTIFY_POLL_MS = 30000;

async function letterRefreshNotifications() {
  if (!letterSession) return;

  if (!getSetting("letter.notificationsEnabled")) {
    letterNotifyArrived = [];
    letterNotifyReadReceipts = [];
    letterRenderNotifyPanel();
    letterUpdateInboxTabLabel();
    return;
  }

  try {
    const { arrived, readReceipts } = await letterApiLoadNotifications();
    letterNotifyArrived = arrived;
    letterNotifyReadReceipts = readReceipts;
  } catch (e) {
    console.error("letterRefreshNotifications failed", e);
  }
  letterRenderNotifyPanel();
  letterUpdateInboxTabLabel();
}

function letterStartNotifyPolling() {
  letterStopNotifyPolling();
  letterRefreshNotifications();
  letterNotifyTimer = setInterval(letterRefreshNotifications, LETTER_NOTIFY_POLL_MS);
}

function letterStopNotifyPolling() {
  if (letterNotifyTimer) clearInterval(letterNotifyTimer);
  letterNotifyTimer = null;
}

/* Hidden while composing (per spec) and whenever there's nothing to show —
   :empty in CSS then collapses the panel instead of leaving a blank box. */
function letterRenderNotifyPanel() {
  const el = document.getElementById("letter-notify-panel");
  if (!el) return;

  if (letterComposeOpen || (!letterNotifyArrived.length && !letterNotifyReadReceipts.length)) {
    el.innerHTML = "";
    return;
  }

  const arrivedHtml = letterNotifyArrived
    .map(
      (n) =>
        `<div class="letter-notify-item" onclick="letterOpenNotifyArrived()">${escapeHtml(t("letter.notifyArrived").replace("{name}", n.sender_name))}</div>`,
    )
    .join("");
  const readHtml = letterNotifyReadReceipts
    .map(
      (n) =>
        `<div class="letter-notify-item" onclick="letterOpenNotifyReadReceipt('${n.id}')">${escapeHtml(t("letter.notifyRead").replace("{name}", n.recipient_name))}</div>`,
    )
    .join("");

  el.innerHTML = `<div class="letter-notify-list">${arrivedHtml}${readHtml}</div>`;
}

function letterUpdateInboxTabLabel() {
  const btn = document.getElementById("letter-tab-inbox");
  if (!btn) return;
  const count = letterNotifyArrived.length;
  btn.textContent = t("letter.tabInbox") + (count > 0 ? ` (${count})` : "");
}

function letterOpenNotifyArrived() {
  letterSwitchTab("inbox");
}

async function letterOpenNotifyReadReceipt(id) {
  try {
    await letterApiAckReadNotification(id);
  } catch (e) {
    console.error("letterApiAckReadNotification failed", e);
  }
  letterSwitchTab("sent");
}

/* ─── ANDYSLETTER: ADMIN PANEL ──────────────────────────────────────────────
   Only reachable from the "Admin" tab, which js/letter.js's shell only
   renders when letterProfile.is_admin is true — but the real gate is
   server-side (docs/supabase-schema.sql: letter_admin_list_users/
   letter_admin_set_status both raise FORBIDDEN for non-admins), so hiding
   the tab is a convenience, not the security boundary. */

async function renderLetterAdmin(body) {
  body.innerHTML = letterRenderLoading();
  let users;
  try {
    users = letterAdminUsers || (await letterApiAdminListUsers());
  } catch (e) {
    console.error("letterApiAdminListUsers failed", e);
    body.innerHTML = letterRenderNotice(t("letter.loadFailed"));
    return;
  }

  const pending = users.filter((u) => u.status === "pending");
  const rest = users.filter((u) => u.status !== "pending");

  body.innerHTML = `
    <div class="letter-admin">
      <h2>${escapeHtml(t("letter.admin.heading"))}</h2>
      <h3>${escapeHtml(t("letter.admin.pendingSection"))}</h3>
      ${
        pending.length
          ? pending.map((u) => letterAdminRow(u, true)).join("")
          : `<div class="letter-empty">${escapeHtml(t("letter.admin.noPending"))}</div>`
      }
      <h3>${escapeHtml(t("letter.admin.allSection"))}</h3>
      ${rest.map((u) => letterAdminRow(u, false)).join("")}
    </div>
  `;
}

function letterAdminRow(u, isPendingRow) {
  const isSelf = letterSession && u.id === letterSession.user.id;
  const statusKey = "letter.admin.status" + u.status.charAt(0).toUpperCase() + u.status.slice(1);

  let actions;
  if (isSelf) {
    actions = `<span class="letter-admin-you">(${escapeHtml(t("letter.admin.you"))})</span>`;
  } else if (isPendingRow) {
    actions = `
      <button class="btn btn-accent" onclick="letterAdminSetStatus('${u.id}','approved')">${escapeHtml(t("letter.admin.approve"))}</button>
      <button class="btn btn-ghost" onclick="letterAdminSetStatus('${u.id}','rejected', true)">${escapeHtml(t("letter.admin.reject"))}</button>
    `;
  } else if (u.status === "approved") {
    actions = `<button class="btn btn-ghost" onclick="letterAdminSetStatus('${u.id}','rejected', false)">${escapeHtml(t("letter.admin.revoke"))}</button>`;
  } else {
    actions = `<button class="btn btn-accent" onclick="letterAdminSetStatus('${u.id}','approved')">${escapeHtml(t("letter.admin.approve"))}</button>`;
  }

  return `
    <div class="letter-admin-row">
      <div class="letter-admin-user">
        <span class="letter-admin-name">${escapeHtml(u.display_name)}${u.is_admin ? " 👑" : ""}</span>
        <span class="letter-admin-postcode">${escapeHtml(u.postcode)}</span>
        <span class="letter-admin-email">${escapeHtml(u.email || "")}</span>
        <span class="letter-admin-status letter-admin-status-${u.status}">${escapeHtml(t(statusKey))}</span>
      </div>
      <div class="letter-admin-actions">${actions}</div>
    </div>
  `;
}

async function letterAdminSetStatus(userId, status, isPendingReject) {
  const confirmMsg =
    status === "rejected" ? (isPendingReject ? t("letter.admin.confirmReject") : t("letter.admin.confirmRevoke")) : null;
  if (confirmMsg && !confirm(confirmMsg)) return;

  try {
    await letterApiAdminSetStatus(userId, status);
    letterAdminUsers = null;
    letterRenderBody();
  } catch (e) {
    console.error("letterAdminSetStatus failed", e);
    setSyncStatus("error", t("letter.actionFailed"));
  }
}

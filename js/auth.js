"use strict";
/* ─── GOOGLE DRIVE 인증 ─────────────────────────────────────────────────────
   authorization code flow. 로그인 팝업이 가져온 인증 코드를 인증 릴레이 Worker
   (workers/drive-auth/)가 refresh_token으로 바꿔 자기 KV에 보관하고, 브라우저에는
   그 자리를 대신할 불투명한 session_id만 내려준다. 이후 access token이 만료되면
   Google이 아니라 Worker에게 새 토큰을 받아온다.

   이 구조를 쓰는 이유: 예전의 implicit flow는 refresh_token을 아예 발급받지 못해
   access token의 ~1시간 수명이 곧 로그인 수명이었고, 만료 후 무팝업 재인증은
   accounts.google.com의 서드파티 쿠키에 의존해서 iOS Safari처럼 이를 차단하는
   브라우저에서는 사실상 매번 다시 로그인해야 했다. 여기서는 갱신에 필요한 자격이
   서버(KV)에 있으므로 브라우저의 쿠키 정책과 무관하게 로그인이 유지된다. */

function driveAuthWorkerUrl(path) {
  const base = window.DRIVE_AUTH_WORKER_URL;
  if (!base) return null;
  return base.replace(/\/+$/, "") + path;
}

function handleAuthClick() {
  if (!window.GOOGLE_CLIENT_ID || !window.DRIVE_AUTH_WORKER_URL) {
    alert(t("auth.notConfigured"));
    return;
  }
  const state = crypto.randomUUID();
  const url =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: window.GOOGLE_CLIENT_ID,
      redirect_uri: driveOAuthRedirectUri(),
      response_type: "code",
      scope: DRIVE_SCOPE,
      // refresh_token은 access_type=offline일 때만 발급된다 — 이 플로우 전체의 전제.
      access_type: "offline",
      // consent: refresh_token은 "최초 승인"에만 내려오므로, 다시 로그인할 때마다
      // 새 refresh_token을 확실히 받으려면 동의를 다시 받아야 한다.
      // select_account: 로그아웃 후 다른 계정으로 갈아탈 수 있도록 계정 선택기를 띄운다.
      prompt: "consent select_account",
      state,
    }).toString();
  // 팝업 차단기는 사용자 클릭 직후의 "동기" window.open만 허용한다.
  // 이 호출 앞에 await가 끼면 모바일 브라우저에서 조용히 막힌다.
  const popup = window.open(url, "andysnote-google-oauth", "width=480,height=640");
  if (!popup) {
    setSyncStatus("error", t("auth.popupBlocked"), true);
    return;
  }
  oauthPendingState = state;
}

/* oauth-callback.html이 팝업에서 보내온 인증 코드 수신부. */
function handleOAuthMessage(event) {
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || data.source !== "andysnote-oauth") return;
  // state 불일치 = 우리가 띄운 팝업의 응답이 아니다(CSRF 또는 이미 처리된 응답).
  if (!oauthPendingState || data.state !== oauthPendingState) return;
  oauthPendingState = null;
  // 사용자가 동의화면에서 취소한 경우 — 로그아웃 상태 그대로 두는 것이 정상 동작이다.
  if (data.error || !data.code) return;
  completeSignIn(data.code);
}

async function completeSignIn(code) {
  try {
    const r = await fetch(driveAuthWorkerUrl("/exchange"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: driveOAuthRedirectUri() }),
    });
    if (!r.ok) throw new Error("exchange -> " + r.status);
    const data = await r.json();
    driveAccessToken = data.access_token;
    driveSessionId = data.session_id;
    saveSessionToStorage(data.access_token, data.expires_in);
  } catch (e) {
    console.error("Sign-in exchange failed", e);
    setSyncStatus("error", t("sync.signInFailed"), true);
    return;
  }
  const proceed = await requireAppLock();
  if (!proceed) return;
  await onSignedIn();
}

/* ─── SESSION PERSISTENCE ───────────────────────────────────────────────────
   localStorage에는 session_id와 (재방문 시 Worker를 한 번 덜 부르기 위한) 마지막
   access token만 담는다. refresh_token은 여기 오지 않는다 — Worker의 KV에만 있다. */
function saveSessionToStorage(accessToken, expiresInSec) {
  try {
    localStorage.setItem(
      DRIVE_SESSION_STORAGE_KEY,
      JSON.stringify({
        session_id: driveSessionId,
        access_token: accessToken,
        expires_at: Date.now() + (Number(expiresInSec) || 3600) * 1000,
      }),
    );
  } catch (e) {
    console.error("Failed to persist Drive session", e);
  }
}

function loadSessionFromStorage() {
  try {
    const raw = localStorage.getItem(DRIVE_SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearSessionFromStorage() {
  try {
    localStorage.removeItem(DRIVE_SESSION_STORAGE_KEY);
  } catch (e) {}
}

/* 저장된 session_id로 Worker에게 새 access token을 받아온다. 성공하면 true.
   권한이 영구적으로 사라진 경우(철회/만료/서버에서 세션 삭제)에만 로컬 세션을
   지우고, 네트워크 장애 같은 일시적 실패에는 남겨둔다 — 다음 시도에 살아날 수
   있는 세션을 한 번의 통신 실패로 버리지 않기 위함. */
async function fetchAccessTokenViaWorker() {
  if (!driveSessionId || !window.DRIVE_AUTH_WORKER_URL) return false;
  let r;
  try {
    r = await fetch(driveAuthWorkerUrl("/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: driveSessionId }),
    });
  } catch (e) {
    console.error("Auth Worker unreachable, will retry later", e);
    return false;
  }
  if (r.ok) {
    try {
      const data = await r.json();
      driveAccessToken = data.access_token;
      saveSessionToStorage(data.access_token, data.expires_in);
      return true;
    } catch (e) {
      console.error("Malformed refresh response", e);
      return false;
    }
  }
  if (r.status === 401 || r.status === 404) {
    driveAccessToken = null;
    driveSessionId = null;
    clearSessionFromStorage();
    return false;
  }
  console.error("Drive token refresh failed", r.status);
  return false;
}

/* 부팅 시 1회(initDriveAuth에서 호출). 아직 유효한 access token이 캐시돼 있으면
   그대로 쓰고, 없거나 만료됐으면 Worker에서 새로 받아온다. 어느 경로든 실패하면
   그냥 로그아웃 상태로 남는다 — 이 함수가 실행되지 않은 것과 같은 상태. */
async function attemptAutoSignIn() {
  const SKEW_MS = 60 * 1000; // 1분 내 만료 예정이면 이미 만료된 것으로 취급
  const cached = loadSessionFromStorage();
  if (!cached || !cached.session_id) return; // 이 기기에서 로그인한 적 없음
  driveSessionId = cached.session_id;

  if (cached.access_token && cached.expires_at > Date.now() + SKEW_MS) {
    driveAccessToken = cached.access_token;
    // onSignedIn()/initDriveFilesystem()은 자기 요청 오류를 삼키고 "불러오기 실패"
    // 화면을 대신 그리므로, 철회된 토큰을 여기서 못 잡으면 영영 못 잡는다.
    // 값싼 엔드포인트로 먼저 확인한다.
    try {
      await driveGet("https://www.googleapis.com/oauth2/v3/userinfo");
      const proceed = await requireAppLock();
      if (!proceed) return;
      await onSignedIn();
      return;
    } catch (e) {
      driveAccessToken = null;
      if (e.status !== 401) {
        // 일시적 실패(오프라인, Google 5xx) — 캐시된 토큰은 멀쩡할 수 있으니
        // 지우지 않고 다음 로드에서 다시 시도한다.
        console.error("Drive token check failed transiently, will retry on next load", e);
        return;
      }
      // 401이면 아래 Worker 갱신으로 이어진다. (driveFetch가 이미 한 번 갱신을
      // 시도했다가 실패한 경우라면 세션도 정리된 상태라 아래 호출은 곧바로 끝난다.)
      console.error("Cached Drive token rejected, renewing via auth Worker", e);
    }
  }
  await restoreSessionFromWorker();
}

/* 저장된 세션으로 조용히(팝업 없이) 로그인 상태를 복구한다. */
async function restoreSessionFromWorker() {
  const ok = await fetchAccessTokenViaWorker();
  if (!ok) return;
  const proceed = await requireAppLock();
  if (!proceed) return;
  await onSignedIn();
}

/* 세션 도중의 토큰 갱신. js/drive.js의 driveFetch()가 401을 받으면 이걸 호출하고
   한 번 재시도한다. 부팅 경로와 달리 onSignedIn()을 부르지 않는다 —
   currentFileId/expandedFolders 등이 초기화되면서 사용자가 편집 중인 노트에서
   튕겨나가기 때문. 동시에 터진 401들이 각자 갱신하지 않도록 한 번의 요청을 공유한다. */
function refreshDriveTokenSilently() {
  if (driveTokenRefreshPromise) return driveTokenRefreshPromise;
  driveTokenRefreshPromise = fetchAccessTokenViaWorker().finally(() => {
    driveTokenRefreshPromise = null;
  });
  return driveTokenRefreshPromise;
}

/* 앱이 다시 포그라운드로 올라올 때(탭 복귀 / PWA 백그라운드 복귀) 만료된 토큰을
   미리 갱신한다. 다음 Drive 호출이 401을 받을 때까지 기다리지 않기 위한 것으로,
   아직 유효한 토큰은 건드리지 않는다. */
function handleVisibilityChange() {
  if (document.visibilityState !== "visible") return;
  if (!driveAccessToken) return;
  const SKEW_MS = 60 * 1000;
  const cached = loadSessionFromStorage();
  if (cached && cached.expires_at > Date.now() + SKEW_MS) return;
  refreshDriveTokenSilently();
}

async function handleSignoutClick() {
  // Flush any pending planner paint save while the token is still valid —
  // otherwise the debounce timer would fire after the session is gone and
  // silently fail (or worse, write against a stale plannerFolderId next sign-in).
  await flushPlannerSave();
  // Defensive: revoke must not throw and abort before the state below gets
  // cleared — that would leave the app showing "signed in" with a session we
  // already consider gone, i.e. exactly the "sign out doesn't work" symptom.
  try {
    if (driveSessionId && window.DRIVE_AUTH_WORKER_URL) {
      await fetch(driveAuthWorkerUrl("/revoke"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: driveSessionId }),
      });
    }
  } catch (e) {
    console.error("Session revoke failed (continuing sign-out anyway)", e);
  }
  driveAccessToken = null;
  driveSessionId = null;
  clearSessionFromStorage();
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

/* ─── BOOT (js/app.js의 DOMContentLoaded에서 호출) ─── */
function initDriveAuth() {
  window.addEventListener("message", handleOAuthMessage);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  attemptAutoSignIn();
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

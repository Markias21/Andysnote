/* AndysNote Drive 인증 릴레이.
 *
 * 브라우저는 refresh_token을 절대 보지 못한다. 브라우저가 들고 있는 건 이 Worker가
 * 발급한 불투명한 session_id 하나뿐이고, refresh_token은 KV에만 있다.
 *
 *   POST /exchange  { code, redirect_uri }  -> { session_id, access_token, expires_in }
 *   POST /refresh   { session_id }          -> { access_token, expires_in }
 *   POST /revoke    { session_id }          -> {}
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);

    // 허용되지 않은 오리진은 프리플라이트 단계에서 끊는다.
    if (!cors) return new Response("Forbidden origin", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

    const path = new URL(request.url).pathname;
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "bad_request" }, 400, cors);
    }

    if (path === "/exchange") return handleExchange(body, env, cors);
    if (path === "/refresh") return handleRefresh(body, env, cors);
    if (path === "/revoke") return handleRevoke(body, env, cors);
    return json({ error: "not_found" }, 404, cors);
  },
};

/* ─── 라우트 ─── */

/* 최초 로그인: 인증 코드를 refresh_token으로 바꿔 KV에 넣고 session_id를 발급한다. */
async function handleExchange(body, env, cors) {
  const { code, redirect_uri } = body || {};
  if (!code || !redirect_uri) return json({ error: "bad_request" }, 400, cors);
  // 이 Worker(=우리 client_secret)가 남의 사이트로 발급된 코드를 교환해주는 도구로
  // 쓰이지 않도록, redirect_uri가 우리가 아는 오리진인지 먼저 확인한다.
  if (!isAllowedOrigin(safeOrigin(redirect_uri), env)) {
    return json({ error: "bad_redirect_uri" }, 400, cors);
  }

  let tokens;
  try {
    tokens = await postToGoogle(GOOGLE_TOKEN_URL, {
      grant_type: "authorization_code",
      code,
      redirect_uri,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    });
  } catch (e) {
    return json({ error: "upstream_unavailable" }, 502, cors);
  }
  if (!tokens.ok) return json({ error: "exchange_failed" }, 400, cors);
  // refresh_token이 없으면 이 세션은 태어날 때부터 갱신이 불가능하다 —
  // 반쪽짜리 세션을 KV에 남기느니 실패로 처리해 로그인을 다시 받는 편이 낫다.
  if (!tokens.data.refresh_token) return json({ error: "no_refresh_token" }, 400, cors);

  const sessionId = crypto.randomUUID();
  await env.SESSIONS.put(
    sessionKey(sessionId),
    JSON.stringify({ refresh_token: tokens.data.refresh_token, created_at: Date.now() }),
  );
  return json(
    { session_id: sessionId, access_token: tokens.data.access_token, expires_in: tokens.data.expires_in },
    200,
    cors,
  );
}

/* 재방문/토큰 만료: 저장된 refresh_token으로 새 access_token만 발급한다. */
async function handleRefresh(body, env, cors) {
  const { session_id } = body || {};
  if (!session_id) return json({ error: "bad_request" }, 400, cors);

  const session = await readSession(session_id, env);
  if (!session) return json({ error: "no_session" }, 404, cors);

  let tokens;
  try {
    tokens = await postToGoogle(GOOGLE_TOKEN_URL, {
      grant_type: "refresh_token",
      refresh_token: session.refresh_token,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    });
  } catch (e) {
    // 네트워크 장애 — refresh_token 자체는 멀쩡할 수 있으므로 세션을 지우지 않는다.
    return json({ error: "upstream_unavailable" }, 502, cors);
  }
  if (tokens.ok) {
    return json({ access_token: tokens.data.access_token, expires_in: tokens.data.expires_in }, 200, cors);
  }
  // invalid_grant = 사용자가 권한을 철회했거나 refresh_token이 만료됨(되돌릴 수 없음).
  // 그 외 오류(설정 실수, Google 5xx 등)는 일시적일 수 있으니 세션을 남겨둔다.
  if (tokens.data && tokens.data.error === "invalid_grant") {
    await env.SESSIONS.delete(sessionKey(session_id));
    return json({ error: "invalid_grant" }, 401, cors);
  }
  return json({ error: "refresh_failed" }, 502, cors);
}

/* 로그아웃: Google 쪽 권한을 철회하고 KV에서 세션을 지운다. */
async function handleRevoke(body, env, cors) {
  const { session_id } = body || {};
  if (!session_id) return json({ error: "bad_request" }, 400, cors);

  const session = await readSession(session_id, env);
  if (session) {
    // 철회 실패(이미 철회됨/네트워크 오류)로 로그아웃이 막히면 안 되므로 결과는 보지 않는다.
    try {
      await fetch(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: session.refresh_token }).toString(),
      });
    } catch (e) {}
    await env.SESSIONS.delete(sessionKey(session_id));
  }
  return json({}, 200, cors);
}

/* ─── 헬퍼 ─── */

function sessionKey(sessionId) {
  return "session:" + sessionId;
}

async function readSession(sessionId, env) {
  const raw = await env.SESSIONS.get(sessionKey(sessionId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.refresh_token ? parsed : null;
  } catch (e) {
    return null;
  }
}

/* Google 토큰 엔드포인트 호출. 네트워크 오류만 throw하고, Google이 돌려준 에러는
   { ok:false, data } 로 넘겨서 호출부가 invalid_grant 여부를 판단하게 한다. */
async function postToGoogle(url, params) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  let data = null;
  try {
    data = await r.json();
  } catch (e) {}
  return { ok: r.ok, data: data || {} };
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin, env) {
  return !!origin && allowedOrigins(env).includes(origin);
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch (e) {
    return null;
  }
}

/* 허용된 오리진이면 그 값을 그대로 반사, 아니면 null(= 호출부가 403 처리). */
function corsHeaders(origin, env) {
  if (!isAllowedOrigin(origin, env)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

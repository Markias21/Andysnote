/* ─── ANDYSLETTER: SUPABASE API LAYER ──────────────────────────────────────
   The only file that talks to Supabase or to Google Identity Services for
   AndysLetter's own login. Every function here is data-in/data-out — no DOM
   access, no rendering (that's js/letter.js and its siblings). Mirrors the
   role js/drive.js plays for the Drive backend: low-level calls other
   AndysLetter files build on.

   AndysLetter's Supabase sign-in is entirely independent of the Google Drive
   sign-in in js/auth.js — driveAccessToken and letterSession never interact.
   A user can be signed into one, both, or neither. */

/* ─── CLIENT ─── */
function letterIsConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY && typeof window.supabase !== "undefined");
}

function letterInitClient() {
  if (letterSb) return letterSb;
  if (!letterIsConfigured()) return null;
  letterSb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storageKey: LETTER_SESSION_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return letterSb;
}

/* Restores any persisted session and subscribes to future auth changes.
   `onChange(event, session)` is called on every sign-in/out/token-refresh —
   js/letter.js decides what to re-render for which event. */
async function letterApiInitAuth(onChange) {
  const sb = letterInitClient();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  letterSession = data.session || null;
  sb.auth.onAuthStateChange((event, session) => {
    letterSession = session;
    if (typeof onChange === "function") onChange(event, session);
  });
  return letterSession;
}

/* ─── GOOGLE IDENTITY (ID token for supabase.auth.signInWithIdToken) ───────
   Deliberately separate from js/auth.js's google.accounts.oauth2 token
   client (that one gets a Drive *access* token; this one gets an OIDC *ID*
   token, which is what Supabase's Google provider needs). Both read
   window.GOOGLE_CLIENT_ID and both come from the same already-loaded GSI
   script (index.html), so no extra script tag is needed. */
let letterGoogleIdentityInited = false;
let letterGoogleCredentialResolve = null;

function letterEnsureGoogleIdentityInit() {
  if (letterGoogleIdentityInited) return true;
  if (typeof google === "undefined" || !google.accounts || !google.accounts.id) return false;
  if (!window.GOOGLE_CLIENT_ID) return false;
  google.accounts.id.initialize({
    client_id: window.GOOGLE_CLIENT_ID,
    callback: (response) => {
      if (letterGoogleCredentialResolve) {
        const resolve = letterGoogleCredentialResolve;
        letterGoogleCredentialResolve = null;
        resolve(response.credential);
      }
    },
  });
  letterGoogleIdentityInited = true;
  return true;
}

/* Renders the real Google Identity button into `container` and returns a
   Promise resolving to an ID token once the user picks an account (or never
   resolving if they don't — the caller just leaves the button showing).
   Returns null if GIS isn't loaded yet (e.g. the script tag is still
   in flight) so the caller can show a "try again in a moment" state. */
function letterRenderGoogleButton(container) {
  if (!letterEnsureGoogleIdentityInit()) return null;
  container.innerHTML = "";
  const promise = new Promise((resolve) => {
    letterGoogleCredentialResolve = resolve;
  });
  google.accounts.id.renderButton(container, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "continue_with",
    shape: "pill",
  });
  return promise;
}

async function letterApiSignInWithGoogleIdToken(idToken) {
  const sb = letterInitClient();
  const { data, error } = await sb.auth.signInWithIdToken({ provider: "google", token: idToken });
  if (error) throw error;
  letterSession = data.session;
  return data.session;
}

/* ─── EMAIL / PASSWORD ─── */
async function letterApiSignUpEmail(email, password) {
  const sb = letterInitClient();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function letterApiSignInEmail(email, password) {
  const sb = letterInitClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  letterSession = data.session;
  return data.session;
}

async function letterApiSignOut() {
  const sb = letterInitClient();
  if (sb) await sb.auth.signOut();
  letterSession = null;
  letterProfile = null;
  letterInbox = null;
  letterSent = null;
  letterContacts = null;
  letterAdminUsers = null;
}

/* ─── PROFILE (letter_users) ─── */
async function letterApiLoadProfile() {
  const sb = letterInitClient();
  if (!sb || !letterSession) {
    letterProfile = null;
    return null;
  }
  const { data, error } = await sb
    .from("letter_users")
    .select("*")
    .eq("id", letterSession.user.id)
    .maybeSingle();
  if (error) throw error;
  letterProfile = data || null;
  return letterProfile;
}

async function letterApiClaimPostcode(postcode, name) {
  const sb = letterInitClient();
  const { data, error } = await sb.rpc("letter_claim_postcode", {
    p_postcode: postcode,
    p_name: name,
  });
  if (error) throw error;
  letterProfile = data;
  return data;
}

/* ─── LETTERS ─── */
async function letterApiPostcodeExists(postcode) {
  const sb = letterInitClient();
  const { data, error } = await sb.rpc("letter_postcode_exists", { p_postcode: postcode });
  if (error) throw error;
  return !!data;
}

async function letterApiSend(fields) {
  const sb = letterInitClient();
  const { data, error } = await sb.rpc("letter_send", {
    p_to_postcode: fields.toPostcode,
    p_sender_name: fields.senderName,
    p_recipient_name: fields.recipientName,
    p_subject: fields.subject,
    p_body: fields.body,
    p_paper: fields.paperId,
    p_envelope: fields.envelopeColor,
    p_font: fields.fontId,
  });
  if (error) throw error;
  return data;
}

async function letterApiLoadInbox() {
  const sb = letterInitClient();
  const { data, error } = await sb
    .from("letters")
    .select("*")
    .eq("recipient_id", letterSession.user.id)
    .order("sent_at", { ascending: false });
  if (error) throw error;
  letterInbox = data || [];
  return letterInbox;
}

async function letterApiLoadSent() {
  const sb = letterInitClient();
  const { data, error } = await sb
    .from("letters")
    .select("*")
    .eq("sender_id", letterSession.user.id)
    .order("sent_at", { ascending: false });
  if (error) throw error;
  letterSent = data || [];
  return letterSent;
}

async function letterApiMarkRead(id) {
  const sb = letterInitClient();
  const { data, error } = await sb.rpc("letter_mark_read", { p_id: id });
  if (error) throw error;
  return data; // ISO timestamp string, or null if not yet read
}

/* Returns true if the letter was fully deleted (both sides had archived it). */
async function letterApiArchive(id) {
  const sb = letterInitClient();
  const { data, error } = await sb.rpc("letter_archive", { p_id: id });
  if (error) throw error;
  return !!data;
}

/* ─── CONTACTS (letter_contacts) — plain RLS-scoped CRUD, no RPC needed ─── */
async function letterApiLoadContacts() {
  const sb = letterInitClient();
  const { data, error } = await sb
    .from("letter_contacts")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  letterContacts = data || [];
  return letterContacts;
}

async function letterApiAddContact(name, postcode, memo) {
  const sb = letterInitClient();
  const { data, error } = await sb
    .from("letter_contacts")
    .insert({ owner_id: letterSession.user.id, name, postcode, memo: memo || "" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function letterApiDeleteContact(id) {
  const sb = letterInitClient();
  const { error } = await sb.from("letter_contacts").delete().eq("id", id);
  if (error) throw error;
}

/* ─── ADMIN (security-definer RPCs; throw FORBIDDEN for non-admins) ─── */
async function letterApiAdminListUsers() {
  const sb = letterInitClient();
  const { data, error } = await sb.rpc("letter_admin_list_users");
  if (error) throw error;
  letterAdminUsers = data || [];
  return letterAdminUsers;
}

async function letterApiAdminSetStatus(userId, status) {
  const sb = letterInitClient();
  const { data, error } = await sb.rpc("letter_admin_set_status", {
    p_user_id: userId,
    p_status: status,
  });
  if (error) throw error;
  return data;
}

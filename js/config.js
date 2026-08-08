/* ─── GOOGLE OAUTH ─── */
/* 👇 여기에만 Client ID를 붙여넣으세요 (Client Secret은 사용하지 않음) */
window.GOOGLE_CLIENT_ID =
  "214649048044-lq3pcovgq8lo09g0apguilj31m481uj6.apps.googleusercontent.com";

/* ─── DRIVE FILESYSTEM CONFIG ─── */
const DEV_MODE =
  location.hostname.endsWith(".github.dev") ||
  location.hostname === "localhost";
var ANDYSNOTE_ROOT_NAME = "AndysNote";
var FOLDER_MIME = "application/vnd.google-apps.folder";
var FILE_MIME = "text/plain";
var MARKDOWN_MIME = "text/markdown";
// Both extensions store the same thing: plain-text Markdown. Only the
// extension differs, so any Drive doc ending in either is a document.
var DOC_EXT_REGEX = /\.(txt|md)$/i;
var DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.profile";
// 같은 기기 재접속 시 재로그인 없이 이어서 쓰기 위해 access token을 캐싱하는 localStorage 키.
var DRIVE_TOKEN_STORAGE_KEY = "andysnote-drive-token";

function isDriveDocName(name) {
  return DOC_EXT_REGEX.test(name);
}

function stripDocExt(name) {
  return name.replace(DOC_EXT_REGEX, "");
}

/* ─── CREATED-DATE FILENAME SUFFIX (shared by Drive + local) ───────────────
   Neither the File System Access API (real local files) nor the Drive API
   (createdTime is server-managed, not user-editable) lets us store an
   arbitrary user-editable "created on" date as real metadata. So both
   backends encode it directly in the saved filename instead:
     "제목_20260707.txt"  →  title "제목", created 2026-07-07
   This is the ONE source of truth for created date whenever present; it's
   what makes the created-date editor (js/editor.js) actually persist an
   edit — editing the date just re-derives the filename via
   buildStoredName() and renames the underlying file/Drive doc. Docs saved
   before this existed (or dropped in externally) have no suffix; callers
   fall back to the backend's own real metadata (Drive's createdTime /
   a local file's lastModified) in that case. */
var CREATED_SUFFIX_REGEX = /_(\d{8})$/;

function formatCreatedSuffix(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `_${y}${m}${d}`;
}

/* name (with extension) -> { cleanTitle, createdDate }. createdDate is a
   Date at local midnight, or null if this name has no suffix (or an
   invalid one, e.g. hand-typed garbage that happens to match the shape). */
function parseCreatedFromName(name) {
  const base = stripDocExt(name);
  const m = base.match(CREATED_SUFFIX_REGEX);
  if (!m) return { cleanTitle: base, createdDate: null };
  const digits = m[1];
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(year, month - 1, day);
  const valid =
    !isNaN(date.getTime()) && date.getMonth() === month - 1 && date.getDate() === day;
  if (!valid) return { cleanTitle: base, createdDate: null };
  return { cleanTitle: base.slice(0, m.index), createdDate: date };
}

/* Strips characters real filesystems reject outright, plus trailing
   dots/spaces (illegal specifically on Windows) — applied to BOTH backends
   so a title behaves the same way whether it ends up as a real file or a
   Drive doc name. */
function sanitizeFileTitle(title) {
  const cleaned = String(title || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[. ]+$/, "")
    .trim();
  return cleaned || t("editor.titlePlaceholder");
}

/* The one place a saved filename gets assembled, whether the title changed,
   the created date changed, or a brand-new doc is being created — always
   rebuilds the full name from scratch rather than patching pieces of the
   old one. */
function buildStoredName(title, ext, date) {
  return sanitizeFileTitle(title) + formatCreatedSuffix(date) + ext;
}

/* ─── LOCAL (browser) STORE CONFIG ─── */
var LOCAL_DB_NAME = "andysnote-local";
var LOCAL_STORE = "notes";
var LOCAL_DB_VERSION = 2; // v2 adds LOCAL_HANDLES_STORE (persisted root directory handle)
var LOCAL_HANDLES_STORE = "handles";

/* ─── DRIVE CACHE CONFIG (IndexedDB performance layer) ─── */
var DRIVE_CACHE_DB_NAME = "andysnote-cache";
var CACHE_TREE_STORE = "treeChildren"; // per-folder direct children lists
var CACHE_DOC_STORE = "docContent"; // opened note bodies

/* ─── THEMES ───────────────────────────────────────────────────────────────
   Single source of truth for every theme id — js/settings.js's swatch grid
   and applySettings()'s validity check both read this list instead of
   hardcoding option counts, so adding a theme later means: one entry here,
   one :root[data-theme="id"] CSS block in index.html, two i18n strings.

   "mono" themes are pure CSS variables (index.html). "concept" themes are
   photo-backed (assets/themes/*.jpg) — swatch/bg are the same small
   thumbnail used both as the settings-panel preview and (at full size) as
   the theme's --bg photo. */
var THEME_LIST = [
  { id: "dark-black", group: "mono", labelKey: "settings.themeDark" },
  { id: "dark-gray", group: "mono", labelKey: "settings.themeGray" },
  { id: "dark-green", group: "mono", labelKey: "settings.themeGreen" },
  { id: "dark-indigo", group: "mono", labelKey: "settings.themeIndigo" },
  { id: "light-black", group: "mono", labelKey: "settings.themeLight" },
  { id: "light-gray", group: "mono", labelKey: "settings.themeLightGray" },
  { id: "light-green", group: "mono", labelKey: "settings.themeLightGreen" },
  { id: "light-indigo", group: "mono", labelKey: "settings.themeLightIndigo" },
  {
    id: "starrynight",
    group: "concept",
    labelKey: "settings.themeStarryNight",
    thumb: "assets/themes/starrynight-thumb.jpg",
  },
  {
    id: "lighthouse",
    group: "concept",
    labelKey: "settings.themeLighthouse",
    thumb: "assets/themes/lighthouse-thumb.jpg",
  },
  {
    id: "camping",
    group: "concept",
    labelKey: "settings.themeCamping",
    thumb: "assets/themes/camping-thumb.jpg",
  },
];
var DEFAULT_THEME_ID = "dark-black";

/* Tiny cosmetic lookup for the settings swatch grid preview (js/settings.js:
   renderThemeSwatchGrid) — bg/fg pairs must match each mono theme's
   --bg/--text in index.html's :root[data-theme="..."] blocks. Concept
   themes don't need an entry here; they preview via their `thumb` image. */
var THEME_SWATCH_COLORS = {
  "dark-black": { bg: "#141414", fg: "#e8e8e8" },
  "dark-gray": { bg: "#0e0e10", fg: "#e6e6e8" },
  "dark-green": { bg: "#070d08", fg: "#dbe8db" },
  "dark-indigo": { bg: "#090a14", fg: "#e2e3f2" },
  "light-black": { bg: "#ffffff", fg: "#202124" },
  "light-gray": { bg: "#f2f2f4", fg: "#202124" },
  "light-green": { bg: "#eef7ee", fg: "#17301a" },
  "light-indigo": { bg: "#eef0fb", fg: "#1c1f3d" },
};

/* ─── CALENDAR PLANNER (js/planner.js) ───────────────────────────────────
   "Calendar" is a reserved Drive folder name at the AndysNote root, holding
   only planner JSON (colors.json + one YYYY-MM.json per month) — never a
   real document folder. Kept out of the sidebar/folder pickers by every
   renderer filtering out plannerFolderId once resolved (see js/planner.js). */
var PLANNER_FOLDER_NAME = "Calendar";
var PLANNER_SLOT_MINUTES = 10; // single source for slot size -> minute math
var PLANNER_COLOR_IDS = ["c1", "c2", "c3", "c4", "c5"]; // default palette for brand-new users
// Color-mix range every planner color tone is picked from (% of --planner-anchor-b
// mixed into --planner-anchor-a — see applyPlannerColorVars() in js/planner.js).
// Kept off 0/100 so no tone ever becomes the literal bg or text color.
var PLANNER_COLOR_MIN_PERCENT = 22;
var PLANNER_COLOR_MAX_PERCENT = 86;
var PLANNER_DB_NAME = "andysnote-planner";
var PLANNER_DB_VERSION = 1;
var PLANNER_MONTHS_STORE = "months";
var PLANNER_META_STORE = "meta";

/* ─── ANDYSLETTER (js/letter.js, js/letter/*.js) ──────────────────────────
   AndysLetter is a third top-level view, sibling to Library/Calendar. It's
   the one feature that talks to a server other than Google's — Supabase is
   used purely as a mail-relay between users (see docs/supabase-schema.sql).
   A letter only becomes a real user document (.md, Source of Truth per
   docs/PRINCIPLE.md §4) once it's exported to Drive or a local note; while
   it sits in Supabase it's in-transit mail, not a saved document. */
var SUPABASE_URL = ""; // 👇 배포 전 Supabase 프로젝트 URL을 채워 넣으세요
var SUPABASE_ANON_KEY = ""; // 👇 anon(publishable) key — 공개되어도 되는 값입니다 (보안은 RLS가 담당)

// Reserved local/Drive folder name for exported letters. Unlike the
// planner's "Calendar" folder, this one is NOT hidden from the sidebar —
// an exported letter is meant to show up as a normal document.
var LETTER_FOLDER_NAME = "Letters";

var LETTER_POSTCODE_REGEX = /^[0-9]{5}$/;

// Letter paper designs — pure CSS (index.html .letter-paper-<id>), no image
// assets, so they follow every theme automatically. Order here is the
// order shown in the paper picker.
var LETTER_PAPERS = [
  { id: "plain", labelKey: "letter.paper.plain" },
  { id: "ruled", labelKey: "letter.paper.ruled" },
  { id: "manuscript", labelKey: "letter.paper.manuscript" },
  { id: "kraft", labelKey: "letter.paper.kraft" },
  { id: "romance", labelKey: "letter.paper.romance" },
  { id: "ornate", labelKey: "letter.paper.ornate" },
  { id: "night", labelKey: "letter.paper.night" },
  { id: "blossom", labelKey: "letter.paper.blossom" },
];
var DEFAULT_LETTER_PAPER = "plain";

// Envelope colors shown in the inbox/sent list as the envelope card background.
var LETTER_ENVELOPES = [
  { id: "cream", labelKey: "letter.envelope.cream" },
  { id: "white", labelKey: "letter.envelope.white" },
  { id: "kraft", labelKey: "letter.envelope.kraft" },
  { id: "rose", labelKey: "letter.envelope.rose" },
  { id: "sky", labelKey: "letter.envelope.sky" },
  { id: "sage", labelKey: "letter.envelope.sage" },
  { id: "lavender", labelKey: "letter.envelope.lavender" },
  { id: "charcoal", labelKey: "letter.envelope.charcoal" },
];
var DEFAULT_LETTER_ENVELOPE = "cream";

// localStorage key for the Supabase session (mirrors DRIVE_TOKEN_STORAGE_KEY's
// role for Drive — lets AndysLetter restore its own login independently of
// the Google Drive sign-in above it).
var LETTER_SESSION_STORAGE_KEY = "andysnote-letter-session";

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
var PLANNER_COLOR_IDS = ["c1", "c2", "c3", "c4", "c5"];
var PLANNER_DB_NAME = "andysnote-planner";
var PLANNER_DB_VERSION = 1;
var PLANNER_MONTHS_STORE = "months";
var PLANNER_META_STORE = "meta";

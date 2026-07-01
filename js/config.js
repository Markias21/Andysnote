/* ─── GOOGLE OAUTH ─── */
/* 👇 여기에만 Client ID를 붙여넣으세요 (Client Secret은 사용하지 않음) */
window.GOOGLE_CLIENT_ID =
  "214649048044-lq3pcovgq8lo09g0apguilj31m481uj6.apps.googleusercontent.com";

/* ─── DRIVE FILESYSTEM CONFIG ─── */
const DEV_MODE =
  location.hostname.endsWith(".github.dev") ||
  location.hostname === "localhost";
var WRITER_ROOT_NAME = "Writer";
var FOLDER_MIME = "application/vnd.google-apps.folder";
var FILE_MIME = "text/plain";
var DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.profile";

/* ─── LOCAL (browser) STORE CONFIG ─── */
var LOCAL_DB_NAME = "andysnotes-local";
var LOCAL_STORE = "notes";

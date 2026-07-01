/* ─── DRIVE FILESYSTEM CONFIG ─── */
const DEV_MODE =
  location.hostname.endsWith(".github.dev") ||
  location.hostname === "localhost";
var WRITER_ROOT_NAME = "Writer";
var FOLDER_MIME = "application/vnd.google-apps.folder";
var FILE_MIME = "text/plain";
var DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.profile";

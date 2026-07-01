/* ─── SETTINGS ───────────────────────────────────────────────────────────
   One app-wide settings object (declared as `appSettings` in state.js).
   Groups: UI / Font / Behavior. Font is a single editor-wide choice.
   The UI never mutates settings directly — it only calls setSetting().
   Expand later by adding fields to defaultSettings() + the list in
   renderSettings(); no structural split needed. */

/* ── Font registry ──
   All editor fonts are registered in one place.
   Key = stored value (what goes into localStorage / settings.font.editor).
   Stack = CSS font-family token that the browser can resolve.
   Preview = short sample text shown next to the font name in Settings.
   Each entry carries a category so the Settings UI can group them.

   Fonts are loaded once via CDN <link> tags in index.html.
   Never duplicate font loading logic — the CDN links are global. */
const EDITOR_FONTS = {
  "pretendard":  { stack: "Pretendard",                 category: "clean",    preview: "Pretendard ┌──────" },
  "noto-sans":   { stack: "\"Noto Sans KR\"",           category: "clean",    preview: "가가가가 Noto" },
  "inter":       { stack: "Inter",                      category: "clean",    preview: "Inter abc" },
  /* Gmarket Sans is not available on a reliable free CDN. Add via custom
     @font-face if you have the font files, then register here with stack
     "GmarketSans". */
  "cookierun":   { stack: "\"Jua\"",                    category: "cute",     preview: "가가가가 CookieRun" },
  "nanum-pen":   { stack: "\"Nanum Pen Script\"",       category: "cute",     preview: "가가가가 Pen" },
  "noto-serif":  { stack: "\"Noto Serif KR\"",          category: "serif",    preview: "가가가가 Serif" },
  "nanum-myeongjo": { stack: "\"Nanum Myeongjo\"",      category: "serif",    preview: "가가가가 Myeongjo" },
  "kopub":       { stack: "\"Gowun Batang\"",           category: "serif",    preview: "가가가가 KoPub" },
  "jetbrains":   { stack: "\"JetBrains Mono\"",         category: "mono",     preview: "JetBrains Mono" },
  "fira":        { stack: "\"Fira Code\"",              category: "mono",     preview: "Fira Code" },
  "ibm-plex":    { stack: "\"IBM Plex Mono\"",          category: "mono",     preview: "IBM Plex Mono" },
  "system":      { stack: "system-ui",                  category: "clean",    preview: "System abc" },
};

/* Category labels for the Settings grouped dropdown. */
const FONT_CATEGORIES = {
  clean: "Clean / Default UI",
  cute:  "Cute / Friendly",
  serif: "Serif / Document",
  mono:  "Code / Technical",
};

/* The single source of truth for shape + defaults. */
function defaultSettings() {
  return {
    ui: {
      indentMode: true,   // indent mode: visual paragraph indentation on #doc-body
      compactMode: false,   // denser layout
    },
    font: {
      editor: "pretendard", // key into EDITOR_FONTS
    },
    behavior: {
      autoSave: true,   // debounced autosave on edits
      driveSync: true,  // push Drive docs to Google Drive automatically
    },
  };
}

/* Merge saved values over defaults, one level per group, so new fields added
   to defaults later still appear even for users with older saved settings. */
function mergeSettings(defaults, saved) {
  if (!saved || typeof saved !== "object") return defaults;
  const out = {};
  for (const group of Object.keys(defaults)) {
    const savedGroup =
      saved[group] && typeof saved[group] === "object" ? saved[group] : {};
    out[group] = Object.assign({}, defaults[group], savedGroup);
  }
  return out;
}

/* Load from localStorage (falling back to defaults) and apply once. */
function initSettings() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("andysnote-settings") || "null");
  } catch (e) {
    saved = null;
  }
  appSettings = mergeSettings(defaultSettings(), saved);
  applySettings();
}

function saveSettings() {
  try {
    localStorage.setItem("andysnote-settings", JSON.stringify(appSettings));
  } catch (e) {
    /* ignore quota / privacy-mode errors */
  }
}

/* Read a setting by dotted path, e.g. getSetting("font.editor"). */
function getSetting(path) {
  if (!appSettings) initSettings();
  const parts = path.split(".");
  let cur = appSettings;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/* The ONLY way the UI changes settings. e.g. setSetting("ui.compactMode", true). */
function setSetting(path, value) {
  if (!appSettings) initSettings();
  const parts = path.split(".");
  let cur = appSettings;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object")
      cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  saveSettings();
  applySettings();

  // Disabling autosave/sync must take effect immediately: cancel any save
  // already queued on a debounce timer before the toggle flipped.
  if (!appSettings.behavior.autoSave) {
    clearTimeout(localSaveTimer);
    localSaveTimer = null;
    clearTimeout(driveSaveTimer);
    driveSaveTimer = null;
  } else if (!appSettings.behavior.driveSync) {
    clearTimeout(driveSaveTimer);
    driveSaveTimer = null;
  }
}

/* Reflect the current settings into the live DOM (fonts, view modes).
   The font stack is injected into --editor-font. The CSS in index.html
   already appends `system-ui, sans-serif` after the variable:
     font-family: var(--editor-font), system-ui, sans-serif;
   So the stack here only needs the primary + any essential fallbacks.
   (For web fonts we rely on the CDN link; for system fonts we keep the
   token minimal and let the CSS fallback do the rest.) */
function applySettings() {
  if (!appSettings) return;

  const meta = EDITOR_FONTS[appSettings.font.editor];
  const stack = meta ? meta.stack : "system-ui";

  document.documentElement.style.setProperty("--editor-font", stack);

  const body = document.getElementById("doc-body");
  if (body) body.classList.toggle("indent-mode", !!appSettings.ui.indentMode);

  document.body.classList.toggle("compact", !!appSettings.ui.compactMode);
}

/* ─── SETTINGS PANEL (simple list, no tabs) ─── */

function openSettings() {
  renderSettings();
  document.getElementById("settings-overlay").classList.add("open");
}

function closeSettings() {
  const overlay = document.getElementById("settings-overlay");
  if (overlay) overlay.classList.remove("open");
}

function closeSettingsOutside(e) {
  if (e.target === document.getElementById("settings-overlay")) closeSettings();
}

function renderSettings() {
  const groups = [
    {
      title: "UI",
      fields: [
        { path: "ui.indentMode",    label: "Indent mode",    type: "bool" },
        { path: "ui.compactMode",   label: "Compact mode",   type: "bool" },
      ],
    },
    {
      title: "Font",
      fields: [
        {
          path: "font.editor",
          label: "Editor font",
          type: "font-select",
          // grouped by category; each option carries preview text
          options: buildFontOptions(),
        },
      ],
    },
    {
      title: "Behavior",
      fields: [
        { path: "behavior.autoSave",  label: "Auto save",   type: "bool" },
        { path: "behavior.driveSync", label: "Drive sync",  type: "bool" },
      ],
    },
  ];

  let html = "";
  for (const g of groups) {
    html += '<div class="settings-group">';
    html += '<div class="settings-group-title">' + g.title + "</div>";
    for (const field of g.fields) {
      const val = getSetting(field.path);
      let control = "";
      if (field.type === "bool") {
        control =
          '<label class="switch"><input type="checkbox" ' +
          (val ? "checked" : "") +
          " onchange=\"setSetting('" +
          field.path +
          "', this.checked)\"><span class=\"slider\"></span></label>";
      } else if (field.type === "select") {
        control =
          '<select class="settings-select" onchange="setSetting(\'' +
          field.path +
          "', this.value)\">";
        for (const opt of field.options) {
          const optVal   = typeof opt === "object" ? opt.value : opt;
          const optLabel = typeof opt === "object" ? opt.label : opt;
          control +=
            '<option value="' +
            optVal +
            '"' +
            (optVal === val ? " selected" : "") +
            ">" +
            optLabel +
            "</option>";
        }
        control += "</select>";
      } else if (field.type === "font-select") {
        control = renderFontSelect(field.path, val, field.options);
      }
      html +=
        '<div class="settings-row"><span class="settings-label">' +
        field.label +
        "</span>" +
        control +
        "</div>";
    }
    html += "</div>";
  }
  document.getElementById("settings-body").innerHTML = html;
}

/* Build grouped font options from EDITOR_FONTS registry.
   Returns [{ label, value, preview, category }, ...] sorted by category order. */
function buildFontOptions() {
  const order = ["clean", "cute", "serif", "mono"];
  const items = [];
  for (const key of Object.keys(EDITOR_FONTS)) {
    const f = EDITOR_FONTS[key];
    items.push({
      value: key,
      label: key.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      preview: f.preview,
      category: f.category,
    });
  }
  items.sort((a, b) => {
    const oa = order.indexOf(a.category);
    const ob = order.indexOf(b.category);
    if (oa !== ob) return oa - ob;
    return a.label.localeCompare(b.label);
  });
  return items;
}

/* Render a grouped font select with inline preview text.
   Uses a native <select> with <optgroup> for categories.
   The preview text is rendered as part of the option label. */
function renderFontSelect(path, currentValue, options) {
  let html = '<select class="settings-select" onchange="setSetting(\'' +
    path + "', this.value)\">";

  let currentGroup = null;
  for (const opt of options) {
    if (opt.category !== currentGroup) {
      if (currentGroup !== null) html += "</optgroup>";
      currentGroup = opt.category;
      const groupLabel = FONT_CATEGORIES[currentGroup] || currentGroup;
      html += '<optgroup label="' + escapeHtml(groupLabel) + '">';
    }
    const label = escapeHtml(opt.label) + " — " + escapeHtml(opt.preview);
    html += '<option value="' + escapeHtml(opt.value) + '"' +
      (opt.value === currentValue ? " selected" : "") +
      ' style="font-family:' + escapeHtml(EDITOR_FONTS[opt.value].stack) + ',sans-serif"' +
      ">" + label + "</option>";
  }
  if (currentGroup !== null) html += "</optgroup>";
  html += "</select>";
  return html;
}

/* Minimal HTML escape for option labels / values. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

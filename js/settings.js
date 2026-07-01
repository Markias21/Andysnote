/* ─── SETTINGS ───────────────────────────────────────────────────────────
   One app-wide settings object (declared as `appSettings` in state.js).
   Groups: UI / Font / Behavior. Font is a single editor-wide choice.
   The UI never mutates settings directly — it only calls setSetting().
   Expand later by adding fields to defaultSettings() + the list in
   renderSettings(); no structural split needed. */

/* The single source of truth for shape + defaults. */
function defaultSettings() {
  return {
    ui: {
      indentMode: true, // indent mode: visual paragraph indentation on #doc-body
      compactMode: false,  // denser layout
    },
    font: {
      editor: "system", // key into EDITOR_FONTS map
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
   A single editor font key is resolved to a CSS font-family stack.
   All text elements use the same variable --editor-font.
   Every stack ends with system-ui, sans-serif per the fallback rule. */
function applySettings() {
  if (!appSettings) return;

  // Editor font key → CSS font-family stack.
  // Add new entries here to extend the font list; no other code changes needed.
  const EDITOR_FONTS = {
    "system":         "system-ui, -apple-system, sans-serif",
    "sans-serif":     "Inter, system-ui, sans-serif",
    "serif":          "Georgia, \"Times New Roman\", system-ui, sans-serif",
    "monospace":      "\"Courier New\", Courier, system-ui, sans-serif",
    "nanum-gothic":   "NanumGothic, system-ui, sans-serif",
    "nanum-myeongjo": "NanumMyeongjo, system-ui, sans-serif",
    "gungsuh":        "\uad81\uc11c, GungsuhChe, system-ui, sans-serif",
    "dotum":          "\ub3cb\uc6c0, AppleGothic, system-ui, sans-serif",
    "pretendard":     "Pretendard, system-ui, sans-serif",
  };

  const root = document.documentElement;
  const stack = EDITOR_FONTS[appSettings.font.editor]
    || "system-ui, sans-serif";

  root.style.setProperty("--editor-font", stack);

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
        { path: "ui.indentMode", label: "Indent mode", type: "bool" },
        { path: "ui.compactMode",   label: "Compact mode",      type: "bool" },
      ],
    },
    {
      title: "Font",
      fields: [
        {
          path: "font.editor",
          label: "Editor font",
          type: "select",
          // Extend this list to add more fonts; add matching entry to
          // EDITOR_FONTS in applySettings() with the same key and a CSS stack.
          options: [
            { value: "system",         label: "System" },
            { value: "sans-serif",     label: "Sans-serif" },
            { value: "serif",          label: "Serif" },
            { value: "monospace",      label: "Monospace" },
            { value: "nanum-gothic",   label: "\ub098\ub214\uace0\ub515 (Nanum Gothic)" },
            { value: "nanum-myeongjo", label: "\ub098\ub214\uba85\uc870 (Nanum Myeongjo)" },
            { value: "gungsuh",        label: "\uad81\uc11c" },
            { value: "dotum",          label: "\ub3cb\uc6c0" },
            { value: "pretendard",     label: "Pretendard" },
          ],
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
          // options may be {value, label} objects or plain strings
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

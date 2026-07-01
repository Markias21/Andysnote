/* ─── SETTINGS ───────────────────────────────────────────────────────────
   One app-wide settings object (declared as `appSettings` in state.js).
   Start simple: a single object with 3 groups (UI / Font / Behavior).
   The UI never mutates settings directly — it only calls setSetting().
   Expand later by adding fields to defaultSettings() + the list in
   renderSettings(); no structural split needed. */

/* The single source of truth for shape + defaults. */
function defaultSettings() {
  return {
    ui: {
      paragraphMode: true, // paragraph-spacing view on #doc-body
      compactMode: false, // denser layout
    },
    font: {
      title: "Inter",
      body: "Lora",
      korean: "Apple SD Gothic Neo",
      english: "Inter",
    },
    behavior: {
      autoSave: true, // debounced autosave on edits
      driveSync: true, // push Drive docs to Google Drive automatically
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

/* Read a setting by dotted path, e.g. getSetting("font.body"). */
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

/* Keep only characters valid in a CSS font-family token so a hand-edited
   localStorage value can't inject arbitrary CSS through the custom property. */
function sanitizeFont(name) {
  return String(name || "").replace(/[^a-zA-Z0-9 \-]/g, "").trim();
}

/* Reflect the current settings into the live DOM (fonts, view modes). */
function applySettings() {
  if (!appSettings) return;
  const root = document.documentElement;
  const f = appSettings.font;
  const eng = sanitizeFont(f.english);
  const kor = sanitizeFont(f.korean);
  root.style.setProperty(
    "--font-content",
    `"${sanitizeFont(f.body)}", "${eng}", "${kor}", Georgia, serif`,
  );
  root.style.setProperty(
    "--font-title",
    `"${sanitizeFont(f.title)}", "${eng}", "${kor}", "Inter", sans-serif`,
  );

  const body = document.getElementById("doc-body");
  if (body) body.classList.toggle("paragraph-view", !!appSettings.ui.paragraphMode);
  const pBtn = document.getElementById("btn-paragraph-view");
  if (pBtn) pBtn.classList.toggle("active", !!appSettings.ui.paragraphMode);

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
        { path: "ui.paragraphMode", label: "Paragraph spacing", type: "bool" },
        { path: "ui.compactMode", label: "Compact mode", type: "bool" },
      ],
    },
    {
      title: "Font",
      fields: [
        {
          path: "font.title",
          label: "Title font",
          type: "select",
          options: ["Inter", "Lora", "Georgia", "system-ui"],
        },
        {
          path: "font.body",
          label: "Body font",
          type: "select",
          options: ["Lora", "Georgia", "Inter", "system-ui"],
        },
        {
          path: "font.korean",
          label: "Korean font",
          type: "select",
          options: [
            "Apple SD Gothic Neo",
            "Malgun Gothic",
            "Noto Sans KR",
            "sans-serif",
          ],
        },
        {
          path: "font.english",
          label: "English font",
          type: "select",
          options: ["Inter", "Georgia", "Arial", "Times New Roman"],
        },
      ],
    },
    {
      title: "Behavior",
      fields: [
        { path: "behavior.autoSave", label: "Auto save", type: "bool" },
        { path: "behavior.driveSync", label: "Drive sync", type: "bool" },
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
          control +=
            '<option value="' +
            opt +
            '"' +
            (opt === val ? " selected" : "") +
            ">" +
            opt +
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

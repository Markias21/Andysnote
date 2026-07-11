/* ─── SETTINGS ───────────────────────────────────────────────────────────
   One app-wide settings object (declared as `appSettings` in state.js).
   The panel is tabbed (Library / Fonts / Calendar / ...) — see
   settingsTabs() below. The UI never mutates settings directly — it only
   calls setSetting(). Expand later by adding fields to defaultSettings()
   and to the relevant tab's groups in settingsTabs(); add a whole new tab
   by adding one entry there. */

/* ── Font registry ──
   All fonts (Korean and English/Latin alike) are registered in one place.
   Key = stored value (what goes into localStorage / settings.font.korean or
         settings.font.english).
   Stack = CSS font-family token that the browser can resolve.
   Preview = short sample text shown next to the font name in Settings.
   Category = one of the 3 style buckets (cute / handwriting / formal).
   Langs = which font pickers this entry can appear in — many of these fonts
           (nearly everything Korean-capable) also cover Latin glyphs fine,
           so they're tagged for both rather than duplicated as two entries.

   Korean and English are two independent settings (font.korean / .english),
   applied as two separate CSS variables layered into one font-family stack
   (English first, then Korean, then a system fallback) — the browser's
   normal per-character font-family fallback then does the actual splitting:
   Latin text resolves against the English font, and any Hangul it doesn't
   cover falls through to the Korean font. See applySettings() below.

   Fonts are loaded once via CDN <link> tags in index.html.
   Never duplicate font loading logic — the CDN links are global. */
const EDITOR_FONTS = {
  /* ── Cute / Rounded ── */
  jua: { stack: '"Jua"', category: "cute", langs: ["kr", "en"], preview: "안녕 Jua" , enStack: '"Jua-en"' },
  "do-hyeon": { stack: '"Do Hyeon"', category: "cute", langs: ["kr", "en"], preview: "안녕 Do Hyeon" , enStack: '"Do Hyeon-en"' },
  gaegu: { stack: '"Gaegu"', category: "cute", langs: ["kr", "en"], preview: "안녕 Gaegu" , enStack: '"Gaegu-en"' },
  "gamja-flower": { stack: '"Gamja Flower"', category: "cute", langs: ["kr", "en"], preview: "안녕 Gamja Flower" , enStack: '"Gamja Flower-en"' },
  "hi-melody": { stack: '"Hi Melody"', category: "cute", langs: ["kr", "en"], preview: "안녕 Hi Melody" , enStack: '"Hi Melody-en"' },
  "poor-story": { stack: '"Poor Story"', category: "cute", langs: ["kr", "en"], preview: "안녕 Poor Story" , enStack: '"Poor Story-en"' },
  dongle: { stack: '"Dongle"', category: "cute", langs: ["kr", "en"], preview: "안녕 Dongle" , enStack: '"Dongle-en"' },
  "single-day": { stack: '"Single Day"', category: "cute", langs: ["kr", "en"], preview: "안녕 Single Day" , enStack: '"Single Day-en"' },
  "kirang-haerang": { stack: '"Kirang Haerang"', category: "cute", langs: ["kr", "en"], preview: "안녕 Kirang Haerang" , enStack: '"Kirang Haerang-en"' },
  "east-sea-dokdo": { stack: '"East Sea Dokdo"', category: "cute", langs: ["kr", "en"], preview: "안녕 East Sea Dokdo" , enStack: '"East Sea Dokdo-en"' },
  fredoka: { stack: '"Fredoka"', category: "cute", langs: ["en"], preview: "Fredoka abc" },
  "baloo-2": { stack: '"Baloo 2"', category: "cute", langs: ["en"], preview: "Baloo 2 abc" },
  comfortaa: { stack: '"Comfortaa"', category: "cute", langs: ["en"], preview: "Comfortaa abc" },
  quicksand: { stack: '"Quicksand"', category: "cute", langs: ["en"], preview: "Quicksand abc" },
  "varela-round": { stack: '"Varela Round"', category: "cute", langs: ["en"], preview: "Varela Round abc" },
  nunito: { stack: '"Nunito"', category: "cute", langs: ["en"], preview: "Nunito abc" },
  chewy: { stack: '"Chewy"', category: "cute", langs: ["en"], preview: "Chewy abc" },
  "patrick-hand": { stack: '"Patrick Hand"', category: "cute", langs: ["en"], preview: "Patrick Hand abc" },

  /* ── Mature Handwriting ── */
  "nanum-pen-script": { stack: '"Nanum Pen Script"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 Nanum Pen" , enStack: '"Nanum Pen Script-en"' },
  "nanum-brush-script": { stack: '"Nanum Brush Script"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 Nanum Brush" , enStack: '"Nanum Brush Script-en"' },
  "yeon-sung": { stack: '"Yeon Sung"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 Yeon Sung" , enStack: '"Yeon Sung-en"' },
  "song-myung": { stack: '"Song Myung"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 Song Myung" , enStack: '"Song Myung-en"' },
  "dancing-script": { stack: '"Dancing Script"', category: "handwriting", langs: ["en"], preview: "Dancing Script abc" },
  sacramento: { stack: '"Sacramento"', category: "handwriting", langs: ["en"], preview: "Sacramento abc" },
  "great-vibes": { stack: '"Great Vibes"', category: "handwriting", langs: ["en"], preview: "Great Vibes abc" },
  "alex-brush": { stack: '"Alex Brush"', category: "handwriting", langs: ["en"], preview: "Alex Brush abc" },
  allura: { stack: '"Allura"', category: "handwriting", langs: ["en"], preview: "Allura abc" },
  parisienne: { stack: '"Parisienne"', category: "handwriting", langs: ["en"], preview: "Parisienne abc" },
  "marck-script": { stack: '"Marck Script"', category: "handwriting", langs: ["en"], preview: "Marck Script abc" },
  "petit-formal-script": { stack: '"Petit Formal Script"', category: "handwriting", langs: ["en"], preview: "Petit Formal Script abc" },
  "league-script": { stack: '"League Script"', category: "handwriting", langs: ["en"], preview: "League Script abc" },
  "pinyon-script": { stack: '"Pinyon Script"', category: "handwriting", langs: ["en"], preview: "Pinyon Script abc" },
  /* Naver Clova "나눔손글씨" (Nanum Handwriting) — self-hosted, see
     fonts/nanum-handwriting/nanum-handwriting.css. All 18 confirmed to cover
     full Latin (checked their cmap), so all are dual kr/en. */
  "nanum-garamyeonggot": { stack: '"NanumGaRamYeonGgoc"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 가람연꽃", label: "가람연꽃" , enStack: '"NanumGaRamYeonGgoc-en"' },
  "nanum-gangbujangnimce": { stack: '"NanumGangBuJangNimCe"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 강부장님체", label: "강부장님체" , enStack: '"NanumGangBuJangNimCe-en"' },
  "nanum-godiganigoding": { stack: '"NanumGoDigANiGoGoDing"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 고딕 아니고 고딩", label: "고딕 아니고 고딩" , enStack: '"NanumGoDigANiGoGoDing-en"' },
  "nanum-gomsince": { stack: '"NanumGomSinCe"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 곰신체", label: "곰신체" , enStack: '"NanumGomSinCe-en"' },
  "nanum-gyurieuirgi": { stack: '"NanumGyuRiEuiIrGi"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 규리의 일기", label: "규리의 일기" , enStack: '"NanumGyuRiEuiIrGi-en"' },
  "nanum-gibbeumbarkeum": { stack: '"NanumGiBbeumBarkEum"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 기쁨밝음", label: "기쁨밝음" , enStack: '"NanumGiBbeumBarkEum-en"' },
  "nanum-namujeongwon": { stack: '"NanumNaMuJeongWeon"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 나무정원", label: "나무정원" , enStack: '"NanumNaMuJeongWeon-en"' },
  "nanum-ddaregeeommaga": { stack: '"NanumDdarEGeEomMaGa"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 딸에게 엄마가", label: "딸에게 엄마가" , enStack: '"NanumDdarEGeEomMaGa-en"' },
  "nanum-bujangnimnunchice": { stack: '"NanumBuJangNimNunCiCe"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 부장님 눈치체", label: "부장님 눈치체" , enStack: '"NanumBuJangNimNunCiCe-en"' },
  "nanum-saranghaeadeul": { stack: '"NanumSaRangHaeADeur"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 사랑해 아들", label: "사랑해 아들" , enStack: '"NanumSaRangHaeADeur-en"' },
  "nanum-ogbice": { stack: '"NanumOgBiCe"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 옥비체", label: "옥비체" , enStack: '"NanumOgBiCe-en"' },
  "nanum-oeharmeonigeulssi": { stack: '"NanumOeHarMeoNiGeurSsi"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 외할머니글씨", label: "외할머니글씨" , enStack: '"NanumOeHarMeoNiGeurSsi-en"' },
  "nanum-jeongeunce": { stack: '"NanumJeongEunCe"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 정은체", label: "정은체" , enStack: '"NanumJeongEunCe-en"' },
  "nanum-cheolpilgeulssi": { stack: '"NanumCeorPirGeurSsi"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 철필글씨", label: "철필글씨" , enStack: '"NanumCeorPirGeurSsi-en"' },
  "nanum-haengbokhandobi": { stack: '"NanumHaengBogHanDoBi"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 행복한 도비", label: "행복한 도비" , enStack: '"NanumHaengBogHanDoBi-en"' },
  "nanum-huingorisuri": { stack: '"NanumHeuinGgoRiSuRi"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 흰꼬리수리", label: "흰꼬리수리" , enStack: '"NanumHeuinGgoRiSuRi-en"' },
  "nanum-hyeokice": { stack: '"NanumHyeogICe"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 혁이체", label: "혁이체" , enStack: '"NanumHyeogICe-en"' },
  "nanum-harabeojieuinanum": { stack: '"NanumHarABeoJiEuiNaNum"', category: "handwriting", langs: ["kr", "en"], preview: "안녕 할아버지의나눔", label: "할아버지의나눔" , enStack: '"NanumHarABeoJiEuiNaNum-en"' },

  /* ── Serif & Gothic (Document) ── */
  pretendard: { stack: "Pretendard", category: "formal", langs: ["kr", "en"], preview: "안녕 Pretendard" , enStack: '"Pretendard-en"' },
  "noto-sans-kr": { stack: '"Noto Sans KR"', category: "formal", langs: ["kr", "en"], preview: "안녕 Noto Sans", label: "Noto Sans KR" , enStack: '"Noto Sans KR-en"' },
  "noto-serif-kr": { stack: '"Noto Serif KR"', category: "formal", langs: ["kr", "en"], preview: "안녕 Noto Serif", label: "Noto Serif KR" , enStack: '"Noto Serif KR-en"' },
  "nanum-gothic": { stack: '"Nanum Gothic"', category: "formal", langs: ["kr", "en"], preview: "안녕 Nanum Gothic" , enStack: '"Nanum Gothic-en"' },
  "nanum-myeongjo": { stack: '"Nanum Myeongjo"', category: "formal", langs: ["kr", "en"], preview: "안녕 Nanum Myeongjo" , enStack: '"Nanum Myeongjo-en"' },
  "gowun-batang": { stack: '"Gowun Batang"', category: "formal", langs: ["kr", "en"], preview: "안녕 Gowun Batang" , enStack: '"Gowun Batang-en"' },
  "gowun-dodum": { stack: '"Gowun Dodum"', category: "formal", langs: ["kr", "en"], preview: "안녕 Gowun Dodum" , enStack: '"Gowun Dodum-en"' },
  "ibm-plex-sans-kr": { stack: '"IBM Plex Sans KR"', category: "formal", langs: ["kr", "en"], preview: "안녕 IBM Plex", label: "IBM Plex Sans KR" , enStack: '"IBM Plex Sans KR-en"' },
  stylish: { stack: '"Stylish"', category: "formal", langs: ["kr", "en"], preview: "안녕 Stylish" , enStack: '"Stylish-en"' },
  sunflower: { stack: '"Sunflower"', category: "formal", langs: ["kr", "en"], preview: "안녕 Sunflower" , enStack: '"Sunflower-en"' },
  inter: { stack: "Inter", category: "formal", langs: ["en"], preview: "Inter abc" },
  arimo: { stack: '"Arimo"', category: "formal", langs: ["en"], preview: "Arimo abc" },
  tinos: { stack: '"Tinos"', category: "formal", langs: ["en"], preview: "Tinos abc" },
  merriweather: { stack: '"Merriweather"', category: "formal", langs: ["en"], preview: "Merriweather abc" },
  lora: { stack: '"Lora"', category: "formal", langs: ["en"], preview: "Lora abc" },
  "pt-serif": { stack: '"PT Serif"', category: "formal", langs: ["en"], preview: "PT Serif abc", label: "PT Serif" },
  roboto: { stack: '"Roboto"', category: "formal", langs: ["en"], preview: "Roboto abc" },
  "eb-garamond": { stack: '"EB Garamond"', category: "formal", langs: ["en"], preview: "EB Garamond abc", label: "EB Garamond" },
};

/* Category labels for the Settings grouped dropdown, in display order.
   A function (not a plain object) so it re-reads the current language each
   call instead of freezing whatever language was active when the script
   first parsed. */
function fontCategoryLabel(category) {
  return (
    {
      cute: t("fontCat.cute"),
      handwriting: t("fontCat.handwriting"),
      formal: t("fontCat.formal"),
    }[category] || category
  );
}

/* The single source of truth for shape + defaults. */
function defaultSettings() {
  return {
    ui: {
      theme: DEFAULT_THEME_ID, // see THEME_LIST in config.js
      language: "en", // "en" | "ko" — app UI language, see js/i18n.js
      indentMode: true, // .txt only: new paragraphs (Enter) start with a one-space indent
      compactMode: false, // denser layout
    },
    font: {
      korean: "pretendard", // key into EDITOR_FONTS — must support langs:["kr"]
      english: "inter", // key into EDITOR_FONTS — must support langs:["en"]
      size: 17, // #doc-body / #doc-body-rich font-size in px, see --editor-font-size
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

/* Read a setting by dotted path, e.g. getSetting("font.korean"). */
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
  if (path === "ui.indentMode") editorRefreshIndentDisplay();
  if (path === "ui.language") refreshUiLanguage();

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

/* Reflect the current settings into the live DOM (theme, fonts, view modes).
   Korean and English fonts are independent settings, injected into two CSS
   variables. The CSS in index.html layers them into one stack, English
   first then Korean, then a system fallback:
     font-family: var(--editor-font-en), var(--editor-font-kr), system-ui, sans-serif;
   The browser's normal per-character font fallback then does the actual
   split: Latin glyphs resolve against the English font, and any Hangul it
   doesn't cover falls through to the Korean font.

   That split only works if the English-slot font truly has no Hangul
   glyphs. Many registered fonts are dual (Korean-capable fonts almost
   always ship full Latin coverage too), so if one of THOSE is chosen for
   English, plain font-family fallback would let it win for Hangul as well
   (it's listed first) — silently overriding whatever was picked as the
   Korean font. enStack is a unicode-range-restricted, Latin-only alias
   registered for every dual font (see fonts/lang-slot-fallback.css) — using
   it instead of stack for the English slot guarantees it can only ever
   render Latin/punctuation, so Hangul always falls through to the Korean
   slot's font as intended. Non-dual fonts have no enStack and just use
   their normal stack.

   Indent mode isn't applied here — the leading space is never part of the
   saved text, only ever added to the live <textarea> display and stripped
   again on save (see js/editor/engine.js: indentModeActive/applyIndentText/
   stripIndentText, and editorRefreshIndentDisplay for the live-toggle case
   handled by setSetting() below). This function only needs to know the
   setting exists to expose it in the panel via getSetting(). */
function applySettings() {
  if (!appSettings) return;

  // "dark"/"light" are the pre-swatch-grid ids (still readable from old
  // localStorage saves) — map them to their "black" hue equivalent, then
  // fall back to the default for anything else unrecognized (a theme that
  // was since removed, or corrupted storage).
  const legacyThemeMap = { dark: "dark-black", light: "light-black" };
  const requestedTheme = legacyThemeMap[appSettings.ui.theme] || appSettings.ui.theme;
  appSettings.ui.theme = THEME_LIST.some((t) => t.id === requestedTheme)
    ? requestedTheme
    : DEFAULT_THEME_ID;
  document.documentElement.dataset.theme = appSettings.ui.theme;

  const krMeta = EDITOR_FONTS[appSettings.font.korean];
  const enMeta = EDITOR_FONTS[appSettings.font.english];
  document.documentElement.style.setProperty("--editor-font-kr", krMeta ? krMeta.stack : "sans-serif");
  document.documentElement.style.setProperty("--editor-font-en", enMeta ? (enMeta.enStack || enMeta.stack) : "sans-serif");
  document.documentElement.style.setProperty("--editor-font-size", (appSettings.font.size || 17) + "px");

  document.body.classList.toggle("compact", !!appSettings.ui.compactMode);

  applyTranslations();
}

/* ─── SETTINGS PANEL (tabbed — Library / Fonts / Calendar / ...) ───────────
   Each tab is just { id, label, groups } — groups are the same shape
   renderSettingsBody() already knew how to draw. Adding a new settings
   section later (e.g. filling in Calendar) means adding fields to that
   tab's groups here; adding a whole new tab means adding one entry to
   SETTINGS_TABS. No other structural change needed. */

function settingsTabs() {
  return [
    {
      id: "library",
      label: t("settings.tabLibrary"),
      groups: [
        {
          title: t("settings.groupUI"),
          fields: [
            {
              path: "ui.theme",
              label: t("settings.theme"),
              type: "swatch-grid",
            },
            {
              path: "ui.language",
              label: t("settings.language"),
              type: "select",
              options: [
                { value: "en", label: t("settings.languageEnglish") },
                { value: "ko", label: t("settings.languageKorean") },
              ],
            },
            { path: "ui.indentMode", label: t("settings.indentMode"), type: "bool" },
            { path: "ui.compactMode", label: t("settings.compactMode"), type: "bool" },
          ],
        },
        {
          title: t("settings.groupBehavior"),
          fields: [
            { path: "behavior.autoSave", label: t("settings.autoSave"), type: "bool" },
            { path: "behavior.driveSync", label: t("settings.driveSync"), type: "bool" },
          ],
        },
        {
          title: t("settings.groupSync"),
          fields: [
            {
              type: "button",
              label: t("settings.syncPush"),
              buttonText: t("settings.syncPushButton"),
              onClick: "syncPushToDrive",
            },
            {
              type: "button",
              label: t("settings.syncPull"),
              buttonText: t("settings.syncPullButton"),
              onClick: "syncPullFromDrive",
            },
          ],
        },
      ],
    },
    {
      id: "fonts",
      label: t("settings.tabFonts"),
      groups: [
        {
          title: t("settings.groupFont"),
          fields: [
            {
              path: "font.korean",
              label: t("settings.koreanFont"),
              type: "font-select",
              // grouped by category; each option carries preview text
              options: buildFontOptions("kr"),
            },
            {
              path: "font.english",
              label: t("settings.englishFont"),
              type: "font-select",
              options: buildFontOptions("en"),
            },
            {
              path: "font.size",
              label: t("settings.fontSize"),
              type: "range",
              min: 13,
              max: 22,
              step: 1,
              unit: "px",
            },
          ],
        },
      ],
    },
    {
      id: "calendar",
      label: t("settings.tabCalendar"),
      groups: [], // nothing here yet
    },
  ];
}

function openSettings() {
  preloadFontPreviews();
  renderSettings();
  document.getElementById("settings-overlay").classList.add("open");
}

/* Kick off a download for every registered font the moment Settings opens,
   well before the user actually opens a font picker. Needed because native
   <select> option previews only look right once the font has finished
   loading — normal page text repaints when a web font swaps in, but a
   browser's native dropdown popup does not, so if the font is still loading
   when the picker is opened, that preview is stuck showing the fallback for
   the rest of that popup's lifetime. Small subsetted webfonts (most of the
   Google Fonts entries) finish fast enough that this is rarely visible; the
   self-hosted Nanum Handwriting fonts are full, unsubsetted files (a few MB
   each) and need the head start. Sample text covers both Hangul and Latin
   so subsetted fonts fetch whichever piece they'd otherwise lazy-load. */
function preloadFontPreviews() {
  if (!document.fonts) return;
  for (const key of Object.keys(EDITOR_FONTS)) {
    const meta = EDITOR_FONTS[key];
    document.fonts.load("16px " + meta.stack, "안녕abc").catch(() => {});
    if (meta.enStack) document.fonts.load("16px " + meta.enStack, "abc").catch(() => {});
  }
}

function closeSettings() {
  const overlay = document.getElementById("settings-overlay");
  if (overlay) overlay.classList.remove("open");
}

function closeSettingsOutside(e) {
  if (e.target === document.getElementById("settings-overlay")) closeSettings();
}

function switchSettingsTab(id) {
  settingsActiveTab = id;
  renderSettings();
}

function renderSettings() {
  const tabs = settingsTabs();
  if (!tabs.some((t) => t.id === settingsActiveTab)) settingsActiveTab = tabs[0].id;

  let tabsHtml = "";
  for (const tab of tabs) {
    tabsHtml +=
      '<button class="settings-tab' +
      (tab.id === settingsActiveTab ? " active" : "") +
      '" onclick="switchSettingsTab(\'' +
      tab.id +
      "')\">" +
      escapeHtml(tab.label) +
      "</button>";
  }
  document.getElementById("settings-tabs").innerHTML = tabsHtml;

  const activeTab = tabs.find((t) => t.id === settingsActiveTab);
  document.getElementById("settings-body").innerHTML = renderSettingsGroups(activeTab.groups);
}

function renderSettingsGroups(groups) {
  if (!groups.length) {
    return '<div class="settings-empty">' + escapeHtml(t("settings.emptyMore")) + "</div>";
  }

  let html = "";
  for (const g of groups) {
    html += '<div class="settings-group">';
    html += '<div class="settings-group-title">' + g.title + "</div>";
    for (const field of g.fields) {
      // "button" fields (e.g. the sync push/pull actions) have no path —
      // they don't read or write a setting, just trigger an action.
      const val = field.path ? getSetting(field.path) : undefined;
      if (field.type === "swatch-grid") {
        // Own row shape (label above, grid below) — a grid of preview
        // swatches doesn't fit the label-left/control-right .settings-row
        // layout every other field type uses.
        html +=
          '<div class="settings-row-stacked"><span class="settings-label">' +
          field.label +
          "</span>" +
          renderThemeSwatchGrid(field.path, val) +
          "</div>";
        continue;
      }
      let control = "";
      if (field.type === "bool") {
        control =
          '<label class="switch"><input type="checkbox" ' +
          (val ? "checked" : "") +
          " onchange=\"setSetting('" +
          field.path +
          '\', this.checked)"><span class="slider"></span></label>';
      } else if (field.type === "select") {
        control =
          '<select class="settings-select" onchange="setSetting(\'' +
          field.path +
          "', this.value)\">";
        for (const opt of field.options) {
          const optVal = typeof opt === "object" ? opt.value : opt;
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
      } else if (field.type === "range") {
        control = renderRangeInput(field.path, val, field);
      } else if (field.type === "button") {
        control =
          '<button type="button" class="btn btn-accent" onclick="' +
          field.onClick +
          '()">' +
          escapeHtml(field.buttonText) +
          "</button>";
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
  return html;
}

/* Build grouped font options from EDITOR_FONTS registry, restricted to
   entries usable for the given language ("kr" or "en") — many fonts (nearly
   everything Korean-capable) support both and so appear in both pickers.
   Returns [{ label, value, preview, category }, ...] sorted by category order. */
function buildFontOptions(lang) {
  const order = ["cute", "handwriting", "formal"];
  const items = [];
  for (const key of Object.keys(EDITOR_FONTS)) {
    const f = EDITOR_FONTS[key];
    if (!f.langs.includes(lang)) continue;
    items.push({
      value: key,
      label: f.label || key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
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
  let html =
    '<select class="settings-select" onchange="setSetting(\'' +
    path +
    "', this.value)\">";

  let currentGroup = null;
  for (const opt of options) {
    if (opt.category !== currentGroup) {
      if (currentGroup !== null) html += "</optgroup>";
      currentGroup = opt.category;
      const groupLabel = fontCategoryLabel(currentGroup);
      html += '<optgroup label="' + escapeHtml(groupLabel) + '">';
    }
    const label = escapeHtml(opt.label) + " — " + escapeHtml(opt.preview);
    html +=
      '<option value="' +
      escapeHtml(opt.value) +
      '"' +
      (opt.value === currentValue ? " selected" : "") +
      ' style="font-family:' +
      escapeHtml(EDITOR_FONTS[opt.value].stack) +
      ',sans-serif;font-size:17px"' +
      ">" +
      label +
      "</option>";
  }
  if (currentGroup !== null) html += "</optgroup>";
  html += "</select>";
  return html;
}

/* Render a <input type="range"> plus a live value label. The label updates
   via direct DOM access on "input" instead of calling renderSettings() again
   — re-rendering the whole panel on every drag tick would rebuild the
   <input> mid-drag and interrupt the gesture. */
function renderRangeInput(path, currentValue, field) {
  const valueId = "rangeval-" + path;
  return (
    '<div class="settings-range">' +
    '<input type="range" min="' +
    field.min +
    '" max="' +
    field.max +
    '" step="' +
    (field.step || 1) +
    '" value="' +
    currentValue +
    '" oninput="setSetting(\'' +
    path +
    "', Number(this.value)); document.getElementById('" +
    valueId +
    "').textContent = this.value + '" +
    (field.unit || "") +
    "';\">" +
    '<span class="settings-range-value" id="' +
    valueId +
    '">' +
    currentValue +
    (field.unit || "") +
    "</span>" +
    "</div>"
  );
}

/* Renders THEME_LIST as a grid of clickable preview swatches (mono themes
   show their --bg color, concept themes show their small thumbnail) — the
   visual counterpart to picking a theme id via setSetting(), same as every
   other field renderer here. THEME_SWATCH_COLORS (config.js) must be kept
   in sync with each mono theme's --bg/--text in index.html; it's a small,
   purely cosmetic duplication scoped to this one preview. */
function renderThemeSwatchGrid(path, currentValue) {
  let html = '<div class="theme-swatch-grid">';
  for (const theme of THEME_LIST) {
    const selected = theme.id === currentValue;
    const label = escapeHtml(t(theme.labelKey));
    let previewStyle;
    if (theme.group === "concept") {
      previewStyle =
        "background-image:url('" + escapeHtml(theme.thumb) + "');background-size:cover;background-position:center;";
    } else {
      const c = THEME_SWATCH_COLORS[theme.id] || THEME_SWATCH_COLORS[DEFAULT_THEME_ID];
      previewStyle = "background:" + c.bg + ";color:" + c.fg + ";";
    }
    html +=
      '<button type="button" class="theme-swatch' +
      (selected ? " selected" : "") +
      '" title="' +
      label +
      "\" onclick=\"setSetting('" +
      path +
      "', '" +
      theme.id +
      "')\">" +
      '<span class="theme-swatch-preview" style="' +
      previewStyle +
      '">' +
      (theme.group === "mono" ? "Aa" : "") +
      "</span>" +
      '<span class="theme-swatch-label">' +
      label +
      "</span>" +
      "</button>";
  }
  html += "</div>";
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

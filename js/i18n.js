/* ─── I18N ──────────────────────────────────────────────────────────────
   App-UI translation only — never touches user-written note content,
   document titles, or identifiers like "AndysNote" / "notes_local" (those
   are names, not copy). Language lives in appSettings.ui.language ("en" |
   "ko"), same place theme/fonts live, and is applied the same way: a
   central refresh function called from applySettings() at boot and from
   setSetting() whenever the language field itself changes (see
   settings.js). Adding a language means adding one more key to each entry
   below; adding a new translatable string means adding a key to both. */

const I18N = {
  en: {
    "nav.library": "Library",
    "nav.calendar": "Calendar",
    "topbar.settings": "Settings",
    "sync.local": "Local only",
    "sync.signInFailed": "Sign-in failed",
    "sync.connecting": "Connecting...",
    "sync.opening": "Opening...",
    "sync.opened": "Opened",
    "sync.openFailed": "Open failed",
    "sync.loading": "Loading...",
    "sync.loadedFromCache": "Loaded from cache",
    "sync.loaded": "Loaded",
    "sync.loadFailed": "Load failed",
    "sync.saving": "Saving...",
    "sync.saved": "Saved",
    "sync.saveFailed": "Save failed",
    "sync.creating": "Creating...",
    "sync.folderCreated": "Folder created",
    "sync.createFailed": "Create failed",
    "sync.retry": "Retry",
    "auth.signIn": "Sign in with Google",
    "auth.signOut": "Sign out",
    "auth.notConfigured":
      "Google Sign-In is not configured. Please set window.GOOGLE_CLIENT_ID in js/config.js.",
    "sidebar.folders": "Folders",
    "sidebar.chooseFolder": "Choose folder / new item",
    "sidebar.search": "Search...",
    "sidebar.signInPrompt":
      "Sign in with Google to load your Drive workspace. Notes you create in notes_local below stay in this browser.",
    "sidebar.importTxt": "Import a .txt file",
    "sidebar.newFolder": "New folder",
    "sidebar.newLocalNote": "New local note",
    "sidebar.newLocalMdNote": "New local Markdown note",
    "sidebar.noLocalNotesYet": "No local notes yet.",
    "sidebar.noMatchingLocalNotes": "No matching local notes.",
    "sidebar.noFoldersYet": "No folders yet. Use the + button to create one.",
    "sidebar.loading": "Loading…",
    "sidebar.newDocument": "New document",
    "empty.title": "No document selected",
    "empty.desc": "Choose a document from the sidebar or create a new one",
    "editor.save": "Save",
    "editor.export": "Export as .txt",
    "editor.bold": "Bold (Ctrl+B)",
    "editor.italic": "Italic (Ctrl+I)",
    "editor.strike": "Strikethrough",
    "editor.inlineCode": "Inline Code",
    "editor.heading": "Heading",
    "editor.quote": "Quote",
    "editor.bullet": "Bullet List",
    "editor.numbered": "Numbered List",
    "editor.checklist": "Checklist",
    "editor.divider": "Divider",
    "editor.codeBlock": "Code Block",
    "editor.titlePlaceholder": "Untitled",
    "editor.bodyPlaceholder": "Start writing...",
    "editor.metaCreated": "Created",
    "editor.metaModified": "Last modified",
    "cal.allFolders": "All folders",
    "cal.backToMonth": "Back to month",
    "cal.noEntries": "No documents created on this day.",
    "cal.months": [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ],
    "cal.weekday.sun": "Sun",
    "cal.weekday.mon": "Mon",
    "cal.weekday.tue": "Tue",
    "cal.weekday.wed": "Wed",
    "cal.weekday.thu": "Thu",
    "cal.weekday.fri": "Fri",
    "cal.weekday.sat": "Sat",
    "modal.newItem": "New Item",
    "modal.newDocument": "New Document",
    "modal.newFolder": "New Folder",
    "modal.docTitlePlaceholder": "Document title...",
    "modal.folderNamePlaceholder": "Folder name...",
    "modal.typeDoc": "Document (.txt)",
    "modal.typeDocMd": "Document (.md)",
    "modal.typeFolder": "Folder",
    "modal.cancel": "Cancel",
    "modal.create": "Create",
    "modal.rootFolderOption": "AndysNote/ (root)",
    "settings.heading": "Settings",
    "settings.tabLibrary": "Library",
    "settings.tabFonts": "Fonts",
    "settings.tabCalendar": "Calendar",
    "settings.groupUI": "UI",
    "settings.groupBehavior": "Behavior",
    "settings.groupFont": "Font",
    "settings.theme": "Theme",
    "settings.themeDark": "Dark",
    "settings.themeLight": "Light",
    "settings.themeGray": "Gray",
    "settings.themeGreen": "Green",
    "settings.themeIndigo": "Indigo",
    "settings.themeLightGray": "Light Gray",
    "settings.themeLightGreen": "Light Green",
    "settings.themeLightIndigo": "Light Indigo",
    "settings.themeStarryNight": "Starry Night",
    "settings.themeLighthouse": "Lighthouse Sea",
    "settings.themeCamping": "Camping",
    "settings.language": "Language",
    "settings.languageEnglish": "English",
    "settings.languageKorean": "한국어",
    "settings.indentMode": "Indent mode (.txt / local notes)",
    "settings.compactMode": "Compact mode",
    "settings.autoSave": "Auto save",
    "settings.driveSync": "Drive sync",
    "settings.koreanFont": "Korean font",
    "settings.englishFont": "English font",
    "settings.emptyMore": "More settings coming soon.",
    "fontCat.cute": "Cute / Rounded",
    "fontCat.handwriting": "Mature Handwriting",
    "fontCat.formal": "Serif & Gothic (Document)",
    "local.textFileDescription": "Text file",
    "local.importedTitle": "Imported",
    "local.newFolderDefaultName": "New Folder",
    "local.connectPrompt": "Connect a real folder on your computer to store notes_local as actual .txt/.md files.",
    "local.connectButton": "Connect folder",
    "local.reconnectPrompt": "Permission to your connected folder needs to be re-granted.",
    "local.reconnectButton": "Reconnect folder",
    "local.connectFailed": "Couldn't connect the folder",
    "local.migrating": "Moving existing local notes into the folder...",
    "local.migrateDone": "Local notes moved into the folder",
    "local.fallbackNotice":
      "Your browser doesn't support real folder access, so local notes are stored like internal cache files on this computer, not visible files.",
  },
  ko: {
    "nav.library": "라이브러리",
    "nav.calendar": "캘린더",
    "topbar.settings": "설정",
    "sync.local": "로컬 전용",
    "sync.signInFailed": "로그인 실패",
    "sync.connecting": "연결 중...",
    "sync.opening": "여는 중...",
    "sync.opened": "열림",
    "sync.openFailed": "열기 실패",
    "sync.loading": "불러오는 중...",
    "sync.loadedFromCache": "캐시에서 불러옴",
    "sync.loaded": "불러옴",
    "sync.loadFailed": "불러오기 실패",
    "sync.saving": "저장 중...",
    "sync.saved": "저장됨",
    "sync.saveFailed": "저장 실패",
    "sync.creating": "만드는 중...",
    "sync.folderCreated": "폴더 생성됨",
    "sync.createFailed": "생성 실패",
    "sync.retry": "재시도",
    "auth.signIn": "Google로 로그인",
    "auth.signOut": "로그아웃",
    "auth.notConfigured":
      "Google 로그인이 설정되지 않았습니다. js/config.js에서 window.GOOGLE_CLIENT_ID를 설정해 주세요.",
    "sidebar.folders": "폴더",
    "sidebar.chooseFolder": "폴더 선택 / 새 항목",
    "sidebar.search": "검색...",
    "sidebar.signInPrompt":
      "Google로 로그인하면 Drive 작업 공간을 불러옵니다. 아래 notes_local에서 만든 노트는 이 브라우저에만 저장됩니다.",
    "sidebar.importTxt": "txt 파일 가져오기",
    "sidebar.newFolder": "새 폴더",
    "sidebar.newLocalNote": "새 로컬 노트",
    "sidebar.newLocalMdNote": "새 로컬 마크다운 노트",
    "sidebar.noLocalNotesYet": "아직 로컬 노트가 없습니다.",
    "sidebar.noMatchingLocalNotes": "일치하는 로컬 노트가 없습니다.",
    "sidebar.noFoldersYet": "아직 폴더가 없습니다. + 버튼으로 새로 만드세요.",
    "sidebar.loading": "불러오는 중…",
    "sidebar.newDocument": "새 문서",
    "empty.title": "선택된 문서 없음",
    "empty.desc": "사이드바에서 문서를 선택하거나 새로 만드세요",
    "editor.save": "저장",
    "editor.export": "txt로 내보내기",
    "editor.bold": "굵게 (Ctrl+B)",
    "editor.italic": "기울임 (Ctrl+I)",
    "editor.strike": "취소선",
    "editor.inlineCode": "인라인 코드",
    "editor.heading": "제목",
    "editor.quote": "인용구",
    "editor.bullet": "글머리 기호 목록",
    "editor.numbered": "번호 매기기 목록",
    "editor.checklist": "체크리스트",
    "editor.divider": "구분선",
    "editor.codeBlock": "코드 블록",
    "editor.titlePlaceholder": "제목 없음",
    "editor.bodyPlaceholder": "내용을 입력하세요...",
    "editor.metaCreated": "생성일",
    "editor.metaModified": "최종 수정일",
    "cal.allFolders": "전체 폴더",
    "cal.backToMonth": "월 보기로",
    "cal.noEntries": "이 날 생성된 문서가 없습니다.",
    "cal.months": [
      "1월", "2월", "3월", "4월", "5월", "6월",
      "7월", "8월", "9월", "10월", "11월", "12월",
    ],
    "cal.weekday.sun": "일",
    "cal.weekday.mon": "월",
    "cal.weekday.tue": "화",
    "cal.weekday.wed": "수",
    "cal.weekday.thu": "목",
    "cal.weekday.fri": "금",
    "cal.weekday.sat": "토",
    "modal.newItem": "새 항목",
    "modal.newDocument": "새 문서",
    "modal.newFolder": "새 폴더",
    "modal.docTitlePlaceholder": "문서 제목...",
    "modal.folderNamePlaceholder": "폴더 이름...",
    "modal.typeDoc": "문서 (.txt)",
    "modal.typeDocMd": "문서 (.md)",
    "modal.typeFolder": "폴더",
    "modal.cancel": "취소",
    "modal.create": "만들기",
    "modal.rootFolderOption": "AndysNote/ (루트)",
    "settings.heading": "설정",
    "settings.tabLibrary": "라이브러리",
    "settings.tabFonts": "폰트",
    "settings.tabCalendar": "캘린더",
    "settings.groupUI": "UI",
    "settings.groupBehavior": "동작",
    "settings.groupFont": "폰트",
    "settings.theme": "테마",
    "settings.themeDark": "다크",
    "settings.themeLight": "라이트",
    "settings.themeGray": "그레이",
    "settings.themeGreen": "그린",
    "settings.themeIndigo": "인디고",
    "settings.themeLightGray": "라이트 그레이",
    "settings.themeLightGreen": "라이트 그린",
    "settings.themeLightIndigo": "라이트 인디고",
    "settings.themeStarryNight": "별이 보이는 밤하늘",
    "settings.themeLighthouse": "등대 뜬 바다",
    "settings.themeCamping": "캠핑",
    "settings.language": "언어",
    "settings.languageEnglish": "English",
    "settings.languageKorean": "한국어",
    "settings.indentMode": "들여쓰기 모드 (.txt / 로컬 노트)",
    "settings.compactMode": "컴팩트 모드",
    "settings.autoSave": "자동 저장",
    "settings.driveSync": "드라이브 동기화",
    "settings.koreanFont": "한글 폰트",
    "settings.englishFont": "영문 폰트",
    "settings.emptyMore": "설정이 곧 추가될 예정입니다.",
    "fontCat.cute": "귀엽고 동글동글",
    "fontCat.handwriting": "성숙한 손글씨",
    "fontCat.formal": "명조 & 고딕 (문서)",
    "local.textFileDescription": "텍스트 파일",
    "local.importedTitle": "가져온 문서",
    "local.newFolderDefaultName": "새 폴더",
    "local.connectPrompt": "실제 컴퓨터 폴더를 연결하면 notes_local이 진짜 .txt/.md 파일로 저장됩니다.",
    "local.connectButton": "폴더 연결",
    "local.reconnectPrompt": "연결된 폴더에 대한 권한을 다시 허용해야 합니다.",
    "local.reconnectButton": "폴더 다시 연결",
    "local.connectFailed": "폴더를 연결하지 못했습니다",
    "local.migrating": "기존 로컬 노트를 폴더로 옮기는 중...",
    "local.migrateDone": "로컬 노트를 폴더로 옮겼습니다",
    "local.fallbackNotice":
      "이 브라우저는 실제 폴더 접근을 지원하지 않아서, 로컬 노트가 눈에 보이는 파일이 아니라 이 컴퓨터의 내부 캐시처럼 저장됩니다.",
  },
};

function currentLang() {
  return (appSettings && appSettings.ui && appSettings.ui.language) || "en";
}

function localeTag() {
  return currentLang() === "ko" ? "ko-KR" : "en-US";
}

/* t("some.key") -> current-language string, falling back to English then
   to the key itself so a missing translation never renders blank. */
function t(key) {
  const lang = currentLang();
  const table = I18N[lang] || I18N.en;
  if (key in table) return table[key];
  if (key in I18N.en) return I18N.en[key];
  return key;
}

/* "n word"/"n words" in English, "n개 단어" in Korean — kept out of the
   flat table since it needs the count, not just a lookup. */
function tWordCount(count) {
  if (currentLang() === "ko") return count + "개 단어";
  return count + (count === 1 ? " word" : " words");
}

/* "+N more" in the calendar's day cells when there are more entries than
   fit — also needs the count, so kept out of the flat table. */
function tMoreCount(count) {
  if (currentLang() === "ko") return `+${count}개 더보기`;
  return `+${count} more`;
}

/* Applies the current language to every static element in index.html that
   opted in via data-i18n / data-i18n-placeholder / data-i18n-title.
   Anything built dynamically (settings panel, calendar, sidebar rows, the
   modal) instead calls t() directly inside its own render function, so
   those stay current automatically the next time they re-render — see
   refreshUiLanguage() for what forces that re-render right when the
   language setting itself changes. */
function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
  // #doc-body-rich's placeholder is a CSS ::before { content: attr(...) }
  // rather than a real placeholder property, so it needs its own line.
  const richBody = document.getElementById("doc-body-rich");
  if (richBody) richBody.setAttribute("data-placeholder", t("editor.bodyPlaceholder"));
}

/* Called specifically when ui.language changes (see setSetting() in
   settings.js) to also re-render whatever dynamic panels are currently
   visible, so the switch is instant rather than waiting for their next
   unrelated re-render. */
function refreshUiLanguage() {
  applyTranslations();
  renderSidebar(typeof currentSearchValue === "function" ? currentSearchValue() : "");
  const settingsOverlay = document.getElementById("settings-overlay");
  if (settingsOverlay && settingsOverlay.classList.contains("open")) renderSettings();
  const calView = document.getElementById("calendar-view");
  if (calView && !calView.classList.contains("hidden")) renderCalendar();
  if (typeof updateWordCount === "function") updateWordCount();
  if (typeof updateTodayDate === "function") updateTodayDate();
}

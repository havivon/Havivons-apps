// <parser>
// Parses "תקן מילה X לY" starting at tokens[i] (tokens[i] === "תקן").
// Only the separating "ל" is removed from the new word, so a new word that
// itself starts with ל works: "ספר לליבה" -> ליבה, "בית ללחם" -> לחם.
// The recognizer sometimes emits the separator as its own token ("ל" / "ל-"),
// in which case the new word is the token after it, untouched.
// Returns { oldWord, newWord, consumed } or null when it is not a fix command.
function parseFixCommand(tokens, i) {
  if (tokens[i] !== "תקן" || tokens[i + 1] !== "מילה") return null;
  const oldWord = tokens[i + 2];
  const next = tokens[i + 3];
  if (!oldWord || !next) return null;
  let newWord;
  let consumed;
  if (next === "ל" || next === "ל-") {
    if (!tokens[i + 4]) return null; // separator with no new word after it
    newWord = tokens[i + 4];
    consumed = 5;
  } else {
    newWord = next;
    consumed = 4;
    if (newWord.length > 1 && newWord.charAt(0) === "ל") {
      newWord = newWord.slice(1);
      if (newWord.length > 1 && newWord.charAt(0) === "-") newWord = newWord.slice(1);
    }
  }
  return { oldWord, newWord, consumed };
}
// </parser>

(() => {
  "use strict";

  // ----- File:// guard -----
  // Chrome stores microphone permissions per origin. file:// URLs cannot hold a
  // persistent grant, so the browser re-prompts on every recognition.start().
  // Block the app and instruct the user to launch via run.bat (which serves the
  // page from http://localhost — an origin Chrome remembers).
  if (location.protocol === "file:") {
    const html = `
<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0b0c14;background-image:radial-gradient(at 20% 0%, rgba(124,58,237,0.18) 0, transparent 50%),radial-gradient(at 80% 100%, rgba(37,99,235,0.18) 0, transparent 50%);font-family:'Heebo','Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;color:#f1f5f9;padding:24px;overflow:auto;z-index:9999">
  <div style="max-width:640px;background:#11131e;border:1px solid rgba(255,255,255,0.12);border-radius:28px;padding:36px 40px;box-shadow:0 20px 50px rgba(0,0,0,0.5)">
    <div style="width:64px;height:64px;border-radius:20px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f59e0b,#ef4444);font-size:32px;margin-bottom:20px;box-shadow:0 8px 20px rgba(239,68,68,0.4)">⚠</div>
    <h1 style="font-size:24px;font-weight:800;margin:0 0 14px 0;letter-spacing:-0.02em">פתיחה לא נכונה של האפליקציה</h1>
    <p style="color:#94a3b8;line-height:1.7;margin:0 0 14px 0;font-size:15px">פתחת את <code style="background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:6px;font-size:14px">index.html</code> ישירות מהדפדפן (כתובת מסוג <code style="background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:6px;font-size:14px">file://</code>).</p>
    <p style="color:#94a3b8;line-height:1.7;margin:0 0 22px 0;font-size:15px">בדרך הזו <strong style="color:#f1f5f9">Chrome לא יכול לשמור את הרשאת המיקרופון לתמיד</strong> — לכן הוא שואל שוב ושוב כל כמה שניות.</p>
    <div style="background:linear-gradient(135deg,rgba(139,92,246,0.12),rgba(59,130,246,0.12));border:1px solid rgba(139,92,246,0.3);border-radius:18px;padding:20px 22px;margin-bottom:8px">
      <h3 style="font-size:16px;font-weight:700;margin:0 0 12px 0">איך לפתוח נכון:</h3>
      <ol style="color:#cbd5e1;line-height:2;padding-right:22px;margin:0;font-size:15px">
        <li>סגור את החלון הזה</li>
        <li>בתיקייה של הפרויקט — לחץ פעמיים על <code style="background:rgba(0,0,0,0.3);padding:2px 8px;border-radius:6px;font-weight:700;color:#fff">run.bat</code></li>
        <li>חלון אפליקציה ייעודי ייפתח עם הרשאת מיקרופון <strong style="color:#10b981">מאושרת מראש</strong></li>
        <li>אם יש לך קיצור דרך ישן ל-<code style="background:rgba(0,0,0,0.3);padding:2px 8px;border-radius:6px">index.html</code> — מחק אותו והשתמש רק ב-<code style="background:rgba(0,0,0,0.3);padding:2px 8px;border-radius:6px">run.bat</code></li>
      </ol>
    </div>
    <p style="color:#64748b;font-size:13px;margin:18px 0 0 0;text-align:center">Created by Havivon</p>
  </div>
</div>`;
    document.body.innerHTML = html;
    return;
  }

  // ----- DOM -----
  const startBtn = document.getElementById("start-btn");
  const startText = startBtn.querySelector(".btn-text");
  const clearBtn = document.getElementById("clear-btn");
  const copyBtn = document.getElementById("copy-btn");
  const saveBtn = document.getElementById("save-btn");
  const editor = document.getElementById("editor");
  const docTitle = document.getElementById("doc-title");
  const fontIncBtn = document.getElementById("font-inc");
  const fontDecBtn = document.getElementById("font-dec");
  const fontSizeDisplay = document.getElementById("font-size-display");
  const statusPill = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const docStats = document.getElementById("doc-stats");
  const toast = document.getElementById("toast");
  const themeToggle = document.getElementById("theme-toggle");
  const iconMoon = document.getElementById("icon-moon");
  const iconSun = document.getElementById("icon-sun");
  const commandsToggle = document.getElementById("commands-toggle");
  const commandsGrid = document.getElementById("commands-grid");
  const confirmDialog = document.getElementById("confirm-dialog");
  const dialogTitle = document.getElementById("dialog-title");
  const dialogMessage = document.getElementById("dialog-message");
  const dialogConfirm = document.getElementById("dialog-confirm");
  const dialogCancel = document.getElementById("dialog-cancel");
  const installBtn = document.getElementById("install-btn");
  const privacyDialog = document.getElementById("privacy-dialog");
  const privacyOk = document.getElementById("privacy-ok");

  // localStorage can throw (private mode / blocked storage) - never let it break the app.
  function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, val); } catch { /* ignore */ } }

  // ----- State -----
  let docText = "";
  let interimText = "";
  let pendingNoSpace = false;
  let recognition = null;
  let recognizing = false;
  let userStopped = false;
  let statusTimer = null;
  let permissionAdvised = false;
  let isSpeaking = false;
  let lastActivityAt = 0;
  let healthTimer = null;
  let starting = false;
  let networkFailures = 0;
  let restartTimer = null;
  const MAX_NETWORK_FAILURES = 5;
  const BACKOFF_BASE_MS = 1000;
  const BACKOFF_MAX_MS = 15000;
  const SHORTCUT_LABEL = "F2";

  // Single place that syncs the dictation button (visual state, label, a11y).
  function setRecordingUI(on) {
    startBtn.classList.toggle("recording", on);
    startText.textContent = on ? "עצור הכתבה" : "התחל הכתבה";
    startBtn.setAttribute("aria-pressed", on ? "true" : "false");
    startBtn.title = (on ? "עצור הכתבה" : "התחל הכתבה") + " (" + SHORTCUT_LABEL + ")";
  }

  // The green "speaking" indicator is driven by Web Speech API's own
  // onspeechstart/onspeechend events. Those fire only when the recognizer
  // decides the audio is actual speech (same gating used to decide what to
  // transcribe), so the indicator stays in sync with the dictation and
  // ignores fans, distant voices, taps, etc. - which is what we want.

  // ----- Speech Recognition support -----
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    startBtn.disabled = true;
    setStatus("הדפדפן לא תומך בזיהוי דיבור. השתמש ב-Chrome או Edge.", "error");
    showToast("הדפדפן לא תומך בזיהוי דיבור. פתח את הקובץ ב-Chrome או Edge.", "error", 9000);
  }

  // ----- Theme -----
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "light") {
    document.body.classList.add("light");
    iconMoon.style.display = "none";
    iconSun.style.display = "block";
  }
  themeToggle.addEventListener("click", () => {
    const isLight = document.body.classList.toggle("light");
    iconMoon.style.display = isLight ? "none" : "block";
    iconSun.style.display = isLight ? "block" : "none";
    localStorage.setItem("theme", isLight ? "light" : "dark");
  });

  // ----- Commands panel collapse -----
  commandsToggle.addEventListener("click", () => {
    const collapsed = commandsGrid.classList.toggle("collapsed");
    commandsToggle.textContent = collapsed ? "הצג" : "הסתר";
    commandsToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });

  // ----- Editor font size -----
  const FONT_DEFAULT = 19, FONT_MIN = 12, FONT_MAX = 40, FONT_STEP = 2;
  let editorFontSize = parseInt(localStorage.getItem("editorFontSize"), 10);
  if (!Number.isFinite(editorFontSize)) editorFontSize = FONT_DEFAULT;
  editorFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, editorFontSize));

  function applyFontSize() {
    editor.style.fontSize = editorFontSize + "px";
    if (fontSizeDisplay) fontSizeDisplay.textContent = String(editorFontSize);
    localStorage.setItem("editorFontSize", String(editorFontSize));
  }
  applyFontSize();

  if (fontIncBtn) {
    fontIncBtn.addEventListener("click", () => {
      if (editorFontSize < FONT_MAX) {
        editorFontSize = Math.min(FONT_MAX, editorFontSize + FONT_STEP);
        applyFontSize();
      }
    });
  }
  if (fontDecBtn) {
    fontDecBtn.addEventListener("click", () => {
      if (editorFontSize > FONT_MIN) {
        editorFontSize = Math.max(FONT_MIN, editorFontSize - FONT_STEP);
        applyFontSize();
      }
    });
  }

  // ----- Editor: contenteditable with manual editing support -----
  editor.addEventListener("input", onUserEdit);
  editor.addEventListener("paste", onPaste);

  function onUserEdit() {
    docText = readEditorText();
    updateEmpty();
    updateStats();
  }

  function onPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain");
    if (!text) return;
    if (document.execCommand) {
      document.execCommand("insertText", false, text);
    } else {
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.setEndAfter(node);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    onUserEdit();
  }

  function readEditorText() {
    // Temporarily detach interim spans (which are in-DOM and contenteditable=false),
    // read innerText (which correctly converts <br>/<div> into \n), then restore them.
    const spans = Array.from(editor.querySelectorAll(".interim-inline"));
    const positions = spans.map(s => ({ parent: s.parentNode, next: s.nextSibling }));
    spans.forEach(s => s.parentNode.removeChild(s));
    const text = editor.innerText.replace(/ /g, " ");
    spans.forEach((s, i) => {
      const { parent, next } = positions[i];
      if (next) parent.insertBefore(s, next);
      else parent.appendChild(s);
    });
    return text;
  }

  function renderEditor() {
    const wasFocused = editor.contains(document.activeElement);
    editor.innerText = docText;
    if (interimText) {
      const span = document.createElement("span");
      span.className = "interim-inline";
      span.setAttribute("contenteditable", "false");
      const sep = (docText && !docText.endsWith("\n") && !docText.endsWith(" ")) ? " " : "";
      span.textContent = sep + interimText;
      editor.appendChild(span);
    }
    if (recognizing && wasFocused) moveCursorToEnd();
    updateEmpty();
    updateStats();
  }

  function moveCursorToEnd() {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function updateEmpty() {
    const isEmpty = !docText && !interimText;
    editor.classList.toggle("is-empty", isEmpty);
  }

  function updateStats() {
    const words = docText.trim() ? docText.trim().split(/\s+/).length : 0;
    docStats.textContent = `${words} מילים`;
  }

  // ----- Status / toast -----
  function setStatus(text, kind) {
    statusText.textContent = text;
    statusPill.classList.remove("active", "success");
    if (kind === "active") statusPill.classList.add("active");
    if (kind === "success") statusPill.classList.add("success");
  }

  function flashStatus(text, kind, restoreMs = 2500) {
    clearTimeout(statusTimer);
    setStatus(text, kind);
    statusTimer = setTimeout(() => {
      if (recognizing) setStatus("מקליט... דבר עכשיו", "active");
      else setStatus("מוכן");
    }, restoreMs);
  }

  function showToast(message, kind = "info", duration = 2400) {
    toast.textContent = message;
    toast.className = "toast show " + kind;
    setTimeout(() => { toast.classList.remove("show"); }, duration);
  }

  // ----- Document modifications (voice) -----
  function appendWord(w) {
    if (!w) return;
    if (!docText || pendingNoSpace) {
      docText += w;
      pendingNoSpace = false;
      return;
    }
    const last = docText[docText.length - 1];
    docText += (last === "\n" || last === " ") ? w : " " + w;
  }

  function appendPunct(p) {
    // Don't eat trailing whitespace: the user may have explicitly placed it
    // with a "רווח" command, and a later "פסיק"/"ציטוט" should preserve it.
    docText += p;
    pendingNoSpace = false;
  }

  function appendQuote() {
    docText += "'";
    pendingNoSpace = true;
  }

  function appendNewline() {
    // Always add a newline, even if the doc already ends with one. Saying
    // "שורה חדשה" three times in a row should produce three blank lines, the
    // same way three "פסיק" produce three commas.
    docText += "\n";
    pendingNoSpace = true;
  }

  function fixWord(oldWord, newWord) {
    const wordRe = /[֐-׿]+/g;
    const matches = [];
    let m;
    while ((m = wordRe.exec(docText)) !== null) {
      matches.push({ word: m[0], start: m.index, end: m.index + m[0].length });
    }
    const recent = matches.slice(-5);
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i].word === oldWord) {
        const { start, end } = recent[i];
        docText = docText.slice(0, start) + newWord + docText.slice(end);
        flashStatus(`תוקנה: "${oldWord}" → "${newWord}"`, "success");
        return true;
      }
    }
    flashStatus(`המילה "${oldWord}" לא נמצאה ב-5 המילים האחרונות`, "error");
    return false;
  }

  // ----- Voice command parser -----
  const SINGLE_PUNCT = {
    "נקודה": ".",
    "פסיק": ",",
    "נקודותיים": ":",
    "נקודתיים": ":",
  };

  const HEBREW_NUMBERS = {
    "אחד": 1, "אחת": 1,
    "שניים": 2, "שתיים": 2, "שני": 2, "שתי": 2,
    "שלושה": 3, "שלוש": 3,
    "ארבעה": 4, "ארבע": 4,
    "חמישה": 5, "חמש": 5,
    "שישה": 6, "שש": 6,
    "שבעה": 7, "שבע": 7,
    "שמונה": 8,
    "תשעה": 9, "תשע": 9,
    "עשרה": 10, "עשר": 10,
    "עשרים": 20,
    "שלושים": 30,
    "ארבעים": 40,
    "חמישים": 50,
    "שישים": 60,
    "שבעים": 70,
    "שמונים": 80,
    "תשעים": 90,
    "מאה": 100,
  };

  function parseNumberFromTokens(tokens, start) {
    if (start >= tokens.length) return null;
    const t = tokens[start];

    // Digits, possibly with trailing punctuation (e.g. "5." or "12,")
    const digitMatch = t.match(/^(\d+)/);
    if (digitMatch) return { value: parseInt(digitMatch[1], 10), consumed: 1 };

    if (!(t in HEBREW_NUMBERS)) return null;
    const val = HEBREW_NUMBERS[t];
    const next = tokens[start + 1];

    if (next) {
      // 11–19: units + "עשרה" / "עשר"
      if (val >= 1 && val <= 9 && (next === "עשרה" || next === "עשר")) {
        return { value: val + 10, consumed: 2 };
      }
      // 21–99: tens + "ו"+units (e.g. "עשרים וחמש")
      if (val >= 20 && val < 100 && val % 10 === 0) {
        let suffix = next;
        if (suffix.length > 1 && suffix.startsWith("ו")) suffix = suffix.slice(1);
        if (suffix in HEBREW_NUMBERS) {
          const u = HEBREW_NUMBERS[suffix];
          if (u >= 1 && u <= 9) return { value: val + u, consumed: 2 };
        }
      }
    }
    return { value: val, consumed: 1 };
  }

  function deleteLastWords(n) {
    if (!n || n <= 0) return;
    const wordRe = /[\p{L}\p{N}]+/gu;
    const matches = [];
    let m;
    while ((m = wordRe.exec(docText)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length });
    }
    if (matches.length === 0) {
      flashStatus("אין מה למחוק", "error");
      return;
    }
    const removeCount = Math.min(n, matches.length);
    const fromIdx = matches.length - removeCount;
    const cutAt = matches[fromIdx].start;
    let trimmed = docText.slice(0, cutAt);
    // Strip only trailing whitespace. Punctuation that sat between the
    // kept text and the cut (e.g. "?" after the word right before the
    // deleted run) belongs to the kept word and must stay.
    trimmed = trimmed.replace(/\s+$/u, "");
    docText = trimmed;
    flashStatus(`נמחקו ${removeCount} מילים`, "success");
  }

  function processUtterance(text) {
    // Sync from editor in case user edited manually between utterances
    docText = readEditorText();

    const tokens = text.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];

      // "תקן מילה X לY"
      const fix = parseFixCommand(tokens, i);
      if (fix) {
        fixWord(fix.oldWord, fix.newWord);
        i += fix.consumed;
        continue;
      }

      // "מחק N" — delete last N words
      if (t === "מחק" && tokens[i + 1]) {
        const num = parseNumberFromTokens(tokens, i + 1);
        if (num) {
          deleteLastWords(num.value);
          i += 1 + num.consumed;
          continue;
        }
      }

      // Two-word commands
      if (t === "סימן" && tokens[i + 1] === "שאלה") { appendPunct("?"); i += 2; continue; }
      if (t === "סימן" && tokens[i + 1] === "קריאה") { appendPunct("!"); i += 2; continue; }
      if (t === "שורה" && tokens[i + 1] === "חדשה") { appendNewline(); i += 2; continue; }
      // Backwards-compat: keep the old "רד שורה" phrase working too.
      if (t === "רד" && tokens[i + 1] === "שורה") { appendNewline(); i += 2; continue; }

      // Quote: attaches next word without space
      if (t === "ציטוט") { appendQuote(); i += 1; continue; }

      // Literal single-character space
      if (t === "רווח") {
        if (docText && !docText.endsWith("\n")) docText += " ";
        else if (!docText) docText = " ";
        pendingNoSpace = false;
        i += 1;
        continue;
      }

      // Single-word punctuation
      if (Object.prototype.hasOwnProperty.call(SINGLE_PUNCT, t)) {
        appendPunct(SINGLE_PUNCT[t]);
        i += 1;
        continue;
      }

      appendWord(t);
      i += 1;
    }
  }

  // ----- Mic permission (one-time, persistent) -----
  async function ensureMicPermission() {
    if (!navigator.mediaDevices) return true;

    let state = "prompt";
    if (navigator.permissions) {
      try {
        const result = await navigator.permissions.query({ name: "microphone" });
        state = result.state;
      } catch { /* not supported, treat as prompt */ }
    }

    if (state === "granted") return true;

    if (state === "denied") {
      showToast("גישה למיקרופון נחסמה. פתח את הגדרות האתר בדפדפן (סמל הנעילה בשורת הכתובת) ואפשר את המיקרופון.", "error", 7000);
      return false;
    }

    // state === "prompt"
    if (!permissionAdvised) {
      permissionAdvised = true;
      showToast('כדי שלא יישאל בכל פעם — בחר "אפשר תמיד" / "Allow on every visit" בדיאלוג', "info", 6500);
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch {
      showToast("הרשאת המיקרופון נדחתה", "error", 4000);
      return false;
    }
  }

  function updateSpeakingIndicator() {
    const el = document.getElementById("speaking-indicator");
    if (el) el.classList.toggle("active", recognizing && isSpeaking);
  }

  // Health watchdog: every few seconds, look for signs the engine has
  // silently gone idle. If no activity for HEALTH_IDLE_MS, soft-restart by
  // calling recognition.stop() (onend will re-start).
  const HEALTH_IDLE_MS = 10000;
  function startHealth() {
    stopHealth();
    lastActivityAt = Date.now();
    healthTimer = setInterval(() => {
      if (!recognizing) return;
      const idle = Date.now() - lastActivityAt;
      if (idle > HEALTH_IDLE_MS) {
        console.warn("recognition idle for " + idle + "ms, soft-restart");
        lastActivityAt = Date.now();
        try { recognition.stop(); } catch { /* ignore */ }
      }
    }, 3000);
  }
  function stopHealth() {
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = null;
  }

  // ----- Recognition lifecycle -----
  async function startRecognition() {
    if (starting) return; // ignore double clicks / repeated F2 while starting
    if (!privacyAcknowledged()) { showPrivacyNotice(); return; }

    starting = true;
    let granted = false;
    try { granted = await ensureMicPermission(); }
    finally { if (!granted) starting = false; }
    if (!granted) return;

    networkFailures = 0;
    clearTimeout(restartTimer);
    restartTimer = null;
    startHealth();

    recognition = new SR();
    recognition.lang = "he-IL";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      starting = false;
      recognizing = true;
      userStopped = false;
      lastActivityAt = Date.now();
      setRecordingUI(true);
      // Do not clear a pending network-error message while we are in backoff;
      // otherwise show the normal recording status.
      if (networkFailures === 0) setStatus("מקליט... דבר עכשיו", "active");
      updateSpeakingIndicator();
    };

    // Speech-only events: fire when the recognizer itself decides the audio
    // is speech (vs background noise). Anything that wouldn't be transcribed
    // also won't light the indicator.
    recognition.onspeechstart = () => {
      isSpeaking = true;
      updateSpeakingIndicator();
    };
    recognition.onspeechend = () => {
      isSpeaking = false;
      updateSpeakingIndicator();
    };
    // Safety net: if soundend fires without a paired speechend, drop the
    // indicator too so it doesn't get stuck on.
    recognition.onsoundend = () => {
      if (isSpeaking) {
        isSpeaking = false;
        updateSpeakingIndicator();
      }
    };

    recognition.onerror = (e) => {
      console.error("recognition error:", e);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        userStopped = true;
        setStatus("גישה למיקרופון נחסמה", "error");
        showToast("אשר את ההרשאה דרך סמל הנעילה בשורת הכתובת ובחר 'אפשר תמיד'", "error", 6000);
      } else if (e.error === "no-speech") {
        /* ignore - will auto-restart */
      } else if (e.error === "audio-capture") {
        userStopped = true;
        setStatus("לא נמצא מיקרופון", "error");
      } else if (e.error === "network") {
        // onend follows and schedules the retry with backoff (or gives up).
        networkFailures++;
        setStatus("שגיאת רשת — נדרש חיבור לאינטרנט", "error");
      } else {
        setStatus(`שגיאה: ${e.error}`, "error");
      }
    };

    recognition.onend = () => {
      starting = false;
      interimText = "";
      isSpeaking = false;
      renderEditor();
      if (userStopped) {
        finishStopped();
        return;
      }
      // Repeated network errors: give up after a few tries instead of
      // hammering start() in a tight loop.
      if (networkFailures >= MAX_NETWORK_FAILURES) {
        networkFailures = 0;
        recognizing = false;
        userStopped = true;
        stopHealth();
        setRecordingUI(false);
        updateSpeakingIndicator();
        setStatus("אין חיבור לשירות זיהוי הדיבור", "error");
        showToast("אין חיבור לשירות זיהוי הדיבור. בדוק את חיבור האינטרנט ולחץ \"התחל הכתבה\" שוב.", "error", 7000);
        return;
      }
      if (networkFailures > 0) {
        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, networkFailures - 1));
        setStatus(`אין חיבור לשירות זיהוי הדיבור — ניסיון חוזר בעוד ${Math.round(delay / 1000)} שנ'`, "error");
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          restartTimer = null;
          if (userStopped) return;
          restartRecognition();
        }, delay);
        return;
      }
      restartRecognition();
    };

    recognition.onresult = (event) => {
      lastActivityAt = Date.now();
      if (networkFailures > 0) {
        // the service is reachable again
        networkFailures = 0;
        setStatus("מקליט... דבר עכשיו", "active");
      }
      let interimAccum = "";
      let finalAccum = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) finalAccum += transcript + " ";
        else interimAccum += transcript;
      }
      if (finalAccum.trim()) processUtterance(finalAccum);
      interimText = interimAccum.trim();
      renderEditor();
    };

    try { recognition.start(); }
    catch (e) {
      console.error(e);
      starting = false;
      stopHealth();
      showToast("שגיאה בהפעלת זיהוי דיבור: " + e.message, "error", 5000);
    }
  }

  // Auto-restart after a normal end. Try once immediately; if start() throws
  // (state error), wait 200ms and try once more before giving up.
  function restartRecognition() {
    try { recognition.start(); }
    catch (err) {
      setTimeout(() => {
        if (userStopped) return;
        try { recognition.start(); }
        catch (err2) {
          console.warn("restart failed:", err2);
          recognizing = false;
          stopHealth();
          setRecordingUI(false);
          setStatus("הזיהוי הופסק - לחץ להתחיל שוב", "error");
          updateSpeakingIndicator();
        }
      }, 200);
    }
  }

  // UI reset after the user stopped dictation.
  function finishStopped() {
    recognizing = false;
    stopHealth();
    setRecordingUI(false);
    setStatus("מוכן");
    updateSpeakingIndicator();
  }

  function stopRecognition() {
    userStopped = true;
    recognizing = false;
    networkFailures = 0;
    if (restartTimer) {
      // We were waiting out a backoff: the recognizer is already ended, so no
      // onend will arrive to reset the UI.
      clearTimeout(restartTimer);
      restartTimer = null;
      finishStopped();
      return;
    }
    if (recognition) {
      try { recognition.stop(); } catch { /* ignore */ }
    }
  }

  // Toggle used by both the button and the keyboard shortcut.
  async function toggleDictation() {
    if (!SR || startBtn.disabled) return;
    if (recognizing) { stopRecognition(); return; }
    await startRecognition();
  }

  // ----- Button handlers -----
  startBtn.addEventListener("click", toggleDictation);

  // Keyboard shortcut: F2 starts/stops dictation. A bare function key does not
  // type anything, so it never clashes with writing in the editor.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "F2" || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    e.preventDefault();
    if (e.repeat || confirmDialog.open || privacyDialog.open) return;
    toggleDictation();
  });

  copyBtn.addEventListener("click", async () => {
    docText = readEditorText();
    if (!docText.trim()) {
      showToast("אין טקסט להעתקה", "error");
      return;
    }
    const ok = await copyToClipboard(docText);
    if (ok) showToast("הטקסט הועתק (תואם Word ו-Notepad)", "success");
    else showToast("שגיאה בהעתקה", "error");
  });

  clearBtn.addEventListener("click", () => {
    docText = readEditorText();
    if (!docText) {
      showToast("הטקסט כבר ריק");
      return;
    }
    askConfirm("ניקוי הטקסט", "פעולה זו תמחק את כל הטקסט שתומלל. האם להמשיך?", () => {
      docText = "";
      interimText = "";
      renderEditor();
      showToast("הטקסט נוקה", "success");
    });
  });

  saveBtn.addEventListener("click", async () => {
    docText = readEditorText();
    if (!docText.trim()) {
      showToast("אין טקסט לשמירה", "error");
      return;
    }
    try {
      const blob = await buildDocx(docText);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildDocxFilename();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("הקובץ נשמר", "success");
    } catch (e) {
      console.error(e);
      showToast("שגיאה בשמירה: " + e.message, "error", 4000);
    }
  });

  function buildDocxFilename() {
    const raw = (docTitle && docTitle.value ? docTitle.value : "").trim();
    if (!raw) return `הכתבה_${formatDateForFilename()}.docx`;
    // Strip filesystem-invalid characters on Windows.
    const safe = raw.replace(/[\\/:*?"<>|]/g, "_").trim();
    return `${safe || "מסמך"}.docx`;
  }

  // ----- Clipboard with HTML format (Word compatible) -----
  async function copyToClipboard(text) {
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        const html = textToRtlHtml(text);
        const item = new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html":  new Blob([html], { type: "text/html" }),
        });
        await navigator.clipboard.write([item]);
        return true;
      }
    } catch (e) {
      console.warn("clipboard.write failed, falling back", e);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { console.warn(e); }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  function textToRtlHtml(text) {
    const escape = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const lines = text.split("\n");
    const paras = lines.map(line => {
      const safe = escape(line) || "&nbsp;";
      return `<p dir="rtl" style="direction:rtl;text-align:right;margin:0 0 6px 0;font-family:Arial,sans-serif">${safe}</p>`;
    }).join("");
    return `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"></head><body dir="rtl" style="direction:rtl;text-align:right">${paras}</body></html>`;
  }

  // ----- Confirm dialog -----
  let confirmHandler = null;
  function askConfirm(title, message, onConfirm) {
    dialogTitle.textContent = title;
    dialogMessage.textContent = message;
    confirmHandler = onConfirm;
    if (typeof confirmDialog.showModal === "function") confirmDialog.showModal();
    else if (window.confirm(message)) onConfirm();
  }
  dialogConfirm.addEventListener("click", () => {
    confirmDialog.close();
    if (confirmHandler) { const h = confirmHandler; confirmHandler = null; h(); }
  });
  dialogCancel.addEventListener("click", () => {
    confirmDialog.close();
    confirmHandler = null;
  });
  confirmDialog.addEventListener("cancel", () => { confirmHandler = null; });

  // ----- DOCX building (RTL + right-aligned) -----
  function xmlEscape(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function buildDocx(text) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip לא נטען — ודא ש-vendor/jszip.min.js קיים");
    }
    const zip = new JSZip();

    zip.file("[Content_Types].xml",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`);

    zip.folder("_rels").file(".rels",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

    const word = zip.folder("word");

    word.folder("_rels").file("document.xml.rels",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`);

    word.file("settings.xml",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:bidi/>
  <w:themeFontLang w:val="en-US" w:bidi="he-IL"/>
</w:settings>`);

    word.file("styles.xml",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
        <w:sz w:val="28"/>
        <w:szCs w:val="28"/>
        <w:rtl/>
        <w:lang w:bidi="he-IL"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:jc w:val="right"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="right"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
      <w:rtl/>
      <w:lang w:bidi="he-IL"/>
    </w:rPr>
  </w:style>
</w:styles>`);

    // Paragraph: jc=right is *physical* right when bidi isn't set on the
    // paragraph. With bidi on the paragraph, Word flips left/right
    // (right becomes the logical end = visual left). Section-level bidi
    // still keeps the page itself RTL; run-level rtl handles text shaping.
    const paragraphs = text.split("\n").map(line => {
      const safe = xmlEscape(line);
      return `<w:p><w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="right"/><w:rPr><w:rtl/><w:lang w:bidi="he-IL"/></w:rPr></w:pPr><w:r><w:rPr><w:rtl/><w:rFonts w:cs="Arial"/><w:lang w:bidi="he-IL"/></w:rPr><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
    }).join("\n");

    word.file("document.xml",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
      <w:bidi/>
    </w:sectPr>
  </w:body>
</w:document>`);

    return await zip.generateAsync({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function formatDateForFilename() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  }

  // ----- Privacy notice (shown once, before the first dictation) -----
  const PRIVACY_KEY = "privacyNoticeAck";
  function privacyAcknowledged() {
    return lsGet(PRIVACY_KEY) === "1";
  }
  function showPrivacyNotice() {
    if (typeof privacyDialog.showModal === "function") {
      if (!privacyDialog.open) privacyDialog.showModal();
    } else {
      // Very old browsers: fall back to a plain confirm and proceed.
      window.alert("האודיו נשלח לעיבוד בשירות זיהוי הדיבור של הדפדפן (Google ב-Chrome, Microsoft ב-Edge) ונדרש חיבור לאינטרנט. הטקסט עצמו נשאר במכשיר שלך.");
      lsSet(PRIVACY_KEY, "1");
      startRecognition();
    }
  }
  privacyOk.addEventListener("click", () => {
    lsSet(PRIVACY_KEY, "1");
    privacyDialog.close();
    startRecognition();
  });
  // Closing with Esc dismisses the note without starting; it will show again next time.

  // ----- Install as app (PWA) -----
  let deferredInstallPrompt = null;
  function isStandalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
           window.navigator.standalone === true;
  }
  function updateInstallButton() {
    installBtn.hidden = !deferredInstallPrompt || isStandalone();
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    updateInstallButton();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    updateInstallButton();
    showToast("האפליקציה הותקנה", "success");
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null; // a prompt event can be used only once
    updateInstallButton();
    try {
      promptEvent.prompt();
      await promptEvent.userChoice;
    } catch (err) { console.warn("install prompt failed:", err); }
  });
  updateInstallButton();

  // ----- Service worker (https / localhost only; relative path => works under a sub-path) -----
  if ("serviceWorker" in navigator &&
      (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed:", err));
    });
  }

  // ----- Init -----
  setRecordingUI(false);
  renderEditor();
  setStatus("מוכן");
})();

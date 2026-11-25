// <parser>
// Everything in this block is plain text logic (no DOM), so it can be tested with Node.

// A word as a person counts it: צה"ל, ג'ורג', תל-אביב and 3.5 are one word each.
const WORD_RE = /[\p{L}\p{N}\p{M}]+(?:(?:["'׳״’`־-]|(?<=\p{N})[.,:/](?=\p{N}))[\p{L}\p{N}\p{M}]+)*/gu;

function findWords(text) {
  return [...text.matchAll(WORD_RE)].map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }));
}

// The recognizer (Edge mostly) may attach punctuation of its own: "נקודה." / "שאלה?".
// Commands are matched without it; ordinary words keep it.
function bare(token) {
  return token === undefined ? undefined : token.replace(/^["“”]+|["“”.,?!;:]+$/gu, "") || token;
}

// Parses "תקן מילה X לY" (also "תקן את המילה X לY") starting at tokens[i].
// Only the separating "ל" is removed from the new word, so a new word that
// itself starts with ל works: "ספר לליבה" -> ליבה, "בית ללחם" -> לחם.
// The recognizer sometimes emits the separator as its own token ("ל" / "ל-"),
// in which case the new word is the token after it, untouched.
// Returns { oldWord, newWord, consumed } or null when it is not a fix command.
function parseFixCommand(tokens, i) {
  if (bare(tokens[i]) !== "תקן") return null;
  let k = i + 1;
  if (tokens[k] === "את") k++;
  if (tokens[k] !== "מילה" && tokens[k] !== "המילה") return null;
  const oldWord = bare(tokens[k + 1]);
  const next = tokens[k + 2];
  if (!oldWord || !next) return null;
  let newWord;
  let end;
  if (next === "ל" || next === "ל-") {
    if (!tokens[k + 3]) return null; // separator with no new word after it
    newWord = bare(tokens[k + 3]);
    end = k + 4;
  } else {
    newWord = bare(next);
    end = k + 3;
    if (newWord.length > 1 && newWord.charAt(0) === "ל") {
      newWord = newWord.slice(1);
      if (newWord.length > 1 && newWord.charAt(0) === "-") newWord = newWord.slice(1);
    }
  }
  return { oldWord, newWord, consumed: end - i };
}

const SINGLE_PUNCT = {
  "נקודה": ".",
  "פסיק": ",",
  "נקודותיים": ":",
  "נקודתיים": ":",
};

const HEBREW_NUMBERS = {
  "אחד": 1, "אחת": 1,
  "שניים": 2, "שתיים": 2, "שנים": 2, "שתים": 2, "שני": 2, "שתי": 2,
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
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function parseNumberFromTokens(tokens, start) {
  const t = bare(tokens[start]);
  if (!t) return null;
  if (/^\d+$/.test(t)) return { value: parseInt(t, 10), consumed: 1 };
  if (!own(HEBREW_NUMBERS, t)) return null;

  const val = HEBREW_NUMBERS[t];
  const next = bare(tokens[start + 1]);
  if (next) {
    // 11-19: units + "עשרה" / "עשר"
    if (val >= 1 && val <= 9 && (next === "עשרה" || next === "עשר")) {
      return { value: val + 10, consumed: 2 };
    }
    // 21-99: tens + "ו"+units (e.g. "עשרים וחמש")
    if (val >= 20 && val < 100) {
      const suffix = next.length > 1 && next.startsWith("ו") ? next.slice(1) : next;
      if (own(HEBREW_NUMBERS, suffix) && HEBREW_NUMBERS[suffix] <= 9) {
        return { value: val + HEBREW_NUMBERS[suffix], consumed: 2 };
      }
    }
  }
  return { value: val, consumed: 1 };
}

// "מחק 3", "מחק שלוש מילים", "מחק 3 המילים האחרונות". "מחק מילה" counts only when nothing
// else was said, because it is also an ordinary phrase ("הוא מחק מילה מהמסמך").
function parseDeleteCommand(tokens, i) {
  const word = (k) => bare(tokens[k]);
  if (word(i) !== "מחק") return null;
  if (word(i + 1) === "מילה") {
    if (word(i + 2) === "אחת") return { count: 1, consumed: 3 };
    if (tokens.length === 2 || (tokens.length === 3 && word(i + 2) === "אחרונה")) {
      return { count: 1, consumed: tokens.length };
    }
    return null;
  }
  const num = parseNumberFromTokens(tokens, i + 1);
  if (!num || num.value < 1) return null;
  let k = i + 1 + num.consumed;
  if (["מילים", "המילים", "מילה"].includes(word(k))) {
    k++;
    if (["אחרונות", "האחרונות"].includes(word(k))) k++;
  }
  return { count: num.value, consumed: k - i };
}

// What the text ends with, as far as joining the next word is concerned:
// inQuote - a quotation is open in this paragraph; glue - the next word attaches.
function endState(text) {
  const para = text.slice(text.lastIndexOf("\n") + 1);
  let inQuote = false;
  let glue = para === "" || /\s$/.test(para);
  for (let i = 0; i < para.length; i++) {
    if (para[i] !== "'") continue;
    const opens = i === 0 || /[\s(\[-]/.test(para[i - 1]);
    const inside = !opens && i + 1 < para.length && /[\p{L}\p{N}]/u.test(para[i + 1]);
    if (inside) continue; // geresh: צ'ק
    inQuote = opens;
    if (opens && i === para.length - 1) glue = true;
  }
  if (/\($/.test(para) || /\S[-־]$/.test(para)) glue = true;
  return { inQuote, glue };
}

function joinWord(text, word) {
  return endState(text).glue ? text + word : text + " " + word;
}

function deleteLastWords(text, count) {
  const words = findWords(text);
  if (!words.length) return { text, removed: 0 };
  const removed = Math.min(count, words.length);
  const cut = text.slice(0, words[words.length - removed].start);
  // Only spaces are trimmed: punctuation before the cut belongs to the kept
  // word, and a new line the user opened stays open.
  return { text: cut.replace(/[^\S\n]+$/u, ""), removed };
}

function replaceRecentWord(text, oldWord, newWord) {
  const hit = findWords(text).slice(-5).reverse().find((w) => w.word === oldWord);
  return hit ? text.slice(0, hit.start) + newWord + text.slice(hit.end) : null;
}

// Applies one recognized utterance (words and voice commands) to the text.
// Returns { text, notes: [{ text, kind }] }.
function applySpeech(text, spoken) {
  const tokens = spoken.trim().split(/\s+/).filter(Boolean);
  const notes = [];
  let autoPunct = false; // the last word came with punctuation the recognizer added itself

  const punct = (mark) => {
    // Trailing spaces stay: the user may have asked for them with "רווח".
    if (autoPunct) text = text.replace(/[.,?!;:]+$/, "");
    text += mark;
    autoPunct = false;
  };
  const opening = (mark) => { text = joinWord(text, mark); autoPunct = false; };
  const raw = (s) => { text += s; autoPunct = false; };

  let i = 0;
  while (i < tokens.length) {
    const t = bare(tokens[i]);
    const next = bare(tokens[i + 1]);

    const fix = parseFixCommand(tokens, i);
    if (fix) {
      const fixed = replaceRecentWord(text, fix.oldWord, fix.newWord);
      if (fixed === null) {
        notes.push({ text: `המילה "${fix.oldWord}" לא נמצאה ב-5 המילים האחרונות`, kind: "error" });
      } else {
        text = fixed;
        notes.push({ text: `"${fix.oldWord}" הוחלפה ב"${fix.newWord}"`, kind: "success" });
      }
      i += fix.consumed;
      continue;
    }

    const del = parseDeleteCommand(tokens, i);
    if (del) {
      const r = deleteLastWords(text, del.count);
      text = r.text;
      autoPunct = false;
      notes.push(
        r.removed === 0 ? { text: "אין מה למחוק", kind: "error" }
          : { text: r.removed === 1 ? "נמחקה מילה אחת" : `נמחקו ${r.removed} מילים`, kind: "success" });
      i += del.consumed;
      continue;
    }

    // Two-word commands
    if (t === "סימן" && next === "שאלה") { punct("?"); i += 2; continue; }
    if (t === "סימן" && next === "קריאה") { punct("!"); i += 2; continue; }
    if (t === "נקודה" && next === "פסיק") { punct(";"); i += 2; continue; }
    if (t === "שורה" && next === "חדשה") { raw("\n"); i += 2; continue; }
    // Backwards-compat: keep the old "רד שורה" phrase working too.
    if (t === "רד" && next === "שורה") { raw("\n"); i += 2; continue; }
    if (t === "פסקה" && next === "חדשה") { raw("\n\n"); i += 2; continue; }
    if (t === "פתח" && next === "סוגריים") { opening("("); i += 2; continue; }
    if (t === "סגור" && next === "סוגריים") { raw(")"); i += 2; continue; }

    // The first "ציטוט" opens (attached to the next word), the second closes.
    if (t === "ציטוט") {
      if (endState(text).inQuote) raw("'");
      else opening("'");
      i += 1;
      continue;
    }

    if (t === "מקף") { raw("-"); i += 1; continue; }

    // Literal single-character space
    if (t === "רווח") {
      if (!text.endsWith("\n")) raw(" ");
      i += 1;
      continue;
    }

    if (own(SINGLE_PUNCT, t)) { punct(SINGLE_PUNCT[t]); i += 1; continue; }

    if (/^[.,?!;:]+$/.test(tokens[i])) text += tokens[i];
    else text = joinWord(text, tokens[i]);
    autoPunct = /[.,?!;:]$/.test(tokens[i]);
    i += 1;
  }
  return { text, notes };
}

// ----- Word file (RTL) -----
function xmlEscape(s) {
  return s
    // Characters XML does not allow would make Word refuse the file.
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Paragraphs are bidi (see the Normal style) and have no explicit alignment: a bidi
// paragraph starts at the right, while jc="right" there would mean the left side.
function docxParagraph(line) {
  if (!line) return "<w:p/>";
  const body = line.split("\t")
    .map((part) => (part ? `<w:t xml:space="preserve">${xmlEscape(part)}</w:t>` : ""))
    .join("<w:tab/>");
  return `<w:p><w:r><w:rPr><w:rtl/></w:rPr>${body}</w:r></w:p>`;
}

function docxFiles(text) {
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PKG = "http://schemas.openxmlformats.org/package/2006";
  const WML = "application/vnd.openxmlformats-officedocument.wordprocessingml";
  const paragraphs = text.replace(/\n+$/, "").split("\n").map(docxParagraph).join("\n");
  return {
    "[Content_Types].xml": `${head}<Types xmlns="${PKG}/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="${WML}.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="${WML}.settings+xml"/>
</Types>`,
    "_rels/.rels": `${head}<Relationships xmlns="${PKG}/relationships">
  <Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    "word/_rels/document.xml.rels": `${head}<Relationships xmlns="${PKG}/relationships">
  <Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="${REL}/settings" Target="settings.xml"/>
</Relationships>`,
    "word/settings.xml": `${head}<w:settings ${W}>
  <w:themeFontLang w:val="en-US" w:bidi="he-IL"/>
</w:settings>`,
    "word/styles.xml": `${head}<w:styles ${W}>
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
      <w:sz w:val="28"/><w:szCs w:val="28"/>
      <w:lang w:val="en-US" w:bidi="he-IL"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault/>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:bidi/></w:pPr>
  </w:style>
</w:styles>`,
    "word/document.xml": `${head}<w:document ${W}>
  <w:body>
${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
      <w:bidi/>
    </w:sectPr>
  </w:body>
</w:document>`,
  };
}

// A name Windows accepts, or "" when nothing usable is left.
function safeFileName(raw) {
  let name = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[\s.]+$/, "").trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name = "_" + name;
  return name;
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
  const $ = (id) => document.getElementById(id);
  const startBtn = $("start-btn");
  const startText = startBtn.querySelector(".btn-text");
  const editor = $("editor");
  const docTitle = $("doc-title");
  const fontIncBtn = $("font-inc");
  const fontDecBtn = $("font-dec");
  const undoBtn = $("undo-btn");
  const redoBtn = $("redo-btn");
  const statusPill = $("status");
  const statusText = $("status-text");
  const toast = $("toast");
  const commandsToggle = $("commands-toggle");
  const commandsGrid = $("commands-grid");
  const confirmDialog = $("confirm-dialog");
  const installBtn = $("install-btn");
  const privacyDialog = $("privacy-dialog");

  // localStorage can throw (private mode / blocked storage) - never let it break the app.
  function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, val); } catch { /* ignore */ } }
  function lsDel(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }

  // ----- State -----
  let docText = "";
  let interimText = "";
  let composing = false; // an input method is in the middle of a word: do not touch the DOM

  // ----- Status / toast -----
  const LISTENING = "מקליט... דבר עכשיו";
  let statusTimer = null;
  function setStatus(text, kind) {
    clearTimeout(statusTimer); // a pending "back to normal" must not overwrite this one
    statusText.textContent = text;
    statusPill.classList.remove("active", "success", "error");
    if (kind) statusPill.classList.add(kind);
  }

  function flashStatus(text, kind, restoreMs = 2500) {
    setStatus(text, kind);
    statusTimer = setTimeout(() => {
      if (phase === "on") setStatus(LISTENING, "active");
      else if (phase === "idle") setStatus("מוכן");
    }, restoreMs);
  }

  let toastTimer = null;
  function showToast(message, kind = "info", duration = 2400) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = "toast show " + kind;
    toastTimer = setTimeout(() => { toast.classList.remove("show"); }, duration);
  }

  // ----- Theme -----
  function applyTheme(light) {
    document.body.classList.toggle("light", light);
    $("icon-moon").style.display = light ? "none" : "block";
    $("icon-sun").style.display = light ? "block" : "none";
  }
  applyTheme(lsGet("theme") === "light");
  $("theme-toggle").addEventListener("click", () => {
    const light = !document.body.classList.contains("light");
    applyTheme(light);
    lsSet("theme", light ? "light" : "dark");
  });

  // ----- Commands panel collapse (remembered; closed at first on a phone) -----
  function setCommands(open) {
    commandsGrid.classList.toggle("collapsed", !open);
    commandsToggle.textContent = open ? "הסתר" : "הצג";
    commandsToggle.setAttribute("aria-expanded", String(open));
  }
  const savedCommands = lsGet("commandsOpen");
  setCommands(savedCommands ? savedCommands === "1" : window.innerWidth > 640);
  commandsToggle.addEventListener("click", () => {
    const open = commandsGrid.classList.contains("collapsed");
    setCommands(open);
    lsSet("commandsOpen", open ? "1" : "0");
  });

  // ----- Editor font size -----
  const FONT_DEFAULT = 19, FONT_MIN = 12, FONT_MAX = 40, FONT_STEP = 2;
  let editorFontSize = parseInt(lsGet("editorFontSize"), 10);
  if (!Number.isFinite(editorFontSize)) editorFontSize = FONT_DEFAULT;

  function setFontSize(size) {
    editorFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, size));
    editor.style.fontSize = editorFontSize + "px";
    $("font-size-display").textContent = String(editorFontSize);
    fontIncBtn.disabled = editorFontSize >= FONT_MAX;
    fontDecBtn.disabled = editorFontSize <= FONT_MIN;
  }
  setFontSize(editorFontSize);
  function changeFont(step) {
    setFontSize(editorFontSize + step);
    lsSet("editorFontSize", String(editorFontSize));
  }
  fontIncBtn.addEventListener("click", () => changeFont(FONT_STEP));
  fontDecBtn.addEventListener("click", () => changeFont(-FONT_STEP));

  // ----- Editor -----
  // The editor holds plain text with "\n" line breaks (white-space: pre-wrap), an optional
  // span with the words still being recognized, and - as browsers do - one extra "\n" at the
  // end when the text ends with a line break, so that the empty line is visible.
  // Rich editing would turn every Enter into a <div>, and blank lines came back doubled.
  try { editor.contentEditable = "plaintext-only"; } catch { /* stays "true" */ }

  function isInterim(node) {
    return node.nodeType === 1 && node.classList.contains("interim-inline");
  }

  // The text of the editor, or only what comes before a given DOM position.
  function rawText(stopNode, stopOffset) {
    let out = "";
    let done = false;
    (function walk(node) {
      if (done || isInterim(node)) {
        if (stopNode && node.contains(stopNode)) done = true;
        return;
      }
      if (node.nodeType === 3) {
        if (node === stopNode) { out += node.data.slice(0, stopOffset); done = true; } else out += node.data;
        return;
      }
      if (node.nodeName === "BR") { out += "\n"; return; }
      if (node !== editor && /^(DIV|P)$/.test(node.nodeName) && out && !out.endsWith("\n")) out += "\n";
      for (let i = 0; i < node.childNodes.length; i++) {
        if (node === stopNode && i === stopOffset) { done = true; return; }
        walk(node.childNodes[i]);
        if (done) return;
      }
      if (node === stopNode) done = true;
    })(editor);
    return out.replace(/\r\n?/g, "\n").replace(/ /g, " ");
  }

  function readEditorText() {
    const raw = rawText();
    return raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  }

  function getSelectionOffsets() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!editor.contains(r.startContainer) || !editor.contains(r.endContainer)) return null;
    const max = readEditorText().length;
    return [
      Math.min(max, rawText(r.startContainer, r.startOffset).length),
      Math.min(max, rawText(r.endContainer, r.endOffset).length),
    ];
  }

  function nearBottom() {
    return editor.scrollTop + editor.clientHeight >= editor.scrollHeight - 80;
  }

  // Writes docText + interimText into the editor. The caret stays where the user put it;
  // only a caret at the very end moves along with the dictated text.
  function renderEditor() {
    if (composing) return;
    const follow = nearBottom();
    const focused = document.activeElement === editor;
    const sel = focused ? getSelectionOffsets() : null;
    const oldLength = focused ? readEditorText().length : 0;

    editor.textContent = "";
    const node = document.createTextNode(docText);
    if (docText) editor.appendChild(node);
    if (interimText) {
      const span = document.createElement("span");
      span.className = "interim-inline";
      span.contentEditable = "false";
      editor.appendChild(span);
      updateInterim();
    }
    if (docText.endsWith("\n")) editor.appendChild(document.createTextNode("\n"));

    if (sel) {
      const range = document.createRange();
      const place = (offset, set) => {
        if (!docText) set.call(range, editor, 0);
        else set.call(range, node, offset >= oldLength ? docText.length : Math.min(offset, docText.length));
      };
      place(sel[0], range.setStart);
      place(sel[1], range.setEnd);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
    }
    if (follow) editor.scrollTop = editor.scrollHeight;
    updateUi();
  }

  // While words are still being recognized only their own span changes, so typing and the
  // caret elsewhere in the text are left alone.
  function updateInterim() {
    const span = editor.querySelector(".interim-inline");
    if (!span || !interimText) { renderEditor(); return; }
    const follow = nearBottom();
    const sep = docText && !/\s$/.test(docText) ? " " : "";
    span.textContent = sep + interimText;
    if (follow) editor.scrollTop = editor.scrollHeight;
    updateUi();
  }

  function updateUi() {
    editor.classList.toggle("is-empty", !docText && !interimText);
    const text = docText.trim();
    const words = text ? text.split(/\s+/).length : 0;
    $("doc-stats").textContent = words === 1 ? "מילה אחת" : `${words} מילים`;
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
  }

  // ----- Undo / redo -----
  // The browser's own undo does not survive text that is written by the app, so the app
  // keeps its own: one step per dictated utterance or command, and one per burst of typing.
  const UNDO_MAX = 200;
  const undoStack = [];
  const redoStack = [];
  let typingUntil = 0;

  function remember() {
    if (undoStack[undoStack.length - 1] !== docText) undoStack.push(docText);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
  }

  function setText(text) {
    if (text === docText) return;
    remember();
    typingUntil = 0;
    docText = text;
    saveDraft();
    renderEditor();
  }

  function travel(from, to) {
    if (!from.length) return;
    docText = readEditorText();
    let text = from.pop();
    if (text === docText && from.length) text = from.pop();
    to.push(docText);
    typingUntil = 0;
    docText = text;
    saveDraft();
    renderEditor();
  }
  const undo = () => travel(undoStack, redoStack);
  const redo = () => travel(redoStack, undoStack);
  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);

  editor.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    // e.code: the same key in the Hebrew layout gives another e.key
    if (e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (e.code === "KeyY") { e.preventDefault(); redo(); }
  });
  editor.addEventListener("beforeinput", (e) => {
    if (e.inputType === "historyUndo") { e.preventDefault(); undo(); }
    else if (e.inputType === "historyRedo") { e.preventDefault(); redo(); }
    else if (/^format/.test(e.inputType)) e.preventDefault();
  });

  function onUserEdit() {
    const text = readEditorText();
    if (text !== docText) {
      if (Date.now() > typingUntil) remember();
      typingUntil = Date.now() + 1200;
      docText = text;
      saveDraft();
    }
    updateUi();
  }
  editor.addEventListener("input", onUserEdit);
  editor.addEventListener("compositionstart", () => { composing = true; });
  editor.addEventListener("compositionend", () => {
    composing = false;
    onUserEdit();
    const speech = waitingSpeech;
    waitingSpeech = "";
    if (speech) commit(speech);
    else renderEditor();
  });
  editor.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n") : "";
    if (!text) return;
    typingUntil = 0; // a paste is an undo step of its own
    document.execCommand("insertText", false, text);
    onUserEdit();
    typingUntil = 0;
  });

  // ----- Draft: the text survives a reload, a crash and closing the window -----
  const DRAFT_KEY = "draft";
  let draftTimer = null;
  function writeDraft() {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (!docText && !docTitle.value) lsDel(DRAFT_KEY);
    else lsSet(DRAFT_KEY, JSON.stringify({ text: docText, title: docTitle.value }));
  }
  function saveDraft() {
    if (!draftTimer) draftTimer = setTimeout(writeDraft, 400);
  }
  docTitle.addEventListener("input", saveDraft);
  // Only what is still waiting: another open window may have saved newer text since.
  window.addEventListener("pagehide", () => { if (draftTimer) writeDraft(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && draftTimer) writeDraft();
  });
  function restoreDraft() {
    try {
      const d = JSON.parse(lsGet(DRAFT_KEY));
      if (d && typeof d.text === "string") docText = d.text;
      if (d && typeof d.title === "string") docTitle.value = d.title;
    } catch { /* no draft */ }
    return !!docText;
  }

  // ----- Speech recognition -----
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const MAX_FAILURES = 5;
  const BACKOFF_BASE_MS = 1000;
  const BACKOFF_MAX_MS = 15000;
  const SHORTCUT_LABEL = "F2";

  // idle -> starting -> on -> stopping -> idle;  on -> waiting (retry after a failure) -> on
  let phase = "idle";
  let recognition = null;   // the live recognizer; events of an older one are ignored
  let failures = 0;         // failed sessions in a row
  let restartTimer = null;
  let stopTimer = null;
  let startAgain = false;   // pressed "start" while the previous session was still closing
  let permissionAdvised = false;
  let isSpeaking = false;
  let lastActivityAt = 0;
  let healthTimer = null;

  // Single place that syncs everything that shows whether dictation is on.
  function setPhase(p) {
    phase = p;
    const on = p === "on" || p === "waiting";
    startBtn.classList.toggle("recording", on);
    startBtn.classList.toggle("busy", p === "starting");
    const label = on ? "עצור הכתבה" : "התחל הכתבה";
    startText.textContent = label;
    startBtn.setAttribute("aria-pressed", String(on));
    startBtn.title = `${label} (${SHORTCUT_LABEL})`;
    if (p !== "on") isSpeaking = false;
    updateSpeakingIndicator();
    if (on) { startHealth(); keepAwake(true); } else { stopHealth(); keepAwake(false); }
  }

  // The green "speaking" indicator is driven by the recognizer's own speechstart/speechend,
  // which use the same gating that decides what is transcribed: fans, distant voices and
  // taps do not light it.
  function updateSpeakingIndicator() {
    $("speaking-indicator").classList.toggle("active", phase === "on" && isSpeaking);
  }
  function setSpeaking(v) { isSpeaking = v; updateSpeakingIndicator(); }

  // Keep the screen on while dictating (phones and laptops dim after a minute without touch).
  let wakeLock = null;
  let wantAwake = false;
  async function keepAwake(on) {
    wantAwake = on;
    if (!on) { if (wakeLock) wakeLock.release().catch(() => {}); wakeLock = null; return; }
    if (wakeLock || !navigator.wakeLock) return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (!wantAwake || wakeLock) { lock.release().catch(() => {}); return; }
      wakeLock = lock;
      lock.addEventListener("release", () => { if (wakeLock === lock) wakeLock = null; });
    } catch { /* not allowed right now */ }
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && wantAwake) keepAwake(true);
  });

  // Health watchdog: the engine sometimes goes silent without ending. After HEALTH_IDLE_MS
  // with no sign of life, stop it; onend starts a new session. Never while someone is
  // talking, unless even that has brought no result for a long time.
  const HEALTH_IDLE_MS = 10000;
  const HEALTH_STUCK_MS = 25000;
  function startHealth() {
    if (healthTimer) return;
    lastActivityAt = Date.now();
    healthTimer = setInterval(() => {
      if (phase !== "on" || !recognition) return;
      const idle = Date.now() - lastActivityAt;
      if (idle > (isSpeaking ? HEALTH_STUCK_MS : HEALTH_IDLE_MS)) {
        lastActivityAt = Date.now();
        try { recognition.stop(); } catch { /* ignore */ }
      }
    }, 3000);
  }
  function stopHealth() {
    clearInterval(healthTimer);
    healthTimer = null;
  }

  // ----- Mic permission (one-time, persistent) -----
  async function ensureMicPermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return true;

    let state = "prompt";
    if (navigator.permissions) {
      try { state = (await navigator.permissions.query({ name: "microphone" })).state; }
      catch { /* not supported, treat as prompt */ }
    }
    if (state === "granted") return true;
    if (state === "denied") {
      setStatus("גישה למיקרופון נחסמה", "error");
      showToast("גישה למיקרופון נחסמה. פתח את הגדרות האתר בדפדפן (סמל הנעילה בשורת הכתובת) ואפשר את המיקרופון.", "error", 7000);
      return false;
    }
    if (!permissionAdvised) {
      permissionAdvised = true;
      showToast('כדי שלא יישאל בכל פעם — בחר "אפשר תמיד" / "Allow on every visit" בדיאלוג', "info", 6500);
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch (err) {
      const name = err && err.name;
      const message = name === "NotFoundError" ? "לא נמצא מיקרופון. חבר מיקרופון ונסה שוב."
        : name === "NotReadableError" ? "המיקרופון תפוס על ידי תוכנה אחרת"
        : "הרשאת המיקרופון נדחתה";
      setStatus(message, "error");
      showToast(message, "error", 5000);
      return false;
    }
  }

  // ----- Recognition lifecycle -----
  async function startDictation() {
    if (phase !== "idle") return; // ignore double clicks / repeated F2 while starting
    if (!privacyAcknowledged()) { showPrivacyNotice(); return; }

    setPhase("starting");
    setStatus("מתחיל...");
    if (!(await ensureMicPermission())) { setPhase("idle"); return; }
    failures = 0;
    openSession();
  }

  function openSession() {
    clearTimeout(restartTimer);
    restartTimer = null;
    const rec = new SR();
    recognition = rec;
    rec.lang = "he-IL";
    // Chrome on Android repeats words in continuous mode; there, short sessions follow
    // one another instead.
    rec.continuous = !IS_ANDROID;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let startedAt = 0;
    let gotResult = false;
    let error = "";
    let committed = 0; // results that already went into the text
    const mine = (fn) => (e) => { if (rec === recognition) fn(e); };

    rec.onstart = mine(() => {
      startedAt = Date.now();
      lastActivityAt = startedAt;
      if (phase === "stopping") return; // stopped before it really started; onend follows
      setPhase("on");
      // After a failure keep its message until the service proves it is back.
      if (failures === 0) setStatus(LISTENING, "active");
    });
    rec.onspeechstart = mine(() => { lastActivityAt = Date.now(); setSpeaking(true); });
    rec.onspeechend = mine(() => setSpeaking(false));
    // Safety net: soundend without a paired speechend.
    rec.onsoundend = mine(() => setSpeaking(false));
    rec.onerror = mine((e) => {
      if (e.error !== "no-speech") { error = e.error || "unknown"; console.warn("recognition error:", error); }
    });

    rec.onresult = mine((event) => {
      lastActivityAt = Date.now();
      gotResult = true;
      if (failures > 0) { // the service is reachable again
        failures = 0;
        if (phase === "on") setStatus(LISTENING, "active");
      }
      let finals = "";
      let interim = "";
      for (let i = committed; i < event.results.length; i++) {
        const result = event.results[i];
        const said = result[0].transcript;
        // Android marks partial results as final, with zero confidence.
        const isFinal = result.isFinal && !(IS_ANDROID && result[0].confidence === 0);
        if (isFinal && !interim) { finals += said + " "; committed = i + 1; }
        else interim += said + " ";
      }
      interimText = interim.trim().replace(/\s+/g, " ");
      if (finals.trim()) commit(finals);
      else updateInterim();
    });

    rec.onend = mine(() => {
      recognition = null;
      // Words that were on screen but never became final (lost connection, engine restart)
      // are kept rather than disappearing.
      const leftover = interimText;
      interimText = "";
      if (leftover) commit(leftover);
      else renderEditor();
      sessionEnded({ error, gotResult, lasted: startedAt ? Date.now() - startedAt : 0 });
    });

    try { rec.start(); }
    catch (err) {
      console.warn("recognition start failed:", err);
      recognition = null;
      sessionEnded({ error: "start", gotResult: false, lasted: 0 });
    }
  }

  const FATAL = {
    "not-allowed": ["גישה למיקרופון נחסמה", "אשר את ההרשאה דרך סמל הנעילה בשורת הכתובת ובחר 'אפשר תמיד'"],
    "service-not-allowed": ["הדפדפן חסם את זיהוי הדיבור", "הדפדפן לא מאפשר זיהוי דיבור כאן. פתח את האתר ב-Chrome או ב-Edge."],
    "audio-capture": ["לא נמצא מיקרופון", "לא נמצא מיקרופון פעיל. בדוק שהמיקרופון מחובר ונסה שוב."],
    "language-not-supported": ["הדפדפן לא תומך בהכתבה בעברית", "הדפדפן הזה לא תומך בזיהוי דיבור בעברית. נסה ב-Chrome או ב-Edge."],
  };

  function sessionEnded({ error, gotResult, lasted }) {
    if (phase === "stopping") { finishStopped(); return; }
    if (phase === "idle") return;

    if (Object.prototype.hasOwnProperty.call(FATAL, error)) {
      setPhase("idle");
      setStatus(FATAL[error][0], "error");
      showToast(FATAL[error][1], "error", 7000);
      return;
    }

    // A session that worked, or just heard nothing for a while, is simply renewed. One that
    // failed or died at once is retried with growing delays and not forever, so two windows
    // fighting over the microphone or a missing connection never spin in a loop.
    const failed = error || (!gotResult && lasted < 1000);
    if (!failed) {
      failures = 0;
      openSession();
      return;
    }
    failures = gotResult || lasted > 8000 ? 1 : failures + 1;
    const offline = error === "network";
    if (failures >= MAX_FAILURES) {
      setPhase("idle");
      const text = offline ? "אין חיבור לשירות זיהוי הדיבור" : "זיהוי הדיבור נעצר";
      setStatus(text, "error");
      showToast(offline
        ? 'אין חיבור לשירות זיהוי הדיבור. בדוק את חיבור האינטרנט ולחץ "התחל הכתבה" שוב.'
        : 'זיהוי הדיבור נעצר שוב ושוב. בדוק שאין חלון או תוכנה אחרים שמשתמשים במיקרופון, ולחץ "התחל הכתבה".', "error", 8000);
      return;
    }
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, failures - 1));
    setPhase("waiting");
    setStatus(`${offline ? "אין חיבור לשירות זיהוי הדיבור" : "הזיהוי נקטע"} — ניסיון חוזר בעוד ${Math.round(delay / 1000)} שנ'`, "error");
    restartTimer = setTimeout(openSession, delay);
  }
  window.addEventListener("online", () => {
    if (phase === "waiting" && restartTimer) openSession();
  });

  function stopDictation() {
    if (phase === "waiting" && !recognition) { // between sessions: no onend will come
      clearTimeout(restartTimer);
      restartTimer = null;
      finishStopped();
      return;
    }
    setPhase("stopping");
    setStatus("מסיים...");
    if (!recognition) { finishStopped(); return; }
    try { recognition.stop(); } catch { /* ignore */ }
    // If the engine never reports its end, do not leave the button waiting for it.
    stopTimer = setTimeout(() => {
      const rec = recognition;
      recognition = null;
      if (rec) { try { rec.abort(); } catch { /* ignore */ } }
      const leftover = interimText;
      interimText = "";
      if (leftover) commit(leftover);
      else renderEditor();
      finishStopped();
    }, 3000);
  }

  function finishStopped() {
    clearTimeout(stopTimer);
    stopTimer = null;
    setPhase("idle");
    setStatus("מוכן");
    if (startAgain) {
      startAgain = false;
      startDictation();
    }
  }

  // Dictated words go into the text - after the input method finishes its word, if one is
  // in the middle of it.
  let waitingSpeech = "";
  function commit(spoken) {
    if (composing) { waitingSpeech += spoken + " "; return; }
    docText = readEditorText(); // the user may have typed since
    const r = applySpeech(docText, spoken);
    if (r.text === docText) renderEditor();
    else setText(r.text);
    if (r.notes.length) {
      const n = r.notes[r.notes.length - 1];
      flashStatus(n.text, n.kind);
    }
  }

  // Toggle used by both the button and the keyboard shortcut.
  function toggleDictation() {
    if (!SR) return;
    if (phase === "idle") startDictation();
    else if (phase === "stopping") startAgain = !startAgain;
    else if (phase !== "starting") stopDictation();
  }
  startBtn.addEventListener("click", toggleDictation);

  // Keyboard shortcut: F2 starts/stops dictation. A bare function key does not
  // type anything, so it never clashes with writing in the editor.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "F2" || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    e.preventDefault();
    if (e.repeat || confirmDialog.open || privacyDialog.open) return;
    toggleDictation();
  });

  // ----- Copy / clear / save -----
  $("copy-btn").addEventListener("click", async () => {
    docText = readEditorText();
    if (!docText.trim()) { showToast("אין טקסט להעתקה", "error"); return; }
    if (await copyToClipboard(docText)) showToast("הטקסט הועתק (תואם Word ו-Notepad)", "success");
    else showToast("שגיאה בהעתקה", "error");
  });

  $("clear-btn").addEventListener("click", () => {
    docText = readEditorText();
    if (!docText) { showToast("הטקסט כבר ריק"); return; }
    askConfirm("ניקוי הטקסט", "כל הטקסט יימחק. אפשר לבטל אחר כך בכפתור הביטול או ב-Ctrl+Z, כל עוד החלון פתוח.", () => {
      docText = readEditorText();
      interimText = "";
      setText("");
      showToast("הטקסט נוקה", "success");
    });
  });

  $("save-btn").addEventListener("click", async () => {
    docText = readEditorText();
    if (!docText.trim()) { showToast("אין טקסט לשמירה", "error"); return; }
    try {
      const blob = await buildDocx(docText);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeFileName(docTitle.value) || "הכתבה_" + formatDateForFilename()}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      showToast("הקובץ נשמר", "success");
    } catch (e) {
      console.error(e);
      showToast("שגיאה בשמירה: " + e.message, "error", 4000);
    }
  });

  function buildDocx(text) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip לא נטען — ודא ש-vendor/jszip.min.js קיים");
    }
    const zip = new JSZip();
    for (const [path, xml] of Object.entries(docxFiles(text))) zip.file(path, xml);
    return zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }

  function formatDateForFilename() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  // Clipboard with HTML format (Word compatible)
  async function copyToClipboard(text) {
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([textToRtlHtml(text)], { type: "text/html" }),
        })]);
        return true;
      }
    } catch (e) { console.warn("clipboard.write failed, falling back", e); }
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
      ta.remove();
      return ok;
    } catch { return false; }
  }

  function textToRtlHtml(text) {
    const paras = text.split("\n").map((line) => {
      const safe = xmlEscape(line).replace(/ {2}/g, " &nbsp;") || "&nbsp;";
      return `<p dir="rtl" style="direction:rtl;text-align:right;margin:0 0 6px 0;font-family:Arial,sans-serif">${safe}</p>`;
    }).join("");
    return `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"></head><body dir="rtl" style="direction:rtl;text-align:right">${paras}</body></html>`;
  }

  // ----- Confirm dialog -----
  let confirmHandler = null;
  function askConfirm(title, message, onConfirm) {
    $("dialog-title").textContent = title;
    $("dialog-message").textContent = message;
    confirmHandler = onConfirm;
    if (typeof confirmDialog.showModal === "function") confirmDialog.showModal();
    else if (window.confirm(message)) onConfirm();
  }
  $("dialog-confirm").addEventListener("click", () => {
    const h = confirmHandler;
    confirmDialog.close();
    if (h) h();
  });
  $("dialog-cancel").addEventListener("click", () => confirmDialog.close());
  confirmDialog.addEventListener("close", () => { confirmHandler = null; });

  // ----- Privacy notice (shown once, before the first dictation) -----
  const PRIVACY_KEY = "privacyNoticeAck";
  let privacyAck = lsGet(PRIVACY_KEY) === "1"; // in memory too, for blocked storage
  function privacyAcknowledged() { return privacyAck; }
  function acknowledgePrivacy() {
    privacyAck = true;
    lsSet(PRIVACY_KEY, "1");
    startDictation();
  }
  function showPrivacyNotice() {
    if (typeof privacyDialog.showModal === "function") {
      if (!privacyDialog.open) privacyDialog.showModal();
    } else {
      // Very old browsers: fall back to a plain alert and proceed.
      window.alert("האודיו נשלח לעיבוד בשירות זיהוי הדיבור של הדפדפן (Google ב-Chrome, Microsoft ב-Edge) ונדרש חיבור לאינטרנט. הטקסט עצמו נשאר במכשיר שלך.");
      acknowledgePrivacy();
    }
  }
  $("privacy-ok").addEventListener("click", () => {
    privacyDialog.close();
    acknowledgePrivacy();
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
  const restored = restoreDraft();
  setPhase("idle");
  renderEditor();
  editor.scrollTop = editor.scrollHeight;
  if (SR) {
    setStatus("מוכן");
    if (restored) showToast("הטקסט מהפעם הקודמת שוחזר");
  } else {
    startBtn.disabled = true;
    setStatus("הדפדפן לא תומך בזיהוי דיבור", "error");
    showToast("הדפדפן לא תומך בזיהוי דיבור. פתח את האתר ב-Chrome או ב-Edge. אפשר להמשיך להקליד, להעתיק ולשמור.", "error", 9000);
  }
})();

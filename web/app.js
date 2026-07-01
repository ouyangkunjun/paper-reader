const state = {
  papers: [],
  folders: [],
  activePaper: null,
  activePayload: null,
  notes: { items: [] },
  pendingPoint: null,
  editingIndex: null,
  filter: "all",
  translating: false,
  translateConfig: null,
  uploadTargetFolder: "",
  asking: false,
  askImage: null,
  drawMode: false,
  drawTool: "pen",
  drawColor: "#e74c3c",
  drawSize: 3,
  drawCanvases: {},
  folderExpanded: {},
  translateSource: null,
  relatedSearch: {
    paperId: null,
    running: false,
    hasContent: false,
    evtSource: null,
  },
  batchMode: false,
  batchSelected: new Set(),
  batchSelectedFolders: new Set(),
  currentUser: null,
  replyTo: null,
  authMode: "login", // "login" or "register"
  paperScope: "personal", // "personal" or "public"
  translateMode: null, // null | "select" | "screenshot"
  loadVersion: 0,
};

const PAPER_REFRESH_INTERVAL_MS = 60000;

const els = {
  paperCount: document.querySelector("#paperCount"),
  paperList: document.querySelector("#paperList"),
  searchInput: document.querySelector("#searchInput"),
  filterBar: document.querySelector("#filterBar"),
  scanBtn: document.querySelector("#scanBtn"),
  scopeToggleBtn: document.querySelector("#scopeToggleBtn"),
  hideLibraryBtn: document.querySelector("#hideLibraryBtn"),
  showLibraryBtn: document.querySelector("#showLibraryBtn"),
  showLibraryTopBtn: document.querySelector("#showLibraryTopBtn"),
  activeTitle: document.querySelector("#activeTitle"),
  activeMeta: document.querySelector("#activeMeta"),
  statusPill: document.querySelector("#statusPill"),
  toggleReadBtn: document.querySelector("#toggleReadBtn"),
  openOriginalBtn: document.querySelector("#openOriginalBtn"),
  openTranslationBtn: document.querySelector("#openTranslationBtn"),
  extractTitleBtn: document.querySelector("#extractTitleBtn"),
  uploadTranslationBtn: document.querySelector("#uploadTranslationBtn"),
  translateBtn: document.querySelector("#translateBtn"),
  translateMenu: document.querySelector("#translateMenu"),
  translateDropdown: document.querySelector("#translateDropdown"),
  addPaperBtn: document.querySelector("#addPaperBtn"),
  addDropdown: document.querySelector("#addDropdown"),
  addDropdownMenu: document.querySelector("#addDropdownMenu"),
  addFileBtn: document.querySelector("#addFileBtn"),
  addFolderBtn: document.querySelector("#addFolderBtn"),
  newFolderBtn: document.querySelector("#newFolderBtn"),
  fileInput: document.querySelector("#fileInput"),
  translationInput: document.querySelector("#translationInput"),
  folderInput: document.querySelector("#folderInput"),
  dropZone: document.querySelector("#dropZone"),
  saveNotesBtn: document.querySelector("#saveNotesBtn"),
  saveStatus: document.querySelector("#saveStatus"),
  originalName: document.querySelector("#originalName"),
  translationName: document.querySelector("#translationName"),
  originalViewer: document.querySelector("#originalViewer"),
  translationViewer: document.querySelector("#translationViewer"),
  addNoteBtn: document.querySelector("#addNoteBtn"),
  hideNotesBtn: document.querySelector("#hideNotesBtn"),
  showNotesBtn: document.querySelector("#showNotesBtn"),
  showNotesTopBtn: document.querySelector("#showNotesTopBtn"),
  showAskBtn: document.querySelector("#showAskBtn"),
  showAskTopBtn: document.querySelector("#showAskTopBtn"),
  noteLocation: document.querySelector("#noteLocation"),
  noteText: document.querySelector("#noteText"),
  notesList: document.querySelector("#notesList"),
  askBtn: document.querySelector("#askBtn"),
  askInput: document.querySelector("#askInput"),
  askHistory: document.querySelector("#askHistory"),
  askHint: document.querySelector("#askHint"),
  askImgBtn: document.querySelector("#askImgBtn"),
  askImgInput: document.querySelector("#askImgInput"),
  askImgPreview: document.querySelector("#askImgPreview"),
  hideAskBtn: document.querySelector("#hideAskBtn"),
  settingsBtn: document.querySelector("#settingsBtn"),
  settingsOverlay: document.querySelector("#settingsOverlay"),
  settingsCloseBtn: document.querySelector("#settingsCloseBtn"),
  settingsBaseUrl: document.querySelector("#settingsBaseUrl"),
  settingsApiKey: document.querySelector("#settingsApiKey"),
  settingsModel: document.querySelector("#settingsModel"),
  settingsAskMode: document.querySelector("#settingsAskMode"),
  settingsSaveBtn: document.querySelector("#settingsSaveBtn"),
  currentModel: document.querySelector("#currentModel"),
  drawModeBtn: document.querySelector("#drawModeBtn"),
  drawToolbar: document.querySelector("#drawToolbar"),
  drawPenBtn: document.querySelector("#drawPenBtn"),
  drawHighlightBtn: document.querySelector("#drawHighlightBtn"),
  drawLineBtn: document.querySelector("#drawLineBtn"),
  drawArrowBtn: document.querySelector("#drawArrowBtn"),
  drawUnderlineBtn: document.querySelector("#drawUnderlineBtn"),
  drawRectBtn: document.querySelector("#drawRectBtn"),
  drawEllipseBtn: document.querySelector("#drawEllipseBtn"),
  drawEraserBtn: document.querySelector("#drawEraserBtn"),
  drawAreaEraseBtn: document.querySelector("#drawAreaEraseBtn"),
  drawColor: document.querySelector("#drawColor"),
  drawSize: document.querySelector("#drawSize"),
  drawClearBtn: document.querySelector("#drawClearBtn"),
  drawExitBtn: document.querySelector("#drawExitBtn"),
  relatedBtn: document.querySelector("#relatedBtn"),
  saveToMyLibraryBtn: document.querySelector("#saveToMyLibraryBtn"),
  relatedOverlay: document.querySelector("#relatedOverlay"),
  relatedCancelBtn: document.querySelector("#relatedCancelBtn"),
  relatedCloseBtn: document.querySelector("#relatedCloseBtn"),
  relatedKeywords: document.querySelector("#relatedKeywords"),
  relatedResults: document.querySelector("#relatedResults"),
  batchSelectBtn: document.querySelector("#batchSelectBtn"),
  batchBar: document.querySelector("#batchBar"),
  batchCount: document.querySelector("#batchCount"),
  batchSelectAllBtn: document.querySelector("#batchSelectAllBtn"),
  batchDeselectAllBtn: document.querySelector("#batchDeselectAllBtn"),
  batchDeleteBtn: document.querySelector("#batchDeleteBtn"),
  batchCancelBtn: document.querySelector("#batchCancelBtn"),
  authOverlay: document.querySelector("#authOverlay"),
  authTitle: document.querySelector("#authTitle"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword"),
  authSubmitBtn: document.querySelector("#authSubmitBtn"),
  authSwitchBtn: document.querySelector("#authSwitchBtn"),
  authSwitchText: document.querySelector("#authSwitchText"),
  authError: document.querySelector("#authError"),
  userInfo: document.querySelector("#userInfo"),
  userEmail: document.querySelector("#userEmail"),
  userLogoutBtn: document.querySelector("#userLogoutBtn"),
  loginBtn: document.querySelector("#loginBtn"),
  commentBtn: document.querySelector("#commentBtn"),
  commentPanel: document.querySelector("#commentPanel"),
  commentCloseBtn: document.querySelector("#commentCloseBtn"),
  commentHistory: document.querySelector("#commentHistory"),
  commentInput: document.querySelector("#commentInput"),
  commentSubmitBtn: document.querySelector("#commentSubmitBtn"),
};

function setPanelHidden(panel, hidden) {
  document.body.classList.toggle(`${panel}-hidden`, hidden);
  localStorage.setItem(`literatureReader.${panel}Hidden`, hidden ? "1" : "0");
}

function restorePanelState() {
  setPanelHidden("library", localStorage.getItem("literatureReader.libraryHidden") === "1");
  setPanelHidden("notes", localStorage.getItem("literatureReader.notesHidden") === "1");
  setPanelHidden("ask", localStorage.getItem("literatureReader.askHidden") === "1");
}

function restoreLayoutState() {
  for (const name of ["library-width", "notes-width", "ask-width", "comment-width"]) {
    const value = localStorage.getItem(`literatureReader.${name}`);
    if (value) {
      document.documentElement.style.setProperty(`--${name}`, value);
    }
  }

  const originalRatio = localStorage.getItem("literatureReader.original-ratio") || localStorage.getItem("literatureReader.original-width");
  const translationRatio = localStorage.getItem("literatureReader.translation-ratio") || localStorage.getItem("literatureReader.translation-width");
  if (originalRatio && translationRatio) {
    const originalValue = Number.parseFloat(originalRatio);
    const translationValue = Number.parseFloat(translationRatio);
    if (Number.isFinite(originalValue) && Number.isFinite(translationValue) && originalValue > 0 && translationValue > 0) {
      document.documentElement.style.setProperty("--original-ratio", String(originalValue));
      document.documentElement.style.setProperty("--translation-ratio", String(translationValue));
    }
  }
}

function saveLayoutState() {
  const style = getComputedStyle(document.documentElement);
  for (const name of ["library-width", "notes-width", "ask-width", "comment-width", "original-ratio", "translation-ratio"]) {
    const value = style.getPropertyValue(`--${name}`).trim();
    if (value) localStorage.setItem(`literatureReader.${name}`, value);
  }
}

function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtReadAt(value) {
  if (!value) return "";
  return value.replace("T", " ");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function fileUrl(file) {
  return `/files/${encodeURI(file.relPath)}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(text) {
  let html = escapeHtml(text);
  // 先还原 HTML 实体
  html = html.replace(/&amp;([a-zA-Z][a-zA-Z0-9]+|#\d+|#x[0-9a-fA-F]+);/g, "&$1;");
  html = html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  // 保留常用 HTML 标签，移除其他标签
  const allowed = /^(span|p|div|i|em|sub|sup|b|strong|a|img|br|h[1-6])$/i;
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tag) => {
    if (allowed.test(tag)) return match;
    return "";
  });
  // Markdown 内联格式
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}

function renderMarkdown(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let paragraph = [];
  let listOpen = false;

  function flushParagraph() {
    if (paragraph.length) {
      out.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  }

  function closeList() {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }
    // HTML 块级标签直接输出，不转义
    if (/^<(p|div|table|figure|blockquote)\b/i.test(line)) {
      flushParagraph();
      closeList();
      out.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return out.join("");
}

function getPdfJs() {
  if (window._pdfjsLib) return Promise.resolve(window._pdfjsLib);
  return new Promise((resolve, reject) => {
    let tries = 0;
    const timer = setInterval(() => {
      if (window._pdfjsLib) { clearInterval(timer); resolve(window._pdfjsLib); }
      else if (++tries > 80) { clearInterval(timer); reject(new Error("PDF.js 加载超时，请刷新页面重试")); }
    }, 100);
  });
}

async function loadTextLayer(pageWrap, paperId, pageNum) {
  try {
    const data = await api(`/api/pdf-text/${paperId}/${pageNum}`);
    if (!data.words || !data.words.length) return;
    const img = pageWrap.querySelector(".pdf-page-img");
    if (!img || !img.offsetWidth) return;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    const displayW = img.offsetWidth;
    const displayH = img.offsetHeight;
    const scaleX = displayW / imgW;
    const scaleY = displayH / imgH;
    const renderScale = 4.0; // PDF_RENDER_SCALE
    const layer = document.createElement("div");
    layer.className = "textLayer";
    for (const w of data.words) {
      const span = document.createElement("span");
      span.textContent = w.text;
      // PDF坐标 * 渲染倍率 * 显示缩放 = CSS像素位置
      const left = w.x0 * renderScale * scaleX;
      const top = w.y0 * renderScale * scaleY;
      const width = (w.x1 - w.x0) * renderScale * scaleX;
      const height = (w.y1 - w.y0) * renderScale * scaleY;
      span.style.left = left + "px";
      span.style.top = top + "px";
      span.style.width = width + "px";
      span.style.height = height + "px";
      span.style.fontSize = height + "px";
      span.style.lineHeight = height + "px";
      layer.appendChild(span);
    }
    pageWrap.appendChild(layer);
  } catch (e) {
    console.warn("Text layer load failed:", e);
  }
}


function observePdfPages(container) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          delete img.dataset.src;
        }
        observer.unobserve(img);
      }
    }
  }, { root: container, rootMargin: "600px 0px" });
  for (const img of container.querySelectorAll("img.pdf-page-img[data-src]")) {
    observer.observe(img);
  }
}


async function renderFile(container, file, emptyText) {
  container.innerHTML = "";
  container.classList.remove("empty-view");
  container.classList.remove("pdf-viewer");
  if (!file) {
    container.classList.add("empty-view");
    container.textContent = emptyText;
    return;
  }
  if (file.ext === ".pdf") {
    const canRenderPages = state.activePaper && file.relPath === state.activePaper.relPath;
    if (!canRenderPages) {
      const frame = document.createElement("iframe");
      frame.title = file.fileName;
      frame.src = fileUrl(file) + "#zoom=page-fit";
      container.appendChild(frame);
      return;
    }
    container.classList.add("pdf-viewer");
    const loading = document.createElement("div");
    loading.className = "related-loading";
    loading.textContent = "正在加载 PDF 页面...";
    container.appendChild(loading);
    const data = await api(`/api/pdf-pages/${state.activePaper.id}`);
    container.innerHTML = "";
    const paperId = state.activePaper.id;
    const eagerCount = 2;
    for (let page = 1; page <= data.pages; page += 1) {
      const pageWrap = document.createElement("div");
      pageWrap.className = "pdf-page draw-surface";
      pageWrap.dataset.drawKey = `${container.id}:page:${page}`;
      pageWrap.dataset.pageNum = String(page);
      const img = document.createElement("img");
      img.className = "pdf-page-img";
      img.alt = `${file.fileName} page ${page}`;
      const pageUrl = `/api/pdf-page/${paperId}/${page}`;
      if (page <= eagerCount) {
        img.src = pageUrl;
      } else {
        img.dataset.src = pageUrl;
      }
      img.addEventListener("load", () => {
        pageWrap.classList.add("pdf-page-loaded");
        resizeDrawCanvas(pageWrap);
        restoreDrawCanvas(pageWrap);
        loadTextLayer(pageWrap, paperId, page);
      });
      const badge = document.createElement("span");
      badge.className = "pdf-page-badge";
      badge.textContent = String(page);
      pageWrap.appendChild(img);
      pageWrap.appendChild(badge);
      container.appendChild(pageWrap);
    }
    observePdfPages(container);
    return;
  }
  if (file.ext === ".html" || file.ext === ".htm") {
    const frame = document.createElement("iframe");
    frame.title = file.fileName;
    frame.src = fileUrl(file);
    container.appendChild(frame);
    return;
  }
  if (file.ext === ".md" || file.ext === ".txt") {
    const payload = await api(`/api/text/${encodeURI(file.relPath)}`);
    if (file.ext === ".md") {
      const article = document.createElement("article");
      article.className = "markdown-body";
      article.innerHTML = renderMarkdown(payload.text);
      container.appendChild(article);
    } else {
      const pre = document.createElement("pre");
      pre.textContent = payload.text;
      container.appendChild(pre);
    }
    return;
  }
  container.classList.add("empty-view");
  container.textContent = "此文件格式无法在浏览器中预览。";
}

function passesFilter(paper) {
  if (state.filter === "read") return paper.read;
  if (state.filter === "unread") return !paper.read;
  if (state.filter === "translated") return Boolean(paper.translation);
  if (state.filter === "missing") return !paper.translation;
  return true;
}

function getFolderName(paper) {
  if (paper.folder) return paper.folder;
  const rel = paper.relPath || "";
  const idx = rel.indexOf("/");
  const folder = idx > 0 ? rel.substring(0, idx) : "";
  return (state.folders || []).includes(folder) ? folder : "";
}

function createPaperRow(paper) {
  const item = document.createElement("button");
  item.className = `paper-row${paper.read ? " read" : ""}${state.activePaper?.id === paper.id ? " active" : ""}${state.batchSelected.has(paper.id) ? " selected" : ""}`;
  item.dataset.paperId = paper.id;
  item.innerHTML = `
    <input type="checkbox" class="paper-checkbox" ${state.batchSelected.has(paper.id) ? "checked" : ""} />
    <span class="file-icon">${paper.ext.replace(".", "").toUpperCase()}</span>
    <span class="file-name"></span>
    <span class="read-dot" title="${paper.read ? '已读' : '未读'}"></span>
    <span class="paper-badges"></span>
    <button class="paper-rename-btn" title="重命名">✏</button>
    <button class="paper-delete-btn" title="删除文献">&times;</button>
  `;
  const nameEl = item.querySelector(".file-name");
  nameEl.textContent = paper.fileName;
  nameEl.dataset.fullname = paper.fileName;
  const badges = item.querySelector(".paper-badges");
  if (paper.read) badges.insertAdjacentHTML("beforeend", '<span class="mini-badge read-badge">已读</span>');
  if (paper.translation) badges.insertAdjacentHTML("beforeend", '<span class="mini-badge">译文</span>');
  const checkbox = item.querySelector(".paper-checkbox");
  checkbox.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBatchSelect(paper.id, checkbox.checked);
  });
  item.querySelector(".paper-delete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm(`确定要从文献库中移除 "${paper.fileName}" 吗？\n本地文件不会被删除。`)) deletePaper(paper.id);
  });
  item.querySelector(".paper-rename-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    state.activePaper = paper;
    renameActivePaper();
  });
  item.addEventListener("click", (e) => {
    if (state.batchMode) {
      e.stopPropagation();
      checkbox.checked = !checkbox.checked;
      toggleBatchSelect(paper.id, checkbox.checked);
      return;
    }
    console.log("Paper clicked:", paper.id, paper.relPath);
    loadPaper(paper.id).catch(err => {
      console.error("loadPaper failed:", err);
      alert("加载文献失败: " + err.message);
    });
  });
  return item;
}

function updateActivePaper() {
  const activeId = state.activePaper?.id;
  els.paperList.querySelectorAll(".paper-row").forEach(row => {
    row.classList.toggle("active", row.dataset.paperId === activeId);
  });
}

function renderPaperList() {
  const query = els.searchInput.value.trim().toLowerCase();
  const papers = state.papers.filter((paper) => {
    const matchesQuery = !query || paper.title.toLowerCase().includes(query) || paper.fileName.toLowerCase().includes(query);
    return matchesQuery && passesFilter(paper);
  });
  const scopeLabel = state.paperScope === "public" ? " · 公共" : "";
  els.paperCount.textContent = state.papers.length + " 篇文献" + scopeLabel;
  els.paperList.innerHTML = "";

  // Group by folder
  const groups = { "": [] }; // "" = ungrouped (root level)
  for (const paper of papers) {
    const folder = getFolderName(paper);
    if (!folder) {
      groups[""].push(paper);
    } else {
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(paper);
    }
  }

  for (const folder of state.folders || []) {
    if (!groups[folder]) groups[folder] = [];
  }

  // Render folders first
  const folderNames = Object.keys(groups).filter(k => k !== "").sort((a, b) => a.localeCompare(b, "zh"));
  for (const folder of folderNames) {
    const folderPapers = groups[folder];
    const expanded = state.folderExpanded[folder] === true; // default collapsed
    const folderPaperIds = folderPapers.map(p => p.id);
    const isEmpty = folderPaperIds.length === 0;
    const allSelected = folderPaperIds.length > 0 && folderPaperIds.every(id => state.batchSelected.has(id));
    const someSelected = folderPaperIds.some(id => state.batchSelected.has(id));
    const folderSelected = state.batchSelectedFolders.has(folder);

    const header = document.createElement("div");
    header.className = "folder-header";
    let checkboxHtml = "";
    if (state.batchMode) {
      const checked = isEmpty ? folderSelected : allSelected;
      checkboxHtml = `<input type="checkbox" class="folder-checkbox" ${checked ? "checked" : ""} />`;
    }
    header.innerHTML = `
      ${checkboxHtml}
      <span class="folder-arrow${expanded ? " expanded" : ""}">&#9654;</span>
      <span class="folder-name">${folder}</span>
      <span class="folder-count">${folderPapers.length}</span>
      <button class="folder-rename-btn" title="重命名文件夹">✏</button>
      <button class="folder-upload-btn" title="上传到这个文件夹">+</button>
      <button class="folder-delete-btn" title="删除文件夹">&times;</button>
    `;
    if (state.batchMode) {
      const folderCheckbox = header.querySelector(".folder-checkbox");
      if (!isEmpty && someSelected && !allSelected) folderCheckbox.indeterminate = true;
      folderCheckbox.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isEmpty) {
          toggleEmptyFolderSelection(folder, folderCheckbox.checked);
        } else {
          toggleFolderSelection(folderPaperIds, folderCheckbox.checked);
        }
      });
    }
    header.querySelector(".folder-upload-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      state.uploadTargetFolder = folder;
      els.fileInput.click();
    });
    header.querySelector(".folder-delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteFolder(folder);
    });
    header.querySelector(".folder-rename-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      renameFolder(folder);
    });
    header.addEventListener("click", (e) => {
      if (e.target.classList.contains("folder-checkbox")) return;
      state.folderExpanded[folder] = !state.folderExpanded[folder];
      renderPaperList();
    });
    els.paperList.appendChild(header);

    if (expanded) {
      const container = document.createElement("div");
      container.className = "folder-children";
      for (const paper of folderPapers) {
        container.appendChild(createPaperRow(paper));
      }
      els.paperList.appendChild(container);
    }
  }

  // Render ungrouped papers at the end
  for (const paper of groups[""]) {
    els.paperList.appendChild(createPaperRow(paper));
  }
}

// File name tooltip
(function () {
  let tooltip = null;
  let currentNameEl = null;
  let rafId = 0;
  function removeTooltip() {
    if (tooltip) { tooltip.remove(); tooltip = null; }
    currentNameEl = null;
  }
  els.paperList.addEventListener("mouseover", (e) => {
    const nameEl = e.target.closest(".file-name");
    if (nameEl && nameEl.dataset.fullname) {
      if (nameEl === currentNameEl) return;
      removeTooltip();
      currentNameEl = nameEl;
      tooltip = document.createElement("div");
      tooltip.className = "file-tooltip";
      tooltip.textContent = nameEl.dataset.fullname;
      document.body.appendChild(tooltip);
      const rect = nameEl.getBoundingClientRect();
      tooltip.style.left = rect.left + "px";
      tooltip.style.top = (rect.bottom + 4) + "px";
    }
  });
  els.paperList.addEventListener("mouseout", (e) => {
    if (currentNameEl && !currentNameEl.contains(e.relatedTarget)) {
      removeTooltip();
    }
  });
})();

async function deletePaper(paperId) {
  try {
    const scopeParam = state.paperScope === "public" ? "?scope=public" : "";
    const resp = await fetch(`/api/papers/${paperId}${scopeParam}`, { method: "DELETE" });
    const data = await resp.json();
    if (data.ok) {
      state.papers = data.papers;
      if (data.folders) state.folders = data.folders;
      if (state.activePaper?.id === paperId) {
        state.activePaper = null;
        els.activeTitle.textContent = "选择一篇文献开始阅读";
        els.activeMeta.textContent = "原文与译文会按文件原样并排显示。";
        els.statusPill.textContent = "未选择";
        els.statusPill.className = "pill";
        els.originalViewer.innerHTML = '<div class="empty-view">请选择左侧文献。</div>';
        els.translationViewer.innerHTML = '<div class="empty-view">未找到对应译文文件。</div>';
        setEnabled(false);
      }
      renderPaperList();
    } else {
      alert("删除失败: " + (data.error || "未知错误"));
    }
  } catch (e) {
    alert("删除失败: " + e.message);
  }
}

// ── 批量删除 ──

function setBatchMode(active) {
  state.batchMode = active;
  if (!active) {
    state.batchSelected.clear();
    state.batchSelectedFolders.clear();
  }
  document.body.classList.toggle("batch-mode", active);
  els.batchBar.classList.toggle("hidden", !active);
  els.batchSelectBtn.classList.toggle("active", active);
  els.batchDeleteBtn.disabled = false;
  els.batchDeleteBtn.textContent = "删除所选";
  updateBatchCount();
  renderPaperList();
}

function toggleBatchSelect(paperId, selected) {
  if (selected) {
    state.batchSelected.add(paperId);
  } else {
    state.batchSelected.delete(paperId);
  }
  updateBatchCount();
  const row = els.paperList.querySelector(`[data-paper-id="${paperId}"]`);
  if (row) row.classList.toggle("selected", selected);
}

function updateBatchCount() {
  const total = state.batchSelected.size + state.batchSelectedFolders.size;
  els.batchCount.textContent = "已选 " + state.batchSelected.size + " 篇文献 + " + state.batchSelectedFolders.size + " 个空文件夹";
  els.batchDeleteBtn.disabled = total === 0;
}

function batchSelectAll() {
  const query = els.searchInput.value.trim().toLowerCase();
  const visiblePapers = state.papers.filter((paper) => {
    const matchesQuery = !query || paper.title.toLowerCase().includes(query) || paper.fileName.toLowerCase().includes(query);
    return matchesQuery && passesFilter(paper);
  });
  for (const paper of visiblePapers) {
    state.batchSelected.add(paper.id);
  }
  updateBatchCount();
  renderPaperList();
}

function batchDeselectAll() {
  state.batchSelected.clear();
  state.batchSelectedFolders.clear();
  updateBatchCount();
  renderPaperList();
}

function toggleFolderSelection(paperIds, selected) {
  for (const id of paperIds) {
    if (selected) {
      state.batchSelected.add(id);
    } else {
      state.batchSelected.delete(id);
    }
  }
  updateBatchCount();
  renderPaperList();
}

function toggleEmptyFolderSelection(folder, selected) {
  if (selected) {
    state.batchSelectedFolders.add(folder);
  } else {
    state.batchSelectedFolders.delete(folder);
  }
  updateBatchCount();
  renderPaperList();
}

async function batchDelete() {
  const totalCount = state.batchSelected.size + state.batchSelectedFolders.size;
  if (totalCount === 0) return;
  if (!confirm("Remove " + totalCount + " selected item(s) from the library?\nLocal files will not be deleted.")) return;
  try {
    els.batchDeleteBtn.disabled = true;
    els.batchDeleteBtn.textContent = "删除中...";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const scopeParam = state.paperScope === "public" ? "?scope=public" : "";
    const resp = await fetch("/api/papers/batch-delete" + scopeParam, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: Array.from(state.batchSelected),
        folders: Array.from(state.batchSelectedFolders),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await resp.json();
    if (data.ok) {
      state.papers = data.papers;
      if (data.folders) state.folders = data.folders;
      if (state.activePaper && state.batchSelected.has(state.activePaper.id)) {
        state.activePaper = null;
        els.activeTitle.textContent = "选择一篇文献开始阅读";
        els.activeMeta.textContent = "原文与译文会按文件原样并排显示。";
        els.statusPill.textContent = "未选择";
        els.statusPill.className = "pill";
        els.originalViewer.innerHTML = '<div class="empty-view">请选择左侧文献。</div>';
        els.translationViewer.innerHTML = '<div class="empty-view">未找到对应译文文件。</div>';
        setEnabled(false);
      }
      setBatchMode(false);
    } else {
      alert("Batch delete failed: " + (data.error || "Unknown error"));
      els.batchDeleteBtn.disabled = false;
      els.batchDeleteBtn.textContent = "删除所选";
    }
  } catch (e) {
    if (e.name === "AbortError") {
      alert("删除超时，请重试。");
    } else {
      alert("Batch delete failed: " + e.message);
    }
    els.batchDeleteBtn.disabled = false;
    els.batchDeleteBtn.textContent = "删除所选";
  }
}

// ── 用户认证 ──

function showAuthModal(mode) {
  state.authMode = mode || "login";
  els.authTitle.textContent = state.authMode === "login" ? "登录" : "注册";
  els.authSubmitBtn.textContent = state.authMode === "login" ? "登录" : "注册";
  els.authSwitchText.textContent = state.authMode === "login" ? "没有账号？" : "已有账号？";
  els.authSwitchBtn.textContent = state.authMode === "login" ? "注册" : "登录";
  els.authError.classList.add("hidden");
  els.authEmail.value = "";
  els.authPassword.value = "";
  els.authOverlay.classList.remove("hidden");
  els.authEmail.focus();
}

function closeAuthModal() {
  els.authOverlay.classList.add("hidden");
}

function showAuthError(msg) {
  els.authError.textContent = msg;
  els.authError.classList.remove("hidden");
}

function updateUserInfo() {
  if (state.currentUser) {
    els.userInfo.classList.remove("hidden");
    els.userEmail.textContent = state.currentUser.email;
    els.loginBtn.style.display = "none";
    els.scopeToggleBtn.classList.remove("hidden");
  } else {
    els.userInfo.classList.add("hidden");
    els.userEmail.textContent = "";
    els.loginBtn.style.display = "";
    els.scopeToggleBtn.classList.add("hidden");
    state.paperScope = "personal";
    updateScopeBtn();
  }
  updateScopeActions();
}

function updateScopeBtn() {
  if (state.paperScope === "public") {
    els.scopeToggleBtn.textContent = "公共 ✓";
    els.scopeToggleBtn.classList.add("scope-active");
  } else {
    els.scopeToggleBtn.textContent = "公共";
    els.scopeToggleBtn.classList.remove("scope-active");
  }
  updateScopeActions();
}

function updateScopeActions() {
  const isAdmin = state.currentUser && state.currentUser.isAdmin;
  const isPublic = state.paperScope === "public";
  const isLoggedIn = !!state.currentUser;

  // Add button: visible for admin in public, or any logged-in user in personal
  els.addPaperBtn.style.display = (isPublic && !isAdmin) ? "none" : "";
  els.batchSelectBtn.style.display = (isPublic && !isAdmin) ? "none" : "";

  // Save to my library: visible for non-admin in public scope
  if (isLoggedIn && isPublic && !isAdmin) {
    els.saveToMyLibraryBtn.classList.remove("hidden");
  } else {
    els.saveToMyLibraryBtn.classList.add("hidden");
  }
}

async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (data.ok && data.user) {
      state.currentUser = data.user;
      if (data.user.isAdmin) {
        state.paperScope = "public";
      }
      updateUserInfo();
      // 加载该账号的 API 配置
      await loadUserApiConfig();
      return true;
    }
  } catch {}
  state.currentUser = null;
  updateUserInfo();
  return false;
}

async function authSubmit() {
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (!email || !password) {
    showAuthError("请输入邮箱和密码");
    return;
  }
  els.authSubmitBtn.disabled = true;
  els.authSubmitBtn.textContent = state.authMode === "login" ? "登录中..." : "注册中...";
  try {
    const endpoint = state.authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.ok) {
      state.currentUser = data.user;
      if (data.user.isAdmin) {
        state.paperScope = "public";
      }
      updateUserInfo();
      closeAuthModal();
      // 加载该账号的 API 配置
      await loadUserApiConfig();
      await loadTranslateConfig();
      // Reload user-specific data
      await loadPapers(true);
    } else {
      showAuthError(data.error || "鎿嶄綔失败");
    }
  } catch (e) {
    showAuthError("缃戠粶错误: " + e.message);
  } finally {
    els.authSubmitBtn.disabled = false;
    els.authSubmitBtn.textContent = state.authMode === "login" ? "登录" : "注册";
  }
}

async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {}
  state.currentUser = null;
  // 清空当前 API 配置，恢复为默认值
  state.apiConfig = {};
  localStorage.removeItem("literatureReader.apiConfig");
  await loadTranslateConfig();
  updateModelDisplay();
  updateUserInfo();
  showAuthModal("login");
}

function setEnabled(enabled) {
  els.toggleReadBtn.disabled = !enabled;
  els.openOriginalBtn.disabled = !enabled;
  els.extractTitleBtn.disabled = !enabled;
  els.uploadTranslationBtn.disabled = !enabled;
  els.saveNotesBtn.disabled = !enabled;
  els.addNoteBtn.disabled = !enabled;
  els.drawModeBtn.disabled = !enabled;
  els.relatedBtn.disabled = !enabled;
  if (!enabled) setDrawMode(false);
}

function clearViewer() {
  state.activePaper = null;
  state.activePayload = null;
  state.notes = { items: [] };
  els.activeTitle.textContent = "";
  els.statusPill.textContent = "";
  els.activeMeta.textContent = "";
  els.originalName.textContent = "";
  els.translationName.textContent = "";
  els.originalViewer.innerHTML = '<div class="empty-view">暂无文献，请上传。</div>';
  els.translationViewer.innerHTML = '<div class="empty-view">暂无文献，请上传。</div>';
  setEnabled(false);
}

async function loadPapers(keepActive = true) {
  const scopeParam = state.paperScope === "public" ? "?scope=public" : "";
  const [payload, folderPayload] = await Promise.all([
    api("/api/papers" + scopeParam),
    api("/api/folders" + scopeParam),
  ]);
  state.papers = payload.papers;
  state.folders = folderPayload.folders || [];
  if (keepActive && state.activePaper) {
    const current = state.papers.find((paper) => paper.id === state.activePaper.id);
    if (current) {
      state.activePaper = current;
    } else {
      state.activePaper = null;
    }
  } else if (!keepActive) {
    state.activePaper = null;
  }
  renderPaperList();
  if (!state.activePaper && state.papers.length) {
    await loadPaper(state.papers[0].id);
  } else if (!state.activePaper) {
    clearViewer();
  }
}

async function refreshPapersFromDisk() {
  if (document.hidden) return;
  const activeId = state.activePaper?.id;
  const previousTranslation = state.activePaper?.translation?.relPath || null;
  const scopeParam = state.paperScope === "public" ? "?scope=public" : "";
  const payload = await api("/api/scan" + scopeParam, { method: "POST" });
  state.papers = payload.papers;
  try {
    const folderPayload = await api("/api/folders" + scopeParam);
    state.folders = folderPayload.folders || [];
  } catch {}
  const current = activeId ? state.papers.find((paper) => paper.id === activeId) : null;
  if (current) {
    state.activePaper = current;
  } else if (!state.papers.length) {
    state.activePaper = null;
  }
  renderPaperList();
  const nextTranslation = current?.translation?.relPath || null;
  if (current && previousTranslation !== nextTranslation) await loadPaper(current.id);
  if (!state.activePaper && state.papers.length) {
    await loadPaper(state.papers[0].id);
  } else if (!state.activePaper) {
    clearViewer();
  }
}

function updateReadUi() {
  const paper = state.activePaper;
  if (!paper) return;
  els.statusPill.textContent = paper.read ? "已读" : paper.translation ? "原文 / 译文" : "缺少译文";
  els.statusPill.className = "pill" + (paper.read ? " done" : paper.translation ? "" : " warn");
  els.toggleReadBtn.textContent = paper.read ? "标为未读" : "标为已读";
  const readText = paper.readAt ? " · 已读 " + fmtReadAt(paper.readAt) : "";
  els.activeMeta.textContent = fmtSize(state.activePayload.original.size) + " · " + state.activePayload.original.modifiedAt + readText;
}

function updateTranslateBtn(hasTranslation) {
  if (state.translating) {
    els.translateBtn.disabled = false;
    els.translateBtn.textContent = "取消翻译";
    return;
  }
  if (isApiConfigured()) {
    els.translateBtn.disabled = false;
    els.translateBtn.textContent = "翻译 ▾";
  } else {
    els.translateBtn.disabled = true;
    els.translateBtn.textContent = "翻译 ▾";
  }
}

// ── API 配置管理 ──

function presetKey(url) {
  return "literatureReader.presetKey." + (url || "custom");
}

function loadPresetApiKey(url) {
  return localStorage.getItem(presetKey(url)) || "";
}

function savePresetApiKey(url, apiKey) {
  if (url) localStorage.setItem(presetKey(url), apiKey);
  else localStorage.setItem(presetKey("custom"), apiKey);
}

function loadApiConfig() {
  const saved = localStorage.getItem("literatureReader.apiConfig");
  if (saved) {
    try { state.apiConfig = JSON.parse(saved); } catch { state.apiConfig = {}; }
  } else {
    state.apiConfig = {};
  }
}

async function loadUserApiConfig() {
  if (!state.currentUser) return;
  try {
    const data = await api("/api/user-config");
    if (data.ok && data.config && data.config.apiKey) {
      state.apiConfig = data.config;
      localStorage.setItem("literatureReader.apiConfig", JSON.stringify(data.config));
      savePresetApiKey(data.config.baseUrl, data.config.apiKey);
      updateTranslateBtn(state.activePayload?.translation);
      updateAskBtn();
      updateModelDisplay();
    }
  } catch {}
}

function saveApiConfig(config) {
  state.apiConfig = config;
  localStorage.setItem("literatureReader.apiConfig", JSON.stringify(config));
  savePresetApiKey(config.baseUrl, config.apiKey);
  // 同步到服务端（按账号存储）
  if (state.currentUser) {
    fetch("/api/user-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }).catch(() => {});
  }
  updateTranslateBtn(state.activePayload?.translation);
  updateAskBtn();
  updateModelDisplay();
}

function updateModelDisplay() {
  const model = state.apiConfig?.model || "";
  els.currentModel.textContent = model;
  els.currentModel.title = model ? "当前模型: " + model : "未配置模型";
}

function getApiConfigParams() {
  const c = state.apiConfig || {};
  if (!c.apiKey) return "";
  return "api_key=" + encodeURIComponent(c.apiKey) + "&base_url=" + encodeURIComponent(c.baseUrl || "") + "&model=" + encodeURIComponent(c.model || "");
}

function isApiConfigured() {
  return !!(state.apiConfig?.apiKey);
}

async function openSettings() {
  const c = state.apiConfig || {};
  const url = c.baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai";
  els.settingsBaseUrl.value = url;
  els.settingsApiKey.value = loadPresetApiKey(url);
  els.settingsModel.value = c.model || "gemini-3.1-flash-lite";
  if (els.settingsAskMode) els.settingsAskMode.value = c.askMode || "balanced";
  els.settingsOverlay.classList.remove("hidden");
  updatePresetButtons();
}

function closeSettings() {
  els.settingsOverlay.classList.add("hidden");
}

function closeRelated() {
  els.relatedOverlay.classList.add("hidden");
}

function updateRelatedButton() {
  if (!els.relatedBtn) return;
  const samePaper = state.relatedSearch.paperId === state.activePaper?.id;
  if (state.relatedSearch.running && samePaper) {
    els.relatedBtn.textContent = "取消搜索";
  } else if (state.relatedSearch.hasContent && samePaper) {
    els.relatedBtn.textContent = "查看相关文献";
  } else {
    els.relatedBtn.textContent = "相关文献";
  }
}

async function startRelated() {
  if (!state.activePaper || !isApiConfigured()) return;
  const paper = state.activePaper;
  if (state.relatedSearch.paperId === paper.id && state.relatedSearch.running) {
    cancelRelatedSearch("Related search canceled.");
    return;
  }
  if (state.relatedSearch.paperId === paper.id && state.relatedSearch.hasContent) {
    els.relatedOverlay.classList.remove("hidden");
    return;
  }

  if (state.relatedSearch.evtSource) {
    state.relatedSearch.evtSource.close();
  }
  state.relatedSearch = {
    paperId: paper.id,
    running: true,
    hasContent: true,
    evtSource: null,
  };
  els.relatedKeywords.innerHTML = "";
  els.relatedResults.innerHTML = '<div class="related-loading">Searching related papers in the background.</div>';
  els.relatedOverlay.classList.add("hidden");
  updateRelatedButton();

  const params = getApiConfigParams();
  const url = "/api/related/" + paper.id + "?" + params;
  const evtSource = new EventSource(url);
  state.relatedSearch.evtSource = evtSource;
  let keywordsHtml = "";
  let papers = [];

  evtSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (state.relatedSearch.paperId !== paper.id) return;
    if (data.status === "keywords") {
      keywordsHtml = data.text;
      els.relatedKeywords.textContent = keywordsHtml;
    } else if (data.status === "searching") {
      els.relatedKeywords.innerHTML = '<span class="query-tag">' + escapeHtml(data.query) + '</span>';
      els.relatedResults.innerHTML = '<div class="related-loading">Searching related papers in the background.</div>';
    } else if (data.status === "results") {
      papers = data.papers;
      if (papers.length === 0) {
        els.relatedResults.innerHTML = '<div class="related-empty">No related papers found.</div>';
      } else {
        els.relatedResults.innerHTML = papers.map(renderRelatedPaper).join("");
      }
    } else if (data.status === "done") {
      state.relatedSearch.running = false;
      state.relatedSearch.evtSource = null;
      updateRelatedButton();
      evtSource.close();
    } else if (data.status === "error") {
      els.relatedResults.innerHTML = '<div class="related-error">' + escapeHtml(data.message) + '</div>';
      state.relatedSearch.running = false;
      state.relatedSearch.evtSource = null;
      updateRelatedButton();
      evtSource.close();
    }
  };

  evtSource.onerror = () => {
    els.relatedResults.innerHTML = '<div class="related-error">Related search connection failed. Please try again later.</div>';
    state.relatedSearch.running = false;
    state.relatedSearch.evtSource = null;
    updateRelatedButton();
    evtSource.close();
  };
}

function cancelRelatedSearch(message = "Related search canceled.") {
  if (state.relatedSearch.evtSource) state.relatedSearch.evtSource.close();
  state.relatedSearch.running = false;
  state.relatedSearch.evtSource = null;
  state.relatedSearch.hasContent = true;
  els.relatedResults.innerHTML = '<div class="related-empty">' + escapeHtml(message) + '</div>';
  updateRelatedButton();
}

function renderRelatedPaper(p) {
  const authors = p.authors.slice(0, 3).join(", ") + (p.authors.length > 3 ? " et al." : "");
  const year = p.year || "N/A";
  const citations = p.citations ? p.citations + " citations" : "";
  const meta = [authors, year, citations].filter(Boolean).join(" · ");
  const title = escapeHtml(p.title || "");
  const url = escapeHtml(p.url || "");
  const link = p.url ? '<a class="related-paper-title" href="' + url + '" target="_blank">' + title + '</a>' : '<span class="related-paper-title">' + title + '</span>';
  const abstract = p.abstract ? '<div class="related-paper-abstract">' + escapeHtml(p.abstract) + '</div>' : "";
  return '<div class="related-paper">' + link + '<div class="related-paper-meta">' + escapeHtml(meta) + '</div>' + abstract + '</div>';
}

function updatePresetButtons() {
  const url = els.settingsBaseUrl.value.trim();
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    const presetUrl = btn.dataset.url;
    btn.classList.toggle("active", presetUrl && url === presetUrl);
  });
}

function applyPreset(url, model) {
  // Save current preset's API key before switching
  savePresetApiKey(els.settingsBaseUrl.value.trim(), els.settingsApiKey.value.trim());
  // Switch to new preset
  els.settingsBaseUrl.value = url;
  els.settingsModel.value = model;
  // Load new preset's API key
  els.settingsApiKey.value = loadPresetApiKey(url);
  updatePresetButtons();
}

async function loadTranslateConfig() {
  try {
    const defaults = await api("/api/translate-config");
    if (!state.apiConfig.baseUrl) state.apiConfig.baseUrl = defaults.default_base_url;
    if (!state.apiConfig.model) state.apiConfig.model = defaults.default_model;
    if (!state.apiConfig.askMode) state.apiConfig.askMode = "balanced";
  } catch {}
  updateAskBtn();
}

function startTranslation(mode) {
  if (!state.activePaper) return;
  if (state.translating) {
    cancelTranslation();
    return;
  }
  // Close dropdown menu
  els.translateMenu.classList.add("hidden");
  cleanupTranslateMode();
  if (mode === "2" || mode === 2) {
    startInlineTranslation();
    return;
  }
  if (mode === "3" || mode === 3) {
    startImageTranslation();
    return;
  }
  // Default: full translation
  const paper = state.activePaper;
  state.translating = true;
  updateTranslateBtn(false);
  els.statusPill.textContent = "翻译中...";
  els.statusPill.className = "pill warn";

  const params = getApiConfigParams();
  const evtSource = new EventSource("/api/translate/" + paper.id + "?" + params);
  state.translateSource = evtSource;

  evtSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status === "translating") {
      els.statusPill.textContent = "翻译中 " + data.current + "/" + data.total;
      els.translateBtn.textContent = "取消 " + data.current + "/" + data.total;
    } else if (data.status === "qa_warning") {
      console.warn("翻译 QA 警告:", data.issues);
    } else if (data.status === "done") {
      evtSource.close();
      state.translateSource = null;
      state.translating = false;
      if (data.qa && data.qa.length) {
        els.statusPill.textContent = "翻译完成（有警告）";
        els.statusPill.className = "pill warn";
        alert("翻译完成，但有以下问题：\n\n" + data.qa.join("\n"));
      } else {
        els.statusPill.textContent = "翻译完成";
        els.statusPill.className = "pill done";
      }
      setTimeout(() => loadPaper(paper.id), 500);
    } else if (data.status === "error") {
      evtSource.close();
      state.translateSource = null;
      state.translating = false;
      els.statusPill.textContent = "翻译失败";
      els.statusPill.className = "pill warn";
      updateTranslateBtn(false);
      alert("Translation failed: " + data.message);
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    state.translateSource = null;
    state.translating = false;
    els.statusPill.textContent = "翻译中断";
    els.statusPill.className = "pill warn";
    updateTranslateBtn(false);
    alert("Translation connection interrupted. Please check API settings.");
  };
}

function startInlineTranslation() {
  cleanupTranslateMode();
  state.translateMode = "select";
  document.body.classList.add("translate-select-mode");
  els.statusPill.textContent = "请在 PDF 上选中文字，按 Esc 取消";
  els.statusPill.className = "pill warn";
  const handler = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 2) return;
    const rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    sendTranslateRequest(text, null, rect || { left: 200, top: 200, right: 500, bottom: 300 });
  };
  const escHandler = (e) => { if (e.key === "Escape") { cleanup(); els.statusPill.textContent = "未选择"; els.statusPill.className = "pill"; updateTranslateBtn(state.activePayload?.translation); }};
  const cleanup = () => {
    document.removeEventListener("mouseup", handler);
    document.removeEventListener("keydown", escHandler);
    cleanupTranslateMode();
  };
  document.addEventListener("mouseup", handler);
  document.addEventListener("keydown", escHandler);
}

function startImageTranslation() {
  cleanupTranslateMode();
  state.translateMode = "screenshot";
  els.statusPill.textContent = "在 PDF 上拖拽截图，按 Esc 取消";
  els.statusPill.className = "pill warn";
  const viewer = els.originalViewer;
  const overlay = document.createElement("div");
  overlay.className = "screenshot-overlay";
  viewer.style.position = "relative";
  viewer.appendChild(overlay);
  let dragging = false, startX = 0, startY = 0, selRect = null;
  overlay.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    selRect = document.createElement("div");
    selRect.className = "screenshot-rect";
    overlay.appendChild(selRect);
    const onMove = (ev) => {
      if (!dragging) return;
      const or = overlay.getBoundingClientRect();
      const x1 = Math.min(startX, ev.clientX) - or.left;
      const y1 = Math.min(startY, ev.clientY) - or.top;
      const x2 = Math.max(startX, ev.clientX) - or.left;
      const y2 = Math.max(startY, ev.clientY) - or.top;
      selRect.style.left = x1 + "px";
      selRect.style.top = y1 + "px";
      selRect.style.width = (x2 - x1) + "px";
      selRect.style.height = (y2 - y1) + "px";
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragging = false;
      const x1 = Math.min(startX, ev.clientX), y1 = Math.min(startY, ev.clientY);
      const x2 = Math.max(startX, ev.clientX), y2 = Math.max(startY, ev.clientY);
      if (x2 - x1 < 10 || y2 - y1 < 10) { if (selRect) selRect.remove(); return; }
      captureAndTranslate(x1, y1, x2, y2);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
  const escHandler = (e) => { if (e.key === "Escape") { cleanupScreenshotMode(); els.statusPill.textContent = "未选择"; els.statusPill.className = "pill"; updateTranslateBtn(state.activePayload?.translation); }};
  document.addEventListener("keydown", escHandler);
  function cleanupScreenshotMode() {
    document.removeEventListener("keydown", escHandler);
    overlay.remove();
    cleanupTranslateMode();
  }
  async function captureAndTranslate(x1, y1, x2, y2) {
    const anchorRect = { left: x1, top: y1, right: x2, bottom: y2 };
    if (selRect) selRect.remove();
    const pages = viewer.querySelectorAll(".pdf-page");
    let imageDataUrl = null;
    for (const pageWrap of pages) {
      const img = pageWrap.querySelector(".pdf-page-img");
      if (!img || !img.complete) continue;
      const ir = img.getBoundingClientRect();
      const ix1 = Math.max(x1, ir.left), iy1 = Math.max(y1, ir.top);
      const ix2 = Math.min(x2, ir.right), iy2 = Math.min(y2, ir.bottom);
      if (ix2 <= ix1 || iy2 <= iy1) continue;
      const scaleX = img.naturalWidth / ir.width;
      const scaleY = img.naturalHeight / ir.height;
      const canvas = document.createElement("canvas");
      canvas.width = (ix2 - ix1) * scaleX;
      canvas.height = (iy2 - iy1) * scaleY;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, (ix1 - ir.left) * scaleX, (iy1 - ir.top) * scaleY, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      imageDataUrl = canvas.toDataURL("image/png");
      break;
    }
    if (!imageDataUrl) { alert("截图失败，请确保 PDF 已加载。"); return; }
    sendTranslateRequest(null, imageDataUrl, anchorRect);
    // 连续模式：不退出，让用户继续截图
  }
}

function cancelTranslation() {
  if (state.translateSource) state.translateSource.close();
  state.translateSource = null;
  state.translating = false;
  els.statusPill.textContent = "翻译已取消";
  els.statusPill.className = "pill warn";
  updateTranslateBtn(state.activePayload?.translation);
}

// ── 浮动翻译面板 ──

function makeDraggable(el, handle) {
  let startX, startY, origLeft, origTop;
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startX = e.clientX; startY = e.clientY;
    origLeft = el.offsetLeft; origTop = el.offsetTop;
    const onMove = (ev) => {
      el.style.left = (origLeft + ev.clientX - startX) + "px";
      el.style.top = (origTop + ev.clientY - startY) + "px";
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

function showTranslatePopup(anchorRect) {
  document.querySelector(".translate-popup")?.remove();
  const popup = document.createElement("div");
  popup.className = "translate-popup";
  popup.innerHTML = `<div class="translate-popup-head"><span>翻译结果</span><button class="translate-popup-close">&times;</button></div><div class="translate-popup-body"><p style="color:var(--muted)">翻译中...</p></div>`;
  const x = anchorRect ? Math.min(anchorRect.right + 10, window.innerWidth - 380) : 200;
  const y = anchorRect ? Math.min(anchorRect.top, window.innerHeight - 300) : 200;
  popup.style.left = x + "px";
  popup.style.top = y + "px";
  document.body.appendChild(popup);
  popup.querySelector(".translate-popup-close").addEventListener("click", () => popup.remove());
  makeDraggable(popup, popup.querySelector(".translate-popup-head"));
  return popup;
}

function updateTranslatePopupBody(popup, html) {
  const body = popup.querySelector(".translate-popup-body");
  if (body) body.innerHTML = html;
}

async function sendTranslateRequest(text, imageDataUrl, anchorRect) {
  if (!state.activePaper || !isApiConfigured()) return;
  const popup = showTranslatePopup(anchorRect);
  const prompt = text
    ? "请将以下学术英文翻译为准确的中文：\n\n" + text
    : "请识别并翻译截图中的学术内容，保留术语、公式和段落结构。";
  const c = state.apiConfig || {};
  const body = {
    question: prompt,
    api_key: c.apiKey || "",
    base_url: c.baseUrl || "",
    model: c.model || "",
    ask_mode: "turbo",
  };
  if (imageDataUrl) body.image = { dataUrl: imageDataUrl, mediaType: "image/png" };
  try {
    const res = await fetch("/api/ask/" + state.activePaper.id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("请求失败: " + res.status);
    if (!res.body) throw new Error("浏览器不支持 ReadableStream");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "", buffer = "", finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.status === "token") { fullText += data.text; updateTranslatePopupBody(popup, renderMarkdown(fullText)); }
          else if (data.status === "done") finished = true;
          else if (data.status === "error") { updateTranslatePopupBody(popup, `<p style="color:#d9472b">${escapeHtml(data.message)}</p>`); finished = true; }
        } catch {}
      }
    }
    if (fullText) updateTranslatePopupBody(popup, renderMarkdown(fullText));
  } catch (e) {
    updateTranslatePopupBody(popup, `<p style="color:#d9472b">${escapeHtml(e.message)}</p>`);
  }
}

function cleanupTranslateMode() {
  document.body.classList.remove("translate-select-mode");
  document.querySelectorAll(".screenshot-overlay").forEach(el => el.remove());
  state.translateMode = null;
}

// // ── 文件上传 ──

async function uploadFiles(files) {
  const targetFolder = state.uploadTargetFolder || "";
  state.uploadTargetFolder = "";
  const validFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
  if (!validFiles.length) {
    alert("请选择 PDF 文件");
    return;
  }
  let firstNewPaper = null;
  for (let i = 0; i < validFiles.length; i++) {
    const file = validFiles[i];
    const formData = new FormData();
    formData.append("file", file);
    if (targetFolder) formData.append("folder", targetFolder);
    try {
      els.paperCount.textContent = "上传中 (" + (i + 1) + "/" + validFiles.length + "): " + file.name;
      const uploadUrl = state.paperScope === "public" ? "/api/upload?scope=public" : "/api/upload";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      let res;
      try {
        res = await fetch(uploadUrl, { method: "POST", body: formData, credentials: "same-origin", signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => "HTTP " + res.status);
        alert("上传失败 (" + file.name + "): " + errText);
        continue;
      }
      const data = await res.json();
      if (data.ok && data.paper) {
        if (!state.papers.find(p => p.id === data.paper.id)) {
          state.papers.push(data.paper);
        }
        if (!firstNewPaper) firstNewPaper = data.paper;
      } else {
        alert("上传失败 (" + file.name + "): " + (data.error || "未知错误"));
      }
    } catch (e) {
      if (e.name === "AbortError") {
        alert("上传超时 (" + file.name + "): 请检查网络连接");
      } else {
        alert("上传失败 (" + file.name + "): " + e.message);
      }
    }
  }
  if (firstNewPaper) {
    renderPaperList();
    await loadPaper(firstNewPaper.id);
  }
}

async function createFolder() {
  const name = prompt("Enter a new folder name");
  if (!name || !name.trim()) return;
  try {
    const body = { name: name.trim() };
    if (state.paperScope === "public") body.scope = "public";
    const data = await api("/api/folders", {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.folders = data.folders || [];
    renderPaperList();
  } catch (e) {
    alert("Create folder failed: " + e.message);
  }
}

async function deleteFolder(folder) {
  if (!confirm('Remove folder "' + folder + '" from the library?\nLocal folders and files will not be deleted.')) return;
  try {
    const scopeParam = state.paperScope === "public" ? "?scope=public" : "";
    const data = await api("/api/folders/" + encodeURIComponent(folder) + scopeParam, { method: "DELETE" });
    state.papers = data.papers || state.papers;
    state.folders = data.folders || [];
    renderPaperList();
  } catch (e) {
    alert("删除文件夹失败：" + e.message);
  }
}

async function renameFolder(folder) {
  const nextName = prompt("输入新的文件夹名称", folder);
  if (!nextName || !nextName.trim() || nextName.trim() === folder) return;
  try {
    const scopeParam = state.paperScope === "public" ? "?scope=public" : "";
    const data = await api("/api/rename-folder/" + encodeURIComponent(folder) + scopeParam, {
      method: "POST",
      body: JSON.stringify({ name: nextName.trim() }),
    });
    if (data.ok) {
      state.papers = data.papers || state.papers;
      state.folders = data.folders || [];
      renderPaperList();
    } else {
      alert("重命名失败: " + (data.error || "未知错误"));
    }
  } catch (e) {
    alert("重命名失败：" + e.message);
  }
}

async function renameActivePaper() {
  if (!state.activePaper) return;
  const nextName = prompt("输入新的显示名称", state.activePaper.fileName);
  if (!nextName || !nextName.trim()) return;
  try {
    const scopeParam = state.paperScope === "public" ? "?scope=public" : "";
    const data = await api("/api/rename/" + state.activePaper.id + scopeParam, {
      method: "POST",
      body: JSON.stringify({ name: nextName.trim() }),
    });
    state.papers = data.papers || state.papers;
    await loadPaper(state.activePaper.id);
    renderPaperList();
  } catch (e) {
    alert("重命名失败：" + e.message);
  }
}

async function extractTitle() {
  if (!state.activePaper) return;
  try {
    els.extractTitleBtn.disabled = true;
    els.extractTitleBtn.textContent = "提取中...";
    const scopeParam = state.paperScope === "public" ? "?scope=public" : "";
    const apiParams = isApiConfigured() ? (scopeParam ? "&" : "?") + getApiConfigParams() : "";
    const data = await api("/api/extract-title/" + state.activePaper.id + scopeParam + apiParams, {
      method: "POST",
    });
    if (data.ok) {
      state.papers = data.papers || state.papers;
      await loadPaper(state.activePaper.id);
      renderPaperList();
    } else {
      alert("提取标题失败：" + (data.error || "未知错误"));
    }
  } catch (e) {
    alert("提取标题失败：" + e.message);
  } finally {
    els.extractTitleBtn.disabled = false;
    els.extractTitleBtn.textContent = "提取标题";
  }
}

async function uploadTranslationFile(file) {
  if (!state.activePaper || !file) return;
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await fetch("/api/upload-translation/" + state.activePaper.id, { method: "POST", body: formData });
    const data = await res.json();
    if (!data.ok) {
      alert("上传译文失败：" + (data.error || "未知错误"));
      return;
    }
    state.papers = data.papers || state.papers;
    await loadPaper(state.activePaper.id);
    renderPaperList();
  } catch (e) {
    alert("上传译文失败：" + e.message);
  }
}

async function uploadFolderFiles(files) {
  const supportedExts = [".pdf", ".md", ".txt", ".html", ".htm"];
  const validFiles = Array.from(files).filter(f => {
    const ext = f.name.toLowerCase();
    return supportedExts.some(e => ext.endsWith(e));
  });
  if (!validFiles.length) { alert("所选文件夹中没有找到支持的文件。"); return; }
  let uploaded = 0, firstNewPaper = null;
  for (const file of validFiles) {
    const relPath = file.webkitRelativePath || "";
    const folder = relPath.includes("/") ? relPath.substring(0, relPath.lastIndexOf("/")) : "";
    const formData = new FormData();
    formData.append("file", file);
    if (folder) formData.append("folder", folder);
    try {
      els.paperCount.textContent = "上传中 (" + (++uploaded) + "/" + validFiles.length + "): " + file.name;
      const uploadUrl = state.paperScope === "public" ? "/api/upload?scope=public" : "/api/upload";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      let res;
      try {
        res = await fetch(uploadUrl, { method: "POST", body: formData, credentials: "same-origin", signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => "HTTP " + res.status);
        alert("上传失败 (" + file.name + "): " + errText);
        continue;
      }
      const data = await res.json();
      if (data.ok && data.paper) {
        if (!state.papers.find(p => p.id === data.paper.id)) {
          state.papers.push(data.paper);
        }
        if (!firstNewPaper) firstNewPaper = data.paper;
      } else {
        alert("上传失败 (" + file.name + "): " + (data.error || "未知错误"));
      }
    } catch (e) {
      if (e.name === "AbortError") {
        alert("上传超时 (" + file.name + "): 请检查网络连接");
      } else {
        alert("上传失败 (" + file.name + "): " + e.message);
      }
    }
  }
  if (firstNewPaper) {
    renderPaperList();
    await loadPaper(firstNewPaper.id);
  }
}

// ── ──

// ── ──

function updateAskBtn() {
  const hasPaper = !!state.activePaper;
  const hasConfig = isApiConfigured();
  els.askBtn.disabled = !hasPaper || !hasConfig || state.asking;
  els.askInput.disabled = !hasPaper || !hasConfig;
  els.relatedBtn.disabled = !hasPaper || !hasConfig;
  updateRelatedButton();
  if (!hasPaper) {
    els.askHint.textContent = "选择一篇文献后即可提问";
  } else if (!hasConfig) {
    els.askHint.textContent = "请先在设置中配置 API";
  } else {
    els.askHint.textContent = "当前文献：" + state.activePaper.title;
  }
}

function appendAskMessage(role, text, imageDataUrl) {
  const msg = document.createElement("div");
  msg.className = "ask-msg " + role;
  if (imageDataUrl) {
    const img = document.createElement("img");
    img.className = "ask-msg-img";
    img.src = imageDataUrl;
    msg.appendChild(img);
  }
  if (role === "assistant") {
    const textDiv = document.createElement("div");
    textDiv.innerHTML = renderMarkdown(text);
    msg.appendChild(textDiv);
  } else {
    const textDiv = document.createElement("div");
    textDiv.textContent = text;
    msg.appendChild(textDiv);
  }
  els.askHistory.appendChild(msg);
  els.askHistory.scrollTop = els.askHistory.scrollHeight;
  return msg;
}

function handleImageFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.askImage = { dataUrl: reader.result, mediaType: file.type };
    showImagePreview();
    if (els.askInput.value.trim().startsWith("请识别并翻译这张截图")) startAsk();
  };
  reader.readAsDataURL(file);
}

function showImagePreview() {
  if (!state.askImage) {
    els.askImgPreview.classList.remove("has-image");
    els.askImgPreview.innerHTML = "";
    return;
  }
  els.askImgPreview.classList.add("has-image");
  els.askImgPreview.innerHTML = "";
  const img = document.createElement("img");
  img.className = "ask-img-thumb";
  img.src = state.askImage.dataUrl;
  const removeBtn = document.createElement("button");
  removeBtn.className = "ask-img-remove";
  removeBtn.title = "Remove image";
  removeBtn.textContent = "x";
  removeBtn.addEventListener("click", clearAskImage);
  els.askImgPreview.append(img, removeBtn);
}

function clearAskImage() {
  state.askImage = null;
  els.askImgPreview.classList.remove("has-image");
  els.askImgPreview.innerHTML = "";
  els.askImgInput.value = "";
}

async function startAsk() {
  if (!state.activePaper || state.asking) return;
  const question = els.askInput.value.trim();
  if (!question && !state.askImage) return;

  const image = state.askImage;
  state.asking = true;
  appendAskMessage("user", question || "(image)", image?.dataUrl);
  els.askInput.value = "";
  clearAskImage();
  els.askBtn.disabled = true;

  const assistantMsg = appendAskMessage("assistant", "Thinking...");
  let fullText = "";

  const c = state.apiConfig || {};
  const body = {
    question,
    api_key: c.apiKey || "",
    base_url: c.baseUrl || "",
    model: c.model || "",
    ask_mode: c.askMode || "balanced",
  };
  if (image) body.image = image;

  try {
    const res = await fetch("/api/ask/" + state.activePaper.id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error("Server returned " + res.status + ": " + errText);
    }

    if (!res.body) {
      throw new Error("Browser does not support ReadableStream");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;

    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.status === "token") {
            fullText += data.text;
            assistantMsg.innerHTML = renderMarkdown(fullText);
            els.askHistory.scrollTop = els.askHistory.scrollHeight;
          } else if (data.status === "done") {
            finished = true;
            break;
          } else if (data.status === "error") {
            let errMsg = data.message;
            if (/image/i.test(errMsg)) {
              errMsg += "\n\nTip: the current model may not support image input. Please switch to a vision model or remove the image.";
            }
            assistantMsg.innerHTML = '<span style="color:#d9472b">Error: ' + escapeHtml(errMsg) + '</span>';
            finished = true;
            break;
          }
        } catch {}
      }
    }
  } catch (e) {
    if (!fullText) assistantMsg.innerHTML = '<span style="color:#d9472b">Connection interrupted: ' + escapeHtml(e.message) + '</span>';
  }

  state.asking = false;
  updateAskBtn();
}

async function loadPaper(id) {
  const version = ++state.loadVersion;

  // 立即更新 UI 反馈
  const paper = state.papers.find(p => p.id === id);
  if (paper) {
    state.activePaper = paper;
    updateActivePaper();
    els.activeTitle.textContent = paper.fileName;
    els.statusPill.textContent = "加载中…";
  }
  setEnabled(false);
  els.originalViewer.innerHTML = '<div class="related-loading">正在加载原文…</div>';
  els.translationViewer.innerHTML = '<div class="related-loading">正在加载译文…</div>';

  const [payload, notes] = await Promise.all([
    api("/api/papers/" + id),
    api("/api/annotations/" + id),
  ]);

  // 用户切换了文献，取消本次加载
  if (state.loadVersion !== version) return;

  state.activePayload = payload;
  state.activePaper = payload.paper;
  state.notes = notes;
  state.editingIndex = null;
  updateActivePaper();

  els.activeTitle.textContent = payload.paper.fileName;
  els.originalName.textContent = payload.original.fileName;
  els.translationName.textContent = payload.translation ? payload.translation.fileName : "未找到对应译文文件";
  els.openTranslationBtn.disabled = !payload.translation;
  updateTranslateBtn(payload.translation);
  updateAskBtn();
  updateReadUi();

  state.pendingPoint = null;
  await renderFile(els.originalViewer, payload.original, "请选择左侧文献。");
  if (state.loadVersion !== version) return;
  await renderFile(els.translationViewer, payload.translation, "未找到对应译文文件。");
  if (state.loadVersion !== version) return;

  renderNotes();
  setEnabled(true);
  els.statusPill.textContent = "已加载";

  // Initialize drawing canvases
  state.drawCanvases = {};
  initDrawCanvas(els.originalViewer);
  initDrawCanvas(els.translationViewer);
  loadDrawData();
  selectDrawTool(state.drawTool);
}

async function toggleRead() {
  if (!state.activePaper) return;
  const nextRead = !state.activePaper.read;
  const result = await api("/api/read-status/" + state.activePaper.id, {
    method: "POST",
    body: JSON.stringify({ read: nextRead }),
  });
  state.activePaper.read = nextRead;
  state.activePaper.readAt = nextRead ? new Date().toISOString().slice(0, 19) : null;
  const paper = state.papers.find((item) => item.id === state.activePaper.id);
  if (paper) {
    paper.read = result.read;
    paper.readAt = state.activePaper.readAt;
  }
  renderPaperList();
  updateReadUi();
}

async function addOrUpdateNote() {
  if (!state.activePaper) return;
  const body = els.noteText.value.trim();
  if (!body) return;
  state.notes.items = state.notes.items || [];
  const nextNote = {
    type: "note",
    location: els.noteLocation.value.trim(),
    body,
    updatedAt: new Date().toLocaleString(),
  };
  if (state.editingIndex !== null) {
    const old = state.notes.items[state.editingIndex] || {};
    state.notes.items[state.editingIndex] = { ...old, ...nextNote, createdAt: old.createdAt || nextNote.updatedAt };
  } else {
    state.notes.items.unshift({ ...nextNote, createdAt: nextNote.updatedAt });
  }
  state.editingIndex = null;
  els.noteLocation.value = "";
  els.noteText.value = "";
  els.addNoteBtn.textContent = "添加";
  renderNotes();
  await saveNotes("已自动保存");
}

function editNote(index) {
  const note = state.notes.items[index];
  if (!note) return;
  state.editingIndex = index;
  els.noteLocation.value = note.location || "";
  els.noteText.value = note.body || "";
  els.addNoteBtn.textContent = "鏇存柊";
  els.noteText.focus();
}

async function deleteNoteByIndex(index, message = "已删除并保存") {
  state.notes.items.splice(index, 1);
  state.editingIndex = null;
  state.pendingPoint = null;
  renderNotes();
  await saveNotes(message);
}

function renderNotes() {
  els.notesList.innerHTML = "";
  const items = state.notes.items || [];
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "note-empty";
    empty.textContent = "暂无批注";
    els.notesList.appendChild(empty);
    return;
  }
  for (let noteIndex = 0; noteIndex < items.length; noteIndex += 1) {
    const note = items[noteIndex];
    const card = document.createElement("article");
    card.className = "note-card";
    card.dataset.noteIndex = noteIndex;
    card.innerHTML =
      '<div class="note-location"></div>' +
      '<div class="note-body"></div>' +
      '<div class="note-time">' + escapeHtml(note.updatedAt || note.createdAt || "") + '</div>' +
      '<div class="note-actions">' +
      '<button data-action="edit">Edit</button>' +
      '<button data-action="delete">Delete</button>' +
      '</div>';
    card.querySelector(".note-location").textContent = note.location || "未标注位置";
    card.querySelector(".note-body").textContent = note.body;
    card.querySelector('[data-action="edit"]').addEventListener("click", () => editNote(noteIndex));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteNoteByIndex(noteIndex));
    els.notesList.appendChild(card);
  }
}

async function saveNotes(message = "标注已保存") {
  if (!state.activePaper) return;
  els.saveStatus.textContent = "保存中...";
  await api("/api/annotations/" + state.activePaper.id, {
    method: "POST",
    body: JSON.stringify(state.notes),
  });
  els.saveStatus.textContent = message;
  setTimeout(() => {
    if (els.saveStatus.textContent === message) els.saveStatus.textContent = "";
  }, 1800);
}

// ── 评论 ──

async function loadComments() {
  try {
    const data = await api("/api/comments");
    renderComments(data.comments || []);
  } catch (e) {
    console.warn("加载评论失败:", e);
    renderComments([]);
  }
}

function renderComments(comments) {
  els.commentHistory.innerHTML = "";
  if (!comments.length) {
    els.commentHistory.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">暂无评论</p>';
    return;
  }
  const byId = {};
  for (const c of comments) byId[c.id] = c;
  for (const c of comments) {
    const div = document.createElement("div");
    div.className = "comment-item";
    div.dataset.commentId = c.id || "";
    const email = c.email || "匿名";
    const time = c.createdAt ? new Date(c.createdAt).toLocaleString("zh-CN") : "";
    const canDelete = state.currentUser && (!c.userId || c.userId === state.currentUser.id || state.currentUser.isAdmin);
    let replyRef = "";
    if (c.replyTo && byId[c.replyTo]) {
      const ref = byId[c.replyTo];
      const refText = (ref.text || "").length > 40 ? ref.text.slice(0, 40) + "..." : ref.text;
      replyRef = '<div class="comment-reply-ref"><span class="comment-reply-email">@' + escapeHtml(ref.email || "匿名") + '</span> ' + escapeHtml(refText) + '</div>';
    }
    div.innerHTML =
      '<div class="comment-email">' + escapeHtml(email) + '</div>' +
      replyRef +
      '<div class="comment-text"></div>' +
      '<div class="comment-actions">' +
        '<span class="comment-time">' + time + '</span>' +
        '<button class="comment-reply-btn" data-id="' + (c.id || "") + '">回复</button>' +
        (canDelete ? '<button class="comment-delete-btn" data-id="' + (c.id || "") + '">删除</button>' : '') +
      '</div>';
    div.querySelector(".comment-text").textContent = c.text;
    const replyBtn = div.querySelector(".comment-reply-btn");
    if (replyBtn) replyBtn.addEventListener("click", () => startReply(c.id, c.email));
    const deleteBtn = div.querySelector(".comment-delete-btn");
    if (deleteBtn) deleteBtn.addEventListener("click", () => deleteComment(c.id));
    els.commentHistory.appendChild(div);
  }
  els.commentHistory.scrollTop = els.commentHistory.scrollHeight;
}

async function submitComment() {
  const text = els.commentInput.value.trim();
  if (!text) return;
  try {
    els.commentSubmitBtn.disabled = true;
    const body = { text };
    if (state.replyTo) body.replyTo = state.replyTo;
    const data = await api("/api/comments", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (data.ok) {
      els.commentInput.value = "";
      state.replyTo = null;
      updateReplyHint();
      renderComments(data.comments || []);
    }
  } catch (e) {
    alert("评论失败: " + e.message);
  } finally {
    els.commentSubmitBtn.disabled = !els.commentInput.value.trim();
  }
}

async function deleteComment(id) {
  if (!confirm("确定删除这条评论？")) return;
  try {
    const data = await api("/api/comments/" + id, { method: "DELETE" });
    if (data.ok) renderComments(data.comments || []);
    else alert("删除失败: " + (data.error || "未知错误"));
  } catch (e) {
    alert("删除失败: " + e.message);
  }
}

function startReply(commentId, email) {
  state.replyTo = commentId;
  updateReplyHint();
}

function cancelReply() {
  state.replyTo = null;
  updateReplyHint();
}

function updateReplyHint() {
  let hint = document.getElementById("commentReplyHint");
  if (!state.replyTo) {
    if (hint) hint.remove();
    return;
  }
  if (!hint) {
    hint = document.createElement("div");
    hint.id = "commentReplyHint";
    hint.className = "comment-reply-hint";
    els.commentInput.parentNode.insertBefore(hint, els.commentInput);
  }
  const comments = els.commentHistory.querySelectorAll(".comment-item");
  let replyText = "";
  for (const el of comments) {
    if (el.dataset.commentId === state.replyTo) {
      replyText = el.querySelector(".comment-text")?.textContent || "";
      break;
    }
  }
  const truncated = replyText.length > 30 ? replyText.slice(0, 30) + "..." : replyText;
  hint.innerHTML = '<span>回复: ' + escapeHtml(truncated) + '</span><button onclick="cancelReply()">&times;</button>';
}

// ── ──

function drawKeyFor(container) {
  return container.dataset.drawKey || container.id;
}

function getDrawSurfaces() {
  const surfaces = document.querySelectorAll(".draw-surface");
  return surfaces.length ? Array.from(surfaces) : [els.originalViewer, els.translationViewer];
}

function getDrawCanvas(container) {
  const key = drawKeyFor(container);
  if (state.drawCanvases[key]) return state.drawCanvases[key];
  const existing = container.querySelector(".draw-canvas");
  if (existing) {
    state.drawCanvases[key] = existing;
    return existing;
  }
  const canvas = document.createElement("canvas");
  canvas.className = "draw-canvas";
  canvas.dataset.drawKey = key;
  container.appendChild(canvas);
  state.drawCanvases[key] = canvas;
  return canvas;
}

function resizeDrawCanvas(container) {
  const canvas = getDrawCanvas(container);
  const target = container.querySelector(".pdf-page-canvas") || container.querySelector(".pdf-page-img") || container;
  const rect = target.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(rect.width * dpr);
  const h = Math.floor(rect.height * dpr);
  if (canvas.width === w && canvas.height === h) return;
  const ctx = canvas.getContext("2d");
  const old = document.createElement("canvas");
  old.width = canvas.width;
  old.height = canvas.height;
  if (old.width && old.height) old.getContext("2d").drawImage(canvas, 0, 0);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (old.width && old.height) ctx.drawImage(old, 0, 0, rect.width, rect.height);
}

function initDrawCanvas(container) {
  const canvas = getDrawCanvas(container);
  resizeDrawCanvas(container);
  if (canvas.dataset.drawReady === "1") return;
  canvas.dataset.drawReady = "1";
  let drawing = false;
  let lastX = 0;
  let lastY = 0;
  let prevX = 0;
  let prevY = 0;
  let startX = 0;
  let startY = 0;
  let snapshot = null;

  const shapeTools = new Set(["highlight", "line", "arrow", "underline", "rect", "ellipse", "area-eraser"]);

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches?.[0] || e.changedTouches?.[0];
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function onStart(e) {
    if (!state.drawMode) return;
    drawing = true;
    const pos = getPos(e);
    startX = pos.x;
    startY = pos.y;
    prevX = pos.x;
    prevY = pos.y;
    lastX = pos.x;
    lastY = pos.y;
    const ctx = canvas.getContext("2d");
    snapshot = shapeTools.has(state.drawTool) ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    applyDrawStyle(ctx);
    if (state.drawTool === "eraser") eraseAt(ctx, pos.x, pos.y);
    e.preventDefault();
  }

  function applyDrawStyle(ctx) {
    if (state.drawTool === "eraser" || state.drawTool === "area-eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = Math.max(18, state.drawSize * 6);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    } else if (state.drawTool === "highlight") {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = state.drawColor + "28";
      ctx.fillStyle = state.drawColor + "30";
      ctx.lineWidth = Math.max(8, state.drawSize * 2);
      ctx.lineCap = "butt";
      ctx.lineJoin = "round";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = state.drawColor + "99";
      ctx.lineWidth = state.drawSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }
  }

  function eraseAt(ctx, x, y) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, Math.max(9, state.drawSize * 3), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    applyDrawStyle(ctx);
  }

  function drawArrow(ctx, fromX, fromY, toX, toY) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const head = Math.max(10, state.drawSize * 4);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - head * Math.cos(angle - Math.PI / 6), toY - head * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - head * Math.cos(angle + Math.PI / 6), toY - head * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  function drawShape(ctx, fromX, fromY, toX, toY) {
    applyDrawStyle(ctx);
    if (state.drawTool === "highlight") {
      const height = Math.max(12, state.drawSize * 4);
      const x = Math.min(fromX, toX);
      const width = Math.abs(toX - fromX);
      const y = fromY - height / 2;
      ctx.fillRect(x, y, width, height);
    } else if (state.drawTool === "line") {
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();
    } else if (state.drawTool === "underline") {
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, fromY);
      ctx.stroke();
    } else if (state.drawTool === "arrow") {
      drawArrow(ctx, fromX, fromY, toX, toY);
    } else if (state.drawTool === "rect") {
      ctx.strokeRect(fromX, fromY, toX - fromX, toY - fromY);
    } else if (state.drawTool === "ellipse") {
      const cx = (fromX + toX) / 2;
      const cy = (fromY + toY) / 2;
      const rx = Math.abs(toX - fromX) / 2;
      const ry = Math.abs(toY - fromY) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (state.drawTool === "area-eraser") {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "#d9472bcc";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(fromX, fromY, toX - fromX, toY - fromY);
      ctx.restore();
    }
  }

  function eraseArea(ctx, fromX, fromY, toX, toY) {
    const x = Math.min(fromX, toX);
    const y = Math.min(fromY, toY);
    const width = Math.abs(toX - fromX);
    const height = Math.abs(toY - fromY);
    if (width < 2 || height < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.clearRect(x, y, width, height);
    ctx.restore();
  }

  function onMove(e) {
    if (!drawing || !state.drawMode) return;
    const pos = getPos(e);
    const ctx = canvas.getContext("2d");
    if (shapeTools.has(state.drawTool)) {
      if (snapshot) ctx.putImageData(snapshot, 0, 0);
      drawShape(ctx, startX, startY, pos.x, pos.y);
    } else {
      const dist = Math.hypot(pos.x - lastX, pos.y - lastY);
      if (dist < 1.5) {
        e.preventDefault();
        return;
      }
      ctx.beginPath();
      const midX = (lastX + pos.x) / 2;
      const midY = (lastY + pos.y) / 2;
      ctx.moveTo(prevX, prevY);
      ctx.quadraticCurveTo(lastX, lastY, midX, midY);
      ctx.stroke();
      if (state.drawTool === "eraser") eraseAt(ctx, pos.x, pos.y);
      prevX = midX;
      prevY = midY;
      lastX = pos.x;
      lastY = pos.y;
    }
    e.preventDefault();
  }

  function onEnd(e) {
    if (!drawing) return;
    if (state.drawTool === "area-eraser") {
      const pos = e ? getPos(e) : { x: lastX, y: lastY };
      const ctx = canvas.getContext("2d");
      if (snapshot) ctx.putImageData(snapshot, 0, 0);
      eraseArea(ctx, startX, startY, pos.x, pos.y);
    }
    drawing = false;
    snapshot = null;
    saveDrawData();
  }

  canvas.addEventListener("mousedown", onStart);
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseup", onEnd);
  canvas.addEventListener("mouseleave", onEnd);
  canvas.addEventListener("touchstart", onStart, { passive: false });
  canvas.addEventListener("touchmove", onMove, { passive: false });
  canvas.addEventListener("touchend", onEnd);
}

function setDrawMode(active) {
  state.drawMode = active;
  els.drawToolbar.classList.toggle("active", active);
  els.drawModeBtn.classList.toggle("active", active);
  getDrawSurfaces().forEach((v) => {
    initDrawCanvas(v);
    const canvas = getDrawCanvas(v);
    canvas.classList.toggle("active", active);
    canvas.classList.toggle("eraser", active && (state.drawTool === "eraser" || state.drawTool === "area-eraser"));
    if (active) resizeDrawCanvas(v);
    const tl = v.querySelector(".pdf-text-layer") || v.querySelector(".textLayer");
    if (tl) tl.style.pointerEvents = active ? "none" : "";
  });
  if (!active) saveDrawData();
}

function selectDrawTool(tool) {
  state.drawTool = tool;
  if (tool === "highlight" && state.drawColor.toLowerCase() === "#e74c3c") {
    state.drawColor = "#ffd84d";
    els.drawColor.value = state.drawColor;
  }
  [
    els.drawPenBtn,
    els.drawHighlightBtn,
    els.drawLineBtn,
    els.drawArrowBtn,
    els.drawUnderlineBtn,
    els.drawRectBtn,
    els.drawEllipseBtn,
    els.drawEraserBtn,
    els.drawAreaEraseBtn,
  ].forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tool === tool);
  });
  document.querySelectorAll(".draw-canvas.active").forEach((c) => {
    c.classList.toggle("eraser", tool === "eraser" || tool === "area-eraser");
  });
}

function clearAllDraw() {
    if (!confirm("清除所有标注？")) return;
  document.querySelectorAll(".draw-canvas").forEach((canvas) => {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
  saveDrawData();
}

function saveDrawData() {
  if (!state.activePaper) return;
  const drawData = {};
  for (const [key, canvas] of Object.entries(state.drawCanvases)) {
    if (canvas.width > 0 && canvas.height > 0) {
      const ctx = canvas.getContext("2d");
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hasContent = imgData.data.some((v, i) => i % 4 === 3 && v > 0);
      if (hasContent) drawData[key] = canvas.toDataURL();
    }
  }
  state.notes.drawings = drawData;
  saveNotes("已自动保存");
}

function restoreDrawCanvas(container) {
  const key = drawKeyFor(container);
  const dataUrl = state.notes.drawings?.[key];
  if (!dataUrl) return;
  const canvas = getDrawCanvas(container);
  resizeDrawCanvas(container);
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  img.src = dataUrl;
}

function loadDrawData() {
  const drawData = state.notes.drawings || {};
  for (const [key, dataUrl] of Object.entries(drawData)) {
    const container = document.querySelector('[data-draw-key="' + CSS.escape(key) + '"]') || document.getElementById(key);
    if (!container) continue;
    const canvas = getDrawCanvas(container);
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      resizeDrawCanvas(container);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = dataUrl;
  }
}

function setCssPx(name, value, min, max) {
  document.documentElement.style.setProperty(name, Math.round(Math.min(max, Math.max(min, value))) + "px");
}

function setPairedRatios(leftName, rightName, leftValue, total, minLeft, minRight) {
  const nextLeft = Math.min(total - minRight, Math.max(minLeft, leftValue));
  document.documentElement.style.setProperty(leftName, String(Math.round(nextLeft)));
  document.documentElement.style.setProperty(rightName, String(Math.round(total - nextLeft)));
}

function normalizedWheelDelta(event) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 18;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight;
  return event.deltaY;
}

function syncReaderScroll(event) {
  if (!event.altKey) return;
  event.preventDefault();
  const delta = normalizedWheelDelta(event);
  els.originalViewer.scrollTop += delta;
  els.translationViewer.scrollTop += delta;
}

function startResize(event) {
  const mode = event.currentTarget.dataset.resize;
  const startX = event.clientX;
  const library = document.querySelector(".library");
  const original = document.querySelector(".original-panel");
  const translation = document.querySelector(".translation-panel");
  const initial = {
    library: library?.getBoundingClientRect().width || 300,
    original: original?.getBoundingClientRect().width || 420,
    translation: translation?.getBoundingClientRect().width || 420,
    notes: document.querySelector(".notes")?.getBoundingClientRect().width || 300,
    ask: document.querySelector(".ask-sidebar")?.getBoundingClientRect().width || 320,
    comment: document.querySelector(".comment-panel")?.getBoundingClientRect().width || 250,
  };

  document.body.classList.add("is-resizing");
  event.currentTarget.setPointerCapture(event.pointerId);

  function move(moveEvent) {
    const dx = moveEvent.clientX - startX;
    const width = window.innerWidth;
    if (mode === "library") setCssPx("--library-width", initial.library + dx, 220, Math.min(520, width * 0.45));
    if (mode === "original") {
      setPairedRatios("--original-ratio", "--translation-ratio", initial.original + dx, initial.original + initial.translation, 180, 180);
    }
    if (mode === "translation") {
      setCssPx("--notes-width", initial.notes - dx, 200, Math.min(520, width * 0.45));
    }
    if (mode === "notes") {
      setCssPx("--ask-width", initial.ask - dx, 200, Math.min(480, width * 0.35));
    }
    if (mode === "comment") {
      setCssPx("--comment-width", initial.comment - dx, 150, Math.min(480, width * 0.35));
    }
    if (state.drawMode) {
      getDrawSurfaces().forEach((s) => resizeDrawCanvas(s));
    }
  }

  function stop() {
    document.body.classList.remove("is-resizing");
    saveLayoutState();
    if (state.drawMode) {
      getDrawSurfaces().forEach((s) => resizeDrawCanvas(s));
    }
    // 重建文字层（图片尺寸变了，坐标需要重新计算）
    if (state.activePaper) {
      document.querySelectorAll(".pdf-page").forEach((pw) => {
        const tl = pw.querySelector(".textLayer");
        if (tl) tl.remove();
        const img = pw.querySelector(".pdf-page-img");
        if (img && img.complete) {
          const pn = pw.dataset.pageNum;
          if (pn) loadTextLayer(pw, state.activePaper.id, Number(pn));
        }
      });
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

document.querySelectorAll(".splitter").forEach((splitter) => splitter.addEventListener("pointerdown", startResize));

restoreLayoutState();
restorePanelState();

els.searchInput.addEventListener("input", renderPaperList);
els.filterBar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  els.filterBar.querySelectorAll(".filter-btn").forEach((item) => item.classList.toggle("active", item === button));
  renderPaperList();
});
els.scanBtn.addEventListener("click", () => refreshPapersFromDisk().catch(() => loadPapers(true)));
els.scopeToggleBtn.addEventListener("click", () => {
  const prevScope = state.paperScope;
  state.paperScope = state.paperScope === "public" ? "personal" : "public";
  updateScopeBtn();
  clearViewer();
  state.papers = [];
  state.folders = [];
  renderPaperList();
  loadPapers(false).catch(() => {
    state.paperScope = prevScope;
    updateScopeBtn();
  });
});
els.batchSelectBtn.addEventListener("click", () => setBatchMode(!state.batchMode));
els.batchSelectAllBtn.addEventListener("click", batchSelectAll);
els.batchDeselectAllBtn.addEventListener("click", batchDeselectAll);
els.batchDeleteBtn.addEventListener("click", batchDelete);
els.batchCancelBtn.addEventListener("click", () => setBatchMode(false));
els.hideLibraryBtn.addEventListener("click", () => setPanelHidden("library", true));
els.showLibraryBtn.addEventListener("click", () => setPanelHidden("library", false));
els.showLibraryTopBtn.addEventListener("click", () => setPanelHidden("library", false));
els.toggleReadBtn.addEventListener("click", toggleRead);
els.addNoteBtn.addEventListener("click", addOrUpdateNote);
els.hideNotesBtn.addEventListener("click", () => setPanelHidden("notes", true));
els.hideAskBtn.addEventListener("click", () => setPanelHidden("ask", true));
els.showNotesBtn.addEventListener("click", () => setPanelHidden("notes", false));
els.showNotesTopBtn.addEventListener("click", () => setPanelHidden("notes", false));
els.showAskBtn.addEventListener("click", () => setPanelHidden("ask", false));
els.showAskTopBtn.addEventListener("click", () => setPanelHidden("ask", false));
els.saveNotesBtn.addEventListener("click", () => saveNotes());
els.openOriginalBtn.addEventListener("click", () => {
  if (state.activePayload?.original) window.open(fileUrl(state.activePayload.original), "_blank");
});
els.openTranslationBtn.addEventListener("click", () => {
  if (state.activePayload?.translation) window.open(fileUrl(state.activePayload.translation), "_blank");
});
els.extractTitleBtn.addEventListener("click", extractTitle);
els.uploadTranslationBtn.addEventListener("click", () => els.translationInput.click());
els.translationInput.addEventListener("change", (e) => {
  if (e.target.files.length) uploadTranslationFile(e.target.files[0]);
  e.target.value = "";
});
els.translateBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  els.translateMenu.classList.toggle("hidden");
});
els.translateMenu.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-mode]");
  if (!btn) return;
  startTranslation(btn.dataset.mode);
});
document.addEventListener("click", () => {
  els.translateMenu.classList.add("hidden");
});
els.drawModeBtn.addEventListener("click", () => setDrawMode(!state.drawMode));
els.drawPenBtn.addEventListener("click", () => selectDrawTool("pen"));
els.drawHighlightBtn.addEventListener("click", () => selectDrawTool("highlight"));
els.drawLineBtn.addEventListener("click", () => selectDrawTool("line"));
els.drawArrowBtn.addEventListener("click", () => selectDrawTool("arrow"));
els.drawUnderlineBtn.addEventListener("click", () => selectDrawTool("underline"));
els.drawRectBtn.addEventListener("click", () => selectDrawTool("rect"));
els.drawEllipseBtn.addEventListener("click", () => selectDrawTool("ellipse"));
els.drawEraserBtn.addEventListener("click", () => selectDrawTool("eraser"));
els.drawAreaEraseBtn.addEventListener("click", () => selectDrawTool("area-eraser"));
els.drawColor.addEventListener("input", (e) => { state.drawColor = e.target.value; });
els.drawSize.addEventListener("input", (e) => { state.drawSize = +e.target.value; });
els.drawClearBtn.addEventListener("click", clearAllDraw);
els.drawExitBtn.addEventListener("click", () => setDrawMode(false));
// Add dropdown toggle
els.addPaperBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  els.addDropdown.classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (!els.addDropdown.contains(e.target)) els.addDropdown.classList.remove("open");
});
els.addFileBtn.addEventListener("click", () => {
  els.addDropdown.classList.remove("open");
  els.fileInput.click();
});
els.addFolderBtn.addEventListener("click", () => {
  els.addDropdown.classList.remove("open");
  els.folderInput.click();
});
els.newFolderBtn.addEventListener("click", () => {
  els.addDropdown.classList.remove("open");
  createFolder();
});
els.fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) uploadFiles(e.target.files);
  e.target.value = "";
});
els.folderInput.addEventListener("change", (e) => {
  if (e.target.files.length) uploadFolderFiles(e.target.files);
  e.target.value = ""
});
els.dropZone.addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("drag-over"); });
els.dropZone.addEventListener("dragleave", () => document.body.classList.remove("drag-over"));
els.dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("drag-over");
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer.types.includes("Files")) document.body.classList.add("drag-over");
});
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget || e.relatedTarget === document.documentElement) document.body.classList.remove("drag-over");
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("drag-over");
});
els.askBtn.addEventListener("click", startAsk);
els.askInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    startAsk();
  }
});
els.askImgBtn.addEventListener("click", () => els.askImgInput.click());
els.askImgInput.addEventListener("change", (e) => {
  if (e.target.files.length) handleImageFile(e.target.files[0]);
  e.target.value = "";
});
els.askInput.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      handleImageFile(item.getAsFile());
      return;
    }
  }
});
els.settingsBtn.addEventListener("click", openSettings);
els.settingsCloseBtn.addEventListener("click", closeSettings);

// Auth event listeners
els.authSubmitBtn.addEventListener("click", authSubmit);
els.authSwitchBtn.addEventListener("click", () => {
  showAuthModal(state.authMode === "login" ? "register" : "login");
});
els.authPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") authSubmit();
});
els.userLogoutBtn.addEventListener("click", logout);
els.loginBtn.addEventListener("click", () => showAuthModal("login"));
let settingsMouseDownOnOverlay = false;
els.settingsOverlay.addEventListener("mousedown", (e) => { settingsMouseDownOnOverlay = e.target === els.settingsOverlay; });
els.settingsOverlay.addEventListener("click", (e) => { if (e.target === els.settingsOverlay && settingsMouseDownOnOverlay) closeSettings(); });
els.settingsSaveBtn.addEventListener("click", async () => {
  saveApiConfig({
    baseUrl: els.settingsBaseUrl.value.trim(),
    apiKey: els.settingsApiKey.value.trim(),
    model: els.settingsModel.value.trim(),
    askMode: els.settingsAskMode?.value || "balanced",
  });
  closeSettings();
  refreshPapersFromDisk().catch(() => loadPapers(true));
});
els.relatedBtn.addEventListener("click", startRelated);
els.saveToMyLibraryBtn.addEventListener("click", async () => {
  if (!state.activePaper) return;
  try {
    els.saveToMyLibraryBtn.disabled = true;
    els.saveToMyLibraryBtn.textContent = "保存中...";
    const data = await api("/api/papers/" + state.activePaper.id + "/save-to-library", { method: "POST" });
    if (data.ok) {
      alert("已保存到你的文献库。");
      state.paperScope = "personal";
      updateScopeBtn();
      loadPapers(false);
    } else {
      alert("保存失败: " + (data.error || "未知错误"));
    }
  } catch (e) {
    alert("保存失败: " + e.message);
  } finally {
    els.saveToMyLibraryBtn.disabled = false;
    els.saveToMyLibraryBtn.textContent = "保存到我的文献库";
  }
});
els.relatedCancelBtn.addEventListener("click", () => cancelRelatedSearch());
els.relatedCloseBtn.addEventListener("click", closeRelated);
let relatedMouseDownOnOverlay = false;
els.relatedOverlay.addEventListener("mousedown", (e) => { relatedMouseDownOnOverlay = e.target === els.relatedOverlay; });
els.relatedOverlay.addEventListener("click", (e) => { if (e.target === els.relatedOverlay && relatedMouseDownOnOverlay) closeRelated(); });

// Comment panel event listeners
els.commentBtn.addEventListener("click", () => {
  const visible = !els.commentPanel.classList.contains("visible");
  els.commentPanel.classList.toggle("visible", visible);
  document.querySelector(".comment-splitter")?.classList.toggle("visible", visible);
  if (visible) {
    loadComments();
    // 打开评论时，如果右侧空间不足，自动缩小 AI 提问面板
    const commentW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--comment-width")) || 250;
    const askW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--ask-width")) || 320;
    const notesW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--notes-width")) || 280;
    const splitterW = 10;
    const rightTotal = notesW + askW + commentW + splitterW * 3;
    const maxRight = window.innerWidth * 0.6;
    if (rightTotal > maxRight) {
      const newAsk = Math.max(200, askW - (rightTotal - maxRight));
      document.documentElement.style.setProperty("--ask-width", Math.round(newAsk) + "px");
      saveLayoutState();
    }
  }
});
els.commentCloseBtn.addEventListener("click", () => {
  els.commentPanel.classList.remove("visible");
  document.querySelector(".comment-splitter")?.classList.remove("visible");
});
els.commentInput.addEventListener("input", () => {
  els.commentSubmitBtn.disabled = !els.commentInput.value.trim();
});
els.commentSubmitBtn.addEventListener("click", submitComment);
els.commentInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (els.commentInput.value.trim()) submitComment();
  }
});

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyPreset(btn.dataset.url, btn.dataset.model));
});
els.settingsBaseUrl.addEventListener("input", updatePresetButtons);
els.originalViewer.addEventListener("wheel", syncReaderScroll, { passive: false });
els.translationViewer.addEventListener("wheel", syncReaderScroll, { passive: false });
window.addEventListener("focus", () => refreshPapersFromDisk().catch(() => {}));
document.addEventListener("visibilitychange", () => refreshPapersFromDisk().catch(() => {}));
setInterval(() => refreshPapersFromDisk().catch(() => {}), PAPER_REFRESH_INTERVAL_MS);

loadApiConfig();
updateModelDisplay();
loadTranslateConfig();
// Check auth status then load papers
checkAuth().then((loggedIn) => {
  if (!loggedIn) {
    showAuthModal("login");
    return;
  }
  loadPapers().catch((error) => {
    els.paperCount.textContent = "加载失败";
    els.originalViewer.textContent = error.message;
  });
});

window.addEventListener("resize", () => {
  getDrawSurfaces().forEach((s) => resizeDrawCanvas(s));
  // 重建文字层
  if (state.activePaper) {
    document.querySelectorAll(".pdf-page").forEach((pw) => {
      const tl = pw.querySelector(".textLayer");
      if (tl) tl.remove();
      const img = pw.querySelector(".pdf-page-img");
      if (img && img.complete) {
        const pn = pw.dataset.pageNum;
        if (pn) loadTextLayer(pw, state.activePaper.id, Number(pn));
      }
    });
  }
});


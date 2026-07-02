(function(){
  const BASE_PREFIX = 'paperReader.local.';
  const HANDLE_DB = 'paperReaderHandles';
  const HANDLE_STORE = 'handles';
  const DEFAULT_TAGS = ['待读','精读','综述','催化','DFT','机器学习','待翻译'];
  const MARK = /(^|[_\-\s])(zh|cn|chinese|translation|translated|中文|译文|翻译|中译)($|[_\-\s])/i;
  const EXT = ['.pdf', '.md', '.txt', '.html', '.htm'];
  const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];
  const state = {
    papers: [],
    files: [],
    directoryHandle: null,
    active: null,
    notes: { items: [] },
    filter: 'all',
    pdfToken: 0,
    libraryHidden: false,
    controlsHidden: false,
    notesHidden: false,
    compactTop: false,
    user: null,
    selected: new Set(),
    selectedFolders: new Set(),
    openFolders: {},
    tagFilter: '',
    viewMode: 'split',
    progressTimer: null,
    scanToken: 0,
  };
  const $ = (s) => document.querySelector(s);
  const els = {
    pick: $('#pickFolderBtn'), refresh: $('#refreshFolderBtn'), hideLibrary: $('#hideLibraryBtn'), showLibrary: $('#showLibraryBtn'),
    compactTop: $('#compactTopBtn'), toggleControls: $('#toggleControlsBtn'), libraryControls: $('#libraryControls'),
    hideNotes: $('#hideNotesBtn'), showNotes: $('#showNotesBtn'),
    input: $('#folderInput'), addFilesInput: $('#addFilesInput'), translationFileInput: $('#translationFileInput'), replacePdfInput: $('#replacePdfInput'), count: $('#paperCount'), search: $('#searchInput'),
    stats: $('#libraryStats'), tagFilter: $('#tagFilter'),
    addFolder: $('#addFolderBtn'), addFiles: $('#addFilesBtn'), createFolder: $('#createFolderBtn'), targetFolder: $('#targetFolderSelect'), selectAll: $('#selectAllBtn'), deleteSelected: $('#deleteSelectedBtn'),
    filters: $('#filterBar'), list: $('#paperList'), title: $('#activeTitle'), meta: $('#activeMeta'),
    oname: $('#originalName'), tname: $('#translationName'), orig: $('#originalViewer'), trans: $('#translationViewer'),
    read: $('#toggleReadBtn'), save: $('#saveNotesBtn'), add: $('#addNoteBtn'), loc: $('#noteLocation'), txt: $('#noteText'),
    allNotesBtn: $('#allNotesBtn'), allNotesDialog: $('#allNotesDialog'), allNotesList: $('#allNotesList'), viewMode: $('#viewModeSelect'),
    detail: $('#detailPanel'), detailTitle: $('#detailTitle'), detailMeta: $('#detailMeta'), tagList: $('#tagList'), tagPreset: $('#tagPreset'),
    tagInput: $('#tagInput'), addTag: $('#addTagBtn'), starBtn: $('#starBtn'), renameBtn: $('#renameBtn'), replacePdf: $('#replacePdfBtn'),
    bindTranslation: $('#bindTranslationBtn'), clearTranslation: $('#clearTranslationBtn'), translationDialog: $('#translationDialog'),
    translationForm: $('#translationForm'), translationSelect: $('#translationSelect'), translationCancel: $('#translationCancelBtn'), translationAddFile: $('#translationAddFileBtn'),
    backupBanner: $('#backupBanner'), backupExport: $('#backupExportBtn'), backupLater: $('#backupLaterBtn'),
    notes: $('#notesList'), exportBtn: $('#exportBtn'), importBtn: $('#importBtn'),
    importInput: $('#importInput'), toast: $('#toast'),
    loginBtn: $('#loginBtn'), userInfo: $('#userInfo'), userName: $('#userName'), logoutBtn: $('#logoutBtn'),
    authDialog: $('#authDialog'), authForm: $('#authForm'), authName: $('#authName'), authPassword: $('#authPassword'),
    authError: $('#authError'), authCancel: $('#authCancelBtn')
  };

  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';

  function ext(n){ const i = n.lastIndexOf('.'); return i >= 0 ? n.slice(i).toLowerCase() : ''; }
  function name(p){ return (p.split(/[\\/]/).pop() || p); }
  function stem(p){
    let n = name(p), e = ext(n);
    if (e) n = n.slice(0, -e.length);
    return n
      .replace(/\((?:translation|translated|中文|译文|翻译|翻译版|中译|zh|cn)\)/ig, ' ')
      .replace(/\b(?:academic[_\-\s]*)?translation\b/ig, ' ')
      .replace(/(?:_|\-|\s)*(?:translation|translated|chinese|zh|cn|中文|中文版|译文|翻译|翻译版|中译)(?:版)?/ig, ' ')
      .replace(MARK, ' ')
      .replace(/[_\-\s]+/g, ' ')
      .trim()
      .toLowerCase();
  }
  function looksTranslation(path){
    const s = name(path).toLowerCase();
    return /(?:^|[_\-\s])(zh|cn|chinese|translation|translated)(?:$|[_\-\s])/.test(s)
      || /(中文|中文版|译文|翻译|翻译版|中译|academic[_\-\s]*translation)/i.test(s);
  }
  function compactStem(value){
    return stem(value).replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, '');
  }
  function tokensOf(value){
    return stem(value)
      .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !/^(the|and|for|with|from|into|onto|this|that|role|new|data|driven)$/i.test(t));
  }
  function tokenScore(a, b){
    const source = new Set(tokensOf(a));
    const target = new Set(tokensOf(b));
    if (!source.size || !target.size) return 0;
    let hit = 0;
    for (const t of target) {
      if (source.has(t) || [...source].some(s => s.includes(t) || t.includes(s))) hit++;
    }
    return hit / Math.min(source.size, target.size);
  }
  function pathOf(f){ return f.webkitRelativePath || f._relativePath || f.name; }
  function id(f){ return [pathOf(f), f.size, f.lastModified].join('|'); }
  function dirname(path){ const parts = path.split(/[\\/]/); parts.pop(); return parts.join('/'); }
  function normalizePath(path){
    const out = [];
    path.replace(/\\/g, '/').split('/').forEach(part => {
      if (!part || part === '.') return;
      if (part === '..') out.pop();
      else out.push(part);
    });
    return out.join('/');
  }
  function profileId(){ return state.user?.id || 'guest'; }
  function storagePrefix(){ return BASE_PREFIX + 'profile.' + profileId() + '.'; }
  function appKey(name){ return BASE_PREFIX + name; }
  function profileKey(name){ return storagePrefix() + name; }
  function key(kind, paperId){ return storagePrefix() + kind + '.' + btoa(unescape(encodeURIComponent(paperId))).replace(/=+$/, ''); }
  function get(k, d){ try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : d; } catch { return d; } }
  function set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
  function esc(v){ return String(v || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function size(b){ return b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
  function isRead(p){ return !!get(key('read', p.id), null); }
  function setRead(p, v){ const k = key('read', p.id); if (v) set(k, { read: true, updatedAt: new Date().toISOString() }); else localStorage.removeItem(k); }
  function loadMeta(p){ return get(key('meta', p.id), { tags: [], starred: false, displayName: '', manualTranslation: null, progress: null, lastOpenedAt: '' }); }
  function saveMeta(p, meta){ set(key('meta', p.id), { ...meta, updatedAt: new Date().toISOString() }); }
  function updateMeta(p, patch){ const meta = { ...loadMeta(p), ...patch }; saveMeta(p, meta); return meta; }
  function loadNotes(p){ return get(key('notes', p.id), { items: [] }); }
  function toast(msg){ els.toast.textContent = msg; els.toast.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => els.toast.classList.add('hidden'), 1800); }
  function displayTitle(p){ return loadMeta(p).displayName || p.pdfTitle || p.docTitle || p.title; }
  function shownTitle(p){ return displayTitle(p).toLocaleLowerCase(); }
  function fmtTime(v){ return v ? new Date(v).toLocaleString() : '无'; }
  function isStarred(p){ return !!loadMeta(p).starred; }
  function paperTags(p){ return loadMeta(p).tags || []; }
  function noteCount(p){ return (loadNotes(p).items || []).length; }
  function setCss(name, value){ document.documentElement.style.setProperty(name, value); localStorage.setItem(profileKey('layout.' + name), value); }
  function applyCss(name, value){ document.documentElement.style.setProperty(name, value); }
  function persistCss(name){ localStorage.setItem(profileKey('layout.' + name), getComputedStyle(document.documentElement).getPropertyValue(name).trim()); }
  function loadLayout(){
    ['--library-width','--original-width','--translation-width','--notes-width'].forEach(name => {
      const value = localStorage.getItem(profileKey('layout.' + name));
      if (value) document.documentElement.style.setProperty(name, value);
    });
    setLibraryHidden(localStorage.getItem(profileKey('libraryHidden')) === '1', false);
    setControlsHidden(localStorage.getItem(profileKey('controlsHidden')) === '1', false);
    setNotesHidden(localStorage.getItem(profileKey('notesHidden')) !== '0', false);
    setViewMode(localStorage.getItem(profileKey('viewMode')) || 'split', false);
    setCompactTop(localStorage.getItem(profileKey('compactTop')) === '1', false);
    state.openFolders = get(profileKey('openFolders'), {});
  }

  function userIdFromName(value){
    return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5._-]+/g, '-').replace(/^-+|-+$/g, '') || 'user';
  }

  async function digest(value){
    if (!crypto.subtle) {
      let h = 2166136261;
      for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
      return String(h >>> 0);
    }
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function loadUsers(){ return get(appKey('users'), {}); }
  function saveUsers(users){ set(appKey('users'), users); }
  function loadReplacedPaths(){ return get(profileKey('replacedPaths'), {}); }
  function saveReplacedPaths(paths){ set(profileKey('replacedPaths'), paths); }

  function cleanPdfTitle(value){
    const title = String(value || '').replace(/\.pdf$/i, '').replace(/\s+/g, ' ').trim();
    if (!title || title.length < 4 || /^(untitled|document|pdf)$/i.test(title)) return '';
    return title;
  }

  function looksDoiTitle(value){
    return /^doi:\s*10\.\d{4,9}\//i.test(String(value || '').trim());
  }

  function titleFromPdfLines(lines){
      const clean = lines
      .map(line => cleanPdfTitle(line))
      .filter(Boolean)
      .filter(line => !/^(available online|journal of|science direct|www\.|http|abstract|keywords|published as|proceedings|conference paper|elsevier)/i.test(line))
      .filter(line => !/^arxiv:/i.test(line));
    const abstractIndex = clean.findIndex(line => /^abstract$/i.test(line));
    const top = (abstractIndex > 0 ? clean.slice(0, abstractIndex) : clean.slice(0, 14))
      .filter(line => line.length >= 8 && line.length <= 180);
    function authorish(line){
      return /@/.test(line)
        || /received\s+\d/i.test(line)
        || /\b(university|institute|department|center|centre|laborator|contribution)\b/i.test(line)
        || (line.match(/\b[A-Z][a-z]+(?:-[A-Z][a-z]+)?\d+\b/g) || []).length >= 2
        || (line.match(/\b[A-Z][a-z]+(?:-[A-Z][a-z]+)?\b/g) || []).length >= 4
        || (line.split(',').length >= 3 && /\b[A-Z]\.\s*[A-Z]/.test(line));
    }
    const start = top.findIndex(line => !authorish(line) && /[a-zA-Z\u4e00-\u9fa5]/.test(line));
    if (start >= 0) {
      const parts = [];
      for (const line of top.slice(start)) {
        if (authorish(line)) break;
        parts.push(line);
        if (parts.join(' ').length > 150 || parts.length >= 3) break;
      }
      const title = cleanPdfTitle(parts.join(' '));
      if (title) return title;
    }
    return top.find(line => !authorish(line)) || '';
  }

  function isGeneratedPdfName(value){
    const base = name(value).replace(/\.pdf$/i, '');
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)
      || /^_?upload[_\-\s]*tmp/i.test(base)
      || /^download(?:\s*\(\d+\))?$/i.test(base);
  }

  function titleKey(value){
    return compactStem(value).slice(0, 180);
  }

  function paperTitleKey(p){
    return titleKey(p.pdfTitle || loadMeta(p).displayName || p.title);
  }

  function paperIdentityKeys(p){
    const keys = new Set();
    [p.pdfTitle, loadMeta(p).displayName, p.title].forEach(v => {
      const k = titleKey(v);
      if (k && k.length >= 8) keys.add('title:' + k);
    });
    const doi = titleValues(p).join(' ').match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0];
    if (doi) keys.add('doi:' + doi.toLowerCase());
    const tr = paperTranslation(p);
    if (tr?.path) keys.add('translation:' + titleKey(tr.path));
    return [...keys];
  }

  function titleValues(item){
    return [item.pdfTitle, item.docTitle, item.title, item.stem, item.path].filter(Boolean);
  }

  function titleMatchScore(source, target){
    let best = 0;
    for (const a of titleValues(source)) {
      const compactA = compactStem(a);
      if (!compactA) continue;
      for (const b of titleValues(target)) {
        const compactB = compactStem(b);
        if (!compactB) continue;
        const includes = compactA.length >= 8 && compactB.length >= 8 && (compactA.includes(compactB) || compactB.includes(compactA));
        const score = compactA === compactB || includes ? 1 : tokenScore(a, b);
        best = Math.max(best, score);
      }
    }
    return best;
  }

  function applyUser(){
    if (state.user) {
      els.loginBtn.classList.add('hidden');
      els.userInfo.classList.remove('hidden');
      els.userName.textContent = state.user.name;
    } else {
      els.loginBtn.classList.remove('hidden');
      els.userInfo.classList.add('hidden');
      els.userName.textContent = '';
    }
  }

  async function login(nameValue, passwordValue){
    const name = nameValue.trim();
    const password = passwordValue;
    if (!name || !password) throw new Error('请输入昵称和密码');
    const id = userIdFromName(name);
    const users = loadUsers();
    const passwordHash = await digest(id + ':' + password);
    if (users[id] && users[id].passwordHash !== passwordHash) throw new Error('密码不正确');
    users[id] = users[id] || { id, name, passwordHash, createdAt: new Date().toISOString() };
    users[id].name = name;
    users[id].lastLoginAt = new Date().toISOString();
    saveUsers(users);
    state.user = { id, name };
    set(appKey('session'), state.user);
    applyUser();
    loadLayout();
    clear(state.papers.length ? '已切换用户，请重新选择文献。' : '选择一个本机文件夹开始');
    renderList();
    await restoreSavedFolder();
  }

  function logout(){
    state.user = null;
    localStorage.removeItem(appKey('session'));
    state.directoryHandle = null;
    state.papers = [];
    state.files = [];
    state.active = null;
    applyUser();
    loadLayout();
    clear('已退出登录');
    renderList();
    els.refresh.disabled = true;
  }

  function openHandleDb(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(HANDLE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function handleStore(mode, fn){
    const db = await openHandleDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, mode);
      const store = tx.objectStore(HANDLE_STORE);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  function handleKey(){ return profileId() + ':directory'; }
  async function saveDirectoryHandle(handle){
    if (!window.indexedDB || !handle) return;
    try { await handleStore('readwrite', store => store.put(handle, handleKey())); } catch {}
  }
  async function loadDirectoryHandle(){
    if (!window.indexedDB) return null;
    try { return await handleStore('readonly', store => store.get(handleKey())); } catch { return null; }
  }
  async function ensureFolderPermission(handle, ask, mode = 'read'){
    if (!handle?.queryPermission) return true;
    const opts = { mode };
    if (await handle.queryPermission(opts) === 'granted') return true;
    if (ask && handle.requestPermission) return await handle.requestPermission(opts) === 'granted';
    return false;
  }

  async function restoreSavedFolder(){
    const handle = await loadDirectoryHandle();
    if (!handle) return;
    state.directoryHandle = handle;
    els.refresh.disabled = false;
    if (await ensureFolderPermission(handle, false)) {
      scan(await filesFromDirectoryHandle(handle), '已恢复上次文件夹');
    } else {
      toast('浏览器记得上次文件夹，点击“刷新”重新授权');
    }
  }

  function saveNotes(){
    if (!state.active) return;
    state.notes.updatedAt = new Date().toISOString();
    set(key('notes', state.active.id), state.notes);
    toast('批注已保存');
    renderDetail(); renderList(); checkBackupReminder();
  }

  function assetFileFor(docPath, rawSrc){
    if (!rawSrc || /^(?:https?:|data:|blob:|#|mailto:)/i.test(rawSrc)) return null;
    const clean = decodeURIComponent(String(rawSrc).split(/[?#]/)[0]).replace(/^\.?[\\/]/, '');
    const base = dirname(docPath || '');
    const candidates = [
      normalizePath(base ? `${base}/${clean}` : clean),
      normalizePath(clean),
      name(clean)
    ].filter(Boolean).map(v => v.toLowerCase());
    return state.files.find(f => {
      const p = normalizePath(pathOf(f)).toLowerCase();
      return IMAGE_EXT.includes(ext(p)) && (candidates.includes(p) || name(p).toLowerCase() === candidates[candidates.length - 1]);
    }) || null;
  }

  function assetUrlFor(docPath, src){
    const file = assetFileFor(docPath, src);
    return file ? URL.createObjectURL(file) : src;
  }

  function inlineMd(text, docPath){
    return esc(text)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img src="${esc(assetUrlFor(docPath, src.trim()))}" alt="${esc(alt)}" loading="lazy">`)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${esc(href.trim())}" target="_blank" rel="noopener">${label}</a>`);
  }

  function cleanHtml(html, docPath){
    const template = document.createElement('template');
    template.innerHTML = htmlWithAssets(html, docPath);
    template.content.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(node => node.remove());
    template.content.querySelectorAll('*').forEach(node => {
      [...node.attributes].forEach(attr => {
        const attrName = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (attrName.startsWith('on')) node.removeAttribute(attr.name);
        if ((attrName === 'src' || attrName === 'href') && /^javascript:/i.test(value)) node.removeAttribute(attr.name);
        if (attrName === 'href' && value && !/^(?:https?:|mailto:|#|blob:|data:)/i.test(value)) node.setAttribute('target', '_blank');
      });
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener');
      }
      if (node.tagName === 'IMG' && !node.getAttribute('loading')) node.setAttribute('loading', 'lazy');
    });
    return template.innerHTML;
  }

  function htmlBlock(x, docPath){
    const body = cleanHtml(x.replace(/\n/g, '<br>'), docPath);
    return /<(p|div|h[1-6]|ul|ol|li|blockquote|table|pre|img|figure)\b/i.test(x.trim()) ? body : '<p>' + body + '</p>';
  }

  function md(text, docPath = ''){
    return text.split(/\n\s*\n/).map(block => {
      const x = block.trim();
      if (!x) return '';
      if (/<\/?[a-z][\s\S]*>/i.test(x)) return htmlBlock(x, docPath);
      if (/^#{1,4}\s/.test(x)) return '<h3>' + inlineMd(x.replace(/^#{1,4}\s/, ''), docPath) + '</h3>';
      if (/^[-*]\s/m.test(x)) return '<ul>' + x.split(/\n/).filter(Boolean).map(line => '<li>' + inlineMd(line.replace(/^[-*]\s*/, ''), docPath) + '</li>').join('') + '</ul>';
      return '<p>' + inlineMd(x, docPath).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function htmlWithAssets(text, docPath){
    return text.replace(/\s(src|href)=["']([^"']+)["']/gi, (all, attr, src) => {
      if (attr.toLowerCase() === 'href' && !IMAGE_EXT.includes(ext(src))) return all;
      return ` ${attr}="${esc(assetUrlFor(docPath, src))}"`;
    });
  }

  function pass(p){
    const q = els.search.value.trim().toLowerCase();
    const tags = paperTags(p);
    if (q && !(displayTitle(p) + ' ' + p.title + ' ' + p.path + ' ' + tags.join(' ')).toLowerCase().includes(q)) return false;
    if (state.tagFilter && !tags.includes(state.tagFilter)) return false;
    if (state.filter === 'read') return isRead(p);
    if (state.filter === 'unread') return !isRead(p);
    if (state.filter === 'translated') return !!paperTranslation(p);
    if (state.filter === 'missing') return !paperTranslation(p);
    if (state.filter === 'starred') return isStarred(p);
    return true;
  }

  function updateStats(){
    const total = state.papers.length;
    const read = state.papers.filter(isRead).length;
    const starred = state.papers.filter(isStarred).length;
    const translated = state.papers.filter(p => !!paperTranslation(p)).length;
    const notes = state.papers.reduce((sum, p) => sum + noteCount(p), 0);
    els.stats.innerHTML = total
      ? `<span>总数 ${total}</span><span>已读 ${read}</span><span>星标 ${starred}</span><span>有译文 ${translated}</span><span>无译文 ${total - translated}</span><span>批注 ${notes}</span>`
      : '<span>暂无文献</span>';
  }

  function updateTagFilterOptions(){
    const tags = new Set(DEFAULT_TAGS);
    state.papers.forEach(p => paperTags(p).forEach(t => tags.add(t)));
    const current = state.tagFilter;
    els.tagFilter.innerHTML = '<option value="">全部标签</option>' + [...tags].sort((a,b) => a.localeCompare(b, 'zh-Hans-CN')).map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    els.tagFilter.value = current;
  }

  function folderOfPath(path){
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.length > 1 ? parts[0] : '根目录';
  }

  function folderOfPaper(p){ return folderOfPath(p.path); }

  function savedFolders(){ return get(profileKey('customFolders'), []); }

  function saveFolderName(folder){
    if (!folder || folder === '根目录') return;
    const folders = new Set(savedFolders());
    folders.add(folder);
    set(profileKey('customFolders'), [...folders].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')));
  }

  function currentFolders(){
    return [...new Set([...savedFolders(), ...state.files.map(f => folderOfPath(pathOf(f))).filter(folder => folder !== '根目录')])]
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }

  function updateTargetFolderOptions(){
    if (!els.targetFolder) return;
    const current = els.targetFolder.value;
    const options = ['<option value="">根目录</option>'].concat(currentFolders().map(folder => `<option value="${esc(folder)}">${esc(folder)}</option>`));
    els.targetFolder.innerHTML = options.join('');
    els.targetFolder.value = currentFolders().includes(current) ? current : '';
  }

  function folderKey(name){ return 'folder:' + name; }

  function isFolderOpen(name){
    return name === '根目录' ? state.openFolders[folderKey(name)] !== false : !!state.openFolders[folderKey(name)];
  }

  function setFolderOpen(name, open){
    state.openFolders[folderKey(name)] = open;
    set(profileKey('openFolders'), state.openFolders);
  }

  function setFolderSelected(folder, selected, papers){
    if (selected) {
      state.selectedFolders.add(folder);
      papers.forEach(p => state.selected.add(p.id));
    } else {
      state.selectedFolders.delete(folder);
      papers.forEach(p => state.selected.delete(p.id));
    }
  }

  function syncFolderSelection(folder, papers){
    if (papers.length && papers.every(p => state.selected.has(p.id))) state.selectedFolders.add(folder);
    else state.selectedFolders.delete(folder);
  }

  function renderList(){
    els.list.innerHTML = '';
    updateStats();
    updateTagFilterOptions();
    updateTargetFolderOptions();
    const rows = state.papers.filter(pass);
    els.count.textContent = state.papers.length ? `${rows.length} / ${state.papers.length} 篇` : '请选择文件夹';
    updateLibraryTools(rows);
    if (!rows.length) {
      els.list.innerHTML = '<div class="paper-meta empty-list">点击“选择文件夹”读取本机 PDF。</div>';
      return;
    }
    const groups = new Map();
    rows.forEach(p => {
      const folder = folderOfPaper(p);
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push(p);
    });
    [...groups.entries()]
      .sort((a, b) => (a[0] === '根目录' ? -1 : b[0] === '根目录' ? 1 : a[0].localeCompare(b[0], 'zh-Hans-CN')))
      .forEach(([folder, papers]) => {
        const open = isFolderOpen(folder);
        const folderRow = document.createElement('div');
        const selectedCount = papers.filter(p => state.selected.has(p.id)).length;
        const folderSelected = !!papers.length && selectedCount === papers.length;
        folderRow.className = 'folder-row' + (open ? ' open' : '');
        folderRow.innerHTML = `<label class="folder-check"><input type="checkbox" ${folderSelected ? 'checked' : ''} aria-label="选择文件夹" /></label><button class="folder-toggle" title="${esc(folder)}"><span class="folder-caret">${open ? '▾' : '▸'}</span><span class="folder-name">${esc(folder)}</span><span class="folder-count">${papers.length}</span></button>`;
        const folderCheckbox = folderRow.querySelector('input');
        folderCheckbox.indeterminate = selectedCount > 0 && selectedCount < papers.length;
        folderCheckbox.onchange = e => { setFolderSelected(folder, e.target.checked, papers); renderList(); };
        folderRow.querySelector('.folder-toggle').onclick = () => { setFolderOpen(folder, !open); renderList(); };
        els.list.appendChild(folderRow);
        if (!open) return;
        papers.forEach(p => {
      const row = document.createElement('div');
      const tags = paperTags(p);
      row.className = 'paper-row' + (state.active && state.active.id === p.id ? ' active' : '') + (isRead(p) ? ' read' : '') + (isStarred(p) ? ' starred' : '');
      row.innerHTML = `<label class="paper-check"><input type="checkbox" ${state.selected.has(p.id) ? 'checked' : ''} aria-label="选择文献" /></label><button class="paper-open" title="${esc(shownTitle(p))}"><div class="paper-card-head"><div class="paper-title">${esc(shownTitle(p))}</div><span class="paper-star">${isStarred(p) ? '★' : '☆'}</span></div><div class="paper-meta">${isRead(p) ? '已读' : '未读'} · ${paperTranslation(p) ? '有译文' : '无译文'} · ${size(p.file.size)}${tags.length ? ' · ' + esc(tags.slice(0,2).join('/')) : ''}</div></button>`;
      row.querySelector('input').onchange = e => { e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id); syncFolderSelection(folder, papers); renderList(); };
      row.querySelector('.paper-open').onclick = () => openPaper(p);
      row.querySelector('.paper-star').onclick = e => { e.stopPropagation(); toggleStar(p); };
      els.list.appendChild(row);
        });
    });
  }

  function updateLibraryTools(rows = state.papers.filter(pass)){
    const hasLibrary = !!state.files.length || !!state.directoryHandle;
    const visibleIds = new Set(rows.map(p => p.id));
    const visibleFolders = new Set(rows.map(folderOfPaper));
    const selectedVisible = [...state.selected].filter(id => visibleIds.has(id)).length;
    const selectedFolderVisible = [...state.selectedFolders].filter(folder => visibleFolders.has(folder)).length;
    els.addFolder.disabled = false;
    els.addFiles.disabled = false;
    els.createFolder.disabled = !state.directoryHandle;
    els.selectAll.disabled = !rows.length;
    els.deleteSelected.disabled = !selectedVisible && !selectedFolderVisible;
    els.selectAll.textContent = rows.length && selectedVisible === rows.length ? '取消全选' : '全选';
  }

  function toggleStar(p){
    updateMeta(p, { starred: !isStarred(p) });
    renderList();
    renderDetail();
    checkBackupReminder();
  }

  function renderDetail(){
    if (!state.active) {
      els.detail.classList.add('hidden');
      return;
    }
    const p = state.active, meta = loadMeta(p), translation = paperTranslation(p);
    els.detail.classList.remove('hidden');
    els.detailTitle.textContent = shownTitle(p);
    const progress = meta.progress?.page ? `上次阅读到第 ${meta.progress.page} 页` : '暂无阅读进度';
    els.detailMeta.textContent = `${p.file.name} · ${translation ? '有译文' : '无译文'} · ${isRead(p) ? '已读' : '未读'} · 批注 ${noteCount(p)} · ${progress} · 最后阅读 ${fmtTime(meta.lastOpenedAt)}`;
    els.starBtn.textContent = meta.starred ? '★' : '☆';
    els.starBtn.classList.toggle('active', !!meta.starred);
    els.starBtn.disabled = els.renameBtn.disabled = els.replacePdf.disabled = els.bindTranslation.disabled = els.addTag.disabled = false;
    els.clearTranslation.disabled = !meta.manualTranslation;
    els.tagList.innerHTML = (meta.tags || []).map(t => `<span class="tag-chip">${esc(t)}<button data-tag="${esc(t)}">×</button></span>`).join('') || '<span class="paper-meta">暂无标签</span>';
    els.tagList.querySelectorAll('[data-tag]').forEach(btn => btn.onclick = () => removeTag(btn.dataset.tag));
    els.tagPreset.innerHTML = '<option value="">选择标签</option>' + DEFAULT_TAGS.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  }

  function addTag(){
    if (!state.active) return;
    const value = (els.tagInput.value.trim() || els.tagPreset.value).trim();
    if (!value) return;
    const meta = loadMeta(state.active);
    const tags = [...new Set([...(meta.tags || []), value])];
    updateMeta(state.active, { tags });
    els.tagInput.value = '';
    els.tagPreset.value = '';
    renderDetail(); renderList(); checkBackupReminder();
  }

  function removeTag(tag){
    if (!state.active) return;
    const meta = loadMeta(state.active);
    updateMeta(state.active, { tags: (meta.tags || []).filter(t => t !== tag) });
    renderDetail(); renderList(); checkBackupReminder();
  }

  function bestTranslationFor(source, translations){
    const sameStem = translations.filter(t => t.path !== source.path && t.stem === source.stem);
    if (sameStem.length) return sameStem.sort((a, b) => (a.ext === '.pdf' ? 0 : 1) - (b.ext === '.pdf' ? 0 : 1))[0];
    const sourceStem = compactStem(source.pdfTitle || source.docTitle || source.title || source.path);
    const candidates = translations
      .filter(t => t.path !== source.path)
      .map(t => {
        const compact = compactStem(t.pdfTitle || t.docTitle || t.path);
        const titleScore = titleMatchScore(source, t);
        const pathScore = compact === sourceStem || compact.includes(sourceStem) || sourceStem.includes(compact)
          ? 1
          : tokenScore(source.path, t.path);
        return { item: t, compact, score: Math.max(titleScore, pathScore) };
      })
      .filter(t => t.score >= .55 || (t.compact.length >= 8 && (t.compact.includes(sourceStem) || sourceStem.includes(t.compact))))
      .sort((a, b) => b.score - a.score || Math.abs(a.compact.length - sourceStem.length) - Math.abs(b.compact.length - sourceStem.length));
    return candidates[0]?.item || null;
  }

  function resolveManualTranslation(p){
    const manual = loadMeta(p).manualTranslation;
    if (!manual) return null;
    return state.docs?.find(d => d.path === manual.path || id(d.file) === manual.id) || null;
  }

  function paperTranslation(p){
    return resolveManualTranslation(p) || p.autoTranslation || p.translation || null;
  }

  function dedupeFiles(files){
    const seen = new Set();
    return files.filter(f => {
      const k = id(f);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  async function collapseDuplicatePapers(){
    const groups = new Map();
    for (const p of state.papers) {
      for (const k of paperIdentityKeys(p)) {
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
      }
    }
    const hidden = new Set();
    const replacedPaths = loadReplacedPaths();
    let changed = false;
    for (const group of groups.values()) {
      const unique = [...new Map(group.map(p => [p.id, p])).values()];
      if (unique.length < 2) continue;
      const best = [...unique].sort((a, b) => {
        const am = a.file.lastModified || 0, bm = b.file.lastModified || 0;
        if (am !== bm) return bm - am;
        return (isGeneratedPdfName(b.path) ? 1 : 0) - (isGeneratedPdfName(a.path) ? 1 : 0);
      })[0];
      for (const p of unique) {
        if (p === best) continue;
        hidden.add(p.id);
        if (!replacedPaths[p.path]) {
          replacedPaths[p.path] = best.path;
          changed = true;
        }
      }
    }
    if (changed) saveReplacedPaths(replacedPaths);
    if (hidden.size) state.papers = state.papers.filter(p => !hidden.has(p.id));
    if (changed) await cleanupHiddenReplacedFiles(state.files, replacedPaths, new Set(state.files.map(pathOf)));
  }

  async function renamePaperFileToTitle(p){
    if (!p || !displayTitle(p)) return false;
    const parent = p.file._parentHandle;
    const oldName = p.file._entryName || p.file.name;
    const targetName = safePdfNameFromTitle(p);
    const nextPath = p.path.replace(/[^/\\]+$/, targetName);
    if (!parent?.getFileHandle || !parent?.removeEntry || oldName === targetName) return false;
    try {
      if (await parent.queryPermission?.({ mode: 'readwrite' }) !== 'granted') return false;
      const target = await parent.getFileHandle(targetName, { create: true });
      const writable = await target.createWritable();
      await writable.write(p.file);
      await writable.close();
      const replacement = attachFileHandleInfo(await target.getFile(), nextPath, targetName, parent);
      moveStoredPaperData(p.id, id(replacement));
      await parent.removeEntry(oldName);
      rememberReplacedPath(p.path, nextPath);
      return true;
    } catch {
      return false;
    }
  }

  async function extractPdfTitle(file){
    if (!window.pdfjsLib || ext(file.name) !== '.pdf') return '';
    try {
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const meta = await pdf.getMetadata().catch(() => null);
      let pageTitle = '';
      try {
        const page = await pdf.getPage(1);
        const text = await page.getTextContent();
        const rows = new Map();
        text.items.forEach(item => {
          const y = Math.round(item.transform?.[5] || 0);
          if (!rows.has(y)) rows.set(y, []);
          rows.get(y).push(item.str || '');
        });
        const lines = [...rows.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([, parts]) => parts.join(' ').replace(/\s+/g, ' ').trim());
        pageTitle = titleFromPdfLines(lines);
      } catch {}
      await pdf.destroy?.();
      const metaTitle = cleanPdfTitle(meta?.info?.Title || meta?.metadata?.get?.('dc:title'));
      return (!metaTitle || looksDoiTitle(metaTitle)) ? (pageTitle || metaTitle) : metaTitle;
    } catch {
      return '';
    }
  }

  async function extractTextTitle(file){
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).slice(0, 40).map(line => line.replace(/^#+\s*/, '').replace(/<[^>]+>/g, '').trim()).filter(Boolean);
      const title = lines.find(line => /[a-zA-Z\u4e00-\u9fa5]/.test(line) && !/^(摘要|abstract|关键词|keywords)$/i.test(line));
      return cleanPdfTitle(title || '');
    } catch {
      return '';
    }
  }

  function refreshTranslationMatches(){
    const translations = (state.docs || []).filter(d => d.translationLike || d.ext !== '.pdf');
    state.papers.forEach(p => {
      p.autoTranslation = bestTranslationFor(p, translations);
      p.translation = p.autoTranslation;
    });
  }

  async function enrichPaperTitles(token){
    for (const d of [...state.docs]) {
      if (token !== state.scanToken) return;
      const title = d.ext === '.pdf' ? await extractPdfTitle(d.file) : await extractTextTitle(d.file);
      if (!title) continue;
      if (d.ext === '.pdf') d.pdfTitle = title;
      else d.docTitle = title;
      const p = state.papers.find(x => x.id === d.id || x.path === d.path);
      if (!p) continue;
      p.pdfTitle = title;
      if (isGeneratedPdfName(p.path)) {
        const meta = loadMeta(p);
        if (!meta.displayName) saveMeta(p, { ...meta, displayName: title, customDisplayName: false });
        if (await renamePaperFileToTitle(p) && state.directoryHandle) {
          scan(await filesFromDirectoryHandle(state.directoryHandle), '已按标题整理 PDF 文件名');
          return;
        }
      }
    }
    if (token !== state.scanToken) return;
    refreshTranslationMatches();
    await collapseDuplicatePapers();
    renderList();
    renderDetail();
    if (state.active) {
      const active = state.papers.find(p => p.id === state.active.id || p.path === state.active.path);
      if (active) {
        state.active = active;
        const translation = paperTranslation(active);
        els.tname.textContent = translation ? name(translation.path) : '未找到对应译文';
        renderDoc(translation, els.trans, '未找到对应译文文件。');
      }
    }
  }

  async function cleanupHiddenReplacedFiles(files, replacedPaths, presentPaths){
    for (const f of files) {
      const oldPath = pathOf(f);
      if (!replacedPaths[oldPath] || !presentPaths.has(replacedPaths[oldPath])) continue;
      const parent = f._parentHandle;
      const entryName = f._entryName || f.name;
      if (!parent?.removeEntry || !parent.queryPermission) continue;
      try {
        const permission = await parent.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') await parent.removeEntry(entryName);
      } catch {}
    }
  }

  function scan(files, message = '已读取本机文件夹'){
    const token = ++state.scanToken;
    const deduped = dedupeFiles(files);
    const presentPaths = new Set(deduped.map(pathOf));
    const replacedPaths = loadReplacedPaths();
    let changedReplacements = false;
    for (const [oldPath, newPath] of Object.entries(replacedPaths)) {
      if (!presentPaths.has(newPath)) {
        delete replacedPaths[oldPath];
        changedReplacements = true;
      }
    }
    if (changedReplacements) saveReplacedPaths(replacedPaths);
    cleanupHiddenReplacedFiles(deduped, replacedPaths, presentPaths).catch(() => {});
    state.files = deduped.filter(f => !replacedPaths[pathOf(f)] || !presentPaths.has(replacedPaths[pathOf(f)]));
    state.selected = new Set([...state.selected].filter(pid => state.files.some(f => id(f) === pid)));
    state.selectedFolders = new Set([...state.selectedFolders].filter(folder => state.files.some(f => folderOfPath(pathOf(f)) === folder)));
    currentFolders().forEach(saveFolderName);
    const docs = [];
    for (const f of state.files) {
      const path = pathOf(f);
      const e = ext(path);
      if (EXT.includes(e)) docs.push({ id: id(f), file: f, path, ext: e, stem: stem(path), translationLike: looksTranslation(path) });
    }
    state.docs = docs;
    const translations = docs.filter(d => d.translationLike || d.ext !== '.pdf');
    state.papers = docs
      .filter(d => d.ext === '.pdf' && !d.translationLike)
      .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'))
      .map(d => ({
        id: id(d.file), title: d.file.name.replace(/\.pdf$/i, ''), path: d.path, file: d.file,
        autoTranslation: bestTranslationFor(d, translations),
        translation: bestTranslationFor(d, translations)
      }));
    collapseDuplicatePapers().then(() => renderList()).catch(() => {});
    state.active = null;
    clear('已读取文件夹，请从左侧选择文献。');
    renderList();
    toast(message);
    els.refresh.disabled = false;
    enrichPaperTitles(token);
  }

  async function filesFromDirectoryHandle(handle){
    const files = [];
    async function walk(dir, prefix){
      for await (const [entryName, entry] of dir.entries()) {
        const rel = prefix ? `${prefix}/${entryName}` : entryName;
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          try { Object.defineProperty(file, 'webkitRelativePath', { value: rel, configurable: true }); }
          catch { file._relativePath = rel; }
          file._entryName = entryName;
          file._parentHandle = dir;
          files.push(file);
        } else if (entry.kind === 'directory') {
          await walk(entry, rel);
        }
      }
    }
    await walk(handle, '');
    return files;
  }

  async function chooseFolder(){
    if ('showDirectoryPicker' in window) {
      try {
        state.directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await saveDirectoryHandle(state.directoryHandle);
        scan(await filesFromDirectoryHandle(state.directoryHandle));
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    els.input.click();
  }

  async function addFolder(){
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        const files = await filesFromDirectoryHandle(handle);
        saveFolderName(handle.name);
        if (state.directoryHandle && await copyFilesToLibrary(files, handle.name)) {
          toast(`已添加文件夹 ${handle.name}`);
          return;
        }
        scan([...state.files, ...files], '已添加文件夹');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    state.pendingFolderMode = 'merge';
    els.input.value = '';
    els.input.click();
  }

  function cleanPathSegment(value){
    return String(value || 'files').replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').trim() || 'files';
  }

  async function writeFileToLibrary(file, relPath){
    let dir = state.directoryHandle;
    const parts = relPath.split(/[\\/]+/).map(cleanPathSegment).filter(Boolean);
    const fileName = parts.pop() || cleanPathSegment(file.name);
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    const target = await dir.getFileHandle(fileName, { create: true });
    const writable = await target.createWritable();
    await writable.write(file);
    await writable.close();
  }

  async function copyFilesToLibrary(files, folderName = ''){
    if (!state.directoryHandle || !await ensureFolderPermission(state.directoryHandle, true, 'readwrite')) return false;
    for (const file of files) {
      const rel = folderName ? `${folderName}/${pathOf(file)}` : file.name;
      await writeFileToLibrary(file, rel);
    }
    await refreshFolder();
    return true;
  }

  async function createFolder(){
    if (!state.directoryHandle) {
      toast('请先选择文献总文件夹');
      return;
    }
    const raw = prompt('新建文件夹名称');
    if (!raw) return;
    const folderName = cleanPathSegment(raw);
    if (!folderName) return;
    try {
      if (!await ensureFolderPermission(state.directoryHandle, true, 'readwrite')) {
        toast('没有获得文件夹写入权限');
        return;
      }
      await state.directoryHandle.getDirectoryHandle(folderName, { create: true });
      saveFolderName(folderName);
      setFolderOpen(folderName, true);
      await refreshFolder();
      els.targetFolder.value = folderName;
      toast(`已新建文件夹 ${folderName}`);
    } catch (err) {
      toast('无法新建文件夹');
    }
  }

  async function addFiles(files){
    if (!files.length) return;
    const folderName = els.targetFolder?.value || '';
    try {
      if (await copyFilesToLibrary(files, folderName)) {
        toast(`已添加 ${files.length} 个文件${folderName ? '到 ' + folderName : ''}`);
        return;
      }
    } catch (err) {
      toast('无法写入文件夹，已临时加入列表');
    }
    scan([...state.files, ...files], `已临时加入 ${files.length} 个文件`);
  }

  function selectedPapers(){
    return state.papers.filter(p => state.selected.has(p.id));
  }

  async function deleteSelected(){
    const selectedFolderSet = new Set([...state.selectedFolders]);
    const papers = state.papers.filter(p => state.selected.has(p.id) || selectedFolderSet.has(folderOfPaper(p)));
    if (!papers.length && !selectedFolderSet.size) return;
    const files = [];
    const seen = new Set();
    const collect = f => {
      const k = id(f);
      if (!seen.has(k)) { seen.add(k); files.push(f); }
    };
    papers.forEach(p => [p.file, p.translation?.file].filter(Boolean).forEach(collect));
    (state.docs || [])
      .filter(d => selectedFolderSet.has(folderOfPath(d.path)))
      .forEach(d => collect(d.file));
    const folderText = selectedFolderSet.size ? `、${selectedFolderSet.size} 个文件夹` : '';
    if (!confirm(`确定删除 ${papers.length} 篇文献${folderText}吗？匹配到的译文也会一起处理。`)) return;
    let removedFromDisk = 0;
    const removedFolders = new Set();
    if (state.directoryHandle && await ensureFolderPermission(state.directoryHandle, true, 'readwrite')) {
      for (const folder of selectedFolderSet) {
        if (folder === '根目录') continue;
        try {
          await state.directoryHandle.removeEntry(folder, { recursive: true });
          removedFolders.add(folder);
          removedFromDisk++;
        } catch {}
      }
    }
    for (const file of files) {
      if (removedFolders.has(folderOfPath(pathOf(file)))) continue;
      const parent = file._parentHandle;
      const entryName = file._entryName || file.name;
      if (!parent?.removeEntry) continue;
      try {
        if (await ensureFolderPermission(parent, true, 'readwrite')) {
          await parent.removeEntry(entryName);
          removedFromDisk++;
        }
      } catch {}
    }
    const removeIds = new Set(files.map(id));
    state.files = state.files.filter(f => !removeIds.has(id(f)) && !removedFolders.has(folderOfPath(pathOf(f))));
    state.selected.clear();
    state.selectedFolders.clear();
    if (state.active && papers.some(p => p.id === state.active.id)) {
      state.active = null;
      clear('已删除选中文献');
    }
    if (state.directoryHandle && removedFromDisk) await refreshFolder();
    else scan(state.files, removedFromDisk ? '已删除选中文献' : '已从当前列表移除');
  }

  async function refreshFolder(){
    if (!state.directoryHandle) state.directoryHandle = await loadDirectoryHandle();
    if (state.directoryHandle) {
      try {
        if (!await ensureFolderPermission(state.directoryHandle, true, 'readwrite')) {
          toast('没有获得文件夹读取权限');
          return;
        }
        scan(await filesFromDirectoryHandle(state.directoryHandle), '已刷新文献列表');
        toast('已刷新文献列表');
        return;
      } catch (err) {
        toast('需要重新授权文件夹');
      }
    }
    els.input.value = '';
    els.input.click();
  }

  function clear(msg){
    els.title.textContent = msg || '选择一篇文献开始阅读';
    els.meta.textContent = '文件只在你的浏览器里读取；状态保存在当前浏览器。';
    els.oname.textContent = 'PDF';
    els.tname.textContent = '自动匹配同名译文';
    els.orig.className = 'viewer empty'; els.orig.textContent = '请选择 PDF。';
    els.trans.className = 'viewer empty'; els.trans.textContent = '未选择文献。';
    els.read.disabled = els.save.disabled = els.add.disabled = true;
    state.notes = { items: [] };
    renderNotes();
    renderDetail();
  }

  function updateRead(){ els.read.textContent = state.active && isRead(state.active) ? '取消已读' : '标为已读'; }

  function estimatePage(box){
    const pages = [...box.querySelectorAll('.pdf-page-wrap')];
    if (!pages.length) return 0;
    const boxTop = box.getBoundingClientRect().top;
    let best = 1, bestDelta = Infinity;
    pages.forEach(page => {
      const delta = Math.abs(page.getBoundingClientRect().top - boxTop - 12);
      if (delta < bestDelta) { bestDelta = delta; best = Number(page.dataset.page) || 1; }
    });
    return best;
  }

  function saveProgress(){
    if (!state.active || !els.orig.classList.contains('viewer')) return;
    const max = Math.max(1, els.orig.scrollHeight - els.orig.clientHeight);
    const meta = loadMeta(state.active);
    const progress = {
      ...(meta.progress || {}),
      scrollTop: els.orig.scrollTop,
      ratio: els.orig.scrollTop / max,
      page: estimatePage(els.orig) || meta.progress?.page || 1,
      updatedAt: new Date().toISOString()
    };
    saveMeta(state.active, { ...meta, progress });
    renderDetail();
  }

  function queueProgressSave(){
    clearTimeout(state.progressTimer);
    state.progressTimer = setTimeout(saveProgress, 250);
  }

  function restoreProgress(){
    if (!state.active) return;
    const progress = loadMeta(state.active).progress;
    if (!progress) return;
    requestAnimationFrame(() => {
      const max = Math.max(0, els.orig.scrollHeight - els.orig.clientHeight);
      els.orig.scrollTop = Number.isFinite(progress.scrollTop) ? Math.min(progress.scrollTop, max) : Math.round(max * (progress.ratio || 0));
    });
  }

  function renderNativePdf(file, box){
    box.className = 'viewer native-pdf-viewer';
    box.innerHTML = '';
    const url = URL.createObjectURL(file);
    const frame = document.createElement('iframe');
    frame.className = 'native-pdf-frame';
    frame.src = url + '#view=FitH';
    frame.onload = () => setTimeout(() => URL.revokeObjectURL(url), 30000);
    box.appendChild(frame);
    const meta = loadMeta(state.active);
    saveMeta(state.active, {
      ...meta,
      progress: { ...(meta.progress || {}), page: meta.progress?.page || 1, nativeViewer: true, updatedAt: new Date().toISOString() }
    });
  }

  async function renderPdf(file, box){
    const token = ++state.pdfToken;
    box.className = 'viewer'; box.innerHTML = '<div class="paper-meta loading">正在渲染 PDF...</div>';
    if (!window.pdfjsLib) { box.textContent = 'PDF.js 未加载。'; return; }
    try {
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      if (box === els.orig && state.active) {
        const meta = loadMeta(state.active);
        saveMeta(state.active, { ...meta, progress: { ...(meta.progress || {}), totalPages: pdf.numPages } });
      }
      if (token !== state.pdfToken) return;
      box.innerHTML = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        if (token !== state.pdfToken) return;
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: Math.min(1.75, Math.max(1.15, (box.clientWidth - 44) / page.getViewport({ scale: 1 }).width)) });
        const outputScale = Math.min(2.4, Math.max(1, window.devicePixelRatio || 1));
        const wrap = document.createElement('div'); wrap.className = 'pdf-page-wrap'; wrap.dataset.page = i;
        const c = document.createElement('canvas'); c.className = 'pdf-page';
        c.width = Math.floor(vp.width * outputScale);
        c.height = Math.floor(vp.height * outputScale);
        c.style.width = Math.floor(vp.width) + 'px';
        c.style.height = Math.floor(vp.height) + 'px';
        wrap.style.width = Math.floor(vp.width) + 'px';
        wrap.style.height = Math.floor(vp.height) + 'px';
        wrap.appendChild(c); box.appendChild(wrap);
        await page.render({
          canvasContext: c.getContext('2d'),
          viewport: vp,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null
        }).promise;
      }
      if (box === els.orig) restoreProgress();
    } catch (err) {
      box.className = 'viewer empty'; box.textContent = '无法显示这个 PDF：' + err.message;
    }
  }

  async function renderDoc(doc, box, empty, options = {}){
    if (!doc) { box.className = 'viewer empty'; box.textContent = empty; return; }
    const f = doc.file || doc, e = ext(f.name);
    if (e === '.pdf' && options.nativePdf) return renderNativePdf(f, box);
    if (e === '.pdf') return renderPdf(f, box);
    if (e === '.html' || e === '.htm') {
      box.className = 'viewer'; box.innerHTML = '';
      const fr = document.createElement('iframe');
      fr.className = 'html-frame';
      fr.srcdoc = htmlWithAssets(await f.text(), doc.path || pathOf(f));
      box.appendChild(fr);
      return;
    }
    const text = await f.text();
    box.className = 'viewer'; box.innerHTML = '<div class="text-doc">' + (e === '.md' ? md(text, doc.path || pathOf(f)) : esc(text)) + '</div>';
  }

  async function openPaper(p){
    state.active = p; state.notes = loadNotes(p);
    updateMeta(p, { lastOpenedAt: new Date().toISOString() });
    const translation = paperTranslation(p);
    els.title.textContent = shownTitle(p); els.meta.textContent = p.path + ' · ' + size(p.file.size);
    els.oname.textContent = p.file.name; els.tname.textContent = translation ? name(translation.path) : '未找到对应译文';
    els.read.disabled = els.save.disabled = els.add.disabled = false;
    updateRead(); renderList(); renderNotes(); renderDetail();
    await Promise.all([renderDoc(p.file, els.orig, '无法显示原文。', { nativePdf: true }), renderDoc(translation, els.trans, '未找到对应译文文件。')]);
    checkBackupReminder();
  }

  function setLibraryHidden(hidden, persist = true){
    state.libraryHidden = hidden;
    document.body.classList.toggle('library-hidden', hidden);
    els.showLibrary.classList.toggle('hidden', !hidden);
    if (persist) localStorage.setItem(profileKey('libraryHidden'), hidden ? '1' : '0');
  }

  function setControlsHidden(hidden, persist = true){
    state.controlsHidden = hidden;
    document.body.classList.toggle('controls-hidden', hidden);
    els.toggleControls.textContent = hidden ? '展开' : '筛选';
    els.toggleControls.title = hidden ? '展开筛选区' : '收起筛选区';
    if (persist) localStorage.setItem(profileKey('controlsHidden'), hidden ? '1' : '0');
  }

  function setNotesHidden(hidden, persist = true){
    state.notesHidden = hidden;
    document.body.classList.toggle('notes-hidden', hidden);
    els.showNotes.classList.toggle('hidden', !hidden);
    if (persist) localStorage.setItem(profileKey('notesHidden'), hidden ? '1' : '0');
  }

  function setViewMode(mode, persist = true){
    state.viewMode = mode || 'split';
    document.body.classList.remove('mode-split','mode-original','mode-translation','mode-stacked');
    document.body.classList.add('mode-' + state.viewMode);
    if (els.viewMode) els.viewMode.value = state.viewMode;
    if (persist) localStorage.setItem(profileKey('viewMode'), state.viewMode);
  }

  function setCompactTop(compact, persist = true){
    state.compactTop = compact;
    document.body.classList.toggle('compact-top', compact);
    els.compactTop.textContent = compact ? '展开顶部' : '精简顶部';
    if (persist) localStorage.setItem(profileKey('compactTop'), compact ? '1' : '0');
  }

  function renderNotes(){
    els.notes.innerHTML = '';
    const items = state.notes.items || [];
    if (!items.length) { els.notes.innerHTML = '<div class="paper-meta empty-list">暂无批注。</div>'; return; }
    items.forEach((n, i) => {
      const d = document.createElement('div'); d.className = 'note-card';
      d.innerHTML = `<div class="note-location">${esc(n.location || '未标注位置')}</div><div class="note-body">${esc(n.body)}</div><div class="paper-meta">${esc(n.updatedAt || n.createdAt || '')}</div><div class="note-actions"><button data-a="e">编辑</button><button class="danger" data-a="d">删除</button></div>`;
      d.querySelector('[data-a=e]').onclick = () => { els.loc.value = n.location || ''; els.txt.value = n.body || ''; state.editing = i; els.txt.focus(); };
      d.querySelector('[data-a=d]').onclick = () => { state.notes.items.splice(i, 1); saveNotes(); renderNotes(); };
      els.notes.appendChild(d);
    });
  }

  function addNote(){
    if (!state.active) return;
    const body = els.txt.value.trim(); if (!body) return;
    const n = { location: els.loc.value.trim(), body, updatedAt: new Date().toLocaleString() };
    state.notes.items = state.notes.items || [];
    if (Number.isInteger(state.editing)) { const old = state.notes.items[state.editing] || {}; state.notes.items[state.editing] = { ...old, ...n, createdAt: old.createdAt || n.updatedAt }; state.editing = null; }
    else state.notes.items.unshift({ ...n, createdAt: n.updatedAt });
    els.loc.value = ''; els.txt.value = ''; saveNotes(); renderNotes();
    renderDetail(); renderList(); checkBackupReminder();
  }

  function showAllNotes(){
    const rows = [];
    state.papers.forEach(p => (loadNotes(p).items || []).forEach((n, i) => rows.push({ p, n, i })));
    els.allNotesList.innerHTML = rows.length ? rows.map(({p,n,i}) => `<button class="all-note-row" data-paper="${esc(p.id)}" data-index="${i}"><strong>${esc(shownTitle(p))}</strong><span>${esc(n.location || '未标注位置')} · ${esc(n.updatedAt || n.createdAt || '')}</span><p>${esc(n.body)}</p></button>`).join('') : '<div class="paper-meta empty-list">暂无批注。</div>';
    els.allNotesList.querySelectorAll('[data-paper]').forEach(btn => btn.onclick = async () => {
      const p = state.papers.find(x => x.id === btn.dataset.paper);
      if (!p) return;
      const note = (loadNotes(p).items || [])[Number(btn.dataset.index)];
      els.allNotesDialog.close();
      await openPaper(p);
      if (note) { els.loc.value = note.location || ''; els.txt.value = note.body || ''; state.editing = Number(btn.dataset.index); setNotesHidden(false); els.txt.focus(); }
    });
    els.allNotesDialog.showModal();
  }

  async function renameActive(){
    if (!state.active) return;
    const next = prompt('显示名', displayTitle(state.active));
    if (next === null) return;
    updateMeta(state.active, { displayName: next.trim(), customDisplayName: true });
    els.title.textContent = shownTitle(state.active);
    renderDetail(); renderList(); checkBackupReminder();
    if (await renamePaperFileToTitle(state.active) && state.directoryHandle) {
      scan(await filesFromDirectoryHandle(state.directoryHandle), '已按自定义名称重命名 PDF');
    }
  }

  function safePdfNameFromTitle(p){
    const base = (displayTitle(p) || p.title || name(p.path))
      .replace(/\.pdf$/i, '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase()
      .slice(0, 150);
    return (base || name(p.path).replace(/\.pdf$/i, '') || 'paper') + '.pdf';
  }

  function moveStoredPaperData(oldId, newId){
    if (!oldId || !newId || oldId === newId) return;
    ['read','notes','meta'].forEach(kind => {
      const oldKey = key(kind, oldId);
      const value = localStorage.getItem(oldKey);
      if (value && !localStorage.getItem(key(kind, newId))) localStorage.setItem(key(kind, newId), value);
    });
  }

  function attachFileHandleInfo(file, path, entryName, parentHandle){
    try { Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true }); }
    catch { file._relativePath = path; }
    file._entryName = entryName;
    file._parentHandle = parentHandle;
    return file;
  }

  function rememberReplacedPath(oldPath, newPath){
    if (!oldPath || !newPath || oldPath === newPath) return;
    const replacedPaths = loadReplacedPaths();
    replacedPaths[oldPath] = newPath;
    saveReplacedPaths(replacedPaths);
  }

  function openTranslationDialog(){
    if (!state.active) return;
    const choices = (state.docs || []).filter(d => d.path !== state.active.path && EXT.includes(d.ext));
    els.translationSelect.innerHTML = choices.length ? choices.map(d => `<option value="${esc(d.id)}">${esc(d.path)}</option>`).join('') : '<option value="">没有可选译文文件</option>';
    els.translationDialog.showModal();
  }

  async function bindTranslation(){
    if (!state.active || !els.translationSelect.value) return;
    const doc = (state.docs || []).find(d => d.id === els.translationSelect.value);
    if (!doc) return;
    updateMeta(state.active, { manualTranslation: { id: doc.id, path: doc.path } });
    els.translationDialog.close();
    toast('已绑定译文');
    await openPaper(state.active);
  }

  async function addTranslationFile(file){
    if (!state.active || !file) return;
    const activePath = state.active.path;
    try {
      if (state.directoryHandle && await ensureFolderPermission(state.directoryHandle, true, 'readwrite')) {
        await writeFileToLibrary(file, file.name);
        await refreshFolder();
      } else {
        scan([...state.files, file], '已临时加入译文文件');
      }
      const doc = (state.docs || []).find(d => d.file.name === file.name || pathOf(d.file) === pathOf(file));
      const paper = state.papers.find(p => p.path === activePath) || state.active;
      if (doc && paper) {
        state.active = paper;
        updateMeta(paper, { manualTranslation: { id: doc.id, path: doc.path } });
        els.translationDialog.close();
        toast('已添加并绑定译文');
        await openPaper(paper);
      } else {
        toast('译文已加入，请重新绑定一次');
      }
    } catch (err) {
      toast('添加译文失败：请确认文件夹写入权限');
    }
  }

  async function clearTranslationBinding(){
    if (!state.active) return;
    updateMeta(state.active, { manualTranslation: null });
    toast('已取消手动绑定');
    await openPaper(state.active);
  }

  async function replaceActivePdf(file){
    if (!state.active || !file) return;
    if (ext(file.name) !== '.pdf') { toast('请选择 PDF 文件'); return; }
    const oldId = state.active.id;
    const activePath = state.active.path;
    const activeName = state.active.file._entryName || state.active.file.name;
    const preservedMeta = loadMeta(state.active);
    const preservedTitle = displayTitle(state.active);
    const targetName = safePdfNameFromTitle(state.active);
    const nextPath = activePath.replace(/[^/\\]+$/, targetName);
    const parent = state.active.file._parentHandle;
    const sourceTemp = state.files.find(f =>
      f !== state.active.file &&
      pathOf(f) !== activePath &&
      (f._entryName || f.name) !== targetName &&
      f.name === file.name &&
      f.size === file.size &&
      f.lastModified === file.lastModified &&
      f._parentHandle?.removeEntry
    );
    if (!parent?.getFileHandle) {
      toast('当前文件没有文件夹写入权限，请用“选择文件夹”重新授权后再替换');
      return;
    }
    try {
      if (!await ensureFolderPermission(parent, true, 'readwrite')) {
        toast('没有获得写入权限');
        return;
      }
      const target = await parent.getFileHandle(targetName, { create: true });
      const writable = await target.createWritable();
      await writable.write(file);
      await writable.close();
      if (targetName !== activeName && parent.removeEntry) {
        try { await parent.removeEntry(activeName); }
        catch { toast('已替换；旧 PDF 因浏览器权限限制会在列表中隐藏'); }
      }
      if (sourceTemp) {
        try {
          if (await ensureFolderPermission(sourceTemp._parentHandle, true, 'readwrite')) {
            await sourceTemp._parentHandle.removeEntry(sourceTemp._entryName || sourceTemp.name);
            rememberReplacedPath(pathOf(sourceTemp), nextPath);
          }
        } catch {}
      }
      toast(targetName === activeName ? '已替换原文 PDF' : '已替换并按标题重命名');
      rememberReplacedPath(activePath, nextPath);
      if (state.directoryHandle) {
        const files = await filesFromDirectoryHandle(state.directoryHandle);
        scan(files, '已刷新并载入替换后的 PDF');
        const next = state.papers.find(p => p.path === nextPath) || state.papers.find(p => p.file.name === targetName) || state.papers.find(p => p.path === activePath);
        if (next) { moveStoredPaperData(oldId, next.id); updateMeta(next, { ...loadMeta(next), displayName: preservedTitle, customDisplayName: !!preservedMeta.customDisplayName }); await openPaper(next); }
      } else {
        const replacement = await target.getFile();
        attachFileHandleInfo(replacement, nextPath, targetName, parent);
        state.files = state.files.map(f => pathOf(f) === activePath ? replacement : f);
        scan(state.files, '已载入替换后的 PDF');
        const next = state.papers.find(p => p.path === nextPath);
        if (next) { moveStoredPaperData(oldId, next.id); updateMeta(next, { ...loadMeta(next), displayName: preservedTitle, customDisplayName: !!preservedMeta.customDisplayName }); await openPaper(next); }
      }
    } catch (err) {
      toast('替换失败：请确认文件夹写入权限');
    }
  }

  function exportData(){
    const payload = { app: 'paper-reader', exportedAt: new Date().toISOString(), items: {} };
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(BASE_PREFIX)) payload.items[k] = localStorage.getItem(k);
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'paper-reader-data.json'; a.click(); URL.revokeObjectURL(a.href);
    localStorage.setItem(profileKey('lastExportAt'), new Date().toISOString());
    checkBackupReminder();
  }

  async function importData(file){
    const payload = JSON.parse(await file.text());
    if (payload.app !== 'paper-reader' || !payload.items) throw new Error('不是 Paper Reader 导出的数据');
    Object.entries(payload.items).forEach(([k, v]) => { if (k.startsWith(BASE_PREFIX)) localStorage.setItem(k, v); });
    toast('数据已导入');
    if (state.active) { state.notes = loadNotes(state.active); renderNotes(); }
    renderList(); updateRead();
    renderDetail(); checkBackupReminder();
  }

  function hasUserData(){
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (k.startsWith(storagePrefix()) && /\.(notes|meta|read)\./.test(k)) return true;
    }
    return false;
  }

  function checkBackupReminder(){
    if (!els.backupBanner) return;
    const later = localStorage.getItem(profileKey('backupLaterAt'));
    if (later && Date.now() - Date.parse(later) < 24 * 60 * 60 * 1000) { els.backupBanner.classList.add('hidden'); return; }
    const last = localStorage.getItem(profileKey('lastExportAt'));
    const stale = !last || Date.now() - Date.parse(last) > 7 * 24 * 60 * 60 * 1000;
    els.backupBanner.classList.toggle('hidden', !(hasUserData() && stale));
  }

  els.pick.onclick = chooseFolder;
  els.refresh.onclick = refreshFolder;
  els.compactTop.onclick = () => setCompactTop(!state.compactTop);
  els.hideLibrary.onclick = () => setLibraryHidden(true);
  els.showLibrary.onclick = () => setLibraryHidden(false);
  els.toggleControls.onclick = () => setControlsHidden(!state.controlsHidden);
  els.hideNotes.onclick = () => setNotesHidden(true);
  els.showNotes.onclick = () => setNotesHidden(false);
  els.addFolder.onclick = addFolder;
  els.createFolder.onclick = createFolder;
  els.addFiles.onclick = () => els.addFilesInput.click();
  els.addFilesInput.onchange = e => { const files = Array.from(e.target.files || []); addFiles(files); e.target.value = ''; };
  els.selectAll.onclick = () => {
    const rows = state.papers.filter(pass);
    const allSelected = rows.length && rows.every(p => state.selected.has(p.id));
    const folders = new Set(rows.map(folderOfPaper));
    rows.forEach(p => allSelected ? state.selected.delete(p.id) : state.selected.add(p.id));
    folders.forEach(folder => allSelected ? state.selectedFolders.delete(folder) : state.selectedFolders.add(folder));
    renderList();
  };
  els.deleteSelected.onclick = deleteSelected;
  els.input.onchange = e => {
    const files = Array.from(e.target.files || []);
    if (state.pendingFolderMode === 'merge') scan([...state.files, ...files], '已添加文件夹');
    else scan(files);
    state.pendingFolderMode = null;
  };
  els.search.oninput = renderList;
  els.tagFilter.onchange = e => { state.tagFilter = e.target.value; renderList(); };
  els.filters.onclick = e => { const b = e.target.closest('[data-filter]'); if (!b) return; state.filter = b.dataset.filter; els.filters.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); renderList(); };
  els.read.onclick = () => { if (!state.active) return; setRead(state.active, !isRead(state.active)); updateRead(); renderList(); renderDetail(); checkBackupReminder(); };
  els.save.onclick = saveNotes; els.add.onclick = addNote;
  els.allNotesBtn.onclick = showAllNotes;
  els.viewMode.onchange = e => setViewMode(e.target.value);
  els.starBtn.onclick = () => { if (state.active) toggleStar(state.active); };
  els.renameBtn.onclick = renameActive;
  els.replacePdf.onclick = () => els.replacePdfInput.click();
  els.replacePdfInput.onchange = e => { const file = e.target.files?.[0]; if (file) replaceActivePdf(file); e.target.value = ''; };
  els.addTag.onclick = addTag;
  els.tagPreset.onchange = () => { if (els.tagPreset.value) els.tagInput.value = els.tagPreset.value; };
  els.bindTranslation.onclick = openTranslationDialog;
  els.clearTranslation.onclick = clearTranslationBinding;
  els.translationCancel.onclick = () => els.translationDialog.close();
  els.translationForm.addEventListener('submit', e => { e.preventDefault(); bindTranslation(); });
  els.translationAddFile.onclick = () => els.translationFileInput.click();
  els.translationFileInput.onchange = e => { const file = e.target.files?.[0]; if (file) addTranslationFile(file); e.target.value = ''; };
  els.backupExport.onclick = exportData;
  els.backupLater.onclick = () => { localStorage.setItem(profileKey('backupLaterAt'), new Date().toISOString()); checkBackupReminder(); };
  els.orig.addEventListener('scroll', queueProgressSave);
  els.exportBtn.onclick = exportData; els.importBtn.onclick = () => els.importInput.click();
  els.importInput.onchange = e => { const f = e.target.files?.[0]; if (f) importData(f).catch(err => alert(err.message)); e.target.value = ''; };
  els.loginBtn.onclick = () => { els.authError.textContent = ''; els.authName.value = state.user?.name || ''; els.authPassword.value = ''; els.authDialog.showModal(); };
  els.logoutBtn.onclick = logout;
  els.authCancel.onclick = () => els.authDialog.close();
  els.authForm.addEventListener('submit', e => {
    e.preventDefault();
    els.authError.textContent = '';
    login(els.authName.value, els.authPassword.value)
      .then(() => els.authDialog.close())
      .catch(err => { els.authError.textContent = err.message || '登录失败'; });
  });
  document.querySelectorAll('[data-splitter]').forEach(splitter => {
    splitter.addEventListener('pointerdown', e => {
      e.preventDefault();
      const kind = splitter.dataset.splitter;
      const startX = e.clientX;
      let frame = 0, lastEvent = e;
      const styles = getComputedStyle(document.documentElement);
      const start = {
        library: parseFloat(styles.getPropertyValue('--library-width')) || 320,
        original: parseFloat(styles.getPropertyValue('--original-width')) || 1,
        translation: parseFloat(styles.getPropertyValue('--translation-width')) || .9,
        notes: parseFloat(styles.getPropertyValue('--notes-width')) || 300,
      };
      document.body.classList.add('resizing');
      splitter.setPointerCapture?.(e.pointerId);
      const applyMove = ev => {
        const dx = ev.clientX - startX;
        if (kind === 'library') {
          applyCss('--library-width', Math.max(220, Math.min(560, start.library + dx)) + 'px');
        } else if (kind === 'original') {
          const total = start.original + start.translation;
          const grid = splitter.closest('.viewer-grid');
          const width = Math.max(320, grid?.clientWidth || window.innerWidth);
          const delta = dx / width;
          const nextOriginal = Math.max(.45, Math.min(total - .45, start.original + delta * 3));
          applyCss('--original-width', nextOriginal + 'fr');
          applyCss('--translation-width', (total - nextOriginal) + 'fr');
        } else if (kind === 'translation') {
          applyCss('--notes-width', Math.max(220, Math.min(560, start.notes - dx)) + 'px');
        }
      };
      const move = ev => {
        lastEvent = ev;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          applyMove(lastEvent);
        });
      };
      const up = () => {
        if (frame) cancelAnimationFrame(frame);
        applyMove(lastEvent);
        ['--library-width','--original-width','--translation-width','--notes-width'].forEach(persistCss);
        document.body.classList.remove('resizing');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  });
  async function init(){
    state.user = get(appKey('session'), null);
    applyUser();
    loadLayout();
    clear('选择一个本机文件夹开始');
    updateTagFilterOptions();
    renderList();
    checkBackupReminder();
    await restoreSavedFolder();
  }
  init();
})();

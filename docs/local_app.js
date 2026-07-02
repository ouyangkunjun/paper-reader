(function(){
  const BASE_PREFIX = 'paperReader.local.';
  const HANDLE_DB = 'paperReaderHandles';
  const HANDLE_STORE = 'handles';
  const DEFAULT_TAGS = ['待读','精读','综述','催化','DFT','机器学习','待翻译'];
  const MARK = /(^|[_\-\s])(zh|cn|chinese|translation|translated|中文|译文|翻译|中译)($|[_\-\s])/i;
  const EXT = ['.pdf', '.md', '.txt', '.html', '.htm'];
  const state = {
    papers: [],
    files: [],
    directoryHandle: null,
    active: null,
    notes: { items: [] },
    filter: 'all',
    pdfToken: 0,
    drawMode: false,
    drawTool: 'pen',
    drawColor: '#e74c3c',
    drawSize: 4,
    drawing: null,
    libraryHidden: false,
    notesHidden: false,
    compactTop: false,
    user: null,
    selected: new Set(),
    tagFilter: '',
    viewMode: 'split',
    progressTimer: null,
  };
  const $ = (s) => document.querySelector(s);
  const els = {
    pick: $('#pickFolderBtn'), refresh: $('#refreshFolderBtn'), hideLibrary: $('#hideLibraryBtn'), showLibrary: $('#showLibraryBtn'),
    compactTop: $('#compactTopBtn'),
    hideNotes: $('#hideNotesBtn'), showNotes: $('#showNotesBtn'),
    input: $('#folderInput'), addFilesInput: $('#addFilesInput'), replacePdfInput: $('#replacePdfInput'), count: $('#paperCount'), search: $('#searchInput'),
    stats: $('#libraryStats'), tagFilter: $('#tagFilter'),
    addFolder: $('#addFolderBtn'), addFiles: $('#addFilesBtn'), selectAll: $('#selectAllBtn'), deleteSelected: $('#deleteSelectedBtn'),
    filters: $('#filterBar'), list: $('#paperList'), title: $('#activeTitle'), meta: $('#activeMeta'),
    oname: $('#originalName'), tname: $('#translationName'), orig: $('#originalViewer'), trans: $('#translationViewer'),
    read: $('#toggleReadBtn'), save: $('#saveNotesBtn'), add: $('#addNoteBtn'), loc: $('#noteLocation'), txt: $('#noteText'),
    allNotesBtn: $('#allNotesBtn'), allNotesDialog: $('#allNotesDialog'), allNotesList: $('#allNotesList'), viewMode: $('#viewModeSelect'),
    detail: $('#detailPanel'), detailTitle: $('#detailTitle'), detailMeta: $('#detailMeta'), tagList: $('#tagList'), tagPreset: $('#tagPreset'),
    tagInput: $('#tagInput'), addTag: $('#addTagBtn'), starBtn: $('#starBtn'), renameBtn: $('#renameBtn'), replacePdf: $('#replacePdfBtn'),
    bindTranslation: $('#bindTranslationBtn'), clearTranslation: $('#clearTranslationBtn'), translationDialog: $('#translationDialog'),
    translationForm: $('#translationForm'), translationSelect: $('#translationSelect'), translationCancel: $('#translationCancelBtn'),
    replaceDialog: $('#replaceDialog'), replaceCancel: $('#replaceCancelBtn'), replaceKeepName: $('#replaceKeepNameBtn'), replaceTitleName: $('#replaceTitleNameBtn'),
    backupBanner: $('#backupBanner'), backupExport: $('#backupExportBtn'), backupLater: $('#backupLaterBtn'),
    notes: $('#notesList'), drawBtn: $('#drawBtn'), drawToolbar: $('#drawToolbar'), drawColor: $('#drawColor'),
    drawSize: $('#drawSize'), clearDraw: $('#clearDrawBtn'), exportBtn: $('#exportBtn'), importBtn: $('#importBtn'),
    importInput: $('#importInput'), aiBtn: $('#aiBtn'), aiDialog: $('#aiDialog'), toast: $('#toast'),
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
  function loadDraw(p){ return get(key('draw', p.id), { pages: {} }); }
  function saveDraw(p, data){ set(key('draw', p.id), data); }
  function toast(msg){ els.toast.textContent = msg; els.toast.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => els.toast.classList.add('hidden'), 1800); }
  function displayTitle(p){ return loadMeta(p).displayName || p.title; }
  function fmtTime(v){ return v ? new Date(v).toLocaleString() : '无'; }
  function isStarred(p){ return !!loadMeta(p).starred; }
  function paperTags(p){ return loadMeta(p).tags || []; }
  function noteCount(p){ return (loadNotes(p).items || []).length; }
  function setCss(name, value){ document.documentElement.style.setProperty(name, value); localStorage.setItem(profileKey('layout.' + name), value); }
  function loadLayout(){
    ['--library-width','--original-width','--translation-width','--notes-width'].forEach(name => {
      const value = localStorage.getItem(profileKey('layout.' + name));
      if (value) document.documentElement.style.setProperty(name, value);
    });
    setLibraryHidden(localStorage.getItem(profileKey('libraryHidden')) === '1', false);
    setNotesHidden(localStorage.getItem(profileKey('notesHidden')) !== '0', false);
    setViewMode(localStorage.getItem(profileKey('viewMode')) || 'split', false);
    setCompactTop(localStorage.getItem(profileKey('compactTop')) === '1', false);
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

  function md(text){
    return esc(text).split(/\n\s*\n/).map(block => {
      const x = block.trim();
      if (!x) return '';
      if (/^#{1,4}\s/.test(x)) return '<h3>' + x.replace(/^#{1,4}\s/, '') + '</h3>';
      if (/^[-*]\s/m.test(x)) return '<ul>' + x.split(/\n/).filter(Boolean).map(line => '<li>' + line.replace(/^[-*]\s*/, '') + '</li>').join('') + '</ul>';
      return '<p>' + x.replace(/\n/g, '<br>') + '</p>';
    }).join('');
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

  function renderList(){
    els.list.innerHTML = '';
    updateStats();
    updateTagFilterOptions();
    const rows = state.papers.filter(pass);
    els.count.textContent = state.papers.length ? `${rows.length} / ${state.papers.length} 篇` : '请选择文件夹';
    updateLibraryTools(rows);
    if (!rows.length) {
      els.list.innerHTML = '<div class="paper-meta empty-list">点击“选择文件夹”读取本机 PDF。</div>';
      return;
    }
    rows.forEach(p => {
      const row = document.createElement('div');
      const tags = paperTags(p);
      row.className = 'paper-row' + (state.active && state.active.id === p.id ? ' active' : '') + (isRead(p) ? ' read' : '') + (isStarred(p) ? ' starred' : '');
      row.innerHTML = `<label class="paper-check"><input type="checkbox" ${state.selected.has(p.id) ? 'checked' : ''} aria-label="选择文献" /></label><button class="paper-open" title="${esc(displayTitle(p))}"><div class="paper-card-head"><div class="paper-title">${esc(displayTitle(p))}</div><span class="paper-star">${isStarred(p) ? '★' : '☆'}</span></div><div class="paper-meta">${isRead(p) ? '已读' : '未读'} · ${paperTranslation(p) ? '有译文' : '无译文'} · ${size(p.file.size)}${tags.length ? ' · ' + esc(tags.slice(0,2).join('/')) : ''}</div></button>`;
      row.querySelector('input').onchange = e => { e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id); updateLibraryTools(rows); };
      row.querySelector('.paper-open').onclick = () => openPaper(p);
      row.querySelector('.paper-star').onclick = e => { e.stopPropagation(); toggleStar(p); };
      els.list.appendChild(row);
    });
  }

  function updateLibraryTools(rows = state.papers.filter(pass)){
    const hasLibrary = !!state.files.length || !!state.directoryHandle;
    const visibleIds = new Set(rows.map(p => p.id));
    const selectedVisible = [...state.selected].filter(id => visibleIds.has(id)).length;
    els.addFolder.disabled = false;
    els.addFiles.disabled = false;
    els.selectAll.disabled = !rows.length;
    els.deleteSelected.disabled = !selectedVisible;
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
    els.detailTitle.textContent = displayTitle(p);
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
    const sourceStem = compactStem(source.path);
    const candidates = translations
      .filter(t => t.path !== source.path)
      .map(t => {
        const compact = compactStem(t.path);
        const score = compact === sourceStem || compact.includes(sourceStem) || sourceStem.includes(compact)
          ? 1
          : tokenScore(source.path, t.path);
        return { item: t, compact, score };
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

  function scan(files, message = '已读取本机文件夹'){
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
    state.files = deduped.filter(f => !replacedPaths[pathOf(f)] || !presentPaths.has(replacedPaths[pathOf(f)]));
    state.selected = new Set([...state.selected].filter(pid => state.files.some(f => id(f) === pid)));
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
    state.active = null;
    clear('已读取文件夹，请从左侧选择文献。');
    renderList();
    toast(message);
    els.refresh.disabled = false;
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

  async function copyFilesToLibrary(files){
    if (!state.directoryHandle || !await ensureFolderPermission(state.directoryHandle, true, 'readwrite')) return false;
    for (const file of files) {
      const target = await state.directoryHandle.getFileHandle(file.name, { create: true });
      const writable = await target.createWritable();
      await writable.write(file);
      await writable.close();
    }
    await refreshFolder();
    return true;
  }

  async function addFiles(files){
    if (!files.length) return;
    try {
      if (await copyFilesToLibrary(files)) {
        toast(`已添加 ${files.length} 个文件`);
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
    const papers = selectedPapers();
    if (!papers.length) return;
    const files = [];
    const seen = new Set();
    papers.forEach(p => [p.file, p.translation?.file].filter(Boolean).forEach(f => {
      const k = id(f);
      if (!seen.has(k)) { seen.add(k); files.push(f); }
    }));
    if (!confirm(`确定删除 ${papers.length} 篇文献吗？匹配到的译文也会一起处理。`)) return;
    let removedFromDisk = 0;
    for (const file of files) {
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
    state.files = state.files.filter(f => !removeIds.has(id(f)));
    state.selected.clear();
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
        if (!await ensureFolderPermission(state.directoryHandle, true)) {
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
    els.read.disabled = els.save.disabled = els.add.disabled = els.drawBtn.disabled = true;
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

  function addDrawCanvas(wrap, pageNum){
    const canvas = document.createElement('canvas');
    canvas.className = 'draw-layer';
    canvas.dataset.page = pageNum;
    wrap.appendChild(canvas);
    resizeDrawCanvas(canvas);
    restoreDrawCanvas(canvas);
    wireDrawCanvas(canvas);
  }

  function resizeDrawCanvas(canvas){
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function restoreDrawCanvas(canvas){
    if (!state.active) return;
    const data = loadDraw(state.active);
    const image = data.pages?.[canvas.dataset.page];
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!image) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.clientWidth, canvas.clientHeight);
    img.src = image;
  }

  function persistCanvas(canvas){
    if (!state.active) return;
    const data = loadDraw(state.active);
    data.pages = data.pages || {};
    data.pages[canvas.dataset.page] = canvas.toDataURL('image/png');
    data.updatedAt = new Date().toISOString();
    saveDraw(state.active, data);
  }

  function point(e, canvas){
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }

  function wireDrawCanvas(canvas){
    const start = (e) => {
      if (!state.drawMode) return;
      e.preventDefault();
      const p = point(e, canvas);
      const ctx = canvas.getContext('2d');
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = state.drawTool === 'highlight' ? 0.35 : 1;
      ctx.strokeStyle = state.drawTool === 'highlight' ? '#ffe066' : state.drawColor;
      ctx.lineWidth = state.drawTool === 'highlight' ? state.drawSize * 2.4 : state.drawSize;
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
      state.drawing = { canvas, ctx };
    };
    const move = (e) => {
      if (!state.drawing || state.drawing.canvas !== canvas) return;
      e.preventDefault();
      const p = point(e, canvas);
      state.drawing.ctx.lineTo(p.x, p.y);
      state.drawing.ctx.stroke();
    };
    const end = () => {
      if (!state.drawing || state.drawing.canvas !== canvas) return;
      state.drawing.ctx.globalAlpha = 1;
      persistCanvas(canvas);
      state.drawing = null;
    };
    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end); canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false }); canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
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
        addDrawCanvas(wrap, i);
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
    if (e === '.html' || e === '.htm') { box.className = 'viewer'; box.innerHTML = ''; const fr = document.createElement('iframe'); fr.className = 'html-frame'; fr.src = URL.createObjectURL(f); box.appendChild(fr); return; }
    const text = await f.text();
    box.className = 'viewer'; box.innerHTML = '<div class="text-doc">' + (e === '.md' ? md(text) : esc(text)) + '</div>';
  }

  async function openPaper(p){
    state.active = p; state.notes = loadNotes(p);
    updateMeta(p, { lastOpenedAt: new Date().toISOString() });
    const translation = paperTranslation(p);
    els.title.textContent = displayTitle(p); els.meta.textContent = p.path + ' · ' + size(p.file.size);
    els.oname.textContent = p.file.name; els.tname.textContent = translation ? name(translation.path) : '未找到对应译文';
    els.read.disabled = els.save.disabled = els.add.disabled = els.drawBtn.disabled = false;
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

  function setNotesHidden(hidden, persist = true){
    state.notesHidden = hidden;
    document.body.classList.toggle('notes-hidden', hidden);
    els.showNotes.classList.toggle('hidden', !hidden);
    if (persist) localStorage.setItem(profileKey('notesHidden'), hidden ? '1' : '0');
    requestAnimationFrame(() => document.querySelectorAll('.draw-layer').forEach(c => { resizeDrawCanvas(c); restoreDrawCanvas(c); }));
  }

  function setViewMode(mode, persist = true){
    state.viewMode = mode || 'split';
    document.body.classList.remove('mode-split','mode-original','mode-translation','mode-stacked');
    document.body.classList.add('mode-' + state.viewMode);
    if (els.viewMode) els.viewMode.value = state.viewMode;
    if (persist) localStorage.setItem(profileKey('viewMode'), state.viewMode);
    requestAnimationFrame(() => document.querySelectorAll('.draw-layer').forEach(c => { resizeDrawCanvas(c); restoreDrawCanvas(c); }));
  }

  function setCompactTop(compact, persist = true){
    state.compactTop = compact;
    document.body.classList.toggle('compact-top', compact);
    els.compactTop.textContent = compact ? '展开顶部' : '精简顶部';
    if (persist) localStorage.setItem(profileKey('compactTop'), compact ? '1' : '0');
    requestAnimationFrame(() => document.querySelectorAll('.draw-layer').forEach(c => { resizeDrawCanvas(c); restoreDrawCanvas(c); }));
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
    els.allNotesList.innerHTML = rows.length ? rows.map(({p,n,i}) => `<button class="all-note-row" data-paper="${esc(p.id)}" data-index="${i}"><strong>${esc(displayTitle(p))}</strong><span>${esc(n.location || '未标注位置')} · ${esc(n.updatedAt || n.createdAt || '')}</span><p>${esc(n.body)}</p></button>`).join('') : '<div class="paper-meta empty-list">暂无批注。</div>';
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

  function renameActive(){
    if (!state.active) return;
    const next = prompt('显示名', displayTitle(state.active));
    if (next === null) return;
    updateMeta(state.active, { displayName: next.trim() });
    els.title.textContent = displayTitle(state.active);
    renderDetail(); renderList(); checkBackupReminder();
  }

  function safePdfNameFromTitle(p){
    const base = (displayTitle(p) || p.title || name(p.path))
      .replace(/\.pdf$/i, '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150);
    return (base || name(p.path).replace(/\.pdf$/i, '') || 'paper') + '.pdf';
  }

  function moveStoredPaperData(oldId, newId){
    if (!oldId || !newId || oldId === newId) return;
    ['read','notes','draw','meta'].forEach(kind => {
      const oldKey = key(kind, oldId);
      const value = localStorage.getItem(oldKey);
      if (value && !localStorage.getItem(key(kind, newId))) localStorage.setItem(key(kind, newId), value);
    });
  }

  function rememberReplacedPath(oldPath, newPath){
    if (!oldPath || !newPath || oldPath === newPath) return;
    const replacedPaths = loadReplacedPaths();
    replacedPaths[oldPath] = newPath;
    saveReplacedPaths(replacedPaths);
  }

  function openReplaceDialog(){
    if (!state.active) return;
    els.replaceDialog.showModal();
  }

  function chooseReplaceMode(mode){
    state.replacePdfNameMode = mode;
    els.replaceDialog.close();
    els.replacePdfInput.click();
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
    const targetName = state.replacePdfNameMode === 'title' ? safePdfNameFromTitle(state.active) : activeName;
    const parent = state.active.file._parentHandle;
    if (!parent?.getFileHandle) {
      toast('当前文件没有文件夹写入权限，请用“选择文件夹”重新授权后再替换');
      return;
    }
    try {
      if (!await ensureFolderPermission(parent, true, 'readwrite')) {
        toast('没有获得写入权限');
        return;
      }
      const target = await parent.getFileHandle(targetName, { create: state.replacePdfNameMode === 'title' });
      const writable = await target.createWritable();
      await writable.write(file);
      await writable.close();
      if (targetName !== activeName && parent.removeEntry) {
        try { await parent.removeEntry(activeName); } catch {}
      }
      toast(targetName === activeName ? '已替换原文 PDF' : '已替换并按标题重命名');
      const nextPath = activePath.replace(/[^/\\]+$/, targetName);
      rememberReplacedPath(activePath, nextPath);
      if (state.directoryHandle) {
        const files = await filesFromDirectoryHandle(state.directoryHandle);
        scan(files, '已刷新并载入替换后的 PDF');
        const next = state.papers.find(p => p.path === nextPath) || state.papers.find(p => p.file.name === targetName) || state.papers.find(p => p.path === activePath);
        if (next) { moveStoredPaperData(oldId, next.id); await openPaper(next); }
      } else {
        const replacement = await target.getFile();
        try { Object.defineProperty(replacement, 'webkitRelativePath', { value: nextPath, configurable: true }); }
        catch { replacement._relativePath = nextPath; }
        replacement._entryName = targetName;
        replacement._parentHandle = parent;
        state.files = state.files.map(f => pathOf(f) === activePath ? replacement : f);
        scan(state.files, '已载入替换后的 PDF');
        const next = state.papers.find(p => p.path === nextPath);
        if (next) { moveStoredPaperData(oldId, next.id); await openPaper(next); }
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
    if (state.active) { state.notes = loadNotes(state.active); renderNotes(); document.querySelectorAll('.draw-layer').forEach(restoreDrawCanvas); }
    renderList(); updateRead();
    renderDetail(); checkBackupReminder();
  }

  function hasUserData(){
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (k.startsWith(storagePrefix()) && /\.(notes|draw|meta|read)\./.test(k)) return true;
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
  els.hideNotes.onclick = () => setNotesHidden(true);
  els.showNotes.onclick = () => setNotesHidden(false);
  els.addFolder.onclick = addFolder;
  els.addFiles.onclick = () => els.addFilesInput.click();
  els.addFilesInput.onchange = e => { const files = Array.from(e.target.files || []); addFiles(files); e.target.value = ''; };
  els.selectAll.onclick = () => {
    const rows = state.papers.filter(pass);
    const allSelected = rows.length && rows.every(p => state.selected.has(p.id));
    rows.forEach(p => allSelected ? state.selected.delete(p.id) : state.selected.add(p.id));
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
  els.replacePdf.onclick = openReplaceDialog;
  els.replaceCancel.onclick = () => els.replaceDialog.close();
  els.replaceKeepName.onclick = () => chooseReplaceMode('original');
  els.replaceTitleName.onclick = () => chooseReplaceMode('title');
  els.replacePdfInput.onchange = e => { const file = e.target.files?.[0]; if (file) replaceActivePdf(file); e.target.value = ''; };
  els.addTag.onclick = addTag;
  els.tagPreset.onchange = () => { if (els.tagPreset.value) els.tagInput.value = els.tagPreset.value; };
  els.bindTranslation.onclick = openTranslationDialog;
  els.clearTranslation.onclick = clearTranslationBinding;
  els.translationCancel.onclick = () => els.translationDialog.close();
  els.translationForm.addEventListener('submit', e => { e.preventDefault(); bindTranslation(); });
  els.backupExport.onclick = exportData;
  els.backupLater.onclick = () => { localStorage.setItem(profileKey('backupLaterAt'), new Date().toISOString()); checkBackupReminder(); };
  els.drawBtn.onclick = () => {
    if (els.orig.classList.contains('native-pdf-viewer')) toast('原文使用浏览器 PDF 查看器，画笔标注不可覆盖；可使用文字批注。');
    state.drawMode = !state.drawMode; els.drawBtn.classList.toggle('active', state.drawMode); els.drawToolbar.classList.toggle('hidden', !state.drawMode);
  };
  els.drawToolbar.addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (!b) return; state.drawTool = b.dataset.tool; els.drawToolbar.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x === b)); });
  els.drawColor.oninput = e => state.drawColor = e.target.value;
  els.drawSize.oninput = e => state.drawSize = +e.target.value;
  els.clearDraw.onclick = () => { if (!state.active || !confirm('清除当前文献的所有画笔标注？')) return; localStorage.removeItem(key('draw', state.active.id)); document.querySelectorAll('.draw-layer').forEach(c => c.getContext('2d').clearRect(0, 0, c.width, c.height)); toast('画笔标注已清除'); };
  els.orig.addEventListener('scroll', queueProgressSave);
  els.exportBtn.onclick = exportData; els.importBtn.onclick = () => els.importInput.click();
  els.importInput.onchange = e => { const f = e.target.files?.[0]; if (f) importData(f).catch(err => alert(err.message)); e.target.value = ''; };
  els.aiBtn.onclick = () => els.aiDialog.showModal();
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
      const styles = getComputedStyle(document.documentElement);
      const start = {
        library: parseFloat(styles.getPropertyValue('--library-width')) || 320,
        original: parseFloat(styles.getPropertyValue('--original-width')) || 1,
        translation: parseFloat(styles.getPropertyValue('--translation-width')) || .9,
        notes: parseFloat(styles.getPropertyValue('--notes-width')) || 300,
      };
      const move = ev => {
        const dx = ev.clientX - startX;
        if (kind === 'library') {
          setCss('--library-width', Math.max(220, Math.min(560, start.library + dx)) + 'px');
        } else if (kind === 'original') {
          const total = start.original + start.translation;
          const delta = dx / Math.max(320, window.innerWidth);
          const nextOriginal = Math.max(.45, Math.min(total - .45, start.original + delta * 3));
          setCss('--original-width', nextOriginal + 'fr');
          setCss('--translation-width', (total - nextOriginal) + 'fr');
          document.querySelectorAll('.draw-layer').forEach(c => { resizeDrawCanvas(c); restoreDrawCanvas(c); });
        } else if (kind === 'translation') {
          setCss('--notes-width', Math.max(220, Math.min(560, start.notes - dx)) + 'px');
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  });
  window.addEventListener('resize', () => document.querySelectorAll('.draw-layer').forEach(c => { resizeDrawCanvas(c); restoreDrawCanvas(c); }));
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

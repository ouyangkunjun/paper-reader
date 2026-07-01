(function(){
  const BASE_PREFIX = 'paperReader.local.';
  const HANDLE_DB = 'paperReaderHandles';
  const HANDLE_STORE = 'handles';
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
    user: null,
    selected: new Set(),
  };
  const $ = (s) => document.querySelector(s);
  const els = {
    pick: $('#pickFolderBtn'), refresh: $('#refreshFolderBtn'), hideLibrary: $('#hideLibraryBtn'), showLibrary: $('#showLibraryBtn'),
    hideNotes: $('#hideNotesBtn'), showNotes: $('#showNotesBtn'),
    input: $('#folderInput'), addFilesInput: $('#addFilesInput'), count: $('#paperCount'), search: $('#searchInput'),
    addFolder: $('#addFolderBtn'), addFiles: $('#addFilesBtn'), selectAll: $('#selectAllBtn'), deleteSelected: $('#deleteSelectedBtn'),
    filters: $('#filterBar'), list: $('#paperList'), title: $('#activeTitle'), meta: $('#activeMeta'),
    oname: $('#originalName'), tname: $('#translationName'), orig: $('#originalViewer'), trans: $('#translationViewer'),
    read: $('#toggleReadBtn'), save: $('#saveNotesBtn'), add: $('#addNoteBtn'), loc: $('#noteLocation'), txt: $('#noteText'),
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
  function loadNotes(p){ return get(key('notes', p.id), { items: [] }); }
  function loadDraw(p){ return get(key('draw', p.id), { pages: {} }); }
  function saveDraw(p, data){ set(key('draw', p.id), data); }
  function toast(msg){ els.toast.textContent = msg; els.toast.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => els.toast.classList.add('hidden'), 1800); }
  function setCss(name, value){ document.documentElement.style.setProperty(name, value); localStorage.setItem(profileKey('layout.' + name), value); }
  function loadLayout(){
    ['--library-width','--original-width','--translation-width','--notes-width'].forEach(name => {
      const value = localStorage.getItem(profileKey('layout.' + name));
      if (value) document.documentElement.style.setProperty(name, value);
    });
    setLibraryHidden(localStorage.getItem(profileKey('libraryHidden')) === '1', false);
    setNotesHidden(localStorage.getItem(profileKey('notesHidden')) === '1', false);
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
    if (!name || !password) throw new Error('请输入用户名和密码');
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
    if (q && !(p.title + ' ' + p.path).toLowerCase().includes(q)) return false;
    if (state.filter === 'read') return isRead(p);
    if (state.filter === 'unread') return !isRead(p);
    if (state.filter === 'translated') return !!p.translation;
    if (state.filter === 'missing') return !p.translation;
    return true;
  }

  function renderList(){
    els.list.innerHTML = '';
    const rows = state.papers.filter(pass);
    els.count.textContent = state.papers.length ? `${rows.length} / ${state.papers.length} 篇` : '请选择文件夹';
    updateLibraryTools(rows);
    if (!rows.length) {
      els.list.innerHTML = '<div class="paper-meta empty-list">点击“选择文件夹”读取本机 PDF。</div>';
      return;
    }
    rows.forEach(p => {
      const row = document.createElement('div');
      row.className = 'paper-row' + (state.active && state.active.id === p.id ? ' active' : '');
      row.innerHTML = `<label class="paper-check"><input type="checkbox" ${state.selected.has(p.id) ? 'checked' : ''} aria-label="选择文献" /></label><button class="paper-open"><div class="paper-title">${esc(p.title)}</div><div class="paper-meta">${isRead(p) ? '已读' : '未读'} · ${p.translation ? '有译文' : '无译文'} · ${size(p.file.size)}</div></button>`;
      row.querySelector('input').onchange = e => { e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id); updateLibraryTools(rows); };
      row.querySelector('.paper-open').onclick = () => openPaper(p);
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
    state.files = dedupeFiles(files);
    state.selected = new Set([...state.selected].filter(pid => state.files.some(f => id(f) === pid)));
    const docs = [];
    for (const f of state.files) {
      const path = pathOf(f);
      const e = ext(path);
      if (EXT.includes(e)) docs.push({ file: f, path, ext: e, stem: stem(path), translationLike: looksTranslation(path) });
    }
    const translations = docs.filter(d => d.translationLike || d.ext !== '.pdf');
    state.papers = docs
      .filter(d => d.ext === '.pdf' && !d.translationLike)
      .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'))
      .map(d => ({
        id: id(d.file), title: d.file.name.replace(/\.pdf$/i, ''), path: d.path, file: d.file,
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
  }

  function updateRead(){ els.read.textContent = state.active && isRead(state.active) ? '取消已读' : '标为已读'; }

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
      if (token !== state.pdfToken) return;
      box.innerHTML = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        if (token !== state.pdfToken) return;
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: Math.min(1.55, Math.max(1.05, (box.clientWidth - 44) / page.getViewport({ scale: 1 }).width)) });
        const wrap = document.createElement('div'); wrap.className = 'pdf-page-wrap'; wrap.dataset.page = i;
        const c = document.createElement('canvas'); c.className = 'pdf-page'; c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        wrap.style.width = c.width + 'px'; wrap.style.height = c.height + 'px';
        wrap.appendChild(c); box.appendChild(wrap);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        addDrawCanvas(wrap, i);
      }
    } catch (err) {
      box.className = 'viewer empty'; box.textContent = '无法显示这个 PDF：' + err.message;
    }
  }

  async function renderDoc(doc, box, empty){
    if (!doc) { box.className = 'viewer empty'; box.textContent = empty; return; }
    const f = doc.file || doc, e = ext(f.name);
    if (e === '.pdf') return renderPdf(f, box);
    if (e === '.html' || e === '.htm') { box.className = 'viewer'; box.innerHTML = ''; const fr = document.createElement('iframe'); fr.className = 'html-frame'; fr.src = URL.createObjectURL(f); box.appendChild(fr); return; }
    const text = await f.text();
    box.className = 'viewer'; box.innerHTML = '<div class="text-doc">' + (e === '.md' ? md(text) : esc(text)) + '</div>';
  }

  async function openPaper(p){
    state.active = p; state.notes = loadNotes(p);
    els.title.textContent = p.title; els.meta.textContent = p.path + ' · ' + size(p.file.size);
    els.oname.textContent = p.file.name; els.tname.textContent = p.translation ? name(p.translation.path) : '未找到对应译文';
    els.read.disabled = els.save.disabled = els.add.disabled = els.drawBtn.disabled = false;
    updateRead(); renderList(); renderNotes();
    await Promise.all([renderDoc(p.file, els.orig, '无法显示原文。'), renderDoc(p.translation, els.trans, '未找到对应译文文件。')]);
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
  }

  function exportData(){
    const payload = { app: 'paper-reader', exportedAt: new Date().toISOString(), items: {} };
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(BASE_PREFIX)) payload.items[k] = localStorage.getItem(k);
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'paper-reader-data.json'; a.click(); URL.revokeObjectURL(a.href);
  }

  async function importData(file){
    const payload = JSON.parse(await file.text());
    if (payload.app !== 'paper-reader' || !payload.items) throw new Error('不是 Paper Reader 导出的数据');
    Object.entries(payload.items).forEach(([k, v]) => { if (k.startsWith(BASE_PREFIX)) localStorage.setItem(k, v); });
    toast('数据已导入');
    if (state.active) { state.notes = loadNotes(state.active); renderNotes(); document.querySelectorAll('.draw-layer').forEach(restoreDrawCanvas); }
    renderList(); updateRead();
  }

  els.pick.onclick = chooseFolder;
  els.refresh.onclick = refreshFolder;
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
  els.filters.onclick = e => { const b = e.target.closest('[data-filter]'); if (!b) return; state.filter = b.dataset.filter; els.filters.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); renderList(); };
  els.read.onclick = () => { if (!state.active) return; setRead(state.active, !isRead(state.active)); updateRead(); renderList(); };
  els.save.onclick = saveNotes; els.add.onclick = addNote;
  els.drawBtn.onclick = () => { state.drawMode = !state.drawMode; els.drawBtn.classList.toggle('active', state.drawMode); els.drawToolbar.classList.toggle('hidden', !state.drawMode); };
  els.drawToolbar.addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (!b) return; state.drawTool = b.dataset.tool; els.drawToolbar.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x === b)); });
  els.drawColor.oninput = e => state.drawColor = e.target.value;
  els.drawSize.oninput = e => state.drawSize = +e.target.value;
  els.clearDraw.onclick = () => { if (!state.active || !confirm('清除当前文献的所有画笔标注？')) return; localStorage.removeItem(key('draw', state.active.id)); document.querySelectorAll('.draw-layer').forEach(c => c.getContext('2d').clearRect(0, 0, c.width, c.height)); toast('画笔标注已清除'); };
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
    renderList();
    await restoreSavedFolder();
  }
  init();
})();

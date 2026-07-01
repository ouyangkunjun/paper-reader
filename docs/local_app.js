(function(){
  const PREFIX = 'paperReader.local.';
  const MARK = /(^|[_\-\s])(zh|cn|chinese|translation|translated|中文|译文|翻译|中译)($|[_\-\s])/i;
  const EXT = ['.pdf', '.md', '.txt', '.html', '.htm'];
  const state = {
    papers: [],
    active: null,
    notes: { items: [] },
    filter: 'all',
    pdfToken: 0,
    drawMode: false,
    drawTool: 'pen',
    drawColor: '#e74c3c',
    drawSize: 4,
    drawing: null,
  };
  const $ = (s) => document.querySelector(s);
  const els = {
    pick: $('#pickFolderBtn'), input: $('#folderInput'), count: $('#paperCount'), search: $('#searchInput'),
    filters: $('#filterBar'), list: $('#paperList'), title: $('#activeTitle'), meta: $('#activeMeta'),
    oname: $('#originalName'), tname: $('#translationName'), orig: $('#originalViewer'), trans: $('#translationViewer'),
    read: $('#toggleReadBtn'), save: $('#saveNotesBtn'), add: $('#addNoteBtn'), loc: $('#noteLocation'), txt: $('#noteText'),
    notes: $('#notesList'), drawBtn: $('#drawBtn'), drawToolbar: $('#drawToolbar'), drawColor: $('#drawColor'),
    drawSize: $('#drawSize'), clearDraw: $('#clearDrawBtn'), exportBtn: $('#exportBtn'), importBtn: $('#importBtn'),
    importInput: $('#importInput'), aiBtn: $('#aiBtn'), aiDialog: $('#aiDialog'), toast: $('#toast')
  };

  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';

  function ext(n){ const i = n.lastIndexOf('.'); return i >= 0 ? n.slice(i).toLowerCase() : ''; }
  function name(p){ return (p.split(/[\\/]/).pop() || p); }
  function stem(p){ let n = name(p), e = ext(n); if (e) n = n.slice(0, -e.length); return n.replace(MARK, ' ').replace(/[_\-\s]+/g, ' ').trim().toLowerCase(); }
  function id(f){ return [(f.webkitRelativePath || f.name), f.size, f.lastModified].join('|'); }
  function key(kind, paperId){ return PREFIX + kind + '.' + btoa(unescape(encodeURIComponent(paperId))).replace(/=+$/, ''); }
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
    if (!rows.length) {
      els.list.innerHTML = '<div class="paper-meta empty-list">点击“选择文件夹”读取本机 PDF。</div>';
      return;
    }
    rows.forEach(p => {
      const b = document.createElement('button');
      b.className = 'paper-row' + (state.active && state.active.id === p.id ? ' active' : '');
      b.innerHTML = `<div class="paper-title">${esc(p.title)}</div><div class="paper-meta">${isRead(p) ? '已读' : '未读'} · ${p.translation ? '有译文' : '无译文'} · ${size(p.file.size)}</div>`;
      b.onclick = () => openPaper(p);
      els.list.appendChild(b);
    });
  }

  function scan(files){
    const docs = [];
    for (const f of files) {
      const path = f.webkitRelativePath || f.name;
      const e = ext(path);
      if (EXT.includes(e)) docs.push({ file: f, path, ext: e, stem: stem(path), translationLike: MARK.test(path) && e !== '.pdf' });
    }
    const translations = docs.filter(d => d.ext !== '.pdf' || d.translationLike);
    state.papers = docs
      .filter(d => d.ext === '.pdf' && !d.translationLike)
      .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'))
      .map(d => ({
        id: id(d.file), title: d.file.name.replace(/\.pdf$/i, ''), path: d.path, file: d.file,
        translation: translations.find(t => t.path !== d.path && t.stem === d.stem) || null
      }));
    state.active = null;
    clear('已读取文件夹，请从左侧选择文献。');
    renderList();
    toast('已读取本机文件夹');
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
      if (k && k.startsWith(PREFIX)) payload.items[k] = localStorage.getItem(k);
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'paper-reader-data.json'; a.click(); URL.revokeObjectURL(a.href);
  }

  async function importData(file){
    const payload = JSON.parse(await file.text());
    if (payload.app !== 'paper-reader' || !payload.items) throw new Error('不是 Paper Reader 导出的数据');
    Object.entries(payload.items).forEach(([k, v]) => { if (k.startsWith(PREFIX)) localStorage.setItem(k, v); });
    toast('数据已导入');
    if (state.active) { state.notes = loadNotes(state.active); renderNotes(); document.querySelectorAll('.draw-layer').forEach(restoreDrawCanvas); }
    renderList(); updateRead();
  }

  els.pick.onclick = () => els.input.click();
  els.input.onchange = e => scan(Array.from(e.target.files || []));
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
  window.addEventListener('resize', () => document.querySelectorAll('.draw-layer').forEach(c => { resizeDrawCanvas(c); restoreDrawCanvas(c); }));
  renderList();
})();

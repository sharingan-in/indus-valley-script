/* Indus Valley Script — local static browser.
   All data is embedded via data/signs.js and data/texts.js so this works from
   file:// with no server. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- data prep
  var COLS = window.TEXTS.columns;
  var ROWS = window.TEXTS.rows;
  var COL = {}; COLS.forEach(function (name, i) { COL[name] = i; });

  var pad3 = function (c) { return ('000' + String(c)).slice(-3); };
  var signSrc = function (code) { return 'signs/' + pad3(code) + '.svg'; };

  // Which sign codes actually have an SVG glyph.
  var HAS_GLYPH = Object.create(null);
  window.SIGNS.forEach(function (id) { HAS_GLYPH[pad3(id)] = true; });

  // ICIT reference data: canonical glyph images + total/per-site frequencies.
  var ICIT = (window.ICIT && window.ICIT.signs) || {};
  var HAS_ICIT = Object.create(null);
  Object.keys(ICIT).forEach(function (c) { HAS_ICIT[c] = true; });
  var icitSrc = function (code, small) {
    return 'icit/' + (small ? 'small' : 'full') + '/S' + pad3(code) + '.jpg';
  };

  // Parse a text_code string into lines of tokens.
  //   '/'      -> new line
  //   '+'      -> complete edge
  //   '[' ']'  -> broken/damaged edge
  //   digits   -> a sign code (separated by '-')
  function parseTextCode(tc) {
    var lines = [[]], buf = '';
    function flush() { if (buf) { lines[lines.length - 1].push({ t: 's', code: pad3(buf) }); buf = ''; } }
    var s = String(tc == null ? '' : tc);
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch >= '0' && ch <= '9') { buf += ch; continue; }
      flush();
      if (ch === '/') lines.push([]);
      else if (ch === '+') lines[lines.length - 1].push({ t: 'e', kind: 'complete' });
      else if (ch === '[' || ch === ']') lines[lines.length - 1].push({ t: 'e', kind: 'broken' });
    }
    flush();
    return lines.filter(function (l) { return l.length; });
  }

  // ---------------------------------------------------------------- sign strings
  // A string attached to each sign ID. Base values come from data/sign_strings.js;
  // edits made in the app are kept in this browser (localStorage) on top of them.
  var STR_KEY = 'ivs.signStrings';
  var CODE_MODE_KEY = 'ivs.codeMode';
  var FILE_STRINGS = Object.create(null);
  Object.keys(window.SIGN_STRINGS || {}).forEach(function (k) {
    FILE_STRINGS[pad3(k)] = String(window.SIGN_STRINGS[k]);
  });
  var LOCAL_STRINGS = (function () {
    try {
      var o = JSON.parse(localStorage.getItem(STR_KEY) || '{}'), out = Object.create(null);
      Object.keys(o).forEach(function (k) { out[pad3(k)] = String(o[k]); });
      return out;
    } catch (e) { return Object.create(null); }
  })();
  function saveLocalStrings() {
    try { localStorage.setItem(STR_KEY, JSON.stringify(LOCAL_STRINGS)); } catch (e) {}
  }
  function signString(code) {
    code = pad3(code);
    return code in LOCAL_STRINGS ? LOCAL_STRINGS[code] : (FILE_STRINGS[code] || '');
  }
  function setSignString(code, val) {
    code = pad3(code);
    val = String(val).trim();
    if (val === (FILE_STRINGS[code] || '')) delete LOCAL_STRINGS[code];
    else LOCAL_STRINGS[code] = val;
    saveLocalStrings();
  }
  function allSignStrings() {
    var out = {};
    Object.keys(FILE_STRINGS).forEach(function (k) { if (FILE_STRINGS[k]) out[k] = FILE_STRINGS[k]; });
    Object.keys(LOCAL_STRINGS).forEach(function (k) {
      if (LOCAL_STRINGS[k]) out[k] = LOCAL_STRINGS[k]; else delete out[k];
    });
    return out;
  }
  // '+740-390-590+' -> '+ma-ra-ta+' : each sign ID is replaced by its string
  // (or kept as the ID when it has none); separators, edges and '/' stay.
  function codeAsStrings(tc) {
    return String(tc == null ? '' : tc).replace(/\d+/g, function (d) { return signString(d) || d; });
  }
  function signStringsSource(map) {
    var keys = Object.keys(map).sort();
    var body = keys.map(function (k) { return '  ' + JSON.stringify(k) + ': ' + JSON.stringify(map[k]); }).join(',\n');
    return '/* String attached to each sign ID.\n' +
      '   Keys are 3-digit sign IDs (as used in text codes); values are free text.\n' +
      '   Signs without an entry fall back to their numeric ID.\n' +
      '   You can also edit strings in the app (click a sign → "String"): with the\n' +
      '   file linked there, edits are written straight into this file. */\n' +
      'window.SIGN_STRINGS = {\n' + body + (body ? '\n' : '') + '};\n';
  }
  function exportSignStrings() {
    var src = signStringsSource(allSignStrings());
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    a.download = 'sign_strings.js';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // Linking data/sign_strings.js (File System Access API, Chrome/Edge): once the
  // user picks the file, every edit is written into it. The file handle is kept
  // in IndexedDB so the link survives reloads (Chrome re-asks permission once
  // per session, on the first edit).
  var FILE_LINK = {
    supported: typeof window.showOpenFilePicker === 'function',
    handle: null, status: '', queue: Promise.resolve(), listeners: []
  };
  function linkStatus(msg) {
    FILE_LINK.status = msg;
    FILE_LINK.listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  function idbStore(mode, fn) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('ivs-files', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var tx = req.result.transaction('kv', mode), r = fn(tx.objectStore('kv'));
        tx.oncomplete = function () { resolve(r && r.result); };
        tx.onerror = function () { reject(tx.error); };
      };
    });
  }
  function rememberHandle(h) {
    return idbStore('readwrite', function (s) { return h ? s.put(h, 'signStrings') : s.delete('signStrings'); })
      .catch(function () {});
  }
  if (FILE_LINK.supported) {
    idbStore('readonly', function (s) { return s.get('signStrings'); })
      .then(function (h) { if (h) { FILE_LINK.handle = h; linkStatus('linked to ' + h.name); } })
      .catch(function () {});
  }
  function parseStringsFile(text) {
    var w = {};
    new Function('window', text)(w); // the user's own data file
    var out = Object.create(null), m = w.SIGN_STRINGS || {};
    Object.keys(m).forEach(function (k) { if (String(m[k]).trim()) out[pad3(k)] = String(m[k]); });
    return out;
  }
  // Read the file (to keep hand edits), apply this browser's edits, write it back.
  function writeLinkedFile() {
    var h = FILE_LINK.handle;
    if (!h) return Promise.resolve(false);
    FILE_LINK.queue = FILE_LINK.queue.then(function () {
      return h.queryPermission({ mode: 'readwrite' }).then(function (p) {
        return p === 'granted' ? p : h.requestPermission({ mode: 'readwrite' });
      }).then(function (p) {
        if (p !== 'granted') throw new Error('permission to write the file was not granted');
        return h.getFile();
      }).then(function (f) { return f.text(); }).then(function (text) {
        var cur = parseStringsFile(text);
        Object.keys(LOCAL_STRINGS).forEach(function (k) {
          if (LOCAL_STRINGS[k]) cur[k] = LOCAL_STRINGS[k]; else delete cur[k];
        });
        return h.createWritable().then(function (w) {
          return w.write(signStringsSource(cur)).then(function () { return w.close(); });
        }).then(function () {
          Object.keys(FILE_STRINGS).forEach(function (k) { delete FILE_STRINGS[k]; });
          Object.keys(cur).forEach(function (k) { FILE_STRINGS[k] = cur[k]; });
          Object.keys(LOCAL_STRINGS).forEach(function (k) { delete LOCAL_STRINGS[k]; });
          saveLocalStrings();
          linkStatus('saved to ' + h.name + ' ✓');
          return true;
        });
      }).catch(function (err) {
        linkStatus('could not write ' + h.name + ': ' + (err && err.message || err) + ' — kept in this browser');
        return false;
      });
    });
    return FILE_LINK.queue;
  }
  function linkFile() {
    return window.showOpenFilePicker({
      types: [{ description: 'sign_strings.js', accept: { 'text/javascript': ['.js'] } }]
    }).then(function (hs) {
      var h = hs[0];
      if (h.name !== 'sign_strings.js' &&
          !window.confirm('That file is "' + h.name + '", not sign_strings.js. Link it anyway?')) return;
      FILE_LINK.handle = h;
      rememberHandle(h);
      linkStatus('linked to ' + h.name);
      return writeLinkedFile();
    }).catch(function (err) { if (!err || err.name !== 'AbortError') linkStatus('could not link file: ' + err); });
  }
  function unlinkFile() {
    FILE_LINK.handle = null;
    rememberHandle(null);
    linkStatus('');
  }

  // Precomputed per-row index for fast search / filtering.
  var norm = function (v) { return String(v == null ? '' : v).trim(); };
  var INDEX = ROWS.map(function (r) {
    var codes = Object.create(null);
    parseTextCode(r[COL.text_code]).forEach(function (line) {
      line.forEach(function (tok) { if (tok.t === 's') codes[tok.code] = true; });
    });
    var hay = [
      r[COL.id], r[COL.site], r[COL.text_code], r[COL.museum], r[COL.reference],
      r[COL.notes], r[COL.period], r[COL.area], r[COL.material]
    ].join(' \u0001 ').toLowerCase();
    return {
      site: norm(r[COL.site]),
      dir: norm(r[COL.direction]).toUpperCase(),
      codes: codes,
      hay: hay
    };
  });

  // Sign usage frequency across all texts.
  var FREQ = Object.create(null);
  INDEX.forEach(function (ix) { for (var c in ix.codes) FREQ[c] = (FREQ[c] || 0) + 1; });

  // ---------------------------------------------------------------- rendering
  function renderTextInto(el, tc, large) {
    var lines = parseTextCode(tc);
    if (!lines.length) { el.innerHTML = '<span class="mono">—</span>'; return; }
    var frag = document.createDocumentFragment();
    lines.forEach(function (line) {
      var lineEl = document.createElement('div');
      lineEl.className = 'text-line';
      line.forEach(function (tok) {
        if (tok.t === 'e') {
          var e = document.createElement('span');
          e.className = 'edge ' + (tok.kind === 'broken' ? 'broken' : 'complete');
          e.title = tok.kind === 'broken' ? 'broken / damaged edge' : 'complete edge';
          lineEl.appendChild(e);
          return;
        }
        if (HAS_GLYPH[tok.code]) {
          var img = document.createElement('img');
          img.className = 'glyph' + (large ? ' lg' : '');
          img.src = signSrc(tok.code);
          img.alt = tok.code;
          img.title = 'sign ' + tok.code;
          img.loading = 'lazy';
          img.onerror = function () { this.replaceWith(missingBox(tok.code, large)); };
          lineEl.appendChild(img);
        } else {
          lineEl.appendChild(missingBox(tok.code, large));
        }
      });
      frag.appendChild(lineEl);
    });
    el.innerHTML = '';
    el.appendChild(frag);
  }
  function missingBox(code, large) {
    var b = document.createElement('span');
    b.className = 'glyph-missing' + (large ? ' lg' : '');
    b.textContent = code;
    b.title = code === '999' ? 'unknown / illegible sign' : 'no glyph for sign ' + code;
    return b;
  }

  // ---------------------------------------------------------------- DOM refs
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    tabs: $('tabs'),
    subtabs: $('subtabs'),
    analysisTab: $('analysisTab'),
    views: { texts: $('view-texts'), signs: $('view-signs'), about: $('view-about') },
    // texts
    txtSearch: $('txtSearch'), siteFilter: $('siteFilter'), dirFilter: $('dirFilter'),
    signFilter: $('signFilter'), pageSize: $('pageSize'), reset: $('resetFilters'),
    txtMeta: $('txtMeta'), txtBody: $('txtBody'), txtPager: $('txtPager'),
    // signs
    signSearch: $('signSearch'), signSort: $('signSort'), signGlyph: $('signGlyph'),
    signMeta: $('signMeta'), gallery: $('signGallery'),
    signGroup: $('signGroup'), signLike: $('signLike'),
    aboutStats: $('aboutStats'),
    // modals
    detail: $('detail'), detailBody: $('detailBody'), detailTitle: $('detailTitle'),
    signdetail: $('signdetail'), signDetailBody: $('signDetailBody'), signDetailTitle: $('signDetailTitle'),
    theme: $('themeToggle')
  };

  // ---------------------------------------------------------------- state
  var state = { view: 'texts', page: 1, pageSize: 25, codeMode: 'id' };
  try { if (localStorage.getItem(CODE_MODE_KEY) === 'str') state.codeMode = 'str'; } catch (e) {}

  function setCodeMode(mode) {
    state.codeMode = mode === 'str' ? 'str' : 'id';
    try { localStorage.setItem(CODE_MODE_KEY, state.codeMode); } catch (e) {}
    syncCodeToggle();
    renderTexts();
  }
  function syncCodeToggle() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-codemode]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-codemode') === state.codeMode));
    });
  }
  function displayCode(tc) { return state.codeMode === 'str' ? codeAsStrings(tc) : tc; }

  // ---------------------------------------------------------------- texts view
  var filtered = ROWS.map(function (_, i) { return i; }); // array of row indices

  function applyFilters() {
    var q = els.txtSearch.value.trim().toLowerCase();
    var site = els.siteFilter.value;
    var dir = els.dirFilter.value;
    var signRaw = els.signFilter.value.trim();
    var sign = signRaw ? pad3(signRaw.replace(/\D/g, '')) : '';
    filtered = [];
    for (var i = 0; i < ROWS.length; i++) {
      var ix = INDEX[i];
      if (q && ix.hay.indexOf(q) === -1 &&
          codeAsStrings(ROWS[i][COL.text_code]).toLowerCase().indexOf(q) === -1) continue;
      if (site && ix.site !== site) continue;
      if (dir && ix.dir !== dir) continue;
      if (sign && !ix.codes[sign]) continue;
      filtered.push(i);
    }
    state.page = 1;
    renderTexts();
  }

  function renderTexts() {
    var total = filtered.length;
    var ps = state.pageSize;
    var pages = Math.max(1, Math.ceil(total / ps));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * ps;
    var slice = filtered.slice(start, start + ps);

    els.txtMeta.textContent = total
      ? (total.toLocaleString() + ' text' + (total === 1 ? '' : 's') +
         ' · showing ' + (start + 1) + '–' + (start + slice.length))
      : 'No texts match your filters.';

    var body = els.txtBody;
    body.innerHTML = '';
    if (!slice.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="empty">Nothing to show. Try Reset.</div></td></tr>';
      els.txtPager.innerHTML = '';
      return;
    }
    var frag = document.createDocumentFragment();
    slice.forEach(function (ri) {
      var r = ROWS[ri];
      var tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.addEventListener('click', function () { openDetail(ri); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') openDetail(ri); });

      var tdId = document.createElement('td');
      tdId.innerHTML = '<span class="pill">' + r[COL.id] + '</span>';

      var tdText = document.createElement('td');
      tdText.className = 'col-text';
      var render = document.createElement('div');
      render.className = 'text-render';
      renderTextInto(render, r[COL.text_code], false);
      tdText.appendChild(render);

      tr.appendChild(tdId);
      tr.appendChild(tdText);
      tr.appendChild(cell(r[COL.site]));
      var tdCode = cell(displayCode(r[COL.text_code]), 'mono');
      tdCode.title = state.codeMode === 'str' ? r[COL.text_code] : codeAsStrings(r[COL.text_code]);
      tr.appendChild(tdCode);
      tr.appendChild(cell(r[COL.signs], 'num'));
      tr.appendChild(cell(r[COL.direction]));
      tr.appendChild(cell(r[COL.period]));
      frag.appendChild(tr);
    });
    body.appendChild(frag);
    renderPager(pages);
  }

  function cell(val, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    var v = norm(val);
    td.textContent = v || '—';
    if (!v) td.className = (cls ? cls + ' ' : '') + 'mono';
    return td;
  }

  function renderPager(pages) {
    var p = els.txtPager;
    p.innerHTML = '';
    if (pages <= 1) return;
    var cur = state.page;
    function btn(label, page, opts) {
      opts = opts || {};
      var b = document.createElement('button');
      b.textContent = label;
      if (opts.active) b.className = 'active';
      if (opts.disabled) b.disabled = true;
      else b.addEventListener('click', function () { state.page = page; renderTexts(); scrollTop(); });
      return b;
    }
    p.appendChild(btn('‹', cur - 1, { disabled: cur === 1 }));
    var nums = pageNumbers(cur, pages);
    nums.forEach(function (n) {
      if (n === '…') { var g = document.createElement('span'); g.className = 'gap'; g.textContent = '…'; p.appendChild(g); }
      else p.appendChild(btn(String(n), n, { active: n === cur }));
    });
    p.appendChild(btn('›', cur + 1, { disabled: cur === pages }));
  }
  function pageNumbers(cur, pages) {
    var out = [], add = function (n) { out.push(n); };
    var win = 2;
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || (i >= cur - win && i <= cur + win)) add(i);
      else if (out[out.length - 1] !== '…') add('…');
    }
    return out;
  }
  function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

  // ---------------------------------------------------------------- detail modal
  var PRIORITY = ['site', 'area', 'period', 'phase', 'material', 'museum', 'reference',
    'lines', 'signs', 'direction', 'text_condition', 'class', 'type', 'shape'];
  var HIDE = { id: 1, text_code: 1 };

  function prettyKey(k) {
    return k.replace(/_/g, ' ').replace(/\bmm\b/g, '(mm)')
      .replace(/^\w/, function (c) { return c.toUpperCase(); });
  }

  function openDetail(ri) {
    var r = ROWS[ri];
    els.detailTitle.textContent = 'Text #' + r[COL.id] +
      (norm(r[COL.site]) ? ' · ' + r[COL.site] : '');

    var body = els.detailBody;
    body.innerHTML = '';

    var signsBox = document.createElement('div');
    signsBox.className = 'detail-signs';
    var render = document.createElement('div');
    render.className = 'text-render';
    renderTextInto(render, r[COL.text_code], true);
    signsBox.appendChild(render);
    var code = document.createElement('div');
    code.className = 'detail-code';
    code.textContent = 'text code:  ' + (norm(r[COL.text_code]) || '—');
    signsBox.appendChild(code);
    var strCode = codeAsStrings(r[COL.text_code]);
    if (norm(r[COL.text_code]) && strCode !== r[COL.text_code]) {
      var codeS = document.createElement('div');
      codeS.className = 'detail-code';
      codeS.textContent = 'as strings: ' + strCode;
      signsBox.appendChild(codeS);
    }
    body.appendChild(signsBox);

    // chronology + location (graphical)
    var Atd = analysis(), epo = Atd.EPO[ri], st = norm(r[COL.site]);
    var chrono = document.createElement('div'); chrono.className = 'text-chrono';
    var tlBox = document.createElement('div');
    tlBox.appendChild(el('div', 'colh4', 'Chronology'));
    tlBox.appendChild(timelineChart(Atd.EPOCH_COUNTS, { width: 440, height: 84, highlight: epo }));
    var epoLabel = epo ? (EPOCHS.filter(function (e) { return e.k === epo; })[0].label) : 'unspecified / local period';
    tlBox.appendChild(el('div', 'chrono-cap', 'This text: ' + (norm(r[COL.period]) || '—') +
      (norm(r[COL.phase]) ? ' · phase ' + r[COL.phase] : '') + '  →  ' + epoLabel));
    chrono.appendChild(tlBox);
    if (st && window.SITES_GEO[st]) {
      var locBox = document.createElement('div');
      locBox.appendChild(el('div', 'colh4', 'Location'));
      var loc = {}; loc[st] = 1;
      locBox.appendChild(miniMap(loc, { width: 340, labelTop: 1, maxR: 7, bbox: autoBbox(loc) }));
      chrono.appendChild(locBox);
    }
    body.appendChild(chrono);

    // Metadata grid: priority fields first, then the rest, skipping empties.
    var grid = document.createElement('div');
    grid.className = 'meta-grid';
    var seen = {};
    function addField(name) {
      if (HIDE[name] || seen[name]) return;
      seen[name] = 1;
      var v = norm(r[COL[name]]);
      if (!v) return;
      var item = document.createElement('div'); item.className = 'meta-item';
      var k = document.createElement('div'); k.className = 'k'; k.textContent = prettyKey(name);
      var val = document.createElement('div'); val.className = 'v'; val.textContent = v;
      item.appendChild(k); item.appendChild(val);
      grid.appendChild(item);
    }
    PRIORITY.forEach(addField);
    COLS.forEach(addField);
    body.appendChild(grid);

    els.detail.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeDetail() { els.detail.hidden = true; document.body.style.overflow = ''; }

  // ---------------------------------------------------------------- signs view
  // Union of SVG signs and ICIT signs, as padded codes.
  var ALL_SIGN_CODES = (function () {
    var set = Object.create(null);
    window.SIGNS.forEach(function (id) { set[pad3(id)] = 1; });
    Object.keys(ICIT).forEach(function (c) { set[pad3(c)] = 1; });
    return Object.keys(set).sort();
  })();
  var icitTotal = function (c) { return (ICIT[c] && ICIT[c].total) || 0; };

  // Build a glyph <img> honoring the chosen source, falling back to the other.
  function glyphImg(code, source, small) {
    var img = document.createElement('img');
    img.alt = code; img.loading = 'lazy';
    var wantIcit = (source === 'icit' && HAS_ICIT[code]) ||
                   (source !== 'icit' && !HAS_GLYPH[code] && HAS_ICIT[code]);
    if (wantIcit) {
      img.src = icitSrc(code, small);
      img.setAttribute('data-fallback', HAS_GLYPH[code] ? signSrc(code) : '');
    } else if (HAS_GLYPH[code]) {
      img.src = signSrc(code);
      img.setAttribute('data-fallback', HAS_ICIT[code] ? icitSrc(code, small) : '');
    } else if (HAS_ICIT[code]) {
      img.src = icitSrc(code, small);
    }
    img.onerror = function () {
      var fb = this.getAttribute('data-fallback');
      if (fb) { this.src = fb; this.setAttribute('data-fallback', ''); } else { this.onerror = null; }
    };
    return img;
  }

  // Visual similarity (precomputed by tools/build_similarity.py).
  var SIM = window.SIGN_SIMILARITY || { groups: {}, neighbours: {} };
  // chamfer distance (pixels on a 48px glyph) -> rough "% alike" for display
  var simPct = function (d) { return Math.max(0, Math.round(100 * (1 - d / 3))); };
  function lookAlikes(code, n) { return (SIM.neighbours[code] || []).slice(0, n || 12); }

  function signCard(code, source, note) {
    var card = document.createElement('div');
    card.className = 'sign-card';
    card.title = 'Sign ' + code + ' — click for details';
    card.style.cursor = 'pointer';
    var box = document.createElement('div'); box.className = 'box';
    box.appendChild(glyphImg(code, source, true));
    var cap = document.createElement('div');
    cap.className = 'cap';
    var freqTxt = HAS_ICIT[code] ? (icitTotal(code) + '×')
      : (FREQ[code] ? (FREQ[code] + '×*') : '—');
    cap.innerHTML = '<b>' + code + '</b> · ' + freqTxt;
    card.appendChild(box); card.appendChild(cap);
    var sstr = signString(code);
    if (sstr) { var sc = document.createElement('div'); sc.className = 'cap-str'; sc.textContent = sstr; sc.title = sstr; card.appendChild(sc); }
    if (note) { var nt = document.createElement('div'); nt.className = 'cap-sim'; nt.textContent = note; card.appendChild(nt); }
    card.addEventListener('click', function () { openSignDetail(code); });
    return card;
  }
  function galleryHead(title, sub) {
    var h = document.createElement('div'); h.className = 'gal-head';
    var t = document.createElement('span'); t.className = 't'; t.textContent = title; h.appendChild(t);
    if (sub) { var u = document.createElement('span'); u.className = 'u'; u.textContent = sub; h.appendChild(u); }
    return h;
  }

  function renderSigns() {
    var q = els.signSearch.value.trim().replace(/\D/g, '');
    var sort = els.signSort.value;
    var source = els.signGlyph.value;
    var groupLvl = els.signGroup.value;
    var likeRaw = els.signLike.value.trim().replace(/\D/g, '');
    var like = likeRaw ? pad3(likeRaw) : '';
    var list = ALL_SIGN_CODES.slice();
    if (q) list = list.filter(function (c) { return c.indexOf(q) !== -1; });
    var cmp;
    if (sort === 'icit') cmp = function (a, b) { return icitTotal(b) - icitTotal(a) || (a < b ? -1 : 1); };
    else if (sort === 'freq') cmp = function (a, b) { return (FREQ[b] || 0) - (FREQ[a] || 0) || (a < b ? -1 : 1); };
    else cmp = function (a, b) { return a < b ? -1 : 1; };
    list.sort(cmp);

    var frag = document.createDocumentFragment(), shown = 0;
    if (like) {
      // the chosen sign first, then its closest look-alikes
      var inList = Object.create(null); list.forEach(function (c) { inList[c] = 1; });
      var near = lookAlikes(like, 24).filter(function (e) { return inList[e[0]]; });
      if (!SIM.neighbours[like]) {
        frag.appendChild(galleryHead('No similarity data for sign ' + like, 'it has no line drawing to compare'));
      } else {
        frag.appendChild(galleryHead('Signs that look like ' + like, 'closest first'));
        frag.appendChild(signCard(like, source, 'chosen sign')); shown++;
        near.forEach(function (e) { frag.appendChild(signCard(e[0], source, simPct(e[1]) + '% alike')); shown++; });
      }
      els.signMeta.textContent = shown + ' sign' + (shown === 1 ? '' : 's');
    } else if (groupLvl) {
      var pos = Object.create(null); list.forEach(function (c, i) { pos[c] = i; });
      var grouped = Object.create(null);
      var groups = (SIM.groups[groupLvl] || []).map(function (g) {
        g.forEach(function (c) { grouped[c] = 1; });
        return g.filter(function (c) { return c in pos; });
      }).filter(function (g) { return g.length > 1; });
      // order groups by the current sort (their best-placed member)
      groups.sort(function (a, b) {
        return Math.min.apply(null, a.map(function (c) { return pos[c]; })) -
               Math.min.apply(null, b.map(function (c) { return pos[c]; }));
      });
      groups.forEach(function (g, gi) {
        var names = [];
        g.forEach(function (c) { var t = signString(c); if (t && names.indexOf(t) === -1) names.push(t); });
        frag.appendChild(galleryHead('Group ' + (gi + 1) + ' · ' + g.length + ' signs', names.join(', ')));
        g.forEach(function (c) { frag.appendChild(signCard(c, source)); shown++; });
      });
      var rest = list.filter(function (c) { return !grouped[c]; });
      if (rest.length) {
        frag.appendChild(galleryHead('No close look-alike', rest.length + ' signs'));
        rest.forEach(function (c) { frag.appendChild(signCard(c, source)); shown++; });
      }
      els.signMeta.textContent = groups.length + ' groups · ' + shown + ' of ' + ALL_SIGN_CODES.length + ' signs';
    } else {
      list.forEach(function (c) { frag.appendChild(signCard(c, source)); shown++; });
      els.signMeta.textContent = shown + ' of ' + ALL_SIGN_CODES.length + ' signs';
    }
    els.gallery.innerHTML = '';
    els.gallery.appendChild(frag);
  }

  // ---------------------------------------------------------------- sign detail modal
  function glyphPanel(label, src) {
    var p = document.createElement('div'); p.className = 'glyph-panel';
    var l = document.createElement('div'); l.className = 'lbl'; l.textContent = label; p.appendChild(l);
    if (src) { var img = document.createElement('img'); img.src = src; img.alt = label; p.appendChild(img); }
    else { var n = document.createElement('div'); n.className = 'none'; n.textContent = 'not available'; p.appendChild(n); }
    return p;
  }
  function statBox(n, label) {
    var d = document.createElement('div'); d.className = 'st';
    var nn = document.createElement('span'); nn.className = 'n'; nn.textContent = n;
    var ll = document.createElement('span'); ll.className = 'l'; ll.textContent = label;
    d.appendChild(nn); d.appendChild(ll); return d;
  }
  function openSignDetail(code) {
    code = pad3(code);
    var info = ICIT[code];
    els.signDetailTitle.textContent = 'Sign ' + code;
    var body = els.signDetailBody; body.innerHTML = '';

    var hero = document.createElement('div'); hero.className = 'sign-hero';
    hero.appendChild(glyphPanel('Line drawing (SVG)', HAS_GLYPH[code] ? signSrc(code) : null));
    hero.appendChild(glyphPanel('ICIT glyph', HAS_ICIT[code] ? icitSrc(code, false) : null));
    body.appendChild(hero);

    var nsites = info ? Object.keys(info.sites).length : 0;
    var stats = document.createElement('div'); stats.className = 'sign-stats';
    stats.appendChild(statBox(info ? info.total : '\u2014', 'ICIT total freq'));
    stats.appendChild(statBox(FREQ[code] || 0, 'in this corpus'));
    stats.appendChild(statBox(nsites, 'sites'));
    body.appendChild(stats);

    // string attached to this sign ID (editable; saved in this browser, and in
    // data/sign_strings.js when that file is linked)
    var sedit = document.createElement('div'); sedit.className = 'sign-string';
    var slbl = document.createElement('label'); slbl.htmlFor = 'signStringInput'; slbl.textContent = 'String';
    var sin = document.createElement('input');
    sin.id = 'signStringInput'; sin.type = 'text'; sin.autocomplete = 'off'; sin.spellcheck = false;
    sin.placeholder = 'no string yet — shown as ' + code;
    sin.value = signString(code);
    var snote = document.createElement('span'); snote.className = 'sign-string-note';
    function noteText() {
      var fileV = FILE_STRINGS[code] || '', where;
      if (!(code in LOCAL_STRINGS)) where = fileV ? 'from data/sign_strings.js' : '';
      else where = 'saved in this browser only' + (fileV ? ' (file has “' + fileV + '”)' : '');
      var link = FILE_LINK.handle ? FILE_LINK.status
        : (FILE_LINK.supported ? 'File not linked — click “Link file” to write edits into data/sign_strings.js.'
          : 'This browser can’t write files — use Export, or open the site in Chrome/Edge to link the file.');
      return [where, link].filter(Boolean).join(' · ');
    }
    function refreshEditor() {
      snote.textContent = noteText();
      slink.textContent = FILE_LINK.handle ? 'Unlink file' : 'Link file…';
    }
    sin.addEventListener('input', debounce(function () {
      setSignString(code, sin.value);
      refreshEditor();
      if (state.view === 'signs') renderSigns();
      renderTexts();
      if (FILE_LINK.handle) writeLinkedFile().then(refreshEditor);
    }, 250));
    var slink = document.createElement('button'); slink.type = 'button'; slink.className = 'btn ghost';
    slink.title = 'Pick data/sign_strings.js so edits are saved straight into it';
    slink.hidden = !FILE_LINK.supported;
    slink.addEventListener('click', function () {
      if (FILE_LINK.handle) { unlinkFile(); refreshEditor(); }
      else linkFile().then(refreshEditor);
    });
    var sexp = document.createElement('button'); sexp.type = 'button'; sexp.className = 'btn ghost';
    sexp.textContent = 'Export';
    sexp.title = 'Download all strings as sign_strings.js (file + this browser’s edits)';
    sexp.addEventListener('click', exportSignStrings);
    var srow = document.createElement('div'); srow.className = 'sign-string-row';
    srow.appendChild(sin); srow.appendChild(slink); srow.appendChild(sexp);
    FILE_LINK.listeners = [refreshEditor];
    sedit.appendChild(slbl); sedit.appendChild(srow); sedit.appendChild(snote);
    refreshEditor();
    body.appendChild(sedit);

    // geographic distribution in this corpus (mapped)
    var gsc = groupSignCounts('site'), gvals = {};
    Object.keys(gsc).forEach(function (st) { var nn = gsc[st].counts[code] || 0; if (nn) gvals[st] = nn; });
    if (Object.keys(gvals).length) {
      var mh = el('h3', 'sd-h', 'Where it occurs'); body.appendChild(mh);
      body.appendChild(miniMap(gvals, { width: 520 }));
    }
    // chronology (when it occurs)
    var Asd = analysis(), se = Asd.SIGN_EPOCH[code];
    if (se && (se.early + se.mature + se.late) > 0) {
      body.appendChild(el('h3', 'sd-h', 'When it occurs'));
      body.appendChild(timelineChart(se, { width: 520, unspec: true }));
    }

    if (info && nsites) {
      var wrap = document.createElement('div'); wrap.className = 'persite';
      var h = document.createElement('h3'); h.textContent = 'Frequency by site (ICIT numbers)'; wrap.appendChild(h);
      var max = 1; for (var s in info.sites) { if (info.sites[s] > max) max = info.sites[s]; }
      Object.keys(info.sites).forEach(function (site) {
        var v = info.sites[site];
        var row = document.createElement('div'); row.className = 'persite-row';
        var sn = document.createElement('div'); sn.className = 'site'; sn.textContent = site; sn.title = site;
        var bw = document.createElement('div'); bw.className = 'barwrap';
        var bar = document.createElement('div'); bar.className = 'bar';
        bar.style.width = Math.max(2, Math.round(v / max * 100)) + '%';
        bw.appendChild(bar);
        var cn = document.createElement('div'); cn.className = 'cnt'; cn.textContent = v;
        row.appendChild(sn); row.appendChild(bw); row.appendChild(cn);
        wrap.appendChild(row);
      });
      body.appendChild(wrap);
    }

    var act = document.createElement('div'); act.className = 'sign-actions';
    var btn = document.createElement('button'); btn.className = 'btn';
    btn.textContent = 'Show texts containing sign ' + code;
    btn.addEventListener('click', function () {
      closeSignDetail();
      els.signFilter.value = code;
      els.txtSearch.value = ''; els.siteFilter.value = ''; els.dirFilter.value = '';
      switchView('texts'); applyFilters();
    });
    act.appendChild(btn); body.appendChild(act);

    // visually similar signs
    var alike = lookAlikes(code, 10);
    if (alike.length) {
      var simBox = document.createElement('div');
      simBox.appendChild(el('h3', 'sd-h', 'Looks similar'));
      var row = document.createElement('div'); row.className = 'alike-row';
      alike.forEach(function (e) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'alike';
        b.title = 'Sign ' + e[0] + ' · ' + simPct(e[1]) + '% alike' + (signString(e[0]) ? ' · ' + signString(e[0]) : '');
        b.appendChild(glyphImg(e[0], 'svg', true));
        b.appendChild(el('span', 'n', e[0]));
        b.addEventListener('click', function () { openSignDetail(e[0]); });
        row.appendChild(b);
      });
      simBox.appendChild(row);
      var more = document.createElement('button'); more.className = 'btn ghost'; more.type = 'button';
      more.textContent = 'Show all look-alikes of ' + code;
      more.addEventListener('click', function () {
        closeSignDetail();
        els.signLike.value = code; els.signSearch.value = '';
        switchView('signs'); renderSigns(); scrollTop();
      });
      var act2 = document.createElement('div'); act2.className = 'sign-actions'; act2.style.marginTop = '10px';
      act2.appendChild(more); simBox.appendChild(act2);
      sedit.after(simBox);
    }

    els.signdetail.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSignDetail() { els.signdetail.hidden = true; document.body.style.overflow = ''; }

  // ================================================================ ANALYSIS
  // Placeholder / damaged signs are excluded from sign-level analysis.
  var isReal = function (c) { return c !== '000' && c !== '999'; };

  // Reading-order sequence of sign codes for a text (right-to-left assumed
  // unless direction is L/R). Placeholders kept in place (not bridged).
  function buildSeq(ri) {
    var lines = parseTextCode(ROWS[ri][COL.text_code]);
    var flat = [];
    for (var li = 0; li < lines.length; li++)
      for (var ti = 0; ti < lines[li].length; ti++)
        if (lines[li][ti].t === 's') flat.push(lines[li][ti].code);
    if (INDEX[ri].dir.indexOf('L/R') !== 0) flat.reverse();
    return flat;
  }

  // Broad, approximate chronology from the (messy, mostly site-local) period field.
  var EPOCHS = [
    { k: 'early', label: 'Early Harappan', range: [-3300, -2600], color: '#7aa2c4' },
    { k: 'mature', label: 'Mature Harappan', range: [-2600, -1900], color: '#b4530a' },
    { k: 'late', label: 'Late Harappan', range: [-1900, -1300], color: '#e8944e' }
  ];
  function epochOf(pRaw) {
    var p = (pRaw || '').trim(); if (!p) return '';
    var low = p.toLowerCase();
    if (low === 'early') return 'early';
    if (low === 'late') return 'late';
    if (low === 'intermediate' || low === 'middle' || low === 'mature') return 'mature';
    if (low === 'akkadian') return 'mature';
    if (/^\d+(\/\d+)?$/.test(p)) {
      var n = parseInt(p, 10);
      if (p.indexOf('/') >= 0) { var a = p.split('/').map(Number); n = Math.max(a[0], a[1]); }
      if (n <= 2) return 'early';
      if (n === 3) return 'mature';
      if (n >= 4) return 'late';
    }
    return ''; // roman numerals / strata / layers -> unspecified
  }

  var ANALYSIS = null;
  function analysis() {
    if (ANALYSIS) return ANALYSIS;
    var TOKFREQ = Object.create(null), POS = Object.create(null),
        BIGRAM = Object.create(null), TRIGRAM = Object.create(null),
        NEXT = Object.create(null), PREV = Object.create(null),
        SITE = Object.create(null), SEQS = new Array(ROWS.length),
        lenHist = Object.create(null), totalTokens = 0,
        EPO = new Array(ROWS.length), EPOCH_COUNTS = { early: 0, mature: 0, late: 0, unspec: 0 },
        SIGN_EPOCH = Object.create(null);
    var bump = function (o, k) { o[k] = (o[k] || 0) + 1; };
    var nest = function (o, a, b) { (o[a] || (o[a] = Object.create(null)))[b] = (o[a][b] || 0) + 1; };

    for (var ri = 0; ri < ROWS.length; ri++) {
      var seq = buildSeq(ri); SEQS[ri] = seq;
      var reals = 0, i, c;
      for (i = 0; i < seq.length; i++) {
        c = seq[i]; if (!isReal(c)) continue;
        reals++; bump(TOKFREQ, c);
        var p = POS[c] || (POS[c] = { initial: 0, medial: 0, terminal: 0, solo: 0 });
        if (seq.length === 1) p.solo++;
        else if (i === 0) p.initial++;
        else if (i === seq.length - 1) p.terminal++;
        else p.medial++;
      }
      bump(lenHist, reals); totalTokens += reals;
      for (i = 0; i + 1 < seq.length; i++) {
        var a = seq[i], b = seq[i + 1];
        if (isReal(a) && isReal(b)) { bump(BIGRAM, a + '>' + b); nest(NEXT, a, b); nest(PREV, b, a); }
      }
      for (i = 0; i + 2 < seq.length; i++) {
        var x = seq[i], y = seq[i + 1], z = seq[i + 2];
        if (isReal(x) && isReal(y) && isReal(z)) bump(TRIGRAM, x + '>' + y + '>' + z);
      }
      var site = norm(ROWS[ri][COL.site]);
      if (site) {
        var s = SITE[site] || (SITE[site] = { texts: 0, tokens: 0, signSet: Object.create(null), signCount: Object.create(null), epoch: { early: 0, mature: 0, late: 0, unspec: 0 } });
        s.texts++; s.tokens += reals;
        for (i = 0; i < seq.length; i++) if (isReal(seq[i])) { s.signSet[seq[i]] = 1; bump(s.signCount, seq[i]); }
      }
      // chronology
      var epo = epochOf(norm(ROWS[ri][COL.period])); EPO[ri] = epo;
      EPOCH_COUNTS[epo || 'unspec']++;
      if (site) SITE[site].epoch[epo || 'unspec']++;
      var seen = Object.create(null);
      for (i = 0; i < seq.length; i++) {
        var cc = seq[i]; if (!isReal(cc) || seen[cc]) continue; seen[cc] = 1;
        var se = SIGN_EPOCH[cc] || (SIGN_EPOCH[cc] = { early: 0, mature: 0, late: 0, unspec: 0 });
        se[epo || 'unspec']++;
      }
    }
    ANALYSIS = { TOKFREQ: TOKFREQ, POS: POS, BIGRAM: BIGRAM, TRIGRAM: TRIGRAM,
      NEXT: NEXT, PREV: PREV, SITE: SITE, SEQS: SEQS, lenHist: lenHist, totalTokens: totalTokens,
      EPO: EPO, EPOCH_COUNTS: EPOCH_COUNTS, SIGN_EPOCH: SIGN_EPOCH };
    return ANALYSIS;
  }

  function topEntries(map, n) {
    return Object.keys(map).map(function (k) { return [k, map[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, n == null ? undefined : n);
  }
  function fieldCounts(field) {
    var m = Object.create(null), ci = COL[field];
    if (ci == null) return m;
    for (var ri = 0; ri < ROWS.length; ri++) { var v = norm(ROWS[ri][ci]); if (v) m[v] = (m[v] || 0) + 1; }
    return m;
  }

  // ---------------------------------------------------------------- chart helpers
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function tdText(t, cls) { var td = document.createElement('td'); if (cls) td.className = cls; td.textContent = t; return td; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function hbars(container, items, opts) {
    opts = opts || {}; container.innerHTML = '';
    var wrap = el('div', 'hbars');
    var max = opts.max || items.reduce(function (m, it) { return Math.max(m, it.value); }, 0) || 1;
    items.forEach(function (it) {
      var row = el('div', 'hbar' + (it.glyph ? ' glyphrow' : ''));
      if (it.glyph) { var g = glyphImg(it.glyph, 'svg', true); g.className = 'gly'; row.appendChild(g); }
      var lab = el('div', 'lab' + (it.onClick ? ' clk' : ''), it.label); lab.title = it.label;
      if (it.onClick) lab.addEventListener('click', it.onClick);
      row.appendChild(lab);
      var track = el('div', 'track'), fill = el('div', 'fill');
      fill.style.width = Math.max(2, Math.round(it.value / max * 100)) + '%';
      track.appendChild(fill); row.appendChild(track);
      row.appendChild(el('div', 'v', opts.fmt ? opts.fmt(it.value) : it.value.toLocaleString()));
      wrap.appendChild(row);
    });
    container.appendChild(wrap);
  }
  function histogram(container, pairs) {
    container.innerHTML = '';
    var wrap = el('div', 'histo');
    var max = pairs.reduce(function (m, p) { return Math.max(m, p[1]); }, 0) || 1;
    pairs.forEach(function (p) {
      var col = el('div', 'col');
      var bar = el('div', 'hb'); bar.style.height = Math.round(p[1] / max * 100) + '%';
      bar.title = p[0] + ': ' + p[1].toLocaleString();
      col.appendChild(bar); col.appendChild(el('div', 'hx', p[0]));
      wrap.appendChild(col);
    });
    container.appendChild(wrap);
  }
  function svgNS(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function zipf(container, freqs) {
    container.innerHTML = '';
    var W = 560, H = 300, pad = 42;
    var svg = svgNS('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'zipf-svg' });
    var maxRank = freqs.length || 1, maxFreq = freqs[0] || 1;
    var lx = function (r) { return pad + (Math.log10(r) / Math.log10(maxRank || 1 + 1e-9 + 1)) * (W - pad - 12); };
    var ly = function (f) { return (H - pad) - (Math.log10(f) / Math.log10(maxFreq || 1)) * (H - pad - 12); };
    svg.appendChild(svgNS('line', { x1: pad, y1: H - pad, x2: W - 10, y2: H - pad, 'class': 'axis' }));
    svg.appendChild(svgNS('line', { x1: pad, y1: 10, x2: pad, y2: H - pad, 'class': 'axis' }));
    var e;
    for (e = 0; Math.pow(10, e) <= maxFreq; e++) {
      var y = ly(Math.pow(10, e));
      svg.appendChild(svgNS('line', { x1: pad, y1: y, x2: W - 10, y2: y, 'class': 'grid' }));
      var t = svgNS('text', { x: 4, y: y + 3, 'class': 'tick' }); t.textContent = Math.pow(10, e); svg.appendChild(t);
    }
    for (e = 0; Math.pow(10, e) <= maxRank; e++) {
      var x = lx(Math.pow(10, e));
      var t2 = svgNS('text', { x: x - 4, y: H - pad + 14, 'class': 'tick' }); t2.textContent = Math.pow(10, e); svg.appendChild(t2);
    }
    freqs.forEach(function (f, i) { if (f > 0) svg.appendChild(svgNS('circle', { cx: lx(i + 1), cy: ly(f), r: 2, 'class': 'dot' })); });
    container.appendChild(svg);
  }

  var canFilterField = function (f) { return f === 'site'; };
  function facetToText(field, val) {
    els.txtSearch.value = ''; els.siteFilter.value = ''; els.dirFilter.value = ''; els.signFilter.value = '';
    if (field === 'site') els.siteFilter.value = val;
    switchView('texts'); applyFilters();
  }

  // ---------------------------------------------------------------- OVERVIEW
  function renderOverview() {
    var A = analysis();
    var cards = [
      [ROWS.length.toLocaleString(), 'inscriptions'],
      [Object.keys(A.TOKFREQ).length, 'distinct signs used'],
      [A.totalTokens.toLocaleString(), 'sign occurrences'],
      [Object.keys(A.SITE).length, 'sites'],
      [(A.totalTokens / ROWS.length).toFixed(1), 'avg signs / text'],
      [Object.keys(ICIT).length, 'ICIT glyphs']
    ];
    $('ovCards').innerHTML = cards.map(function (c) {
      return '<div class="sc"><span class="n">' + c[0] + '</span><span class="l">' + c[1] + '</span></div>';
    }).join('');
    // hero sample inscription (the canonical ICIT example, read right-to-left)
    if ($('heroInscription')) renderTextInto($('heroInscription'), '+407-032-520-095-585-017-231+', true);
    // find-spots mini-map (inscriptions per site)
    if ($('ovMap') && window.GEO && window.SITES_GEO) {
      var mvals = {}; Object.keys(A.SITE).forEach(function (s) { mvals[s] = A.SITE[s].texts; });
      var mr = mapSVG(mvals, { bbox: [62, 19, 78, 33], width: 520, labelTop: 8 });
      $('ovMap').innerHTML = mr.svg; wireMapClicks($('ovMap'));
    }
    hbars($('ovTopSigns'), topEntries(A.TOKFREQ, 15).map(function (e) {
      return { label: e[0], value: e[1], glyph: e[0], onClick: function () { openSignDetail(e[0]); } };
    }));
    var sitePairs = Object.keys(A.SITE).map(function (s) {
      return { label: s, value: A.SITE[s].texts, onClick: function () { facetToText('site', s); } };
    }).sort(function (a, b) { return b.value - a.value; }).slice(0, 15);
    hbars($('ovTopSites'), sitePairs);
    var cap = 20, buckets = [], k;
    for (k = 1; k <= cap; k++) buckets.push([String(k), A.lenHist[k] || 0]);
    var over = 0; Object.keys(A.lenHist).forEach(function (kk) { if (+kk > cap) over += A.lenHist[kk]; });
    buckets.push(['>' + cap, over]);
    histogram($('ovLenHist'), buckets);
    distBars($('ovDir'), 'direction', 8);
    distBars($('ovMaterial'), 'material', 8);
    distBars($('ovType'), 'type', 8);
    $('ovPeriod').innerHTML = ''; $('ovPeriod').appendChild(timelineChart(A.EPOCH_COUNTS, { width: 520, unspec: true }));
    distBars($('ovComplete'), 'complete', 6);
  }
  function distBars(container, field, n) {
    var m = fieldCounts(field), entries = topEntries(m, n);
    var total = 0; Object.keys(m).forEach(function (k) { total += m[k]; });
    var shown = entries.reduce(function (s, e) { return s + e[1]; }, 0);
    var items = entries.map(function (e) {
      return { label: e[0], value: e[1], onClick: canFilterField(field) ? function () { facetToText(field, e[0]); } : null };
    });
    if (total > shown) items.push({ label: '(other ' + (Object.keys(m).length - entries.length) + ')', value: total - shown });
    hbars(container, items);
  }

  // ---------------------------------------------------------------- STATS
  function renderStats() {
    var A = analysis();
    var freqs = Object.keys(A.TOKFREQ).map(function (k) { return A.TOKFREQ[k]; }).sort(function (a, b) { return b - a; });
    zipf($('zipf'), freqs);
    $('posLegend').innerHTML = ['initial', 'medial', 'terminal', 'solo'].map(function (k) {
      return '<span class="k"><span class="sw seg-' + k + '"></span>' + k + '</span>';
    }).join('');
    statsTable();
  }
  function posPct(c) {
    var A = analysis(), p = A.POS[c] || { initial: 0, medial: 0, terminal: 0, solo: 0 };
    var t = (p.initial + p.medial + p.terminal + p.solo) || 1;
    return { i: p.initial / t, m: p.medial / t, tm: p.terminal / t, s: p.solo / t };
  }
  function statsTable() {
    var A = analysis();
    var q = $('statsSearch').value.trim().replace(/\D/g, ''), sort = $('statsSort').value;
    var codes = Object.keys(A.TOKFREQ);
    if (q) codes = codes.filter(function (c) { return c.indexOf(q) !== -1; });
    codes.sort(function (a, b) {
      if (sort === 'id') return (+a) - (+b);
      if (sort === 'freq') return A.TOKFREQ[b] - A.TOKFREQ[a];
      var pa = posPct(a), pb = posPct(b);
      if (sort === 'initial') return pb.i - pa.i;
      if (sort === 'terminal') return pb.tm - pa.tm;
      if (sort === 'medial') return pb.m - pa.m;
      return 0;
    });
    $('statsMeta').textContent = codes.length + ' signs';
    var body = $('statsBody'); body.innerHTML = '';
    var frag = document.createDocumentFragment();
    var pctTxt = function (x) { return x > 0 ? Math.round(x * 100) + '%' : '·'; };
    codes.slice(0, 400).forEach(function (c) {
      var p = posPct(c), tr = document.createElement('tr'); tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () { openSignDetail(c); });
      var g = glyphImg(c, 'svg', true); g.className = 'gly';
      var tdG = document.createElement('td'); tdG.appendChild(g); tr.appendChild(tdG);
      tr.appendChild(tdText(c));
      tr.appendChild(tdText(A.TOKFREQ[c].toLocaleString(), 'num'));
      tr.appendChild(tdText((A.TOKFREQ[c] / A.totalTokens * 100).toFixed(2) + '%', 'num'));
      tr.appendChild(tdText(ICIT[c] ? ICIT[c].total.toLocaleString() : '—', 'num'));
      tr.appendChild(tdText(pctTxt(p.i), 'num'));
      tr.appendChild(tdText(pctTxt(p.m), 'num'));
      tr.appendChild(tdText(pctTxt(p.tm), 'num'));
      var tdBar = document.createElement('td'), bar = el('div', 'posbar');
      [['initial', p.i], ['medial', p.m], ['terminal', p.tm], ['solo', p.s]].forEach(function (seg) {
        if (seg[1] > 0) { var sp = el('span', 'seg-' + seg[0]); sp.style.width = (seg[1] * 100) + '%'; sp.title = seg[0] + ' ' + Math.round(seg[1] * 100) + '%'; bar.appendChild(sp); }
      });
      tdBar.appendChild(bar); tr.appendChild(tdBar);
      frag.appendChild(tr);
    });
    body.appendChild(frag);
  }

  // ---------------------------------------------------------------- SEQUENCES
  function ngramList(container, entries) {
    container.innerHTML = '';
    var max = entries.length ? entries[0][1] : 1, wrap = el('div', 'hbars');
    entries.forEach(function (e) {
      var codes = e[0].split('>'), row = el('div', 'hbar');
      row.style.gridTemplateColumns = 'auto 1fr 52px';
      var gl = el('div'); gl.style.display = 'flex'; gl.style.gap = '4px'; gl.style.alignItems = 'center';
      codes.forEach(function (c, idx) {
        if (idx) { var ar = el('span', null, '→'); ar.style.color = 'var(--muted)'; gl.appendChild(ar); }
        var g = glyphImg(c, 'svg', true); g.className = 'gly'; g.title = c; gl.appendChild(g);
      });
      row.appendChild(gl);
      var track = el('div', 'track'), fill = el('div', 'fill');
      fill.style.width = Math.max(2, Math.round(e[1] / max * 100)) + '%'; track.appendChild(fill);
      row.appendChild(track); row.appendChild(el('div', 'v', e[1].toLocaleString()));
      wrap.appendChild(row);
    });
    container.appendChild(wrap);
  }
  function renderSequences() {
    var A = analysis();
    ngramList($('bigrams'), topEntries(A.BIGRAM, 20));
    ngramList($('trigrams'), topEntries(A.TRIGRAM, 20));
    neighbours();
  }
  function neighbours() {
    var A = analysis();
    var raw = $('neighSign').value.trim().replace(/\D/g, ''), body = $('neighBody');
    if (!raw) { body.innerHTML = '<p class="muted">Enter a sign number above to see its most common preceding and following signs.</p>'; $('neighMeta').textContent = ''; return; }
    var code = pad3(raw), prev = A.PREV[code] || {}, next = A.NEXT[code] || {};
    var p = A.POS[code] || { initial: 0, medial: 0, terminal: 0, solo: 0 };
    var tot = (p.initial + p.medial + p.terminal + p.solo);
    $('neighMeta').textContent = tot ? (code + ' · ' + (A.TOKFREQ[code] || 0).toLocaleString() + ' occurrences') : (code + ' · not attested in this corpus');
    body.innerHTML = '';
    var colP = el('div', 'neigh-col'); colP.appendChild(el('h4', null, 'Preceded by'));
    var barsP = el('div'); colP.appendChild(barsP);
    hbars(barsP, topEntries(prev, 8).map(function (e) { return { label: e[0], value: e[1], glyph: e[0], onClick: function () { $('neighSign').value = e[0]; neighbours(); } }; }));
    var colC = el('div', 'neigh-center');
    var g = glyphImg(code, 'svg', false); g.className = 'big'; colC.appendChild(g);
    colC.appendChild(el('div', 'lab', 'sign ' + code));
    if (tot) colC.appendChild(el('div', 'endstat', 'initial ' + Math.round(p.initial / tot * 100) + '% · terminal ' + Math.round(p.terminal / tot * 100) + '%'));
    var colN = el('div', 'neigh-col'); colN.appendChild(el('h4', null, 'Followed by'));
    var barsN = el('div'); colN.appendChild(barsN);
    hbars(barsN, topEntries(next, 8).map(function (e) { return { label: e[0], value: e[1], glyph: e[0], onClick: function () { $('neighSign').value = e[0]; neighbours(); } }; }));
    body.appendChild(colP); body.appendChild(colC); body.appendChild(colN);
  }

  // ---------------------------------------------------------------- SITES
  function renderSites() {
    var A = analysis();
    var top = Object.keys(A.SITE).map(function (s) {
      return { label: s, value: A.SITE[s].texts, onClick: function () { facetToText('site', s); } };
    }).sort(function (a, b) { return b.value - a.value; }).slice(0, 25);
    hbars($('sitesBar'), top);
    sitesTable();
  }
  function sitesTable() {
    var A = analysis();
    var q = $('sitesSearch').value.trim().toLowerCase(), sort = $('sitesSort').value;
    var sites = Object.keys(A.SITE);
    if (q) sites = sites.filter(function (s) { return s.toLowerCase().indexOf(q) !== -1; });
    sites.sort(function (a, b) {
      var A1 = A.SITE[a], B1 = A.SITE[b];
      if (sort === 'name') return a < b ? -1 : 1;
      if (sort === 'signs') return Object.keys(B1.signSet).length - Object.keys(A1.signSet).length;
      return B1.texts - A1.texts;
    });
    $('sitesMeta').textContent = sites.length + ' sites';
    var body = $('sitesBody'); body.innerHTML = '';
    var frag = document.createDocumentFragment();
    sites.forEach(function (s) {
      var rec = A.SITE[s], tr = document.createElement('tr'); tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () { facetToText('site', s); });
      tr.appendChild(tdText(s));
      tr.appendChild(tdText(rec.texts.toLocaleString(), 'num'));
      tr.appendChild(tdText(Object.keys(rec.signSet).length, 'num'));
      tr.appendChild(tdText((rec.tokens / rec.texts).toFixed(1), 'num'));
      var td = document.createElement('td'), box = el('div'); box.style.display = 'flex'; box.style.gap = '3px';
      topEntries(rec.signCount, 6).forEach(function (e) { var g = glyphImg(e[0], 'svg', true); g.className = 'gly'; g.title = e[0] + ' ×' + e[1]; box.appendChild(g); });
      td.appendChild(box); tr.appendChild(td);
      frag.appendChild(tr);
    });
    body.appendChild(frag);
  }

  // ---------------------------------------------------------------- FACETS
  var FACET_FIELDS = ['site', 'area', 'period', 'phase', 'material', 'museum', 'type', 'shape',
    'color', 'direction', 'text_condition', 'artefact_preservation', 'class', 'style_group', 'complete', 'boss'];
  function renderFacets() {
    var fields = FACET_FIELDS.filter(function (f) { return COL[f] != null; });
    if (!$('facetField').options.length) {
      var fill = function (sel, def) { fields.forEach(function (f) { var o = new Option(prettyKey(f), f); if (f === def) o.selected = true; sel.appendChild(o); }); };
      fill($('facetField'), 'material'); fill($('ctRows'), 'material'); fill($('ctCols'), 'site');
    }
    facetDist(); crosstab();
  }
  function facetDist() {
    var f = $('facetField').value, m = fieldCounts(f);
    hbars($('facetBar'), topEntries(m, 15).map(function (e) {
      return { label: e[0], value: e[1], onClick: canFilterField(f) ? function () { facetToText(f, e[0]); } : null };
    }));
  }
  function crosstab() {
    var rf = $('ctRows').value, cf = $('ctCols').value, ri2 = COL[rf], ci2 = COL[cf];
    var rowsTop = topEntries(fieldCounts(rf), 12).map(function (e) { return e[0]; });
    var colsTop = topEntries(fieldCounts(cf), 12).map(function (e) { return e[0]; });
    var rset = {}, cset = {}; rowsTop.forEach(function (r) { rset[r] = 1; }); colsTop.forEach(function (c) { cset[c] = 1; });
    var counts = {}, max = 0, i;
    for (i = 0; i < ROWS.length; i++) {
      var rv = norm(ROWS[i][ri2]), cv = norm(ROWS[i][ci2]);
      if (rset[rv] && cset[cv]) { var kk = rv + '\u0001' + cv; counts[kk] = (counts[kk] || 0) + 1; if (counts[kk] > max) max = counts[kk]; }
    }
    max = max || 1;
    var html = '<table class="crosstab"><thead><tr><th class="corner">' + esc(prettyKey(rf)) + ' \\ ' + esc(prettyKey(cf)) + '</th>';
    colsTop.forEach(function (c) { html += '<th>' + esc(c) + '</th>'; });
    html += '</tr></thead><tbody>';
    rowsTop.forEach(function (r) {
      html += '<tr><td class="rowlab">' + esc(r) + '</td>';
      colsTop.forEach(function (c) {
        var v = counts[r + '\u0001' + c] || 0, a = v ? (0.12 + 0.88 * v / max) : 0;
        html += '<td style="background:rgba(180,83,10,' + a.toFixed(3) + ')">' + (v || '') + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    $('crosstab').innerHTML = html;
  }

  // ---------------------------------------------------------------- MATRIX
  function renderMatrix() {
    var A = analysis();
    var n = parseInt($('matN').value, 10) || 30, mode = $('matMode').value;
    var top = topEntries(A.TOKFREQ, n).map(function (e) { return e[0]; });
    var idx = {}; top.forEach(function (c, i) { idx[c] = i; });
    var M = [], i, j; for (i = 0; i < n; i++) { M.push([]); for (j = 0; j < n; j++) M[i].push(0); }
    if (mode === 'cooc') {
      for (var r = 0; r < A.SEQS.length; r++) {
        var seen = {}; A.SEQS[r].forEach(function (c) { if (idx[c] != null) seen[c] = 1; });
        var ks = Object.keys(seen);
        for (var a = 0; a < ks.length; a++) {
          M[idx[ks[a]]][idx[ks[a]]]++;
          for (var b = a + 1; b < ks.length; b++) { M[idx[ks[a]]][idx[ks[b]]]++; M[idx[ks[b]]][idx[ks[a]]]++; }
        }
      }
    } else {
      top.forEach(function (aa) { top.forEach(function (bb) { var v = A.BIGRAM[aa + '>' + bb] || 0; if (v) M[idx[aa]][idx[bb]] += v; }); });
    }
    var max = 0; for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (i !== j && M[i][j] > max) max = M[i][j];
    max = max || 1;
    var img = function (c) { return '<img src="' + signSrc(c) + '" title="' + c + '" onerror="this.onerror=null;this.src=\'icit/small/S' + pad3(c) + '.jpg\'">'; };
    var html = '<table class="matrix"><thead><tr><th></th>';
    top.forEach(function (c) { html += '<th class="colh">' + img(c) + '</th>'; });
    html += '</tr></thead><tbody>';
    for (i = 0; i < n; i++) {
      html += '<tr><th class="rowh">' + img(top[i]) + ' ' + top[i] + '</th>';
      for (j = 0; j < n; j++) {
        var v = M[i][j], diag = i === j;
        var alpha = diag ? 0 : (v ? (0.1 + 0.9 * v / max) : 0);
        var bg = diag ? 'var(--surface-2)' : 'rgba(180,83,10,' + alpha.toFixed(3) + ')';
        html += '<td class="' + (diag ? 'd' : '') + '" title="' + top[i] + ' × ' + top[j] + ': ' + v + '" style="background:' + bg + '"></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    $('matrix').innerHTML = html;
    $('matMeta').textContent = 'top ' + n + ' signs · ' + (mode === 'cooc' ? 'co-occurrence in same text' : 'adjacency (neighbour) counts');
  }

  var log2 = function (x) { return Math.log(x) / Math.LN2; };
  function sumVals(o) { var s = 0; for (var k in o) s += o[k]; return s; }

  // ---------------------------------------------------------------- ENTROPY
  function renderEntropy() {
    var A = analysis(), T = A.totalTokens, N = Object.keys(A.TOKFREQ).length;
    var H1 = 0, s; for (s in A.TOKFREQ) { var p = A.TOKFREQ[s] / T; H1 -= p * log2(p); }
    var totBig = 0, firstCount = Object.create(null), k;
    for (k in A.BIGRAM) { var c = A.BIGRAM[k]; totBig += c; var x = k.split('>')[0]; firstCount[x] = (firstCount[x] || 0) + c; }
    var Hcond = 0, x2; for (x2 in A.NEXT) { var row = A.NEXT[x2], rowTot = firstCount[x2] || sumVals(row); if (!rowTot) continue; var px = rowTot / totBig, h = 0, y; for (y in row) { var pyx = row[y] / rowTot; h -= pyx * log2(pyx); } Hcond += px * h; }
    var H2 = 0; for (k in A.BIGRAM) { var p2 = A.BIGRAM[k] / totBig; H2 -= p2 * log2(p2); }
    var totTri = 0, kt; for (kt in A.TRIGRAM) totTri += A.TRIGRAM[kt];
    var H3 = 0; for (kt in A.TRIGRAM) { var p3 = A.TRIGRAM[kt] / totTri; H3 -= p3 * log2(p3); }
    var Hmax = log2(N);
    hbars($('entropyBars'), [
      { label: 'Uniform random', value: Hmax },
      { label: 'Unigram H\u2081', value: H1 },
      { label: 'Given prev. sign', value: Hcond }
    ], { max: Hmax, fmt: function (v) { return v.toFixed(2) + ' bits'; } });
    $('entropyNums').innerHTML =
      '<span class="en"><b>' + H1.toFixed(2) + '</b> bits &nbsp;unigram entropy</span>' +
      '<span class="en"><b>' + Hcond.toFixed(2) + '</b> bits &nbsp;given previous sign</span>' +
      '<span class="en"><b>' + (H1 - Hcond).toFixed(2) + '</b> bits &nbsp;reduction from order</span>' +
      '<span class="en"><b>' + Math.round((1 - Hcond / H1) * 100) + '%</b> &nbsp;of uncertainty removed by context</span>';
    hbars($('blockEntropy'), [{ label: 'n = 1', value: H1 }, { label: 'n = 2', value: H2 / 2 }, { label: 'n = 3', value: H3 / 3 }],
      { fmt: function (v) { return v.toFixed(2) + ' bits/sym'; } });
  }

  // ---------------------------------------------------------------- COLLOCATIONS
  function ll(o, e) { return o <= 0 ? 0 : o * Math.log(o / e); }
  function renderCollocations() { collTable(); }
  function collTable() {
    var A = analysis(), metric = $('collMetric').value, minc = parseInt($('collMin').value, 10) || 5;
    var totBig = 0, firstC = Object.create(null), secondC = Object.create(null), k;
    for (k in A.BIGRAM) { var c = A.BIGRAM[k], ab = k.split('>'); totBig += c; firstC[ab[0]] = (firstC[ab[0]] || 0) + c; secondC[ab[1]] = (secondC[ab[1]] || 0) + c; }
    var rows = [];
    for (k in A.BIGRAM) {
      var c2 = A.BIGRAM[k]; if (c2 < minc) continue;
      var ab2 = k.split('>'), a = ab2[0], b = ab2[1], fa = firstC[a], sb = secondC[b];
      var pmi = log2((c2 / totBig) / ((fa / totBig) * (sb / totBig)));
      var e11 = fa * sb / totBig, e12 = fa * (totBig - sb) / totBig, e21 = (totBig - fa) * sb / totBig, e22 = (totBig - fa) * (totBig - sb) / totBig;
      var g2 = 2 * (ll(c2, e11) + ll(fa - c2, e12) + ll(sb - c2, e21) + ll(totBig - fa - sb + c2, e22));
      rows.push([a, b, c2, pmi, g2]);
    }
    rows.sort(function (x, y) { return metric === 'g2' ? y[4] - x[4] : y[3] - x[3]; });
    $('collMeta').textContent = rows.length.toLocaleString() + ' pairs (count \u2265 ' + minc + ')';
    var body = $('collBody'); body.innerHTML = '';
    var frag = document.createDocumentFragment();
    rows.slice(0, 200).forEach(function (r) {
      var tr = document.createElement('tr');
      var td = document.createElement('td'), box = el('div'); box.style.display = 'flex'; box.style.gap = '4px'; box.style.alignItems = 'center';
      var g1 = glyphImg(r[0], 'svg', true); g1.className = 'gly'; box.appendChild(g1);
      var ar = el('span', null, '\u2192'); ar.style.color = 'var(--muted)'; box.appendChild(ar);
      var g2i = glyphImg(r[1], 'svg', true); g2i.className = 'gly'; box.appendChild(g2i);
      td.appendChild(box); tr.appendChild(td);
      tr.appendChild(tdText(r[2].toLocaleString(), 'num'));
      tr.appendChild(tdText(r[3].toFixed(2), 'num'));
      tr.appendChild(tdText(Math.round(r[4]).toLocaleString(), 'num'));
      frag.appendChild(tr);
    });
    body.appendChild(frag);
  }

  // ---------------------------------------------------------------- SEGMENTS
  var _ngramDoc = null;
  function ngramDocCounts() {
    if (_ngramDoc) return _ngramDoc;
    var A = analysis(), maps = { 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
    for (var ri = 0; ri < A.SEQS.length; ri++) {
      var runs = [], cur = [];
      A.SEQS[ri].forEach(function (c) { if (isReal(c)) cur.push(c); else { if (cur.length) runs.push(cur); cur = []; } });
      if (cur.length) runs.push(cur);
      var seen = {};
      runs.forEach(function (run) {
        for (var n = 2; n <= 6; n++) for (var i = 0; i + n <= run.length; i++) {
          var key = run.slice(i, i + n).join('-');
          if (!seen[n + '|' + key]) { seen[n + '|' + key] = 1; maps[n][key] = (maps[n][key] || 0) + 1; }
        }
      });
    }
    _ngramDoc = maps; return maps;
  }
  function renderSegments() { segBody(); }
  function segBody() {
    var maps = ngramDocCounts(), lenSel = parseInt($('segLen').value, 10) || 0, rank = $('segRank').value;
    var list = [], lens = lenSel ? [lenSel] : [2, 3, 4, 5, 6];
    lens.forEach(function (n) { var m = maps[n]; for (var key in m) if (m[key] >= 3) list.push([key, m[key], n]); });
    list.sort(function (a, b) { return rank === 'score' ? (b[2] * b[1]) - (a[2] * a[1]) : (b[1] - a[1]) || (b[2] - a[2]); });
    $('segMeta').textContent = list.length.toLocaleString() + ' repeated blocks';
    var max = list.length ? (rank === 'score' ? list[0][2] * list[0][1] : list[0][1]) : 1;
    var body = $('segBody'); body.innerHTML = '';
    var frag = document.createDocumentFragment();
    list.slice(0, 120).forEach(function (r) {
      var row = el('div', 'seg-row'), g = el('div', 'glyphs');
      r[0].split('-').forEach(function (c) { var im = glyphImg(c, 'svg', true); im.className = 'gly'; g.appendChild(im); });
      row.appendChild(g);
      var track = el('div', 'track'), fill = el('div', 'fill'), val = rank === 'score' ? r[2] * r[1] : r[1];
      fill.style.width = Math.max(2, Math.round(val / max * 100)) + '%'; track.appendChild(fill); row.appendChild(track);
      row.appendChild(el('div', 'v', r[1].toLocaleString() + ' texts \u00b7 len ' + r[2]));
      frag.appendChild(row);
    });
    body.appendChild(frag);
  }

  // ---------------------------------------------------------------- POSITIONS
  function renderPositions() { posHeat(); }
  function posHeat() {
    var A = analysis(), n = parseInt($('posTopN').value, 10) || 40, sort = $('posSort').value, BINS = 10;
    var top = topEntries(A.TOKFREQ, n).map(function (e) { return e[0]; }), idx = {};
    top.forEach(function (c, i) { idx[c] = i; });
    var counts = top.map(function () { var a = []; for (var b = 0; b < BINS; b++) a.push(0); return a; });
    var totals = top.map(function () { return 0; });
    for (var ri = 0; ri < A.SEQS.length; ri++) {
      var seq = A.SEQS[ri], L = seq.length; if (!L) continue;
      for (var i = 0; i < L; i++) { var c = seq[i]; if (idx[c] == null) continue; var rel = L === 1 ? 0.5 : i / (L - 1); var bi = Math.floor(rel * BINS); if (bi >= BINS) bi = BINS - 1; if (bi < 0) bi = 0; counts[idx[c]][bi]++; totals[idx[c]]++; }
    }
    var order = top.map(function (c, i) { var mean = 0, tot = totals[i] || 1, b; for (b = 0; b < BINS; b++) mean += counts[i][b] * (b + 0.5) / BINS; return { c: c, i: i, mean: mean / tot, freq: A.TOKFREQ[c] }; });
    if (sort === 'early') order.sort(function (a, b) { return a.mean - b.mean; });
    else if (sort === 'late') order.sort(function (a, b) { return b.mean - a.mean; });
    else order.sort(function (a, b) { return b.freq - a.freq; });
    var maxFrac = 0; order.forEach(function (o) { var t = totals[o.i] || 1, b; for (b = 0; b < BINS; b++) maxFrac = Math.max(maxFrac, counts[o.i][b] / t); });
    maxFrac = maxFrac || 1;
    var html = '<table class="posheat"><thead><tr><th></th>', b;
    for (b = 0; b < BINS; b++) html += '<th>' + (b === 0 ? 'start' : (b === BINS - 1 ? 'end' : '')) + '</th>';
    html += '</tr></thead><tbody>';
    order.forEach(function (o) {
      var t = totals[o.i] || 1;
      html += '<tr><th class="rowh"><img src="' + signSrc(o.c) + '" onerror="this.onerror=null;this.src=\'icit/small/S' + pad3(o.c) + '.jpg\'"> ' + o.c + '</th>';
      for (var bb = 0; bb < BINS; bb++) { var f = counts[o.i][bb] / t, a = f ? (0.08 + 0.92 * f / maxFrac) : 0; html += '<td title="' + o.c + ' \u00b7 ' + Math.round(f * 100) + '%" style="background:rgba(180,83,10,' + a.toFixed(3) + ')">' + (f > 0.14 ? Math.round(f * 100) : '') + '</td>'; }
      html += '</tr>';
    });
    html += '</tbody></table>';
    $('posHeat').innerHTML = html;
  }

  // ---------------------------------------------------------------- SIMILARITY
  var _ctx = null;
  function contextVectors() {
    if (_ctx) return _ctx;
    var A = analysis(), dims = {};
    topEntries(A.TOKFREQ, 120).forEach(function (e) { dims[e[0]] = 1; });
    var vec = {}, norm = {};
    Object.keys(A.TOKFREQ).forEach(function (s) {
      var v = Object.create(null), nx = A.NEXT[s] || {}, pv = A.PREV[s] || {}, k;
      for (k in nx) if (dims[k]) v['n' + k] = log2(1 + nx[k]);
      for (k in pv) if (dims[k]) v['p' + k] = log2(1 + pv[k]);
      var nr = 0, kk; for (kk in v) nr += v[kk] * v[kk];
      vec[s] = v; norm[s] = Math.sqrt(nr) || 1;
    });
    _ctx = { vec: vec, norm: norm }; return _ctx;
  }
  function cosineVec(a, b, na, nb) { var d = 0, k; for (k in a) if (b[k]) d += a[k] * b[k]; return d / (na * nb); }
  function similarTo(code, topn) {
    var C = contextVectors(); if (!C.vec[code]) return [];
    var res = [], s; for (s in C.vec) { if (s === code) continue; var sim = cosineVec(C.vec[code], C.vec[s], C.norm[code], C.norm[s]); if (sim > 0) res.push([s, sim]); }
    res.sort(function (a, b) { return b[1] - a[1]; }); return res.slice(0, topn);
  }
  function renderSimilarity() { if (!$('simSign').value) $('simSign').value = '740'; simBody(); simClusters(); }
  function simBody() {
    var raw = $('simSign').value.trim().replace(/\D/g, ''), box = $('simBody');
    if (!raw) { box.innerHTML = '<p class="muted">Enter a sign number.</p>'; $('simMeta').textContent = ''; return; }
    var code = pad3(raw), sims = similarTo(code, 16), A = analysis();
    $('simMeta').textContent = A.TOKFREQ[code] ? (code + ' \u00b7 ' + A.TOKFREQ[code].toLocaleString() + ' occurrences') : (code + ' \u00b7 not attested');
    box.innerHTML = '';
    if (!sims.length) { box.innerHTML = '<p class="muted">Not enough data for this sign.</p>'; return; }
    var row = el('div', 'cluster');
    sims.forEach(function (e) {
      var c = el('div', 'simcard'); var im = glyphImg(e[0], 'svg', true); im.style.height = '34px'; c.appendChild(im);
      c.appendChild(el('div', 'cap', e[0] + ' \u00b7 ' + e[1].toFixed(2)));
      c.addEventListener('click', function () { $('simSign').value = e[0]; simBody(); });
      row.appendChild(c);
    });
    box.appendChild(row);
  }
  function simClusters() {
    var A = analysis(), C = contextVectors();
    var top = topEntries(A.TOKFREQ, 40).map(function (e) { return e[0]; });
    var clusters = top.map(function (c) { return [c]; });
    function avgSim(c1, c2) { var s = 0, nn = 0; c1.forEach(function (a) { c2.forEach(function (b) { s += cosineVec(C.vec[a], C.vec[b], C.norm[a], C.norm[b]); nn++; }); }); return s / nn; }
    while (clusters.length > 8) {
      var bi = -1, bj = -1, best = -1;
      for (var i = 0; i < clusters.length; i++) for (var j = i + 1; j < clusters.length; j++) { var s = avgSim(clusters[i], clusters[j]); if (s > best) { best = s; bi = i; bj = j; } }
      if (best < 0.12) break;
      clusters[bi] = clusters[bi].concat(clusters[bj]); clusters.splice(bj, 1);
    }
    clusters.sort(function (a, b) { return b.length - a.length; });
    var box = $('simClusters'); box.innerHTML = ''; var wrap = el('div', 'clusters'), gi = 0;
    clusters.forEach(function (cl) {
      if (cl.length < 2) return; gi++;
      var row = el('div', 'cluster'); row.appendChild(el('span', 'cl-lbl', 'group ' + gi));
      cl.forEach(function (c) { var im = glyphImg(c, 'svg', true); im.className = 'gly'; im.title = c; im.style.cursor = 'pointer'; im.addEventListener('click', function () { $('simSign').value = c; simBody(); window.scrollTo({ top: 0, behavior: 'smooth' }); }); row.appendChild(im); });
      wrap.appendChild(row);
    });
    box.appendChild(wrap);
  }

  // ---------------------------------------------------------------- DISTINCTIVE
  var _grp = {};
  function groupSignCounts(field) {
    if (_grp[field]) return _grp[field];
    var A = analysis(), G = {}, ci = COL[field];
    for (var ri = 0; ri < ROWS.length; ri++) {
      var v = norm(ROWS[ri][ci]); if (!v) continue;
      var g = G[v] || (G[v] = { tokens: 0, counts: Object.create(null) }), seq = A.SEQS[ri];
      for (var i = 0; i < seq.length; i++) if (isReal(seq[i])) { g.tokens++; g.counts[seq[i]] = (g.counts[seq[i]] || 0) + 1; }
    }
    _grp[field] = G; return G;
  }
  function renderDistinctive() {
    var field = $('distField').value, G = groupSignCounts(field);
    var vals = Object.keys(G).sort(function (a, b) { return G[b].tokens - G[a].tokens; });
    var sel = $('distValue');
    if (sel.getAttribute('data-field') !== field) {
      sel.innerHTML = ''; vals.forEach(function (v) { sel.appendChild(new Option(v + ' (' + G[v].tokens + ')', v)); });
      sel.setAttribute('data-field', field);
    }
    distinctiveTable();
  }
  function distinctiveTable() {
    var A = analysis(), field = $('distField').value, val = $('distValue').value, G = groupSignCounts(field), g = G[val];
    if (!g) { $('distOver').innerHTML = ''; $('distUnder').innerHTML = ''; return; }
    var Atot = g.tokens, Btot = A.totalTokens - Atot, scored = [];
    Object.keys(A.TOKFREQ).forEach(function (s) {
      if (A.TOKFREQ[s] < 15) return;
      var a = g.counts[s] || 0, b = A.TOKFREQ[s] - a;
      var lo = Math.log((a + 0.5) / (Atot - a + 0.5)) - Math.log((b + 0.5) / (Btot - b + 0.5));
      var z = lo / Math.sqrt(1 / (a + 0.5) + 1 / (Atot - a + 0.5) + 1 / (b + 0.5) + 1 / (Btot - b + 0.5));
      scored.push([s, z, a]);
    });
    var over = scored.slice().sort(function (x, y) { return y[1] - x[1]; }).slice(0, 15);
    var under = scored.slice().sort(function (x, y) { return x[1] - y[1]; }).slice(0, 15);
    $('distMeta').textContent = val + ' \u00b7 ' + Atot.toLocaleString() + ' sign occurrences';
    var mk = function (arr) { return arr.map(function (r) { return { label: r[0] + ' (' + r[2] + ')', value: Math.abs(r[1]), glyph: r[0], onClick: function () { openSignDetail(r[0]); } }; }); };
    hbars($('distOver'), mk(over), { fmt: function (v) { return '+' + v.toFixed(1); } });
    hbars($('distUnder'), mk(under), { fmt: function (v) { return '\u2212' + v.toFixed(1); } });
  }

  // ---------------------------------------------------------------- DUPLICATES
  var _dist = null;
  function distinctSeqs() {
    if (_dist) return _dist;
    var A = analysis(), map = {};
    for (var ri = 0; ri < ROWS.length; ri++) {
      var seq = A.SEQS[ri]; if (!seq.length) continue;
      var key = seq.join('-'), rec = map[key] || (map[key] = { codes: seq, count: 0, ids: [], sites: Object.create(null) });
      rec.count++; rec.ids.push(ROWS[ri][COL.id]); var st = norm(ROWS[ri][COL.site]); if (st) rec.sites[st] = (rec.sites[st] || 0) + 1;
    }
    _dist = map; return map;
  }
  function seqLine(codes, other, showCount, count) {
    var line = el('div', 'seq');
    if (showCount) { var cn = el('span', 'cnt', '\u00d7' + count); cn.style.marginRight = '8px'; line.appendChild(cn); }
    codes.forEach(function (c, i) {
      if (isReal(c)) { var im = glyphImg(c, 'svg', true); im.title = c; if (other && other[i] !== c) im.className = (im.className || '') + ' diff'; line.appendChild(im); }
      else line.appendChild(el('span', 'glyph-missing', c));
    });
    return line;
  }
  function renderDuplicates() {
    var map = distinctSeqs();
    var groups = Object.keys(map).map(function (k) { return map[k]; }).filter(function (r) { return r.count >= 2; }).sort(function (a, b) { return b.count - a.count; });
    var totalDup = groups.reduce(function (s, g) { return s + g.count; }, 0);
    $('dupMeta').textContent = groups.length.toLocaleString() + ' sequences repeat, covering ' + totalDup.toLocaleString() + ' inscriptions';
    var ex = $('dupExact'); ex.innerHTML = '';
    groups.slice(0, 60).forEach(function (g) {
      var row = el('div', 'dupgroup');
      row.appendChild(el('span', 'cnt', '\u00d7' + g.count));
      row.appendChild(seqLine(g.codes, null, false));
      var sites = Object.keys(g.sites).sort(function (a, b) { return g.sites[b] - g.sites[a]; }).slice(0, 4).join(', ');
      row.appendChild(el('span', 'where', sites));
      ex.appendChild(row);
    });
    renderNearDup(map);
  }
  function editDist1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a.length === b.length) { var d = 0, i; for (i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (++d > 1) return false; } return d === 1; }
    var lo = a.length < b.length ? a : b, hi = a.length < b.length ? b : a, i2 = 0, j2 = 0, diff = 0;
    while (i2 < lo.length && j2 < hi.length) { if (lo[i2] === hi[j2]) { i2++; j2++; } else { if (++diff > 1) return false; j2++; } }
    return true;
  }
  function renderNearDup(map) {
    var keys = Object.keys(map), sig = {};
    function add(sg, kk) { (sig[sg] || (sig[sg] = [])).push(kk); }
    keys.forEach(function (k) { var codes = map[k].codes; add('D' + k, k); for (var i = 0; i < codes.length; i++) add('D' + codes.slice(0, i).concat(codes.slice(i + 1)).join('-'), k); });
    var seen = {}, pairs = [], sg;
    for (sg in sig) { var arr = sig[sg]; if (arr.length < 2) continue; for (var i = 0; i < arr.length; i++) for (var j = i + 1; j < arr.length; j++) { var a = arr[i], b = arr[j]; if (a === b) continue; var pk = a < b ? a + '|' + b : b + '|' + a; if (seen[pk]) continue; seen[pk] = 1; if (editDist1(map[a].codes, map[b].codes)) pairs.push([a, b]); } }
    pairs.sort(function (x, y) { return (map[y[0]].count + map[y[1]].count) - (map[x[0]].count + map[x[1]].count); });
    var box = $('dupNear'); box.innerHTML = '';
    if (!pairs.length) { box.innerHTML = '<p class="muted">None found.</p>'; return; }
    pairs.slice(0, 40).forEach(function (p) {
      var wrap = el('div', 'dup-pair'), r0 = map[p[0]], r1 = map[p[1]];
      wrap.appendChild(seqLine(r0.codes, r1.codes, true, r0.count));
      wrap.appendChild(seqLine(r1.codes, r0.codes, true, r1.count));
      box.appendChild(wrap);
    });
  }

  // ---------------------------------------------------------------- NETWORK
  function renderNetwork() { networkDraw(); }
  function networkDraw() {
    var A = analysis(), n = parseInt($('netN').value, 10) || 30, ne = parseInt($('netE').value, 10) || 70, wmode = $('netW').value;
    var top = topEntries(A.TOKFREQ, n).map(function (e) { return e[0]; }), idx = {};
    top.forEach(function (c, i) { idx[c] = i; });
    var totBig = 0, firstC = {}, secondC = {}, k;
    for (k in A.BIGRAM) { var c = A.BIGRAM[k]; totBig += c; var ab = k.split('>'); firstC[ab[0]] = (firstC[ab[0]] || 0) + c; secondC[ab[1]] = (secondC[ab[1]] || 0) + c; }
    var edges = [];
    top.forEach(function (a) { top.forEach(function (b) { if (a === b) return; var c = A.BIGRAM[a + '>' + b] || 0; if (c < 3) return; var w = c; if (wmode === 'pmi') { var pmi = log2((c / totBig) / ((firstC[a] / totBig) * (secondC[b] / totBig))); if (pmi <= 0) return; w = pmi; } edges.push([a, b, w, c]); }); });
    edges.sort(function (x, y) { return y[2] - x[2]; }); edges = edges.slice(0, ne);
    var W = 700, H = 700, cx = W / 2, cy = H / 2, R = 285, pos = {};
    top.forEach(function (c, i) { var ang = -Math.PI / 2 + i / top.length * 2 * Math.PI; pos[c] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) }; });
    var maxw = edges.reduce(function (m, e) { return Math.max(m, e[2]); }, 0) || 1;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="max-width:720px;margin:auto">';
    edges.forEach(function (e) { var p1 = pos[e[0]], p2 = pos[e[1]], sw = 0.6 + e[2] / maxw * 6, op = 0.15 + e[2] / maxw * 0.5; svg += '<path class="edge" d="M' + p1.x.toFixed(1) + ' ' + p1.y.toFixed(1) + ' Q ' + cx + ' ' + cy + ' ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1) + '" stroke-width="' + sw.toFixed(2) + '" opacity="' + op.toFixed(2) + '"><title>' + e[0] + ' \u2192 ' + e[1] + ': ' + e[3] + '</title></path>'; });
    top.forEach(function (c) { var p = pos[c], sz = 26; svg += '<image href="' + signSrc(c) + '" x="' + (p.x - sz / 2).toFixed(1) + '" y="' + (p.y - sz / 2).toFixed(1) + '" width="' + sz + '" height="' + sz + '"><title>' + c + '</title></image>'; });
    svg += '</svg>';
    $('network').innerHTML = svg;
  }

  // ---------------------------------------------------------------- MAP (reusable)
  // Auto-pick region: 'all' if any valued site lies west of the Indus core.
  function autoBbox(values) {
    var wide = false;
    Object.keys(values).forEach(function (s) { if (values[s] > 0 && window.SITES_GEO[s] && window.SITES_GEO[s][1] < 62) wide = true; });
    return wide ? window.GEO.bbox : [62, 19, 78, 33];
  }
  // Build an SVG map (basemap + sized markers). values = {site: number}. Returns svg string.
  function mapSVG(values, opts) {
    opts = opts || {};
    var bb = opts.bbox || [62, 19, 78, 33], W = opts.width || 900;
    var midLat = (bb[1] + bb[3]) / 2 * Math.PI / 180, kx = Math.cos(midLat);
    var x0 = bb[0] * kx, x1 = bb[2] * kx, y0 = -bb[3], y1 = -bb[1];
    var H = Math.round(W * (y1 - y0) / (x1 - x0));
    function proj(lon, lat) { return [((lon * kx) - x0) / (x1 - x0) * W, ((-lat) - y0) / (y1 - y0) * H]; }
    var pts = [];
    Object.keys(window.SITES_GEO).forEach(function (site) {
      var v = values[site] || 0; if (v <= 0) return;
      var ll = window.SITES_GEO[site], xy = proj(ll[1], ll[0]);
      if (xy[0] < -40 || xy[0] > W + 40 || xy[1] < -40 || xy[1] > H + 40) return;
      pts.push({ site: site, v: v, x: xy[0], y: xy[1] });
    });
    var maxV = pts.reduce(function (m, p) { return Math.max(m, p.v); }, 1);
    var minR = opts.minR || 3, maxR = opts.maxR || 30;
    var rOf = function (v) { return minR + Math.sqrt(v / maxV) * (maxR - minR); };
    pts.sort(function (a, b) { return b.v - a.v; });
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
    var dstr = '';
    window.GEO.rings.forEach(function (ring) { var d = 'M'; ring.forEach(function (p, i) { var xy = proj(p[0], p[1]); d += (i ? 'L' : '') + xy[0].toFixed(1) + ' ' + xy[1].toFixed(1) + ' '; }); dstr += d + 'Z'; });
    svg += '<path class="map-land" d="' + dstr + '"/>';
    pts.forEach(function (p) {
      svg += '<circle class="map-site" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + rOf(p.v).toFixed(1) +
        '" data-site="' + esc(p.site) + '"><title>' + esc(p.site) + ': ' + p.v.toLocaleString() + '</title></circle>';
    });
    var lim = opts.labelTop == null ? 9999 : opts.labelTop, placed = [], cnt = 0;
    function overlaps(x, y, w) { for (var i = 0; i < placed.length; i++) { var b = placed[i]; if (!(x > b.x + b.w || x + w < b.x || y > b.y + 13 || y + 13 < b.y)) return true; } return false; }
    pts.forEach(function (p) {
      if (cnt >= lim) return;
      var r = rOf(p.v), lx = p.x + r + 3, ly = p.y + 4, w = p.site.length * 6.2;
      if (ly - 11 < 0 || ly > H || lx < 0 || lx + w > W || overlaps(lx, ly - 11, w)) return;
      placed.push({ x: lx, y: ly - 11, w: w }); cnt++;
      svg += '<text class="map-label" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '">' + esc(p.site) + '</text>';
    });
    svg += '</svg>';
    return { svg: svg, pts: pts };
  }
  function wireMapClicks(container) {
    Array.prototype.forEach.call(container.querySelectorAll('.map-site'), function (c) {
      c.addEventListener('click', function () { facetToText('site', c.getAttribute('data-site')); });
    });
  }
  // Small map for modals. values={site:n}. Returns a DOM element.
  function miniMap(values, opts) {
    opts = opts || {};
    var wrap = el('div', 'map-wrap mini');
    if (!window.GEO || !window.SITES_GEO || !Object.keys(values).length) { wrap.innerHTML = '<p class="muted small" style="padding:10px">No mappable sites.</p>'; return wrap; }
    var r = mapSVG(values, { bbox: opts.bbox || autoBbox(values), width: opts.width || 460, labelTop: opts.labelTop == null ? 6 : opts.labelTop, maxR: opts.maxR || 18 });
    wrap.innerHTML = r.svg; wireMapClicks(wrap); return wrap;
  }

  function renderMap() { mapDraw(); }
  function mapDraw() {
    if (!window.GEO || !window.SITES_GEO) { $('map').innerHTML = '<p class="muted">Map data not loaded.</p>'; return; }
    var A = analysis();
    var region = $('mapRegion').value, mode = $('mapSize').value;
    var signCode = pad3(($('mapSign').value || '').trim().replace(/\D/g, '') || '740');
    var bySign = mode === 'sign' ? groupSignCounts('site') : null;
    var values = {};
    Object.keys(A.SITE).forEach(function (site) {
      var rec = A.SITE[site];
      values[site] = mode === 'signs' ? Object.keys(rec.signSet).length
        : (mode === 'sign' ? ((bySign[site] && bySign[site].counts[signCode]) || 0) : rec.texts);
    });
    var bb = region === 'core' ? [62, 19, 78, 33] : window.GEO.bbox;
    var r = mapSVG(values, { bbox: bb, width: 900 });
    $('map').innerHTML = r.svg; wireMapClicks($('map'));
    var label = mode === 'signs' ? 'distinct signs' : (mode === 'sign' ? ('occurrences of sign ' + signCode) : 'inscriptions');
    $('mapMeta').textContent = r.pts.length + ' sites shown \u00b7 size = ' + label;
  }

  // ---------------------------------------------------------------- TIMELINE (reusable)
  // counts = {early,mature,late,unspec}. opts.highlight = epoch key to emphasise.
  function timelineChart(counts, opts) {
    opts = opts || {};
    var W = opts.width || 460, H = opts.height || 96, padB = 26, padT = 14, padL = 4, padR = 4;
    var t0 = -3300, t1 = -1300;
    var tx = function (yr) { return padL + (yr - t0) / (t1 - t0) * (W - padL - padR); };
    var maxC = 1; EPOCHS.forEach(function (e) { maxC = Math.max(maxC, counts[e.k] || 0); });
    var baseY = H - padB, topY = padT;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="timeline-svg">';
    // axis line
    svg += '<line x1="' + padL + '" y1="' + baseY + '" x2="' + (W - padR) + '" y2="' + baseY + '" class="tl-axis"/>';
    EPOCHS.forEach(function (e) {
      var xa = tx(e.range[0]), xb = tx(e.range[1]), c = counts[e.k] || 0;
      var bh = (c / maxC) * (baseY - topY);
      var hi = opts.highlight === e.k;
      // era band (faint) + bar
      svg += '<rect x="' + xa.toFixed(1) + '" y="' + baseY + '" width="' + (xb - xa).toFixed(1) + '" height="4" fill="' + e.color + '" opacity="0.9"/>';
      if (c > 0) svg += '<rect x="' + (xa + 2).toFixed(1) + '" y="' + (baseY - bh).toFixed(1) + '" width="' + (xb - xa - 4).toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + e.color + '" opacity="' + (hi ? '1' : '0.55') + '"' + (hi ? ' stroke="var(--text)" stroke-width="1.5"' : '') + '/>';
      // label + count
      svg += '<text x="' + ((xa + xb) / 2).toFixed(1) + '" y="' + (baseY - bh - 4).toFixed(1) + '" class="tl-cnt" text-anchor="middle">' + (c || '') + '</text>';
      svg += '<text x="' + ((xa + xb) / 2).toFixed(1) + '" y="' + (baseY + 12).toFixed(1) + '" class="tl-lab" text-anchor="middle">' + e.label.split(' ')[0] + '</text>';
    });
    // date ticks
    [-3300, -2600, -1900, -1300].forEach(function (yr) {
      svg += '<text x="' + tx(yr).toFixed(1) + '" y="' + (H - 2) + '" class="tl-date" text-anchor="middle">' + (-yr) + '</text>';
    });
    svg += '</svg>';
    var box = el('div');
    box.innerHTML = svg;
    if (opts.unspec) { var u = el('div', 'muted small'); u.style.marginTop = '4px'; u.textContent = counts.unspec.toLocaleString() + ' with unspecified/local period'; box.appendChild(u); }
    return box;
  }

  // ---------------------------------------------------------------- views / tabs
  var PRIMARY_VIEWS = ['overview', 'texts', 'signs', 'about'];
  var ANALYSIS_VIEWS = ['stats', 'entropy', 'collocations', 'segments', 'sequences', 'positions',
    'similarity', 'matrix', 'network', 'map', 'sites', 'facets', 'distinctive', 'duplicates'];
  var ALL_VIEWS = PRIMARY_VIEWS.concat(ANALYSIS_VIEWS);
  var built = {};

  // ---- Analysis dropdown menu ----
  function positionAnalysisMenu() {
    var st = els.subtabs, r = els.analysisTab.getBoundingClientRect();
    if (window.innerWidth <= 640) {
      st.style.left = '8px'; st.style.right = '8px'; st.style.width = 'auto'; st.style.top = (r.bottom + 6) + 'px';
    } else {
      st.style.right = 'auto'; st.style.width = ''; st.style.left = '0px'; st.style.top = (r.bottom + 6) + 'px';
      var w = st.offsetWidth, left = r.left;
      if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
      st.style.left = left + 'px';
    }
  }
  function openAnalysisMenu() { els.subtabs.hidden = false; positionAnalysisMenu(); els.analysisTab.setAttribute('aria-expanded', 'true'); }
  function closeAnalysisMenu() { if (!els.subtabs.hidden) { els.subtabs.hidden = true; els.analysisTab.setAttribute('aria-expanded', 'false'); } }
  function toggleAnalysisMenu() { if (els.subtabs.hidden) openAnalysisMenu(); else closeAnalysisMenu(); }

  function switchView(view) {
    if (view === 'analysis') view = state.lastAnalysis || 'stats';
    if (ALL_VIEWS.indexOf(view) < 0) view = 'overview';
    state.view = view;
    var isAnalysis = ANALYSIS_VIEWS.indexOf(view) >= 0;
    if (isAnalysis) state.lastAnalysis = view;
    ALL_VIEWS.forEach(function (v) { var s = document.getElementById('view-' + v); if (s) s.hidden = (v !== view); });
    Array.prototype.forEach.call(els.tabs.children, function (t) {
      var d = t.dataset.view;
      t.classList.toggle('active', d === view || (d === 'analysis' && isAnalysis));
    });
    Array.prototype.forEach.call(els.subtabs.querySelectorAll('.subtab'), function (t) {
      t.classList.toggle('active', t.dataset.view === view);
    });
    closeAnalysisMenu();
    // keep the active primary tab visible in the horizontally-scrollable strip (mobile)
    try { var at = els.tabs.querySelector('.tab.active'); if (at) at.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) {}
    renderView(view);
    if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
  }
  function renderView(view) {
    if (built[view]) return;
    switch (view) {
      case 'signs': renderSigns(); break;
      case 'overview': renderOverview(); break;
      case 'stats': renderStats(); break;
      case 'entropy': renderEntropy(); break;
      case 'collocations': renderCollocations(); break;
      case 'segments': renderSegments(); break;
      case 'sequences': renderSequences(); break;
      case 'positions': renderPositions(); break;
      case 'similarity': renderSimilarity(); break;
      case 'matrix': renderMatrix(); break;
      case 'network': renderNetwork(); break;
      case 'map': renderMap(); break;
      case 'sites': renderSites(); break;
      case 'facets': renderFacets(); break;
      case 'distinctive': renderDistinctive(); break;
      case 'duplicates': renderDuplicates(); break;
      default: return; // texts (applyFilters), about (static)
    }
    built[view] = true;
  }

  // ---------------------------------------------------------------- theme
  var THEME_KEY = 'ivs-theme-choice'; // only set when the user explicitly toggles
  function systemTheme() {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  function themeChoice() { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } }
  function applyTheme(mode, persist) {
    document.documentElement.setAttribute('data-theme', mode);
    els.theme.querySelector('.theme-icon').textContent = mode === 'dark' ? '☀️' : '🌙';
    if (persist) { try { localStorage.setItem(THEME_KEY, mode); } catch (e) {} }
  }

  // ---------------------------------------------------------------- init
  function populateFilters() {
    var sites = {}, dirs = {};
    INDEX.forEach(function (ix) { if (ix.site) sites[ix.site] = 1; if (ix.dir) dirs[ix.dir] = 1; });
    Object.keys(sites).sort().forEach(function (s) {
      els.siteFilter.appendChild(new Option(s, s));
    });
    Object.keys(dirs).sort().forEach(function (d) {
      els.dirFilter.appendChild(new Option(d, d));
    });
  }

  function fillAboutStats() {
    var withText = INDEX.filter(function (ix) { return Object.keys(ix.codes).length; }).length;
    var sites = {}; INDEX.forEach(function (ix) { if (ix.site) sites[ix.site] = 1; });
    var stats = [
      [ROWS.length.toLocaleString(), 'inscribed texts'],
      [window.SIGNS.length, 'distinct signs'],
      [Object.keys(sites).length, 'sites'],
      [withText.toLocaleString(), 'texts with a code'],
      [Object.keys(ICIT).length, 'ICIT glyphs']
    ];
    els.aboutStats.innerHTML = stats.map(function (s) {
      return '<li><span class="n">' + s[0] + '</span><span class="l">' + s[1] + '</span></li>';
    }).join('');
  }

  function debounce(fn, ms) {
    var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function bind() {
    Array.prototype.forEach.call(els.tabs.children, function (t) {
      t.addEventListener('click', function (e) {
        if (t.dataset.view === 'analysis') { e.stopPropagation(); toggleAnalysisMenu(); }
        else switchView(t.dataset.view);
      });
    });
    document.addEventListener('click', function (e) {
      if (els.subtabs.hidden) return;
      if (els.subtabs.contains(e.target) || els.analysisTab.contains(e.target)) return;
      closeAnalysisMenu();
    });
    window.addEventListener('resize', closeAnalysisMenu);
    Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (b) {
      b.addEventListener('click', function () { switchView(b.getAttribute('data-goto')); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    });
    els.txtSearch.addEventListener('input', debounce(applyFilters, 180));
    els.signFilter.addEventListener('input', debounce(applyFilters, 180));
    els.siteFilter.addEventListener('change', applyFilters);
    els.dirFilter.addEventListener('change', applyFilters);
    els.pageSize.addEventListener('change', function () {
      state.pageSize = parseInt(els.pageSize.value, 10) || 25; state.page = 1; renderTexts();
    });
    els.reset.addEventListener('click', function () {
      els.txtSearch.value = ''; els.siteFilter.value = ''; els.dirFilter.value = '';
      els.signFilter.value = ''; applyFilters();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-codemode]'), function (b) {
      b.addEventListener('click', function () { setCodeMode(b.getAttribute('data-codemode')); });
    });
    syncCodeToggle();
    els.signSearch.addEventListener('input', debounce(renderSigns, 180));
    els.signSort.addEventListener('change', renderSigns);
    els.signGroup.addEventListener('change', renderSigns);
    els.signLike.addEventListener('input', debounce(renderSigns, 180));
    els.signGlyph.addEventListener('change', renderSigns);

    // analysis view controls
    $('statsSearch').addEventListener('input', debounce(statsTable, 180));
    $('statsSort').addEventListener('change', statsTable);
    $('neighSign').addEventListener('input', debounce(neighbours, 200));
    $('sitesSearch').addEventListener('input', debounce(sitesTable, 180));
    $('sitesSort').addEventListener('change', sitesTable);
    $('facetField').addEventListener('change', facetDist);
    $('ctRows').addEventListener('change', crosstab);
    $('ctCols').addEventListener('change', crosstab);
    $('matN').addEventListener('change', renderMatrix);
    $('matMode').addEventListener('change', renderMatrix);

    Array.prototype.forEach.call(els.subtabs.querySelectorAll('.subtab'), function (t) {
      t.addEventListener('click', function () { switchView(t.dataset.view); });
    });
    $('collMetric').addEventListener('change', collTable);
    $('collMin').addEventListener('change', collTable);
    $('segLen').addEventListener('change', segBody);
    $('segRank').addEventListener('change', segBody);
    $('posTopN').addEventListener('change', posHeat);
    $('posSort').addEventListener('change', posHeat);
    $('simSign').addEventListener('input', debounce(simBody, 200));
    $('distField').addEventListener('change', renderDistinctive);
    $('distValue').addEventListener('change', distinctiveTable);
    $('netN').addEventListener('change', networkDraw);
    $('netE').addEventListener('change', networkDraw);
    $('netW').addEventListener('change', networkDraw);
    $('mapRegion').addEventListener('change', mapDraw);
    $('mapSize').addEventListener('change', mapDraw);
    $('mapSign').addEventListener('input', debounce(function () { if ($('mapSize').value !== 'sign') $('mapSize').value = 'sign'; mapDraw(); }, 250));

    Array.prototype.forEach.call(els.detail.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', closeDetail);
    });
    Array.prototype.forEach.call(els.signdetail.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', closeSignDetail);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeDetail(); closeSignDetail(); closeAnalysisMenu(); }
    });

    els.theme.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark', true);
    });
    window.addEventListener('hashchange', function () {
      var v = location.hash.slice(1);
      if (ALL_VIEWS.indexOf(v) >= 0 && v !== state.view) switchView(v);
    });
  }

  // theme: default to the system preference; only an explicit toggle overrides it.
  try { localStorage.removeItem('ivs-theme'); } catch (e) {} // drop the old auto-saved value
  applyTheme(themeChoice() || systemTheme(), false);
  // live-follow the OS theme unless the user has explicitly chosen one
  var _mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (_mq) {
    var _onSys = function () { if (!themeChoice()) applyTheme(systemTheme(), false); };
    if (_mq.addEventListener) _mq.addEventListener('change', _onSys);
    else if (_mq.addListener) _mq.addListener(_onSys);
  }

  populateFilters();
  fillAboutStats();
  bind();
  state.pageSize = parseInt(els.pageSize.value, 10) || 25;

  applyFilters(); // prepare the texts view (renders into its hidden table)
  var initView = location.hash.slice(1);
  switchView(ALL_VIEWS.indexOf(initView) >= 0 ? initView : 'overview');
})();

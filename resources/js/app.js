/* ============================================================
   NEBULA · app.js — local AI studio for Ollama.
   • talks straight to http://127.0.0.1:11434 (tags/ps/show/chat)
   • streams responses, renders markdown + reasoning
   • workspace tools: list / read / write / search (model-driven)
   • effort slider → reasoning budget + thicker star particles
   ============================================================ */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const fmtGB = b => (b / 1e9).toFixed(1) + ' GB';
  const baseName = p => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '/';

  const NL = () => window.Neutralino;

  /* ---------------------------------------------------------- state */
  const state = {
    host: 'http://127.0.0.1:11434',
    online: false,
    models: [],              /* /api/tags entries */
    loaded: new Map(),       /* name → /api/ps entry */
    caps: new Map(),         /* name → capabilities[] */
    selected: null,
    loading: new Set(),      /* models being pulled into memory */
    effort: 42,
    streaming: false,
    abort: null,
    apiMessages: [],         /* [{role, content, tool_calls?}] sent to ollama */
    starList: [],
    ws: { root: null, attached: [], tools: true, treeCache: null },
    pollTimer: 0,
    retryTimer: 0,
  };

  const MAX_ROUNDS = 8;
  const TOOLS_DEF = [
    { type: 'function', function: { name: 'list_files', description: 'List entries of a folder inside the workspace. Use relative paths, "" for the root.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'relative folder path' } }, required: [] } } },
    { type: 'function', function: { name: 'read_file', description: 'Read a text file from the workspace (relative path). Returns the file content.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'relative file path' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file inside the workspace with the given full content.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'relative file path' }, content: { type: 'string', description: 'complete new file content' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'search_files', description: 'Search all text files in the workspace for a substring (case-insensitive).', parameters: { type: 'object', properties: { query: { type: 'string', description: 'text to search for' } }, required: ['query'] } } },
  ];

  /* ---------------------------------------------------------- storage */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('neb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('neb.' + k, JSON.stringify(v)); } catch { } },
    del(k) { try { localStorage.removeItem('neb.' + k); } catch { } },
  };

  /* ---------------------------------------------------------- toasts */
  function toast(msg, kind = '', ms = 4200) {
    const t = el('div', 'toast ' + kind, esc(msg));
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('gone'); setTimeout(() => t.remove(), 350); }, ms);
  }

  /* ---------------------------------------------------------- neutralino helpers */
  let nlReadyResolve = null;
  const nlReady = new Promise(r => { nlReadyResolve = r; });
  function initNL() {
    const n = NL();
    if (!n) { setTimeout(nlReadyResolve, 60); return; }
    try { n.init(); } catch { }
    try { n.events.on('ready', () => nlReadyResolve()); } catch { setTimeout(nlReadyResolve, 400); }
    setTimeout(nlReadyResolve, 2500); /* safety */
  }

  const winAction = async fn => { try { await (NL()?.window?.[fn]?.() ?? 0); } catch { } };
  function bindWindow() {
    $('#btn-min').addEventListener('click', () => winAction('minimize'));
    $('#btn-max').addEventListener('click', () => winAction('maximize'));
    $('#btn-close').addEventListener('click', async () => { try { await NL()?.app?.exit?.(); } catch { window.close(); } });
    const tb = $('#titlebar');
    tb.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (e.target.closest('button, .conn-pill')) return;
      try { NL()?.window?.drag?.(); } catch { }
    });
    tb.addEventListener('dblclick', e => { if (!e.target.closest('button, .conn-pill')) winAction('maximize'); });
  }

  /* ---------------------------------------------------------- splash */
  const SPLASH_STEPS = [
    [0, 'igniting particle engine'],
    [16, 'warming webgl dither field'],
    [38, 'scanning local ollama models'],
    [61, 'charging reasoning cores'],
    [82, 'polishing photons'],
    [100, 'ready'],
  ];
  async function runSplash() {
    const fill = $('#splash-fill'), status = $('#splash-status');
    for (const [pct, label] of SPLASH_STEPS) {
      fill.style.width = pct + '%';
      status.textContent = label;
      await new Promise(r => setTimeout(r, 320 + Math.random() * 380));
    }
    await new Promise(r => setTimeout(r, 340));
    $('#splash').classList.add('out');
    $('#app').classList.remove('is-hidden');
    setTimeout(() => $('#splash').remove(), 700);
  }

  /* ---------------------------------------------------------- effects */
  function initEffects() {
    try {
      window.RS6Dither.createDither($('#dither-bg'), {
        waveSpeed: 0.042, waveFrequency: 2.6, waveAmplitude: 0.3,
        waveColor: '#5a4b9e', backgroundColor: '#050508',
        colorNum: 4, pixelSize: 3, ditherMode: 'bayer',
        scale: 1.35, contrast: 1.18, brightness: 0.0,
        mouseEffect: 'ripple', mouseRadius: 0.3, mouseStrength: 0.8,
        trail: 0.45, clickRipple: true, intro: true,
      });
    } catch (e) { console.warn('dither unavailable', e); }

    const mk = (root, opts) => {
      try { const s = new window.NebStar.StarBorder(root, opts); state.starList.push(s); return s; } catch { return null; }
    };
    mk($('#composer'), { color: '#a78bfa', trailColor: '#22d3ee', thickness: 1.5, glow: 0.6, trailLength: 0.3, stars: 1, duration: 5, radius: 18, sparkle: true });
    mk($('#btn-send'), { color: '#c4b5fd', trailColor: '#67e8f9', thickness: 1.5, glow: 0.7, trailLength: 0.34, stars: 1, duration: 4.6, radius: 14, bleed: 34 });
  }

  /* ---------------------------------------------------------- effort */
  function setEffort(v, persist = true) {
    v = Math.max(0, Math.min(100, Math.round(v)));
    state.effort = v;
    const e = v / 100;
    for (const s of state.starList) s?.setEffort?.(e);
    const slider = $('#effort');
    slider.value = v;
    slider.style.setProperty('--p', v + '%');
    const badge = $('#effort-badge');
    const mode = v < 34 ? 'fast' : v < 67 ? 'balanced' : 'deep';
    badge.textContent = mode;
    badge.classList.toggle('deep', v >= 67);
    const tok = Math.round(384 + (4096 - 384) * e);
    $('#token-note').innerHTML =
      `<span>budget ~${(tok / 1000).toFixed(1)}k tok</span>` +
      `<span>reasoning ${v >= 34 ? 'on' : 'off'}</span>` +
      `<span class="${toolsActive() ? '' : 'warn'}">tools ${toolsActive() ? 'on' : 'off'}</span>`;
    if (persist) store.set('effort', v);
  }
  const capsOf = name => state.caps.get(name) || [];
  function toolsActive() {
    return !!(state.ws.root && $('#ws-tools').checked && state.selected && capsOf(state.selected).includes('tools'));
  }

  /* ============================================================
     OLLAMA CLIENT
     ============================================================ */
  async function fetchT(url, opts = {}, ms = 6000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort('timeout'), ms);
    try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
    finally { clearTimeout(t); }
  }

  function friendlyError(status, body) {
    const b = String(body || '');
    if (status === 404 && /model/i.test(b)) return 'model not found — `ollama pull <name>` first';
    if (/think/i.test(b) && /not support/i.test(b)) return 'this model does not support reasoning (think)';
    if (status === 403 || status === 404) return 'ollama endpoint not found (is the server running?)';
    if (status >= 500) return 'ollama server error: ' + b.slice(0, 140);
    return b.slice(0, 160) || ('http ' + status);
  }

  async function apiGET(path) {
    const r = await fetchT(state.host + path, {}, 4500);
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }

  async function refresh(psOnly = false) {
    const [tags, ps] = await Promise.all([
      psOnly ? Promise.resolve(null) : apiGET('/api/tags'),
      apiGET('/api/ps').catch(() => ({ models: [] })),
    ]);
    if (tags) state.models = tags.models || [];
    const next = new Map((ps.models || []).map(m => [m.name, m]));
    const changed = next.size !== state.loaded.size ||
      [...next.keys()].some(k => !state.loaded.has(k));
    state.loaded = next;
    state.online = true;
    updateConn();
    if (!psOnly || changed) renderModels();
    if (changed) for (const n of state.loading) { /* finished loading? */ }
    return true;
  }

  function updateConn() {
    const pill = $('#conn-pill'), dot = $('#conn-dot'), txt = $('#conn-text');
    pill.classList.toggle('on', state.online);
    pill.classList.toggle('off', !state.online);
    dot.id = 'conn-dot';
    txt.textContent = state.online
      ? `ollama · ${state.models.length} model${state.models.length === 1 ? '' : 's'} · ${state.loaded.size} in memory`
      : 'ollama offline — run `ollama serve`';
    $('#models-foot').innerHTML = state.online
      ? `<span><b>${state.models.length}</b> local</span><span><b>${state.loaded.size}</b> in memory</span>`
      : 'no connection';
    $('#btn-refresh').classList.toggle('spin', !state.online);
  }

  async function connect() {
    try { await refresh(); }
    catch {
      state.online = false;
      updateConn();
    }
    clearInterval(state.retryTimer);
    if (!state.online) state.retryTimer = setInterval(() => { if (!state.online) refresh().catch(() => { }); }, 9000);
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => { if (state.online && !state.streaming) refresh(true).catch(() => { }); }, 12000);
  }

  /* ----- capabilities (/api/show) ----- */
  async function loadCaps(name) {
    if (state.caps.has(name)) return capsOf(name);
    try {
      const r = await fetchT(state.host + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name }) }, 6000);
      if (r.ok) {
        const j = await r.json();
        const caps = j.capabilities || (j.capabilities === undefined && j.details ? ['completion'] : []);
        state.caps.set(name, Array.isArray(caps) ? caps : []);
      } else state.caps.set(name, ['completion']);
    } catch { state.caps.set(name, ['completion']); }
    return capsOf(name);
  }

  /* ----- load / unload ----- */
  async function loadModel(name, card) {
    if (state.loading.has(name)) return;
    state.loading.add(name);
    renderModels();
    try {
      const r = await fetchT(state.host + '/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name, prompt: '', keep_alive: '1h', stream: false }),
      }, 20 * 60 * 1000);
      if (!r.ok) throw new Error(friendlyError(r.status, await r.text()));
      await r.json().catch(() => ({}));
      toast(name + ' loaded into memory', 'ok');
      await refresh(true);
    } catch (e) {
      toast('could not load ' + name + ': ' + e.message, 'err');
    } finally {
      state.loading.delete(name);
      renderModels();
    }
  }

  async function unloadModel(name) {
    try {
      await fetchT(state.host + '/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name, prompt: '', keep_alive: 0, stream: false }),
      }, 10000);
      toast(name + ' unloaded from memory', 'ok');
      await refresh(true);
    } catch (e) { toast('unload failed: ' + e.message, 'err'); }
  }

  async function selectModel(name) {
    state.selected = name;
    store.set('model', name);
    renderModels();
    $('#ctx-note').textContent = 'model: ' + name + (capsOf(name).includes('thinking') ? ' · reasoning-capable' : '');
    setEffort(state.effort, false);
    const caps = await loadCaps(name);
    if (state.selected === name) { renderModels(); setEffort(state.effort, false); }
    if (!state.loaded.has(name) && state.online && caps.includes('completion')) loadModel(name);
  }

  /* ----- model list UI ----- */
  function renderModels() {
    const list = $('#model-list');
    const q = ($('#model-search').value || '').toLowerCase();
    list.innerHTML = '';
    let idx = 0;
    for (const m of state.models) {
      if (q && !m.name.toLowerCase().includes(q)) continue;
      const caps = capsOf(m.name);
      const isLoaded = state.loaded.has(m.name);
      const isSel = state.selected === m.name;
      const busy = state.loading.has(m.name);
      const d = m.details || {};
      const card = el('div', 'model' + (isLoaded ? ' loaded' : '') + (isSel ? ' sel' : ''));
      card.style.animationDelay = (Math.min(idx++, 14) * 0.03) + 's';
      card.dataset.name = m.name;

      const badges = [
        caps.includes('thinking') ? 'reasoning' : '',
        caps.includes('tools') ? 'tools' : '',
        caps.includes('vision') ? 'vision' : '',
      ].filter(Boolean).map(b => `<span style="color:var(--acc-2)">· ${b}</span>`).join(' ');

      card.innerHTML = `
        <div class="model-top">
          <span class="m-dot"></span>
          <span class="model-name" title="${esc(m.name)}">${esc(m.name)}</span>
          <div class="m-actions">
            <button class="m-btn eject${isLoaded ? '' : ' is-hidden'}" title="unload from memory">unload</button>
            <button class="m-btn load${isLoaded || busy ? ' is-hidden' : ''}" title="load into memory">load</button>
          </div>
        </div>
        <div class="model-meta"><b>${esc(d.parameter_size || '?')}</b> · ${esc(d.quantization_level || '')} · ${fmtGB(m.size || 0)}${badges}</div>
        ${busy ? '<div class="m-loadbar"><i></i></div><div class="m-status">loading into memory…</div>' : ''}`;

      card.addEventListener('click', () => selectModel(m.name));
      card.querySelector('.load')?.addEventListener('click', e => { e.stopPropagation(); loadModel(m.name, card); });
      card.querySelector('.eject')?.addEventListener('click', e => { e.stopPropagation(); unloadModel(m.name); });
      list.appendChild(card);
    }
    if (state.online && state.models.length && state.selected && !state.models.some(m => m.name === state.selected)) {
      /* selected model vanished (e.g. deleted) */
      state.selected = null; store.del('model');
      $('#ctx-note').textContent = 'no model selected — pick one on the left';
    }
    $('#btn-send').toggleAttribute('disabled', !state.selected);
    updateConn();
  }

  /* ============================================================
     CHAT — streaming + tool loop
     ============================================================ */
  function systemPrompt() {
    let p = 'You are Nebula, a sharp, pragmatic AI assistant running fully locally on the user\'s machine through Ollama. Be concise, use markdown for code, and answer in the user\'s language.';
    if (state.ws.root) {
      p += `\n\nA workspace is attached: folder "${baseName(state.ws.root)}".`;
      p += '\nYou have tools to explore and edit it: list_files, read_file, write_file, search_files. Always use RELATIVE paths inside the workspace (never absolute). Read files before editing them, keep edits minimal, and write complete file contents with write_file.';
      const top = state.ws.treeCache;
      if (top && top.length) p += '\nTop-level entries: ' + top.slice(0, 80).join(', ');
    }
    return p;
  }

  function buildUserContent(text) {
    /* non-tool models get attached files inlined */
    const att = state.ws.attached || [];
    if (!att.length || toolsActive()) return text;
    let out = text + '\n\n--- attached context ---';
    let budget = 60000;
    for (const rel of att) {
      const data = state.ws.attachData?.get(rel);
      if (!data) continue;
      const block = `\n[${rel}]\n` + data.slice(0, Math.min(budget, 20000));
      budget -= block.length;
      out += block;
      if (budget <= 0) { out += '\n[context truncated]'; break; }
    }
    return out;
  }

  async function chatStream(body, onPart) {
    const ctrl = new AbortController();
    state.abort = ctrl;
    const r = await fetch(state.host + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(friendlyError(r.status, await r.text()));
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) { try { onPart(JSON.parse(line)); } catch { } }
      }
    }
  }

  const effortBody = () => {
    const e = state.effort / 100;
    const caps = capsOf(state.selected);
    const body = {
      model: state.selected,
      stream: true,
      options: {
        num_predict: Math.round(384 + (4096 - 384) * e),
        temperature: 0.62 + 0.22 * e,
      },
    };
    if (caps.includes('thinking') && state.effort >= 34) body.think = true;
    return body;
  };

  /* ============================================================
     TRANSCRIPT RENDERING
     ============================================================ */
  state.ws.attachData = new Map();

  const transcript = $('#transcript');
  let followScroll = true;
  transcript.addEventListener('scroll', () => {
    followScroll = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 90;
  });
  const scrollBottom = () => { if (followScroll) transcript.scrollTop = transcript.scrollHeight; };

  function addMsg(role, { content = '', thinking = '', meta = '' } = {}) {
    $('#empty')?.classList.add('is-hidden');
    const msg = el('div', 'msg ' + (role === 'user' ? 'user' : 'ai'));
    msg.appendChild(el('div', 'avatar', role === 'user' ? 'YOU' : ''));
    const bubble = el('div', 'bubble');
    const body = el('div', 'md');
    const toolsBox = el('div', 'tools');
    const metaEl = el('div', 'meta');
    if (meta) metaEl.innerHTML = meta;
    bubble.appendChild(body);
    bubble.appendChild(toolsBox);
    bubble.appendChild(metaEl);
    msg.appendChild(bubble);
    transcript.appendChild(msg);
    const out = { root: msg, bubble, body, toolsBox, metaEl, thinkEl: null, thinkBody: null };
    if (role === 'user') { body.innerHTML = NebulaMD.render(content); scrollBottom(); return out; }
    if (thinking) setThink(out, thinking);
    if (content) body.innerHTML = NebulaMD.render(content);
    return out;
  }

  function setThink(msg, text) {
    if (!msg.thinkEl) {
      msg.thinkEl = document.createElement('details');
      msg.thinkEl.className = 'think';
      msg.thinkEl.innerHTML = '<summary>reasoning</summary>';
      msg.thinkBody = el('div', 'think-body');
      msg.thinkEl.appendChild(msg.thinkBody);
      msg.bubble.prepend(msg.thinkEl);
    }
    msg.thinkBody.textContent = text;
    msg.thinkBody.scrollTop = msg.thinkBody.scrollHeight;
  }

  function addToolChip(msg, name, arg) {
    const chip = el('div', 'toolchip running',
      `<span class="nm">⚙ ${esc(name)}</span><span class="arg">${esc(arg || '')}</span><span class="st">…</span>`);
    msg.toolsBox.appendChild(chip);
    scrollBottom();
    return {
      done(ok, note) {
        chip.classList.remove('running');
        chip.classList.add(ok ? 'ok' : 'err');
        chip.querySelector('.st').textContent = ok ? '✓' : '✕';
        if (note) { chip.querySelector('.arg').textContent = note; chip.title = note; }
      },
    };
  }

  function setBusy(b) {
    state.streaming = b;
    const btn = $('#btn-send');
    btn.classList.toggle('busy', b);
    btn.querySelector('.plane').classList.toggle('is-hidden', b);
    btn.querySelector('.stop').classList.toggle('is-hidden', !b);
    btn.title = b ? 'stop (Esc)' : 'send (Enter)';
    if (!b) btn.toggleAttribute('disabled', !state.selected);
    if (b) btn.removeAttribute('disabled');
  }

  /* ----- persistence ----- */
  const persistChat = () => {
    const pretty = state.apiMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-40)
      .map(m => ({ role: m.role, content: m.content }));
    store.set('chat', pretty);
  };
  function restoreChat() {
    const saved = store.get('chat', []);
    if (!Array.isArray(saved) || !saved.length) return;
    for (const m of saved) {
      if (m.role === 'user') addMsg('user', { content: m.content });
      else if (m.role === 'assistant' && m.content) addMsg('ai', { content: m.content });
    }
    if (state.apiMessages.length === 0 && saved.length) {
      state.apiMessages = saved.map(m => ({ role: m.role, content: m.content }));
    }
  }

  /* ============================================================
     SEND + TOOL LOOP
     ============================================================ */
  async function send() {
    if (state.streaming) { state.abort?.abort('user'); return; }
    const ta = $('#input');
    const text = ta.value.trim();
    if (!text) return;
    if (!state.selected) { toast('pick a model on the left first', 'err'); switchPane('models'); return; }
    ta.value = ''; autogrow();
    addMsg('user', { content: text });
    state.apiMessages.push({ role: 'user', content: buildUserContent(text) });
    persistChat();
    await runTurn();
  }

  async function runTurn() {
    setBusy(true);
    const msg = addMsg('ai', {});
    let acc = '', accThink = '';
    let lastPaint = 0;
    const paint = () => {
      const now = performance.now();
      if (now - lastPaint < 55) return;
      lastPaint = now;
      msg.body.innerHTML = NebulaMD.render(acc) + '<span class="caret"></span>';
      scrollBottom();
    };
    const paintThink = () => { setThink(msg, accThink); scrollBottom(); };

    let stopped = false;
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let toolCalls = null, stats = null;
        const req = effortBody();
        req.messages = [{ role: 'system', content: systemPrompt() }, ...state.apiMessages];
        if (toolsActive()) req.tools = TOOLS_DEF;

        let attempt = 0;
        while (true) {
          try {
            await chatStream(req, part => {
              const m = part.message || {};
              if (m.thinking) { accThink += m.thinking; paintThink(); }
              if (m.content) { acc += m.content; paint(); }
              if (Array.isArray(m.tool_calls) && m.tool_calls.length) toolCalls = (toolCalls || []).concat(m.tool_calls);
              if (part.done) stats = part;
            });
            break;
          } catch (e) {
            const em = String(e && (e.message || e));
            if (e === 'user' || (e && e.name === 'AbortError')) { stopped = true; break; }
            if (/think/i.test(em) && /not support|doesn.t support/i.test(em) && req.think) {
              const caps = new Set(capsOf(state.selected)); caps.delete('thinking');
              state.caps.set(state.selected, [...caps]);
              delete req.think; continue;
            }
            if (/tools?/i.test(em) && /not support|doesn.t support|invalid/i.test(em) && req.tools) {
              delete req.tools; continue;
            }
            throw e;
          }
        }
        if (stopped) break;

        /* finalize this round */
        msg.body.innerHTML = NebulaMD.render(acc);
        if (stats) {
          const tps = stats.eval_count && stats.eval_duration ? (stats.eval_count / (stats.eval_duration / 1e9)).toFixed(1) : null;
          const secs = stats.total_duration ? (stats.total_duration / 1e9).toFixed(1) + 's' : '';
          msg.metaEl.innerHTML =
            `<span>${esc(state.selected)}</span>` +
            (tps ? `<span>⌁ ${tps} tok/s</span>` : '') +
            (stats.eval_count ? `<span>${stats.eval_count} tok</span>` : '') +
            (secs ? `<span>${secs}</span>` : '');
        }
        scrollBottom();

        if (toolCalls && toolCalls.length) {
          state.apiMessages.push({ role: 'assistant', content: acc, tool_calls: toolCalls });
          for (const call of toolCalls) {
            const name = call?.function?.name || 'unknown';
            let args = call?.function?.arguments ?? {};
            if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { path: args }; } }
            const chip = addToolChip(msg, name, args.path || args.query || '');
            let result;
            try { result = await execTool(name, args); chip.done(!/^ERROR/.test(result), result.split('\n')[0].slice(0, 60)); }
            catch (e) { result = 'ERROR: ' + (e.message || e); chip.done(false, String(result).slice(0, 60)); }
            state.apiMessages.push({ role: 'tool', content: result });
          }
          acc = ''; accThink = '';
          msg.body.insertAdjacentHTML('beforeend', '<div class="meta" style="margin-top:8px">working with tools…</div>');
          scrollBottom();
          continue; /* next round */
        }
        break;
      }
    } catch (e) {
      const em = e?.message || String(e);
      if (!stopped) {
        msg.body.innerHTML = NebulaMD.render(acc) +
          `<p style="color:var(--err)">✕ ${esc(em)}</p>`;
        toast(em, 'err');
      }
    } finally {
      msg.body.innerHTML = NebulaMD.render(acc || (stopped ? '*stopped.*' : acc));
      if (stopped) msg.metaEl.innerHTML += '<span style="color:var(--warn)">stopped</span>';
      const caret = msg.body.querySelector('.caret'); caret?.remove();
      if (state.apiMessages.length > 60) state.apiMessages.splice(0, state.apiMessages.length - 60);
      setBusy(false);
      persistChat();
      scrollBottom();
    }
  }

  /* ============================================================
     WORKSPACE (Neutralino fs)
     ============================================================ */
  function normRel(rel) {
    const parts = String(rel || '').replace(/\\/g, '/').split('/').filter(Boolean);
    const out = [];
    for (const p of parts) {
      if (p === '.') continue;
      if (p === '..') { out.pop(); continue; }
      out.push(p);
    }
    return out.join('/');
  }
  const absIn = rel => String(state.ws.root).replace(/[\\/]+$/, '') + '/' + normRel(rel);

  const fsReadDir = async p => {
    const n = NL();
    if (!n?.filesystem?.readDirectory) throw new Error('filesystem API unavailable');
    const r = await n.filesystem.readDirectory(p);
    return (r || []).filter(e => e.entry !== '.' && e.entry !== '..');
  };
  const fsRead = async p => { const r = await NL().filesystem.readFile(p); return String(r); };
  const fsWrite = async (p, c) => { await NL().filesystem.writeFile(p, c); };
  const fsMkdir = async p => { try { await NL().filesystem.createDirectory(p); } catch { } };
  const fsStats = async p => { try { return await NL().filesystem.getStats(p); } catch { return null; } };

  async function pickFolder() {
    try { return await NL()?.os?.showFolderDialog?.('Choose a workspace folder') || null; }
    catch { return null; }
  }
  async function pickFile() {
    try {
      const r = await NL()?.os?.showOpenDialog?.('Choose a file', {
        multiSelections: false, filters: [{ name: 'All files', extensions: ['*'] }],
      });
      return Array.isArray(r) ? r : null;
    } catch { return null; }
  }

  async function walk(dir, depth, out) {
    if (depth > 6 || out.length > 700) return;
    let entries = [];
    try { entries = await fsReadDir(dir); } catch { return; }
    entries.sort((a, b) => (a.type === b.type ? a.entry.localeCompare(b.entry) : a.type === 'DIRECTORY' ? -1 : 1));
    for (const e of entries) {
      if (out.length > 700) return;
      if (['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next', 'target'].includes(e.entry)) continue;
      const rel = normRel(dir === state.ws.root ? e.entry : normRel(dir).replace(normRel(state.ws.root) + '/', '') + '/' + e.entry);
      const isDir = e.type === 'DIRECTORY';
      out.push({ rel, name: e.entry, dir: isDir, depth });
      if (isDir) await walk(dir + '/' + e.entry, depth + 1, out);
    }
  }

  async function rebuildTree() {
    if (!state.ws.root) return;
    const out = [];
    await walk(state.ws.root, 0, out);
    state.ws.tree = out;
    state.ws.treeCache = [...new Set(out.filter(n => n.depth === 0).map(n => n.name + (n.dir ? '/' : '')))];
    updateWsUI();
  }

  async function setRoot(root) {
    state.ws.root = root;
    state.ws.attached = [];
    state.ws.attachData.clear();
    if (root) { store.set('wsroot', root); await rebuildTree(); toast('workspace attached: ' + baseName(root), 'ok'); }
    else { store.del('wsroot'); state.ws.tree = []; state.ws.treeCache = null; updateWsUI(); }
    setEffort(state.effort, false);
  }

  async function toggleAttach(rel) {
    const att = state.ws.attached;
    const i = att.indexOf(rel);
    if (i >= 0) { att.splice(i, 1); state.ws.attachData.delete(rel); }
    else {
      try {
        let content = await fsRead(absIn(rel));
        if (content.includes('\u0000')) { toast('binary file — skipped: ' + rel, 'err'); return; }
        if (content.length > 200000) content = content.slice(0, 200000) + '\n…[truncated]';
        att.push(rel); state.ws.attachData.set(rel, content);
        toast('attached: ' + rel, 'ok', 2200);
      } catch (e) { toast('read failed: ' + e.message, 'err'); return; }
    }
    updateWsUI();
  }

  function updateWsUI() {
    const rootEl = $('#ws-root'), treeEl = $('#ws-tree');
    rootEl.classList.toggle('has', !!state.ws.root);
    rootEl.textContent = state.ws.root ? state.ws.root : '';
    /* tree */
    treeEl.innerHTML = '';
    if (!state.ws.root) {
      treeEl.innerHTML = `<div class="ws-empty"><div class="ws-empty-orb"></div><p>attach a folder or file and the<br/>AI can read &amp; edit inside it</p></div>`;
    } else {
      const nodes = state.ws.tree || [];
      for (const n of nodes) {
        const node = el('div', 'ws-node ' + (n.dir ? 'dir' : 'file') + (state.ws.attached.includes(n.rel) ? ' attached' : ''));
        node.style.setProperty('--d', n.depth);
        node.innerHTML = `<span class="caret">${n.dir ? '▶' : ''}</span><span class="ftype"></span><span class="nm">${esc(n.name)}</span>${n.dir ? '' : '<span class="pin">attach</span>'}`;
        node.addEventListener('click', () => {
          if (n.dir) {
            const open = node.classList.toggle('open');
            const kids = treeEl.querySelectorAll(`.ws-node[data-under="${CSS.escape(n.rel)}"], .ws-node[data-under="${n.rel.replace(/"/g, '\\"')}"]`);
            kids.forEach(k => k.classList.toggle('is-hidden', !open));
          } else toggleAttach(n.rel);
        });
        node.dataset.under = n.rel.split('/').slice(0, -1).join('/');
        treeEl.appendChild(node);
      }
      if (!nodes.length) treeEl.innerHTML = '<div class="ws-empty"><p>folder is empty</p></div>';
    }
    /* chips */
    const chips = $('#chips');
    chips.innerHTML = '';
    for (const rel of state.ws.attached) {
      const c = el('div', 'fchip', `<span>📎 ${esc(rel)}</span><span class="x">✕</span>`);
      c.querySelector('.x').addEventListener('click', () => toggleAttach(rel));
      chips.appendChild(c);
    }
    setEffort(state.effort, false);
  }

  /* ----- tool execution ----- */
  const TEXT_EXT = new Set('txt md markdown json js jsx ts tsx py rb go rs java c h cpp hpp cs html css scss yml yaml toml ini cfg sh bat ps1 sql xml svg vue svelte lua php kt swift gradle lock env gitignore log csv'.split(' '));

  async function execTool(name, args = {}) {
    if (!state.ws.root) return 'ERROR: no workspace attached. Ask the user to attach one first.';
    if (name === 'list_files') {
      const rel = normRel(args.path || '');
      try {
        const entries = await fsReadDir(absIn(rel));
        entries.sort((a, b) => (a.type === b.type ? a.entry.localeCompare(b.entry) : a.type === 'DIRECTORY' ? -1 : 1));
        if (!entries.length) return '(empty folder)';
        return entries.map(e => (e.type === 'DIRECTORY' ? '[dir]  ' : '- ') + e.entry).join('\n');
      } catch (e) { return 'ERROR: cannot list "' + rel + '": ' + (e.message || e); }
    }
    if (name === 'read_file') {
      const rel = normRel(args.path || '');
      if (!rel) return 'ERROR: path required';
      try {
        const st = await fsStats(absIn(rel));
        if (st && st.size > 400000) return 'ERROR: file too large (' + fmtGB(st.size) + ') — read it in parts or search instead.';
        let content = await fsRead(absIn(rel));
        if (content.includes('\u0000')) return 'ERROR: binary file, cannot read as text.';
        if (content.length > 150000) content = content.slice(0, 150000) + '\n…[truncated]';
        return content || '(empty file)';
      } catch (e) { return 'ERROR: cannot read "' + rel + '": ' + (e.message || e); }
    }
    if (name === 'write_file') {
      const rel = normRel(args.path || '');
      const content = String(args.content ?? '');
      if (!rel) return 'ERROR: path required';
      if (rel.startsWith('..') || normRel(rel) === '') return 'ERROR: invalid path';
      try {
        const abs = absIn(rel);
        const parts = abs.split('/');
        parts.pop();
        let cur = parts[0];
        for (let i = 1; i < parts.length; i++) { cur += '/' + parts[i]; await fsMkdir(cur); }
        await fsWrite(abs, content);
        return 'OK: wrote ' + content.length + ' bytes to ' + rel;
      } catch (e) { return 'ERROR: cannot write "' + rel + '": ' + (e.message || e); }
    }
    if (name === 'search_files') {
      const q = String(args.query ?? '').toLowerCase();
      if (!q) return 'ERROR: query required';
      const files = (state.ws.tree || []).filter(n => !n.dir).slice(0, 500);
      const hits = [];
      for (const f of files) {
        if (hits.length >= 60) break;
        try {
          const content = await fsRead(absIn(f.rel));
          if (content.includes('\u0000') || content.length > 800000) continue;
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              hits.push(`${f.rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
              if (hits.length >= 60) break;
            }
          }
        } catch { }
      }
      return hits.length ? hits.join('\n') : `no matches for "${q}"`;
    }
    return 'ERROR: unknown tool "' + name + '"';
  }

  /* ============================================================
     UI WIRING + BOOT
     ============================================================ */
  function switchPane(which) {
    $$('.stab').forEach(b => b.classList.toggle('active', b.dataset.pane === which));
    $$('.side-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + which));
  }

  function autogrow() {
    const ta = $('#input');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
  }

  function bindUI() {
    $$('.stab').forEach(b => b.addEventListener('click', () => switchPane(b.dataset.pane)));
    $('#model-search').addEventListener('input', renderModels);
    $('#btn-refresh').addEventListener('click', connect);
    $('#conn-pill').addEventListener('click', connect);

    $('#btn-ws-folder').addEventListener('click', async () => {
      const p = await pickFolder();
      if (p) setRoot(p);
    });
    $('#btn-ws-file').addEventListener('click', async () => {
      const arr = await pickFile();
      if (arr && arr[0]) {
        await setRoot(arr[0].replace(/[\\/][^\\/]+$/, ''));
        await rebuildTree();
        await toggleAttach(baseName(arr[0]));
      }
    });
    $('#btn-ws-clear').addEventListener('click', () => setRoot(null));
    $('#ws-tools').addEventListener('change', () => {
      setEffort(state.effort, false);
      if (state.ws.root && !toolsActive()) {
        const caps = capsOf(state.selected || '');
        if (state.selected && !caps.includes('tools')) toast('current model has no tool support — attached files will be inlined instead', '', 5000);
      }
    });
    $('#btn-attach').addEventListener('click', () => { switchPane('workspace'); toast('choose a folder or file in the workspace tab', '', 2600); });

    const ta = $('#input');
    ta.addEventListener('input', autogrow);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      if (e.key === 'Escape' && state.streaming) state.abort?.abort('user');
    });
    $('#btn-send').addEventListener('click', send);
    $('#effort').addEventListener('input', e => setEffort(+e.target.value));

    $$('.sug').forEach(s => s.addEventListener('click', () => {
      ta.value = s.textContent.trim(); autogrow(); ta.focus();
    }));

    transcript.addEventListener('click', e => {
      const btn = e.target.closest('.code-copy');
      if (!btn) return;
      const code = btn.closest('pre')?.querySelector('code');
      if (!code) return;
      const text = code.textContent;
      const finish = ok => { btn.textContent = ok ? 'copied' : 'failed'; setTimeout(() => (btn.textContent = 'copy'), 1400); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => finish(true), () => finish(legacyCopy(text)));
      else finish(legacyCopy(text));
    });
  }

  function legacyCopy(text) {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { }
    t.remove(); return ok;
  }

  async function boot() {
    initNL();
    await nlReady;
    bindWindow();
    bindUI();
    initEffects();
    state.effort = store.get('effort', 42);
    setEffort(state.effort, false);
    state.selected = store.get('model', null);
    restoreChat();
    updateWsUI();
    const savedRoot = store.get('wsroot', null);
    if (savedRoot) {
      state.ws.root = savedRoot;
      rebuildTree().catch(() => { store.del('wsroot'); });
    }
    if (state.selected) loadCaps(state.selected).then(() => { renderModels(); setEffort(state.effort, false); });
    await runSplash();
    connect();
    if (state.selected) {
      const caps = capsOf(state.selected);
      $('#ctx-note').textContent = 'model: ' + state.selected;
      if (!state.loaded.has(state.selected) && caps.includes('completion')) { /* auto-load after first refresh */ }
    }
  }

  boot();
})();

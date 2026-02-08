/* ============================================================
   Chat – Message Rendering & Input Handling
   ============================================================ */

const Chat = {
  /** Configure marked.js, mermaid, and KaTeX */
  init() {
    // Mermaid config
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          darkMode: true,
          background: '#1f1f1f',
          primaryColor: '#87a9ff',
          primaryTextColor: '#d4d4d4',
          lineColor: '#555',
        },
      });
    }

    const renderer = new marked.Renderer();

    // Custom code block rendering — handles mermaid + syntax highlighting
    renderer.code = function ({ text, lang }) {
      // Mermaid diagrams
      if (lang === 'mermaid') {
        const id = 'mermaid-' + Math.random().toString(36).slice(2, 10);
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div class="mermaid-container" data-mermaid-id="${id}" data-mermaid-src="${encodeURIComponent(text)}"><pre class="mermaid-fallback"><code>${escaped}</code></pre></div>`;
      }

      const language = lang || 'plaintext';
      let highlighted;
      try {
        highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
      } catch {
        highlighted = hljs.highlightAuto(text).value;
      }
      return `
        <div class="code-block-wrapper">
          <div class="code-block-header">
            <div class="code-block-lang">
              <span class="material-symbols-outlined">code</span>
              <span>${language}</span>
            </div>
            <div class="code-block-actions">
              <button onclick="Chat.downloadCode(this, '${language}')" title="Download">
                <span class="material-symbols-outlined">download</span>
              </button>
              <button onclick="Chat.copyCode(this)" title="Copy code">
                <span class="material-symbols-outlined">content_copy</span>
              </button>
              <button onclick="Chat.toggleCodeBlock(this)" title="Collapse">
                <span class="material-symbols-outlined">expand_less</span>
              </button>
            </div>
          </div>
          <pre><code class="hljs language-${language}" data-raw="${encodeURIComponent(text)}">${highlighted}</code></pre>
        </div>`;
    };

    marked.setOptions({
      renderer,
      breaks: true,
      gfm: true,
    });
  },

  /** Process LaTeX in an HTML string — call AFTER marked but BEFORE inserting into DOM */
  _renderLatex(html) {
    if (typeof katex === 'undefined') return html;

    // 1. Protect <pre>…</pre> and <code>…</code> blocks from LaTeX processing
    const protected = [];
    html = html.replace(/<(pre|code)([\s\S]*?)>[\s\S]*?<\/\1>/gi, (match) => {
      const idx = protected.length;
      protected.push(match);
      return `\x00PROTECT${idx}\x00`;
    });

    // Helper: strip <br> / <br/> tags that marked injects into multi-line math
    const clean = (tex) => tex.replace(/<br\s*\/?>/gi, '\n').trim();

    // 2. Display math: $$...$$ and \[...\]
    html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
      try { return katex.renderToString(clean(tex), { displayMode: true, throwOnError: false }); }
      catch { return `<span class="katex-error">$$${tex}$$</span>`; }
    });
    html = html.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => {
      try { return katex.renderToString(clean(tex), { displayMode: true, throwOnError: false }); }
      catch { return `<span class="katex-error">\\[${tex}\\]</span>`; }
    });

    // 3. Inline math: $...$ (but not $$) and \(...\)
    html = html.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_, tex) => {
      try { return katex.renderToString(clean(tex), { displayMode: false, throwOnError: false }); }
      catch { return `<span class="katex-error">$${tex}$</span>`; }
    });
    html = html.replace(/\\\((.+?)\\\)/g, (_, tex) => {
      try { return katex.renderToString(clean(tex), { displayMode: false, throwOnError: false }); }
      catch { return `<span class="katex-error">\\(${tex}\\)</span>`; }
    });

    // 4. Restore protected blocks
    html = html.replace(/\x00PROTECT(\d+)\x00/g, (_, i) => protected[+i]);

    return html;
  },

  /** Render mermaid diagrams in the DOM (call after innerHTML is set) */
  _renderMermaidInContainer(container) {
    if (typeof mermaid === 'undefined') return;
    container.querySelectorAll('.mermaid-container').forEach(async (el) => {
      const src = decodeURIComponent(el.dataset.mermaidSrc || '');
      const id = el.dataset.mermaidId;
      if (!src) return;
      try {
        const { svg } = await mermaid.render(id, src);
        el.innerHTML = svg;
      } catch {
        // Parse failed — keep the fallback code block visible
      }
    });
  },

  /** Render all messages for the current chat */
  render() {
    const container = document.getElementById('chat-messages');
    const emptyState = document.getElementById('empty-state');

    if (!App.currentChat || App.currentChat.messages.length === 0) {
      this.renderEmpty();
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // Build message HTML
    let html = '';
    for (let i = 0; i < App.currentChat.messages.length; i++) {
      const msg = App.currentChat.messages[i];
      const prev = i > 0 ? App.currentChat.messages[i - 1] : null;
      const showLabel = !prev || prev.role !== msg.role;
      html += this.renderTurn(msg, showLabel);
    }
    container.innerHTML = html;

    // Render mermaid diagrams
    this._renderMermaidInContainer(container);

    // Generate video thumbnails in chat messages
    this._generateChatVideoThumbnails(container);

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  },

  renderEmpty() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    const emptyState = document.createElement('div');
    emptyState.id = 'empty-state';
    emptyState.className = 'empty-state';
    emptyState.innerHTML = '<span class="material-symbols-outlined empty-icon">chat_bubble_outline</span><p>Start a conversation</p>';
    container.appendChild(emptyState);
  },

  /** Render a single chat turn */
  renderTurn(msg, showLabel = true) {
    const isUser = msg.role === 'user';
    const roleLabel = isUser ? 'User' : 'Model';
    const labelClass = isUser ? 'user-label' : '';
    const continuationClass = showLabel ? '' : ' continuation';

    const hasContent = msg.content && msg.content.trim().length > 0;
    let contentHtml = '';
    if (isUser) {
      if (hasContent) contentHtml = `<div class="markdown-content user-text">${this._renderLatex(marked.parse(msg.content))}</div>`;
    } else {
      contentHtml = this.renderModelContent(msg);
    }

    // Sparkle SVG for rerun button
    const sparkleSvg = `<svg class="rerun-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="sparkle-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#87A9FF"/>
        <stop offset="44%" stop-color="#A7B8EE"/>
        <stop offset="88%" stop-color="#F1DCC7"/>
      </linearGradient></defs>
      <path d="M10 2 L12 8 L18 10 L12 12 L10 18 L8 12 L2 10 L8 8 Z" fill="url(#sparkle-grad)"/>
    </svg>`;

    const filesHtml = this.renderFileAttachments(msg.files, App.currentChat?.id, msg.id);
    const labelHtml = showLabel ? `<div class="turn-role-label ${labelClass}">${roleLabel}</div>` : '';
    const branchNavHtml = this.renderBranchNavigator(msg.id);

    return `
      <div class="chat-turn${continuationClass}" data-msg-id="${msg.id}">
        ${labelHtml}
        <div class="turn-content">
          ${filesHtml}
          ${contentHtml}
          ${branchNavHtml}
          <div class="turn-actions">
            <button class="turn-action-btn" onclick="Chat.startEdit('${msg.id}')" title="Edit">
              <span class="material-symbols-outlined">edit</span>
            </button>
            <button class="turn-action-btn" onclick="Chat.rerunFrom('${msg.id}')" title="Rerun (overwrite)">
              ${sparkleSvg}
            </button>
            <button class="turn-action-btn" onclick="Chat.branchRerunFrom('${msg.id}')" title="Branch + rerun">
              <span class="material-symbols-outlined">fork_right</span>
            </button>
            <button class="turn-action-btn" onclick="Chat.showTurnMenu(event, '${msg.id}')" title="More options">
              <span class="material-symbols-outlined">more_vert</span>
            </button>
          </div>
        </div>
      </div>`;
  },

  renderBranchNavigator(anchorId) {
    const point = App.getBranchPoint(anchorId);
    if (!point || point.branches.length <= 1) return '';
    const current = point.active + 1;
    const total = point.branches.length;
    const canPrev = point.active > 0;
    const canNext = point.active < total - 1;
    return `
      <div class="branch-nav">
        <button class="branch-nav-btn" ${canPrev ? '' : 'disabled'} onclick="Chat.shiftBranch('${anchorId}', -1)" title="Previous branch">&lt;</button>
        <span class="branch-nav-label">${current} / ${total}</span>
        <button class="branch-nav-btn" ${canNext ? '' : 'disabled'} onclick="Chat.shiftBranch('${anchorId}', 1)" title="Next branch">&gt;</button>
        <button class="branch-delete-btn" onclick="Chat.confirmDeleteBranch('${anchorId}')" title="Delete current branch">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>`;
  },

  /** Render model message content (with optional thoughts) */
  renderModelContent(msg) {
    let html = '';

    // Thoughts section — collapsed by default, with preview snippet
    if (msg.thoughts) {
      const preview = msg.thoughts.replace(/\n/g, ' ').substring(0, 80) + (msg.thoughts.length > 80 ? '...' : '');
      html += `
        <div class="thoughts-section" onclick="Chat.toggleThoughts(this)">
          <div class="thoughts-header">
            <svg class="thoughts-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs><linearGradient id="think-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#87A9FF"/>
                <stop offset="50%" stop-color="#A7B8EE"/>
                <stop offset="100%" stop-color="#F1DCC7"/>
              </linearGradient></defs>
              <path d="M10 2 L12 8 L18 10 L12 12 L10 18 L8 12 L2 10 L8 8 Z" fill="url(#think-grad)"/>
            </svg>
            <span class="thoughts-label">Thoughts</span>
            <span class="thoughts-summary">${this.escapeHtml(preview)}</span>
            <span class="material-symbols-outlined thoughts-expand-icon">expand_more</span>
          </div>
          <div class="thoughts-body">
            <div class="markdown-content">${this._renderLatex(marked.parse(msg.thoughts))}</div>
          </div>
        </div>`;
    }

    // Main content
    html += `<div class="markdown-content">${this._renderLatex(marked.parse(msg.content))}</div>`;
    return html;
  },

  /** Toggle thoughts section */
  toggleThoughts(el) {
    // Don't toggle if clicking inside the body content
    el.classList.toggle('expanded');
  },

  /** Download code from a code block */
  downloadCode(btn, lang) {
    const wrapper = btn.closest('.code-block-wrapper');
    const codeEl = wrapper.querySelector('code');
    const raw = decodeURIComponent(codeEl.dataset.raw);
    const extMap = {
      python: 'py', javascript: 'js', typescript: 'ts', jsx: 'jsx', tsx: 'tsx',
      bash: 'sh', shell: 'sh', zsh: 'sh', bat: 'bat', powershell: 'ps1',
      html: 'html', css: 'css', scss: 'scss', json: 'json', xml: 'xml',
      yaml: 'yaml', yml: 'yml', toml: 'toml', markdown: 'md',
      sql: 'sql', java: 'java', kotlin: 'kt', go: 'go', rust: 'rs',
      ruby: 'rb', php: 'php', swift: 'swift', dart: 'dart', lua: 'lua',
      c: 'c', cpp: 'cpp', csharp: 'cs', r: 'r', perl: 'pl',
      dockerfile: 'dockerfile', makefile: 'makefile',
    };
    const ext = extMap[lang] || lang || 'txt';
    const blob = new Blob([raw], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const uid = crypto.randomUUID().slice(0, 6);
    a.download = `code-${uid}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** Copy code from a code block */
  copyCode(btn) {
    const wrapper = btn.closest('.code-block-wrapper');
    const codeEl = wrapper.querySelector('code');
    const raw = decodeURIComponent(codeEl.dataset.raw);
    navigator.clipboard.writeText(raw).then(() => {
      const icon = btn.querySelector('.material-symbols-outlined');
      icon.textContent = 'check';
      setTimeout(() => icon.textContent = 'content_copy', 1500);
    });
  },

  /** Toggle code block collapse */
  toggleCodeBlock(btn) {
    const wrapper = btn.closest('.code-block-wrapper');
    const pre = wrapper.querySelector('pre');
    const icon = btn.querySelector('.material-symbols-outlined');
    if (pre.style.display === 'none') {
      pre.style.display = '';
      icon.textContent = 'expand_less';
    } else {
      pre.style.display = 'none';
      icon.textContent = 'expand_more';
    }
  },

  /** Show turn context menu */
  showTurnMenu(event, msgId) {
    event.stopPropagation();
    const menu = document.getElementById('context-menu');
    menu.style.display = 'block';

    const rect = event.target.closest('button').getBoundingClientRect();
    menu.style.left = rect.right + 'px';
    menu.style.top = rect.top + 'px';

    // Reposition if off-screen
    requestAnimationFrame(() => {
      const menuRect = menu.getBoundingClientRect();
      if (menuRect.right > window.innerWidth) {
        menu.style.left = (rect.left - menuRect.width) + 'px';
      }
      if (menuRect.bottom > window.innerHeight) {
        menu.style.top = (window.innerHeight - menuRect.height - 8) + 'px';
      }
    });

    // Bind actions
    menu.querySelectorAll('.context-menu-item').forEach(item => {
      const newItem = item.cloneNode(true);
      item.replaceWith(newItem);

      newItem.addEventListener('click', () => {
        menu.style.display = 'none';
        const action = newItem.dataset.action;
        this.handleTurnAction(action, msgId);
      });
    });
  },

  handleTurnAction(action, msgId) {
    const msg = App.currentChat?.messages.find(m => m.id === msgId);
    if (!msg) return;

    switch (action) {
      case 'delete':
        App.deleteMessage(msgId);
        break;
      case 'copy-text':
        navigator.clipboard.writeText(msg.content);
        break;
      case 'copy-md':
        navigator.clipboard.writeText(msg.content);
        break;
      case 'branch':
        this.branchRerunFrom(msgId);
        break;
    }
  },

  _resolveRerunAnchorIndex(msgId) {
    const messages = App.currentChat?.messages || [];
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1) return -1;
    const msg = messages[idx];
    if (msg.role === 'model' || msg.role === 'assistant') {
      return idx - 1; // rerun response after the previous prompt context
    }
    // For user messages, include contiguous user block (files + text turns)
    let endIdx = idx;
    while (endIdx + 1 < messages.length && messages[endIdx + 1].role === 'user') {
      endIdx++;
    }
    return endIdx;
  },

  _ensureBranchPoint(anchorId) {
    const branchState = App._ensureBranchState();
    if (branchState[anchorId]) return branchState[anchorId];
    const anchorIdx = App.currentChat.messages.findIndex(m => m.id === anchorId);
    const oldTail = anchorIdx >= 0 ? App._clone(App.currentChat.messages.slice(anchorIdx + 1)) : [];
    branchState[anchorId] = {
      active: 0,
      branches: [{ id: crypto.randomUUID(), tail: oldTail }],
    };
    return branchState[anchorId];
  },

  /** Rerun (overwrite current continuation) */
  rerunFrom(msgId) {
    if (!App.currentChat || App.isGenerating) return;
    const anchorIdx = this._resolveRerunAnchorIndex(msgId);
    if (anchorIdx < 0) return;
    const anchor = App.currentChat.messages[anchorIdx];
    const anchorId = anchor.id;
    const point = this._ensureBranchPoint(anchorId);

    // Trim to prefix; generation will rebuild active branch tail.
    App.currentChat.messages = App.currentChat.messages.slice(0, anchorIdx + 1);
    point.branches[point.active].tail = [];
    App.pendingRerunContext = { anchorId, mode: 'overwrite' };

    App.saveChat().then(() => {
      Chat.render();
      App.updateTokenCount();
      App.generateResponse();
    });
  },

  /** Branch + rerun (create sibling branch and generate there) */
  branchRerunFrom(msgId) {
    if (!App.currentChat || App.isGenerating) return;
    const anchorIdx = this._resolveRerunAnchorIndex(msgId);
    if (anchorIdx < 0) return;
    const anchor = App.currentChat.messages[anchorIdx];
    const anchorId = anchor.id;
    const point = this._ensureBranchPoint(anchorId);

    const newBranchId = crypto.randomUUID();
    point.branches.push({ id: newBranchId, tail: [] });
    point.active = point.branches.length - 1;

    App.currentChat.messages = App.currentChat.messages.slice(0, anchorIdx + 1);
    App.pendingRerunContext = { anchorId, mode: 'branch', createdBranchId: newBranchId };

    App.saveChat().then(() => {
      Chat.render();
      App.updateTokenCount();
      App.generateResponse();
    });
  },

  shiftBranch(anchorId, delta) {
    if (!App.currentChat || App.isGenerating) return;
    const point = App.getBranchPoint(anchorId);
    if (!point) return;
    const next = point.active + delta;
    if (next < 0 || next >= point.branches.length) return;
    point.active = next;
    const anchorIdx = App.currentChat.messages.findIndex(m => m.id === anchorId);
    if (anchorIdx === -1) return;
    const tail = App._clone(point.branches[point.active].tail || []);
    App.currentChat.messages = [
      ...App.currentChat.messages.slice(0, anchorIdx + 1),
      ...tail,
    ];
    App.saveChat().then(() => {
      Chat.render();
      App.updateTokenCount();
    });
  },

  confirmDeleteBranch(anchorId) {
    const point = App.getBranchPoint(anchorId);
    if (!point || point.branches.length <= 1) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal branch-delete-modal">
        <div class="modal-header">
          <h3>Delete branch?</h3>
          <button class="icon-btn icon-btn-sm" data-close>
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="modal-body">
          <p>This will remove branch ${point.active + 1} of ${point.branches.length}.</p>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" data-close>Cancel</button>
          <button class="btn-primary" data-confirm>Delete</button>
        </div>
      </div>`;

    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-confirm]').addEventListener('click', () => {
      close();
      this.deleteActiveBranch(anchorId);
    });
    document.body.appendChild(overlay);
  },

  deleteActiveBranch(anchorId) {
    const point = App.getBranchPoint(anchorId);
    if (!point || point.branches.length <= 1) return;
    const deleteIdx = point.active;
    point.branches.splice(deleteIdx, 1);
    point.active = Math.max(0, deleteIdx - 1);
    const anchorIdx = App.currentChat.messages.findIndex(m => m.id === anchorId);
    if (anchorIdx !== -1) {
      const tail = App._clone(point.branches[point.active].tail || []);
      App.currentChat.messages = [
        ...App.currentChat.messages.slice(0, anchorIdx + 1),
        ...tail,
      ];
    }
    App.saveChat().then(() => {
      Chat.render();
      App.updateTokenCount();
    });
  },

  /** Start editing a message */
  startEdit(msgId) {
    const turn = document.querySelector(`.chat-turn[data-msg-id="${msgId}"]`);
    if (!turn) return;
    const msg = App.currentChat?.messages.find(m => m.id === msgId);
    if (!msg) return;

    const content = turn.querySelector('.turn-content');
    const originalHtml = content.innerHTML;

    content.classList.add('editing');
    content.innerHTML = `
      <textarea class="turn-edit-textarea">${this.escapeHtml(msg.content)}</textarea>
      <div class="turn-edit-actions">
        <button class="btn-stop-edit" onclick="Chat.stopEdit('${msgId}', this)">Stop editing</button>
      </div>`;

    const textarea = content.querySelector('textarea');
    textarea.focus();
    textarea.style.height = textarea.scrollHeight + 'px';
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    });
  },

  /** Stop editing, save changes */
  stopEdit(msgId, btn) {
    const turn = document.querySelector(`.chat-turn[data-msg-id="${msgId}"]`);
    if (!turn) return;
    const textarea = turn.querySelector('.turn-edit-textarea');
    if (textarea) {
      const newContent = textarea.value;
      App.updateMessage(msgId, newContent);
    }
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /* ---- Streaming helpers ---- */

  _pendingStream: null,
  _streamRenderTimer: null,
  _userScrolledUp: false,
  _programmaticScroll: false,
  _scrollHandler: null,

  /** Append a placeholder model turn for streaming */
  appendStreamingTurn(msgId) {
    const container = document.getElementById('chat-messages');
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';

    // Reset scroll tracking for this generation
    this._userScrolledUp = false;
    this._setupScrollListener();

    const turnHtml = `
      <div class="chat-turn" data-msg-id="${msgId}">
        <div class="turn-role-label">Model</div>
        <div class="turn-content">
          <div class="streaming-content">
            <span class="streaming-cursor"></span>
          </div>
        </div>
      </div>`;
    container.insertAdjacentHTML('beforeend', turnHtml);
    this.scrollToBottom();
  },

  /** Queue a streaming content update (throttled to ~80ms) */
  updateStreamingContent(msgId, content, thoughts) {
    this._pendingStream = { msgId, content, thoughts };
    if (this._streamRenderTimer) return;
    this._flushStreamRender();
    this._streamRenderTimer = setTimeout(() => {
      this._streamRenderTimer = null;
      this._flushStreamRender();
    }, 80);
  },

  _flushStreamRender() {
    if (!this._pendingStream) return;
    const { msgId, content, thoughts } = this._pendingStream;
    this._pendingStream = null;

    const turn = document.querySelector(`.chat-turn[data-msg-id="${msgId}"]`);
    if (!turn) return;
    const area = turn.querySelector('.streaming-content');
    if (!area) return;

    // Preserve expanded state if user already toggled it
    const existingThoughts = area.querySelector('.thoughts-section');
    const isExpanded = existingThoughts ? existingThoughts.classList.contains('expanded') : false;

    let html = '';
    if (thoughts) {
      // Show the tail of thoughts so the preview visibly changes during streaming
      const stripped = thoughts.replace(/\n/g, ' ');
      const preview = stripped.length > 80
        ? '...' + stripped.substring(stripped.length - 80)
        : stripped;
      html += `
        <div class="thoughts-section${isExpanded ? ' expanded' : ''}" onclick="Chat.toggleThoughts(this)">
          <div class="thoughts-header">
            <svg class="thoughts-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs><linearGradient id="think-grad-s" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#87A9FF"/>
                <stop offset="50%" stop-color="#A7B8EE"/>
                <stop offset="100%" stop-color="#F1DCC7"/>
              </linearGradient></defs>
              <path d="M10 2 L12 8 L18 10 L12 12 L10 18 L8 12 L2 10 L8 8 Z" fill="url(#think-grad-s)"/>
            </svg>
            <span class="thoughts-label">Thinking</span>
            <span class="thoughts-summary">${this.escapeHtml(preview)}</span>
            <span class="material-symbols-outlined thoughts-expand-icon">expand_more</span>
          </div>
          <div class="thoughts-body">
            <div class="markdown-content">${this._renderLatex(marked.parse(thoughts))}</div>
          </div>
        </div>`;
    }

    if (content) {
      html += `<div class="markdown-content">${this._renderLatex(marked.parse(content))}</div>`;
    } else if (!thoughts) {
      html += '<span class="streaming-cursor"></span>';
    }

    area.innerHTML = html;
    this._renderMermaidInContainer(area);
    this.scrollToBottom();
  },

  /** Show an error inside the streaming bubble */
  showStreamingError(msgId, message) {
    const turn = document.querySelector(`.chat-turn[data-msg-id="${msgId}"]`);
    if (!turn) return;
    const area = turn.querySelector('.streaming-content');
    if (!area) return;
    area.innerHTML = `<div class="streaming-error"><span class="material-symbols-outlined">error</span> ${this.escapeHtml(message)}</div>`;
    this.scrollToBottom();
  },

  /** Toggle Run/Stop button and disable textarea while generating */
  setGeneratingUI(isGenerating) {
    const textarea = document.getElementById('prompt-input');
    const runBtn = document.getElementById('btn-run');
    textarea.disabled = isGenerating;
    if (isGenerating) {
      runBtn.innerHTML = '<span class="run-btn-label">Stop</span><span class="material-symbols-outlined">stop</span>';
      runBtn.classList.add('stop-btn');
    } else {
      runBtn.innerHTML = '<span class="run-btn-label">Run</span><span class="material-symbols-outlined">keyboard_return</span>';
      runBtn.classList.remove('stop-btn');
    }
  },

  /** Clean up streaming render state */
  finalizeStreaming() {
    this._pendingStream = null;
    if (this._streamRenderTimer) {
      clearTimeout(this._streamRenderTimer);
      this._streamRenderTimer = null;
    }
    this._removeScrollListener();
    this._userScrolledUp = false;
  },

  scrollToBottom() {
    if (this._userScrolledUp) return;
    const container = document.getElementById('chat-messages');
    this._programmaticScroll = true;
    container.scrollTop = container.scrollHeight;
    requestAnimationFrame(() => { this._programmaticScroll = false; });
  },

  _setupScrollListener() {
    this._removeScrollListener();
    const container = document.getElementById('chat-messages');
    this._scrollHandler = () => {
      if (this._programmaticScroll || !App.isGenerating) return;
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
      if (!atBottom) {
        this._userScrolledUp = true;
      }
    };
    container.addEventListener('scroll', this._scrollHandler);
  },

  _removeScrollListener() {
    if (this._scrollHandler) {
      const container = document.getElementById('chat-messages');
      container.removeEventListener('scroll', this._scrollHandler);
      this._scrollHandler = null;
    }
  },

  /* ---- File upload & preview ---- */

  _getCurrentImageSizeLimit() {
    const s = App.currentChat?.settings;
    const modelId = s?.model || '';
    // Keep this in sync with backend validation for Anthropic models.
    if (modelId.startsWith('anthropic/')) {
      return 5 * 1024 * 1024; // 5MB
    }
    return null;
  },

  _jpegName(originalName) {
    if (!originalName) return 'image.jpg';
    const idx = originalName.lastIndexOf('.');
    if (idx <= 0) return `${originalName}.jpg`;
    return `${originalName.slice(0, idx)}.jpg`;
  },

  _loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to decode image'));
      };
      img.src = url;
    });
  },

  _renderJpegFromImage(img, originalName, scale, quality) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('JPEG encoding failed'));
          return;
        }
        resolve(new File([blob], this._jpegName(originalName), { type: 'image/jpeg' }));
      }, 'image/jpeg', quality);
    });
  },

  async _convertImageToJpeg(file) {
    const img = await this._loadImageElement(file);
    return this._renderJpegFromImage(img, file.name, 1, 0.9);
  },

  async _findLargestJpegUnderLimit(file, maxBytes) {
    const img = await this._loadImageElement(file);
    const qualities = [0.9, 0.86, 0.82];
    let bestOverall = null;

    // Binary search scale; always render from the original image.
    for (const q of qualities) {
      let low = 0.1;
      let high = 1.0;
      let best = null;
      for (let i = 0; i < 8; i++) {
        const mid = (low + high) / 2;
        const candidate = await this._renderJpegFromImage(img, file.name, mid, q);
        if (candidate.size <= maxBytes) {
          best = candidate;
          low = mid;
        } else {
          high = mid;
        }
      }
      if (best && (!bestOverall || best.size > bestOverall.size)) {
        bestOverall = best;
      }
      // If we already got close enough, stop early.
      if (bestOverall && bestOverall.size >= maxBytes * 0.94) {
        break;
      }
    }

    return bestOverall;
  },

  _showImagePrepModal({ title, bodyHtml, primaryLabel, secondaryLabel, tertiaryLabel }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal image-prep-modal">
          <div class="modal-header">
            <h3>${title}</h3>
            <button class="icon-btn icon-btn-sm image-prep-close">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div class="modal-body">
            <div class="image-prep-body">${bodyHtml}</div>
          </div>
          <div class="modal-footer image-prep-actions">
            ${tertiaryLabel ? `<button class="btn-secondary image-prep-tertiary">${tertiaryLabel}</button>` : ''}
            ${secondaryLabel ? `<button class="btn-secondary image-prep-secondary">${secondaryLabel}</button>` : ''}
            <button class="btn-primary image-prep-primary">${primaryLabel}</button>
          </div>
        </div>`;

      const done = (choice) => {
        overlay.remove();
        resolve(choice);
      };

      overlay.querySelector('.image-prep-close')?.addEventListener('click', () => done('cancel'));
      overlay.querySelector('.image-prep-primary')?.addEventListener('click', () => done('primary'));
      overlay.querySelector('.image-prep-secondary')?.addEventListener('click', () => done('secondary'));
      overlay.querySelector('.image-prep-tertiary')?.addEventListener('click', () => done('tertiary'));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) done('cancel');
      });
      document.body.appendChild(overlay);
    });
  },

  async _prepareImageForUpload(file, maxBytes, options = {}) {
    const allowKeepOriginal = options.allowKeepOriginal !== false;
    if (!maxBytes || file.size <= maxBytes) return file;

    const current = this._formatSize(file.size);
    const limit = this._formatSize(maxBytes);

    const firstChoice = await this._showImagePrepModal({
      title: 'Image too large for current model',
      bodyHtml: `
        <p><strong>${this.escapeHtml(file.name)}</strong> is <strong>${current}</strong>.</p>
        <p>This model accepts up to <strong>${limit}</strong> per image.</p>
        <p>Try converting to JPEG first. If still too large, you can resize from the original while preserving aspect ratio.</p>
      `,
      primaryLabel: 'Convert to JPEG',
      secondaryLabel: allowKeepOriginal ? 'Keep Original' : null,
      tertiaryLabel: 'Skip',
    });

    if (firstChoice === 'tertiary' || firstChoice === 'cancel') return null;
    if (firstChoice === 'secondary') return file;

    let jpegFile;
    try {
      jpegFile = await this._convertImageToJpeg(file);
    } catch (e) {
      App.showToast('JPEG conversion failed');
      return null;
    }

    if (jpegFile.size <= maxBytes) {
      App.showToast(`Converted to JPEG (${this._formatSize(jpegFile.size)})`);
      return jpegFile;
    }

    const secondChoice = await this._showImagePrepModal({
      title: 'Still too large after JPEG conversion',
      bodyHtml: `
        <p>JPEG result is <strong>${this._formatSize(jpegFile.size)}</strong>, still above <strong>${limit}</strong>.</p>
        <p>Auto-resize from the original image and keep the largest size that fits?</p>
      `,
      primaryLabel: 'Auto-resize to fit',
      secondaryLabel: 'Skip',
    });

    if (secondChoice !== 'primary') return null;

    try {
      const resized = await this._findLargestJpegUnderLimit(file, maxBytes);
      if (!resized) {
        App.showToast('Could not compress image enough');
        return null;
      }
      App.showToast(`Resized JPEG (${this._formatSize(resized.size)})`);
      return resized;
    } catch (e) {
      App.showToast('Image resize failed');
      return null;
    }
  },

  async _uploadPreparedFile(chatId, file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`/api/chats/${chatId}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },

  async preflightImagesForGenerate() {
    if (!App.currentChat) return true;

    const maxBytes = this._getCurrentImageSizeLimit();
    if (!maxBytes) return true;

    const chatId = App.currentChat.id;
    let changed = false;

    for (const msg of App.currentChat.messages || []) {
      if (!Array.isArray(msg.files) || !msg.files.length) continue;

      for (let i = 0; i < msg.files.length; i++) {
        const f = msg.files[i];
        const type = (f.type || '');
        const size = Number(f.size || 0);
        if (!type.startsWith('image/') || size <= maxBytes) continue;

        const url = `/api/chats/${chatId}/files/${encodeURIComponent(f.filename)}`;
        let sourceBlob;
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('Failed to read original image');
          sourceBlob = await resp.blob();
        } catch (e) {
          App.showToast(`Failed to load image ${f.name || f.filename}`);
          return false;
        }

        const sourceFile = new File(
          [sourceBlob],
          f.name || f.filename || 'image',
          { type: f.type || sourceBlob.type || 'image/jpeg' },
        );

        // During generation preflight, "keep original" is disabled to avoid
        // guaranteed provider errors on the next request.
        const prepared = await this._prepareImageForUpload(sourceFile, maxBytes, { allowKeepOriginal: false });
        if (!prepared) {
          App.showToast('Generation cancelled: oversized image was not fixed');
          return false;
        }

        // If still oversized for any reason, stop before request.
        if (prepared.size > maxBytes) {
          App.showToast('Generation cancelled: image is still above model limit');
          return false;
        }

        // Replace the file metadata in-message with the newly uploaded version.
        try {
          const meta = await this._uploadPreparedFile(chatId, prepared);
          msg.files[i] = meta;
          changed = true;
        } catch (e) {
          App.showToast('Failed to upload optimized image');
          return false;
        }
      }
    }

    if (changed) {
      await App.saveChat();
      this.render();
      App.updateTokenCount();
      App.showToast('Oversized images were optimized for this model');
    }

    return true;
  },

  /** Upload files to server and add to pending list */
  async uploadFiles(fileList) {
    if (!App.currentChat) {
      await App.createChat();
    }

    // Get model capabilities to check file type support
    const s = App.currentChat.settings;
    const provider = App.providers[s.provider];
    const model = provider?.models.find(m => m.id === s.model);
    const caps = new Set(model?.multimodal || []);

    // Convert to array immediately — FileList is a live object tied to the
    // <input> element and may be emptied when the input value is reset.
    const files = Array.from(fileList);
    for (const file of files) {
      let uploadFile = file;

      // Check media type against model capabilities
      const category = file.type.split('/')[0]; // image, video, audio, text, application
      if (['image', 'video', 'audio'].includes(category) && !caps.has(category)) {
        App.showToast(`This model doesn't support ${category} files`);
        continue;
      }

      if (category === 'image') {
        const maxImageBytes = this._getCurrentImageSizeLimit();
        uploadFile = await this._prepareImageForUpload(file, maxImageBytes, { allowKeepOriginal: true });
        if (!uploadFile) continue;
      }

      const formData = new FormData();
      formData.append('file', uploadFile);

      try {
        const res = await fetch(`/api/chats/${App.currentChat.id}/upload`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) throw new Error('Upload failed');
        const meta = await res.json();
        App.pendingFiles.push(meta);
      } catch (e) {
        console.error('Upload failed:', e);
      }
    }

    this.renderPendingFiles();
  },

  /** Render pending file chips in the prompt area */
  renderPendingFiles() {
    const container = document.getElementById('pending-files');
    if (!container) return;

    if (!App.pendingFiles.length) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    container.innerHTML = App.pendingFiles.map((f, i) => {
      const isImage = (f.type || '').startsWith('image/');
      const isVideo = (f.type || '').startsWith('video/');
      const url = App.currentChat ? `/api/chats/${App.currentChat.id}/files/${encodeURIComponent(f.filename)}` : '';

      let thumbHtml;
      if (isImage && url) {
        thumbHtml = `<img class="pending-file-thumb" src="${url}" alt="">`;
      } else if (isVideo && url) {
        // Video thumbnail: render a <video> to grab a frame via canvas
        thumbHtml = `<canvas class="pending-file-thumb pending-video-thumb" data-video-url="${url}" data-file-index="${i}"></canvas>`;
      } else {
        thumbHtml = `<span class="material-symbols-outlined pending-file-icon">${this._fileIcon(f.type)}</span>`;
      }

      const tokens = this._estimateTokens(f);
      const meta = tokens > 0 ? `~${tokens.toLocaleString()} tokens` : this._formatSize(f.size);

      const settingsBtn = isVideo ? `<button class="pending-file-settings" onclick="event.stopPropagation(); Chat.openVideoSettings(${i})" title="Video settings"><span class="material-symbols-outlined">settings</span></button>` : '';

      return `<div class="pending-file-chip" ${isVideo ? `onclick="Chat.openVideoSettings(${i})"` : ''}>
        ${thumbHtml}
        <div class="pending-file-info">
          <span class="pending-file-name">${this.escapeHtml(f.name)}</span>
          <span class="pending-file-meta" id="pending-meta-${i}">${meta}</span>
        </div>
        ${settingsBtn}
        <button class="pending-file-remove" onclick="event.stopPropagation(); Chat.removePendingFile(${i})">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>`;
    }).join('');

    // Generate video thumbnails
    this._generateVideoThumbnails();
  },

  /** Generate thumbnails for video files by capturing a frame */
  _generateVideoThumbnails() {
    document.querySelectorAll('.pending-video-thumb').forEach(canvas => {
      const url = canvas.dataset.videoUrl;
      const idx = parseInt(canvas.dataset.fileIndex);
      if (!url) return;

      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'metadata';

      video.addEventListener('loadeddata', () => {
        // Seek to 0.5s or start
        video.currentTime = Math.min(0.5, video.duration || 0);
      });

      video.addEventListener('seeked', () => {
        canvas.width = 36;
        canvas.height = 36;
        const ctx = canvas.getContext('2d');
        // Cover-fit: center crop
        const vw = video.videoWidth, vh = video.videoHeight;
        const scale = Math.max(36 / vw, 36 / vh);
        const sw = 36 / scale, sh = 36 / scale;
        const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 36, 36);

        // Store video metadata for token estimation
        const f = App.pendingFiles[idx];
        if (f && !f._duration) {
          f._duration = video.duration;
          f._width = video.videoWidth;
          f._height = video.videoHeight;
          // Update token count now that we have duration
          const tokens = Chat._estimateTokens(f);
          const metaEl = document.getElementById(`pending-meta-${idx}`);
          if (metaEl && tokens > 0) {
            metaEl.textContent = `~${tokens.toLocaleString()} tokens`;
          }
        }
        video.src = '';
      });

      video.src = url;
    });
  },

  _estimateTokens(file) {
    const type = (file.type || '');
    if (type.startsWith('image/')) {
      // Rough heuristic based on file size
      return Math.max(258, Math.round(file.size / 200));
    }
    if (type.startsWith('video/')) {
      // Use video settings if available, otherwise estimate from duration
      const duration = file._duration || 0;
      if (!duration) return 0; // not yet loaded
      const fps = (file.videoSettings && file.videoSettings.fps) || 1;
      const startTime = (file.videoSettings && file.videoSettings.startTime) || 0;
      const endTime = (file.videoSettings && file.videoSettings.endTime) || duration;
      const clipDuration = Math.max(0, endTime - startTime);
      const frameCount = Math.ceil(clipDuration * fps);
      // Each frame ~ 258 tokens (like a single image)
      return frameCount * 258;
    }
    if (type.startsWith('audio/')) {
      // ~25 tokens per second of audio (rough Gemini estimate)
      const duration = file._duration || 0;
      return duration > 0 ? Math.round(duration * 25) : 0;
    }
    if (type.startsWith('text/') || type.includes('json') || type.includes('xml')) {
      return Math.round(file.size / 4);
    }
    return 0;
  },

  /** Generate thumbnails for video files in chat messages */
  _generateChatVideoThumbnails(container) {
    container.querySelectorAll('.chat-video-thumb').forEach(canvas => {
      const url = canvas.dataset.videoUrl;
      if (!url) return;

      const card = canvas.closest('.file-card-video');

      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'metadata';

      video.addEventListener('loadeddata', () => {
        video.currentTime = Math.min(0.5, video.duration || 0);
      });

      video.addEventListener('seeked', () => {
        const thumbW = 80, thumbH = 60;
        canvas.width = thumbW;
        canvas.height = thumbH;
        const ctx = canvas.getContext('2d');
        const vw = video.videoWidth, vh = video.videoHeight;
        const scale = Math.max(thumbW / vw, thumbH / vh);
        const sw = thumbW / scale, sh = thumbH / scale;
        const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, thumbW, thumbH);
        video.src = '';
      });

      // Make the card clickable for video playback
      if (card) {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.file-card-delete')) return;
          Chat.openVideoPlayer(url, card.querySelector('.file-card-name')?.textContent || 'Video');
        });
      }

      video.src = url;
    });
  },

  removePendingFile(index) {
    App.pendingFiles.splice(index, 1);
    this.renderPendingFiles();
  },

  /** Render file attachments inside a chat turn — each file is a separate visual block */
  renderFileAttachments(files, chatId, msgId) {
    if (!files || !files.length) return '';
    return files.map((f, i) => this._renderFileCard(f, chatId, msgId, i)).join('');
  },

  _renderFileCard(file, chatId, msgId, index) {
    const url = `/api/chats/${chatId}/files/${encodeURIComponent(file.filename)}`;
    const type = (file.type || '').split('/')[0];
    const ext = (file.name || '').split('.').pop().toLowerCase();
    const safeName = this.escapeHtml(file.name || 'file');
    const deleteBtn = `<button class="file-card-delete" onclick="event.stopPropagation(); App.deleteFileFromMessage('${msgId}', ${index})" title="Remove file"><span class="material-symbols-outlined">close</span></button>`;
    const tokens = this._estimateTokens(file);
    const tokenBadge = tokens > 0 ? `<div class="file-card-tokens">~${tokens.toLocaleString()} tokens</div>` : '';

    if (type === 'image') {
      return `<div class="file-card file-card-image">
        ${deleteBtn}
        <img src="${url}" alt="${safeName}" loading="lazy" onclick="Chat.openLightbox('${url}', '${safeName}')">
        <div class="file-card-image-footer">
          <div class="file-card-name">${safeName}</div>
          ${tokenBadge}
        </div>
      </div>`;
    }

    if (type === 'video') {
      return `<div class="file-card file-card-video" data-video-url="${url}">
        ${deleteBtn}
        <div class="file-card-video-thumb">
          <canvas class="chat-video-thumb" data-video-url="${url}"></canvas>
          <span class="material-symbols-outlined file-video-play">play_circle</span>
        </div>
        <div class="file-card-info">
          <div class="file-card-name">${safeName}</div>
          <div class="file-card-size">${this._formatSize(file.size)}${tokenBadge}</div>
        </div>
      </div>`;
    }

    if (type === 'audio') {
      return `<div class="file-card file-card-audio">
        ${deleteBtn}
        <div class="file-card-name"><span class="material-symbols-outlined">audio_file</span>${safeName}${tokenBadge}</div>
        <audio controls preload="metadata" src="${url}"></audio>
      </div>`;
    }

    const textExts = ['txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'];
    if (textExts.includes(ext)) {
      return `<div class="file-card file-card-text" onclick="Chat.openTextPreview('${url}', '${safeName}')">
        ${deleteBtn}
        <span class="material-symbols-outlined">description</span>
        <div class="file-card-info">
          <div class="file-card-name">${safeName}</div>
          <div class="file-card-size">${this._formatSize(file.size)}${tokenBadge}</div>
        </div>
      </div>`;
    }

    if (ext === 'pdf') {
      return `<div class="file-card file-card-generic" onclick="window.open('${url}', '_blank')">
        ${deleteBtn}
        <span class="material-symbols-outlined">picture_as_pdf</span>
        <div class="file-card-info">
          <div class="file-card-name">${safeName}</div>
          <div class="file-card-size">${this._formatSize(file.size)}${tokenBadge}</div>
        </div>
      </div>`;
    }

    return `<div class="file-card file-card-generic" onclick="window.open('${url}', '_blank')">
      ${deleteBtn}
      <span class="material-symbols-outlined">attach_file</span>
      <div class="file-card-info">
        <div class="file-card-name">${safeName}</div>
        <div class="file-card-size">${this._formatSize(file.size)}${tokenBadge}</div>
      </div>
    </div>`;
  },

  _fileIcon(mimeType) {
    if (!mimeType) return 'attach_file';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'videocam';
    if (mimeType.startsWith('audio/')) return 'audio_file';
    if (mimeType === 'application/pdf') return 'picture_as_pdf';
    return 'description';
  },

  _formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  },

  /** Full-screen image lightbox */
  openLightbox(url, name) {
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = `
      <div class="lightbox-header">
        <span class="lightbox-name">${name}</span>
        <button class="icon-btn lightbox-close" onclick="this.closest('.lightbox-overlay').remove()">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <img src="${url}" alt="${name}">`;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  },

  /** Video player lightbox */
  openVideoPlayer(url, name) {
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = `
      <div class="lightbox-header">
        <span class="lightbox-name">${name}</span>
        <button class="icon-btn lightbox-close" onclick="this.closest('.lightbox-overlay').remove()">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <video controls autoplay src="${url}" style="max-width:90vw;max-height:85vh;border-radius:4px;"></video>`;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  },

  /** Video settings modal (Start Time, End Time, FPS) */
  openVideoSettings(fileIndex) {
    const file = App.pendingFiles[fileIndex];
    if (!file) return;

    const url = App.currentChat ? `/api/chats/${App.currentChat.id}/files/${encodeURIComponent(file.filename)}` : '';
    if (!url) return;

    const settings = file.videoSettings || {};
    const duration = file._duration || 0;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal video-settings-modal">
        <div class="modal-header">
          <h3>Video settings</h3>
          <button class="icon-btn icon-btn-sm" onclick="this.closest('.modal-overlay').remove()">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="modal-body">
          <div class="video-settings-preview">
            <video id="video-settings-player" controls src="${url}" style="width:100%;max-height:300px;border-radius:8px;background:#000;"></video>
          </div>
          <div class="video-settings-fields">
            <div class="video-settings-row">
              <label class="settings-label">Start Time (s)</label>
              <input type="number" id="vs-start" class="settings-number-input" min="0" max="${duration}" step="0.1" value="${settings.startTime || 0}">
            </div>
            <div class="video-settings-row">
              <label class="settings-label">End Time (s)</label>
              <input type="number" id="vs-end" class="settings-number-input" min="0" max="${duration}" step="0.1" value="${settings.endTime || (duration || '')}">
            </div>
            <div class="video-settings-row">
              <label class="settings-label">FPS (frames per second)</label>
              <input type="number" id="vs-fps" class="settings-number-input" min="0.1" max="30" step="0.1" value="${settings.fps || 1}">
            </div>
            <div class="video-settings-info">
              <span class="material-symbols-outlined">info</span>
              <span id="vs-token-estimate">Estimating...</span>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
          <button class="btn-primary" id="vs-save-btn">Save</button>
        </div>
      </div>`;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);

    // Update metadata once video loads
    const videoEl = document.getElementById('video-settings-player');
    const startInput = document.getElementById('vs-start');
    const endInput = document.getElementById('vs-end');
    const fpsInput = document.getElementById('vs-fps');
    const tokenEstimate = document.getElementById('vs-token-estimate');

    const updateEstimate = () => {
      const fps = parseFloat(fpsInput.value) || 1;
      const start = parseFloat(startInput.value) || 0;
      const end = parseFloat(endInput.value) || file._duration || 0;
      const clipDuration = Math.max(0, end - start);
      const frames = Math.ceil(clipDuration * fps);
      const tokens = frames * 258;
      tokenEstimate.textContent = `~${frames} frames, ~${tokens.toLocaleString()} tokens`;
    };

    videoEl.addEventListener('loadedmetadata', () => {
      const dur = videoEl.duration;
      file._duration = dur;
      file._width = videoEl.videoWidth;
      file._height = videoEl.videoHeight;
      endInput.max = dur;
      startInput.max = dur;
      if (!settings.endTime) endInput.value = dur.toFixed(1);
      updateEstimate();
    });

    startInput.addEventListener('input', updateEstimate);
    endInput.addEventListener('input', updateEstimate);
    fpsInput.addEventListener('input', updateEstimate);

    // If duration already known, set immediately
    if (duration) updateEstimate();

    // Save button
    document.getElementById('vs-save-btn').addEventListener('click', () => {
      file.videoSettings = {
        startTime: parseFloat(startInput.value) || 0,
        endTime: parseFloat(endInput.value) || file._duration || 0,
        fps: parseFloat(fpsInput.value) || 1,
      };
      // Update pending chip token display
      this.renderPendingFiles();
      overlay.remove();
    });
  },

  /** Text file preview in a modal */
  async openTextPreview(url, name) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="width:700px;">
          <div class="modal-header">
            <h3>${name}</h3>
            <button class="icon-btn icon-btn-sm" onclick="this.closest('.modal-overlay').remove()">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div class="modal-body">
            <pre class="text-preview-content">${this.escapeHtml(text)}</pre>
          </div>
        </div>`;
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });
      document.body.appendChild(overlay);
    } catch (e) {
      console.error('Failed to load text preview', e);
    }
  },
};

/* ============================================================
   Input Handling
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  Chat.init();

  const textarea = document.getElementById('prompt-input');
  const runBtn = document.getElementById('btn-run');

  // Auto-grow textarea
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 302) + 'px';
  });

  // Submit on Enter (Shift+Enter for newline, Alt+Enter to append without generating)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      submitMessage();
    }
    if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      appendMessage();
    }
  });

  runBtn.addEventListener('click', submitMessage);

  // File upload wiring
  const fileInput = document.getElementById('file-input');
  const attachBtn = document.querySelector('.prompt-btn[title="Attach files"]');
  const promptBox = document.querySelector('.prompt-box');

  attachBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      Chat.uploadFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  // Drag and drop on prompt box
  promptBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    promptBox.classList.add('drag-over');
  });

  promptBox.addEventListener('dragleave', (e) => {
    if (!promptBox.contains(e.relatedTarget)) {
      promptBox.classList.remove('drag-over');
    }
  });

  promptBox.addEventListener('drop', (e) => {
    e.preventDefault();
    promptBox.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
      Chat.uploadFiles(e.dataTransfer.files);
    }
  });

  /** Add files as separate messages + text as its own message, save once */
  async function addUserTurn(content, files) {
    // Each file becomes its own message
    for (const file of files) {
      App.currentChat.messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: '',
        thoughts: '',
        files: [file],
      });
    }
    // Text becomes its own message (if any)
    if (content) {
      App.currentChat.messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: content,
        thoughts: '',
        files: [],
      });
    }
    await App.saveChat();
    Chat.render();
    App.updateTokenCount();
  }

  async function submitMessage() {
    // If currently generating, treat as Stop
    if (App.isGenerating) {
      App.stopGeneration();
      return;
    }

    const content = textarea.value.trim();
    const files = [...App.pendingFiles];
    if (!content && !files.length) return;

    // Clear input immediately for responsiveness
    textarea.value = '';
    textarea.style.height = 'auto';
    App.pendingFiles = [];
    Chat.renderPendingFiles();

    // Create chat if needed
    if (!App.currentChat) {
      await App.createChat();
    }

    await addUserTurn(content, files);

    // Auto-title from first user message
    if (App.currentChat.title === 'Untitled chat' && content) {
      const title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
      App.renameChat(App.currentChat.id, title);
    }

    // Generate LLM response
    App.generateResponse();
  }

  async function appendMessage() {
    if (App.isGenerating) return;
    const content = textarea.value.trim();
    const files = [...App.pendingFiles];
    if (!content && !files.length) return;

    textarea.value = '';
    textarea.style.height = 'auto';
    App.pendingFiles = [];
    Chat.renderPendingFiles();

    if (!App.currentChat) {
      await App.createChat();
    }

    await addUserTurn(content, files);

    if (App.currentChat.title === 'Untitled chat' && content) {
      const title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
      App.renameChat(App.currentChat.id, title);
    }
    // No generation — just append the message
  }
});

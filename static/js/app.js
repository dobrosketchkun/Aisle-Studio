/* ============================================================
   App State & Core Logic
   ============================================================ */

const App = {
  currentChatId: null,
  chats: [],          // [{id, title, updated_at}]
  currentChat: null,  // full chat object when loaded
  providers: {},       // loaded from providers.json
  isGenerating: false,
  abortController: null,
  pendingFiles: [],    // files uploaded but not yet sent with a message
  keyStatus: {},       // { provider: bool } -- which providers have keys configured
  theme: 'dark',

  /** API helpers */
  async api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'API error');
    }
    return res.json();
  },

  _normalizeErrorMessage(err) {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      if (typeof err.error === 'string') return err.error;
      if (typeof err.message === 'string') return err.message;
      try { return JSON.stringify(err); } catch (_) { /* ignore */ }
    }
    return String(err ?? 'Unknown error');
  },

  applyTheme(theme) {
    const normalized = theme === 'light' ? 'light' : 'dark';
    this.theme = normalized;
    document.body.classList.toggle('theme-light', normalized === 'light');
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = normalized === 'light' ? 'dark_mode' : 'light_mode';
  },

  initTheme() {
    const saved = localStorage.getItem('theme');
    this.applyTheme(saved === 'light' ? 'light' : 'dark');
  },

  toggleTheme() {
    const next = this.theme === 'light' ? 'dark' : 'light';
    this.applyTheme(next);
    localStorage.setItem('theme', next);
  },

  async loadChatList() {
    this.chats = await this.api('GET', '/api/chats');
    Sidebar.renderChatList();
  },

  async createChat() {
    const body = this.currentChat?.settings
      ? { settings: this.currentChat.settings }
      : undefined;
    const chat = await this.api('POST', '/api/chats', body);
    await this.loadChatList();
    await this.openChat(chat.id);
  },

  async openChat(chatId) {
    if (this.currentChatId === chatId && this.currentChat) return;
    this.currentChatId = chatId;
    this.currentChat = await this.api('GET', `/api/chats/${chatId}`);
    Sidebar.setActive(chatId);
    Chat.render();
    Settings.loadFromChat();
    document.getElementById('chat-title').textContent = this.currentChat.title;
    this.updateTokenCount();
    this.updateKeyIndicator();
  },

  async saveChat() {
    if (!this.currentChat) return;
    await this.api('PUT', `/api/chats/${this.currentChat.id}`, {
      title: this.currentChat.title,
      settings: this.currentChat.settings,
      messages: this.currentChat.messages,
    });
    await this.loadChatList();
  },

  async deleteChat(chatId) {
    await this.api('DELETE', `/api/chats/${chatId}`);
    if (this.currentChatId === chatId) {
      this.currentChatId = null;
      this.currentChat = null;
      Chat.renderEmpty();
    }
    await this.loadChatList();
    // Open the first remaining chat, or show empty state
    if (this.chats.length > 0 && !this.currentChatId) {
      await this.openChat(this.chats[0].id);
    }
  },

  async renameChat(chatId, newTitle) {
    await this.api('PUT', `/api/chats/${chatId}`, { title: newTitle });
    if (this.currentChatId === chatId && this.currentChat) {
      this.currentChat.title = newTitle;
      document.getElementById('chat-title').textContent = newTitle;
    }
    await this.loadChatList();
  },

  updateTokenCount() {
    const el = document.getElementById('token-count');
    if (!this.currentChat) { el.textContent = ''; return; }
    let tokens = 0;
    // Include system instructions in token count
    const sysInstr = this.currentChat.settings?.system_instructions || '';
    if (sysInstr) tokens += Math.round(sysInstr.length / 4);
    for (const m of this.currentChat.messages) {
      // Text tokens (~4 chars per token)
      const text = (m.content || '') + (m.thoughts || '');
      tokens += Math.round(text.length / 4);
      // File tokens
      if (m.files && typeof Chat !== 'undefined') {
        for (const f of m.files) {
          tokens += Chat._estimateTokens(f);
        }
      }
    }
    el.textContent = tokens > 0 ? `~${tokens.toLocaleString()} tokens` : '';
  },

  /** Add a user message to the current chat */
  async addUserMessage(content, files = []) {
    if (!this.currentChat) return;
    this.currentChat.messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: content,
      thoughts: '',
      files: files,
    });
    await this.saveChat();
    Chat.render();
    this.updateTokenCount();
  },

  /** Delete a message by id */
  async deleteMessage(msgId) {
    if (!this.currentChat) return;
    this.currentChat.messages = this.currentChat.messages.filter(m => m.id !== msgId);
    await this.saveChat();
    Chat.render();
    this.updateTokenCount();
  },

  /** Remove a single file from a message */
  async deleteFileFromMessage(msgId, fileIndex) {
    if (!this.currentChat) return;
    const msg = this.currentChat.messages.find(m => m.id === msgId);
    if (!msg || !msg.files) return;
    msg.files.splice(fileIndex, 1);
    // Only delete the whole message if there is truly no content AND no files left
    const hasContent = typeof msg.content === 'string' && msg.content.trim().length > 0;
    if (!hasContent && msg.files.length === 0) {
      return this.deleteMessage(msgId);
    }
    await this.saveChat();
    Chat.render();
    this.updateTokenCount();
  },

  /** Update a message's content */
  async updateMessage(msgId, newContent) {
    if (!this.currentChat) return;
    const msg = this.currentChat.messages.find(m => m.id === msgId);
    if (msg) {
      msg.content = newContent;
      await this.saveChat();
      Chat.render();
      this.updateTokenCount();
    }
  },

  /** Stream an LLM response for the current chat */
  async generateResponse() {
    if (!this.currentChat || this.isGenerating) return;

    if (typeof Chat !== 'undefined' && Chat.preflightImagesForGenerate) {
      const okToProceed = await Chat.preflightImagesForGenerate();
      if (!okToProceed) return;
    }

    const chatId = this.currentChat.id;
    this.isGenerating = true;
    this.abortController = new AbortController();
    Chat.setGeneratingUI(true);

    // Placeholder model message
    const msgId = crypto.randomUUID();
    this.currentChat.messages.push({
      id: msgId, role: 'model', content: '', thoughts: '',
    });
    Chat.appendStreamingTurn(msgId);

    let accContent = '';
    let accThoughts = '';
    let hadError = false;

    try {
      const res = await fetch(`/api/chats/${chatId}/generate`, {
        method: 'POST',
        signal: this.abortController.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (line === '') { currentEvent = ''; continue; }
          if (!line.startsWith('data: ')) continue;

          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;

          try {
            const data = JSON.parse(payload);

            if (currentEvent === 'error' || data.error) {
              hadError = true;
              Chat.showStreamingError(msgId, this._normalizeErrorMessage(data));
              return;
            }

            const choices = data.choices || [];
            if (!choices.length) continue;
            const delta = choices[0].delta || {};

            const text = typeof delta.content === 'string' ? delta.content : '';
            if (text) accContent += text;

            const reasoning = delta.reasoning || delta.reasoning_content || delta.thinking || '';
            if (typeof reasoning === 'string' && reasoning) accThoughts += reasoning;

            if (text || reasoning) {
              Chat.updateStreamingContent(msgId, accContent, accThoughts);
            }
          } catch (e) { /* skip invalid JSON */ }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        hadError = true;
        Chat.showStreamingError(msgId, err.message);
      }
    } finally {
      this.isGenerating = false;
      this.abortController = null;
      Chat.setGeneratingUI(false);
      Chat.finalizeStreaming();

      if (this.currentChatId === chatId) {
        if (hadError) {
          this.currentChat.messages = this.currentChat.messages.filter(m => m.id !== msgId);
        } else {
          try {
            this.currentChat = await this.api('GET', `/api/chats/${chatId}`);
          } catch (e) { /* ignore */ }
          Chat.render();
        }
        this.updateTokenCount();
      }
    }
  },

  stopGeneration() {
    if (this.abortController) {
      this.abortController.abort();
    }
  },

  /** Load API key status from backend */
  async loadKeyStatus() {
    try {
      this.keyStatus = await this.api('GET', '/api/keys');
    } catch (e) {
      console.error('Failed to load key status:', e);
    }
    this.updateKeyIndicator();
  },

  /** Update the key button icon based on current provider's key status */
  updateKeyIndicator() {
    const btn = document.getElementById('btn-api-key');
    if (!btn) return;
    const icon = btn.querySelector('.material-symbols-outlined');
    const currentProvider = this.currentChat?.settings?.provider || 'openrouter';
    const hasKey = this.keyStatus[currentProvider];
    icon.textContent = hasKey ? 'key' : 'key_off';
    btn.classList.toggle('key-configured', !!hasKey);
    btn.classList.toggle('key-missing', !hasKey);
  },

  /** Open the API key management modal */
  /** Toggle bookmark for a chat */
  async toggleBookmark(chatId) {
    const chat = this.chats.find(c => c.id === chatId);
    if (!chat) return;
    const newVal = !chat.bookmarked;
    await this.api('PUT', `/api/chats/${chatId}`, { bookmarked: newVal });
    chat.bookmarked = newVal;
    return newVal;
  },

  /** Open full-screen history modal */
  openHistoryModal() {
    let allChats = [...this.chats];
    let sortMode = 'date';
    let searchQuery = '';
    let searchMode = 'all';
    let searchResults = null; // null = not searching, [] = no results
    let searchTimer = null;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const highlightMatch = (text, query) => {
      if (!query) return this._escapeHtml(text);
      const escaped = this._escapeHtml(text);
      const escapedQ = this._escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return escaped.replace(new RegExp(`(${escapedQ})`, 'gi'), '<mark>$1</mark>');
    };

    const renderList = (items, query) => {
      const listEl = overlay.querySelector('.history-list');
      if (!items.length) {
        listEl.innerHTML = '<div class="history-empty">No chats found</div>';
        return;
      }
      listEl.innerHTML = items.map(c => {
        const date = c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const starIcon = c.bookmarked ? 'star' : 'star_border';
        const starClass = c.bookmarked ? ' bookmarked' : '';
        const activeClass = c.id === this.currentChatId ? ' active' : '';
        const titleHtml = query ? highlightMatch(c.title, query) : this._escapeHtml(c.title);
        const snippetHtml = c.snippet ? `<div class="history-item-snippet">${highlightMatch(c.snippet, query)}</div>` : '';
        return `<div class="history-item${activeClass}" data-id="${c.id}">
          <button class="history-item-star${starClass}" data-id="${c.id}" title="Bookmark">
            <span class="material-symbols-outlined">${starIcon}</span>
          </button>
          <div class="history-item-body" data-id="${c.id}">
            <div class="history-item-title">${titleHtml}</div>
            ${snippetHtml}
            <div class="history-item-date">${date}</div>
          </div>
          <button class="history-item-delete" data-id="${c.id}" title="Delete">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>`;
      }).join('');
    };

    const render = () => {
      // If we have active search results from the API, use those
      if (searchResults !== null) {
        renderList(searchResults, searchQuery);
        return;
      }
      // Otherwise show all chats with sort
      let filtered = allChats;
      if (sortMode === 'bookmarked') {
        filtered = [...filtered].sort((a, b) => (b.bookmarked ? 1 : 0) - (a.bookmarked ? 1 : 0));
      } else if (sortMode === 'title') {
        filtered = [...filtered].sort((a, b) => a.title.localeCompare(b.title));
      }
      renderList(filtered, '');
    };

    const doSearch = () => {
      clearTimeout(searchTimer);
      const q = searchQuery;
      if (!q) {
        searchResults = null;
        render();
        return;
      }
      searchTimer = setTimeout(async () => {
        try {
          const results = await this.api('GET', `/api/chats/search?q=${encodeURIComponent(q)}&mode=${searchMode}`);
          // Enrich results with bookmark status from local data
          for (const r of results) {
            const local = allChats.find(c => c.id === r.id);
            if (local) r.bookmarked = local.bookmarked;
          }
          searchResults = results;
          render();
        } catch (e) {
          console.error('History search failed:', e);
        }
      }, 300);
    };

    overlay.innerHTML = `
      <div class="modal history-modal">
        <div class="modal-header">
          <h3>Chat history</h3>
          <button class="icon-btn icon-btn-sm modal-close-btn">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="history-controls">
          <div class="history-search-wrap">
            <span class="material-symbols-outlined">search</span>
            <input type="text" class="history-search-input" placeholder="Search chats..." autocomplete="off">
          </div>
          <div class="history-controls-row">
            <div class="history-mode-btns">
              <button class="history-mode-btn active" data-mode="all">All</button>
              <button class="history-mode-btn" data-mode="title">Title</button>
              <button class="history-mode-btn" data-mode="content">Content</button>
            </div>
            <div class="history-controls-separator"></div>
            <div class="history-sort-btns">
              <button class="history-sort-btn active" data-sort="date">Recent</button>
              <button class="history-sort-btn" data-sort="bookmarked">Starred</button>
              <button class="history-sort-btn" data-sort="title">A-Z</button>
            </div>
          </div>
        </div>
        <div class="history-list"></div>
      </div>`;

    document.body.appendChild(overlay);
    render();

    // Close
    overlay.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // Search input with debounced API call
    const searchInput = overlay.querySelector('.history-search-input');
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim();
      doSearch();
    });

    // Search mode buttons (All / Title / Content)
    overlay.querySelectorAll('.history-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.history-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        searchMode = btn.dataset.mode;
        if (searchQuery) doSearch();
      });
    });

    // Sort buttons (only apply when not searching)
    overlay.querySelectorAll('.history-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.history-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sortMode = btn.dataset.sort;
        render();
      });
    });

    // Delegate clicks on list items
    overlay.querySelector('.history-list').addEventListener('click', async (e) => {
      const starBtn = e.target.closest('.history-item-star');
      if (starBtn) {
        e.stopPropagation();
        const id = starBtn.dataset.id;
        const newVal = await this.toggleBookmark(id);
        const c = allChats.find(x => x.id === id);
        if (c) c.bookmarked = newVal;
        if (searchResults) {
          const sr = searchResults.find(x => x.id === id);
          if (sr) sr.bookmarked = newVal;
        }
        render();
        return;
      }

      const delBtn = e.target.closest('.history-item-delete');
      if (delBtn) {
        e.stopPropagation();
        const id = delBtn.dataset.id;
        if (!confirm('Delete this chat?')) return;
        await this.deleteChat(id);
        allChats = allChats.filter(c => c.id !== id);
        if (searchResults) searchResults = searchResults.filter(c => c.id !== id);
        render();
        return;
      }

      const body = e.target.closest('.history-item-body');
      if (body) {
        const id = body.dataset.id;
        overlay.remove();
        await this.openChat(id);
        Sidebar.renderChatList();
      }
    });
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /** Show a brief toast notification */
  showToast(message, duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  openKeyManagementModal() {
    this.api('GET', '/api/keys').then(status => {
      this.keyStatus = status;
      this.updateKeyIndicator();

      const providerKeys = Object.keys(this.providers);
      const fieldsHtml = providerKeys.map(key => {
        const provider = this.providers[key];
        const hasKey = status[key] || false;
        return `
          <div class="key-field" data-provider="${key}">
            <div class="key-field-header">
              <label>${provider.name}</label>
              <span class="key-status ${hasKey ? 'key-active' : 'key-inactive'}">${hasKey ? 'Configured' : 'Not set'}</span>
            </div>
            <div class="key-field-input">
              <input type="password" id="key-input-${key}" placeholder="${hasKey ? 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢' : 'Enter API key...'}" data-provider="${key}">
              ${hasKey ? `<button class="key-clear-btn" data-provider="${key}" title="Clear key"><span class="material-symbols-outlined">close</span></button>` : ''}
            </div>
          </div>`;
      }).join('');

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal key-management-modal">
          <div class="modal-header">
            <h3>API Keys</h3>
            <button class="icon-btn icon-btn-sm modal-close-btn">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div class="modal-body">
            <p class="key-modal-desc">Configure API keys for each provider. Keys are stored locally on this server.</p>
            ${fieldsHtml}
          </div>
          <div class="modal-footer">
            <button class="btn-secondary modal-cancel-btn">Cancel</button>
            <button class="btn-primary" id="key-save-btn">Save</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      // Close handlers
      overlay.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
      overlay.querySelector('.modal-cancel-btn').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.remove();
      });

      // Clear buttons
      overlay.querySelectorAll('.key-clear-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = btn.dataset.provider;
          const input = document.getElementById(`key-input-${p}`);
          input.value = '';
          input.dataset.cleared = 'true';
          input.placeholder = 'Enter API key...';
          btn.remove();
          const field = overlay.querySelector(`.key-field[data-provider="${p}"]`);
          const statusEl = field.querySelector('.key-status');
          statusEl.className = 'key-status key-inactive';
          statusEl.textContent = 'Not set';
        });
      });

      // Save
      document.getElementById('key-save-btn').addEventListener('click', async () => {
        const keys = {};
        overlay.querySelectorAll('input[data-provider]').forEach(input => {
          const value = input.value.trim();
          const cleared = input.dataset.cleared === 'true';
          if (value) {
            keys[input.dataset.provider] = value;
          } else if (cleared) {
            keys[input.dataset.provider] = '';
          }
        });

        if (Object.keys(keys).length === 0) {
          overlay.remove();
          return;
        }

        try {
          this.keyStatus = await this.api('POST', '/api/keys', { keys });
          this.updateKeyIndicator();
        } catch (e) {
          console.error('Failed to save keys:', e);
        }
        overlay.remove();
      });
    });
  },
};

/* ============================================================
   Init on DOM ready
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  App.initTheme();

  // Sidebar toggle
  document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  // Right panel toggle
  document.getElementById('btn-right-panel-toggle').addEventListener('click', () => {
    document.getElementById('right-panel').classList.toggle('collapsed');
  });

  document.getElementById('btn-close-panel').addEventListener('click', () => {
    document.getElementById('right-panel').classList.add('collapsed');
  });

  // New chat button
  document.getElementById('btn-new-chat').addEventListener('click', () => {
    App.createChat();
  });

  // View all history button
  document.getElementById('btn-view-all-history').addEventListener('click', () => {
    App.openHistoryModal();
  });

  // Chat title editing
  const titleEl = document.getElementById('chat-title');
  const editBtn = document.getElementById('btn-edit-title');

  editBtn.addEventListener('click', () => {
    titleEl.contentEditable = 'true';
    titleEl.focus();
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  titleEl.addEventListener('blur', () => {
    titleEl.contentEditable = 'false';
    const newTitle = titleEl.textContent.trim() || 'Untitled chat';
    titleEl.textContent = newTitle;
    if (App.currentChat && App.currentChat.title !== newTitle) {
      App.renameChat(App.currentChat.id, newTitle);
    }
  });

  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      titleEl.blur();
    }
  });

  // Close context menus on click outside
  document.addEventListener('click', (e) => {
    const ctxMenu = document.getElementById('context-menu');
    if (ctxMenu.style.display !== 'none' && !ctxMenu.contains(e.target)) {
      ctxMenu.style.display = 'none';
    }
    // Close any sidebar context menu
    document.querySelectorAll('.sidebar-context-menu').forEach(m => m.remove());
  });

  // API key button
  document.getElementById('btn-api-key').addEventListener('click', () => {
    App.openKeyManagementModal();
  });

  const themeBtn = document.getElementById('btn-theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => App.toggleTheme());
  }

  // Resizable right panel
  const resizeHandle = document.getElementById('panel-resize-handle');
  const rightPanel = document.getElementById('right-panel');
  if (resizeHandle && rightPanel) {
    const savedWidth = localStorage.getItem('panelWidth');
    if (savedWidth) {
      const w = parseInt(savedWidth);
      rightPanel.style.width = w + 'px';
      rightPanel.style.minWidth = w + 'px';
    }

    let startX, startW;
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = rightPanel.offsetWidth;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (e) => {
        const delta = startX - e.clientX;
        const newW = Math.max(250, Math.min(600, startW + delta));
        rightPanel.style.width = newW + 'px';
        rightPanel.style.minWidth = newW + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('panelWidth', rightPanel.offsetWidth);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Load provider config
  try {
    App.providers = await (await fetch('/static/providers.json')).json();
  } catch (e) {
    console.error('Failed to load providers.json', e);
  }

  // Load API key status
  await App.loadKeyStatus();

  // Load chats
  await App.loadChatList();
  if (App.chats.length > 0) {
    await App.openChat(App.chats[0].id);
  }
});




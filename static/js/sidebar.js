/* ============================================================
   Sidebar – Chat History Management & Search
   ============================================================ */

const Sidebar = {
  _searchTimer: null,
  _searchMode: 'all',  // 'all', 'title', 'content'
  _isSearching: false,

  renderChatList() {
    const list = document.getElementById('chat-history-list');
    list.innerHTML = '';
    for (const chat of App.chats) {
      const li = document.createElement('li');
      li.className = 'chat-history-item';
      if (chat.id === App.currentChatId) li.classList.add('active');
      if (App.namingChatId === chat.id) li.classList.add('title-generating');
      li.dataset.chatId = chat.id;

      const link = document.createElement('span');
      link.className = 'chat-history-link';
      link.textContent = chat.title;
      link.addEventListener('click', () => App.openChat(chat.id));

      const menuBtn = document.createElement('button');
      menuBtn.className = 'chat-history-menu-btn';
      menuBtn.innerHTML = '<span class="material-symbols-outlined">more_vert</span>';
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showChatMenu(e, chat.id, chat.title);
      });

      li.appendChild(link);
      li.appendChild(menuBtn);
      list.appendChild(li);
    }
  },

  setActive(chatId) {
    document.querySelectorAll('.chat-history-item').forEach(el => {
      el.classList.toggle('active', el.dataset.chatId === chatId);
    });
  },

  /** Perform search with debounce */
  onSearchInput(query) {
    clearTimeout(this._searchTimer);
    query = query.trim();

    if (!query) {
      this._isSearching = false;
      this.renderChatList();
      return;
    }

    this._searchTimer = setTimeout(async () => {
      this._isSearching = true;
      try {
        const results = await App.api('GET', `/api/chats/search?q=${encodeURIComponent(query)}&mode=${this._searchMode}`);
        this.renderSearchResults(results, query);
      } catch (e) {
        console.error('Search failed:', e);
      }
    }, 300);
  },

  /** Render search results in the sidebar list */
  renderSearchResults(results, query) {
    const list = document.getElementById('chat-history-list');
    list.innerHTML = '';

    if (!results.length) {
      list.innerHTML = '<li class="search-no-results">No results found</li>';
      return;
    }

    for (const r of results) {
      const li = document.createElement('li');
      li.className = 'chat-history-item';
      if (r.id === App.currentChatId) li.classList.add('active');
      if (App.namingChatId === r.id) li.classList.add('title-generating');
      li.dataset.chatId = r.id;

      const link = document.createElement('div');
      link.className = 'chat-history-link search-result-link';
      link.innerHTML = this._highlightMatch(r.title, query);
      if (r.snippet) {
        const snippetEl = document.createElement('div');
        snippetEl.className = 'search-result-snippet';
        snippetEl.innerHTML = this._highlightMatch(r.snippet, query);
        link.appendChild(snippetEl);
      }
      link.addEventListener('click', () => App.openChat(r.id));

      li.appendChild(link);
      list.appendChild(li);
    }
  },

  /** Highlight matching text in a string */
  _highlightMatch(text, query) {
    if (!query) return this._escapeHtml(text);
    const escaped = this._escapeHtml(text);
    const escapedQuery = this._escapeHtml(query);
    const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /** Clear search and restore normal list */
  clearSearch() {
    const input = document.getElementById('sidebar-search-input');
    if (input) input.value = '';
    this._isSearching = false;
    this.renderChatList();
  },

  showChatMenu(event, chatId, chatTitle) {
    // Remove any existing menus
    document.querySelectorAll('.sidebar-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'sidebar-context-menu';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'context-menu-item';
    renameBtn.innerHTML = '<span class="material-symbols-outlined">edit</span><span>Rename</span>';
    renameBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.remove();
      await this.promptRename(chatId, chatTitle);
    });

    const genNameBtn = document.createElement('button');
    genNameBtn.className = 'context-menu-item';
    genNameBtn.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span><span>Generate name</span>';
    genNameBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.remove();
      try {
        await App.generateChatTitle(chatId);
      } catch (err) {
        App.showToast(App._normalizeErrorMessage(err));
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'context-menu-item';
    deleteBtn.innerHTML = '<span class="material-symbols-outlined">delete</span><span>Delete</span>';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.remove();
      const ok = await App.showConfirmModal({
        title: 'Delete chat?',
        message: 'This will permanently delete this chat and its uploaded files.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (ok) await App.deleteChat(chatId);
    });

    menu.appendChild(renameBtn);
    menu.appendChild(genNameBtn);
    menu.appendChild(deleteBtn);

    document.body.appendChild(menu);

    // Position near button
    const rect = event.target.closest('button').getBoundingClientRect();
    menu.style.left = rect.right + 'px';
    menu.style.top = rect.top + 'px';

    // Keep within viewport
    requestAnimationFrame(() => {
      const menuRect = menu.getBoundingClientRect();
      if (menuRect.right > window.innerWidth) {
        menu.style.left = (rect.left - menuRect.width) + 'px';
      }
      if (menuRect.bottom > window.innerHeight) {
        menu.style.top = (window.innerHeight - menuRect.height - 8) + 'px';
      }
    });
  },

  async promptRename(chatId, currentTitle) {
    const newTitle = await App.showPromptModal({
      title: 'Rename chat',
      value: currentTitle || '',
      placeholder: 'Chat title...',
      confirmLabel: 'Save',
    });
    if (newTitle && newTitle.trim()) {
      await App.renameChat(chatId, newTitle.trim());
    }
  },
};

/* ============================================================
   Sidebar Event Bindings
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('sidebar-search-input');
  const clearBtn = document.getElementById('sidebar-search-clear');

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value;
      clearBtn.style.display = q ? 'flex' : 'none';
      Sidebar.onSearchInput(q);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      Sidebar.clearSearch();
      clearBtn.style.display = 'none';
    });
  }

  // Search mode buttons
  document.querySelectorAll('.search-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.search-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Sidebar._searchMode = btn.dataset.mode;
      // Re-search if there's a query
      if (searchInput && searchInput.value.trim()) {
        Sidebar.onSearchInput(searchInput.value);
      }
    });
  });
});

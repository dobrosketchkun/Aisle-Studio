/* ============================================================
   App State & Core Logic
   ============================================================ */

const App = {
  currentChatId: null,
  chats: [],          // [{id, title, updated_at}]
  currentChat: null,  // full chat object when loaded

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

  async loadChatList() {
    this.chats = await this.api('GET', '/api/chats');
    Sidebar.renderChatList();
  },

  async createChat() {
    const chat = await this.api('POST', '/api/chats');
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
    // Rough estimate: ~4 chars per token
    const text = this.currentChat.messages.map(m =>
      (m.content || '') + (m.thoughts || '')
    ).join('');
    const tokens = Math.round(text.length / 4);
    el.textContent = tokens > 0 ? `~${tokens.toLocaleString()} tokens` : '';
  },

  /** Add a user message to the current chat */
  async addUserMessage(content) {
    if (!this.currentChat) return;
    this.currentChat.messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: content,
      thoughts: '',
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
};

/* ============================================================
   Init on DOM ready
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
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

  // Load chats
  await App.loadChatList();
  if (App.chats.length > 0) {
    await App.openChat(App.chats[0].id);
  }
});

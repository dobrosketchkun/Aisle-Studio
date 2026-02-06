/* ============================================================
   Sidebar – Chat History Management
   ============================================================ */

const Sidebar = {
  renderChatList() {
    const list = document.getElementById('chat-history-list');
    list.innerHTML = '';
    for (const chat of App.chats) {
      const li = document.createElement('li');
      li.className = 'chat-history-item';
      if (chat.id === App.currentChatId) li.classList.add('active');
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

  showChatMenu(event, chatId, chatTitle) {
    // Remove any existing menus
    document.querySelectorAll('.sidebar-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'sidebar-context-menu';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'context-menu-item';
    renameBtn.innerHTML = '<span class="material-symbols-outlined">edit</span><span>Rename</span>';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      this.promptRename(chatId, chatTitle);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'context-menu-item';
    deleteBtn.innerHTML = '<span class="material-symbols-outlined">delete</span><span>Delete</span>';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      if (confirm('Delete this chat?')) {
        App.deleteChat(chatId);
      }
    });

    menu.appendChild(renameBtn);
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

  promptRename(chatId, currentTitle) {
    const newTitle = prompt('Rename chat:', currentTitle);
    if (newTitle && newTitle.trim()) {
      App.renameChat(chatId, newTitle.trim());
    }
  },
};

/* ============================================================
   Chat – Message Rendering & Input Handling
   ============================================================ */

const Chat = {
  /** Configure marked.js with custom code block renderer */
  init() {
    const renderer = new marked.Renderer();
    // Custom code block rendering with header bar
    renderer.code = function ({ text, lang }) {
      const language = lang || 'plaintext';
      let highlighted;
      try {
        highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
      } catch {
        highlighted = hljs.highlightAuto(text).value;
      }
      const escapedCode = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `
        <div class="code-block-wrapper">
          <div class="code-block-header">
            <div class="code-block-lang">
              <span class="material-symbols-outlined">code</span>
              <span>${language}</span>
            </div>
            <div class="code-block-actions">
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

  /** Render all messages for the current chat */
  render() {
    const container = document.getElementById('chat-messages');
    const emptyState = document.getElementById('empty-state');
    const disclaimer = document.getElementById('disclaimer');

    if (!App.currentChat || App.currentChat.messages.length === 0) {
      this.renderEmpty();
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (disclaimer) disclaimer.style.display = 'flex';

    // Build message HTML
    let html = '';
    for (const msg of App.currentChat.messages) {
      html += this.renderTurn(msg);
    }
    container.innerHTML = html;

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
    document.getElementById('disclaimer').style.display = 'none';
  },

  /** Render a single chat turn */
  renderTurn(msg) {
    const isUser = msg.role === 'user';
    const roleLabel = isUser ? 'User' : 'Model';
    const labelClass = isUser ? 'user-label' : '';

    let contentHtml;
    if (isUser) {
      contentHtml = `<div class="user-text">${this.escapeHtml(msg.content)}</div>`;
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

    return `
      <div class="chat-turn" data-msg-id="${msg.id}">
        <div class="turn-role-label ${labelClass}">${roleLabel}</div>
        <div class="turn-content">
          ${contentHtml}
          <div class="turn-actions">
            ${isUser ? `<button class="turn-action-btn" onclick="Chat.startEdit('${msg.id}')" title="Edit">
              <span class="material-symbols-outlined">edit</span>
            </button>` : ''}
            <button class="turn-action-btn" title="Rerun this turn">
              ${sparkleSvg}
            </button>
            <button class="turn-action-btn" onclick="Chat.showTurnMenu(event, '${msg.id}')" title="More options">
              <span class="material-symbols-outlined">more_vert</span>
            </button>
          </div>
        </div>
      </div>`;
  },

  /** Render model message content (with optional thoughts) */
  renderModelContent(msg) {
    let html = '';

    // Thoughts section
    if (msg.thoughts) {
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
            <span class="thoughts-summary">Expand to view model thoughts</span>
            <span class="material-symbols-outlined thoughts-expand-icon">expand_more</span>
          </div>
          <div class="thoughts-body">
            <div class="markdown-content">${marked.parse(msg.thoughts)}</div>
          </div>
        </div>`;
    }

    // Main content
    html += `<div class="markdown-content">${marked.parse(msg.content)}</div>`;
    return html;
  },

  /** Toggle thoughts section */
  toggleThoughts(el) {
    // Don't toggle if clicking inside the body content
    el.classList.toggle('expanded');
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
        // Future: branch conversation from this point
        break;
    }
  },

  /** Start editing a user message */
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

  /** Append a placeholder model turn for streaming */
  appendStreamingTurn(msgId) {
    const container = document.getElementById('chat-messages');
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';
    document.getElementById('disclaimer').style.display = 'flex';

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

    let html = '';
    if (thoughts) {
      html += `
        <div class="thoughts-section expanded" onclick="Chat.toggleThoughts(this)">
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
            <span class="thoughts-summary"></span>
            <span class="material-symbols-outlined thoughts-expand-icon">expand_more</span>
          </div>
          <div class="thoughts-body">
            <div class="markdown-content">${marked.parse(thoughts)}</div>
          </div>
        </div>`;
    }

    if (content) {
      html += `<div class="markdown-content">${marked.parse(content)}</div>`;
    } else if (!thoughts) {
      html += '<span class="streaming-cursor"></span>';
    }

    area.innerHTML = html;
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
  },

  scrollToBottom() {
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
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

  // Submit on Enter (Shift+Enter for newline)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      submitMessage();
    }
  });

  runBtn.addEventListener('click', submitMessage);

  async function submitMessage() {
    // If currently generating, treat as Stop
    if (App.isGenerating) {
      App.stopGeneration();
      return;
    }

    const content = textarea.value.trim();
    if (!content) return;

    // Clear input immediately for responsiveness
    textarea.value = '';
    textarea.style.height = 'auto';

    // Create chat if needed
    if (!App.currentChat) {
      await App.createChat();
    }

    // Add user message
    await App.addUserMessage(content);

    // Auto-title from first user message
    if (App.currentChat.title === 'Untitled chat') {
      const title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
      App.renameChat(App.currentChat.id, title);
    }

    // Generate LLM response
    App.generateResponse();
  }
});

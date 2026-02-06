/* ============================================================
   Settings Panel – Right Side Controls
   ============================================================ */

const Settings = {
  /** Load settings from current chat into the UI */
  loadFromChat() {
    if (!App.currentChat) return;
    const s = App.currentChat.settings;

    document.getElementById('temperature-slider').value = s.temperature;
    document.getElementById('temperature-value').value = s.temperature;
    document.getElementById('media-resolution').value = s.media_resolution || 'Default';
    document.getElementById('thinking-level').value = s.thinking_level || 'High';
    document.getElementById('toggle-structured').checked = s.structured_output || false;
    document.getElementById('toggle-code-exec').checked = s.code_execution || false;
    document.getElementById('toggle-url-context').checked = s.url_context || false;

    // Model card
    document.querySelector('#model-selector .settings-card-title').textContent = s.model || 'gemini-3-pro-preview';
  },

  /** Save current UI settings back to the chat */
  saveToChat() {
    if (!App.currentChat) return;
    App.currentChat.settings = {
      ...App.currentChat.settings,
      temperature: parseFloat(document.getElementById('temperature-slider').value),
      media_resolution: document.getElementById('media-resolution').value,
      thinking_level: document.getElementById('thinking-level').value,
      structured_output: document.getElementById('toggle-structured').checked,
      code_execution: document.getElementById('toggle-code-exec').checked,
      url_context: document.getElementById('toggle-url-context').checked,
    };
    App.saveChat();
  },

  /** Show system instructions modal */
  showSystemInstructionsModal() {
    const currentInstructions = App.currentChat?.settings?.system_instructions || '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>System instructions</h3>
          <button class="icon-btn icon-btn-sm" id="modal-close">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="modal-body">
          <textarea placeholder="Optional tone and style instructions for the model...">${currentInstructions}</textarea>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" id="modal-cancel">Cancel</button>
          <button class="btn-primary" id="modal-save">Save</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    overlay.querySelector('#modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#modal-save').addEventListener('click', () => {
      const val = overlay.querySelector('textarea').value;
      if (App.currentChat) {
        App.currentChat.settings.system_instructions = val;
        App.saveChat();
      }
      overlay.remove();
    });

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  },
};

/* ============================================================
   Event Bindings
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Temperature slider ↔ input sync
  const slider = document.getElementById('temperature-slider');
  const valInput = document.getElementById('temperature-value');

  slider.addEventListener('input', () => {
    valInput.value = slider.value;
    Settings.saveToChat();
  });

  valInput.addEventListener('change', () => {
    let v = parseFloat(valInput.value);
    if (isNaN(v)) v = 1;
    v = Math.max(0, Math.min(2, v));
    valInput.value = v;
    slider.value = v;
    Settings.saveToChat();
  });

  // Dropdowns
  document.getElementById('media-resolution').addEventListener('change', () => Settings.saveToChat());
  document.getElementById('thinking-level').addEventListener('change', () => Settings.saveToChat());

  // Toggles
  document.getElementById('toggle-structured').addEventListener('change', () => Settings.saveToChat());
  document.getElementById('toggle-code-exec').addEventListener('change', () => Settings.saveToChat());
  document.getElementById('toggle-url-context').addEventListener('change', () => Settings.saveToChat());

  // Tools group collapse
  const toolsToggle = document.getElementById('tools-group-toggle');
  const toolsBody = document.getElementById('tools-group-body');
  toolsToggle.addEventListener('click', () => {
    toolsToggle.classList.toggle('collapsed');
    toolsBody.classList.toggle('collapsed');
  });

  // System instructions card → modal
  document.getElementById('system-instructions-card').addEventListener('click', () => {
    Settings.showSystemInstructionsModal();
  });

  // Settings button in sidebar
  document.getElementById('btn-settings-toggle').addEventListener('click', () => {
    document.getElementById('right-panel').classList.toggle('collapsed');
  });
});

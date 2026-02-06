/* ============================================================
   Settings Panel – Dynamic Schema-Driven Controls
   ============================================================ */

const Settings = {
  /** Load settings from current chat into the UI */
  loadFromChat() {
    if (!App.currentChat) return;
    this.updateModelCard();
    this.renderDynamicControls();
  },

  /** Update the model selector card with current provider + model info */
  updateModelCard() {
    const s = App.currentChat.settings;
    const provider = App.providers[s.provider];
    const model = provider?.models.find(m => m.id === s.model);

    const titleEl = document.querySelector('#model-selector .settings-card-title');
    const subtitleEl = document.querySelector('#model-selector .settings-card-subtitle');
    const descEl = document.querySelector('#model-selector .settings-card-desc');

    titleEl.textContent = model?.name || s.model;
    subtitleEl.textContent = s.model;

    // Show multimodal capabilities as badges
    const caps = model?.multimodal || [];
    let descText = model?.description || '';
    if (caps.length > 0) {
      descText += (descText ? ' · ' : '') + caps.join(', ');
    }
    descEl.textContent = descText;
  },

  /** Render all parameter controls from provider schema */
  renderDynamicControls() {
    const container = document.getElementById('dynamic-settings');
    if (!container) return;
    container.innerHTML = '';

    const s = App.currentChat.settings;
    const providerSchema = App.providers[s.provider];
    if (!providerSchema) return;

    const params = s.params || {};

    // Parameter controls
    for (const param of providerSchema.params || []) {
      const value = params[param.key] !== undefined ? params[param.key] : param.default;
      container.appendChild(this._createControl(param, value));
    }

    // Tools group
    const tools = providerSchema.tools || [];
    if (tools.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'settings-divider';
      container.appendChild(divider);
      container.appendChild(this._createToolsGroup(tools, params));
    }
  },

  /** Create a single parameter control element */
  _createControl(param, value) {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-item';
    wrapper.dataset.paramKey = param.key;

    switch (param.type) {
      case 'slider': {
        wrapper.innerHTML = `
          <label class="settings-label">${param.label}</label>
          <div class="slider-row">
            <input type="range" class="settings-slider" min="${param.min}" max="${param.max}" step="${param.step}" value="${value}">
            <input type="number" class="slider-value-input" min="${param.min}" max="${param.max}" step="${param.step}" value="${value}">
          </div>`;

        const slider = wrapper.querySelector('input[type="range"]');
        const numInput = wrapper.querySelector('input[type="number"]');

        slider.addEventListener('input', () => {
          numInput.value = slider.value;
          this._saveParam(param.key, parseFloat(slider.value));
        });

        numInput.addEventListener('change', () => {
          let v = parseFloat(numInput.value);
          if (isNaN(v)) v = param.default;
          v = Math.max(param.min, Math.min(param.max, v));
          numInput.value = v;
          slider.value = v;
          this._saveParam(param.key, v);
        });
        break;
      }

      case 'number': {
        wrapper.innerHTML = `
          <label class="settings-label">${param.label}</label>
          <input type="number" class="settings-number-input" min="${param.min}" max="${param.max}" value="${value}">`;

        wrapper.querySelector('input').addEventListener('change', (e) => {
          let v = parseFloat(e.target.value);
          if (isNaN(v)) v = param.default;
          v = Math.max(param.min, Math.min(param.max, v));
          e.target.value = v;
          this._saveParam(param.key, v);
        });
        break;
      }

      case 'select': {
        const options = (param.options || []).map(o => {
          const val = o.value || o;
          const label = o.label || o;
          return `<option value="${val}"${val === value ? ' selected' : ''}>${label}</option>`;
        }).join('');
        wrapper.innerHTML = `
          <label class="settings-label">${param.label}</label>
          <select class="settings-select">${options}</select>`;

        wrapper.querySelector('select').addEventListener('change', (e) => {
          this._saveParam(param.key, e.target.value);
        });
        break;
      }

      case 'toggle': {
        wrapper.className = 'settings-toggle-item';
        wrapper.dataset.paramKey = param.key;
        wrapper.innerHTML = `
          <span>${param.label}</span>
          <label class="toggle-switch">
            <input type="checkbox" ${value ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>`;

        wrapper.querySelector('input').addEventListener('change', (e) => {
          this._saveParam(param.key, e.target.checked);
        });
        break;
      }

      case 'text': {
        wrapper.innerHTML = `
          <label class="settings-label">${param.label}</label>
          <input type="text" class="settings-text-input" value="${value || ''}">`;

        wrapper.querySelector('input').addEventListener('change', (e) => {
          this._saveParam(param.key, e.target.value);
        });
        break;
      }
    }

    return wrapper;
  },

  /** Build the collapsible Tools group */
  _createToolsGroup(tools, params) {
    const group = document.createElement('div');
    group.className = 'settings-group';

    const header = document.createElement('button');
    header.className = 'settings-group-header';
    header.innerHTML = `
      <span class="material-symbols-outlined expand-icon">expand_more</span>
      <span class="group-title">Tools</span>`;

    const body = document.createElement('div');
    body.className = 'settings-group-body';

    for (const tool of tools) {
      const checked = params[tool.key] || false;
      const item = document.createElement('div');
      item.className = 'settings-toggle-item';
      item.dataset.paramKey = tool.key;
      item.innerHTML = `
        <span>${tool.label}</span>
        <label class="toggle-switch">
          <input type="checkbox" ${checked ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>`;

      item.querySelector('input').addEventListener('change', (e) => {
        this._saveParam(tool.key, e.target.checked);
      });

      body.appendChild(item);
    }

    header.addEventListener('click', () => {
      header.classList.toggle('collapsed');
      body.classList.toggle('collapsed');
    });

    group.appendChild(header);
    group.appendChild(body);
    return group;
  },

  /** Save a single param value and persist */
  _saveParam(key, value) {
    if (!App.currentChat) return;
    if (!App.currentChat.settings.params) App.currentChat.settings.params = {};
    App.currentChat.settings.params[key] = value;
    App.saveChat();
  },

  /** Kept for backward compatibility — dynamic controls auto-save via _saveParam */
  saveToChat() {},

  /** Show model picker modal */
  showModelPickerModal() {
    if (!App.currentChat) return;
    const s = App.currentChat.settings;
    const providerKeys = Object.keys(App.providers);
    if (!providerKeys.length) return;

    let activeProvider = s.provider || providerKeys[0];

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal model-picker-modal">
        <div class="modal-header">
          <h3>Select a model</h3>
          <button class="icon-btn icon-btn-sm modal-close-btn">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="model-picker-tabs"></div>
        <div class="model-picker-list"></div>
      </div>`;

    document.body.appendChild(overlay);

    const tabsContainer = overlay.querySelector('.model-picker-tabs');
    const listContainer = overlay.querySelector('.model-picker-list');

    const renderTabs = () => {
      tabsContainer.innerHTML = providerKeys.map(key => {
        const p = App.providers[key];
        return `<button class="model-picker-tab${key === activeProvider ? ' active' : ''}" data-provider="${key}">${p.name}</button>`;
      }).join('');

      tabsContainer.querySelectorAll('.model-picker-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          activeProvider = tab.dataset.provider;
          renderTabs();
          renderModels();
        });
      });
    };

    const renderModels = () => {
      const provider = App.providers[activeProvider];
      if (!provider) { listContainer.innerHTML = ''; return; }

      listContainer.innerHTML = provider.models.map(m => {
        const isActive = s.provider === activeProvider && s.model === m.id;
        const caps = (m.multimodal || []).map(c => {
          const icons = { image: 'image', video: 'videocam', audio: 'mic' };
          return `<span class="model-cap-badge" title="${c}"><span class="material-symbols-outlined">${icons[c] || 'attachment'}</span></span>`;
        }).join('');
        return `
          <button class="model-picker-item${isActive ? ' active' : ''}" data-model-id="${m.id}">
            <div class="model-picker-item-header">
              <div class="model-picker-item-name">${m.name}</div>
              ${caps ? `<div class="model-cap-badges">${caps}</div>` : ''}
            </div>
            <div class="model-picker-item-id">${m.id}</div>
            <div class="model-picker-item-desc">${m.description || ''}</div>
          </button>`;
      }).join('');

      listContainer.querySelectorAll('.model-picker-item').forEach(item => {
        item.addEventListener('click', () => {
          const modelId = item.dataset.modelId;
          this._selectModel(activeProvider, modelId);
          overlay.remove();
        });
      });
    };

    renderTabs();
    renderModels();

    overlay.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  },

  /** Apply model selection: update settings, re-render panel, save */
  _selectModel(providerKey, modelId) {
    if (!App.currentChat) return;
    const oldProvider = App.currentChat.settings.provider;
    App.currentChat.settings.provider = providerKey;
    App.currentChat.settings.model = modelId;

    // Reset params to new provider defaults when switching providers
    if (providerKey !== oldProvider) {
      const schema = App.providers[providerKey];
      if (schema) {
        const defaults = {};
        for (const p of schema.params || []) {
          defaults[p.key] = p.default;
        }
        App.currentChat.settings.params = defaults;
      }
    }

    this.updateModelCard();
    this.renderDynamicControls();
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

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  },
};

/* ============================================================
   Event Bindings
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Model selector card → picker modal
  document.getElementById('model-selector').addEventListener('click', () => {
    Settings.showModelPickerModal();
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

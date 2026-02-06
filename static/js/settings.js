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

  /** Get the current model schema from providers.json */
  _getModelSchema() {
    const s = App.currentChat?.settings;
    if (!s) return null;
    const provider = App.providers[s.provider];
    return provider?.models.find(m => m.id === s.model) || null;
  },

  _defaultToolValue(tool) {
    return tool?.key === 'thinking';
  },

  /** Render all parameter controls from model schema */
  renderDynamicControls() {
    const container = document.getElementById('dynamic-settings');
    if (!container) return;
    container.innerHTML = '';

    const model = this._getModelSchema();
    if (!model) return;

    const params = App.currentChat.settings.params || {};

    // Parameter controls
    for (const param of model.params || []) {
      const value = params[param.key] !== undefined ? params[param.key] : param.default;
      container.appendChild(this._createControl(param, value));
    }

    // Tools group
    const tools = model.tools || [];
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
      const checked = params[tool.key] !== undefined ? !!params[tool.key] : this._defaultToolValue(tool);
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

  /** Reset all params to model defaults */
  resetToDefaults() {
    if (!App.currentChat) return;
    const model = this._getModelSchema();
    if (!model) return;
    const defaults = {};
    for (const p of model.params || []) {
      defaults[p.key] = p.default;
    }
    for (const t of model.tools || []) {
      defaults[t.key] = this._defaultToolValue(t);
    }
    App.currentChat.settings.params = defaults;
    this.renderDynamicControls();
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
          <div class="modal-header-actions">
            <button class="icon-btn icon-btn-sm add-model-btn" title="Add model from OpenRouter">
              <span class="material-symbols-outlined">add</span>
            </button>
            <button class="icon-btn icon-btn-sm modal-close-btn">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
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

    let dragSrcId = null;

    const renderModels = () => {
      const provider = App.providers[activeProvider];
      if (!provider) { listContainer.innerHTML = ''; return; }

      listContainer.innerHTML = provider.models.map(m => {
        const isActive = s.provider === activeProvider && s.model === m.id;
        const caps = (m.multimodal || []).map(c => {
          const icons = { image: 'image', video: 'videocam', audio: 'mic' };
          return `<span class="model-cap-badge" title="${c}"><span class="material-symbols-outlined">${icons[c] || 'attachment'}</span></span>`;
        }).join('');
        const thinkingBadge = (m.tools || []).some(t => t.key === 'thinking')
          ? '<span class="model-cap-badge thinking-badge" title="Thinking"><span class="material-symbols-outlined">psychology</span></span>'
          : '';
        const deleteBtn = isActive ? '' : `<button class="model-picker-delete" data-model-id="${m.id}" title="Remove model"><span class="material-symbols-outlined">delete</span></button>`;
        return `
          <div class="model-picker-item${isActive ? ' active' : ''}" data-model-id="${m.id}" draggable="true">
            <span class="drag-handle material-symbols-outlined" title="Drag to reorder">drag_indicator</span>
            <div class="model-picker-item-body" data-model-id="${m.id}">
              <div class="model-picker-item-header">
                <div class="model-picker-item-name">${m.name}</div>
                <div class="model-cap-badges">${thinkingBadge}${caps}</div>
              </div>
              <div class="model-picker-item-id">${m.id}</div>
              <div class="model-picker-item-desc">${m.description || ''}</div>
            </div>
            ${deleteBtn}
          </div>`;
      }).join('');

      // Select model on body click
      listContainer.querySelectorAll('.model-picker-item-body').forEach(body => {
        body.addEventListener('click', () => {
          const modelId = body.dataset.modelId;
          this._selectModel(activeProvider, modelId);
          overlay.remove();
        });
      });

      // Delete model
      listContainer.querySelectorAll('.model-picker-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const modelId = btn.dataset.modelId;
          if (!confirm(`Remove "${modelId}" from the model list?`)) return;
          try {
            const updated = await App.api('DELETE', `/api/providers/${activeProvider}/models/${encodeURIComponent(modelId)}`);
            App.providers[activeProvider] = updated;
            renderModels();
          } catch (err) {
            console.error('Delete model failed:', err);
          }
        });
      });

      // Drag-and-drop reordering
      listContainer.querySelectorAll('.model-picker-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
          dragSrcId = item.dataset.modelId;
          item.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          listContainer.querySelectorAll('.model-picker-item').forEach(el => el.classList.remove('drag-over-above', 'drag-over-below'));
          dragSrcId = null;
        });

        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (item.dataset.modelId === dragSrcId) return;
          const rect = item.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          item.classList.toggle('drag-over-above', e.clientY < midY);
          item.classList.toggle('drag-over-below', e.clientY >= midY);
        });

        item.addEventListener('dragleave', () => {
          item.classList.remove('drag-over-above', 'drag-over-below');
        });

        item.addEventListener('drop', async (e) => {
          e.preventDefault();
          item.classList.remove('drag-over-above', 'drag-over-below');
          const targetId = item.dataset.modelId;
          if (!dragSrcId || dragSrcId === targetId) return;

          const provider = App.providers[activeProvider];
          const models = provider.models;
          const srcIdx = models.findIndex(m => m.id === dragSrcId);
          let tgtIdx = models.findIndex(m => m.id === targetId);
          if (srcIdx === -1 || tgtIdx === -1) return;

          // Determine insert position based on cursor
          const rect = item.getBoundingClientRect();
          const insertAfter = e.clientY >= rect.top + rect.height / 2;
          if (insertAfter) tgtIdx++;

          // Reorder
          const [moved] = models.splice(srcIdx, 1);
          const newIdx = tgtIdx > srcIdx ? tgtIdx - 1 : tgtIdx;
          models.splice(newIdx, 0, moved);

          renderModels();

          // Persist to backend
          try {
            const ids = models.map(m => m.id);
            const updated = await App.api('PUT', `/api/providers/${activeProvider}/models/reorder`, { model_ids: ids });
            App.providers[activeProvider] = updated;
          } catch (err) {
            console.error('Reorder failed:', err);
          }
        });
      });
    };

    renderTabs();
    renderModels();

    overlay.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.add-model-btn').addEventListener('click', () => {
      overlay.remove();
      this.showAddModelModal();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  },

  /** Show modal to browse and add OpenRouter models */
  async showAddModelModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal add-model-modal">
        <div class="modal-header">
          <h3>Add model from OpenRouter</h3>
          <button class="icon-btn icon-btn-sm modal-close-btn">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="add-model-controls">
          <div class="history-search-wrap">
            <span class="material-symbols-outlined">search</span>
            <input type="text" class="add-model-search" placeholder="Search models..." autocomplete="off">
          </div>
        </div>
        <div class="add-model-list">
          <div class="add-model-loading">Loading models from OpenRouter...</div>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Fetch models
    let allModels = [];
    try {
      allModels = await App.api('GET', '/api/openrouter/models');
    } catch (e) {
      overlay.querySelector('.add-model-list').innerHTML = `<div class="add-model-loading">Failed to load models. Make sure your OpenRouter API key is configured.</div>`;
      return;
    }

    // Sort by name
    allModels.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

    const existingIds = new Set((App.providers.openrouter?.models || []).map(m => m.id));
    let searchQuery = '';

    const parseModality = (modality) => {
      if (!modality) return [];
      const input = modality.split('->')[0] || '';
      const caps = [];
      if (input.includes('image')) caps.push('image');
      if (input.includes('video')) caps.push('video');
      if (input.includes('audio')) caps.push('audio');
      return caps;
    };

    // Detect if model supports explicit thinking toggle
    const needsThinkingToggle = (model) => {
      const params = model.supported_parameters || [];
      if (!params.includes('reasoning')) return false;
      // Models that think by default don't need the toggle
      const id = (model.id || '').toLowerCase();
      const autoThink = ['deepseek-r1', 'deepseek-reasoner', 'qwq'];
      return !autoThink.some(p => id.includes(p));
    };

    const formatPrice = (price) => {
      if (!price) return '';
      const p = parseFloat(price);
      if (isNaN(p) || p === 0) return 'Free';
      if (p < 0.001) return `$${(p * 1000000).toFixed(2)}/M`;
      return `$${p.toFixed(4)}/1k`;
    };

    const renderList = () => {
      const listEl = overlay.querySelector('.add-model-list');
      let filtered = allModels;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(m =>
          (m.name || '').toLowerCase().includes(q) ||
          (m.id || '').toLowerCase().includes(q)
        );
      }

      if (!filtered.length) {
        listEl.innerHTML = '<div class="add-model-loading">No models found</div>';
        return;
      }

      // Show max 100 results for performance
      const shown = filtered.slice(0, 100);
      listEl.innerHTML = shown.map(m => {
        const already = existingIds.has(m.id);
        const modality = m.architecture?.modality || '';
        const caps = parseModality(modality);
        const capsHtml = caps.map(c => {
          const icons = { image: 'image', video: 'videocam', audio: 'mic' };
          return `<span class="model-cap-badge" title="${c}"><span class="material-symbols-outlined">${icons[c]}</span></span>`;
        }).join('');
        const thinkingHtml = needsThinkingToggle(m) ? '<span class="model-cap-badge thinking-badge" title="Thinking"><span class="material-symbols-outlined">psychology</span></span>' : '';
        const ctx = m.context_length ? `${(m.context_length / 1000).toFixed(0)}k ctx` : '';
        const price = formatPrice(m.pricing?.prompt);
        const meta = [ctx, price].filter(Boolean).join(' · ');
        return `
          <div class="add-model-item${already ? ' already-added' : ''}" data-id="${m.id}">
            <div class="add-model-item-info">
              <div class="add-model-item-name">${App._escapeHtml(m.name || m.id)}</div>
              <div class="add-model-item-meta">${m.id}${meta ? ' · ' + meta : ''}</div>
            </div>
            <div class="add-model-item-right">
              ${thinkingHtml}${capsHtml}
              ${already
                ? '<span class="add-model-added">Added</span>'
                : '<button class="add-model-btn-add" title="Add"><span class="material-symbols-outlined">add_circle</span></button>'
              }
            </div>
          </div>`;
      }).join('');

      if (filtered.length > 100) {
        listEl.innerHTML += `<div class="add-model-loading">${filtered.length - 100} more results — refine your search</div>`;
      }

      // Add button handlers
      listEl.querySelectorAll('.add-model-btn-add').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const item = btn.closest('.add-model-item');
          const modelId = item.dataset.id;
          const model = allModels.find(m => m.id === modelId);
          if (!model) return;

          // Get default params from first existing model
          const firstModel = App.providers.openrouter?.models[0];
          const defaultParams = firstModel?.params || [
            { key: 'temperature', label: 'Temperature', type: 'slider', min: 0, max: 2, step: 0.05, default: 1.0 },
            { key: 'top_p', label: 'Top P', type: 'slider', min: 0, max: 1, step: 0.05, default: 1.0 },
            { key: 'max_tokens', label: 'Max output tokens', type: 'number', min: 1, max: 65536, default: 65536 },
          ];

          const tools = [];
          if (needsThinkingToggle(model)) {
            tools.push({ key: 'thinking', label: 'Thinking' });
          }

          const newModel = {
            id: model.id,
            name: model.name || model.id,
            description: (model.description || '').substring(0, 100),
            multimodal: parseModality(model.architecture?.modality),
            params: JSON.parse(JSON.stringify(defaultParams)),
            tools,
          };

          // Update max_tokens if context_length is available
          if (model.context_length) {
            const maxTok = newModel.params.find(p => p.key === 'max_tokens');
            if (maxTok) maxTok.max = model.context_length;
          }

          try {
            const updated = await App.api('POST', '/api/providers/openrouter/models', newModel);
            App.providers.openrouter = updated;
            existingIds.add(model.id);
            // Update the item in-place
            item.classList.add('already-added');
            item.querySelector('.add-model-item-right').innerHTML =
              (item.querySelector('.add-model-item-right').querySelectorAll('.model-cap-badge').length > 0
                ? item.querySelector('.add-model-item-right').innerHTML.replace(/<button.*<\/button>/, '<span class="add-model-added">Added</span>')
                : '<span class="add-model-added">Added</span>');
            App.showToast(`Added ${model.name || model.id}`);
          } catch (err) {
            App.showToast('Failed to add model');
            console.error(err);
          }
        });
      });
    };

    renderList();

    // Search
    const searchInput = overlay.querySelector('.add-model-search');
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = searchInput.value.trim();
        renderList();
      }, 200);
    });
    searchInput.focus();
  },

  /** Apply model selection: update settings, re-render panel, save */
  _selectModel(providerKey, modelId) {
    if (!App.currentChat) return;
    App.currentChat.settings.provider = providerKey;
    App.currentChat.settings.model = modelId;

    // Reset params to new model's defaults (each model has its own params now)
    const provider = App.providers[providerKey];
    const model = provider?.models.find(m => m.id === modelId);
    if (model) {
      const defaults = {};
      for (const p of model.params || []) {
        defaults[p.key] = p.default;
      }
      for (const t of model.tools || []) {
        defaults[t.key] = this._defaultToolValue(t);
      }
      App.currentChat.settings.params = defaults;
    }

    this.updateModelCard();
    this.renderDynamicControls();
    App.saveChat();
    App.updateKeyIndicator();
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

  // Reset settings button
  document.getElementById('btn-reset-settings').addEventListener('click', () => {
    Settings.resetToDefaults();
  });

});

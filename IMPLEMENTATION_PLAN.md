# IMPLEMENTATION PLAN — Local AI Studio

Step-by-step execution checklist. First target: working chat with `google/gemini-3-pro-preview` via OpenRouter.

---

## Phase 1: Backend — LLM Proxy Endpoint (OpenRouter)

The skeleton has CRUD for chats but **zero** LLM integration. We need a streaming proxy endpoint.

- [ ] **1.1** Add `python-dotenv` and `httpx` to `requirements.txt`
- [ ] **1.2** Load `.env` in `main.py` (`from dotenv import load_dotenv; load_dotenv()`)
- [ ] **1.3** Read `OPENROUTER_API_KEY` from env at startup, fail loudly if missing
- [ ] **1.4** Create `POST /api/chats/{id}/generate` endpoint that:
  - [ ] Reads the chat JSON (messages + settings)
  - [ ] Builds the OpenRouter request body:
    - `model`: from `settings.provider` + `settings.model` (e.g. `"google/gemini-3-pro-preview"`)
    - `messages`: convert chat messages to OpenRouter format (`role: "user"/"assistant"`, content)
    - `system`: from `settings.system_instructions` (if non-empty)
    - `temperature`, `top_p`, `top_k`, `max_tokens`: from `settings.params`
    - `stream: true`
  - [ ] Sends request to `https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer $KEY`
  - [ ] Returns a `StreamingResponse` (SSE) that forwards OpenRouter's SSE chunks as-is
  - [ ] On stream end, auto-appends the model message (content + thoughts if present) to the chat JSON and saves
- [ ] **1.5** Handle errors gracefully:
  - [ ] Missing API key → 500 with clear message
  - [ ] OpenRouter HTTP errors (401, 429, 5xx) → forward status + error message to client as SSE `error` event
  - [ ] Network failures → SSE error event
- [ ] **1.6** Update `ChatSettings` pydantic model to match the new schema:
  - `provider: str = "openrouter"`
  - `model: str = "google/gemini-3-pro-preview"`
  - `system_instructions: str = ""`
  - `params: dict = {}` (dynamic key-value, not hardcoded fields)
- [ ] **1.7** Update `POST /api/chats` (create) to use new default settings structure:
  ```json
  {
    "provider": "openrouter",
    "model": "google/gemini-3-pro-preview",
    "system_instructions": "",
    "params": { "temperature": 1.0, "top_p": 1.0, "max_tokens": 4096 }
  }
  ```
- [ ] **1.8** Update sample chat JSON to match new settings schema
- [ ] **1.9** Test the endpoint manually with curl — confirm SSE chunks arrive

---

## Phase 2: Frontend — Send & Stream Responses

Currently `submitMessage()` in `chat.js` saves the user message but never calls the LLM.

- [ ] **2.1** In `app.js`, add `App.generateResponse()` method:
  - [ ] Call `POST /api/chats/{id}/generate`
  - [ ] Read the SSE stream with `EventSource` or `fetch` + `ReadableStream`
  - [ ] Create a placeholder model message in the UI immediately (empty content, spinner/cursor)
  - [ ] On each SSE `data` chunk, parse the delta and append to the placeholder's content
  - [ ] Re-render markdown incrementally (or on a throttle/debounce, e.g. every 100ms)
  - [ ] On stream `[DONE]`, finalize the message, reload chat from server to sync state
  - [ ] On SSE error event, show error inline in the model message bubble (red text)
- [ ] **2.2** Wire `submitMessage()` in `chat.js` to call `App.generateResponse()` after adding the user message
- [ ] **2.3** Add a "Stop" button that appears during generation:
  - [ ] Replace the "Run" button with a "Stop" button while streaming
  - [ ] On click, abort the fetch/stream and keep partial content
- [ ] **2.4** Disable the prompt textarea + Run button while generating (prevent double-send)
- [ ] **2.5** Scroll to bottom smoothly during streaming (on each content update)
- [ ] **2.6** Handle the `thinking` / `thoughts` field from OpenRouter response:
  - [ ] If the model returns a `reasoning` or `thinking` field in the delta, accumulate it separately
  - [ ] Render it in the existing thoughts accordion UI
- [ ] **2.7** Test end-to-end: type a message → see streamed response appear with markdown rendering

---

## Phase 3: Provider Config Schema & Dynamic Settings Panel

The right panel currently has hardcoded controls. Replace with schema-driven rendering.

- [ ] **3.1** Create `static/providers.json` with provider definitions:
  - [ ] `openrouter` entry with models list (start with `google/gemini-3-pro-preview`) and params schema
  - [ ] Stub entries for `anthropic`, `openai`, `google` (models + params) — won't be wired yet, just schema
- [ ] **3.2** In `app.js`, load `providers.json` at startup and store as `App.providers`
- [ ] **3.3** Rewrite `settings.js` — `Settings.renderDynamicControls()`:
  - [ ] Clear the settings panel body (below system instructions card)
  - [ ] Read current provider from `App.currentChat.settings.provider`
  - [ ] Look up provider schema from `App.providers`
  - [ ] For each param in `provider.params`, render the appropriate control:
    - [ ] `slider` → range input + number input (synced), with min/max/step/default
    - [ ] `number` → number input with min/max
    - [ ] `select` → dropdown with options list
    - [ ] `toggle` → on/off switch
    - [ ] `text` → text input
  - [ ] Bind each control to auto-save into `App.currentChat.settings.params[key]`
  - [ ] On provider change, reset params to the new provider's defaults
- [ ] **3.4** Remove hardcoded temperature/media-resolution/thinking-level HTML from `index.html`
  - [ ] Replace with an empty `<div id="dynamic-settings"></div>` container
- [ ] **3.5** Remove the hardcoded settings event bindings from `settings.js` (slider sync, dropdowns, toggles)
- [ ] **3.6** Update `Settings.loadFromChat()` to call `renderDynamicControls()` instead of setting individual inputs
- [ ] **3.7** Update `Settings.saveToChat()` to read values from dynamic controls
- [ ] **3.8** Update model selector card to show current provider name + model name from schema
- [ ] **3.9** Render the Tools group dynamically too — only show tools the provider supports (from schema)
- [ ] **3.10** Test: switch providers → controls change, values persist in chat JSON

---

## Phase 4: Provider/Model Picker Modal

The model selector card in the right panel should open a picker modal.

- [ ] **4.1** Create `Settings.showModelPickerModal()`:
  - [ ] Modal with provider tabs/dropdown at top
  - [ ] Model list for selected provider (from `providers.json`)
  - [ ] Each model shows: name, ID, description
  - [ ] Click a model → updates `settings.provider` + `settings.model`, closes modal
- [ ] **4.2** Wire `#model-selector` card click to open the modal
- [ ] **4.3** On model selection:
  - [ ] Update chat settings
  - [ ] Re-render the dynamic settings panel (new provider may have different params)
  - [ ] Update the model selector card display
  - [ ] Auto-save chat
- [ ] **4.4** Style the modal to match the dark theme (same style as system instructions modal)
- [ ] **4.5** Test: open modal → pick different model → settings panel updates → chat saves

---

## Phase 5: Markdown Improvements

### 5a: Full highlight.js bundle
- [ ] **5a.1** Replace the highlight.js CDN URL in `index.html` with the full language bundle:
  - Use `highlight.min.js` from cdnjs/jsdelivr that includes ALL languages
  - Or load the core + register additional languages individually
- [ ] **5a.2** Verify: code blocks with Python, Rust, Go, SQL, YAML, Dockerfile etc. all highlight correctly

### 5b: Mermaid diagrams
- [ ] **5b.1** Add mermaid.js CDN script to `index.html`
- [ ] **5b.2** In `chat.js`, update the `marked.Renderer.code` to detect language `"mermaid"`:
  - [ ] Instead of syntax highlighting, render into a `<div class="mermaid-container">` with the raw source
  - [ ] After render, call `mermaid.run()` on those containers
- [ ] **5b.3** Configure mermaid with dark theme to match the app
- [ ] **5b.4** Add fallback: if mermaid parse fails, show as regular code block with small error note
- [ ] **5b.5** Add CSS for `.mermaid-container` (border, padding, same style as code blocks)
- [ ] **5b.6** Test: send a message asking the model to generate a mermaid diagram

---

## Phase 6: File Upload & Preview

### 6a: Backend
- [ ] **6a.1** Add `python-multipart` to `requirements.txt`
- [ ] **6a.2** Create `POST /api/chats/{id}/upload` endpoint:
  - [ ] Accept multipart file upload
  - [ ] Save to `data/chats/{chat_id}/files/{uuid}_{original_name}`
  - [ ] Return file metadata: `{ id, name, type, size, path }`
- [ ] **6a.3** Create `GET /api/chats/{id}/files/{filename}` endpoint:
  - [ ] Serve the file from disk with correct Content-Type
- [ ] **6a.4** Update `DELETE /api/chats/{id}` to also remove the `data/chats/{id}/` directory (files)
- [ ] **6a.5** Update the Message pydantic model to include `files: list[dict] = []`

### 6b: Frontend — Upload
- [ ] **6b.1** Wire the attach button (add_circle) to open a file input dialog
- [ ] **6b.2** Implement drag-and-drop on the prompt box:
  - [ ] Detect dragenter/dragover/drop events
  - [ ] Show visual drop indicator (border highlight)
  - [ ] On drop, upload the file(s)
- [ ] **6b.3** Upload flow:
  - [ ] POST to `/api/chats/{id}/upload`
  - [ ] On success, create a new user message with `content: ""` and `files: [metadata]`
  - [ ] Save chat and re-render
- [ ] **6b.4** Show upload progress indicator (optional: simple spinner is fine)

### 6c: Frontend — Preview in messages
- [ ] **6c.1** Update `Chat.renderTurn()` to check `msg.files` array
- [ ] **6c.2** For each file, render based on mime type:
  - [ ] `image/*` → inline `<img>` thumbnail, click to expand
  - [ ] `video/*` → inline `<video>` with controls
  - [ ] `audio/*` → inline `<audio>` player
  - [ ] `.txt/.md/.csv/.log/.json/.xml/.yaml` → text preview card, click to open in modal
  - [ ] `.pdf` → file card with "Open in new tab" link
  - [ ] Everything else → generic file card (icon + name + size)
- [ ] **6c.3** Add CSS for file preview cards and media elements
- [ ] **6c.4** Image expand: lightbox overlay on click (simple fullscreen with close button)
- [ ] **6c.5** Test: upload image, video, text file, PDF — each renders correctly

---

## Phase 7: Polish & Interactions

- [ ] **7.1** Rerun button (sparkle): on click, resend from that point in conversation
  - [ ] Delete all messages after the clicked message
  - [ ] Call `App.generateResponse()` to get a new model reply
- [ ] **7.2** Edit mode for model messages (currently only user messages):
  - [ ] Show edit button on model turn hover
  - [ ] Edit shows raw markdown in textarea
  - [ ] On save, re-render the markdown
- [ ] **7.3** "Alt+Enter to append" behavior:
  - [ ] Alt+Enter adds the message without triggering generation (just appends to conversation)
- [ ] **7.4** Reset settings button: reset current chat params to provider defaults
- [ ] **7.5** Auto-title improvement: after first model response, use first ~50 chars of user message as title
- [ ] **7.6** Token count: update to count tokens from all messages including system instructions
- [ ] **7.7** Prompt box border highlight on focus-within (already in CSS, verify it works)
- [ ] **7.8** Verify sidebar collapse/expand animation is smooth
- [ ] **7.9** Verify right panel collapse/expand animation is smooth
- [ ] **7.10** Verify responsive breakpoints (<900px right panel overlay, <700px sidebar overlay)
- [ ] **7.11** Test all context menu actions (delete, copy text, copy markdown)
- [ ] **7.12** Verify scrollbar styling (thin, dark thumb)

---

## Phase 8: API Key Management

- [ ] **8.1** Backend: `GET /api/keys` — return which providers have keys configured (not the keys themselves)
- [ ] **8.2** Backend: `POST /api/keys` — save API keys to a `.env` or `data/keys.json` (encrypted or plaintext)
- [ ] **8.3** Frontend: wire the `key_off` button in prompt bar to open an API key management modal
- [ ] **8.4** Modal: input fields for each provider's API key, with save/clear buttons
- [ ] **8.5** Show key status indicator: green dot if key present, red if missing
- [ ] **8.6** On missing key, show helpful error when trying to generate

---

## Execution Order

| Priority | Phases | What you get |
|----------|--------|-------------|
| **NOW**  | 1 → 2  | Working chat — type, get streamed LLM response |
| Next     | 3 → 4  | Multi-provider support, dynamic settings |
| Then     | 5a, 5b | Better markdown, mermaid diagrams |
| Then     | 6      | File upload & preview |
| Last     | 7, 8   | Polish, rerun, API key UI |

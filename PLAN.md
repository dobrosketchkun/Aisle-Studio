# IMPLEMENTATION PLAN — LOCAL AI STUDIO

Full feature parity with Google AI Studio UI as shown in reference screenshots.

---

## LAYOUT (3-column)

### Left Sidebar (220px, collapsible)
- [ ] Logo area: icon + "Local AI Studio" text
- [ ] **New chat** button (+ icon)
- [ ] Nav section: "Chats" header with icon
- [ ] Chat history list — each item:
  - [ ] Truncated title, clickable to open
  - [ ] Active item highlight (darker bg)
  - [ ] Three-dot menu on hover → **Rename**, **Delete**
  - [ ] Sorted by most recent
- [ ] Bottom section: **Settings** button
- [ ] Sidebar collapse/expand via hamburger in toolbar
- [ ] Smooth width transition on collapse

### Main Chat Area (flex, center-aligned max 820px)
- [ ] **Toolbar** (top bar):
  - [ ] Hamburger menu button (toggles sidebar)
  - [ ] Editable chat title (click pencil → contenteditable, Enter/blur to save)
  - [ ] Token count display (rough `~chars/4` estimate)
  - [ ] Right side: tune button (toggles right panel)
- [ ] **Empty state**: centered icon + "Start a conversation" when no messages
- [ ] **Messages area** (scrollable):
  - [ ] Scroll to bottom on new message
  - [ ] Fade gradient overlay at bottom edge above input
  - [ ] Disclaimer bar: info icon + "LLMs may make mistakes, so double-check outputs."
- [ ] **Input footer** (prompt box):
  - [ ] Rounded container (16px radius), subtle bg `rgba(255,255,255,0.07)`
  - [ ] Auto-growing textarea (min 21px, max 302px height)
  - [ ] Placeholder: "Start typing a prompt, use alt + enter to append"
  - [ ] **Enter** → submit, **Shift+Enter** → newline
  - [ ] Bottom button row:
    - Left: key_off icon button, "Tools" button (widgets icon + label)
    - Right: add_circle (attach) button, **"Run ↵"** button (styled, 32px height)

### Right Panel (300px, collapsible)
- [ ] **Header**: "Run settings" title, get-code button, reset button, close button
- [ ] **Provider / Model selector card**: clickable → opens picker modal
  - [ ] Provider dropdown (OpenRouter, Anthropic, OpenAI, Google, fal, local/ollama, custom)
  - [ ] Model dropdown (populated per provider from a config/registry)
  - [ ] Shows: provider name, model ID, short description
- [ ] **System instructions card**: clickable → opens modal dialog
  - [ ] Modal: header with close, textarea for instructions, Cancel + Save buttons
  - [ ] Backdrop click closes modal
- [ ] **Divider**
- [ ] **Dynamic settings area** — controls rendered from a per-provider schema, not hardcoded.
  Each provider defines which parameters it supports and their types/ranges.

#### Provider Settings Schema
Stored in a config file (e.g. `static/providers.json` or embedded in JS).
Each provider entry declares its available parameters:
```json
{
  "openrouter": {
    "name": "OpenRouter",
    "models": [ { "id": "google/gemini-3-pro", "name": "Gemini 3 Pro", "desc": "..." }, ... ],
    "params": [
      { "key": "temperature",       "type": "slider",   "min": 0, "max": 2, "step": 0.05, "default": 1.0 },
      { "key": "top_p",             "type": "slider",   "min": 0, "max": 1, "step": 0.01, "default": 1.0 },
      { "key": "top_k",             "type": "number",   "min": 0, "max": 500, "default": 0 },
      { "key": "max_tokens",        "type": "number",   "min": 1, "max": 1000000, "default": 4096 },
      { "key": "frequency_penalty", "type": "slider",   "min": -2, "max": 2, "step": 0.1, "default": 0 },
      { "key": "presence_penalty",  "type": "slider",   "min": -2, "max": 2, "step": 0.1, "default": 0 }
    ]
  },
  "anthropic": {
    "name": "Anthropic",
    "models": [ { "id": "claude-sonnet-4-5-20250929", "name": "Claude Sonnet 4.5", "desc": "..." }, ... ],
    "params": [
      { "key": "temperature",       "type": "slider",   "min": 0, "max": 1, "step": 0.01, "default": 1.0 },
      { "key": "top_p",             "type": "slider",   "min": 0, "max": 1, "step": 0.01, "default": 1.0 },
      { "key": "top_k",             "type": "number",   "min": 0, "max": 500, "default": 0 },
      { "key": "max_tokens",        "type": "number",   "min": 1, "max": 200000, "default": 8192 },
      { "key": "thinking",          "type": "select",   "options": ["disabled", "low", "medium", "high"], "default": "disabled" }
    ]
  },
  "google": {
    "params": [
      { "key": "temperature",       "type": "slider",   "min": 0, "max": 2, "step": 0.05, "default": 1.0 },
      { "key": "top_p",             "type": "slider",   "min": 0, "max": 1, "step": 0.01, "default": 1.0 },
      { "key": "top_k",             "type": "number",   "min": 0, "max": 500, "default": 40 },
      { "key": "max_tokens",        "type": "number",   "min": 1, "max": 1000000, "default": 8192 },
      { "key": "thinking_level",    "type": "select",   "options": ["None", "Low", "Medium", "High"], "default": "High" },
      { "key": "media_resolution",  "type": "select",   "options": ["Default", "Low", "High"], "default": "Default" }
    ]
  }
}
```

#### Dynamic Rendering
- [ ] On provider/model change, **rebuild** the settings panel controls from the schema
- [ ] Supported control types:
  - `slider` — range input + number input (synced), respects min/max/step
  - `number` — number input with min/max
  - `select` — dropdown with options list
  - `toggle` — on/off switch (boolean)
  - `text` — text input field
- [ ] Unknown/missing params just don't render (no errors)
- [ ] Current values saved in chat JSON under `settings.params` as `{ key: value }` dict
- [ ] On provider switch, reset params to new provider's defaults
- [ ] **Tools group** (collapsible with chevron) — also provider-dependent:
  - [ ] Only show tools that the selected provider/model supports
- [ ] All settings auto-save to current chat JSON on change

---

## CHAT MESSAGES

### User Turn
- [ ] "User" label in blue-tinted color (`#a0b4f0`)
- [ ] Plain text content (HTML-escaped, not markdown-rendered)
- [ ] Hover actions (floating pill, top-right):
  - [ ] **Edit** (pencil icon) — switches to edit mode
  - [ ] **Rerun** (sparkle SVG with gradient: `#87A9FF` → `#A7B8EE` → `#F1DCC7`)
  - [ ] **More** (three-dot `more_vert`) — opens context menu

### Model Turn
- [ ] "Model" label in secondary color
- [ ] **Thoughts section** (collapsible accordion):
  - [ ] Sparkle icon (same gradient) + "Thoughts" label + "Expand to view model thoughts" summary
  - [ ] Chevron rotates on expand
  - [ ] Body: markdown-rendered thought content in muted color
  - [ ] Animated expand/collapse (max-height transition)
- [ ] **Content**: full markdown rendering (see Markdown section below)
- [ ] Hover actions (floating pill, top-right):
  - [ ] **Edit** (pencil icon) — switches to edit mode (raw markdown in textarea), same as user edit
  - [ ] **Rerun** (sparkle)
  - [ ] **More** (three-dot) — opens context menu

### Context Menu (on three-dot click)
- [ ] Positioned at button, clamped to viewport
- [ ] Items:
  - [ ] **Delete** (trash icon) — removes message, re-renders
  - [ ] **Branch from here** (fork icon) — future feature
  - [ ] **Copy as text** (copy icon) — clipboard plaintext
  - [ ] **Copy as markdown** (markdown icon) — clipboard raw markdown
- [ ] Closes on click outside

### Edit Mode (user AND model messages)
- [ ] Blue accent border (`#87a9ff`) around content area
- [ ] Content replaced with auto-sizing textarea pre-filled with raw text
  - User turns: plain text
  - Model turns: raw markdown source (re-renders on save)
- [ ] "Stop editing" button → saves changes, re-renders message
- [ ] Textarea auto-grows on input

---

## MARKDOWN RENDERING (in model responses)

Using `marked.js` + `highlight.js` + `mermaid.js`:

- [ ] Headings H1–H6 (proper sizing, weights, margins)
- [ ] **Bold**, *italic*, ***bold+italic***, ~~strikethrough~~
- [ ] `Inline code` (dark bg `#323232`, rounded)
- [ ] Paragraphs with proper spacing
- [ ] Unordered lists (disc bullets, nested)
- [ ] Ordered lists (numbered, nested)
- [ ] Blockquotes (left border, muted color)
- [ ] Horizontal rules
- [ ] Links (blue `#87a9ff`, hover underline)
- [ ] Images (max-width, rounded corners)
- [ ] Tables (bordered, header bg, alternating rows)

### Code Blocks
- [ ] Wrapper with rounded corners + subtle border
- [ ] **Header bar**: code icon + language name (left), copy + collapse buttons (right)
- [ ] Syntax highlighting via highlight.js (github-dark theme)
- [ ] **Full language bundle** — load highlight.js with ALL common languages, not just the default set.
  Include at minimum: python, javascript, typescript, java, c, cpp, csharp, go, rust, ruby, php,
  swift, kotlin, scala, r, matlab, sql, bash/shell, powershell, perl, lua, haskell, elixir, clojure,
  dart, groovy, objective-c, assembly, fortran, cobol, lisp, scheme, prolog, vhdl, verilog,
  html, css, scss, less, xml, json, yaml, toml, ini, csv, markdown,
  dockerfile, nginx, apache, graphql, protobuf, terraform, cmake, makefile,
  latex, diff/patch, http, regex
- [ ] Auto-detect language when not specified (highlight.js `highlightAuto`)
- [ ] **Copy button**: copies raw code, shows checkmark for 1.5s
- [ ] **Collapse button**: toggles pre visibility, icon switches expand_less ↔ expand_more
- [ ] Horizontal scroll for long lines

### Mermaid Diagrams
- [ ] Detect ` ```mermaid ` code blocks in marked.js renderer
- [ ] Render as SVG via mermaid.js (CDN) instead of code block
- [ ] Use dark theme config to match the app
- [ ] Wrap in a container with subtle border, same style as code blocks
- [ ] Fallback: if mermaid parse fails, show as regular code block with error note

---

## DATA PERSISTENCE

### Backend API (FastAPI)
- [ ] `GET /api/chats` — list all chats (id, title, updated_at), sorted by recency
- [ ] `POST /api/chats` — create new chat with defaults
- [ ] `GET /api/chats/{id}` — full chat with messages + settings
- [ ] `PUT /api/chats/{id}` — partial update (title, settings, messages)
- [ ] `DELETE /api/chats/{id}` — remove chat file
- [ ] Resilient to corrupt JSON files (skip on list, 404 on get)

### Storage Format
- [ ] One JSON file per chat in `data/chats/{uuid}.json`
- [ ] Schema:
  ```json
  {
    "id": "uuid",
    "title": "string",
    "created_at": "iso",
    "updated_at": "iso",
    "settings": {
      "provider": "openrouter",
      "model": "google/gemini-3-pro",
      "system_instructions": "string",
      "params": { "temperature": 1.0, "top_p": 1.0, "max_tokens": 4096 }
    },
    "messages": [
      {
        "id": "uuid",
        "role": "user|model",
        "content": "string",
        "thoughts": "string",
        "files": [
          { "id": "uuid", "name": "photo.png", "type": "image/png", "path": "relative/path" }
        ]
      }
    ]
  }
  ```

### File / Media Storage
- [ ] Files stored on disk at `data/chats/{chat_id}/files/{file_uuid}_{original_name}`
- [ ] JSON message only stores metadata (id, name, mime type, relative path) — **never** base64
- [ ] Backend API:
  - [ ] `POST /api/chats/{id}/upload` — multipart upload, returns file metadata
  - [ ] `GET /api/chats/{id}/files/{filename}` — serve file for preview/download
  - [ ] On chat delete, remove the entire `data/chats/{chat_id}/` directory (JSON + files)
- [ ] Each uploaded file becomes its **own message** (role=user, content="", files=[...])
  so the user can delete individual files from the conversation independently
- [ ] Drag-and-drop onto prompt box, or click attach (+) button

### File Preview (in chat messages)
Render differently based on mime type:
- [ ] **Images** (image/*): inline thumbnail preview, click to expand/fullscreen
- [ ] **Videos** (video/*): inline `<video>` player with controls, poster thumbnail
- [ ] **Text files** (.txt, .md, .csv, .log, .json, .xml, .yaml, etc.):
  collapsible preview showing first ~50 lines, syntax-highlighted where applicable
- [ ] **PDFs** (.pdf): file card with "Open in new tab" link (`window.open` to served URL)
- [ ] **Everything else**: generic file card showing icon + filename + extension + file size
- [ ] All file messages show a small "X" / delete button to remove from conversation

### Auto-behaviors
- [ ] New chat auto-titled from first message (first 50 chars)
- [ ] Token count updated on every message change
- [ ] Settings auto-saved on every control change

---

## DARK THEME

All colors from Google AI Studio's CSS variables:

| Token | Value |
|-------|-------|
| Surface (main bg) | `#191919` |
| Surface container | `#1f1f1f` |
| Surface container high | `#252525` |
| Surface highest | `#2a2a2a` |
| Sidebar bg | `#191919` |
| Sidebar border | `#262626` |
| Primary text | `#d4d4d4` |
| Secondary text | `#8c8c8c` |
| Link / accent blue | `#87a9ff` |
| Outline / border | `#333` |
| Subtle border | `#262626` |
| Button bg | `#323232` |
| Input bg | `rgba(255,255,255,0.07)` |
| Thought header | `#37393c` |
| Thought body | `#242629` |
| Inline code bg | `#323232` |
| Body bg (behind all) | `#000` |

Fonts: Inter (400/500/600), Material Symbols Outlined (icons), Consolas/Monaco (code).

---

## INTERACTIONS & POLISH

- [ ] Sidebar items: hover bg transition
- [ ] All buttons: hover state transitions (200ms ease)
- [ ] Context menus: box-shadow, viewport clamping
- [ ] Scrollbar: thin (6px), dark thumb, transparent track
- [ ] Responsive: panels overlay on narrow screens (<900px right, <700px sidebar)
- [ ] Code block copy feedback: icon swaps to checkmark briefly
- [ ] Thoughts accordion: smooth animated expand
- [ ] Prompt box: border highlight on focus-within
- [ ] Textarea: auto-resize on input

---

## FILE MAP

```
aistudio_local_chat/
├── main.py              # FastAPI backend + API routes + file serving
├── requirements.txt     # fastapi, uvicorn
├── PLAN.md              # This file
├── data/chats/          # Chat storage
│   ├── {uuid}.json      # Chat metadata + messages
│   └── {uuid}/files/    # Uploaded files for that chat
├── static/
│   ├── index.html       # SPA shell, CDN imports (marked, hljs full, mermaid)
│   ├── css/style.css    # Complete dark theme + file preview styles
│   └── js/
│       ├── app.js       # State, API calls, init
│       ├── sidebar.js   # Chat list, nav, menus
│       ├── chat.js      # Message render, markdown, mermaid, file previews, input
│       └── settings.js  # Right panel, modals
```

---

## STATUS

### Done
- [x] FastAPI backend with all CRUD endpoints
- [x] Three-column HTML layout
- [x] Dark theme CSS (full variable system)
- [x] Chat list in sidebar with rename/delete
- [x] Message rendering with markdown
- [x] Code blocks with copy/collapse
- [x] Thoughts accordion
- [x] Prompt input with auto-grow
- [x] Settings panel with all controls
- [x] System instructions modal
- [x] Context menus on messages
- [x] Edit mode for user messages
- [x] Sample chat data

### To Do
- [ ] Provider/model config schema (providers.json or embedded)
- [ ] Dynamic settings panel rendering from schema
- [ ] Provider/model picker modal
- [ ] Mermaid diagram rendering (CDN + custom marked renderer)
- [ ] Switch highlight.js to full language bundle
- [ ] File upload API endpoint (multipart)
- [ ] File serving endpoint
- [ ] File drag-and-drop + attach button wiring
- [ ] File preview rendering (image, video, text, pdf, generic)
- [ ] File deletion from conversation
- [ ] Clean up chat directory (files) on chat delete

### To Verify / Polish
- [ ] Visually compare against reference screenshots, fix spacing/colors
- [ ] Test all interactions end-to-end (create, type, edit, delete, rename)
- [ ] Ensure no JS console errors
- [ ] Test sidebar collapse + right panel collapse
- [ ] Test responsive breakpoints
- [ ] Test file upload/preview for each type (image, video, text, pdf, other)

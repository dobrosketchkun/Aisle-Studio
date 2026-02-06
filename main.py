import base64
import json
import mimetypes
import os
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI()

DATA_DIR = Path(__file__).parent / "data" / "chats"
DATA_DIR.mkdir(parents=True, exist_ok=True)

STATIC_DIR = Path(__file__).parent / "static"

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
KEYS_FILE = Path(__file__).parent / "data" / "keys.json"

# Environment variable mapping for each provider
_ENV_KEY_MAP = {
    "openrouter": "OPENROUTER_API_KEY",
    "google": "GOOGLE_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
}


def _load_keys() -> dict:
    """Load saved API keys from disk."""
    if KEYS_FILE.exists():
        try:
            return json.loads(KEYS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def _save_keys(keys: dict):
    """Persist API keys to disk."""
    KEYS_FILE.parent.mkdir(parents=True, exist_ok=True)
    KEYS_FILE.write_text(json.dumps(keys, indent=2, ensure_ascii=False), encoding="utf-8")


def _get_api_key(provider: str) -> str | None:
    """Get API key for a provider — checks keys.json first, then env vars."""
    keys = _load_keys()
    if keys.get(provider):
        return keys[provider]
    env_var = _ENV_KEY_MAP.get(provider)
    if env_var:
        return os.getenv(env_var)
    return None


# --- Models ---

class ChatSettings(BaseModel):
    provider: str = "openrouter"
    model: str = "google/gemini-3-pro-preview"
    system_instructions: str = ""
    params: dict = Field(
        default_factory=lambda: {
            "temperature": 1.0,
            "top_p": 1.0,
            "max_tokens": 4096,
        }
    )


class Message(BaseModel):
    id: str = ""
    role: str  # "user" or "model"
    content: str = ""
    thoughts: str = ""
    files: list[dict] = Field(default_factory=list)


class ChatUpdate(BaseModel):
    title: str | None = None
    settings: ChatSettings | None = None
    messages: list[Message] | None = None
    bookmarked: bool | None = None


# --- Helpers ---

def _read_chat(chat_id: str) -> dict:
    path = DATA_DIR / f"{chat_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Chat not found")
    return json.loads(path.read_text(encoding="utf-8"))


def _write_chat(chat: dict):
    path = DATA_DIR / f"{chat['id']}.json"
    chat["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(chat, indent=2, ensure_ascii=False), encoding="utf-8")


def _resolve_openrouter_model(settings: dict) -> str:
    provider = str(settings.get("provider", "openrouter")).strip()
    model = str(settings.get("model", "google/gemini-3-pro-preview")).strip()
    if "/" in model:
        return model
    if provider and provider != "openrouter":
        return f"{provider}/{model}"
    return model


def _load_providers() -> dict:
    path = STATIC_DIR / "providers.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _get_model_capabilities(settings: dict) -> set[str]:
    """Return the set of multimodal capabilities for the current model."""
    providers = _load_providers()
    provider_key = settings.get("provider", "openrouter")
    model_id = settings.get("model", "")
    provider = providers.get(provider_key, {})
    for m in provider.get("models", []):
        if m.get("id") == model_id:
            return set(m.get("multimodal", []))
    return set()


# Extensions / MIME types we treat as readable text and inject as content
_TEXT_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".htm", ".css", ".scss",
    ".json", ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
    ".md", ".txt", ".csv", ".log", ".sh", ".bash", ".zsh", ".bat", ".ps1",
    ".c", ".cpp", ".h", ".hpp", ".java", ".kt", ".go", ".rs", ".rb",
    ".php", ".pl", ".r", ".sql", ".swift", ".dart", ".lua", ".ex", ".exs",
    ".vue", ".svelte", ".astro", ".env", ".gitignore", ".dockerfile",
}


def _is_text_file(filename: str, mime_type: str) -> bool:
    """Determine if a file should be sent as inline text."""
    ext = os.path.splitext(filename)[1].lower()
    if ext in _TEXT_EXTENSIONS:
        return True
    if mime_type.startswith("text/"):
        return True
    if any(k in mime_type for k in ("json", "xml", "yaml", "javascript", "typescript")):
        return True
    return False


def _openrouter_messages(
    messages: list[dict], chat_id: str, capabilities: set[str] | None = None,
) -> list[dict]:
    if capabilities is None:
        capabilities = set()

    converted = []
    for msg in messages:
        role = msg.get("role", "")
        if role not in {"user", "model", "assistant"}:
            continue

        api_role = "assistant" if role in {"model", "assistant"} else "user"
        text = msg.get("content", "")
        files = msg.get("files", [])

        extra_parts = []  # media (base64) or text file content
        for f in files:
            ftype = f.get("type", "")
            fname = f.get("name", f.get("filename", ""))
            category = ftype.split("/")[0] if ftype else ""

            file_path = DATA_DIR / chat_id / "files" / f.get("filename", "")
            if not file_path.exists():
                continue

            # Media files — send as base64 if model supports them
            if category in ("image", "video", "audio"):
                if category not in capabilities:
                    continue
                data = base64.b64encode(file_path.read_bytes()).decode("utf-8")
                extra_parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{ftype};base64,{data}"},
                })
            # Text/code files — read and inject as text
            elif _is_text_file(fname, ftype):
                try:
                    file_text = file_path.read_text(encoding="utf-8", errors="replace")
                    extra_parts.append({
                        "type": "text",
                        "text": f"--- File: {fname} ---\n{file_text}\n--- End of {fname} ---",
                    })
                except Exception:
                    pass
            # PDF / binary — try to mention it so the model knows a file was attached
            else:
                extra_parts.append({
                    "type": "text",
                    "text": f"[Attached file: {fname} ({ftype}, {f.get('size', 0)} bytes) — binary file, content not shown]",
                })

        if extra_parts:
            content = []
            if text:
                content.append({"type": "text", "text": text})
            content.extend(extra_parts)
            converted.append({"role": api_role, "content": content})
        else:
            converted.append({"role": api_role, "content": text})

    return converted


def _extract_delta_text(delta: dict) -> str:
    content = delta.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(part.get("text", ""))
        return "".join(parts)
    return ""


def _extract_reasoning(delta: dict) -> str:
    reasoning = delta.get("reasoning") or delta.get("thinking")
    if isinstance(reasoning, str):
        return reasoning
    if isinstance(reasoning, list):
        parts = []
        for part in reasoning:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(part.get("text", ""))
        return "".join(parts)
    return ""


def _sse_error_event(message: str, status_code: int = 500) -> str:
    payload = json.dumps({"error": message, "status_code": status_code}, ensure_ascii=False)
    return f"event: error\ndata: {payload}\n\n"


# --- API ---

@app.get("/api/chats")
def list_chats():
    chats = []
    for f in sorted(DATA_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            chats.append({
                "id": data["id"],
                "title": data["title"],
                "updated_at": data.get("updated_at", ""),
                "created_at": data.get("created_at", ""),
                "bookmarked": data.get("bookmarked", False),
            })
        except (json.JSONDecodeError, KeyError):
            continue  # skip corrupt files
    return chats


@app.get("/api/chats/search")
def search_chats(q: str = "", mode: str = "all"):
    """Search chats by title, content, or both."""
    query = q.strip().lower()
    if not query:
        return []

    results = []
    for f in sorted(DATA_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, IOError):
            continue

        title = data.get("title", "")
        title_match = query in title.lower()

        content_match = False
        matched_snippet = ""
        if mode in ("content", "all"):
            for msg in data.get("messages", []):
                text = msg.get("content", "")
                if query in text.lower():
                    content_match = True
                    # Extract snippet around match
                    idx = text.lower().index(query)
                    start = max(0, idx - 30)
                    end = min(len(text), idx + len(query) + 50)
                    matched_snippet = ("..." if start > 0 else "") + text[start:end] + ("..." if end < len(text) else "")
                    break

        if mode == "title" and title_match:
            results.append({"id": data["id"], "title": title, "snippet": ""})
        elif mode == "content" and content_match:
            results.append({"id": data["id"], "title": title, "snippet": matched_snippet})
        elif mode == "all" and (title_match or content_match):
            results.append({"id": data["id"], "title": title, "snippet": matched_snippet if content_match else ""})

    return results


@app.post("/api/chats")
def create_chat():
    chat_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    chat = {
        "id": chat_id,
        "title": "Untitled chat",
        "created_at": now,
        "updated_at": now,
        "settings": ChatSettings().model_dump(),
        "messages": [],
    }
    _write_chat(chat)
    return chat


@app.get("/api/chats/{chat_id}")
def get_chat(chat_id: str):
    return _read_chat(chat_id)


@app.put("/api/chats/{chat_id}")
def update_chat(chat_id: str, update: ChatUpdate):
    chat = _read_chat(chat_id)
    if update.title is not None:
        chat["title"] = update.title
    if update.settings is not None:
        chat["settings"] = update.settings.model_dump()
    if update.messages is not None:
        msgs = []
        for m in update.messages:
            d = m.model_dump()
            if not d["id"]:
                d["id"] = str(uuid.uuid4())
            msgs.append(d)
        chat["messages"] = msgs
    if update.bookmarked is not None:
        chat["bookmarked"] = update.bookmarked
    _write_chat(chat)
    return chat


@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: str):
    path = DATA_DIR / f"{chat_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Chat not found")
    path.unlink()
    # Remove uploaded files directory if it exists
    files_dir = DATA_DIR / chat_id
    if files_dir.exists() and files_dir.is_dir():
        shutil.rmtree(files_dir)
    return {"ok": True}


class KeysUpdate(BaseModel):
    keys: dict[str, str] = Field(default_factory=dict)


@app.get("/api/keys")
def get_keys_status():
    """Return which providers have API keys configured (not the keys themselves)."""
    providers = list(_load_providers().keys())
    return {p: bool(_get_api_key(p)) for p in providers}


@app.post("/api/keys")
def update_keys(update: KeysUpdate):
    """Save or clear API keys. Empty string removes the key."""
    current = _load_keys()
    for provider, key in update.keys.items():
        key = key.strip()
        if key:
            current[provider] = key
        else:
            current.pop(provider, None)
    _save_keys(current)
    # Return updated status
    providers = list(_load_providers().keys())
    return {p: bool(_get_api_key(p)) for p in providers}


@app.post("/api/chats/{chat_id}/generate")
async def generate_chat_response(chat_id: str):
    chat = _read_chat(chat_id)
    settings = chat.get("settings", {})
    params = settings.get("params", {})

    # Get API key dynamically (keys.json → env var fallback)
    api_key = _get_api_key("openrouter")
    if not api_key:
        return StreamingResponse(
            iter([_sse_error_event(
                "No API key configured for OpenRouter. Click the key icon in the prompt bar to add one.",
                401,
            )]),
            media_type="text/event-stream",
        )

    capabilities = _get_model_capabilities(settings)

    request_body = {
        "model": _resolve_openrouter_model(settings),
        "messages": _openrouter_messages(chat.get("messages", []), chat_id, capabilities),
        "stream": True,
    }

    system_instructions = str(settings.get("system_instructions", "")).strip()
    if system_instructions:
        request_body["system"] = system_instructions

    if isinstance(params, dict):
        # Work on a copy so we don't mutate the saved chat settings
        api_params = dict(params)
        # Extract thinking toggle — not a raw API param
        thinking_enabled = api_params.pop("thinking", False)
        # Remove tool toggles that aren't raw API params
        for k in ("structured_output", "code_execution", "url_context"):
            api_params.pop(k, None)
        request_body.update(api_params)
        if thinking_enabled:
            request_body["reasoning"] = {"effort": "high"}

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    accumulated_content: list[str] = []
    accumulated_reasoning: list[str] = []

    async def stream() -> AsyncIterator[str]:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, read=90.0)) as client:
                async with client.stream(
                    "POST", OPENROUTER_API_URL, headers=headers, json=request_body
                ) as response:
                    if response.status_code >= 400:
                        error_message = f"OpenRouter request failed with status {response.status_code}"
                        try:
                            body = await response.aread()
                            parsed = json.loads(body.decode("utf-8"))
                            if isinstance(parsed, dict):
                                error = parsed.get("error")
                                if isinstance(error, dict):
                                    error_message = error.get("message", error_message)
                                elif isinstance(error, str):
                                    error_message = error
                        except (json.JSONDecodeError, UnicodeDecodeError):
                            pass
                        yield _sse_error_event(error_message, status_code=response.status_code)
                        return

                    async for line in response.aiter_lines():
                        yield f"{line}\n"
                        if not line.startswith("data: "):
                            continue
                        payload = line[6:].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            data = json.loads(payload)
                        except json.JSONDecodeError:
                            continue

                        choices = data.get("choices", [])
                        if not choices:
                            continue

                        delta = choices[0].get("delta", {})
                        text = _extract_delta_text(delta)
                        if text:
                            accumulated_content.append(text)

                        reasoning = _extract_reasoning(delta)
                        if reasoning:
                            accumulated_reasoning.append(reasoning)
        except httpx.HTTPError as exc:
            yield _sse_error_event(f"Network failure while calling OpenRouter: {exc}", status_code=502)
            return
        finally:
            content = "".join(accumulated_content).strip()
            thoughts = "".join(accumulated_reasoning).strip()
            if content or thoughts:
                messages = chat.get("messages", [])
                messages.append(
                    {
                        "id": str(uuid.uuid4()),
                        "role": "model",
                        "content": content,
                        "thoughts": thoughts,
                    }
                )
                chat["messages"] = messages
                _write_chat(chat)

    return StreamingResponse(stream(), media_type="text/event-stream")


# --- File Upload & Serve ---

@app.post("/api/chats/{chat_id}/upload")
async def upload_file(chat_id: str, file: UploadFile):
    chat_path = DATA_DIR / f"{chat_id}.json"
    if not chat_path.exists():
        raise HTTPException(status_code=404, detail="Chat not found")

    files_dir = DATA_DIR / chat_id / "files"
    files_dir.mkdir(parents=True, exist_ok=True)

    file_id = str(uuid.uuid4())[:8]
    safe_name = os.path.basename(file.filename or "upload")
    saved_name = f"{file_id}_{safe_name}"
    file_path = files_dir / saved_name

    content = await file.read()
    file_path.write_bytes(content)

    mime_type = file.content_type or mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
    return {
        "id": file_id,
        "name": safe_name,
        "type": mime_type,
        "size": len(content),
        "filename": saved_name,
    }


@app.get("/api/chats/{chat_id}/files/{filename}")
def get_file(chat_id: str, filename: str):
    # Prevent path traversal
    filename = os.path.basename(filename)
    file_path = DATA_DIR / chat_id / "files" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return FileResponse(str(file_path), media_type=mime_type)


# --- Provider / Model Management ---

_openrouter_models_cache: dict = {"data": None, "ts": 0}


@app.get("/api/openrouter/models")
async def list_openrouter_models():
    """Proxy to OpenRouter /api/v1/models with 10-minute cache."""
    now = time.time()
    if _openrouter_models_cache["data"] and now - _openrouter_models_cache["ts"] < 600:
        return _openrouter_models_cache["data"]

    api_key = _get_api_key("openrouter")
    if not api_key:
        raise HTTPException(status_code=401, detail="No OpenRouter API key configured")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "https://openrouter.ai/api/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="OpenRouter API error")
        data = resp.json().get("data", [])
        _openrouter_models_cache["data"] = data
        _openrouter_models_cache["ts"] = now
        return data


class AddModelRequest(BaseModel):
    id: str
    name: str
    description: str = ""
    multimodal: list[str] = Field(default_factory=list)
    params: list[dict] = Field(default_factory=list)
    tools: list[dict] = Field(default_factory=list)


def _write_providers(providers: dict):
    path = STATIC_DIR / "providers.json"
    path.write_text(json.dumps(providers, indent=2, ensure_ascii=False), encoding="utf-8")


@app.post("/api/providers/{provider}/models")
def add_model_to_provider(provider: str, req: AddModelRequest):
    """Add a model to a provider in providers.json."""
    providers = _load_providers()
    if provider not in providers:
        raise HTTPException(status_code=404, detail="Provider not found")
    # Check for duplicate
    models = providers[provider].get("models", [])
    if any(m["id"] == req.id for m in models):
        raise HTTPException(status_code=409, detail="Model already exists")
    models.append(req.model_dump())
    providers[provider]["models"] = models
    _write_providers(providers)
    return providers[provider]


@app.delete("/api/providers/{provider}/models/{model_id:path}")
def delete_model_from_provider(provider: str, model_id: str):
    """Remove a model from a provider in providers.json."""
    providers = _load_providers()
    if provider not in providers:
        raise HTTPException(status_code=404, detail="Provider not found")
    models = providers[provider].get("models", [])
    new_models = [m for m in models if m["id"] != model_id]
    if len(new_models) == len(models):
        raise HTTPException(status_code=404, detail="Model not found")
    providers[provider]["models"] = new_models
    _write_providers(providers)
    return providers[provider]


class ReorderModelsRequest(BaseModel):
    model_ids: list[str]


@app.put("/api/providers/{provider}/models/reorder")
def reorder_models(provider: str, req: ReorderModelsRequest):
    """Reorder models in a provider."""
    providers = _load_providers()
    if provider not in providers:
        raise HTTPException(status_code=404, detail="Provider not found")
    models = providers[provider].get("models", [])
    model_map = {m["id"]: m for m in models}
    reordered = []
    for mid in req.model_ids:
        if mid in model_map:
            reordered.append(model_map.pop(mid))
    # Append any remaining models not in the reorder list
    reordered.extend(model_map.values())
    providers[provider]["models"] = reordered
    _write_providers(providers)
    return providers[provider]


# --- Static files ---

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI()

DATA_DIR = Path(__file__).parent / "data" / "chats"
DATA_DIR.mkdir(parents=True, exist_ok=True)

STATIC_DIR = Path(__file__).parent / "static"

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
if not OPENROUTER_API_KEY:
    raise RuntimeError(
        "Missing OPENROUTER_API_KEY. Add it to your environment or .env before starting the server."
    )


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


class ChatUpdate(BaseModel):
    title: str | None = None
    settings: ChatSettings | None = None
    messages: list[Message] | None = None


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


def _openrouter_messages(messages: list[dict]) -> list[dict]:
    converted = []
    for msg in messages:
        role = msg.get("role", "")
        if role not in {"user", "model", "assistant"}:
            continue
        converted.append(
            {
                "role": "assistant" if role in {"model", "assistant"} else "user",
                "content": msg.get("content", ""),
            }
        )
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
            })
        except (json.JSONDecodeError, KeyError):
            continue  # skip corrupt files
    return chats


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
    _write_chat(chat)
    return chat


@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: str):
    path = DATA_DIR / f"{chat_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Chat not found")
    path.unlink()
    return {"ok": True}


@app.post("/api/chats/{chat_id}/generate")
async def generate_chat_response(chat_id: str):
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is not configured")

    chat = _read_chat(chat_id)
    settings = chat.get("settings", {})
    params = settings.get("params", {})

    request_body = {
        "model": _resolve_openrouter_model(settings),
        "messages": _openrouter_messages(chat.get("messages", [])),
        "stream": True,
    }

    system_instructions = str(settings.get("system_instructions", "")).strip()
    if system_instructions:
        request_body["system"] = system_instructions

    if isinstance(params, dict):
        request_body.update(params)

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
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


# --- Static files ---

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)

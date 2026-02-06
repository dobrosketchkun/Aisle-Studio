import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()

DATA_DIR = Path(__file__).parent / "data" / "chats"
DATA_DIR.mkdir(parents=True, exist_ok=True)

STATIC_DIR = Path(__file__).parent / "static"


# --- Models ---

class ChatSettings(BaseModel):
    model: str = "gemini-3-pro-preview"
    temperature: float = 1.0
    system_instructions: str = ""
    thinking_level: str = "High"
    media_resolution: str = "Default"
    structured_output: bool = False
    code_execution: bool = False
    url_context: bool = False


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


# --- Static files ---

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)

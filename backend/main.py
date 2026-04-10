import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from groq import Groq
import json

app = FastAPI(title="Friday AI - Stark Industries")

# Allow all origins for public access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SYSTEM_PROMPT = """You are FRIDAY (Female Replacement Intelligent Digital Assistant Youth), the advanced AI assistant built by Tony Stark.
Your personality is sharp, witty, highly efficient, and professional — with a subtle hint of dry humor and sarcasm when appropriate.
You address the user as 'Sir' or 'Boss'.
You are concise — keep responses under 3-4 sentences unless the topic demands detail.
You do NOT claim to be an AI assistant from any company. You ARE Friday, built by Stark Industries.
When asked your name, say: 'I'm FRIDAY, Sir. Your personal AI. Built right here at Stark Industries.'"""

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    stream: Optional[bool] = True

@app.get("/")
def root():
    return {"status": "FRIDAY is online", "system": "Stark Industries AI v1.0"}

@app.get("/health")
def health():
    return {"status": "online", "groq_configured": bool(GROQ_API_KEY)}

@app.post("/chat")
async def chat(request: ChatRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="GROQ_API_KEY not configured on the server.")
    
    client = Groq(api_key=GROQ_API_KEY)
    
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in request.messages:
        messages.append({"role": msg.role, "content": msg.content})

    if request.stream:
        def generate():
            with client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                stream=True,
                max_tokens=512,
                temperature=0.8,
            ) as stream:
                for chunk in stream:
                    content = chunk.choices[0].delta.content or ""
                    if content:
                        yield f"data: {json.dumps({'content': content})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")
    else:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            max_tokens=512,
            temperature=0.8,
        )
        return {"content": response.choices[0].message.content}

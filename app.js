// =============================================
//  FRIDAY AI — Stark Industries Web Interface
// =============================================

// --- CONFIG ---
const DEFAULT_BACKEND = ""; // will prompt user
let BACKEND_URL = localStorage.getItem("friday_backend_url") || "";

// --- STATE ---
let conversationHistory = [];
let isListening = false;
let isSpeaking = false;
let messageCount = 0;
let synth = window.speechSynthesis; // Keep as fallback
let recognition = null;
let audioQueue = [];
let isPlayingAudio = false;

// --- DOM REFS ---
const chatMessages = document.getElementById("chatMessages");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const voiceBtn = document.getElementById("voiceBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const statStatus = document.getElementById("statStatus");
const statMessages = document.getElementById("statMessages");
const statMode = document.getElementById("statMode");
const voiceViz = document.getElementById("voiceViz");
const clearBtn = document.getElementById("clearBtn");
const configModal = document.getElementById("configModal");
const backendUrlInput = document.getElementById("backendUrl");
const modalSave = document.getElementById("modalSave");

// --- INIT ---
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("bootTime").textContent = getTime();
  
  if (!BACKEND_URL) {
    configModal.classList.remove("hidden");
    if (backendUrlInput) backendUrlInput.value = "";
  } else {
    configModal.classList.add("hidden");
    checkBackendHealth();
  }

  setupSpeechRecognition();
  setupEventListeners();
  setStatus("online", "ONLINE");
});

// --- STATUS ---
function setStatus(type, label) {
  statusDot.className = "status-indicator " + type;
  statusText.textContent = label;
  if (statStatus) statStatus.textContent = label;
}

// --- TIME ---
function getTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// --- HEALTH CHECK ---
async function checkBackendHealth() {
  try {
    const res = await fetch(BACKEND_URL + "/health");
    if (res.ok) {
      setStatus("online", "ONLINE");
    } else {
      setStatus("error", "ERROR");
    }
  } catch {
    setStatus("error", "OFFLINE");
  }
}

// --- ADD MESSAGE ---
function addMessage(role, text, isTyping = false) {
  const isUser = role === "user";
  const div = document.createElement("div");
  div.className = `message ${isUser ? "user-msg" : "friday-msg"}${isTyping ? " typing-indicator" : ""}`;
  div.innerHTML = `
    <div class="msg-avatar">${isUser ? "S" : "F"}</div>
    <div class="msg-content">
      <div class="msg-header">
        ${isUser ? "BOSS" : "FRIDAY"}
        <span class="msg-time">${getTime()}</span>
      </div>
      <div class="msg-text" id="${isTyping ? "typingMsg" : ""}">
        ${isTyping
          ? `Processing<span class="typing-dots"><span></span><span></span><span></span></span>`
          : escapeHtml(text)}
      </div>
    </div>`;
  
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  if (!isTyping) {
    messageCount++;
    statMessages.textContent = messageCount;
  }
  return div;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
}

// --- SEND MESSAGE ---
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || sendBtn.disabled) return;
  if (!BACKEND_URL) { configModal.classList.remove("hidden"); return; }

  userInput.value = "";
  autoResize();
  sendBtn.disabled = true;

  addMessage("user", text);
  conversationHistory.push({ role: "user", content: text });

  // Typing indicator
  const typingEl = addMessage("friday", "", true);

  try {
    const res = await fetch(BACKEND_URL + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversationHistory, stream: true }),
    });

    if (!res.ok) throw new Error("Server error: " + res.status);

    // Remove typing indicator, create real message
    typingEl.remove();
    const msgEl = addMessage("friday", "");
    const textEl = msgEl.querySelector(".msg-text");
    textEl.textContent = "";

    // Stream response
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let sentenceBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Speak any remaining text that didn't end with punctuation
        if (sentenceBuffer.trim().length > 0) {
            speak(sentenceBuffer.trim());
        }
        break;
      }
      
      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullText += parsed.content;
              sentenceBuffer += parsed.content;
              textEl.innerHTML = escapeHtml(fullText);
              chatMessages.scrollTop = chatMessages.scrollHeight;
              
              // Check if we completed a sentence (basic punctuation detection)
              if (/[.!?]\s$/.test(sentenceBuffer) || /[.!?]$/.test(parsed.content)) {
                  // Only speak if it's substantial enough
                  if (sentenceBuffer.trim().length > 2) {
                      speak(sentenceBuffer.trim());
                      sentenceBuffer = "";
                  }
              }
            }
          } catch {}
        }
      }
    }

    conversationHistory.push({ role: "assistant", content: fullText });

  } catch (err) {
    typingEl.remove();
    addMessage("friday", `⚡ Connection lost, Sir. ${err.message}. Please check your backend URL.`);
    setStatus("error", "ERROR");
  } finally {
    sendBtn.disabled = false;
    userInput.focus();
  }
}

// --- SPEECH SYNTHESIS (TTS) ---
async function speak(text) {
  if (!text.trim()) return;
  
  try {
     const res = await fetch(BACKEND_URL + "/tts", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ text: text })
     });
     
     if (res.ok) {
         const blob = await res.blob();
         const audioUrl = URL.createObjectURL(blob);
         audioQueue.push(audioUrl);
         playNextAudio();
     } else {
         throw new Error("TTS failed");
     }
  } catch (err) {
      console.warn("ElevenLabs TTS failed, falling back to browser voice", err);
      fallbackSpeak(text);
  }
}

async function playNextAudio() {
    if (audioQueue.length === 0 || isPlayingAudio) return;
    
    isPlayingAudio = true;
    const url = audioQueue.shift();
    const audio = new Audio(url);
    
    // Visualizer active while playing
    voiceViz.classList.add("active");
    
    audio.onended = () => {
        isPlayingAudio = false;
        voiceViz.classList.remove("active");
        playNextAudio();
    };
    
    audio.onerror = () => {
        isPlayingAudio = false;
        voiceViz.classList.remove("active");
        playNextAudio();
    };
    
    await audio.play().catch(e => {
        console.error("Audio playback prevented:", e);
        isPlayingAudio = false;
        playNextAudio();
    });
}

function fallbackSpeak(text) {
  if (!synth) return;
  const utter = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const preferred = voices.find(v =>
    v.name.includes("Female") || v.name.includes("Samantha") ||
    v.name.includes("Zira") || v.name.includes("Google UK English Female")
  );
  if (preferred) utter.voice = preferred;
  utter.rate = 1.05;
  synth.speak(utter);
}

// --- SPEECH RECOGNITION (STT) ---
function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    voiceBtn.title = "Speech recognition not supported in this browser (use Chrome)";
    voiceBtn.style.opacity = "0.4";
    return;
  }

  recognition = new SR();
  recognition.continuous = false;
  recognition.lang = "en-US";
  recognition.interimResults = true;

  recognition.onstart = () => {
    isListening = true;
    voiceBtn.classList.add("listening");
    voiceViz.classList.add("active");
    statMode.textContent = "VOICE";
  };

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results)
      .map(r => r[0].transcript)
      .join("");
    userInput.value = transcript;
    autoResize();
  };

  recognition.onend = () => {
    isListening = false;
    voiceBtn.classList.remove("listening");
    voiceViz.classList.remove("active");
    statMode.textContent = "TEXT";
    // Auto-send if we got text
    if (userInput.value.trim()) sendMessage();
  };

  recognition.onerror = (e) => {
    isListening = false;
    voiceBtn.classList.remove("listening");
    voiceViz.classList.remove("active");
    statMode.textContent = "TEXT";
  };
}

// --- AUTO RESIZE TEXTAREA ---
function autoResize() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  sendBtn.addEventListener("click", sendMessage);

  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  userInput.addEventListener("input", autoResize);

  voiceBtn.addEventListener("click", () => {
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
    } else {
      synth?.cancel();
      recognition.start();
    }
  });

  clearBtn.addEventListener("click", () => {
    conversationHistory = [];
    messageCount = 0;
    statMessages.textContent = "0";
    chatMessages.innerHTML = "";
    addMessage("friday", "Session cleared, Sir. Starting fresh. What do you need?");
  });

  modalSave.addEventListener("click", () => {
    const url = backendUrlInput.value.trim().replace(/\/$/, "");
    if (!url) return;
    BACKEND_URL = url;
    localStorage.setItem("friday_backend_url", url);
    configModal.classList.add("hidden");
    checkBackendHealth();
  });

  backendUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") modalSave.click();
  });
}

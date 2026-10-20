
"use strict";

const $ = (selector) => document.querySelector(selector);

const chatForm = $("#chatForm");
const chatInput = $("#chatInput");
const chatMessages = $("#chatMessages");
const sendButton = $("#sendButton");
const micButton = $("#micButton");
const chatStatus = $("#chatStatus");
const aiMode = $("#aiMode");
const chatLanguage = $("#chatLanguage");
const voiceToggle = $("#voiceToggle");

let conversation = [];
let busy = false;
let voiceOutputEnabled = false;
let recognition = null;
let cameraStream = null;
let toastTimer;

const SYSTEM_PROMPT = `
You are J.A.R.V.I.S., a capable, polite, futuristic personal AI assistant.
Understand the user's intent and ask clarifying questions when needed.
Support Hindi, English, Hinglish and multilingual translation.
Maintain conversation context, answer follow-up questions,
reason carefully, break complex tasks into steps, solve maths,
explain and debug code, summarize text, correct grammar,
generate ideas, write creatively and help with research.
Be honest about uncertainty. Never invent sources or claim
you performed actions you did not perform.
Use clear, structured answers and explain important assumptions.
Do not claim to access files, devices, the web, or private data
unless a connected tool actually provides that capability.
`;

const MODE_INSTRUCTIONS = {
  conversation: "Respond naturally and use relevant conversation context.",
  reasoning: "Analyze the goal, state assumptions, and provide a clear plan with practical steps.",
  coding: "Act as a coding assistant. Give correct code, explain it, and help diagnose errors.",
  math: "Solve the mathematical problem carefully and show the essential steps.",
  translation: "Translate faithfully. Preserve meaning, tone, names and formatting.",
  writing: "Help with writing, grammar, editing and concise, accurate summaries.",
  research: "Separate established facts from uncertainty. Never fabricate citations or claim live web research without a search tool.",
  creative: "Generate original, relevant ideas and creative writing matching the requested style."
};

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function setStatus(message) {
  $("#systemStatus").textContent = message;
}

function addMessage(role, text) {
  const row = document.createElement("div");
  row.className = `message ${role}-message`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "Y" : "J";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = text;

  row.append(avatar, bubble);
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return bubble;
}

async function checkBackend() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("Backend unavailable");

    $("#engineStatus").textContent = "Online";
    $("#aiStatus").textContent = "SERVER CONNECTED";
    chatStatus.textContent = "Connected. Ready for your command.";
    setStatus("SYSTEM ONLINE");
  } catch {
    $("#engineStatus").textContent = "Offline";
    $("#aiStatus").textContent = "SERVER OFFLINE";
    chatStatus.textContent = "Start or deploy your Node.js backend.";
    setStatus("OFFLINE");
  }
}

async function sendMessage(text) {
  const message = text.trim();
  if (!message || busy) return;

  busy = true;
  sendButton.disabled = true;
  chatInput.disabled = true;
  micButton.disabled = true;

  addMessage("user", message);

  const mode = aiMode.value;
  const language = chatLanguage.value;

  const userPrompt = [
    `Preferred response language: ${language}.`,
    `Selected capability: ${mode}.`,
    `Instructions: ${MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.conversation}`,
    `User request:\n${message}`
  ].join("\n\n");

  conversation.push({ role: "user", content: userPrompt });

  const pending = addMessage("assistant", "Analyzing your request...");
  chatStatus.textContent = "JARVIS is processing...";
  setStatus("PROCESSING");

  try {
    // Send only recent messages to control request size.
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...conversation.slice(-20)
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    let response;
    try {
      response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Server error (${response.status})`);
    }

    if (typeof data.reply !== "string") {
      throw new Error("Invalid response from the AI server.");
    }

    pending.textContent = data.reply;
    conversation.push({ role: "assistant", content: data.reply });

    if (voiceOutputEnabled) speak(data.reply);

    chatStatus.textContent = "Ready for your next command.";
    setStatus("SYSTEM ONLINE");
  } catch (error) {
    // Failed messages should not remain in the conversation sent to AI.
    conversation.pop();

    const reason = error.name === "AbortError"
      ? "Request timed out. Please try again."
      : error.message || "Could not connect to the AI service.";

    pending.textContent = `Sorry, Commander. ${reason}`;
    chatStatus.textContent = "Request failed. Check your connection.";
    setStatus("CHECK CONNECTION");
    showToast(reason);
  } finally {
    busy = false;
    sendButton.disabled = false;
    chatInput.disabled = false;
    micButton.disabled = false;
    chatInput.focus();
  }
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = chatInput.value.trim();
  if (!text || busy) return;

  chatInput.value = "";
  sendMessage(text);
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

$("#startChat").addEventListener("click", () => {
  $("#assistant").scrollIntoView({ behavior: "smooth" });
  setTimeout(() => chatInput.focus(), 300);
});

$("#clearChat").addEventListener("click", () => {
  if (busy) {
    showToast("Please wait for the current response to finish.");
    return;
  }

  conversation = [];
  chatMessages.replaceChildren();
  addMessage(
    "assistant",
    "New session initialized, Commander. What shall we work on?"
  );
  chatStatus.textContent = "New conversation started.";
});

document.querySelectorAll(".capability").forEach((button) => {
  button.addEventListener("click", () => {
    aiMode.value = button.dataset.mode;

    document.querySelectorAll(".capability").forEach((item) => {
      item.classList.toggle("selected", item === button);
    });

    $("#assistant").scrollIntoView({ behavior: "smooth" });
    chatInput.focus();
    showToast(`AI mode: ${button.querySelector("b").textContent}`);
  });
});

voiceToggle.addEventListener("click", () => {
  voiceOutputEnabled = !voiceOutputEnabled;
  voiceToggle.setAttribute("aria-pressed", String(voiceOutputEnabled));
  voiceToggle.textContent = voiceOutputEnabled
    ? "🔊 Voice on"
    : "🔊 Voice off";

  if (!voiceOutputEnabled && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
});

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    micButton.classList.add("listening");
    chatStatus.textContent = "Listening...";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    chatInput.value = transcript;
    sendMessage(transcript);
  };

  recognition.onerror = (event) => {
    showToast(
      event.error === "not-allowed"
        ? "Microphone permission denied."
        : "Voice recognition failed. Try typing instead."
    );
  };

  recognition.onend = () => {
    micButton.classList.remove("listening");
  };

  micButton.addEventListener("click", () => {
    try {
      recognition.start();
    } catch {
      showToast("Voice recognition is already running.");
    }
  });
} else {
  micButton.addEventListener("click", () => {
    showToast("Voice input is not supported in this browser.");
  });
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    showToast("Voice output is not supported.");
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const language = chatLanguage.value;

  utterance.lang = language === "Hindi"
    ? "hi-IN"
    : language === "English"
      ? "en-IN"
      : "en-IN";

  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

window.addEventListener("beforeunload", () => {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
  }

  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
});

checkBackend();

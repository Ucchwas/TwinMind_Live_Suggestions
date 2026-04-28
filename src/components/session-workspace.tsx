"use client";

import { useEffect, useRef, useState } from "react";
import { SETTINGS_STORAGE_KEY, defaultSettings } from "@/lib/default-settings";
import type {
  AppSettings,
  ChatMessage,
  Suggestion,
  SuggestionApiResponse,
  SuggestionBatch,
  TranscriptChunk
} from "@/lib/types";

const AUTO_REFRESH_MS = 30_000;

function makeId() {
  return crypto.randomUUID();
}

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function getSupportedMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return options.find((value) => MediaRecorder.isTypeSupported(value));
}

export function SessionWorkspace() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    if (typeof window === "undefined") {
      return defaultSettings;
    }

    const saved = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!saved) {
      return defaultSettings;
    }

    try {
      return {
        ...defaultSettings,
        ...(JSON.parse(saved) as Partial<AppSettings>)
      };
    } catch {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
      return defaultSettings;
    }
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [transcriptChunks, setTranscriptChunks] = useState<TranscriptChunk[]>([]);
  const [suggestionBatches, setSuggestionBatches] = useState<SuggestionBatch[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settingsRef = useRef(settings);
  const transcriptChunksRef = useRef<TranscriptChunk[]>([]);
  const suggestionBatchesRef = useRef<SuggestionBatch[]>([]);
  const chatHistoryRef = useRef<ChatMessage[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const refreshQueueRef = useRef(Promise.resolve());
  const chunkStartedAtRef = useRef<string | null>(null);
  const pendingFlushRef = useRef<{
    resolve: (value: TranscriptChunk | null) => void;
    reject: (reason?: unknown) => void;
  } | null>(null);

  const transcriptPaneRef = useRef<HTMLDivElement | null>(null);
  const chatPaneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptChunksRef.current = transcriptChunks;
  }, [transcriptChunks]);

  useEffect(() => {
    suggestionBatchesRef.current = suggestionBatches;
  }, [suggestionBatches]);

  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  useEffect(() => {
    settingsRef.current = settings;
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (transcriptPaneRef.current) {
      transcriptPaneRef.current.scrollTop = transcriptPaneRef.current.scrollHeight;
    }
  }, [transcriptChunks]);

  useEffect(() => {
    if (chatPaneRef.current) {
      chatPaneRef.current.scrollTop = chatPaneRef.current.scrollHeight;
    }
  }, [chatHistory]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
      }
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function persistTranscript(nextValue: TranscriptChunk[]) {
    transcriptChunksRef.current = nextValue;
    setTranscriptChunks(nextValue);
  }

  function persistSuggestions(nextValue: SuggestionBatch[]) {
    suggestionBatchesRef.current = nextValue;
    setSuggestionBatches(nextValue);
  }

  function persistChat(nextValue: ChatMessage[]) {
    chatHistoryRef.current = nextValue;
    setChatHistory(nextValue);
  }

  function appendTranscriptChunk(chunk: TranscriptChunk) {
    const nextValue = [...transcriptChunksRef.current, chunk];
    persistTranscript(nextValue);
    return nextValue;
  }

  function prependSuggestionBatch(batch: SuggestionBatch) {
    const nextValue = [batch, ...suggestionBatchesRef.current];
    persistSuggestions(nextValue);
    return nextValue;
  }

  function appendChatMessage(message: ChatMessage) {
    const nextValue = [...chatHistoryRef.current, message];
    persistChat(nextValue);
    return nextValue;
  }

  function updateChatMessage(id: string, content: string) {
    const nextValue = chatHistoryRef.current.map((message) =>
      message.id === id ? { ...message, content } : message
    );
    persistChat(nextValue);
  }

  async function transcribeBlob(blob: Blob, startedAt: string, endedAt: string) {
    const currentSettings = settingsRef.current;
    const file = new File([blob], `chunk-${Date.now()}.webm`, {
      type: blob.type || "audio/webm"
    });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("apiKey", currentSettings.apiKey);
    formData.append("prompt", currentSettings.transcriptionPrompt);
    formData.append("language", currentSettings.transcriptionLanguage);

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData
    });

    const payload = (await response.json()) as { text?: string; error?: string };

    if (!response.ok) {
      throw new Error(payload.error ?? "Transcription failed.");
    }

    const text = payload.text?.trim();
    if (!text) {
      return null;
    }

    return {
      id: makeId(),
      text,
      createdAt: endedAt,
      startedAt,
      endedAt
    } satisfies TranscriptChunk;
  }

  async function flushRecorderChunk() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return null;
    }

    return new Promise<TranscriptChunk | null>((resolve, reject) => {
      pendingFlushRef.current = { resolve, reject };
      recorder.requestData();
    });
  }

  async function generateSuggestions(currentTranscript: TranscriptChunk[]) {
    if (!currentTranscript.length) {
      return null;
    }

    const currentSettings = settingsRef.current;
    const priorSuggestions = suggestionBatchesRef.current
      .flatMap((batch) => batch.suggestions)
      .slice(0, 9)
      .map((item) => ({
        title: item.title,
        preview: item.preview
      }));

    const response = await fetch("/api/suggestions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        apiKey: currentSettings.apiKey,
        transcriptChunks: currentTranscript,
        suggestionPrompt: currentSettings.suggestionPrompt,
        suggestionContextChunks: currentSettings.suggestionContextChunks,
        priorSuggestions
      })
    });

    const payload = (await response.json()) as SuggestionApiResponse & { error?: string };

    if (!response.ok) {
      throw new Error(payload.error ?? "Suggestion generation failed.");
    }

    const batch: SuggestionBatch = {
      id: makeId(),
      createdAt: new Date().toISOString(),
      sourceChunkIds: payload.contextChunkIds,
      suggestions: payload.suggestions
    };

    prependSuggestionBatch(batch);
    return batch;
  }

  function queueRefresh(trigger: "auto" | "manual" | "stop") {
    const task = async () => {
      if (!settingsRef.current.apiKey.trim()) {
        throw new Error("Paste your Groq API key in Settings before recording or refreshing.");
      }

      setIsRefreshing(true);
      setError(null);

      let nextTranscript = transcriptChunksRef.current;

      if (recorderRef.current?.state === "recording") {
        const nextChunk = await flushRecorderChunk();
        if (nextChunk) {
          nextTranscript = appendTranscriptChunk(nextChunk);
        }
      }

      if (!nextTranscript.length) {
        if (trigger === "manual") {
          throw new Error("No transcript is available yet. Record audio or wait for the next chunk.");
        }
        return;
      }

      await generateSuggestions(nextTranscript);
    };

    refreshQueueRef.current = refreshQueueRef.current.then(task, task).finally(() => {
      setIsRefreshing(false);
    });

    return refreshQueueRef.current;
  }

  async function startRecording() {
    if (isRecording) {
      return;
    }

    if (!settings.apiKey.trim()) {
      setIsSettingsOpen(true);
      setError("Paste your Groq API key first so recording can transcribe into suggestions.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser does not support microphone recording with MediaRecorder.");
      return;
    }

    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      const mimeType = getSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recorder.ondataavailable = async (event) => {
        const pending = pendingFlushRef.current;
        const endedAt = new Date().toISOString();
        const startedAt = chunkStartedAtRef.current ?? endedAt;
        chunkStartedAtRef.current = endedAt;

        if (!pending) {
          return;
        }

        pendingFlushRef.current = null;

        try {
          if (!event.data.size) {
            pending.resolve(null);
            return;
          }

          const transcriptChunk = await transcribeBlob(event.data, startedAt, endedAt);
          pending.resolve(transcriptChunk);
        } catch (flushError) {
          pending.reject(flushError);
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      streamRef.current = stream;
      chunkStartedAtRef.current = new Date().toISOString();
      setIsRecording(true);

      refreshTimerRef.current = window.setInterval(() => {
        void queueRefresh("auto").catch((refreshError) => {
          setError(refreshError instanceof Error ? refreshError.message : "Auto refresh failed.");
        });
      }, AUTO_REFRESH_MS);
    } catch (recordError) {
      setError(
        recordError instanceof Error ? recordError.message : "Unable to start microphone recording."
      );
    }
  }

  async function stopRecording() {
    if (!recorderRef.current) {
      return;
    }

    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    try {
      await queueRefresh("stop");
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Final refresh failed.");
    } finally {
      recorderRef.current.stop();
      recorderRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      chunkStartedAtRef.current = null;
      pendingFlushRef.current = null;
      setIsRecording(false);
    }
  }

  async function handleManualRefresh() {
    try {
      await queueRefresh("manual");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Refresh failed.");
    }
  }

  async function sendChat(question: string, source: ChatMessage["source"]) {
    await sendStructuredChat({
      displayContent: question,
      requestContent: question,
      source
    });
  }

  function handleSuggestionClick(suggestion: Suggestion) {
    const displayContent = [`Selected suggestion: ${suggestion.title}`, suggestion.preview].join("\n");
    const requestContent = [
      "Expand this live suggestion for immediate meeting use.",
      `Title: ${suggestion.title}`,
      `Preview: ${suggestion.preview}`,
      `Type: ${suggestion.kind}`,
      `Why now: ${suggestion.reason}`
    ].join("\n");

    void sendStructuredChat({
      displayContent,
      requestContent,
      source: "suggestion"
    });
  }

  async function sendStructuredChat({
    displayContent,
    requestContent,
    source
  }: {
    displayContent: string;
    requestContent: string;
    source: ChatMessage["source"];
  }) {
    const trimmedRequestContent = requestContent.trim();
    if (!trimmedRequestContent) {
      return;
    }

    const currentSettings = settingsRef.current;

    if (!currentSettings.apiKey.trim()) {
      setIsSettingsOpen(true);
      setError("Paste your Groq API key before asking for a detailed answer.");
      return;
    }

    setIsChatLoading(true);
    setError(null);

    const historyBeforeRequest = chatHistoryRef.current;
    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: displayContent.trim() || trimmedRequestContent,
      createdAt: new Date().toISOString(),
      source
    };

    const assistantMessage: ChatMessage = {
      id: makeId(),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      source
    };

    appendChatMessage(userMessage);
    appendChatMessage(assistantMessage);
    setComposer("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          apiKey: currentSettings.apiKey,
          transcriptChunks: transcriptChunksRef.current,
          chatHistory: historyBeforeRequest,
          question: trimmedRequestContent,
          prompt: source === "suggestion" ? currentSettings.detailPrompt : currentSettings.chatPrompt,
          transcriptWindow:
            source === "suggestion"
              ? currentSettings.detailContextChunks
              : currentSettings.chatContextChunks,
          chatHistoryTurns: currentSettings.chatHistoryTurns
        })
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Chat request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        answer += decoder.decode(value, { stream: true });
        updateChatMessage(assistantMessage.id, answer);
      }

      if (!answer.trim()) {
        updateChatMessage(assistantMessage.id, "No answer was returned.");
      }
    } catch (chatError) {
      updateChatMessage(
        assistantMessage.id,
        chatError instanceof Error ? chatError.message : "Unable to complete the chat request."
      );
    } finally {
      setIsChatLoading(false);
    }
  }

  function exportSession() {
    const payload = {
      exportedAt: new Date().toISOString(),
      transcript: transcriptChunksRef.current,
      suggestionBatches: suggestionBatchesRef.current,
      chatHistory: chatHistoryRef.current,
      settings: {
        ...settings,
        apiKey: ""
      }
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `twinmind-session-${new Date().toISOString().replaceAll(":", "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const canRefresh =
    Boolean(settings.apiKey.trim()) && !isRefreshing && (isRecording || transcriptChunks.length > 0);
  const canExport =
    transcriptChunks.length > 0 || suggestionBatches.length > 0 || chatHistory.length > 0;

  return (
    <main className="page-shell">
      <div className="hero-panel">
        <div>
          <p className="eyebrow">TwinMind Assignment</p>
          <h1>Live suggestions that feel useful mid-conversation.</h1>
          <p className="hero-copy">
            Record the mic, generate a fresh batch of three suggestions every ~30 seconds, and
            expand any suggestion into a grounded answer in the chat panel.
          </p>
        </div>

        <div className="hero-actions">
          <div className={`status-pill ${isRecording ? "status-live" : ""}`}>
            <span className="status-dot" />
            {isRecording ? "Mic live" : "Mic idle"}
          </div>
          <button className="secondary-button" type="button" onClick={() => setIsSettingsOpen(true)}>
            Settings
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!canExport}
            onClick={exportSession}
          >
            Export Session
          </button>
        </div>
      </div>

      <section className="workspace-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-label">Transcript</p>
              <h2>Mic + rolling transcript</h2>
            </div>
            <div className="panel-actions">
              {isRecording ? (
                <button className="danger-button" type="button" onClick={stopRecording}>
                  Stop mic
                </button>
              ) : (
                <button className="primary-button" type="button" onClick={startRecording}>
                  Start mic
                </button>
              )}
            </div>
          </div>

          <div className="transcript-pane" ref={transcriptPaneRef}>
            {!transcriptChunks.length ? (
              <div className="empty-state">
                <p>No transcript yet.</p>
                <span>Start recording and the transcript will append in 30-second chunks.</span>
              </div>
            ) : (
              transcriptChunks.map((chunk) => (
                <div className="transcript-card" key={chunk.id}>
                  <div className="transcript-meta">
                    <span>{formatTime(chunk.startedAt)}</span>
                    <span>{formatTime(chunk.endedAt)}</span>
                  </div>
                  <p>{chunk.text}</p>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-label">Suggestions</p>
              <h2>Fresh batch every refresh</h2>
            </div>
            <div className="panel-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={!canRefresh}
                onClick={handleManualRefresh}
              >
                {isRefreshing ? "Refreshing..." : "Refresh now"}
              </button>
            </div>
          </div>

          <div className="suggestion-pane">
            {!suggestionBatches.length ? (
              <div className="empty-state">
                <p>No suggestion batches yet.</p>
                <span>
                  Suggestions will appear here after the first chunk is transcribed and refreshed.
                </span>
              </div>
            ) : (
              suggestionBatches.map((batch) => (
                <section className="batch-block" key={batch.id}>
                  <div className="batch-header">
                    <span>Batch at {formatTime(batch.createdAt)}</span>
                    <span>{batch.suggestions.length} suggestions</span>
                  </div>
                  <div className="suggestion-list">
                    {batch.suggestions.map((suggestion) => (
                      <button
                        className="suggestion-card"
                        key={suggestion.id}
                        type="button"
                        onClick={() => handleSuggestionClick(suggestion)}
                      >
                        <div className="suggestion-topline">
                          <span className="kind-chip">{suggestion.kind}</span>
                          <span className="reason-text">{suggestion.reason}</span>
                        </div>
                        <h3>{suggestion.title}</h3>
                        <p>{suggestion.preview}</p>
                      </button>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-label">Chat</p>
              <h2>Detailed answer panel</h2>
            </div>
            <div className="panel-actions">
              <span className="helper-text">
                {isChatLoading ? "Streaming answer..." : "Click a suggestion or ask directly"}
              </span>
            </div>
          </div>

          <div className="chat-pane" ref={chatPaneRef}>
            {!chatHistory.length ? (
              <div className="empty-state">
                <p>Chat is empty.</p>
                <span>
                  Click any suggestion card to expand it, or type a direct question below.
                </span>
              </div>
            ) : (
              chatHistory.map((message) => (
                <div className={`chat-bubble ${message.role}`} key={message.id}>
                  <div className="chat-meta">
                    <span>{message.role === "user" ? "You" : "Copilot"}</span>
                    <span>{formatTime(message.createdAt)}</span>
                  </div>
                  <p>{message.content || (message.role === "assistant" ? "..." : "")}</p>
                </div>
              ))
            )}
          </div>

          <form
            className="chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              void sendChat(composer, "manual");
            }}
          >
            <textarea
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              placeholder="Ask a question about the conversation..."
              rows={4}
            />
            <button className="primary-button" type="submit" disabled={!composer.trim() || isChatLoading}>
              Send
            </button>
          </form>
        </article>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <aside className={`settings-drawer ${isSettingsOpen ? "open" : ""}`}>
        <div className="settings-sheet">
          <div className="settings-header">
            <div>
              <p className="panel-label">Settings</p>
              <h2>Groq key, prompts, and context windows</h2>
            </div>
            <button className="ghost-button" type="button" onClick={() => setIsSettingsOpen(false)}>
              Close
            </button>
          </div>

          <div className="settings-grid">
            <label className="field">
              <span>Groq API key</span>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, apiKey: event.target.value.trim() }))
                }
                placeholder="gsk_..."
              />
              <small>Stored locally in this browser only.</small>
            </label>

            <label className="field">
              <span>Transcription language</span>
              <input
                type="text"
                value={settings.transcriptionLanguage}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    transcriptionLanguage: event.target.value
                  }))
                }
                placeholder="en"
              />
            </label>

            <label className="field">
              <span>Suggestion context chunks</span>
              <input
                type="number"
                min={1}
                max={20}
                value={settings.suggestionContextChunks}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    suggestionContextChunks: Number(event.target.value || 1)
                  }))
                }
              />
            </label>

            <label className="field">
              <span>Clicked-suggestion transcript chunks</span>
              <input
                type="number"
                min={0}
                max={40}
                value={settings.detailContextChunks}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    detailContextChunks: Number(event.target.value || 0)
                  }))
                }
              />
              <small>`0` uses the full transcript for clicked-suggestion answers.</small>
            </label>

            <label className="field">
              <span>Direct chat transcript chunks</span>
              <input
                type="number"
                min={0}
                max={40}
                value={settings.chatContextChunks}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    chatContextChunks: Number(event.target.value || 0)
                  }))
                }
              />
              <small>`0` uses the full transcript for direct chat too.</small>
            </label>

            <label className="field">
              <span>Chat history turns</span>
              <input
                type="number"
                min={0}
                max={30}
                value={settings.chatHistoryTurns}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    chatHistoryTurns: Number(event.target.value || 0)
                  }))
                }
              />
            </label>

            <label className="field field-wide">
              <span>Transcription prompt</span>
              <textarea
                rows={4}
                value={settings.transcriptionPrompt}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    transcriptionPrompt: event.target.value
                  }))
                }
              />
            </label>

            <label className="field field-wide">
              <span>Live suggestions prompt</span>
              <textarea
                rows={12}
                value={settings.suggestionPrompt}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    suggestionPrompt: event.target.value
                  }))
                }
              />
            </label>

            <label className="field field-wide">
              <span>Expanded-answer prompt</span>
              <textarea
                rows={8}
                value={settings.detailPrompt}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    detailPrompt: event.target.value
                  }))
                }
              />
            </label>

            <label className="field field-wide">
              <span>Direct chat prompt</span>
              <textarea
                rows={8}
                value={settings.chatPrompt}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    chatPrompt: event.target.value
                  }))
                }
              />
            </label>
          </div>
        </div>
        <button
          aria-label="Close settings overlay"
          className="settings-backdrop"
          type="button"
          onClick={() => setIsSettingsOpen(false)}
        />
      </aside>
    </main>
  );
}

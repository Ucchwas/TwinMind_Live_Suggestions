import type { ChatMessage, TranscriptChunk } from "@/lib/types";

const GROQ_CHAT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TRANSCRIBE_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

export const CHAT_MODEL = "openai/gpt-oss-120b";
export const TRANSCRIBE_MODEL = "whisper-large-v3";

export function getGroqHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

export function assertApiKey(apiKey?: string) {
  if (!apiKey?.trim()) {
    throw new Error("A Groq API key is required.");
  }
}

export function takeRecentTranscript(chunks: TranscriptChunk[], count: number) {
  if (count <= 0) {
    return chunks;
  }

  return chunks.slice(Math.max(0, chunks.length - count));
}

export function transcriptToPrompt(chunks: TranscriptChunk[]) {
  if (!chunks.length) {
    return "No transcript has been captured yet.";
  }

  return chunks
    .map(
      (chunk) =>
        `[${new Date(chunk.startedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })} - ${new Date(chunk.endedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })}] ${chunk.text}`
    )
    .join("\n");
}

export function recentChatToPrompt(history: ChatMessage[], turns: number) {
  return history
    .slice(Math.max(0, history.length - turns))
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");
}

export async function groqJsonCompletion({
  apiKey,
  systemPrompt,
  userPrompt,
  temperature = 0.3
}: {
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}) {
  assertApiKey(apiKey);

  const response = await fetch(GROQ_CHAT_ENDPOINT, {
    method: "POST",
    headers: getGroqHeaders(apiKey),
    body: JSON.stringify({
      model: CHAT_MODEL,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(await readGroqError(response));
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Groq returned an empty response.");
  }

  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("Groq returned invalid JSON.");
  }
}

export async function transcribeAudio({
  apiKey,
  file,
  prompt,
  language
}: {
  apiKey: string;
  file: File;
  prompt: string;
  language: string;
}) {
  assertApiKey(apiKey);

  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", TRANSCRIBE_MODEL);
  formData.append("prompt", prompt);
  if (language) {
    formData.append("language", language);
  }
  formData.append("temperature", "0");

  const response = await fetch(GROQ_TRANSCRIBE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(await readGroqError(response));
  }

  return (await response.json()) as { text?: string };
}

export async function readGroqError(response: Response) {
  try {
    const payload = await response.json();
    return payload.error?.message ?? payload.message ?? "Groq request failed.";
  } catch {
    return "Groq request failed.";
  }
}

import { NextResponse } from "next/server";
import {
  CHAT_MODEL,
  assertApiKey,
  getGroqHeaders,
  recentChatToPrompt,
  takeRecentTranscript,
  transcriptToPrompt
} from "@/lib/groq";
import type { ChatMessage, TranscriptChunk } from "@/lib/types";

type ChatRequestBody = {
  apiKey: string;
  transcriptChunks: TranscriptChunk[];
  chatHistory: ChatMessage[];
  question: string;
  prompt: string;
  transcriptWindow: number;
  chatHistoryTurns: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    assertApiKey(body.apiKey);

    const transcriptWindow = takeRecentTranscript(body.transcriptChunks, body.transcriptWindow);

    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: getGroqHeaders(body.apiKey),
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: 0.35,
        stream: true,
        messages: [
          { role: "system", content: body.prompt },
          {
            role: "user",
            content: [
              "Transcript context:",
              transcriptToPrompt(transcriptWindow),
              "",
              "Recent chat history:",
              recentChatToPrompt(body.chatHistory, body.chatHistoryTurns) || "No prior chat yet.",
              "",
              `User request: ${body.question}`
            ].join("\n")
          }
        ]
      })
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: upstream.ok ? "Groq did not return a stream." : await readStreamError(upstream) },
        { status: 500 }
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";

            for (const event of events) {
              const lines = event
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.startsWith("data:"));

              for (const line of lines) {
                const data = line.replace(/^data:\s*/, "");

                if (data === "[DONE]") {
                  controller.close();
                  return;
                }

                try {
                  const payload = JSON.parse(data) as {
                    choices?: Array<{ delta?: { content?: string } }>;
                  };
                  const content = payload.choices?.[0]?.delta?.content;

                  if (content) {
                    controller.enqueue(encoder.encode(content));
                  }
                } catch {
                  continue;
                }
              }
            }
          }

          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat failed." },
      { status: 500 }
    );
  }
}

async function readStreamError(response: Response) {
  try {
    const payload = await response.json();
    return payload.error?.message ?? payload.message ?? "Chat failed.";
  } catch {
    return "Chat failed.";
  }
}

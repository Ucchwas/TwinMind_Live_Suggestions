import { NextResponse } from "next/server";
import { groqJsonCompletion, takeRecentTranscript, transcriptToPrompt } from "@/lib/groq";
import type { Suggestion, TranscriptChunk } from "@/lib/types";

function normalizeKind(value: string): Suggestion["kind"] {
  const knownKinds: Suggestion["kind"][] = [
    "question",
    "talking-point",
    "answer",
    "fact-check",
    "context"
  ];

  return knownKinds.includes(value as Suggestion["kind"])
    ? (value as Suggestion["kind"])
    : "context";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      apiKey: string;
      transcriptChunks: TranscriptChunk[];
      suggestionPrompt: string;
      suggestionContextChunks: number;
      priorSuggestions: Array<{ title: string; preview: string }>;
    };

    const contextChunks = takeRecentTranscript(
      body.transcriptChunks,
      Math.max(1, body.suggestionContextChunks)
    );

    const result = await groqJsonCompletion({
      apiKey: body.apiKey,
      systemPrompt: body.suggestionPrompt,
      userPrompt: [
        "Recent transcript:",
        transcriptToPrompt(contextChunks),
        "",
        "Recent prior suggestions to avoid repeating:",
        body.priorSuggestions.length
          ? body.priorSuggestions.map((item) => `- ${item.title}: ${item.preview}`).join("\n")
          : "None"
      ].join("\n")
    });

    const rawSuggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
    const suggestions: Suggestion[] = rawSuggestions.slice(0, 3).map((item, index) => {
      const record = item as Record<string, unknown>;

      return {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        title: String(record.title ?? `Suggestion ${index + 1}`).trim(),
        preview: String(record.preview ?? "").trim(),
        kind: normalizeKind(String(record.kind ?? "context").trim()),
        reason: String(record.reason ?? "").trim()
      };
    });

    if (suggestions.length !== 3 || suggestions.some((item) => !item.preview || !item.title)) {
      throw new Error("Suggestion generation did not return 3 valid suggestions.");
    }

    return NextResponse.json({
      suggestions,
      contextChunkIds: contextChunks.map((chunk) => chunk.id)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Suggestion generation failed." },
      { status: 500 }
    );
  }
}

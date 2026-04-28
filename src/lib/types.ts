export type TranscriptChunk = {
  id: string;
  text: string;
  createdAt: string;
  startedAt: string;
  endedAt: string;
};

export type Suggestion = {
  id: string;
  createdAt: string;
  title: string;
  preview: string;
  kind: "question" | "talking-point" | "answer" | "fact-check" | "context";
  reason: string;
};

export type SuggestionBatch = {
  id: string;
  createdAt: string;
  sourceChunkIds: string[];
  suggestions: Suggestion[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  source: "manual" | "suggestion";
};

export type AppSettings = {
  apiKey: string;
  suggestionPrompt: string;
  detailPrompt: string;
  chatPrompt: string;
  transcriptionPrompt: string;
  suggestionContextChunks: number;
  detailContextChunks: number;
  chatContextChunks: number;
  chatHistoryTurns: number;
  transcriptionLanguage: string;
};

export type SuggestionApiResponse = {
  suggestions: Suggestion[];
  contextChunkIds: string[];
};

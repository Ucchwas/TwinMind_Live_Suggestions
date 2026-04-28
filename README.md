# TwinMind Live Suggestions

A live meeting workspace for the TwinMind assignment. It records microphone audio, turns the conversation into rolling transcript chunks, and keeps a fresh set of three practical suggestions available while the discussion is still happening.

## Live Demo

https://livesuggestions-l37eyml0x-ucchwas-projects.vercel.app/

## What It Does

- Records microphone audio from the browser
- Transcribes audio in roughly 30-second chunks
- Shows the transcript in a left-side rolling feed
- Generates exactly 3 live suggestions on each refresh
- Keeps the newest suggestion batch at the top while preserving older batches
- Opens a detailed answer in the right-side chat when a suggestion is clicked
- Supports direct chat questions in the same session
- Exports the full session as JSON, including transcript, suggestion batches, chat history, and timestamps
- Lets the user edit prompts and context-window settings from the Settings drawer

## Model Choices

All model calls go through Groq, as required by the assignment:

- Transcription: `whisper-large-v3`
- Suggestions and chat: `openai/gpt-oss-120b`

The app does not ship with an API key. Each user pastes their own Groq key in Settings, and the key is stored only in that browser's local storage.

## Prompt Strategy

The main goal is to make each refresh useful without requiring the user to click anything. Suggestion previews are intentionally written to carry immediate value on their own, while the clicked answer gives more depth when the user wants it.

Live suggestions are asked to balance a few modes depending on the transcript:

- A question the user could ask next
- A concise talking point
- A direct answer to something that came up
- A factual check or correction
- Clarifying context that would help the conversation move forward

The suggestion route also sends a short memory of recent suggestion previews so new batches avoid repeating the same angle unless the conversation has clearly returned to it.

Clicked suggestions use a separate prompt. That prompt treats the selected card as the immediate task and uses the transcript as meeting context, so the answer feels ready to use rather than like a generic explanation.

Direct chat has its own prompt and context window. This keeps typed questions responsive while still grounding answers in the transcript and recent chat history.

## Editable Settings

The Settings drawer exposes:

- Groq API key
- Transcription language
- Suggestion transcript context window
- Clicked-suggestion transcript context window
- Direct-chat transcript context window
- Chat history turns
- Transcription prompt
- Live suggestion prompt
- Expanded-answer prompt
- Direct chat prompt

For clicked-suggestion and direct-chat transcript windows, `0` means the full transcript is used.

## How To Run Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

Open Settings, paste a Groq API key, and start the mic.

## Project Structure

- `src/components/session-workspace.tsx` handles the client-side session flow, recording, transcript state, suggestion timeline, chat panel, export, and settings drawer.
- `src/app/api/transcribe/route.ts` proxies browser audio chunks to Groq transcription.
- `src/app/api/suggestions/route.ts` builds the live suggestion request and validates the 3-suggestion response.
- `src/app/api/chat/route.ts` streams detailed suggestion answers and direct chat responses.
- `src/lib/default-settings.ts` contains the default prompts and tunable values.
- `src/lib/groq.ts` centralizes Groq endpoints, model IDs, and transcript formatting helpers.

## Stack

- Next.js App Router
- React
- TypeScript
- Native browser `MediaRecorder`
- Groq API
- Plain CSS

## Tradeoffs

Audio capture uses the browser's built-in `MediaRecorder`, which keeps the app simple and easy to deploy. The tradeoff is that recording support depends on the user's browser.

Suggestions refresh on chunk boundaries and manual refresh. That matches the assignment's 30-second rhythm and keeps the experience predictable, though it is not word-by-word realtime.

Chat responses stream as text for lower perceived latency. Suggestions use structured JSON instead, because the UI needs exactly three clean cards every time.

## Verification

Checked with:

```bash
npm run lint
npm run typecheck
npm run build
```

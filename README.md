# TwinMind Live Suggestions

A three-column meeting copilot built for the TwinMind live suggestions assignment.

- Left column: microphone controls plus rolling transcript chunks
- Middle column: fresh batches of 3 live suggestions every refresh
- Right column: continuous chat for expanded suggestion answers and direct questions

The app uses Groq for every model call:

- `whisper-large-v3` for speech-to-text
- `openai/gpt-oss-120b` for live suggestions and chat

## How To Run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

3. Open `http://localhost:3000`
4. Open `Settings`
5. Paste your Groq API key
6. Start recording

## What The Project Does

- Captures microphone audio in the browser with `MediaRecorder`
- Flushes transcript chunks roughly every 30 seconds and on manual refresh
- Sends each chunk to a Next.js route that proxies Groq Whisper transcription
- Generates exactly 3 live suggestions from recent transcript context
- Keeps the newest suggestion batch at the top while preserving older batches below
- Lets the user click any suggestion to add it to chat and stream a deeper answer
- Lets the user ask direct questions in the same chat session
- Exports transcript, suggestion batches, and chat history as JSON with timestamps
- Lets the user edit prompts and context-window settings in the UI

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Native `fetch` route handlers for Groq integration
- CSS in `src/app/globals.css`

## Prompt Strategy

### Live Suggestions

The live suggestion prompt is tuned for the main assignment goal: show the right mix of useful cards at the right moment.

It explicitly asks the model to:

- Return exactly 3 suggestions
- Prefer immediate usefulness over generic advice
- Mix suggestion types when the transcript supports it
- Avoid repeating recent angles
- Make each preview helpful even before the card is clicked

The app also sends a short memory of prior suggestions so the model can avoid redundant batches.

### Clicked Suggestion Answers

Clicked suggestions use a separate prompt focused on "expand this into something I can use right now in the meeting." By default, clicked suggestions use the full transcript context.

### Direct Chat

Direct chat uses a separate prompt and its own transcript-window setting so freeform questions can stay faster and more controllable than suggestion expansions.

## Editable Settings

The settings drawer exposes:

- Groq API key
- Transcription language
- Suggestion context chunks
- Clicked-suggestion context chunks
- Direct chat context chunks
- Chat history turns
- Transcription prompt
- Live suggestions prompt
- Expanded-answer prompt
- Direct chat prompt

`0` means "use the full transcript" for the clicked-suggestion and direct-chat transcript windows.

## Architecture

- [`src/components/session-workspace.tsx`](./src/components/session-workspace.tsx) contains the client-side session flow, recording logic, suggestion timeline, chat UI, export, and settings drawer.
- [`src/app/api/transcribe/route.ts`](./src/app/api/transcribe/route.ts) proxies Groq Whisper transcription.
- [`src/app/api/suggestions/route.ts`](./src/app/api/suggestions/route.ts) builds a recent transcript prompt and requests JSON suggestions.
- [`src/app/api/chat/route.ts`](./src/app/api/chat/route.ts) streams detailed answers or direct chat responses from Groq.
- [`src/lib/default-settings.ts`](./src/lib/default-settings.ts) stores the default prompts and tunable parameters.
- [`src/lib/groq.ts`](./src/lib/groq.ts) centralizes Groq model IDs and transcript helpers.

## Requirement Coverage

Implemented:

- Start/stop mic control
- Transcript appended in roughly 30-second chunks while recording
- Transcript auto-scroll
- Automatic transcript and suggestion refresh every ~30 seconds while recording
- Manual refresh button
- Exactly 3 suggestions per refresh
- New suggestion batch appears on top
- Older suggestion batches remain visible
- Suggestion cards show useful previews before click
- Suggestion click adds the selection to chat and streams a deeper answer
- Direct user questions in chat
- One continuous in-memory chat session
- Export button for transcript, suggestion batches, and chat history with timestamps
- User-provided Groq API key in settings
- Editable prompts and context-window settings

## PDF Notes

I did not find any hidden prompt text in the PDF metadata, extracted text, or annotations.

I did find one non-obvious item:

- Page 1 contains a hidden clickable link annotation to the reference prototype:
  `https://claude.ai/public/artifacts/2d262df0-0353-47cc-a03a-de434aaa2552`

That link is not visible in the extracted text, but it is embedded as the prototype reference. I could not inspect the page contents directly from this environment because the public artifact is behind a Cloudflare challenge.

## Tradeoffs

- Audio chunking is browser-native and simple, which keeps the project easy to deploy, but it depends on `MediaRecorder` support in the user browser.
- Suggestions refresh on chunk boundaries and manual refresh, which matches the assignment and keeps the behavior understandable, but it is not word-by-word realtime.
- The Groq API key is stored in browser local storage for convenience because the assignment requires the user to paste their own key.
- Chat is streamed, while suggestions are returned as structured JSON for determinism.

## Verification

Verified with:

```bash
npm run lint
npm run typecheck
npm run build
```

## Deployment

The app is ready to deploy on Vercel or another Next.js-friendly host. After deployment, the user only needs to paste their own Groq API key in the settings drawer.

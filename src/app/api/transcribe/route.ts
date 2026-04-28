import { NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/groq";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const apiKey = String(formData.get("apiKey") ?? "");
    const prompt = String(formData.get("prompt") ?? "");
    const language = String(formData.get("language") ?? "");
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Audio file is required." }, { status: 400 });
    }

    const result = await transcribeAudio({
      apiKey,
      file,
      prompt,
      language
    });

    return NextResponse.json({ text: result.text?.trim() ?? "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";

    if (isTooShortAudioError(message)) {
      return NextResponse.json({
        text: "",
        skipped: "audio-too-short"
      });
    }

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

function isTooShortAudioError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("audio file is too short") || normalized.includes("minimum audio length");
}

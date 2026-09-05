/**
 * Dictation for the launcher's Intent field, via Sarvam's Saaras speech-to-text.
 *
 * The browser records the clip and posts it here; the key never leaves the server. The
 * language is left as `unknown` so Saaras detects it — the people demoing this speak a
 * mix of English and Indic languages into the same box, and asking them to pick a
 * language first would cost more clicks than typing the sentence would have saved.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text";

// Saaras rejects long clips on the synchronous endpoint (batch jobs exist for those), and
// an intent is a sentence, not a monologue. Refuse early with something a human can act on.
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    return Response.json(
      { error: "Dictation is off: set SARVAM_API_KEY in .env and restart the server." },
      { status: 501 },
    );
  }

  let audio: File | null = null;
  try {
    const body = await req.formData();
    const file = body.get("audio");
    if (file instanceof File) audio = file;
  } catch {
    return Response.json({ error: "Expected an audio upload." }, { status: 400 });
  }
  if (!audio || audio.size === 0) {
    return Response.json({ error: "No audio was recorded." }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return Response.json(
      { error: "That clip is too long. Keep dictation to a sentence or two." },
      { status: 413 },
    );
  }

  // `audio/webm;codecs=opus` is what Chrome's MediaRecorder reports, and Sarvam matches
  // the *whole* content-type against its allow-list — the codecs parameter included — so
  // it answers 400 "Invalid file type" for a container it plainly accepts. Re-wrap the
  // bytes with the bare type; nothing else about the upload changes.
  const baseType = (audio.type || "audio/webm").split(";")[0].trim();
  const cleaned = new File([await audio.arrayBuffer()], audio.name || "intent.webm", {
    type: baseType,
  });

  const form = new FormData();
  form.set("file", cleaned, cleaned.name);
  form.set("model", "saaras:v3");
  form.set("language_code", "unknown");
  form.set("with_timestamps", "false");

  let resp: Response;
  try {
    resp = await fetch(SARVAM_STT_URL, {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form,
    });
  } catch (err) {
    return Response.json(
      { error: `Could not reach Sarvam: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (!resp.ok) {
    // Sarvam's own message is the useful one (bad key, unsupported codec, quota), so pass
    // it through rather than flattening every failure into "transcription failed".
    const detail = (await resp.text()).slice(0, 500);
    return Response.json(
      { error: `Sarvam returned ${resp.status}: ${detail}` },
      { status: 502 },
    );
  }

  const data = (await resp.json()) as {
    transcript?: string;
    language_code?: string;
  };
  return Response.json({
    transcript: (data.transcript ?? "").trim(),
    languageCode: data.language_code ?? null,
  });
}

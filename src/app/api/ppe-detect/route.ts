import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeminiChecklist = {
  person: boolean;
  personInRoi: boolean;
  hardhat: boolean;
  safety_vest: boolean;
  gloves: boolean;
  bossHat: boolean;
};

function extractJsonCandidate(text: string): string {
  const raw = text.trim();
  if (!raw) return "";
  if (raw.startsWith("{") && raw.endsWith("}")) return raw;

  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const generic = raw.match(/```\s*([\s\S]*?)```/i);
  if (generic?.[1]) return generic[1].trim();

  const start = raw.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
  }

  return raw;
}

function toChecklistSafe(rawText: string): { checklist: GeminiChecklist; parseError?: string } {
  const fallback: GeminiChecklist = {
    person: false,
    personInRoi: false,
    hardhat: false,
    safety_vest: false,
    gloves: false,
    bossHat: false,
  };

  const candidate = extractJsonCandidate(rawText);
  if (!candidate) {
    return { checklist: fallback, parseError: "Empty model output" };
  }

  try {
    const parsed = JSON.parse(candidate) as Partial<GeminiChecklist>;
    return {
      checklist: {
        person: Boolean(parsed.person),
        personInRoi: Boolean(parsed.personInRoi),
        hardhat: Boolean(parsed.hardhat),
        safety_vest: Boolean(parsed.safety_vest),
        gloves: Boolean(parsed.gloves),
        bossHat: Boolean(parsed.bossHat),
      },
    };
  } catch (error) {
    return {
      checklist: fallback,
      parseError: error instanceof Error ? error.message : "Invalid JSON from model",
    };
  }
}

function extractTextFromChunk(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  const root = obj as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = root.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" ? text : "";
}

async function readGeminiStream(response: Response): Promise<{ text: string; chunkCount: number }> {
  const body = await response.text();
  const lines = body.split(/\r?\n/);
  let merged = "";
  let chunkCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    try {
      const chunk = JSON.parse(payload) as unknown;
      const delta = extractTextFromChunk(chunk);
      if (delta) {
        merged += delta;
        chunkCount += 1;
      }
    } catch {
      // ignore malformed chunk
    }
  }

  return { text: merged.trim(), chunkCount };
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing GOOGLE_AI_API_KEY (or GEMINI_API_KEY). Configure env for local/Cloudflare Pages.",
        },
        { status: 500 },
      );
    }

    const body = (await req.json()) as {
      imageBase64?: string;
      roiRect?: { x: number; y: number; width: number; height: number };
    };

    const imageBase64 = body.imageBase64?.replace(/^data:image\/\w+;base64,/, "");
    const roi = body.roiRect ?? { x: 0.2, y: 0.15, width: 0.6, height: 0.75 };

    if (!imageBase64) {
      return NextResponse.json({ ok: false, error: "Missing imageBase64" }, { status: 400 });
    }

    const prompt = `You are a PPE inspector. Analyze this image and answer ONLY strict JSON object with shape:
{"person":boolean,"personInRoi":boolean,"hardhat":boolean,"safety_vest":boolean,"gloves":boolean,"bossHat":boolean}
ROI rectangle (normalized): x=${roi.x}, y=${roi.y}, width=${roi.width}, height=${roi.height}
Rules:
- person=true if at least one worker/person is visible.
- personInRoi=true if center point of any visible person is inside ROI rectangle.
- hardhat=true if any visible person clearly wears a hardhat/helmet.
- safety_vest=true if any visible person clearly wears a safety vest/reflective vest.
- gloves=true if any visible person clearly wears gloves.
- bossHat=true if the person appears to wear a stylish/fashion hat (e.g. fedora, cap as non-safety hat) indicating manager/boss exception.
- Return MINIFIED JSON only. No markdown, no explanation, no prefix/suffix text.`;

    const payload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: imageBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        topP: 0.1,
        topK: 1,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    };

    const modelCandidates = ["gemini-3.1-pro-preview"];
    let response: Response | null = null;
    let lastErrorText = "";
    let usedModel = "";

    for (const modelName of modelCandidates) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (res.ok) {
        response = res;
        usedModel = modelName;
        break;
      }

      lastErrorText = await res.text();
    }

    if (!response) {
      return NextResponse.json(
        { ok: false, error: `Gemini API error (all models failed): ${lastErrorText}` },
        { status: 502 },
      );
    }

    const { text: rawText, chunkCount } = await readGeminiStream(response);
    if (!rawText) {
      return NextResponse.json(
        {
          ok: false,
          error: "Empty model output from stream",
          model: usedModel,
          chunkCount,
        },
        { status: 502 },
      );
    }

    const { checklist, parseError } = toChecklistSafe(rawText);
    if (parseError) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unable to parse model output: ${parseError}`,
          rawText: rawText.slice(0, 500),
          model: usedModel,
          chunkCount,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, checklist, rawText, model: usedModel, chunkCount });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

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
      if (ch === '"') { inString = true; continue; }
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
  const fallback: GeminiChecklist = { person: false, personInRoi: false, hardhat: false, safety_vest: false, gloves: false, bossHat: false };
  const candidate = extractJsonCandidate(rawText);
  if (!candidate) return { checklist: fallback, parseError: "Empty model output" };
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
    return { checklist: fallback, parseError: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

function extractTextFromChunk(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  const root = obj as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return typeof root.candidates?.[0]?.content?.parts?.[0]?.text === "string" ? root.candidates[0].content.parts[0].text : "";
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
      const delta = extractTextFromChunk(JSON.parse(payload));
      if (delta) { merged += delta; chunkCount += 1; }
    } catch { /* ignore */ }
  }
  return { text: merged.trim(), chunkCount };
}

const MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash-lite", "gemini-3.1-pro-preview"];

export async function POST(req: Request) {
  console.log("[PPE API] Request received");

  try {
    const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[PPE API] Missing GOOGLE_AI_API_KEY");
      return NextResponse.json({ ok: false, error: "Missing GOOGLE_AI_API_KEY. Configure env." }, { status: 500 });
    }

    const body = (await req.json()) as { imageBase64?: string; roiRect?: { x: number; y: number; width: number; height: number } };
    const imageBase64 = body.imageBase64?.replace(/^data:image\/\w+;base64,/, "");
    const roi = body.roiRect ?? { x: 0.2, y: 0.15, width: 0.6, height: 0.75 };

    if (!imageBase64) {
      console.warn("[PPE API] Missing imageBase64");
      return NextResponse.json({ ok: false, error: "Missing imageBase64" }, { status: 400 });
    }

    const prompt = `You are a PPE inspector. Analyze this image and answer ONLY strict JSON:
{"person":boolean,"personInRoi":boolean,"hardhat":boolean,"safety_vest":boolean,"gloves":boolean,"bossHat":boolean}
ROI: x=${roi.x}, y=${roi.y}, w=${roi.width}, h=${roi.height}
Return MINIFIED JSON only. No markdown, no explanation.`;

    const payload = {
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: imageBase64 } }] }],
      generationConfig: { temperature: 0, topP: 0.1, topK: 1, maxOutputTokens: 1024, responseMimeType: "application/json" },
    };

    let response: Response | null = null;
    let usedModel = "";

    for (let i = 0; i < MODELS.length; i++) {
      const modelName = MODELS[i];
      console.log(`[PPE API] Trying model [${i + 1}/${MODELS.length}]: ${modelName}`);

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );

      if (res.ok) {
        console.log(`[PPE API] SUCCESS using model: ${modelName}`);
        response = res;
        usedModel = modelName;
        break;
      } else {
        const errText = await res.text();
        console.warn(`[PPE API] Model ${modelName} failed (${res.status}): ${errText.slice(0, 200)}`);
      }
    }

    if (!response) {
      console.error("[PPE API] All models failed");
      return NextResponse.json({ ok: false, error: "All Gemini models failed" }, { status: 502 });
    }

    const { text: rawText, chunkCount } = await readGeminiStream(response);
    console.log(`[PPE API] Stream received: ${chunkCount} chunks, text length: ${rawText.length}`);

    if (!rawText) {
      console.warn("[PPE API] Empty model output");
      return NextResponse.json({ ok: false, error: "Empty model output", model: usedModel, chunkCount }, { status: 502 });
    }

    console.log(`[PPE API] Raw output: ${rawText.slice(0, 300)}`);

    const { checklist, parseError } = toChecklistSafe(rawText);
    if (parseError) {
      console.error(`[PPE API] Parse error: ${parseError}`);
      return NextResponse.json({ ok: false, error: `Parse error: ${parseError}`, rawText: rawText.slice(0, 500), model: usedModel }, { status: 502 });
    }

    console.log(`[PPE API] SUCCESS - checklist:`, checklist);
    return NextResponse.json({ ok: true, checklist, model: usedModel, chunkCount });

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[PPE API] Exception: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

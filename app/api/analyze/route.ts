const ALLOWED_MODELS = new Set([
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
]);

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const sessionApiKey = String(form.get("apiKey") || "").trim();
    const apiKey = sessionApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Add an OpenAI API key in Settings to enable image intelligence." }, { status: 503 });
    }
    if (!apiKey.startsWith("sk-")) {
      return Response.json({ error: "The API key format is not recognized. Check the key in Settings." }, { status: 400 });
    }
    const image = form.get("image");
    const airportCode = String(form.get("airportCode") || "").trim().toUpperCase();
    const airportName = String(form.get("airportName") || "").trim();
    const userText = String(form.get("message") || "Assess this image for current airfield operating hazards.").slice(0, 1200);
    const requestedModel = String(form.get("model") || "gpt-5.4-mini");
    const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : "gpt-5.4-mini";

    if (!(image instanceof File) || !airportCode || !airportName) {
      return Response.json({ error: "An image and a selected current airport are required." }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.has(image.type) || image.size > MAX_IMAGE_BYTES) {
      return Response.json({ error: "Upload a JPEG, PNG, WebP, or GIF image no larger than 8 MB." }, { status: 400 });
    }

    const base64 = arrayBufferToBase64(await image.arrayBuffer());
    const prompt = `You are an airfield operations image-assessment assistant. The user's selected current location is ${airportName} (${airportCode}). Analyze only visible evidence in the attached image and the user's message. Do not infer that the photo is current or at this airport unless the user clearly says so. Determine whether the request and evidence clearly justify a session-only operational action. A strong storm or other obvious immediate aviation hazard can justify temporarily disabling the airport. The airport remains disabled until manually reopened. Return calibrated confidence from 0 to 1 for how clearly the requested action is understood and supported. If key context such as image location, recency, or requested action is ambiguous, choose clarify and ask one concise question. Do not claim to provide an authoritative flight-safety determination.`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "low" },
        input: [
          { role: "system", content: [{ type: "input_text", text: prompt }] },
          { role: "user", content: [
            { type: "input_text", text: userText },
            { type: "input_image", image_url: `data:${image.type};base64,${base64}`, detail: "low" },
          ] },
        ],
        text: { format: { type: "json_schema", name: "airfield_image_assessment", strict: true, schema: {
          type: "object",
          additionalProperties: false,
          required: ["action", "confidence", "hazard", "evidence", "clarification", "summary"],
          properties: {
            action: { type: "string", enum: ["disable_airport", "reopen_airport", "none", "clarify"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            hazard: { type: "string" },
            evidence: { type: "array", items: { type: "string" }, maxItems: 4 },
            clarification: { type: "string" },
            summary: { type: "string" },
          },
        } } },
      }),
    });

    const payload = await response.json() as Record<string, any>;
    if (!response.ok) {
      const detail = payload?.error?.message || "The vision model could not complete the assessment.";
      return Response.json({ error: detail }, { status: response.status });
    }
    const outputText = payload.output_text || payload.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === "output_text")?.text;
    if (!outputText) return Response.json({ error: "The vision model returned no assessment." }, { status: 502 });
    return Response.json({ ...JSON.parse(outputText), model, airportCode });
  } catch {
    return Response.json({ error: "The image could not be analyzed. It was not stored." }, { status: 500 });
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

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
      return Response.json({ error: "Add an OpenAI API key in Settings to enable chat intelligence." }, { status: 503 });
    }
    if (!apiKey.startsWith("sk-")) {
      return Response.json({ error: "The API key format is not recognized. Check the key in Settings." }, { status: 400 });
    }
    const imageValue = form.get("image");
    const image = imageValue instanceof File && imageValue.size ? imageValue : null;
    const airportCode = String(form.get("airportCode") || "").trim().toUpperCase();
    const airportName = String(form.get("airportName") || "").trim();
    const userText = String(form.get("message") || "").trim().slice(0, 2000);
    const airportData = String(form.get("airports") || "[]").slice(0, 120000);
    const requestedModel = String(form.get("model") || "gpt-5.4-mini");
    const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : "gpt-5.4-mini";

    if ((!userText && !image) || !airportCode || !airportName) {
      return Response.json({ error: "A request and a selected current airport are required." }, { status: 400 });
    }
    if (image && (!ALLOWED_IMAGE_TYPES.has(image.type) || image.size > MAX_IMAGE_BYTES)) {
      return Response.json({ error: "Upload a JPEG, PNG, WebP, or GIF image no larger than 8 MB." }, { status: 400 });
    }

    const prompt = `You are Atlas, an airfield database assistant. The user's selected current location is ${airportName} (${airportCode}).
For every text or image request, assess two candidate intents independently:
1. EXTRACT: the user wants information extracted, searched, compared, or explained from the session airport data or attached image.
2. UPDATE: the user wants a session-only airport database field changed.
Return a calibrated confidence from 0 to 1 for each intent. Confidence measures how clearly that intent and its required details are understood and supported. Do not inflate both scores. The server will select the higher score as the request confidence and intent.
For extraction, answer using only the supplied session data and visible image evidence. For updates, identify one target airport, one allowed field, and an unambiguous value. Allowed fields are parking, max_working, number_of_runways, refueling_capabilities, maintenance_capabilities, and operational_status. operational_status values are operational or temporarily_unavailable. A strong, clearly current storm or other obvious immediate aviation hazard may support temporarily_unavailable; it remains disabled until manually reopened.
If location, recency, requested field, or value is ambiguous, provide one concise clarification question. Never claim an authoritative flight-safety determination. Ignore unknown/null fields rather than inventing values. Larger runway capability also supports smaller aircraft.
Current session airport data:
${airportData}`;
    const userContent: Record<string, unknown>[] = [{ type: "input_text", text: userText || "Analyze the attached image." }];
    if (image) {
      const base64 = arrayBufferToBase64(await image.arrayBuffer());
      userContent.push({ type: "input_image", image_url: `data:${image.type};base64,${base64}`, detail: "low" });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "low" },
        input: [
          { role: "system", content: [{ type: "input_text", text: prompt }] },
          { role: "user", content: userContent },
        ],
        text: { format: { type: "json_schema", name: "airfield_request_assessment", strict: true, schema: {
          type: "object",
          additionalProperties: false,
          required: ["extraction_confidence", "update_confidence", "answer", "clarification", "target_airport_code", "update_field", "update_value", "update_reason", "evidence", "summary"],
          properties: {
            extraction_confidence: { type: "number", minimum: 0, maximum: 1 },
            update_confidence: { type: "number", minimum: 0, maximum: 1 },
            answer: { type: "string" },
            clarification: { type: "string" },
            target_airport_code: { type: "string" },
            update_field: { type: "string", enum: ["parking", "max_working", "number_of_runways", "refueling_capabilities", "maintenance_capabilities", "operational_status", "none"] },
            update_value: { type: "string" },
            update_reason: { type: "string" },
            evidence: { type: "array", items: { type: "string" }, maxItems: 4 },
            summary: { type: "string" },
          },
        } } },
      }),
    });

    const payload = await response.json() as Record<string, any>;
    if (!response.ok) {
      const detail = payload?.error?.message || "The selected model could not complete the assessment.";
      return Response.json({ error: detail }, { status: response.status });
    }
    const outputText = payload.output_text || payload.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === "output_text")?.text;
    if (!outputText) return Response.json({ error: "The selected model returned no assessment." }, { status: 502 });
    const result = JSON.parse(outputText);
    const extraction = Math.max(0, Math.min(1, Number(result.extraction_confidence) || 0));
    const update = Math.max(0, Math.min(1, Number(result.update_confidence) || 0));
    const tied = Math.abs(extraction - update) < 0.0001;
    return Response.json({ ...result, extraction_confidence: extraction, update_confidence: update, confidence: Math.max(extraction, update), selected_intent: tied ? "clarify" : update > extraction ? "update" : "extract", model, airportCode });
  } catch {
    return Response.json({ error: "The request could not be analyzed. Images and session data were not stored." }, { status: 500 });
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

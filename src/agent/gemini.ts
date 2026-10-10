// src/agent/gemini.ts
// Gemini client: askText and askJSON, each with a timeout (GEMINI_TIMEOUT_MS)
// that returns null on any failure. Every caller must have a template fallback;
// the demo never waits on, or breaks because of, Gemini.
// The API key is read from src/config.ts and is never logged.

import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

const ai = new GoogleGenAI({ apiKey: config.gemini.key });

// Reject if the wrapped promise has not settled within ms.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("gemini timeout")), ms)),
  ]);
}

// The Interactions API returns output_text; the legacy API returns text.
function extractText(r: any): string {
  return String(r?.output_text ?? r?.text ?? "").trim();
}

// Primary path is the Interactions API. If it throws, or the model/response shape
// differs, fall back to the legacy generateContent call. The `any` casts keep this
// resilient to the small SDK/API differences we are still verifying in Stage 1.
async function callModel(instructions: string, input: string, jsonSchema?: object): Promise<string> {
  const anyAi: any = ai;
  try {
    const params: any = { model: config.gemini.model, system_instruction: instructions, input };
    if (jsonSchema) {
      params.response_format = { type: "text", mime_type: "application/json", schema: jsonSchema };
    }
    const r = await anyAi.interactions.create(params);
    const text = extractText(r);
    if (text) return text;
  } catch (e) {
    console.warn("gemini interactions path failed, trying legacy:", String(e));
  }
  const legacy: any = { model: config.gemini.model, contents: instructions + "\n\n" + input };
  if (jsonSchema) {
    legacy.config = { responseMimeType: "application/json", responseJsonSchema: jsonSchema };
  }
  const r = await anyAi.models.generateContent(legacy);
  return extractText(r);
}

export async function askText(instructions: string, input: string): Promise<string | null> {
  try {
    const text = await withTimeout(callModel(instructions, input), config.gemini.timeoutMs);
    return text || null;
  } catch (e) {
    console.warn("gemini text failed:", String(e));
    return null;
  }
}

export async function askJSON<T>(instructions: string, input: string, schema: object): Promise<T | null> {
  try {
    const raw = await withTimeout(callModel(instructions, input, schema), config.gemini.timeoutMs);
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn("gemini json failed:", String(e));
    return null;
  }
}


import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { SubtitleBlock, TitleAnalysis, HybridOptimizeSuggestion } from "../types";

const MAP_MODEL_ID = (modelName: string): string => {
  const name = modelName.toLowerCase();
  if (name.includes('pro')) return 'gemini-3-pro-preview';
  // Default to Gemini 3 Flash per Persona instructions for general tasks
  return 'gemini-3-flash-preview';
};

const mapApiError = (error: any): string => {
  const msg = error?.toString() || "";
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) return "API quota exceeded";
  if (msg.includes("401")) return "Invalid API key";
  if (msg.includes("403")) return "Access denied";
  if (msg.includes("timeout") || msg.includes("deadline")) return "Network error";
  return "Unexpected error occurred";
};

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 2000): Promise<T> {
  try { 
    return await fn(); 
  } catch (error: any) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

export const checkApiHealth = async (model: string): Promise<boolean> => {
  const apiKey = process.env.API_KEY || '';
  if (!apiKey) return false;
  try {
    const ai = new GoogleGenAI({ apiKey });
    await withRetry(() => ai.models.generateContent({ 
      model: MAP_MODEL_ID(model), 
      contents: "hi", 
      config: { 
        maxOutputTokens: 10,
        thinkingConfig: { thinkingBudget: 0 }
      } 
    }));
    return true;
  } catch { return false; }
};

export const analyzeTitle = async (title: string, model: string): Promise<{ analysis: TitleAnalysis, tokens: number }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
  const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
    model: MAP_MODEL_ID(model),
    contents: `Analyze Donghua title "${title}" for translation direction. Return JSON.`,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          originalTitle: { type: Type.STRING },
          translatedTitle: { type: Type.STRING },
          mainGenres: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING },
          tone: { type: Type.STRING },
          recommendedStyle: { type: Type.STRING }
        },
        required: ["originalTitle", "translatedTitle", "mainGenres", "summary", "tone", "recommendedStyle"]
      }
    }
  }));
  return { analysis: JSON.parse(response.text || "{}"), tokens: response.usageMetadata?.totalTokenCount || 0 };
};

export const translateBatch = async (
  blocks: SubtitleBlock[],
  analysis: TitleAnalysis,
  model: string
): Promise<{ id: string, translated: string }[]> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
    const prompt = `Dịch phụ đề Donghua: "${analysis.translatedTitle}". Phong cách: ${analysis.recommendedStyle}.
DỮ LIỆU: ${JSON.stringify(blocks.map(b => ({ id: b.index, text: b.originalText })))}
Trả về JSON ARRAY: [{"id": "...", "translated": "..."}]`;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
      model: MAP_MODEL_ID(model),
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { id: { type: Type.STRING }, translated: { type: Type.STRING } },
            required: ["id", "translated"]
          }
        }
      }
    }));
    return JSON.parse(response.text || "[]");
  } catch (err) { throw new Error(mapApiError(err)); }
};

export const alignMergeBatch = async (
  blocks: SubtitleBlock[],
  hardsubLines: string[],
  model: string
): Promise<{ id: string, merged: string }[]> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
    const prompt = `NHIỆM VỤ: Gán nội dung từ Hardsub vào Softsub (timing chuẩn) dựa trên ngữ cảnh.
DỮ LIỆU SOFTSUB: ${JSON.stringify(blocks.map(b => ({ id: b.index, text: b.originalText })))}
DỮ LIỆU HARDSUB: ${JSON.stringify(hardsubLines)}
Trả về JSON ARRAY mapping theo id softsub: [{"id": "...", "merged": "nội dung hardsub tương ứng"}]`;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
      model: MAP_MODEL_ID(model),
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { id: { type: Type.STRING }, merged: { type: Type.STRING } },
            required: ["id", "merged"]
          }
        }
      }
    }));
    return JSON.parse(response.text || "[]");
  } catch (err) { throw new Error(mapApiError(err)); }
};

export const optimizeHighCpsBatch = async (
  targetSuggestions: HybridOptimizeSuggestion[],
  allBlocks: SubtitleBlock[],
  model: string
): Promise<{ id: string, afterText: string, afterTimestamp: string }[]> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
    const payload = targetSuggestions.map(s => {
      const idx = allBlocks.findIndex(b => b.index === s.index);
      const context = allBlocks.slice(Math.max(0, idx - 2), Math.min(allBlocks.length, idx + 3))
        .map(b => ({ id: b.index, text: b.translatedText || b.originalText, ts: b.timestamp }));
      return { targetId: s.index, text: s.beforeText, cps: s.cps, context };
    });

    const prompt = `Optimize subtitles with CPS > 40. Shorten text or adjust timing without overlap.
DỮ LIỆU: ${JSON.stringify(payload)}
Trả về JSON ARRAY: [{"id": "...", "afterText": "...", "afterTimestamp": "..."}]`;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
      model: MAP_MODEL_ID(model),
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              afterText: { type: Type.STRING },
              afterTimestamp: { type: Type.STRING }
            },
            required: ["id", "afterText", "afterTimestamp"]
          }
        }
      }
    }));
    return JSON.parse(response.text || "[]");
  } catch (err) { throw new Error(mapApiError(err)); }
};

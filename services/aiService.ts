
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { SubtitleBlock, TitleAnalysis, AiProvider, AutoOptimizeSuggestion, HybridOptimizeSuggestion } from "../types";

const getProvider = (modelName: string): AiProvider => {
  return modelName.toLowerCase().includes('gpt') ? 'openai' : 'gemini';
};

// Fixed: Better model mapping following guidelines to prioritize Gemini 3 series
const MAP_MODEL_ID = (modelName: string): string => {
  const name = modelName.toLowerCase();
  if (name.includes('pro')) return 'gemini-3-pro-preview';
  return 'gemini-3-flash-preview';
};

const withRetry = async <T>(fn: () => Promise<T>, retries = 2, delay = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

const callOpenAi = async (model: string, apiKey: string, prompt: string, isJson: boolean) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: "user", content: prompt }],
      response_format: isJson ? { type: "json_object" } : undefined,
      temperature: 0.1
    })
  });
  const data = await response.json();
  return { text: data.choices[0].message.content, tokens: data.usage.total_tokens };
};

export const checkApiHealth = async (model: string): Promise<boolean> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return false;
  try {
    const ai = new GoogleGenAI({ apiKey });
    // Fixed: Added withRetry for health check following SDK best practices
    await withRetry(() => ai.models.generateContent({ model: MAP_MODEL_ID(model), contents: "hi", config: { maxOutputTokens: 5 } }));
    return true;
  } catch { return false; }
};

export const analyzeTitle = async (title: string, model: string): Promise<{ analysis: TitleAnalysis, tokens: number }> => {
  const apiKey = process.env.API_KEY || "";
  const ai = new GoogleGenAI({ apiKey });
  // Fixed: Wrapped call with withRetry for API robustness
  const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
    model: MAP_MODEL_ID(model),
    contents: `Phân tích tiêu đề Donghua "${title}" trả về JSON.`,
    config: {
      responseMimeType: "application/json",
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

export const translateSubtitles = async (
  blocks: SubtitleBlock[],
  analysis: TitleAnalysis,
  model: string,
  onProgress: (translatedCount: number, tokensAdded: number) => void
): Promise<SubtitleBlock[]> => {
  const apiKey = process.env.API_KEY || "";
  const CHUNK_SIZE = 8;
  const translatedBlocks: SubtitleBlock[] = [...blocks];
  for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
    const chunk = blocks.slice(i, i + CHUNK_SIZE);
    // Use translatedText if available to handle already mixed blocks
    const pending = chunk.filter(b => !b.translatedText || /[\u4e00-\u9fa5]/.test(b.translatedText || b.originalText));
    if (pending.length === 0) { onProgress(Math.min(i + CHUNK_SIZE, blocks.length), 0); continue; }
    
    const ai = new GoogleGenAI({ apiKey });
    // Fixed: Wrapped call with withRetry and improved data selection using current translated context
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
      model: MAP_MODEL_ID(model),
      contents: `Dịch phụ đề: ${analysis.translatedTitle}. Dữ liệu: ${JSON.stringify(pending.map(b => ({ id: b.index, text: b.translatedText || b.originalText })))}`,
      config: { 
        responseMimeType: "application/json", 
        responseSchema: { 
          type: Type.ARRAY, 
          items: { 
            type: Type.OBJECT, 
            properties: { 
              id: { type: Type.STRING }, 
              translated: { type: Type.STRING } 
            }, 
            required: ["id", "translated"] 
          } 
        } 
      }
    }));
    const results = JSON.parse(response.text || "[]");
    results.forEach((res: any) => { const idx = translatedBlocks.findIndex(b => b.index === res.id); if (idx !== -1) translatedBlocks[idx].translatedText = res.translated; });
    onProgress(Math.min(i + CHUNK_SIZE, blocks.length), response.usageMetadata?.totalTokenCount || 0);
  }
  return translatedBlocks;
};

/**
 * AI xử lý rút gọn nội dung cho các câu >30 CPS
 */
export const optimizeHighCpsBatch = async (
  targetSuggestions: HybridOptimizeSuggestion[],
  allBlocks: SubtitleBlock[],
  model: string
): Promise<{ id: string, afterText: string, afterTimestamp: string }[]> => {
  const apiKey = process.env.API_KEY || "";
  const ai = new GoogleGenAI({ apiKey });
  
  // Tạo data payload kèm ngữ cảnh
  const payload = targetSuggestions.map(s => {
    const currentIdx = allBlocks.findIndex(b => b.index === s.index);
    const context = allBlocks.slice(Math.max(0, currentIdx - 2), Math.min(allBlocks.length, currentIdx + 3))
      .map(b => ({ id: b.index, text: b.translatedText || b.originalText, ts: b.timestamp }));
    
    return {
      targetId: s.index,
      currentText: s.beforeText,
      currentCps: s.cps,
      context: context
    };
  });

  const prompt = `Bạn là chuyên gia tối ưu phụ đề. Các đoạn sau có tốc độ đọc quá cao (>30 ký tự/s).
NHIỆM VỤ: Rút gọn nội dung (rewrite) sao cho ngắn hơn, dễ đọc hơn mà vẫn giữ nguyên ý nghĩa và mạch truyện.
Cấm: Không đổi ID. Không đổi ý nghĩa cốt truyện.

Dữ liệu: ${JSON.stringify(payload)}

Trả về JSON ARRAY: [{"id": "...", "afterText": "nội dung đã rút gọn", "afterTimestamp": "giữ nguyên hoặc chỉnh nhẹ nếu cần"}]`;

  // Fixed: Wrapped call with withRetry following Google GenAI best practices
  const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
    model: MAP_MODEL_ID(model),
    contents: prompt,
    config: {
      responseMimeType: "application/json",
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
};

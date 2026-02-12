
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { SubtitleBlock, TitleAnalysis, AiProvider, AutoOptimizeSuggestion } from "../types";

/**
 * Xác định Provider dựa trên tên Model
 */
const getProvider = (modelName: string): AiProvider => {
  return modelName.toLowerCase().includes('gpt') ? 'openai' : 'gemini';
};

/**
 * Ánh xạ tên model từ giao diện sang model ID chính xác của hệ thống.
 */
const MAP_MODEL_ID = (modelName: string): string => {
  const name = modelName.toLowerCase();
  if (name === 'gemini 2.5 flash') return 'gemini-3-flash-preview';
  if (name === 'gemini 2.5 pro') return 'gemini-3-pro-preview';
  
  if (name.includes('gemini')) {
    if (name.includes('pro')) return 'gemini-3-pro-preview';
    if (name.includes('flash')) return 'gemini-3-flash-preview';
    return 'gemini-3-flash-preview';
  }
  return modelName;
};

const withRetry = async <T>(fn: () => Promise<T>, retries = 2, delay = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const errorStr = error?.toString() || "";
    const isRetryable = errorStr.includes("429") || errorStr.includes("500") || errorStr.includes("503") || errorStr.toLowerCase().includes("quota");
    if (retries > 0 && isRetryable) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

const callOpenAi = async (model: string, apiKey: string, prompt: string, isJson: boolean) => {
  try {
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

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `OpenAI API Error: ${response.status}`);
    }

    const data = await response.json();
    return {
      text: data.choices[0].message.content,
      tokens: data.usage.total_tokens
    };
  } catch (error) {
    throw error;
  }
};

export const checkApiHealth = async (model: string): Promise<boolean> => {
  const provider = getProvider(model);
  const apiKey = process.env.API_KEY;
  if (!apiKey) return false;

  try {
    if (provider === 'openai') {
      await callOpenAi(model, apiKey, "ping", false);
      return true;
    } else {
      const ai = new GoogleGenAI({ apiKey });
      const internalModel = MAP_MODEL_ID(model);
      await withRetry(() => ai.models.generateContent({
        model: internalModel,
        contents: "ping",
        config: { maxOutputTokens: 5, thinkingConfig: { thinkingBudget: 0 } }
      }));
      return true;
    }
  } catch (e) {
    return false;
  }
};

export const analyzeTitle = async (title: string, model: string): Promise<{ analysis: TitleAnalysis, tokens: number }> => {
  const provider = getProvider(model);
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Hệ thống chưa có API KEY.");

  const prompt = `Phân tích tiêu đề Donghua "${title}" trả về JSON.`;

  try {
    if (provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey });
      const internalModel = MAP_MODEL_ID(model);
      const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: internalModel,
        contents: prompt,
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
      return {
        analysis: JSON.parse(response.text || "{}"),
        tokens: response.usageMetadata?.totalTokenCount || 0
      };
    } else {
      const result = await withRetry(() => callOpenAi(model, apiKey, prompt, true));
      return {
        analysis: JSON.parse(result.text || "{}"),
        tokens: result.tokens
      };
    }
  } catch (error) {
    throw error;
  }
};

export const translateSubtitles = async (
  blocks: SubtitleBlock[],
  analysis: TitleAnalysis,
  model: string,
  onProgress: (translatedCount: number, tokensAdded: number) => void
): Promise<SubtitleBlock[]> => {
  const provider = getProvider(model);
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Thiếu API KEY.");

  const CHUNK_SIZE = 8;
  const translatedBlocks: SubtitleBlock[] = [...blocks];
  const internalModel = MAP_MODEL_ID(model);

  for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
    const chunk = blocks.slice(i, i + CHUNK_SIZE);
    const pendingInChunk = chunk.filter(b => !b.translatedText || /[\u4e00-\u9fa5]/.test(b.originalText));
    
    if (pendingInChunk.length === 0) {
      onProgress(Math.min(i + CHUNK_SIZE, blocks.length), 0);
      continue;
    }

    const prompt = `Dịch phụ đề Donghua: ${analysis.translatedTitle}. Dữ liệu: ${JSON.stringify(pendingInChunk.map(b => ({ id: b.index, text: b.originalText })))}`;

    try {
      let resultText = "";
      let tokensUsed = 0;

      if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
          model: internalModel,
          contents: prompt,
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
        resultText = response.text || "[]";
        tokensUsed = response.usageMetadata?.totalTokenCount || 0;
      } else {
        const res = await withRetry(() => callOpenAi(model, apiKey, prompt, true));
        resultText = res.text || "[]";
        tokensUsed = res.tokens;
      }

      const results = JSON.parse(resultText);
      results.forEach((res: { id: string, translated: string }) => {
        const idx = translatedBlocks.findIndex(b => b.index === res.id);
        if (idx !== -1) translatedBlocks[idx].translatedText = res.translated;
      });

      onProgress(Math.min(i + CHUNK_SIZE, blocks.length), tokensUsed);
      await new Promise(r => setTimeout(r, 600));
    } catch (error) { 
      throw error; 
    }
  }

  return translatedBlocks;
};

/**
 * Phân tích một batch SRT duy nhất để hỗ trợ logic hủy từ phía caller (App.tsx)
 */
export const analyzeSrtBatch = async (
  chunk: any[],
  model: string
): Promise<{ suggestions: AutoOptimizeSuggestion[], tokens: number }> => {
  const provider = getProvider(model);
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Thiếu API KEY.");

  const internalModel = MAP_MODEL_ID(model);
  const prompt = `Bạn là AI tối ưu hóa SRT ở chế độ STRICT MODE (Bảo thủ tối đa).
Nhiệm vụ: Chỉ đề xuất chỉnh sửa nếu có lỗi thực sự. KHÔNG sửa nếu không chắc chắn.

CÁC LỖI ĐƯỢC PHÉP ĐỀ XUẤT:
1. TRÙNG LẶP THỰC SỰ: Nội dung giống >95% ở 2 đoạn liên tiếp.
2. TIMING LỖI NGHIÊM TRỌNG: Duration < 300ms hoặc overlap rõ ràng.
3. CÂU BỊ CẮT ĐỨT: Đoạn trước chưa hết câu, đoạn sau bắt đầu bằng chữ thường, ghép lại mới mạch lạc.

QUY TẮC ĐỘ DÀI (BẮT BUỘC):
- Sau khi gộp: Tối đa 2 dòng.
- Mỗi dòng: Tối đa 42 ký tự. Nếu vượt quá, KHÔNG ĐƯỢC gộp.

CHỈ TRẢ VỀ ĐỀ XUẤT NẾU ĐỘ TIN CẬY (CONFIDENCE) >= 85%.

Dữ liệu batch: ${JSON.stringify(chunk)}

Trả về JSON ARRAY các đề xuất tối ưu. Nếu không có lỗi rõ ràng, trả về mảng trống [].
Schema: [{"id": "...", "type": "merge|delete|adjust|edit", "indices": ["..."], "before": "...", "after": "...", "reason": "...", "explanation": "...", "proposedTimestamp": "..."}]`;

  try {
    let resultText = "";
    let tokensUsed = 0;

    if (provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey });
      const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: internalModel,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                type: { type: Type.STRING, enum: ["merge", "delete", "adjust", "edit"] },
                indices: { type: Type.ARRAY, items: { type: Type.STRING } },
                before: { type: Type.STRING },
                after: { type: Type.STRING },
                reason: { type: Type.STRING },
                explanation: { type: Type.STRING },
                proposedTimestamp: { type: Type.STRING }
              },
              required: ["id", "type", "indices", "before", "after", "reason", "explanation"]
            }
          }
        }
      }));
      resultText = response.text || "[]";
      tokensUsed = response.usageMetadata?.totalTokenCount || 0;
    } else {
      const res = await withRetry(() => callOpenAi(model, apiKey, prompt, true));
      resultText = res.text || "[]";
      tokensUsed = res.tokens;
    }

    return { suggestions: JSON.parse(resultText), tokens: tokensUsed };
  } catch (error) {
    throw error;
  }
};

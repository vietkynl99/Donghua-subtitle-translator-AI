
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { SubtitleBlock, TitleAnalysis, AiProvider } from "../types";

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
      console.warn(`[AI Service] Gặp lỗi có thể thử lại. Đang thử lại sau ${delay}ms... (Còn ${retries} lần)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

/**
 * Gọi API OpenAI thông qua fetch
 */
const callOpenAi = async (model: string, apiKey: string, prompt: string, isJson: boolean) => {
  if (!apiKey || apiKey.startsWith('AIza')) {
    const msg = "Vui lòng nhập OpenAI API Key hợp lệ. Hệ thống không thể dùng Key mặc định của Gemini cho OpenAI.";
    console.error(`[OpenAI Error] ${msg}`);
    throw new Error(msg);
  }

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
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errorMsg = errData.error?.message || `OpenAI API Error: ${response.status}`;
      console.error("[OpenAI API Details]", { status: response.status, error: errData.error });
      throw new Error(errorMsg);
    }

    const data = await response.json();
    return {
      text: data.choices[0].message.content,
      tokens: data.usage.total_tokens
    };
  } catch (error) {
    console.error("[OpenAI Connection Error]", error);
    throw error;
  }
};

/**
 * Kiểm tra trạng thái API
 */
export const checkApiHealth = async (model: string, customKey?: string): Promise<boolean> => {
  const provider = getProvider(model);
  const apiKey = provider === 'openai' ? customKey : (customKey || process.env.API_KEY);
  
  if (!apiKey) {
    console.warn(`[Health Check] Không có API Key cho ${provider}.`);
    return false;
  }

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
  } catch (e: any) {
    console.error(`[Health Check Failed] Model: ${model}, Provider: ${provider}`, e);
    return false;
  }
};

/**
 * Phân tích tiêu đề
 */
export const analyzeTitle = async (title: string, model: string, customKey?: string): Promise<{ analysis: TitleAnalysis, tokens: number }> => {
  const provider = getProvider(model);
  const apiKey = provider === 'openai' ? customKey : (customKey || process.env.API_KEY);
  
  if (!apiKey) throw new Error(provider === 'openai' ? "Vui lòng nhập OpenAI API KEY." : "Hệ thống chưa có API KEY.");

  const prompt = `Bạn là một AI chuyên gia phân tích tiêu đề Donghua. Phân tích tiêu đề "${title}" trả về JSON.`;

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
    console.error("[Analyze Title Error]", error);
    throw error;
  }
};

/**
 * Dịch phụ đề
 */
export const translateSubtitles = async (
  blocks: SubtitleBlock[],
  analysis: TitleAnalysis,
  model: string,
  onProgress: (translatedCount: number, tokensAdded: number) => void,
  customKey?: string
): Promise<SubtitleBlock[]> => {
  const provider = getProvider(model);
  const apiKey = provider === 'openai' ? customKey : (customKey || process.env.API_KEY);
  
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

    const prompt = `Dịch phụ đề Donghua sang tiếng Việt. Phim: ${analysis.translatedTitle}. Dữ liệu: ${JSON.stringify(pendingInChunk.map(b => ({ id: b.index, text: b.originalText })))}`;

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
      console.error(`[Translation Chunk Error] Index ${i}:`, error);
      throw error; 
    }
  }

  return translatedBlocks;
};

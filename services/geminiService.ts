
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { SubtitleBlock, TitleAnalysis } from "../types";

export interface TranslationResult {
  blocks: SubtitleBlock[];
  tokens: number;
}

const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const errorStr = error?.toString() || "";
    const isQuotaError = errorStr.includes("429") || errorStr.toLowerCase().includes("resource_exhausted");
    const isServerError = errorStr.includes("500") || errorStr.includes("503");

    if (retries > 0 && (isQuotaError || isServerError)) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

export const checkApiHealth = async (model: string): Promise<boolean> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    await withRetry(() => ai.models.generateContent({
      model: model,
      contents: "hi",
      config: { 
        maxOutputTokens: 10,
        thinkingConfig: { thinkingBudget: 0 } 
      }
    }));
    return true;
  } catch (e) {
    return false;
  }
};

export const analyzeTitle = async (title: string, model: string): Promise<{ analysis: TitleAnalysis, tokens: number }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Bạn là một AI chuyên gia phân tích tiêu đề Donghua (Tu tiên, Hệ thống, Xuyên không, Quỷ dị...).
Nhiệm vụ: Phân tích tiêu đề "${title}" để định hướng dịch thuật.

YÊU CẦU ĐẦU RA (JSON):
1. Tiêu đề Việt gợi ý: Hấp dẫn, chất "tiểu thuyết mạng".
2. Thể loại: Chọn 3-5 tag (Ví dụ: Tu tiên, Hệ thống, Trùng sinh...).
3. Tóm truyện: 2-3 câu ngắn gọn.
4. Phong cách dịch: Phải chọn 1 trong (Hài hước châm biếm, Nghiêm túc huyền huyễn, Cổ phong tu tiên, Hiện đại – trẻ trung, Drama cảm xúc) và giải thích lý do.

{
  "originalTitle": "tiêu đề gốc",
  "translatedTitle": "tiêu đề Việt hấp dẫn",
  "mainGenres": ["tag1", "tag2"],
  "summary": "Tóm tắt ngắn gọn",
  "tone": "Tông chính",
  "recommendedStyle": "Tên phong cách + giải thích"
}`;

  const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
    model: model,
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
};

export const translateSubtitles = async (
  blocks: SubtitleBlock[],
  analysis: TitleAnalysis,
  model: string,
  onProgress: (translatedCount: number, tokensAdded: number) => void
): Promise<SubtitleBlock[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const CHUNK_SIZE = 8;
  const translatedBlocks: SubtitleBlock[] = [...blocks];

  for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
    const chunk = blocks.slice(i, i + CHUNK_SIZE);
    
    // Chỉ dịch các dòng còn chứa tiếng Trung (ZH hoặc Mix)
    const containsChinese = (text: string) => /[\u4e00-\u9fa5]/.test(text);
    const pendingInChunk = chunk.filter(b => !b.translatedText || containsChinese(b.translatedText || ''));
    
    if (pendingInChunk.length === 0) {
      onProgress(Math.min(i + CHUNK_SIZE, blocks.length), 0);
      continue;
    }

    const prompt = `Hệ thống dịch thuật Donghua chuyên sâu.
Phim: "${analysis.translatedTitle}" (${analysis.originalTitle})
Phong cách: ${analysis.recommendedStyle}

NHIỆM VỤ: Dịch phụ đề sang tiếng Việt.

QUY TẮC BẮT BUỘC:
1. Dòng CHỈ TIẾNG TRUNG: Dịch hoàn toàn thoát ý, đúng bối cảnh ${analysis.summary}.
2. Dòng MIX (ZH + VN): Giữ phần Việt, dịch nốt phần Trung và ghép lại thành câu tự nhiên.
3. Dòng ĐÃ LÀ TIẾNG VIỆT: KHÔNG thay đổi.
4. Thuật ngữ: Tu tiên (Tu vi, Linh lực), Hệ thống (Nhiệm vụ, Thuộc tính)...

DỮ LIỆU:
${JSON.stringify(pendingInChunk.map(b => ({ id: b.index, text: b.translatedText || b.originalText })))}

TRẢ VỀ JSON: [{"id": "...", "translated": "..."}]`;

    try {
      const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: model,
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

      const results = JSON.parse(response.text || "[]");
      results.forEach((res: { id: string, translated: string }) => {
        const idx = translatedBlocks.findIndex(b => b.index === res.id);
        if (idx !== -1) translatedBlocks[idx].translatedText = res.translated;
      });

      onProgress(Math.min(i + CHUNK_SIZE, blocks.length), response.usageMetadata?.totalTokenCount || 0);
      await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      throw error;
    }
  }

  return translatedBlocks;
};

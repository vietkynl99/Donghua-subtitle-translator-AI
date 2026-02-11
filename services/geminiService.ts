
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { SubtitleBlock, TitleAnalysis } from "../types";

export interface TranslationResult {
  blocks: SubtitleBlock[];
  tokens: number;
}

/**
 * Helper to wrap API calls with exponential backoff for retryable errors (429, 5xx)
 */
const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const errorStr = error?.toString() || "";
    const isQuotaError = errorStr.includes("429") || errorStr.toLowerCase().includes("resource_exhausted") || errorStr.toLowerCase().includes("quota");
    const isServerError = errorStr.includes("500") || errorStr.includes("503");

    if (retries > 0 && (isQuotaError || isServerError)) {
      console.warn(`Gemini API error (Retrying in ${delay}ms...):`, errorStr);
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
    console.error("API Health Check Failed", e);
    return false;
  }
};

export const analyzeTitle = async (title: string, model: string): Promise<{ analysis: TitleAnalysis, tokens: number }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Bạn là một AI chuyên phân tích tiêu đề phim hoạt hình Trung Quốc (Donghua) thể loại: tu tiên, xuyên không, hệ thống, quỷ dị, đô thị dị năng...

Nhiệm vụ: Phân tích tiêu đề "${title}" để làm căn cứ định hướng cho việc dịch phụ đề sau này.

QUY TẮC PHÂN TÍCH TỪ KHÓA (Gán nhãn thể loại):
- 穿越, 重生, 转生 -> Xuyên không / Trùng sinh
- 斩神, 神明, 神秘 -> Thần thoại / Dị giới
- 系统, 进度条, 金手指 -> Hệ thống
- 都市, 现代 -> Đô thị dị năng
- 诡异, 禁忌, 恐怖 -> Quỷ dị / Kinh dị nhẹ
- 修仙, 仙侠 -> Tu tiên / Tiên hiệp

YÊU CẦU ĐẦU RA (JSON):
1. Tiêu đề tiếng Việt: Viết lại hấp dẫn, tự nhiên (phong cách Bilibili/Douyin).
2. Tóm truyện: 1-2 câu ngắn gọn, đúng tinh thần tiêu đề.
3. Phong cách dịch subtitle: Phải chọn chính xác 1 trong các nhãn sau: "Hài hước châm biếm", "Nghiêm túc huyền huyễn", "Drama cảm xúc", "Đậm chất tu tiên cổ phong", "Hiện đại – meme – trẻ trung". Giải thích ngắn gọn lý do chọn.

HÃY TRẢ VỀ JSON THEO CẤU TRÚC:
{
  "originalTitle": "tiêu đề gốc",
  "translatedTitle": "tiêu đề tiếng Việt sáng tạo",
  "mainGenres": ["thể loại 1", "thể loại 2"],
  "summary": "Tóm tắt cốt truyện ngắn gọn.",
  "tone": "Tông truyện chính",
  "recommendedStyle": "Chọn 1 trong 5 nhãn phong cách nêu trên và giải thích lý do."
}

Lưu ý: Tránh dùng từ quá học thuật, ưu tiên cách diễn đạt gần gũi với người xem mạng xã hội.`;

  // Fix: Explicitly type the response to avoid property access errors on 'unknown'
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
  const CHUNK_SIZE = 8; // Slightly smaller chunk size to stay safer within per-minute token limits
  const translatedBlocks: SubtitleBlock[] = [...blocks];

  for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
    const chunk = blocks.slice(i, i + CHUNK_SIZE);
    const pendingInChunk = chunk.filter(b => !b.translatedText || /[\u4e00-\u9fa5]/.test(b.translatedText || ''));
    
    if (pendingInChunk.length === 0) {
      onProgress(Math.min(i + CHUNK_SIZE, blocks.length), 0);
      continue;
    }

    const prompt = `Bạn là chuyên gia dịch thuật phụ đề Donghua.
Bối cảnh phim: "${analysis.translatedTitle}" (${analysis.originalTitle})
Tóm tắt nội dung: ${analysis.summary}
Phong cách dịch bắt buộc: ${analysis.recommendedStyle}

NHIỆM VỤ: Dịch hoặc hoàn thiện nội dung SRT sang tiếng Việt 100%.

NGUYÊN TẮC:
1. Tuân thủ phong cách ${analysis.recommendedStyle} xuyên suốt.
2. Dòng chỉ có tiếng Trung: Dịch hoàn toàn.
3. Dòng Mix Việt-Trung: Chỉ dịch nốt phần Trung còn thiếu.
4. Dòng đã là tiếng Việt: GIỮ NGUYÊN TUYỆT ĐỐI.
5. Thuật ngữ Hán Việt: 修仙->Tu tiên, 系统->Hệ thống, 渡劫->Độ kiếp...

DỮ LIỆU CẦN XỬ LÝ (JSON):
${JSON.stringify(pendingInChunk.map(b => ({ id: b.index, text: b.originalText })))}

TRẢ VỀ JSON FORMAT:
[{"id": "index", "translated": "kết quả dịch hoàn thiện"}]`;

    try {
      // Fix: Explicitly type the response to avoid property access errors on 'unknown'
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
      const tokens = response.usageMetadata?.totalTokenCount || 0;
      
      results.forEach((res: { id: string, translated: string }) => {
        const indexInMain = translatedBlocks.findIndex(b => b.index === res.id);
        if (indexInMain !== -1) {
          translatedBlocks[indexInMain].translatedText = res.translated;
        }
      });

      onProgress(Math.min(i + CHUNK_SIZE, blocks.length), tokens);
      
      // Added a small mandatory artificial delay between chunks to further prevent 429
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error("Translation error at chunk", i, error);
      throw error;
    }
  }

  return translatedBlocks;
};

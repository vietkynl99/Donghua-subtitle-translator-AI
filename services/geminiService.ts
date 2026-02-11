
import { GoogleGenAI, Type } from "@google/genai";
import { SubtitleBlock, TitleAnalysis } from "../types";

export interface TranslationResult {
  blocks: SubtitleBlock[];
  tokens: number;
}

export const checkApiHealth = async (model: string): Promise<boolean> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    await ai.models.generateContent({
      model: model,
      contents: "hi",
      config: { maxOutputTokens: 1 }
    });
    return true;
  } catch (e) {
    console.error("API Health Check Failed", e);
    return false;
  }
};

export const analyzeTitle = async (title: string, model: string): Promise<{ analysis: TitleAnalysis, tokens: number }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Phân tích tiêu đề phim hoạt hình Trung Quốc (Donghua) sau đây: "${title}"
  
HÃY TRẢ VỀ JSON THEO CẤU TRÚC:
{
  "originalTitle": "tiêu đề gốc",
  "translatedTitle": "tiêu đề dịch sang tiếng Việt (tự nhiên, dễ hiểu, giữ đúng ý và phong cách clickbait nếu có)",
  "mainGenres": ["thể loại 1", "thể loại 2"],
  "tone": "Hài hước / Nghiêm túc / Nửa hài nửa nghiêm / Dark fantasy",
  "recommendedStyle": "Mô tả phong cách dịch (ví dụ: hiện đại gãy gọn / cổ phong trang trọng...)"
}

Lưu ý: Tiêu đề dịch sang tiếng Việt phải mượt mà, đúng tinh thần gốc, không dịch word-by-word cứng nhắc.
Các thể loại ưu tiên: Tu tiên cổ phong, Xuyên không – dị giới, Đô thị huyền bí, Quỷ dị, Hệ thống, Trọng sinh, Ngự thú, Thần thoại – Trảm thần, Hành động siêu năng lực.`;

  const response = await ai.models.generateContent({
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
          tone: { type: Type.STRING },
          recommendedStyle: { type: Type.STRING }
        },
        required: ["originalTitle", "translatedTitle", "mainGenres", "tone", "recommendedStyle"]
      }
    }
  });

  return {
    analysis: JSON.parse(response.text),
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
  const CHUNK_SIZE = 15;
  const translatedBlocks: SubtitleBlock[] = [...blocks];

  for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
    const chunk = blocks.slice(i, i + CHUNK_SIZE);
    
    const prompt = `Bạn là một AI chuyên dịch phụ đề phim hoạt hình Trung Quốc sang tiếng Việt chuyên nghiệp.
Tiêu đề phim: ${analysis.originalTitle} (${analysis.translatedTitle})
Thể loại: ${analysis.mainGenres.join(", ")}
Tông truyện: ${analysis.tone}
Phong cách dịch khuyến nghị: ${analysis.recommendedStyle}

NHIỆM VỤ: Dịch các nội dung sau sang tiếng Việt tự nhiên, giữ nguyên định dạng.

NGUYÊN TẮC BẮT BUỘC:
1. Dịch sát nghĩa nhưng phải tự nhiên như người Việt nói chuyện.
2. KHÔNG thay đổi timestamp hoặc index.
3. Sử dụng đúng thuật ngữ Hán-Việt cho tu tiên/huyền huyễn (ví dụ: Đại năng, Tông môn, Trúc cơ, Linh hồn lực...).
4. Ưu tiên: 修仙->Tu tiên, 穿越->Xuyên không, 系统->Hệ thống, 重生->Trọng sinh, 灵气->Linh khí, 法宝->Pháp bảo, 妖兽->Yêu thú, 秘境->Bí cảnh, 渡劫->Độ kiếp, 天劫->Thiên kiếp.

DỮ LIỆU CẦN DỊCH (JSON format):
${JSON.stringify(chunk.map(b => ({ id: b.index, text: b.originalText })))}

HÃY TRẢ VỀ JSON THEO ĐÚNG CẤU TRÚC:
[{"id": "index", "translated": "văn bản đã dịch"}]`;

    try {
      const response = await ai.models.generateContent({
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
      });

      const results = JSON.parse(response.text);
      const tokens = response.usageMetadata?.totalTokenCount || 0;
      
      results.forEach((res: { id: string, translated: string }) => {
        const indexInMain = translatedBlocks.findIndex(b => b.index === res.id);
        if (indexInMain !== -1) {
          translatedBlocks[indexInMain].translatedText = res.translated;
        }
      });

      onProgress(Math.min(i + CHUNK_SIZE, blocks.length), tokens);
    } catch (error) {
      console.error("Translation error at chunk", i, error);
      throw error;
    }
  }

  return translatedBlocks;
};

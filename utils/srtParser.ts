
import { SubtitleBlock } from '../types';

/**
 * Tự động tách tiêu đề tiếng Trung từ tên file
 * Loại bỏ các tag [..], domain, EpXX, Review, dấu gạch ngang...
 * ĐẢM BẢO: Giữ nguyên 100% chuỗi tiêu đề nhận diện được (bao gồm dấu câu).
 */
export const extractChineseTitle = (fileName: string): string => {
  // 1. Loại bỏ phần mở rộng .srt
  let name = fileName.replace(/\.[^/.]+$/, "");
  
  // 2. Loại bỏ các tiền tố quản lý của hệ thống [Partial], [Partial-X], [Translated]
  name = name.replace(/^\[Partial(-\d+)?\]\s*/i, "");
  name = name.replace(/^\[Translated\]\s*/i, "");
  
  // 3. Loại bỏ các nội dung trong ngoặc [] hoặc () hoặc {} (thường là tag metadata)
  name = name.replace(/\[.*?\]|\(.*?\)|{.*?}/g, "");
  
  // 4. Loại bỏ các từ khóa nhiễu phổ biến
  const keywords = [
    "Dở dang", "Translated", "DLBunny.com", "bilibili", "Ep\\d+", "Tập\\d+", "Tập \\d+",
    "1080p", "720p", "4K", "Review", "Subtitle", "Vietsub", "Thuyết minh", "Full", "HD"
  ];
  const keywordRegex = new RegExp(keywords.join("|"), "gi");
  name = name.replace(keywordRegex, "");
  
  // 5. Tìm các đoạn chứa ký tự tiếng Trung hoặc dấu câu Trung Quốc liên tục
  const chineseTitleRegex = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef\s,，!！?？:：]+/;
  const match = name.match(chineseTitleRegex);
  
  if (match) {
    let title = match[0].trim();
    // Loại bỏ các dấu gạch ngang/gạch dưới ở đầu/cuối nếu có
    title = title.replace(/^[_\-\s]+|[_\-\s]+$/g, "");
    if (title.length > 0) return title;
  }
  
  return name.trim();
};

/**
 * Tạo tên file mới dựa trên quy tắc quản lý phiên bản:
 * - Lần đầu: [Partial]
 * - Lần sau: [Partial-2], [Partial-3]...
 * - Hoàn thành: [Translated]
 */
export const generateFileName = (currentName: string, isFinished: boolean): string => {
  // Loại bỏ đuôi srt để xử lý
  const baseName = currentName.replace(/\.[^/.]+$/, "");
  
  if (isFinished) {
    // Nếu hoàn thành, bỏ mọi tiền tố Partial và thêm [Translated]
    const cleanName = baseName.replace(/^\[Partial(-\d+)?\]\s*/i, "");
    return `[Translated] ${cleanName}.srt`;
  }

  // Logic cho file dở dang (Partial)
  const partialMatch = baseName.match(/^\[Partial(-(\d+))?\]/i);
  
  if (!partialMatch) {
    // Lần lỗi đầu tiên
    return `[Partial] ${baseName}.srt`;
  }

  // Đã có tiền tố Partial, thực hiện tăng số thứ tự
  const currentNum = partialMatch[2] ? parseInt(partialMatch[2]) : 1;
  const nextNum = currentNum + 1;
  const cleanName = baseName.replace(/^\[Partial(-\d+)?\]\s*/i, "");
  
  return `[Partial-${nextNum}] ${cleanName}.srt`;
};

export const parseSRT = (content: string): SubtitleBlock[] => {
  const blocks: SubtitleBlock[] = [];
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const splitBlocks = normalized.split(/\n\s*\n/);

  for (const block of splitBlocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l !== "");
    if (lines.length >= 3) {
      const index = lines[0];
      const timestamp = lines[1];
      const originalText = lines.slice(2).join('\n');
      
      if (index && timestamp && originalText) {
        blocks.push({ index, timestamp, originalText });
      }
    }
  }
  return blocks;
};

export const stringifySRT = (blocks: SubtitleBlock[]): string => {
  return blocks
    .map((b) => `${b.index}\n${b.timestamp}\n${b.translatedText || b.originalText}`)
    .join('\n\n');
};

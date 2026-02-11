
import { SubtitleBlock } from '../types';

/**
 * Tự động tách tiêu đề tiếng Trung từ tên file
 * Loại bỏ các tag [..], domain, EpXX, Review, dấu gạch ngang...
 * ĐẢM BẢO: Giữ nguyên 100% chuỗi tiêu đề nhận diện được (bao gồm dấu câu).
 */
export const extractChineseTitle = (fileName: string): string => {
  // 1. Loại bỏ phần mở rộng .srt
  let name = fileName.replace(/\.[^/.]+$/, "");
  
  // 2. Loại bỏ các nội dung trong ngoặc [] hoặc () hoặc {} (thường là tag metadata)
  name = name.replace(/\[.*?\]|\(.*?\)|{.*?}/g, "");
  
  // 3. Loại bỏ các từ khóa nhiễu phổ biến
  const keywords = [
    "Dở dang", "Translated", "DLBunny.com", "bilibili", "Ep\\d+", "Tập\\d+", "Tập \\d+",
    "1080p", "720p", "4K", "Review", "Subtitle", "Vietsub", "Thuyết minh", "Full", "HD"
  ];
  const keywordRegex = new RegExp(keywords.join("|"), "gi");
  name = name.replace(keywordRegex, "");
  
  // 4. Tìm các đoạn chứa ký tự tiếng Trung hoặc dấu câu Trung Quốc liên tục
  // \u4e00-\u9fa5: Chữ Hán
  // \u3000-\u303f: Dấu câu CJK
  // \uff00-\uffef: Dấu câu toàn chiều rộng (Full-width) như ，！
  const chineseTitleRegex = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef\s,，!！?？:：]+/;
  const match = name.match(chineseTitleRegex);
  
  if (match) {
    let title = match[0].trim();
    // Loại bỏ các dấu gạch ngang/gạch dưới ở đầu/cuối nếu có do quá trình tách file
    title = title.replace(/^[_\-\s]+|[_\-\s]+$/g, "");
    if (title.length > 0) return title;
  }
  
  return name.trim();
};

export const parseSRT = (content: string): SubtitleBlock[] => {
  const blocks: SubtitleBlock[] = [];
  const normalized = content.replace(/\r\n/g, '\n').trim();
  // Tách block dựa trên dòng trống
  const splitBlocks = normalized.split(/\n\s*\n/);

  for (const block of splitBlocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l !== "");
    if (lines.length >= 3) {
      const index = lines[0];
      const timestamp = lines[1];
      // Nội dung có thể chiếm nhiều dòng
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

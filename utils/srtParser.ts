
import { SubtitleBlock } from '../types';

/**
 * Tự động tách tiêu đề tiếng Trung từ tên file
 * Loại bỏ các tag [..], domain, EpXX, Review, dấu gạch ngang...
 */
export const extractChineseTitle = (fileName: string): string => {
  // Loại bỏ phần mở rộng .srt
  let name = fileName.replace(/\.[^/.]+$/, "");
  
  // Loại bỏ các nội dung trong ngoặc [] hoặc ()
  name = name.replace(/\[.*?\]|\(.*?\)/g, "");
  
  // Loại bỏ các từ khóa phổ biến
  const keywords = [
    "Dở dang", "Translated", "DLBunny.com", "bilibili", "Ep\\d+", "Tập\\d+", 
    "1080p", "720p", "4K", "Review", "Subtitle", "Vietsub", "Thuyết minh"
  ];
  const keywordRegex = new RegExp(keywords.join("|"), "gi");
  name = name.replace(keywordRegex, "");
  
  // Thay thế các dấu phân cách bằng khoảng trắng
  name = name.replace(/[_\-\.]/g, " ");
  
  // Tìm chuỗi tiếng Trung dài nhất liên tục
  const chineseMatches = name.match(/[\u4e00-\u9fa5]+/g);
  if (chineseMatches) {
    return chineseMatches.reduce((a, b) => a.length > b.length ? a : b);
  }
  
  return name.trim();
};

export const parseSRT = (content: string): SubtitleBlock[] => {
  const blocks: SubtitleBlock[] = [];
  const normalized = content.replace(/\r\n/g, '\n').trim();
  // Tách block dựa trên dòng trống, xử lý trường hợp có nhiều dòng trống liên tiếp
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

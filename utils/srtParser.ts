
import { SubtitleBlock } from '../types';

/**
 * Chuyển đổi chuỗi timestamp SRT (00:00:00,000) sang Milliseconds
 */
const timestampToMs = (ts: string): number => {
  const match = ts.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return 0;
  const [_, h, m, s, ms] = match.map(Number);
  return h * 3600000 + m * 60000 + s * 1000 + ms;
};

/**
 * Chuyển đổi Milliseconds sang chuỗi timestamp SRT
 */
const msToTimestamp = (ms: number): string => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mss = Math.floor(ms % 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${mss.toString().padStart(3, '0')}`;
};

/**
 * Chỉnh sửa toàn bộ timestamp của file SRT dựa trên tốc độ (Speed)
 * Công thức: new_time = old_time / speed
 */
export const adjustSrtTiming = (blocks: SubtitleBlock[], speed: number): SubtitleBlock[] => {
  if (speed === 1) return blocks;
  return blocks.map(block => {
    const parts = block.timestamp.split(' --> ');
    if (parts.length !== 2) return block;
    
    const startMs = timestampToMs(parts[0]);
    const endMs = timestampToMs(parts[1]);
    
    const newStart = msToTimestamp(startMs / speed);
    const newEnd = msToTimestamp(endMs / speed);
    
    return {
      ...block,
      timestamp: `${newStart} --> ${newEnd}`
    };
  });
};

/**
 * Tự động tách tiêu đề tiếng Trung từ tên file
 * ĐẢM BẢO: Bỏ qua các prefix hệ thống [Speed], [Partial], [Translated]
 */
export const extractChineseTitle = (fileName: string): string => {
  let name = fileName.replace(/\.[^/.]+$/, "");
  
  // Xóa các tiền tố quản lý (Speed, Partial, Translated)
  name = name.replace(/^\[Speed-[\d.]+\]\s*/i, "");
  name = name.replace(/^\[Partial(-\d+)?\]\s*/i, "");
  name = name.replace(/^\[Translated\]\s*/i, "");
  
  // Xóa metadata trong ngoặc
  name = name.replace(/\[.*?\]|\(.*?\)|{.*?}/g, "");
  
  // Xóa keyword nhiễu
  const keywords = ["Translated", "bilibili", "Ep\\d+", "Tập\\d+", "1080p", "720p", "4K", "Review", "Subtitle", "Vietsub"];
  const keywordRegex = new RegExp(keywords.join("|"), "gi");
  name = name.replace(keywordRegex, "");
  
  // Lấy chuỗi tiếng Trung liên tục dài nhất
  const chineseTitleRegex = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef\s,，!！?？:：]+/;
  const match = name.match(chineseTitleRegex);
  
  if (match) {
    let title = match[0].trim();
    title = title.replace(/^[_\-\s]+|[_\-\s]+$/g, "");
    if (title.length > 0) return title;
  }
  
  return name.trim();
};

/**
 * Tạo tên file mới dựa trên quy tắc quản lý phiên bản
 */
export const generateFileName = (currentName: string, isFinished: boolean, speed?: number): string => {
  let baseName = currentName.replace(/\.[^/.]+$/, "");
  
  // Nếu là chức năng Speed Editor
  if (speed !== undefined && speed !== 1) {
    // Xóa prefix Speed cũ nếu có để thay cái mới
    baseName = baseName.replace(/^\[Speed-[\d.]+\]\s*/i, "");
    return `[Speed-${speed}] ${baseName}.srt`;
  }

  // Nếu là chức năng Translator
  if (isFinished) {
    const cleanName = baseName.replace(/^\[Partial(-\d+)?\]\s*/i, "");
    return `[Translated] ${cleanName}.srt`;
  }

  // Logic Partial-N
  const partialMatch = baseName.match(/^\[Partial(-(\d+))?\]/i);
  if (!partialMatch) {
    return `[Partial] ${baseName}.srt`;
  }

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

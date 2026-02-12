
import { SubtitleBlock, ProposedChange } from '../types';

/**
 * Chuyển đổi chuỗi timestamp SRT (00:00:00,000) sang Milliseconds
 */
export const timestampToMs = (ts: string): number => {
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
 * Kiểm tra xem một đoạn text có nằm trong đoạn text khác không (không phân biệt hoa thường, khoảng trắng)
 */
const isTextRedundant = (softText: string, hardText: string): boolean => {
  const clean = (t: string) => t.toLowerCase().replace(/\s+/g, '');
  return clean(hardText).includes(clean(softText));
};

/**
 * Tìm các đoạn có trong Soft SRT nhưng Hard SRT bị thiếu (không overlap)
 * Kèm logic phân tích ngữ cảnh trước sau để lọc false positive.
 */
export const findMissingSegments = (hardBlocks: SubtitleBlock[], softBlocks: SubtitleBlock[]): ProposedChange[] => {
  const hardIntervals = hardBlocks.map(b => {
    const parts = b.timestamp.split(' --> ');
    return {
      start: timestampToMs(parts[0]),
      end: timestampToMs(parts[1]),
      text: b.originalText
    };
  });

  const missing: ProposedChange[] = [];

  softBlocks.forEach((soft, index) => {
    const parts = soft.timestamp.split(' --> ');
    const sStart = timestampToMs(parts[0]);
    const sEnd = timestampToMs(parts[1]);

    // 1. Tìm overlap
    const overlapIdx = hardIntervals.findIndex(hard => sStart < hard.end && sEnd > hard.start);
    const isOverlapped = overlapIdx !== -1;

    if (!isOverlapped) {
      // Tìm Hard trước và sau
      let hardBefore: typeof hardIntervals[0] | null = null;
      let hardAfter: typeof hardIntervals[0] | null = null;

      for (let i = 0; i < hardIntervals.length; i++) {
        if (hardIntervals[i].end <= sStart) hardBefore = hardIntervals[i];
        if (hardIntervals[i].start >= sEnd) {
          hardAfter = hardIntervals[i];
          break;
        }
      }

      // 2. Logic phân tích thông minh
      let isValid = true;
      let contextAnalysis = "";
      let reason = "Hard SRT không có subtitle trong đoạn này → cần bù từ Soft SRT.";

      const softText = soft.originalText;
      const hBeforeTxt = hardBefore?.text || "";
      const hAfterTxt = hardAfter?.text || "";

      // Kiểm tra xem Soft text có phải là một phần của câu trong Hard trước/sau không
      const isPartofPrevious = isTextRedundant(softText, hBeforeTxt);
      const isPartofNext = isTextRedundant(softText, hAfterTxt);
      const combinedHard = hBeforeTxt + hAfterTxt;
      const isSplitDifference = isTextRedundant(softText, combinedHard);

      if (isSplitDifference) {
        isValid = false;
        contextAnalysis = "Hard trước/sau chứa nội dung tương tự → Đây chỉ là cách chia câu khác nhau.";
      } else if (!hardBefore && !hardAfter) {
        contextAnalysis = "Không tìm thấy nội dung Hard SRT xung quanh → Xác nhận là thiếu subtitle thực sự.";
      } else if (hBeforeTxt && hAfterTxt) {
        contextAnalysis = "Hard trước/sau có nội dung nhưng không mạch lạc ngữ nghĩa → Xác nhận thiếu subtitle giữa chừng.";
        reason = "Hard SRT có nội dung nhưng bị ngắt đoạn → cần bổ sung từ Soft SRT.";
      } else {
        contextAnalysis = "Khoảng thời gian chỉ có âm thanh trong Soft SRT → đề xuất thêm subtitle.";
        reason = "Khoảng thời gian chỉ có âm thanh → đề xuất thêm subtitle.";
      }

      missing.push({
        id: `soft-${index}`,
        start: parts[0],
        end: parts[1],
        text: softText,
        startMs: sStart,
        hardContext: null, // Sẽ được UI dùng để hiển thị "không có"
        reason: reason,
        contextAnalysis: contextAnalysis,
        isValid: isValid,
        hardBefore: hBeforeTxt,
        hardAfter: hAfterTxt
      });
    }
  });

  return missing;
};

/**
 * Gộp các đoạn đề xuất đã chọn vào Hard SRT, sắp xếp và đánh lại index
 */
export const mergeSRT = (hardBlocks: SubtitleBlock[], selectedChanges: ProposedChange[]): SubtitleBlock[] => {
  const newBlocks: SubtitleBlock[] = [...hardBlocks];

  selectedChanges.forEach(change => {
    newBlocks.push({
      index: "0", // Sẽ đánh lại sau
      timestamp: `${change.start} --> ${change.end}`,
      originalText: change.text
    });
  });

  // Sắp xếp theo thời gian bắt đầu
  newBlocks.sort((a, b) => {
    const startA = timestampToMs(a.timestamp.split(' --> ')[0]);
    const startB = timestampToMs(b.timestamp.split(' --> ')[0]);
    return startA - startB;
  });

  // Đánh lại số thứ tự
  return newBlocks.map((block, idx) => ({
    ...block,
    index: (idx + 1).toString()
  }));
};

/**
 * Chỉnh sửa toàn bộ timestamp của file SRT dựa trên tốc độ (Speed)
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
 */
export const extractChineseTitle = (fileName: string): string => {
  let name = fileName.replace(/\.[^/.]+$/, "");
  name = name.replace(/^\[Speed-[\d.]+\]\s*/i, "");
  name = name.replace(/^\[Partial(-\d+)?\]\s*/i, "");
  name = name.replace(/^\[Translated\]\s*/i, "");
  name = name.replace(/\[.*?\]|\(.*?\)|{.*?}/g, "");
  const keywords = ["Translated", "bilibili", "Ep\\d+", "Tập\\d+", "1080p", "720p", "4K", "Review", "Subtitle", "Vietsub"];
  const keywordRegex = new RegExp(keywords.join("|"), "gi");
  name = name.replace(keywordRegex, "");
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
export const generateFileName = (currentName: string, isFinished: boolean, speed?: number, isOptimized?: boolean): string => {
  let baseName = currentName.replace(/\.[^/.]+$/, "");
  
  if (isOptimized) {
    return `[Optimized] ${baseName}.srt`;
  }

  if (speed !== undefined && speed !== 1) {
    baseName = baseName.replace(/^\[Speed-[\d.]+\]\s*/i, "");
    return `[Speed-${speed}] ${baseName}.srt`;
  }

  if (isFinished) {
    const cleanName = baseName.replace(/^\[Partial(-\d+)?\]\s*/i, "");
    return `[Translated] ${cleanName}.srt`;
  }

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

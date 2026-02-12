
import { SubtitleBlock, ProposedChange, HybridOptimizeSuggestion, HybridOptimizeStats } from '../types';

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
export const msToTimestamp = (ms: number): string => {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mss = Math.floor(ms % 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${mss.toString().padStart(3, '0')}`;
};

/**
 * Bước 1: Phân tích nhanh (Quick Analyze) hoàn toàn local
 */
export const performQuickAnalyze = (blocks: SubtitleBlock[]): { suggestions: HybridOptimizeSuggestion[], stats: HybridOptimizeStats } => {
  const suggestions: HybridOptimizeSuggestion[] = [];
  const stats: HybridOptimizeStats = { total: blocks.length, ignored: 0, localFix: 0, aiRequired: 0 };
  const SAFE_GAP = 50; // 0.05s

  blocks.forEach((b, idx) => {
    const parts = b.timestamp.split(' --> ');
    if (parts.length !== 2) {
      stats.ignored++;
      return;
    }

    const startMs = timestampToMs(parts[0]);
    const endMs = timestampToMs(parts[1]);
    const durationS = (endMs - startMs) / 1000;
    const text = b.translatedText || b.originalText;
    const charCount = text.length;
    const cps = durationS > 0 ? charCount / durationS : 999;

    if (cps < 20) {
      stats.ignored++;
    } else if (cps >= 20 && cps <= 30) {
      stats.localFix++;
      // Tính toán lý tưởng (Target 20 CPS)
      const targetCps = 20;
      const requiredDurationMs = (charCount / targetCps) * 1000;
      let idealEndMs = startMs + requiredDurationMs;

      // Kiểm tra Overlap với câu sau
      const nextBlock = blocks[idx + 1];
      if (nextBlock) {
        const nextStartMs = timestampToMs(nextBlock.timestamp.split(' --> ')[0]);
        const maxAllowedEnd = nextStartMs - SAFE_GAP;
        idealEndMs = Math.min(idealEndMs, maxAllowedEnd);
      }

      // Chỉ đề xuất nếu có thể kéo dài thực sự
      if (idealEndMs > endMs) {
        suggestions.push({
          id: `local-${b.index}`,
          index: b.index,
          type: 'local',
          cps: cps,
          charCount: charCount,
          duration: durationS,
          beforeTimestamp: b.timestamp,
          afterTimestamp: `${parts[0]} --> ${msToTimestamp(idealEndMs)}`,
          beforeText: text,
          afterText: text,
          explanation: `Tốc độ đọc ${cps.toFixed(1)} CPS. Đã kéo dài end_time để đạt gần mức 20 CPS mà không gây overlap.`,
          status: 'pending'
        });
      } else {
        // Cập nhật stats nếu không fix được local
        stats.ignored++;
      }
    } else {
      stats.aiRequired++;
      suggestions.push({
        id: `ai-${b.index}`,
        index: b.index,
        type: 'ai',
        cps: cps,
        charCount: charCount,
        duration: durationS,
        beforeTimestamp: b.timestamp,
        afterTimestamp: b.timestamp,
        beforeText: text,
        afterText: text, // Sẽ được AI update sau
        explanation: `Tốc độ cực cao (${cps.toFixed(1)} CPS). Cần AI can thiệp rút gọn nội dung hoặc chia lại mạch câu.`,
        status: 'pending'
      });
    }
  });

  return { suggestions, stats };
};

/**
 * Các hàm parse và utility khác
 */
export const parseSRT = (content: string): SubtitleBlock[] => {
  const blocks: SubtitleBlock[] = [];
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const splitBlocks = normalized.split(/\n\s*\n/);

  for (const block of splitBlocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l !== "");
    if (lines.length >= 2) {
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

export const extractChineseTitle = (fileName: string): string => {
  let name = fileName.replace(/\.[^/.]+$/, "");
  const chineseTitleRegex = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef\s,，!！?？:：]+/;
  const match = name.match(chineseTitleRegex);
  return match ? match[0].trim() : name.trim();
};

export const generateFileName = (currentName: string, isFinished: boolean, speed?: number, isOptimized?: boolean): string => {
  let baseName = currentName.replace(/\.[^/.]+$/, "");
  if (isOptimized) return `[Optimized] ${baseName}.srt`;
  if (isFinished) return `[Translated] ${baseName}.srt`;
  return baseName + ".srt";
};

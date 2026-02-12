
import { SubtitleBlock, HybridOptimizeSuggestion, HybridOptimizeResult } from '../types';

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
 * Bước 1: Quick Analyze - Local logic only
 * 🟢 < 20: Bỏ qua
 * 🟡 20 - 40: Tính Local Fix (không hiển thị)
 * 🔴 > 40: Mark AI Required
 */
export const performQuickAnalyze = (blocks: SubtitleBlock[]): HybridOptimizeResult => {
  const aiRequiredSegments: HybridOptimizeSuggestion[] = [];
  let localFixCount = 0;
  const SAFE_GAP = 50; // 0.05s

  blocks.forEach((b, idx) => {
    const parts = b.timestamp.split(' --> ');
    if (parts.length !== 2) return;

    const startMs = timestampToMs(parts[0]);
    const endMs = timestampToMs(parts[1]);
    const durationS = (endMs - startMs) / 1000;
    const text = b.translatedText || b.originalText;
    const charCount = text.length;
    const cps = durationS > 0 ? charCount / durationS : 999;

    // RULE 1: CPS < 20 -> Ignore completely
    if (cps < 20) return;

    // RULE 2: 20 <= CPS <= 40 -> Internal math fix calculation (Auto)
    if (cps >= 20 && cps <= 40) {
      const targetCps = 20;
      const requiredDurationMs = (charCount / targetCps) * 1000;
      let idealEndMs = startMs + requiredDurationMs;

      // Anti-overlap check
      const nextBlock = blocks[idx + 1];
      if (nextBlock) {
        const nextStartMs = timestampToMs(nextBlock.timestamp.split(' --> ')[0]);
        const maxAllowedEnd = nextStartMs - SAFE_GAP;
        idealEndMs = Math.min(idealEndMs, maxAllowedEnd);
      }

      // If we can actually extend it significantly
      if (idealEndMs > endMs + 10) { // Only count if we add >10ms
        localFixCount++;
      }
      return;
    }

    // RULE 3: CPS > 40 -> AI REQUIRED list
    if (cps > 40) {
      aiRequiredSegments.push({
        id: `ai-${b.index}`,
        index: b.index,
        cps: cps,
        charCount: charCount,
        duration: durationS,
        beforeTimestamp: b.timestamp,
        afterTimestamp: b.timestamp,
        beforeText: text,
        afterText: text,
        status: 'pending'
      });
    }
  });

  return { aiRequiredSegments, localFixCount };
};

/**
 * Apply Local Fixes to blocks (20-40 range)
 */
export const applyLocalFixesOnly = (blocks: SubtitleBlock[]): SubtitleBlock[] => {
  const newBlocks = blocks.map(b => ({ ...b }));
  const SAFE_GAP = 50;

  newBlocks.forEach((b, idx) => {
    const parts = b.timestamp.split(' --> ');
    if (parts.length !== 2) return;
    const startMs = timestampToMs(parts[0]);
    const endMs = timestampToMs(parts[1]);
    const durationS = (endMs - startMs) / 1000;
    const text = b.translatedText || b.originalText;
    const charCount = text.length;
    const cps = durationS > 0 ? charCount / durationS : 999;

    // Apply only for the 20-40 range as per prompt
    if (cps >= 20 && cps <= 40) {
      const targetCps = 20;
      const requiredDurationMs = (charCount / targetCps) * 1000;
      let idealEndMs = startMs + requiredDurationMs;

      const nextBlock = newBlocks[idx + 1];
      if (nextBlock) {
        const nextStartMs = timestampToMs(nextBlock.timestamp.split(' --> ')[0]);
        const maxAllowedEnd = nextStartMs - SAFE_GAP;
        idealEndMs = Math.min(idealEndMs, maxAllowedEnd);
      }

      // Final end time must be between current and max allowed
      if (idealEndMs > endMs) {
        b.timestamp = `${parts[0]} --> ${msToTimestamp(idealEndMs)}`;
      }
    }
  });

  return newBlocks;
};

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

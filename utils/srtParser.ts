
import { SubtitleBlock } from '../types';

export const parseSRT = (content: string): SubtitleBlock[] => {
  const blocks: SubtitleBlock[] = [];
  // Normalized line endings
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const splitBlocks = normalized.split(/\n\n+/);

  for (const block of splitBlocks) {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const index = lines[0].trim();
      const timestamp = lines[1].trim();
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

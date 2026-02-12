
export enum Genre {
  TU_TIEN = 'Tu Tiên',
  XUYEN_KHONG = 'Xuyên Không',
  DI_GIOI = 'Dị Giới',
  HUYEN_HUYEN = 'Huyền Huyễn',
  QUY_DI = 'Quỷ Dị',
  HE_THONG = 'Hệ Thống',
  TRONG_SINH = 'Trọng Sinh',
  NGU_THU = 'Ngự Thú',
  THAN_THOAI = 'Thần Thoại',
  TIEN_HIEP = 'Tiên Hiệp',
  DO_THI = 'Đô Thị Huyền Huyễn'
}

export interface TitleAnalysis {
  originalTitle: string;
  translatedTitle: string;
  mainGenres: string[];
  summary: string;
  tone: string;
  recommendedStyle: string;
}

export interface SubtitleBlock {
  index: string;
  timestamp: string;
  originalText: string;
  translatedText?: string;
}

export interface HybridOptimizeResult {
  aiRequiredSegments: HybridOptimizeSuggestion[];
  localFixCount: number;
}

export interface HybridOptimizeSuggestion {
  id: string;
  index: string;
  cps: number;
  charCount: number;
  duration: number;
  beforeTimestamp: string;
  afterTimestamp: string;
  beforeText: string;
  afterText: string;
  status: 'pending' | 'processing' | 'applied' | 'error';
  error?: string;
  appliedAt?: number; // For highlight effect
}

export interface SessionStats {
  requests: number;
  totalTokens: number;
  translatedBlocks: number;
}

export interface InterruptionInfo {
  reason: string;
  total: number;
  translated: number;
  remaining: number;
}

export type AiProvider = 'gemini' | 'openai';

export interface TranslationState {
  isTranslating: boolean;
  isAnalyzing: boolean;
  progress: number;
  total: number;
  error: string | null;
  interruption: InterruptionInfo | null;
  fileStatus: 'new' | 'mixed' | 'completed' | null;
  apiStatus: 'checking' | 'valid' | 'invalid' | 'unknown';
  selectedModel: string;
}

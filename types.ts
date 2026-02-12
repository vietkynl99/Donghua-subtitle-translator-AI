
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

export interface ProposedChange {
  id: string;
  start: string;
  end: string;
  text: string;
  startMs: number;
  hardContext?: string | null;
  reason: string;
  contextAnalysis: string;
  isValid: boolean;
  hardBefore?: string | null;
  hardAfter?: string | null;
}

export interface AutoOptimizeSuggestion {
  id: string;
  type: 'merge' | 'delete' | 'adjust' | 'edit';
  indices: string[];
  before: string;
  after: string;
  reason: string;
  explanation: string;
  proposedTimestamp?: string;
}

export interface HybridOptimizeSuggestion {
  id: string;
  index: string;
  type: 'local' | 'ai';
  cps: number;
  charCount: number;
  duration: number;
  beforeTimestamp: string;
  afterTimestamp: string;
  beforeText: string;
  afterText: string;
  explanation: string;
  status: 'pending' | 'applied' | 'error';
}

export interface HybridOptimizeStats {
  total: number;
  ignored: number; // < 20
  localFix: number; // 20 - 30
  aiRequired: number; // > 30
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

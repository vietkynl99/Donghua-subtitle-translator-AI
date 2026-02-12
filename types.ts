
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
  mergeRef?: string; // Reference for Merge feature
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
  errorMsg?: string;
  appliedAt?: number;
}

export interface HybridOptimizeResult {
  aiRequiredSegments: HybridOptimizeSuggestion[];
  localFixCount: number;
}

export interface OptimizeStats {
  total: number;
  processed: number;
  failed: number;
  autoFixed: number;
  ignored: number;
}

export interface MergeStats {
  total: number;
  matched: number;
  aiAligned: number;
  failed: number;
}

export interface TranslationState {
  isProcessing: boolean;
  isAnalyzing: boolean;
  progress: number;
  total: number;
  error: string | null;
  fileStatus: 'new' | 'mixed' | 'completed' | null;
  apiStatus: 'checking' | 'valid' | 'invalid' | 'unknown';
  selectedModel: string;
}

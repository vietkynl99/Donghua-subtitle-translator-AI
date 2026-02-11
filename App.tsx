
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Play, CheckCircle2, AlertCircle, Loader2, Trash2, 
  FileText, Search, Sparkles, ChevronRight, Activity, Cpu, FileDown, 
  RefreshCw, Box, Tags, BookOpen, Target, FileSearch, Info
} from 'lucide-react';
import { TitleAnalysis, SubtitleBlock, TranslationState, SessionStats } from './types';
import { parseSRT, stringifySRT, extractChineseTitle } from './utils/srtParser';
import { translateSubtitles, analyzeTitle, checkApiHealth } from './services/geminiService';

const MODELS = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', desc: 'Nhanh, Hiệu quả' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', desc: 'Thông minh, Chất lượng cao' },
];

const App: React.FC = () => {
  const [titleInput, setTitleInput] = useState<string>('');
  const [detectedTitle, setDetectedTitle] = useState<string>('');
  const [analysis, setAnalysis] = useState<TitleAnalysis | null>(null);
  const [blocks, setBlocks] = useState<SubtitleBlock[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [isResumeMode, setIsResumeMode] = useState(false);
  const [stats, setStats] = useState<SessionStats>({
    requests: 0,
    totalTokens: 0,
    translatedBlocks: 0
  });
  const [status, setStatus] = useState<TranslationState>({
    isTranslating: false,
    isAnalyzing: false,
    progress: 0,
    total: 0,
    error: null,
    apiStatus: 'checking',
    selectedModel: 'gemini-3-flash-preview'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const verifyKey = async () => {
      const isValid = await checkApiHealth(status.selectedModel);
      setStatus(prev => ({ ...prev, apiStatus: isValid ? 'valid' : 'invalid' }));
    };
    verifyKey();
  }, [status.selectedModel]);

  const containsChinese = (text: string) => /[\u4e00-\u9fa5]/.test(text);

  const handleAnalyze = async (title: string) => {
    if (!title.trim() || status.isAnalyzing) return;
    setStatus(prev => ({ ...prev, isAnalyzing: true, error: null }));
    try {
      const { analysis: result, tokens } = await analyzeTitle(title, status.selectedModel);
      setAnalysis(result);
      setStats(prev => ({ ...prev, requests: prev.requests + 1, totalTokens: prev.totalTokens + tokens }));
    } catch (err: any) {
      setStatus(prev => ({ ...prev, error: "Hết hạn mức API (429). Vui lòng thử lại sau 1 phút." }));
    } finally {
      setStatus(prev => ({ ...prev, isAnalyzing: false }));
    }
  };

  const processFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.srt')) {
      setStatus(prev => ({ ...prev, error: "Chỉ chấp nhận file .SRT" }));
      return;
    }

    const title = extractChineseTitle(file.name);
    setDetectedTitle(title);
    setTitleInput(title);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const parsed = parseSRT(content);
      
      let translatedCount = 0;
      const processedBlocks = parsed.map(block => {
        // Nếu block không chứa tiếng Trung, coi như đã dịch
        if (!containsChinese(block.originalText)) {
          translatedCount++;
          return { ...block, translatedText: block.originalText };
        }
        return block;
      });

      setIsResumeMode(translatedCount > 0 && translatedCount < parsed.length);
      setBlocks(processedBlocks);
      setStatus(prev => ({ ...prev, total: processedBlocks.length, progress: translatedCount, error: null }));
      setStats(prev => ({ ...prev, translatedBlocks: translatedCount }));
      
      // Tự động phân tích sau khi nhận diện title
      handleAnalyze(title);
    };
    reader.readAsText(file);
  };

  const startTranslation = async () => {
    if (blocks.length === 0 || !analysis) return;
    setStatus(prev => ({ ...prev, isTranslating: true, error: null }));
    let lastProgress = status.progress;
    
    try {
      const translated = await translateSubtitles(blocks, analysis, status.selectedModel, (count, tokens) => {
        const newlyDone = Math.max(0, count - lastProgress);
        lastProgress = count;
        setStatus(prev => ({ ...prev, progress: count }));
        setStats(prev => ({
          ...prev, requests: prev.requests + 1, totalTokens: prev.totalTokens + tokens,
          translatedBlocks: prev.translatedBlocks + newlyDone
        }));
      });
      setBlocks(translated);
      setStatus(prev => ({ ...prev, isTranslating: false }));
    } catch (err: any) {
      setStatus(prev => ({ ...prev, isTranslating: false, error: "Dịch bị dừng. Tải file dở dang về, chờ 1 phút và upload lại để tiếp tục." }));
    }
  };

  const downloadSRT = (isPartial = false) => {
    const content = stringifySRT(blocks);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${isPartial ? '[Dở dang]_' : '[Hoàn thiện]_'}${fileName}`;
    a.click();
  };

  // Define derived state variables to fix "Cannot find name" errors
  const progressPercentage = status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0;
  const isFinished = status.total > 0 && status.progress === status.total;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Donghua AI Sub</h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Subtitle Intelligence System</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="hidden lg:flex items-center gap-2 p-1 bg-slate-800 border border-slate-700 rounded-xl">
               {MODELS.map((m) => (
                 <button
                   key={m.id}
                   onClick={() => setStatus(prev => ({ ...prev, selectedModel: m.id }))}
                   disabled={status.isTranslating}
                   className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${status.selectedModel === m.id ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                   {m.name}
                 </button>
               ))}
             </div>
             {(blocks.length > 0 || analysis) && (
               <button onClick={() => window.location.reload()} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-all text-sm font-medium">
                 <Trash2 size={16} /> <span className="hidden md:inline">Làm mới</span>
               </button>
             )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
            <h2 className="text-xs font-bold mb-6 flex items-center gap-2 text-indigo-400 uppercase tracking-widest">
              <FileSearch size={16} /> Bước 1 & 2: Nhận diện & Phân tích
            </h2>
            
            <div className="space-y-4">
              {!fileName ? (
                <div 
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if(f) processFile(f); }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer transition-all ${isDragging ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02]' : 'border-slate-700 hover:border-indigo-500 hover:bg-indigo-500/5'}`}
                >
                  <Upload className="text-slate-500 mb-2" size={40} />
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-widest text-center">Tải file .SRT (Trung/Mix)</p>
                  <input type="file" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if(f) processFile(f); }} accept=".srt" className="hidden" />
                </div>
              ) : (
                <div className="space-y-5 animate-in fade-in slide-in-from-top-4 duration-500">
                  <div className="p-4 bg-indigo-600/10 border border-indigo-500/30 rounded-2xl space-y-2">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">📌 TIÊU ĐỀ NHẬN DIỆN (ZH):</span>
                    <p className="text-sm font-bold text-white pl-2">{detectedTitle}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 pt-1">
                      <FileText size={12} /> <span className="truncate">{fileName}</span>
                    </div>
                  </div>

                  {status.isAnalyzing ? (
                    <div className="flex items-center justify-center py-8 gap-3 text-indigo-400">
                      <Loader2 className="animate-spin" size={20} />
                      <span className="text-xs font-bold uppercase tracking-widest">AI đang phân tích cốt truyện...</span>
                    </div>
                  ) : analysis && (
                    <div className="bg-slate-800/40 border border-slate-700 rounded-3xl p-6 space-y-5 shadow-inner">
                      <div className="flex items-center gap-2 text-emerald-400 border-b border-slate-700 pb-2">
                        <CheckCircle2 size={16} />
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em]">✅ PHÂN TÍCH THÀNH CÔNG</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">🇻🇳 TIÊU ĐỀ VIỆT GỢI Ý:</span>
                        <p className="text-lg font-bold text-white border-l-4 border-indigo-500 pl-4 py-1">{analysis.translatedTitle}</p>
                      </div>
                      <div className="space-y-2">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">🏷️ THỂ LOẠI:</span>
                        <div className="flex flex-wrap gap-2 pl-2">
                          {analysis.mainGenres.map(g => <span key={g} className="px-3 py-1 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded-lg text-[9px] font-bold">{g}</span>)}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">📖 TÓM TRUYỆN:</span>
                        <p className="text-[12px] text-slate-300 leading-relaxed italic pl-2">"{analysis.summary}"</p>
                      </div>
                      <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-700/50">
                        <span className="text-[9px] font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1 mb-1"><Target size={12}/> ĐỊNH HƯỚNG DỊCH:</span>
                        <p className="text-[11px] text-slate-400 pl-4 leading-normal font-medium">{analysis.recommendedStyle}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className={`bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl transition-all duration-500 ${!analysis ? 'opacity-30 grayscale pointer-events-none' : 'opacity-100'}`}>
            <h2 className="text-xs font-bold mb-6 flex items-center gap-2 text-indigo-400 uppercase tracking-[0.2em]">
              <Activity size={16} /> Bước 3: Dịch thuật & Hoàn tất
            </h2>
            <div className="space-y-4">
              {isResumeMode && (
                <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-emerald-400 animate-pulse">
                  <RefreshCw size={14} className="animate-spin-slow" />
                  <span className="text-[9px] font-bold uppercase tracking-[0.2em]">Phát hiện file Mix - Sẵn sàng dịch tiếp</span>
                </div>
              )}
              {!status.isTranslating && progressPercentage < 100 && (
                <button onClick={startTranslation} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-xl shadow-indigo-500/20 active:scale-[0.98]">
                  <Play size={20} fill="currentColor" /> {isResumeMode ? 'Dịch tiếp phần còn lại' : 'Bắt đầu dịch ngay'}
                </button>
              )}
              {status.isTranslating && (
                <div className="space-y-3 p-5 bg-slate-800/30 rounded-2xl border border-slate-700/50">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <div className="flex items-center gap-2 text-indigo-400">
                      <Loader2 className="animate-spin" size={14} /> <span>Dịch {status.progress}/{status.total}...</span>
                    </div>
                    <span>{progressPercentage}%</span>
                  </div>
                  <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden shadow-inner border border-slate-700/50">
                    <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-300 shadow-[0_0_15px_rgba(99,102,241,0.6)]" style={{ width: `${progressPercentage}%` }} />
                  </div>
                </div>
              )}
              {(isFinished || status.error) && (
                <button onClick={() => downloadSRT(!isFinished)} className={`w-full ${isFinished ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-800 hover:bg-slate-700'} text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-xl`}>
                  <Download size={20} /> {isFinished ? 'Tải file hoàn thiện' : 'Tải file dở dang'}
                </button>
              )}
              {status.error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex gap-3 text-red-400 text-xs">
                  <AlertCircle size={18} className="shrink-0" /> <p className="font-medium leading-relaxed">{status.error}</p>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="lg:col-span-7 h-[calc(100vh-10rem)] bg-slate-900 border border-slate-800 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
          <div className="p-6 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
            <h3 className="font-bold text-slate-400 text-[10px] uppercase tracking-[0.3em] flex items-center gap-3">
              <Activity size={18} className="text-indigo-500" /> Monitor Tiến trình Thực tế
            </h3>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl">
              <Cpu size={14} className="text-indigo-400" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Gemini Engine</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            {blocks.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-800 opacity-20">
                <Box size={100} strokeWidth={0.5} className="mb-6 animate-pulse" />
                <p className="text-base font-bold uppercase tracking-[0.4em]">Đang chờ tải tệp phụ đề</p>
              </div>
            ) : (
              blocks.map((block) => {
                const isTranslated = !!block.translatedText && !containsChinese(block.translatedText);
                return (
                  <div key={block.index} className={`grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-3xl border transition-all duration-700 ${isTranslated ? 'border-emerald-500/20 bg-emerald-500/5 shadow-inner' : 'border-slate-800 bg-slate-900/40 hover:bg-slate-900/60'}`}>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-[10px] font-mono font-bold text-slate-500">
                        <span className="bg-slate-800 px-2.5 py-1 rounded-lg text-indigo-400 border border-slate-700/50">#{block.index}</span>
                        <span className="opacity-50 tracking-tighter">{block.timestamp}</span>
                      </div>
                      <p className="text-xs text-slate-400 font-serif-vi leading-relaxed">{block.originalText}</p>
                    </div>
                    <div className="md:border-l border-slate-800 md:pl-8 space-y-3 flex flex-col justify-center min-h-[60px]">
                      <div className="flex justify-between items-center">
                        <span className={`text-[9px] uppercase font-bold tracking-[0.25em] ${isTranslated ? 'text-emerald-500' : 'text-slate-600'}`}>
                          {isTranslated ? 'Bản dịch tối ưu' : 'Đang xử lý...'}
                        </span>
                        {isTranslated && <CheckCircle2 size={14} className="text-emerald-500 drop-shadow-[0_0_5px_rgba(16,185,129,0.3)]" />}
                      </div>
                      {block.translatedText ? (
                        <p className="text-[15px] text-slate-100 font-serif-vi font-bold leading-relaxed animate-in zoom-in-95 fade-in duration-700">{block.translatedText}</p>
                      ) : (
                        <div className="space-y-2"><div className="h-3.5 w-full bg-slate-800/50 rounded-full animate-pulse" /><div className="h-3.5 w-4/5 bg-slate-800/50 rounded-full animate-pulse delay-75" /></div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>

      <footer className="p-4 text-center border-t border-slate-900 bg-slate-950/80">
        <p className="text-slate-700 text-[9px] uppercase tracking-[0.5em] font-bold">Donghua AI Subtitle System • Designed for Cultivation Fans</p>
      </footer>
    </div>
  );
};

export default App;

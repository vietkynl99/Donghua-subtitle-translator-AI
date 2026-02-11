
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Download, 
  Play, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Trash2, 
  FileText, 
  Search, 
  Sparkles, 
  ChevronRight, 
  Activity, 
  Cpu, 
  BarChart3,
  FileDown,
  RefreshCw,
  Box,
  Tags,
  BookOpen,
  Target,
  FileSearch
} from 'lucide-react';
import { TitleAnalysis, SubtitleBlock, TranslationState, SessionStats } from './types';
import { parseSRT, stringifySRT } from './utils/srtParser';
import { translateSubtitles, analyzeTitle, checkApiHealth } from './services/geminiService';

const MODELS = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', desc: 'Nhanh, Hiệu quả' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', desc: 'Chất lượng cao, Thông minh' },
];

const App: React.FC = () => {
  const [titleInput, setTitleInput] = useState<string>('');
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
      setStatus(prev => ({ ...prev, apiStatus: 'checking' }));
      const isValid = await checkApiHealth(status.selectedModel);
      setStatus(prev => ({ ...prev, apiStatus: isValid ? 'valid' : 'invalid' }));
    };
    verifyKey();
  }, [status.selectedModel]);

  const containsChinese = (text: string) => /[\u4e00-\u9fa5]/.test(text);

  const handleAnalyzeTitle = async () => {
    if (!titleInput.trim() || status.isAnalyzing || status.isTranslating) return;
    setStatus(prev => ({ ...prev, isAnalyzing: true, error: null }));
    try {
      const { analysis: result, tokens } = await analyzeTitle(titleInput, status.selectedModel);
      setAnalysis(result);
      setStats(prev => ({
        ...prev,
        requests: prev.requests + 1,
        totalTokens: prev.totalTokens + tokens
      }));
    } catch (err: any) {
      const errorStr = err?.toString() || "";
      let msg = "Lỗi phân tích tiêu đề. Vui lòng thử lại.";
      if (errorStr.includes("429") || errorStr.toLowerCase().includes("quota") || errorStr.toLowerCase().includes("resource_exhausted")) {
        msg = "Hết hạn mức API (429 Quota Exceeded). Vui lòng kiểm tra gói dịch vụ hoặc thử lại sau 1 phút.";
      } else if (errorStr.includes("401") || errorStr.includes("403")) {
        msg = "API Key không hợp lệ hoặc đã hết hạn.";
      }
      setStatus(prev => ({ ...prev, error: msg }));
    } finally {
      setStatus(prev => ({ ...prev, isAnalyzing: false }));
    }
  };

  const processFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.srt')) {
      setStatus(prev => ({ ...prev, error: "Chỉ chấp nhận file định dạng .SRT" }));
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const parsed = parseSRT(content);
      
      let resumedCount = 0;
      const processedBlocks = parsed.map(block => {
        if (!containsChinese(block.originalText)) {
          resumedCount++;
          return { ...block, translatedText: block.originalText };
        }
        return block;
      });

      setIsResumeMode(resumedCount > 0 && resumedCount < parsed.length);
      setBlocks(processedBlocks);
      setStatus(prev => ({ 
        ...prev, 
        total: processedBlocks.length, 
        progress: resumedCount, 
        error: null 
      }));
      setStats(prev => ({ ...prev, translatedBlocks: resumedCount }));
    };
    reader.readAsText(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const startTranslation = async () => {
    if (blocks.length === 0 || !analysis) return;
    
    setStatus(prev => ({ ...prev, isTranslating: true, error: null }));
    let lastProgress = blocks.filter(b => b.translatedText).length;
    
    try {
      const translated = await translateSubtitles(blocks, analysis, status.selectedModel, (count, tokens) => {
        const newlyTranslatedCount = Math.max(0, count - lastProgress);
        lastProgress = count;
        
        setStatus(prev => ({ ...prev, progress: count }));
        setStats(prev => ({
          ...prev,
          requests: prev.requests + 1,
          totalTokens: prev.totalTokens + tokens,
          translatedBlocks: prev.translatedBlocks + newlyTranslatedCount
        }));
      });
      setBlocks(translated);
      setStatus(prev => ({ ...prev, isTranslating: false }));
    } catch (err: any) {
      const errorStr = err?.toString() || "";
      let msg = "Quá trình dịch bị gián đoạn. Hãy tải file dở dang về và gửi lại sau.";
      if (errorStr.includes("429") || errorStr.toLowerCase().includes("quota") || errorStr.toLowerCase().includes("resource_exhausted")) {
        msg = "Lỗi 429: Hết hạn mức API. Hệ thống đã thử lại 3 lần nhưng không thành công. Vui lòng tải file dở dang về, chờ 1 phút rồi upload lại để dịch tiếp.";
      }
      setStatus(prev => ({ 
        ...prev, 
        isTranslating: false, 
        error: msg 
      }));
    }
  };

  const downloadSRT = (isPartial = false) => {
    const content = stringifySRT(blocks);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const prefix = isPartial ? '[Partial]' : '[Done]';
    a.download = `${prefix}_${fileName}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearAll = () => {
    setBlocks([]);
    setFileName('');
    setAnalysis(null);
    setTitleInput('');
    setIsResumeMode(false);
    setStatus(prev => ({
      ...prev,
      isTranslating: false,
      isAnalyzing: false,
      progress: 0,
      total: 0,
      error: null,
    }));
    setStats({ requests: 0, totalTokens: 0, translatedBlocks: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const progressPercentage = status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0;
  const isFinished = blocks.length > 0 && blocks.every(b => !!b.translatedText && !containsChinese(b.translatedText));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                Donghua AI Sub
              </h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Subtitle Intelligence System</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
             <div className="hidden lg:flex items-center gap-2 p-1 bg-slate-800/80 border border-slate-700 rounded-xl">
               {MODELS.map((m) => (
                 <button
                   key={m.id}
                   onClick={() => setStatus(prev => ({ ...prev, selectedModel: m.id }))}
                   disabled={status.isTranslating || status.isAnalyzing}
                   className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                     status.selectedModel === m.id 
                       ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' 
                       : 'text-slate-500 hover:text-slate-300'
                   } disabled:opacity-50`}
                 >
                   {m.name}
                 </button>
               ))}
             </div>

             {(blocks.length > 0 || analysis) && !status.isTranslating && (
               <button 
                onClick={clearAll}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-all text-sm font-medium"
               >
                 <Trash2 size={16} />
                 <span className="hidden md:inline">Làm mới</span>
               </button>
             )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Analysis & Context */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <Search size={120} />
            </div>
            
            <h2 className="text-xs font-bold mb-6 flex items-center gap-2 text-indigo-400 uppercase tracking-[0.2em]">
              <FileSearch size={16} /> Phân tích tiêu đề Donghua
            </h2>
            
            <div className="space-y-4 relative">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Tiêu đề phim (ZH)</label>
                <div className="relative">
                  <input 
                    type="text"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyzeTitle()}
                    placeholder="Dán tiêu đề tiếng Trung vào đây..."
                    disabled={status.isTranslating || status.isAnalyzing}
                    className="w-full bg-slate-800 border border-slate-700 rounded-2xl pl-4 pr-14 py-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm font-medium shadow-inner"
                  />
                  <button 
                    onClick={handleAnalyzeTitle}
                    disabled={!titleInput || status.isAnalyzing || status.isTranslating}
                    className="absolute right-2 top-2 bottom-2 w-10 bg-indigo-600 rounded-xl flex items-center justify-center hover:bg-indigo-500 transition-colors disabled:opacity-50 shadow-lg shadow-indigo-500/20"
                  >
                    {status.isAnalyzing ? <Loader2 size={18} className="animate-spin" /> : <ChevronRight size={20} />}
                  </button>
                </div>
              </div>
              
              {analysis ? (
                <div className="p-6 bg-slate-800/40 border border-indigo-500/30 rounded-3xl space-y-5 animate-in fade-in slide-in-from-top-4 duration-500 shadow-xl">
                  <div className="flex items-center gap-2 text-emerald-400 pb-2 border-b border-slate-700/50">
                    <CheckCircle2 size={16} />
                    <span className="text-xs font-bold uppercase tracking-[0.2em]">✅ PHÂN TÍCH THÀNH CÔNG</span>
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-slate-500">
                      <span className="text-[10px] font-bold uppercase tracking-widest italic">📌 TIÊU ĐỀ GỐC (ZH):</span>
                    </div>
                    <p className="text-sm font-medium text-slate-300 leading-tight pl-4">{analysis.originalTitle}</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-indigo-400">
                      <span className="text-[10px] font-bold uppercase tracking-widest">🇻🇳 TIÊU ĐỀ VIỆT GỢI Ý:</span>
                    </div>
                    <p className="text-lg font-bold text-white leading-tight pl-4 border-l-4 border-indigo-500 py-1 drop-shadow-sm">{analysis.translatedTitle}</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-slate-500">
                      <Tags size={14} className="text-indigo-400" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">🏷️ THỂ LOẠI:</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pl-4">
                      {analysis.mainGenres.map(g => (
                        <span key={g} className="px-3 py-1 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded-lg text-[10px] font-bold">
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-slate-500">
                      <BookOpen size={14} className="text-cyan-400" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">📖 TÓM TRUYỆN:</span>
                    </div>
                    <p className="text-[12px] text-slate-300 leading-relaxed italic pl-4">"{analysis.summary}"</p>
                  </div>

                  <div className="space-y-2 bg-slate-900/60 p-4 rounded-2xl border border-slate-700/50">
                    <div className="flex items-center gap-2 text-slate-500">
                      <Target size={14} className="text-amber-400" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">🎯 PHONG CÁCH DỊCH:</span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-medium leading-normal pl-4">{analysis.recommendedStyle}</p>
                  </div>
                </div>
              ) : !status.isAnalyzing && (
                <div className="py-12 flex flex-col items-center justify-center border border-slate-800 rounded-3xl opacity-30 italic text-slate-500">
                   <Sparkles size={32} className="mb-2" />
                   <p className="text-xs font-bold uppercase tracking-widest">Hệ thống sẵn sàng phân tích</p>
                </div>
              )}
            </div>
          </section>

          <section className={`bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl transition-all duration-500 ${!analysis ? 'opacity-30 grayscale pointer-events-none' : 'opacity-100'}`}>
            <h2 className="text-xs font-bold mb-6 flex items-center gap-2 text-indigo-400 uppercase tracking-[0.2em]">
              <Upload size={16} /> Nhập liệu file phụ đề
            </h2>

            {!fileName ? (
              <div 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${
                  isDragging ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02]' : 'border-slate-700 hover:border-indigo-500 hover:bg-indigo-500/5'
                }`}
              >
                <Upload className="text-slate-500 mb-2" size={32} />
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest text-center">Tải lên file .SRT (Trung hoặc Mix)</p>
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".srt" className="hidden" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-2xl flex items-center gap-3 relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500 transition-all group-hover:w-2" />
                  <FileText className="text-indigo-400 shrink-0" size={24} />
                  <div className="min-w-0">
                    <p className="text-sm truncate font-bold text-slate-200">{fileName}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{blocks.length} block phụ đề</p>
                  </div>
                </div>

                {isResumeMode && (
                  <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-emerald-400">
                    <RefreshCw size={14} className="animate-spin-slow" />
                    <span className="text-[9px] font-bold uppercase tracking-[0.2em]">Chế độ Resume - Đã xử lý một phần</span>
                  </div>
                )}

                {!status.isTranslating && !isFinished && (
                  <button 
                    onClick={startTranslation}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-xl shadow-indigo-500/20 active:scale-[0.98]"
                  >
                    <Play size={20} fill="currentColor" />
                    Bắt đầu dịch ngay
                  </button>
                )}

                {status.isTranslating && (
                  <div className="space-y-3 p-5 bg-slate-800/30 rounded-2xl border border-slate-700/50 shadow-inner">
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                      <div className="flex items-center gap-2 text-indigo-400">
                        <Loader2 className="animate-spin" size={14} />
                        <span>Xử lý {status.progress}/{status.total}...</span>
                      </div>
                      <span>{progressPercentage}%</span>
                    </div>
                    <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden shadow-inner border border-slate-700/50">
                      <div 
                        className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-300 shadow-[0_0_15px_rgba(99,102,241,0.6)]" 
                        style={{ width: `${progressPercentage}%` }} 
                      />
                    </div>
                  </div>
                )}

                {isFinished && (
                  <button 
                    onClick={() => downloadSRT(false)}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-xl shadow-emerald-500/20"
                  >
                    <Download size={20} />
                    Tải file bản dịch hoàn thiện
                  </button>
                )}
              </div>
            )}

            {status.error && (
              <div className="mt-4 space-y-3">
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex gap-3 text-red-400 text-xs">
                  <AlertCircle size={18} className="shrink-0" />
                  <p className="font-medium leading-relaxed">{status.error}</p>
                </div>
                {blocks.some(b => b.translatedText && !containsChinese(b.translatedText)) && (
                  <button 
                    onClick={() => downloadSRT(true)}
                    className="w-full py-3 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 rounded-2xl text-[10px] font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all"
                  >
                    <FileDown size={16} />
                    Tải file dở dang (.SRT)
                  </button>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Live Monitor */}
        <div className="lg:col-span-7 h-[calc(100vh-10rem)] bg-slate-900 border border-slate-800 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
          <div className="p-6 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
            <h3 className="font-bold text-slate-400 text-[10px] uppercase tracking-[0.3em] flex items-center gap-3">
              <Activity size={18} className="text-indigo-500" /> Giám sát dịch thuật thời gian thực
            </h3>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl">
              <Cpu size={14} className="text-indigo-400" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{MODELS.find(m => m.id === status.selectedModel)?.name}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            {blocks.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-800 opacity-20">
                <Box size={100} strokeWidth={0.5} className="mb-6 animate-pulse" />
                <p className="text-base font-bold uppercase tracking-[0.4em]">Đang chờ dữ liệu đầu vào</p>
              </div>
            ) : (
              blocks.map((block) => {
                const isTranslated = !!block.translatedText && !containsChinese(block.translatedText);
                const isPartial = !!block.translatedText && containsChinese(block.translatedText);

                return (
                  <div 
                    key={block.index} 
                    className={`grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-3xl border transition-all duration-700 ${
                      isTranslated ? 'border-emerald-500/20 bg-emerald-500/5 shadow-inner' : 
                      isPartial ? 'border-yellow-500/20 bg-yellow-500/5' : 
                      'border-slate-800 bg-slate-900/40 hover:bg-slate-900/60'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-[10px] font-mono font-bold text-slate-500">
                        <span className="bg-slate-800 px-2.5 py-1 rounded-lg text-indigo-400 shadow-sm border border-slate-700/50">#{block.index}</span>
                        <span className="opacity-50 tracking-tighter">{block.timestamp}</span>
                      </div>
                      <p className="text-sm text-slate-400 font-serif-vi leading-relaxed">{block.originalText}</p>
                    </div>
                    <div className="md:border-l border-slate-800 md:pl-8 space-y-3 flex flex-col justify-center min-h-[80px]">
                      <div className="flex justify-between items-center">
                        <span className={`text-[9px] uppercase font-bold tracking-[0.25em] ${isTranslated ? 'text-emerald-500' : 'text-slate-600'}`}>
                          {isTranslated ? 'Bản dịch tối ưu' : 'Đang xử lý...'}
                        </span>
                        {isTranslated && <CheckCircle2 size={14} className="text-emerald-500 drop-shadow-[0_0_5px_rgba(16,185,129,0.3)]" />}
                      </div>
                      {block.translatedText ? (
                        <p className="text-[15px] text-slate-100 font-serif-vi font-bold leading-relaxed animate-in zoom-in-95 fade-in duration-700 drop-shadow-sm">
                          {block.translatedText}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <div className="h-3.5 w-full bg-slate-800/50 rounded-full animate-pulse" />
                          <div className="h-3.5 w-4/5 bg-slate-800/50 rounded-full animate-pulse delay-75" />
                        </div>
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
        <p className="text-slate-700 text-[9px] uppercase tracking-[0.5em] font-bold">
          Donghua Subtitle Intelligence System • Professional Content Automation
        </p>
      </footer>
    </div>
  );
};

export default App;


import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Download, 
  Play, 
  Settings, 
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
  BarChart3 
} from 'lucide-react';
import { TitleAnalysis, SubtitleBlock, TranslationState, SessionStats } from './types';
import { parseSRT, stringifySRT } from './utils/srtParser';
import { translateSubtitles, analyzeTitle, checkApiHealth } from './services/geminiService';

const App: React.FC = () => {
  const [titleInput, setTitleInput] = useState<string>('');
  const [analysis, setAnalysis] = useState<TitleAnalysis | null>(null);
  const [blocks, setBlocks] = useState<SubtitleBlock[]>([]);
  const [fileName, setFileName] = useState<string>('');
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
    apiStatus: 'checking'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check API health on mount
  useEffect(() => {
    const verifyKey = async () => {
      const isValid = await checkApiHealth();
      setStatus(prev => ({ ...prev, apiStatus: isValid ? 'valid' : 'invalid' }));
    };
    verifyKey();
  }, []);

  const handleAnalyzeTitle = async () => {
    if (!titleInput.trim() || status.isAnalyzing || status.isTranslating) return;
    setStatus(prev => ({ ...prev, isAnalyzing: true, error: null }));
    try {
      const { analysis: result, tokens } = await analyzeTitle(titleInput);
      setAnalysis(result);
      setStats(prev => ({
        ...prev,
        requests: prev.requests + 1,
        totalTokens: prev.totalTokens + tokens
      }));
    } catch (err: any) {
      const msg = err.message?.includes('401') || err.message?.includes('403') 
        ? "API Key không hợp lệ hoặc đã hết hạn." 
        : "Lỗi phân tích tiêu đề.";
      setStatus(prev => ({ ...prev, error: msg }));
    } finally {
      setStatus(prev => ({ ...prev, isAnalyzing: false }));
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const parsed = parseSRT(content);
      setBlocks(parsed);
      setStatus(prev => ({ ...prev, total: parsed.length, progress: 0, error: null }));
    };
    reader.readAsText(file);
  };

  const startTranslation = async () => {
    if (blocks.length === 0 || !analysis) return;
    
    setStatus(prev => ({ ...prev, isTranslating: true, progress: 0, error: null }));
    let lastProgress = 0;
    
    try {
      const translated = await translateSubtitles(blocks, analysis, (count, tokens) => {
        const newlyTranslated = count - lastProgress;
        lastProgress = count;
        
        setStatus(prev => ({ ...prev, progress: count }));
        setStats(prev => ({
          ...prev,
          requests: prev.requests + 1,
          totalTokens: prev.totalTokens + tokens,
          translatedBlocks: prev.translatedBlocks + newlyTranslated
        }));
      });
      setBlocks(translated);
      setStatus(prev => ({ ...prev, isTranslating: false }));
    } catch (err: any) {
      const msg = err.message?.includes('429') 
        ? "Quá giới hạn yêu cầu (Rate Limit). Vui lòng đợi một lát." 
        : "Dịch thuật thất bại. " + (err.message || "");
      setStatus(prev => ({ 
        ...prev, 
        isTranslating: false, 
        error: msg 
      }));
    }
  };

  const downloadSRT = () => {
    const content = stringifySRT(blocks);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `[Translated]_${fileName}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearAll = () => {
    setBlocks([]);
    setFileName('');
    setAnalysis(null);
    setTitleInput('');
    setStatus(prev => ({
      ...prev,
      isTranslating: false,
      isAnalyzing: false,
      progress: 0,
      total: 0,
      error: null,
    }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const progressPercentage = status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0;

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
                Donghua AI Subtitle
              </h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Hệ thống dịch thuật tối thượng</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
             {/* API Status Widget */}
             <div className="hidden sm:flex items-center gap-4 px-4 py-1.5 bg-slate-800/50 border border-slate-700 rounded-full">
               <div className="flex items-center gap-2 border-r border-slate-700 pr-4">
                 <div className={`w-2 h-2 rounded-full ${
                   status.apiStatus === 'valid' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                   status.apiStatus === 'invalid' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
                   'bg-slate-500 animate-pulse'
                 }`} />
                 <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                   {status.apiStatus === 'valid' ? 'API Active' : 
                    status.apiStatus === 'invalid' ? 'API Error' : 'Checking API'}
                 </span>
               </div>
               <div className="flex items-center gap-4">
                 <div className="flex flex-col">
                   <span className="text-[8px] text-slate-500 font-bold uppercase">Tokens</span>
                   <span className="text-[10px] font-mono text-indigo-400">{(stats.totalTokens / 1000).toFixed(1)}k</span>
                 </div>
                 <div className="flex flex-col">
                   <span className="text-[8px] text-slate-500 font-bold uppercase">Requests</span>
                   <span className="text-[10px] font-mono text-indigo-400">{stats.requests}</span>
                 </div>
               </div>
             </div>

             {(blocks.length > 0 || analysis) && !status.isTranslating && (
               <button 
                onClick={clearAll}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-all text-sm font-medium"
               >
                 <Trash2 size={16} />
                 <span className="hidden md:inline">Xóa dữ liệu</span>
               </button>
             )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Input & Analysis (4/12) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* STEP 1 & 2: Title Analysis */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Search size={80} />
            </div>
            
            <h2 className="text-lg font-semibold mb-6 flex items-center gap-2 text-indigo-400">
              <div className="w-6 h-6 rounded bg-indigo-400/20 flex items-center justify-center text-xs font-bold text-indigo-400">1</div>
              Phân tích tiêu đề
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Dán tiêu đề tiếng Trung</label>
                <div className="relative">
                  <input 
                    type="text"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAnalyzeTitle();
                      }
                    }}
                    placeholder="Ví dụ: 凡人修仙传 / Thần Lan Kỳ Vực..."
                    disabled={status.isTranslating || status.isAnalyzing}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-4 pr-12 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                  />
                  <button 
                    onClick={handleAnalyzeTitle}
                    disabled={!titleInput || status.isAnalyzing || status.isTranslating}
                    className="absolute right-2 top-2 w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center hover:bg-indigo-500 transition-colors disabled:opacity-50"
                  >
                    {status.isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={18} />}
                  </button>
                </div>
              </div>

              {analysis && (
                <div className="mt-6 p-4 bg-slate-800/50 border border-slate-700 rounded-xl space-y-4 animate-in fade-in slide-in-from-top-2">
                  <div className="border-b border-slate-700 pb-2 flex items-center gap-2">
                     <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                     <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-400">🔍 Phân tích thành công</h3>
                  </div>
                  
                  <div className="space-y-3">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-bold">📌 Tiêu đề gốc (ZH)</span>
                      <p className="text-sm font-medium text-slate-200">{analysis.originalTitle}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-indigo-400 uppercase font-bold">🇻🇳 Tiêu đề dịch tiếng Việt</span>
                      <p className="text-sm font-bold text-indigo-400 leading-tight">{analysis.translatedTitle}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase font-bold">🎯 Thể loại</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {analysis.mainGenres.map(g => (
                            <span key={g} className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 rounded text-[9px] font-bold">{g}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase font-bold">🎭 Tông truyện</span>
                        <p className="text-[11px] text-slate-300 mt-1 font-medium">{analysis.tone}</p>
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-bold">🗣️ Phong cách dịch SRT</span>
                      <p className="text-[11px] text-slate-400 italic mt-0.5">{analysis.recommendedStyle}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* STEP 3: Subtitle Upload */}
          <section className={`bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl transition-all ${!analysis ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
            <h2 className="text-lg font-semibold mb-6 flex items-center gap-2 text-indigo-400">
              <div className="w-6 h-6 rounded bg-indigo-400/20 flex items-center justify-center text-xs font-bold text-indigo-400">2</div>
              Dịch file phụ đề
            </h2>

            {!fileName ? (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-500/5 transition-all group"
              >
                <Upload className="text-slate-500 group-hover:text-indigo-400 mb-2 transition-colors" size={32} />
                <p className="text-sm text-slate-300 font-medium">Chọn file .SRT</p>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  accept=".srt" 
                  className="hidden" 
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
                  <FileText className="text-indigo-400 shrink-0" size={24} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{fileName}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold">{blocks.length} dòng</p>
                  </div>
                </div>

                {!status.isTranslating && !blocks.some(b => b.translatedText) && (
                  <button 
                    onClick={startTranslation}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
                  >
                    <Play size={18} fill="currentColor" />
                    Bắt đầu dịch
                  </button>
                )}

                {status.isTranslating && (
                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <div className="flex items-center gap-2 text-indigo-400">
                        <Loader2 className="animate-spin" size={16} />
                        <span className="text-xs font-bold uppercase tracking-wider">Đang dịch...</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">{status.progress}/{status.total}</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-indigo-500 transition-all duration-300 shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                        style={{ width: `${progressPercentage}%` }}
                      />
                    </div>
                  </div>
                )}

                {!status.isTranslating && blocks.some(b => b.translatedText) && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-widest justify-center">
                      <CheckCircle2 size={16} />
                      Hoàn thành
                    </div>
                    <button 
                      onClick={downloadSRT}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
                    >
                      <Download size={18} />
                      Tải file về
                    </button>
                  </div>
                )}
              </div>
            )}

            {status.error && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3 text-red-400">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed font-medium">{status.error}</p>
              </div>
            )}
          </section>

          {/* Session Summary Statistics */}
          <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 shadow-xl">
             <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="text-slate-500" size={14} />
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Thống kê phiên làm việc</h3>
             </div>
             <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800/50">
                   <div className="text-[8px] text-slate-500 uppercase font-bold mb-1">Dòng dịch</div>
                   <div className="text-sm font-mono text-indigo-400">{stats.translatedBlocks}</div>
                </div>
                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800/50">
                   <div className="text-[8px] text-slate-500 uppercase font-bold mb-1">Dung lượng</div>
                   <div className="text-sm font-mono text-indigo-400">{(stats.totalTokens / 1000).toFixed(1)}k</div>
                </div>
                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800/50">
                   <div className="text-[8px] text-slate-500 uppercase font-bold mb-1">Truy vấn</div>
                   <div className="text-sm font-mono text-indigo-400">{stats.requests}</div>
                </div>
             </div>
             <div className="mt-3 flex items-center gap-2 text-[8px] text-slate-600">
                <Activity size={10} />
                <span>Số liệu được tính toán dựa trên phản hồi từ AI.</span>
             </div>
          </section>
        </div>

        {/* Right Column: Preview (8/12) */}
        <div className="lg:col-span-8 h-[calc(100vh-10rem)] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-2xl relative">
          <div className="p-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm flex items-center justify-between sticky top-0 z-10">
            <h3 className="font-bold text-slate-400 text-xs uppercase tracking-widest flex items-center gap-2">
              <FileText size={14} />
              Nội dung xem trước
            </h3>
            <div className="flex items-center gap-4">
               <div className="flex items-center gap-1.5 text-slate-600">
                 <Cpu size={12} />
                 <span className="text-[10px] font-bold">GEMINI 3 FLASH</span>
               </div>
               <div className="flex gap-2">
                 <div className="w-3 h-3 rounded-full bg-slate-800" />
                 <div className="w-3 h-3 rounded-full bg-slate-800" />
                 <div className="w-3 h-3 rounded-full bg-slate-800" />
               </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            {blocks.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-700 opacity-40">
                <Sparkles size={64} className="mb-4" />
                <p className="text-sm font-medium">Hoàn thành các bước bên trái để bắt đầu</p>
              </div>
            ) : (
              blocks.map((block) => (
                <div 
                  key={block.index} 
                  className={`grid grid-cols-1 md:grid-cols-2 gap-0 md:gap-4 rounded-xl border transition-all duration-500 overflow-hidden ${
                    block.translatedText 
                      ? 'border-indigo-500/30 bg-indigo-500/5' 
                      : 'border-slate-800 bg-slate-900/40'
                  }`}
                >
                  {/* Original Text */}
                  <div className="p-4 bg-slate-800/20">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-mono font-bold text-slate-500">#{block.index}</span>
                      <span className="text-[10px] font-mono text-indigo-400/60">{block.timestamp}</span>
                    </div>
                    <p className="text-sm text-slate-400 leading-relaxed font-serif-vi">
                      {block.originalText}
                    </p>
                  </div>

                  {/* Translated Text */}
                  <div className={`p-4 ${block.translatedText ? 'bg-indigo-500/5' : 'bg-slate-900/20'} border-t md:border-t-0 md:border-l border-slate-800/50`}>
                    <div className="mb-2">
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Tiếng Việt</span>
                    </div>
                    {block.translatedText ? (
                      <p className="text-sm text-slate-100 font-serif-vi leading-relaxed font-medium animate-in fade-in duration-700">
                        {block.translatedText}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <div className="h-4 w-full bg-slate-800/50 rounded animate-pulse" />
                        <div className="h-4 w-2/3 bg-slate-800/50 rounded animate-pulse" />
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-900 p-4 text-center">
        <p className="text-slate-600 text-[10px] uppercase tracking-[0.2em] font-bold">
          Donghua AI Subtitle System • Chuyên biệt cho cộng đồng Tiên Hiệp & Huyền Huyễn
        </p>
      </footer>
    </div>
  );
};

export default App;

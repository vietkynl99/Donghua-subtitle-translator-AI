
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Play, CheckCircle2, AlertCircle, Loader2, Trash2, 
  FileText, Search, Sparkles, ChevronRight, Activity, Cpu, FileDown, 
  RefreshCw, Box, Tags, BookOpen, Target, FileSearch, Info, History,
  Clock, FastForward, Zap, Settings, Languages, BrainCircuit, Key, Save
} from 'lucide-react';
import { TitleAnalysis, SubtitleBlock, TranslationState, SessionStats, InterruptionInfo, AiProvider } from './types';
import { parseSRT, stringifySRT, extractChineseTitle, generateFileName, adjustSrtTiming } from './utils/srtParser';
import { translateSubtitles, analyzeTitle, checkApiHealth } from './services/aiService';

const AI_MODELS = [
  { id: 'gpt-4.1', name: 'gpt-4.1' },
  { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
  { id: 'gpt-4.1-mini', name: 'gpt-4.1-mini' },
  { id: 'Gemini 2.5 Pro', name: 'Gemini 2.5 Pro' },
  { id: 'Gemini 2.5 Flash', name: 'Gemini 2.5 Flash' },
];

const SPEED_PRESETS = [0.7, 0.8, 0.9, 1.1, 1.2, 1.3];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'translator' | 'speed-editor'>('translator');
  const [blocks, setBlocks] = useState<SubtitleBlock[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [detectedTitle, setDetectedTitle] = useState<string>('');
  const [analysis, setAnalysis] = useState<TitleAnalysis | null>(null);
  const [stats, setStats] = useState<SessionStats>({ requests: 0, totalTokens: 0, translatedBlocks: 0 });
  const [status, setStatus] = useState<TranslationState>({
    isTranslating: false, isAnalyzing: false, progress: 0, total: 0,
    error: null, interruption: null, fileStatus: null,
    apiStatus: 'checking', selectedModel: 'gpt-4o-mini',
    userApiKey: ''
  });

  const [speed, setSpeed] = useState<number>(1.0);

  // Kiểm tra sức khỏe API với debounce để tránh spam khi đang gõ phím
  useEffect(() => {
    const timer = setTimeout(async () => {
      setStatus(prev => ({ ...prev, apiStatus: 'checking' }));
      const isValid = await checkApiHealth(status.selectedModel, status.userApiKey);
      const isOpenAi = status.selectedModel.toLowerCase().includes('gpt');
      
      let finalStatus: 'valid' | 'invalid' | 'unknown' = 'unknown';
      if (isValid) {
        finalStatus = 'valid';
      } else if (status.userApiKey || isOpenAi) {
        finalStatus = 'invalid';
      }
      
      setStatus(prev => ({ ...prev, apiStatus: finalStatus }));
    }, 800);

    return () => clearTimeout(timer);
  }, [status.selectedModel, status.userApiKey]);

  const processFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.srt')) {
      setStatus(prev => ({ ...prev, error: "Chỉ chấp nhận file .SRT" }));
      return;
    }
    const title = extractChineseTitle(file.name);
    setDetectedTitle(title);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const parsed = parseSRT(content);
      const processedBlocks = parsed.map(block => {
        if (!/[\u4e00-\u9fa5]/.test(block.originalText)) {
          return { ...block, translatedText: block.originalText };
        }
        return block;
      });
      setBlocks(processedBlocks);
      setStatus(prev => ({ ...prev, total: processedBlocks.length, progress: processedBlocks.filter(b => b.translatedText).length, error: null }));
      
      // Tự động phân tích nếu đã có API Key hoặc là model có key hệ thống
      const isOpenAi = status.selectedModel.toLowerCase().includes('gpt');
      if (activeTab === 'translator') {
        if (isOpenAi && !status.userApiKey) {
          setStatus(prev => ({ ...prev, error: "Vui lòng nhập OpenAI API KEY trước khi upload file." }));
        } else {
          handleAnalyze(title);
        }
      }
    };
    reader.readAsText(file);
  };

  const handleAnalyze = async (title: string) => {
    if (!title.trim() || status.isAnalyzing) return;
    
    const isOpenAi = status.selectedModel.toLowerCase().includes('gpt');
    if (isOpenAi && !status.userApiKey) {
      setStatus(prev => ({ ...prev, error: "Thiếu API KEY cho model OpenAI." }));
      return;
    }

    setStatus(prev => ({ ...prev, isAnalyzing: true, error: null }));
    try {
      const { analysis: result, tokens } = await analyzeTitle(title, status.selectedModel, status.userApiKey);
      setAnalysis(result);
      setStats(prev => ({ ...prev, requests: prev.requests + 1, totalTokens: prev.totalTokens + tokens }));
    } catch (err: any) {
      console.error("[App] Lỗi phân tích tiêu đề:", err);
      setStatus(prev => ({ ...prev, error: err.message || `Lỗi khi dùng [${status.selectedModel}].` }));
    } finally {
      setStatus(prev => ({ ...prev, isAnalyzing: false }));
    }
  };

  const startTranslation = async () => {
    if (blocks.length === 0 || !analysis) return;
    setStatus(prev => ({ ...prev, isTranslating: true, error: null, interruption: null }));
    try {
      const translated = await translateSubtitles(blocks, analysis, status.selectedModel, (count, tokens) => {
        setStatus(prev => ({ ...prev, progress: count }));
        setStats(prev => ({ ...prev, totalTokens: prev.totalTokens + tokens }));
      }, status.userApiKey);
      setBlocks(translated);
      setStatus(prev => ({ ...prev, isTranslating: false, fileStatus: 'completed' }));
    } catch (err: any) {
      console.error("[App] Lỗi dịch thuật:", err);
      const currentTranslatedCount = blocks.filter(b => b.translatedText && !/[\u4e00-\u9fa5]/.test(b.translatedText)).length;
      setStatus(prev => ({ 
        ...prev, isTranslating: false, 
        error: err.message || `Lỗi không xác định khi dịch.`,
        interruption: { reason: err.message, total: prev.total, translated: currentTranslatedCount, remaining: prev.total - currentTranslatedCount }
      }));
    }
  };

  const downloadSRT = (isPartial = false) => {
    const content = stringifySRT(blocks);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const newName = generateFileName(fileName, !isPartial, activeTab === 'speed-editor' ? speed : undefined);
    const a = document.createElement('a');
    a.href = url;
    a.download = newName;
    a.click();
    setFileName(newName);
  };

  const progressPercentage = status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="text-white" size={24} />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Donghua AI Sub</h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Subtitle Intelligence System</p>
            </div>
          </div>
          
          <nav className="flex items-center bg-slate-800/50 p-1 rounded-xl border border-slate-700">
            <button onClick={() => setActiveTab('translator')} className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'translator' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}>
              <Languages size={14} /> Dịch AI
            </button>
            <button onClick={() => setActiveTab('speed-editor')} className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'speed-editor' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}>
              <Clock size={14} /> Chỉnh Tốc Độ
            </button>
          </nav>

          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${status.apiStatus === 'valid' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : status.apiStatus === 'checking' ? 'bg-amber-500 animate-pulse' : status.apiStatus === 'invalid' ? 'bg-red-500' : 'bg-slate-600'}`} />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">API STATUS</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-6">
          
          <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
            <h2 className="text-xs font-bold mb-6 flex items-center gap-2 text-indigo-400 uppercase tracking-widest">
              <Settings size={16} /> Cấu hình Model & API
            </h2>
            
            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  👉 Chọn Model AI
                </label>
                <div className="relative">
                  <select 
                    value={status.selectedModel}
                    onChange={(e) => setStatus(prev => ({ ...prev, selectedModel: e.target.value, error: null }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:border-indigo-500 appearance-none transition-all"
                  >
                    {AI_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                    <ChevronRight size={16} className="rotate-90" />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  👉 API KEY
                </label>
                <div className="relative">
                  <input 
                    type="password"
                    placeholder="Dán API Key vào đây (Model OpenAI bắt buộc nhập)..."
                    value={status.userApiKey}
                    onChange={(e) => setStatus(prev => ({ ...prev, userApiKey: e.target.value, error: null }))}
                    className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 transition-all pr-10"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                    <Key size={14} />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
            <h2 className="text-xs font-bold mb-4 flex items-center gap-2 text-indigo-400 uppercase tracking-widest">
               📁 Upload file SRT
            </h2>
            {!fileName ? (
              <div 
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if(f) processFile(f); }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer transition-all ${isDragging ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02]' : 'border-slate-700 hover:border-indigo-500 hover:bg-indigo-500/5'}`}
              >
                <Upload className="text-slate-500 mb-2" size={40} />
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest text-center">Bấm để chọn file hoặc kéo thả</p>
                <input type="file" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if(f) processFile(f); }} accept=".srt" className="hidden" />
              </div>
            ) : (
              <div className="p-4 bg-indigo-600/10 border border-indigo-500/30 rounded-2xl space-y-2 relative group">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">📂 FILE ĐANG XỬ LÝ:</span>
                <p className="text-sm font-bold text-white pl-2 break-all">{fileName}</p>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 pt-1 border-t border-indigo-500/10">
                  <FileText size={12} /> <span>{blocks.length} blocks detected</span>
                </div>
                <button onClick={() => { setFileName(''); setBlocks([]); setAnalysis(null); setStatus(prev => ({...prev, error: null, interruption: null, fileStatus: null})); }} className="absolute top-2 right-2 p-1 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </section>

          {activeTab === 'translator' && (
            <div className="space-y-6 animate-in slide-in-from-left-4 duration-500">
              <section className={`bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl transition-all ${!fileName ? 'opacity-30 pointer-events-none' : ''}`}>
                <h2 className="text-xs font-bold mb-6 flex items-center gap-2 text-indigo-400 uppercase tracking-widest">
                  <FileSearch size={16} /> Phân tích & Dịch thuật
                </h2>
                {status.isAnalyzing ? (
                  <div className="flex items-center justify-center py-8 gap-3 text-indigo-400">
                    <Loader2 className="animate-spin" size={20} />
                    <span className="text-xs font-bold uppercase tracking-widest">AI đang thẩm thấu...</span>
                  </div>
                ) : analysis ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-slate-800/40 border border-slate-700 rounded-2xl space-y-4 shadow-inner">
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">📌 TIÊU ĐỀ:</span>
                        <p className="text-sm font-bold text-indigo-400">{analysis.translatedTitle}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {analysis.mainGenres.map(g => <span key={g} className="px-2 py-0.5 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded text-[9px] font-bold">{g}</span>)}
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed italic border-l-2 border-indigo-500/30 pl-3">"{analysis.summary}"</p>
                    </div>
                    {!status.isTranslating && (
                      <button onClick={startTranslation} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-xl shadow-indigo-500/20 transition-all active:scale-[0.98]">
                        <Play size={20} fill="currentColor" /> Bắt đầu dịch AI ngay
                      </button>
                    )}
                  </div>
                ) : fileName && (
                   <button onClick={() => handleAnalyze(detectedTitle)} className="w-full py-3 bg-indigo-600/20 text-indigo-400 border border-indigo-600/30 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-600/30 transition-all">
                    Phân tích Tiêu đề
                  </button>
                )}

                {status.isTranslating && (
                  <div className="mt-4 space-y-3 p-5 bg-slate-800/30 rounded-2xl border border-slate-700/50">
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      <div className="flex items-center gap-2 text-indigo-400">
                        <Loader2 className="animate-spin" size={14} /> <span>Đang xử lý: {status.progress}/{status.total}</span>
                      </div>
                      <span>{progressPercentage}%</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-300" style={{ width: `${progressPercentage}%` }} />
                    </div>
                  </div>
                )}

                {status.fileStatus === 'completed' && (
                  <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl space-y-4">
                    <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                      <CheckCircle2 size={16} /> Hoàn tất xử lý với: {status.selectedModel}
                    </p>
                    <button onClick={() => downloadSRT()} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/20 transition-all">
                      <Download size={20} /> Tải file hoàn thiện (.SRT)
                    </button>
                  </div>
                )}

                {(status.error || status.interruption) && (
                   <div className="mt-4 p-4 bg-red-950/20 border border-red-500/30 rounded-2xl space-y-4">
                    <p className="text-xs font-bold text-red-400 uppercase tracking-widest flex items-center gap-2">
                      <AlertCircle size={16} /> Thông báo hệ thống:
                    </p>
                    
                    {status.interruption && (
                      <div className="space-y-2 text-[10px] text-slate-300">
                        <p>• Đã dịch: <span className="text-emerald-400 font-bold">{status.interruption.translated}</span> / {status.interruption.total} block</p>
                        <button onClick={() => downloadSRT(true)} className="w-full py-2 bg-red-600/20 text-red-400 border border-red-500/30 rounded-xl font-bold uppercase tracking-widest flex items-center justify-center gap-2 mt-2">
                          <FileDown size={14}/> Tải file dở dang (Partial)
                        </button>
                      </div>
                    )}

                    <p className="text-[10px] text-red-400/80 font-medium">{status.error}</p>
                    
                    <button onClick={startTranslation} className="w-full py-2 bg-slate-800 text-[10px] font-bold uppercase tracking-widest text-white rounded-xl border border-slate-700 hover:bg-slate-700 transition-all">
                      Thử lại hoặc kiểm tra Model/Key
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'speed-editor' && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
              <section className={`bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl transition-all ${!fileName ? 'opacity-30 pointer-events-none' : ''}`}>
                <h2 className="text-xs font-bold mb-6 flex items-center gap-2 text-indigo-400 uppercase tracking-widest">
                  <Clock size={16} /> Speed Editor
                </h2>
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">⏱️ Nhập tốc độ phụ đề (Playback speed):</label>
                    <div className="flex items-center gap-4">
                      <input type="number" step="0.01" min="0.1" value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value) || 1.0)} className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-lg font-bold text-white focus:outline-none" />
                      <div className="w-12 h-12 bg-indigo-600/20 border border-indigo-500/30 rounded-xl flex items-center justify-center font-bold text-indigo-400">x</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {SPEED_PRESETS.map(val => (
                      <button key={val} onClick={() => setSpeed(val)} className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${Math.abs(speed - val) < 0.001 ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>[ {val.toFixed(1)} ]</button>
                    ))}
                  </div>
                  <button onClick={() => downloadSRT(false)} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-500/20">
                    👉 Áp dụng tốc độ & tải file mới
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="lg:col-span-7 h-[calc(100vh-10rem)] bg-slate-900 border border-slate-800 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
          <div className="p-6 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
            <h3 className="font-bold text-slate-400 text-[10px] uppercase tracking-[0.3em] flex items-center gap-3">
              <Activity size={18} className="text-indigo-500" /> Monitor Thực tế
            </h3>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl">
              <Cpu size={14} className="text-indigo-400" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{status.selectedModel}</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-700">
            {blocks.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-800 opacity-20">
                <Box size={100} strokeWidth={0.5} className="mb-6 animate-pulse" />
                <p className="text-base font-bold uppercase tracking-[0.4em]">Đang chờ tệp SRT...</p>
              </div>
            ) : (
              blocks.slice(0, 100).map((block) => {
                const isTranslated = !!block.translatedText && !/[\u4e00-\u9fa5]/.test(block.originalText);
                return (
                  <div key={block.index} className={`grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-3xl border transition-all duration-500 ${isTranslated ? 'border-emerald-500/20 bg-emerald-500/5 shadow-inner' : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'}`}>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-[10px] font-mono font-bold text-slate-500">
                        <span className="bg-slate-800 px-2 py-0.5 rounded-lg text-indigo-400 border border-slate-700/50">#{block.index}</span>
                        <span className="opacity-50 font-mono">{block.timestamp}</span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed italic">{block.originalText}</p>
                    </div>
                    <div className="md:border-l border-slate-800 md:pl-8 space-y-3 flex flex-col justify-center">
                      <div className="flex justify-between items-center">
                         <span className={`text-[8px] uppercase font-bold tracking-widest ${isTranslated ? 'text-emerald-500' : 'text-slate-600'}`}>
                          {isTranslated ? 'Bản dịch tối ưu' : 'Đang chờ xử lý'}
                        </span>
                        {isTranslated && <CheckCircle2 size={12} className="text-emerald-500" />}
                      </div>
                      {block.translatedText ? (
                        <p className="text-[15px] text-slate-100 font-serif-vi font-bold leading-relaxed">{block.translatedText}</p>
                      ) : (
                        <div className="space-y-2"><div className="h-3 w-full bg-slate-800/50 rounded-full animate-pulse" /><div className="h-3 w-4/5 bg-slate-800/50 rounded-full animate-pulse delay-75" /></div>
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
        <p className="text-slate-700 text-[9px] uppercase tracking-[0.5em] font-bold">Donghua AI Subtitle System • v3.3 Minimal Edition</p>
      </footer>
    </div>
  );
};

export default App;

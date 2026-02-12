
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Play, CheckCircle2, AlertCircle, Loader2, Trash2, 
  FileText, Search, Sparkles, ChevronRight, Activity, Cpu, FileDown, 
  RefreshCw, Box, Tags, BookOpen, Target, FileSearch, Info, History,
  Clock, FastForward, Zap, Settings, Languages, BrainCircuit, Key, Save,
  Maximize2, Layers, CheckSquare, Square, PlusCircle, AlertTriangle,
  Brain, FileJson, FileUp, Sparkle, Scissors, ListChecks, XCircle, Gauge,
  ZapOff, Filter, BarChart3, MousePointer2
} from 'lucide-react';
import { TitleAnalysis, SubtitleBlock, TranslationState, SessionStats, InterruptionInfo, HybridOptimizeSuggestion, HybridOptimizeResult } from './types';
import { parseSRT, stringifySRT, extractChineseTitle, generateFileName, performQuickAnalyze, applyLocalFixesOnly } from './utils/srtParser';
import { translateSubtitles, analyzeTitle, checkApiHealth, optimizeHighCpsBatch } from './services/aiService';

const AI_MODELS = [
  { id: 'Gemini 2.5 Flash', name: 'Gemini 2.5 Flash' },
  { id: 'Gemini 2.5 Pro', name: 'Gemini 2.5 Pro' },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'translator' | 'hybrid-optimize'>('translator');
  
  // States
  const [blocks, setBlocks] = useState<SubtitleBlock[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [analysis, setAnalysis] = useState<TitleAnalysis | null>(null);
  const [stats, setStats] = useState<SessionStats>({ requests: 0, totalTokens: 0, translatedBlocks: 0 });
  const [status, setStatus] = useState<TranslationState>({
    isTranslating: false, isAnalyzing: false, progress: 0, total: 0,
    error: null, interruption: null, fileStatus: null,
    apiStatus: 'checking', selectedModel: 'Gemini 2.5 Flash'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Hybrid Optimize States
  const [aiRequiredList, setAiRequiredList] = useState<HybridOptimizeSuggestion[]>([]);
  const [isQuickAnalyzing, setIsQuickAnalyzing] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [optimizeStep, setOptimizeStep] = useState<1 | 2>(1);
  const [aiProgress, setAiProgress] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    checkApiHealth(status.selectedModel).then(valid => setStatus(prev => ({ ...prev, apiStatus: valid ? 'valid' : 'invalid' })));
  }, [status.selectedModel]);

  const processFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.srt')) {
      alert("Chỉ chấp nhận file .SRT");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseSRT(e.target?.result as string);
      setBlocks(parsed);
      setStatus(prev => ({ ...prev, total: parsed.length, progress: 0, fileStatus: 'new' }));
      if (activeTab === 'translator') handleAnalyze(extractChineseTitle(file.name));
      setOptimizeStep(1);
      setAiRequiredList([]);
    };
    reader.readAsText(file);
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
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleAnalyze = async (title: string) => {
    setStatus(prev => ({ ...prev, isAnalyzing: true }));
    try {
      const { analysis: result, tokens } = await analyzeTitle(title, status.selectedModel);
      setAnalysis(result);
      setStats(prev => ({ ...prev, totalTokens: prev.totalTokens + tokens }));
    } catch (err) {
      console.error(err);
    } finally {
      setStatus(prev => ({ ...prev, isAnalyzing: false }));
    }
  };

  const startTranslation = async () => {
    if (!analysis) return;
    setStatus(prev => ({ ...prev, isTranslating: true }));
    try {
      const translated = await translateSubtitles(blocks, analysis, status.selectedModel, (count, tokens) => {
        setStatus(prev => ({ ...prev, progress: count }));
        setStats(prev => ({ ...prev, totalTokens: prev.totalTokens + tokens }));
      });
      setBlocks(translated);
      setStatus(prev => ({ ...prev, isTranslating: false, fileStatus: 'completed' }));
    } catch (err) {
      console.error(err);
      setStatus(prev => ({ ...prev, isTranslating: false, error: 'Translation failed' }));
    }
  };

  const downloadSRT = (optimized = false) => {
    if (blocks.length === 0) return;
    const content = stringifySRT(blocks);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generateFileName(fileName, true, undefined, optimized);
    a.click();
    URL.revokeObjectURL(url);
  };

  // HYBRID OPTIMIZE TAB LOGIC
  const runQuickAnalyze = () => {
    if (blocks.length === 0) return;
    setIsQuickAnalyzing(true);
    setTimeout(() => {
      // Step 1: Internal math analysis & automatic local fix calculation
      const result: HybridOptimizeResult = performQuickAnalyze(blocks);
      setAiRequiredList(result.aiRequiredSegments);
      setIsQuickAnalyzing(false);
      setOptimizeStep(2);
    }, 600);
  };

  const applyOptimize = async () => {
    if (isAiProcessing) return;
    
    setIsAiProcessing(true);
    setAiProgress(0);
    abortControllerRef.current = new AbortController();

    try {
      // 1. Apply Local Fixes (20-30 CPS) immediately to the main blocks state
      const updatedWithLocal = applyLocalFixesOnly(blocks);
      setBlocks(updatedWithLocal);

      // 2. Process AI Required List (>30 CPS) in batches
      if (aiRequiredList.length > 0) {
        const BATCH_SIZE = 4;
        const total = aiRequiredList.length;
        
        for (let i = 0; i < total; i += BATCH_SIZE) {
          if (abortControllerRef.current?.signal.aborted) break;

          const batch = aiRequiredList.slice(i, i + BATCH_SIZE);
          batch.forEach(s => s.status = 'processing');
          setAiRequiredList([...aiRequiredList]);

          const results = await optimizeHighCpsBatch(batch, updatedWithLocal, status.selectedModel);
          
          setBlocks(prev => {
            const next = [...prev];
            results.forEach(res => {
              const idx = next.findIndex(b => b.index === res.id);
              if (idx !== -1) {
                next[idx].translatedText = res.afterText;
                next[idx].timestamp = res.afterTimestamp;
              }
            });
            return next;
          });

          // Update the list UI
          setAiRequiredList(prev => prev.map(s => {
            const res = results.find(r => r.id === s.index);
            return res ? { ...s, status: 'applied', afterText: res.afterText, afterTimestamp: res.afterTimestamp } : s;
          }));

          setAiProgress(Math.min(i + BATCH_SIZE, total));
        }
      }

      if (!abortControllerRef.current?.signal.aborted) {
        alert("Đã hoàn tất tối ưu hóa toàn bộ file!");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsAiProcessing(false);
    }
  };

  const cancelOptimize = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsAiProcessing(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <Sparkles className="text-white" size={20} />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent tracking-tight">Donghua AI Sub</h1>
          </div>
          <nav className="flex items-center bg-slate-800/50 p-1 rounded-2xl border border-slate-700/50">
            <button onClick={() => setActiveTab('translator')} className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'translator' ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20' : 'text-slate-400 hover:text-slate-200'}`}>Dịch SRT</button>
            <button onClick={() => setActiveTab('hybrid-optimize')} className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'hybrid-optimize' ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20' : 'text-slate-400 hover:text-slate-200'}`}>🔥 Optimize</button>
          </nav>
          <div className="hidden md:flex items-center gap-3 bg-slate-900 px-4 py-2 rounded-2xl border border-slate-800">
            <div className={`w-2 h-2 rounded-full ${status.apiStatus === 'valid' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{status.selectedModel}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 overflow-hidden flex flex-col">
        {activeTab === 'translator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-500 h-full overflow-hidden">
            <div className="lg:col-span-5 space-y-6 overflow-y-auto custom-scrollbar pr-2">
              <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                {!fileName ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()} 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${
                      isDragging 
                      ? 'border-indigo-400 bg-indigo-500/10 scale-[1.01] shadow-2xl' 
                      : 'border-slate-700 hover:border-indigo-500 hover:bg-indigo-500/5'
                    }`}
                  >
                    <div className={`p-5 rounded-3xl bg-slate-800 mb-5 transition-transform duration-300 ${isDragging ? 'scale-110 -translate-y-2' : ''}`}>
                      <Upload className={isDragging ? 'text-indigo-400' : 'text-slate-500'} size={48} />
                    </div>
                    <p className="text-sm font-bold text-slate-300 uppercase tracking-widest text-center">
                      {isDragging ? 'Thả để tải lên!' : 'Kéo thả file SRT'}
                    </p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase mt-2 tracking-tighter">Hoặc click để duyệt file</p>
                    <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} accept=".srt" className="hidden" />
                  </div>
                ) : (
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl flex justify-between items-center animate-in zoom-in-95 duration-300">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                        <FileText className="text-indigo-400" size={20} />
                      </div>
                      <div>
                        <p className="text-sm font-bold truncate max-w-[200px]">{fileName}</p>
                        <p className="text-[10px] text-slate-600 font-mono">{blocks.length} lines</p>
                      </div>
                    </div>
                    <button onClick={() => {setFileName(''); setBlocks([]); setAnalysis(null);}} className="p-2.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all"><Trash2 size={20} /></button>
                  </div>
                )}
                {analysis && (
                  <div className="mt-6 space-y-4 animate-in slide-in-from-top-4 duration-500">
                    <div className="p-5 bg-slate-800/40 rounded-3xl border border-slate-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkle className="text-amber-400" size={16} />
                        <p className="text-sm font-bold text-indigo-400">{analysis.translatedTitle}</p>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 line-clamp-3 leading-relaxed">{analysis.summary}</p>
                      <div className="flex flex-wrap gap-1.5 mt-4">
                        {analysis.mainGenres.slice(0, 4).map(g => (
                          <span key={g} className="px-2.5 py-1 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded-lg text-[9px] font-bold uppercase">{g}</span>
                        ))}
                      </div>
                    </div>
                    
                    {!status.isTranslating && !status.fileStatus?.includes('completed') ? (
                       <button onClick={startTranslation} className="w-full bg-indigo-600 hover:bg-indigo-700 py-4 rounded-2xl font-bold flex items-center justify-center gap-3 shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98]">
                          <Brain size={22} /> Bắt đầu dịch AI
                       </button>
                    ) : status.isTranslating ? (
                      <div className="space-y-4 p-5 bg-slate-800/50 rounded-3xl border border-slate-700">
                        <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={14}/> Processing...</span>
                          <span>{Math.round((status.progress / (status.total || 1)) * 100)}%</span>
                        </div>
                        <div className="h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                          <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-all duration-700" style={{ width: `${(status.progress / (status.total || 1)) * 100}%` }} />
                        </div>
                      </div>
                    ) : null}

                    {status.fileStatus === 'completed' && (
                      <button onClick={() => downloadSRT()} className="w-full bg-emerald-600 hover:bg-emerald-700 py-4 rounded-2xl font-bold flex items-center justify-center gap-3 shadow-xl shadow-emerald-600/20 transition-all active:scale-[0.98]">
                        <Download size={22} /> Tải file đã dịch
                      </button>
                    )}
                  </div>
                )}
              </section>

              <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                 <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-5 flex items-center gap-2">
                   <Settings size={14} /> AI Engine Selection
                 </h2>
                 <div className="relative">
                    <select 
                      value={status.selectedModel} 
                      onChange={(e) => setStatus(prev => ({ ...prev, selectedModel: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-3.5 text-xs font-bold appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all"
                    >
                      {AI_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 rotate-90 text-slate-600 pointer-events-none" size={18} />
                 </div>
              </section>
            </div>

            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-[2.5rem] flex flex-col h-full shadow-2xl overflow-hidden">
              <div className="p-5 border-b border-slate-800 flex justify-between items-center px-10 bg-slate-900/90 backdrop-blur-xl z-10">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">Subtitle Monitor</span>
                <div className="flex gap-4">
                  <span className="text-[9px] font-bold text-indigo-400 uppercase px-3 py-1 bg-indigo-500/10 rounded-lg border border-indigo-500/20">ZH → VI</span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-5 custom-scrollbar bg-slate-950/20">
                {blocks.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-10 text-slate-400">
                    <Box size={100} strokeWidth={0.5} />
                    <p className="text-sm font-bold uppercase tracking-widest mt-4">Waiting for file...</p>
                  </div>
                ) : (
                  blocks.slice(0, 150).map(b => (
                    <div key={b.index} className="group p-5 bg-slate-900/30 rounded-3xl border border-slate-800/50 hover:border-indigo-500/30 transition-all duration-300">
                      <div className="flex justify-between mb-3">
                        <span className="text-[10px] font-mono text-slate-600 group-hover:text-indigo-400 transition-colors">#{b.index.toString().padStart(3, '0')} — {b.timestamp}</span>
                      </div>
                      <p className="text-xs text-slate-500 italic mb-2.5 leading-relaxed">{b.originalText}</p>
                      <div className="pl-4 border-l-2 border-indigo-500/20 py-1">
                        <p className="text-sm font-bold text-slate-100 font-serif-vi leading-relaxed">
                          {b.translatedText || <span className="text-slate-800 animate-pulse">Pending...</span>}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                {blocks.length > 150 && (
                  <div className="p-6 text-center">
                    <p className="text-[10px] font-bold text-slate-700 uppercase tracking-widest italic">... showing 150 / {blocks.length} segments ...</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'hybrid-optimize' && (
          <div className="space-y-6 animate-in fade-in duration-500 flex-1 overflow-y-auto custom-scrollbar">
            {blocks.length === 0 ? (
               <section className="bg-slate-900 border border-slate-800 rounded-[3rem] p-16 text-center max-w-3xl mx-auto shadow-2xl my-12">
                  <div 
                    onClick={() => fileInputRef.current?.click()} 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-[2.5rem] p-20 flex flex-col items-center justify-center cursor-pointer transition-all duration-500 ${
                      isDragging 
                      ? 'border-indigo-400 bg-indigo-500/10 scale-[1.02]' 
                      : 'border-slate-700 hover:border-indigo-500'
                    }`}
                  >
                    <div className="w-24 h-24 bg-indigo-600/10 rounded-[2rem] flex items-center justify-center mb-8 border border-indigo-500/20 shadow-inner">
                      <Zap className="text-indigo-400" size={48} />
                    </div>
                    <h2 className="text-3xl font-bold mb-4 tracking-tight">Hybrid Optimizer</h2>
                    <p className="text-slate-400 text-sm mb-10 leading-relaxed max-w-md mx-auto">
                      Hệ thống tự động xử lý CPS bằng toán học (20-30) và dùng AI cho các ca khó (&gt;30). <br/>
                      Vui lòng kéo thả file vào đây để bắt đầu.
                    </p>
                    <div className="flex items-center gap-3 bg-indigo-600 px-10 py-5 rounded-2xl font-bold text-white shadow-2xl shadow-indigo-600/30 hover:bg-indigo-700 transition-all transform active:scale-95">
                      <MousePointer2 size={24} /> Chọn file SRT
                    </div>
                    <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} accept=".srt" className="hidden" />
                  </div>
               </section>
            ) : optimizeStep === 1 ? (
              <section className="bg-slate-900 border border-slate-800 rounded-[3rem] p-16 text-center max-w-3xl mx-auto shadow-2xl my-12 animate-in zoom-in-95">
                <div className="w-24 h-24 bg-indigo-600/10 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-indigo-500/20">
                  <Gauge className="text-indigo-400" size={48} />
                </div>
                <h2 className="text-3xl font-bold mb-5 tracking-tight">Sẵn sàng phân tích {fileName}</h2>
                <p className="text-slate-400 text-sm mb-10 leading-relaxed max-w-lg mx-auto">
                  Sử dụng Fast QC để tự động sửa lỗi timing nhẹ và AI QC để rút gọn nội dung các câu quá dài.
                </p>
                <div className="flex gap-4 justify-center">
                  <button onClick={runQuickAnalyze} disabled={isQuickAnalyzing} className="px-12 py-5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-2xl shadow-indigo-600/20">
                    {isQuickAnalyzing ? <Loader2 className="animate-spin" /> : <BarChart3 size={24} />} 
                    {isQuickAnalyzing ? 'Phân tích nhanh...' : 'Bắt đầu Quick Analyze'}
                  </button>
                  <button onClick={() => {setFileName(''); setBlocks([]);}} className="px-8 py-5 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold rounded-2xl transition-all">Thay đổi file</button>
                </div>
              </section>
            ) : (
              <div className="space-y-8 animate-in slide-in-from-bottom-6 duration-500 max-w-5xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-900/50 backdrop-blur-md p-8 rounded-[2.5rem] border border-slate-800 text-center shadow-lg group hover:border-indigo-500/20 transition-all">
                    <p className="text-[11px] text-slate-500 uppercase font-bold mb-2 tracking-[0.2em] group-hover:text-indigo-400">AI Required segments</p>
                    <p className="text-4xl font-black tracking-tighter text-red-500">{aiRequiredList.length}</p>
                    <p className="text-[10px] text-slate-600 mt-2 italic">(Tốc độ đọc &gt; 30 CPS)</p>
                  </div>
                  <div className="bg-slate-900/50 backdrop-blur-md p-8 rounded-[2.5rem] border border-slate-800 text-center shadow-lg">
                    <div className="flex flex-col h-full justify-center">
                      <p className="text-slate-400 text-xs mb-6">Local fixes sẽ được tự động áp dụng khi bấm nút xử lý AI bên dưới.</p>
                      <div className="flex gap-3 justify-center">
                         {!isAiProcessing ? (
                            <button onClick={applyOptimize} className="flex-1 px-8 py-5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl flex items-center justify-center gap-3 shadow-2xl shadow-red-600/20 transition-all transform active:scale-95">
                               <Brain size={24} /> APPLY AI OPTIMIZE
                            </button>
                         ) : (
                            <button onClick={cancelOptimize} className="flex-1 px-8 py-5 bg-slate-800 hover:bg-red-500/10 text-red-400 font-bold rounded-2xl border border-red-500/30 flex items-center justify-center gap-3">
                               <XCircle size={22} /> Cancel Optimize
                            </button>
                         )}
                      </div>
                    </div>
                  </div>
                </div>

                {isAiProcessing && (
                  <div className="bg-slate-900/80 p-6 rounded-3xl border border-red-500/20 animate-pulse shadow-2xl shadow-red-500/5">
                    <div className="flex justify-between items-center mb-4 px-2">
                       <p className="text-xs font-bold text-red-400 uppercase tracking-widest flex items-center gap-2">
                         <Activity size={16} /> Processing AI {aiProgress} / {aiRequiredList.length} segments...
                       </p>
                       <span className="text-xs font-mono font-bold text-red-400">{Math.round((aiProgress / aiRequiredList.length) * 100)}%</span>
                    </div>
                    <div className="h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div className="h-full bg-gradient-to-r from-red-500 to-amber-500 transition-all duration-1000 ease-out" style={{ width: `${(aiProgress / aiRequiredList.length) * 100}%` }} />
                    </div>
                  </div>
                )}

                <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] overflow-hidden shadow-2xl">
                   <div className="p-8 border-b border-slate-800 flex justify-between items-center bg-slate-900/90 backdrop-blur-xl">
                     <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-3">
                       <ListChecks size={20}/> Review AI Optimization list
                     </h3>
                     <button onClick={() => downloadSRT(true)} className="px-6 py-2.5 bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600/20 border border-emerald-600/20 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-2">
                       <Download size={16}/> Tải bản Optimized
                     </button>
                   </div>
                   <div className="p-8 max-h-[700px] overflow-y-auto space-y-6 custom-scrollbar bg-slate-950/20">
                     {aiRequiredList.length === 0 ? (
                       <div className="py-24 text-center space-y-5 opacity-40">
                         <CheckCircle2 size={80} className="mx-auto text-emerald-500" strokeWidth={0.5} />
                         <p className="text-sm font-bold uppercase tracking-[0.4em]">Tất cả đều đạt chuẩn (CPS &lt; 30)</p>
                       </div>
                     ) : aiRequiredList.map(s => (
                       <div key={s.id} className={`group p-6 rounded-[2rem] border transition-all duration-500 ${
                         s.status === 'applied' 
                         ? 'bg-emerald-500/5 border-emerald-500/20' 
                         : s.status === 'processing'
                         ? 'bg-indigo-500/5 border-indigo-500/40 animate-pulse'
                         : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                       }`}>
                         <div className="flex justify-between items-center mb-5">
                           <div className="flex items-center gap-4">
                             <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${s.cps > 40 ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                               <Zap size={20} />
                             </div>
                             <div>
                               <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Segment #{s.index}</p>
                               <span className={`text-[11px] font-black ${s.cps > 40 ? 'text-red-500' : 'text-amber-400'}`}>{s.cps.toFixed(1)} CPS</span>
                             </div>
                           </div>
                           {s.status === 'applied' ? (
                             <span className="flex items-center gap-2 px-4 py-1.5 bg-emerald-500/10 text-emerald-400 rounded-full text-[10px] font-bold uppercase border border-emerald-500/20">
                               <CheckCircle2 size={14} /> Optimized
                             </span>
                           ) : s.status === 'processing' ? (
                             <span className="flex items-center gap-2 px-4 py-1.5 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-bold uppercase border border-indigo-500/20">
                               <Loader2 size={14} className="animate-spin" /> Working...
                             </span>
                           ) : (
                             <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest px-4 py-1.5 bg-slate-800 rounded-full">Pending AI</span>
                           )}
                         </div>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                           <div className="space-y-3">
                             <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest pl-2">Hiện tại:</p>
                             <div className="p-5 bg-slate-950/80 rounded-2xl border border-slate-800/80">
                               <p className="text-[10px] font-mono text-slate-500 mb-3">{s.beforeTimestamp}</p>
                               <p className="text-xs text-slate-400 leading-relaxed font-serif-vi">{s.beforeText}</p>
                             </div>
                           </div>
                           <div className="space-y-3">
                             <p className="text-[10px] text-red-500 uppercase font-bold tracking-widest pl-2">AI Optimize:</p>
                             <div className={`p-5 rounded-2xl border transition-all duration-700 ${s.status === 'applied' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-950/40 border-slate-800'}`}>
                               <p className={`text-[10px] font-mono mb-3 ${s.afterText !== s.beforeText ? 'text-emerald-400 font-bold' : 'text-slate-600'}`}>{s.afterTimestamp}</p>
                               <p className={`text-xs leading-relaxed font-serif-vi ${s.afterText !== s.beforeText ? 'text-emerald-400 font-bold text-sm' : 'text-slate-500'}`}>
                                 {s.afterText !== s.beforeText ? s.afterText : <span className="opacity-30">... awaiting rewrite ...</span>}
                               </p>
                             </div>
                           </div>
                         </div>
                       </div>
                     ))}
                   </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="p-5 text-center border-t border-slate-900 bg-slate-950/90 z-20">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
           <p className="text-slate-700 text-[10px] uppercase tracking-[0.4em] font-bold">Donghua AI Subtitle Engine • v5.0 Hybrid Mode</p>
           <div className="flex gap-6 text-[9px] font-bold text-slate-600 uppercase tracking-widest">
              <span className="flex items-center gap-1.5"><ShieldCheck size={12}/> AI-Powered</span>
              <span className="flex items-center gap-1.5"><Zap size={12}/> Local Fast QC</span>
              <span className="flex items-center gap-1.5"><Activity size={12}/> Realtime monitoring</span>
           </div>
        </div>
      </footer>
    </div>
  );
};

// Add ShieldCheck icon since it wasn't imported
const ShieldCheck = ({size}: {size: number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>;

export default App;

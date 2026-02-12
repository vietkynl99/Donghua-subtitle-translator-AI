
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Play, CheckCircle2, AlertCircle, Loader2, Trash2, 
  FileText, Search, Sparkles, ChevronRight, Activity, Cpu, FileDown, 
  RefreshCw, Box, Tags, BookOpen, Target, FileSearch, Info, History,
  Clock, FastForward, Zap, Settings, Languages, BrainCircuit, Key, Save,
  Maximize2, Layers, CheckSquare, Square, PlusCircle, AlertTriangle,
  Brain, FileJson, FileUp, Sparkle, Scissors, ListChecks, XCircle, Gauge,
  ZapOff, Filter, BarChart3, MousePointer2, ShieldAlert
} from 'lucide-react';
import { TitleAnalysis, SubtitleBlock, TranslationState, SessionStats, InterruptionInfo, HybridOptimizeSuggestion, HybridOptimizeResult } from './types';
import { parseSRT, stringifySRT, extractChineseTitle, generateFileName, performQuickAnalyze, applyLocalFixesOnly } from './utils/srtParser';
import { translateSubtitles, analyzeTitle, checkApiHealth, optimizeHighCpsBatch } from './services/aiService';

const AI_MODELS = [
  { id: 'Gemini 3 Flash', name: 'Gemini 3 Flash' },
  { id: 'Gemini 3 Pro', name: 'Gemini 3 Pro' },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'translator' | 'hybrid-optimize'>('translator');
  
  // Translator States
  const [blocks, setBlocks] = useState<SubtitleBlock[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [analysis, setAnalysis] = useState<TitleAnalysis | null>(null);
  const [stats, setStats] = useState<SessionStats>({ requests: 0, totalTokens: 0, translatedBlocks: 0 });
  const [status, setStatus] = useState<TranslationState>({
    isTranslating: false, isAnalyzing: false, progress: 0, total: 0,
    error: null, interruption: null, fileStatus: null,
    apiStatus: 'checking', selectedModel: 'Gemini 3 Flash'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Hybrid Optimize States
  const [aiRequiredList, setAiRequiredList] = useState<HybridOptimizeSuggestion[]>([]);
  const [isQuickAnalyzing, setIsQuickAnalyzing] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [optimizeStep, setOptimizeStep] = useState<1 | 2>(1);
  const [aiProgress, setAiProgress] = useState(0);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [isCancelled, setIsCancelled] = useState(false);
  const cancelFlagRef = useRef(false);

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
      setOptimizeError(null);
      setIsCancelled(false);
      cancelFlagRef.current = false;
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
    setOptimizeError(null);
    setIsCancelled(false);
    cancelFlagRef.current = false;
    setTimeout(() => {
      const result: HybridOptimizeResult = performQuickAnalyze(blocks);
      setAiRequiredList(result.aiRequiredSegments);
      setIsQuickAnalyzing(false);
      setOptimizeStep(2);
    }, 800);
  };

  const applyOptimize = async () => {
    if (isAiProcessing) return;
    
    setIsAiProcessing(true);
    setAiProgress(0);
    setOptimizeError(null);
    setIsCancelled(false);
    cancelFlagRef.current = false;

    try {
      // 1. Transparently apply Local Fixes (20-40 CPS range)
      const updatedWithLocal = applyLocalFixesOnly(blocks);
      setBlocks(updatedWithLocal);

      // 2. Process AI required list (>40 CPS) in chunks for real-time update
      if (aiRequiredList.length > 0) {
        const BATCH_SIZE = 4;
        const total = aiRequiredList.length;
        
        for (let i = 0; i < total; i += BATCH_SIZE) {
          if (cancelFlagRef.current) {
            setIsCancelled(true);
            break;
          }

          const batch = aiRequiredList.slice(i, i + BATCH_SIZE);
          // Mark as processing immediately for UI feedback
          setAiRequiredList(prev => prev.map(s => 
            batch.some(b => b.index === s.index) ? { ...s, status: 'processing' } : s
          ));

          try {
            const results = await optimizeHighCpsBatch(batch, updatedWithLocal, status.selectedModel);
            
            // Apply immediately to the global blocks state for "Download Current File" support
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

            // Update local list with results and highlight time
            setAiRequiredList(prev => prev.map(s => {
              const res = results.find(r => r.id === s.index);
              return res ? { 
                ...s, 
                status: 'applied', 
                afterText: res.afterText, 
                afterTimestamp: res.afterTimestamp,
                appliedAt: Date.now()
              } : s;
            }));

            setAiProgress(Math.min(i + BATCH_SIZE, total));
            // Tiny delay to ensure UI cycles
            await new Promise(r => setTimeout(r, 100));
          } catch (batchErr: any) {
            console.error("Optimization Batch Error:", batchErr);
            const errMsg = batchErr.message || "Network Error / API Limit";
            setOptimizeError(errMsg);
            setAiRequiredList(prev => prev.map(s => 
              batch.some(b => b.index === s.index) ? { ...s, status: 'error', error: errMsg } : s
            ));
            break;
          }
        }
      }

      if (!cancelFlagRef.current && !optimizeError) {
        // Success notification is handled by UI state change
      }
    } catch (err: any) {
      console.error(err);
      setOptimizeError(err.message || "Failed to start optimization");
    } finally {
      setIsAiProcessing(false);
    }
  };

  const cancelOptimize = () => {
    cancelFlagRef.current = true;
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
                  <div className="mt-6 space-y-4">
                    <div className="p-5 bg-slate-800/40 rounded-3xl border border-slate-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkle className="text-amber-400" size={16} />
                        <p className="text-sm font-bold text-indigo-400">{analysis.translatedTitle}</p>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">{analysis.summary}</p>
                    </div>
                    
                    {!status.isTranslating && status.fileStatus !== 'completed' && (
                       <button onClick={startTranslation} className="w-full bg-indigo-600 hover:bg-indigo-700 py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.98]">
                          <Brain size={22} /> Bắt đầu dịch AI
                       </button>
                    )}
                    {status.isTranslating && (
                      <div className="space-y-4 p-5 bg-slate-800/50 rounded-3xl border border-slate-700">
                        <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={14}/> Processing...</span>
                          <span>{Math.round((status.progress / (status.total || 1)) * 100)}%</span>
                        </div>
                        <div className="h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                          <div className="h-full bg-indigo-500 transition-all duration-700" style={{ width: `${(status.progress / (status.total || 1)) * 100}%` }} />
                        </div>
                      </div>
                    )}
                    {status.fileStatus === 'completed' && (
                      <button onClick={() => downloadSRT()} className="w-full bg-emerald-600 hover:bg-emerald-700 py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all shadow-lg shadow-emerald-500/20">
                        <Download size={22} /> Tải file đã dịch
                      </button>
                    )}
                  </div>
                )}
              </section>
            </div>

            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-[2.5rem] flex flex-col h-full overflow-hidden shadow-2xl relative">
              <div className="p-5 border-b border-slate-800 flex justify-between items-center px-10 bg-slate-900/90 backdrop-blur-xl sticky top-0 z-10">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">Subtitle Monitor</span>
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-5 custom-scrollbar bg-slate-950/20">
                {blocks.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-10">
                    <Box size={100} strokeWidth={0.5} />
                    <p className="text-sm font-bold uppercase tracking-widest mt-4">Waiting for file...</p>
                  </div>
                ) : (
                  blocks.slice(0, 150).map(b => (
                    <div key={b.index} className="group p-5 bg-slate-900/30 rounded-3xl border border-slate-800/50 hover:border-indigo-500/30 transition-all duration-300">
                      <div className="flex justify-between mb-3 text-[10px] font-mono text-slate-600 group-hover:text-indigo-400">
                        <span>#{b.index.toString().padStart(3, '0')} — {b.timestamp}</span>
                      </div>
                      <p className="text-xs text-slate-500 italic mb-2.5 leading-relaxed">{b.originalText}</p>
                      <div className="pl-4 border-l-2 border-indigo-500/20">
                        <p className="text-sm font-bold text-slate-100 font-serif-vi">
                          {b.translatedText || <span className="text-slate-800">Pending...</span>}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'hybrid-optimize' && (
          <div className="space-y-6 animate-in fade-in duration-500 flex-1 overflow-y-auto custom-scrollbar">
            {blocks.length === 0 ? (
               <section className="bg-slate-900 border border-slate-800 rounded-[3rem] p-16 text-center max-w-3xl mx-auto shadow-2xl my-12 animate-in slide-in-from-bottom-10">
                  <div 
                    onClick={() => fileInputRef.current?.click()} 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className="border-2 border-dashed border-slate-700 rounded-[2.5rem] p-20 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 transition-all duration-500 group"
                  >
                    <div className="w-24 h-24 bg-indigo-600/10 rounded-[2rem] flex items-center justify-center mb-8 border border-indigo-500/20 group-hover:scale-110 transition-transform">
                      <Zap className="text-indigo-400" size={48} />
                    </div>
                    <h2 className="text-3xl font-bold mb-4 tracking-tight">Hybrid Optimizer</h2>
                    <p className="text-slate-400 text-sm mb-10 leading-relaxed max-w-md mx-auto">
                      Tối ưu hóa CPS thông minh: Toán học an toàn cho 20-40 CPS, AI chuyên sâu cho &gt;40 CPS.
                    </p>
                    <div className="flex items-center gap-3 bg-indigo-600 px-10 py-5 rounded-2xl font-bold text-white shadow-2xl shadow-indigo-600/30 hover:bg-indigo-700 transition-all active:scale-95">
                      <MousePointer2 size={24} /> Chọn file SRT
                    </div>
                  </div>
               </section>
            ) : optimizeStep === 1 ? (
              <section className="bg-slate-900 border border-slate-800 rounded-[3rem] p-16 text-center max-w-3xl mx-auto shadow-2xl my-12 animate-in zoom-in-95">
                <div className="w-24 h-24 bg-indigo-600/10 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-indigo-500/20 shadow-inner">
                  <Gauge className="text-indigo-400" size={48} />
                </div>
                <h2 className="text-3xl font-bold mb-5 tracking-tight">Quick Analyze {fileName}</h2>
                <p className="text-slate-400 text-sm mb-10 leading-relaxed max-w-lg mx-auto">
                  Smart Hybrid Mode: Auto math-fix for 20-40 CPS. AI-only for &gt;40 CPS errors.
                </p>
                <div className="flex gap-4 justify-center">
                  <button onClick={runQuickAnalyze} disabled={isQuickAnalyzing} className="px-12 py-5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-2xl flex items-center justify-center gap-3 shadow-2xl transition-all active:scale-95">
                    {isQuickAnalyzing ? <Loader2 className="animate-spin" /> : <BarChart3 size={24} />} 
                    {isQuickAnalyzing ? 'Analyzing...' : 'Start Quick Analyze'}
                  </button>
                </div>
              </section>
            ) : (
              <div className="space-y-8 max-w-5xl mx-auto pb-12 animate-in slide-in-from-bottom-4 duration-500">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-900/50 backdrop-blur-md p-8 rounded-[2.5rem] border border-slate-800 text-center shadow-lg hover:border-red-500/20 transition-all group relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                      <Brain size={64} />
                    </div>
                    <p className="text-[11px] text-slate-500 uppercase font-bold mb-2 tracking-[0.2em] group-hover:text-red-400 transition-colors">AI REQUIRED SEGMENTS</p>
                    <p className="text-5xl font-black text-red-500 tracking-tighter">{aiRequiredList.length}</p>
                    <p className="text-[10px] text-slate-600 mt-2 italic">(&gt; 40 CPS — Needs AI Contextual Rewrite)</p>
                  </div>
                  <div className="bg-slate-900/50 backdrop-blur-md p-8 rounded-[2.5rem] border border-slate-800 text-center shadow-lg hover:border-indigo-500/20 transition-all">
                    <div className="flex flex-col h-full justify-center">
                      <p className="text-slate-400 text-xs mb-8">Local math fixes (20-40 CPS) applied in realtime to working copy.</p>
                      <div className="flex gap-3 justify-center">
                         {!isAiProcessing ? (
                            <button onClick={applyOptimize} className="flex-1 px-8 py-5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl flex items-center justify-center gap-3 shadow-2xl shadow-red-600/30 transition-all active:scale-95">
                               <Brain size={24} /> APPLY AI OPTIMIZE
                            </button>
                         ) : (
                            <button onClick={cancelOptimize} className="flex-1 px-8 py-5 bg-slate-800 text-red-400 font-bold rounded-2xl border border-red-500/30 flex items-center justify-center gap-3 hover:bg-red-500/10 transition-all active:scale-95">
                               <XCircle size={22} /> Cancel Optimize
                            </button>
                         )}
                      </div>
                    </div>
                  </div>
                </div>

                {isAiProcessing && (
                  <div className="bg-slate-900/80 p-8 rounded-3xl border border-red-500/20 animate-pulse shadow-2xl shadow-red-500/5">
                    <div className="flex justify-between items-center mb-6 px-2">
                       <p className="text-xs font-bold text-red-400 uppercase tracking-[0.2em] flex items-center gap-3">
                         <Activity size={18} /> Processing {aiProgress} / {aiRequiredList.length} segments...
                       </p>
                       <span className="text-xs font-mono font-bold text-red-400">{Math.round((aiProgress / aiRequiredList.length) * 100)}%</span>
                    </div>
                    <div className="h-4 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div className="h-full bg-gradient-to-r from-red-600 via-orange-500 to-amber-400 transition-all duration-1000 ease-out" style={{ width: `${(aiProgress / aiRequiredList.length) * 100}%` }} />
                    </div>
                  </div>
                )}

                {(isCancelled || optimizeError) && (
                  <div className={`p-8 rounded-3xl border shadow-2xl flex items-start gap-5 animate-in slide-in-from-top-4 duration-500 ${optimizeError ? 'bg-red-500/10 border-red-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                    <div className={`p-4 rounded-2xl ${optimizeError ? 'bg-red-500/20 text-red-500' : 'bg-amber-500/20 text-amber-500'}`}>
                      {optimizeError ? <ShieldAlert size={28} /> : <XCircle size={28} />}
                    </div>
                    <div className="flex-1">
                      <p className={`font-black uppercase text-sm tracking-widest mb-2 ${optimizeError ? 'text-red-500' : 'text-amber-500'}`}>
                        {optimizeError ? '❌ AI Optimization Error' : '⛔ Optimization Cancelled'}
                      </p>
                      <p className="text-sm text-slate-300 leading-relaxed font-medium">
                        {optimizeError ? `Error: ${optimizeError}` : `Completed ${aiProgress} / ${aiRequiredList.length} segments successfully.`}
                      </p>
                      <p className="text-[10px] text-slate-500 uppercase mt-4 font-bold tracking-widest">You can still download the partially optimized file below.</p>
                    </div>
                  </div>
                )}

                <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] overflow-hidden shadow-2xl">
                   <div className="p-8 border-b border-slate-800 flex justify-between items-center bg-slate-900/90 backdrop-blur-xl sticky top-0 z-10">
                     <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-3">
                       <ListChecks size={22} className="text-indigo-400"/> Critical Review List (&gt;40 CPS)
                     </h3>
                     <div className="flex gap-4">
                       <button onClick={() => downloadSRT(true)} className="px-8 py-3 bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600/20 border border-emerald-600/20 rounded-2xl text-xs font-bold uppercase transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/5 active:scale-95">
                         <Download size={18}/> Download Current File
                       </button>
                       <button onClick={() => setOptimizeStep(1)} className="text-xs font-bold text-slate-500 hover:text-slate-300 uppercase transition-colors px-4 border-l border-slate-800 ml-2">Reset</button>
                     </div>
                   </div>
                   <div className="p-8 max-h-[700px] overflow-y-auto space-y-6 custom-scrollbar bg-slate-950/20">
                     {aiRequiredList.length === 0 ? (
                       <div className="py-32 text-center space-y-6 opacity-40">
                         <div className="w-24 h-24 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
                           <CheckCircle2 size={56} className="text-emerald-500" strokeWidth={1} />
                         </div>
                         <p className="text-sm font-bold uppercase tracking-[0.5em] text-emerald-400">All segments under 40 CPS</p>
                         <p className="text-xs text-slate-500 italic">No critical errors found in this file.</p>
                       </div>
                     ) : aiRequiredList.map(s => {
                       const isRecentlyApplied = s.appliedAt && (Date.now() - s.appliedAt < 2000);
                       return (
                         <div key={s.id} className={`group p-6 rounded-[2rem] border transition-all duration-700 ${
                           isRecentlyApplied
                           ? 'bg-indigo-500/20 border-indigo-400 shadow-2xl shadow-indigo-500/20 scale-[1.01]'
                           : s.status === 'applied' 
                           ? 'bg-emerald-500/5 border-emerald-500/20 shadow-lg shadow-emerald-500/5' 
                           : s.status === 'processing'
                           ? 'bg-indigo-500/10 border-indigo-500/40 animate-pulse'
                           : s.status === 'error'
                           ? 'bg-red-500/10 border-red-500/40'
                           : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                         }`}>
                           <div className="flex justify-between items-center mb-5">
                             <div className="flex items-center gap-4">
                               <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${s.cps > 50 ? 'bg-red-500/20 text-red-500 shadow-lg shadow-red-500/10' : 'bg-red-500/10 text-red-400'}`}>
                                 <Zap size={22} fill={s.cps > 50 ? "currentColor" : "none"} />
                               </div>
                               <div>
                                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Segment #{s.index}</p>
                                 <div className="flex items-center gap-2">
                                   <span className={`text-sm font-black ${s.cps > 50 ? 'text-red-500' : 'text-red-400'}`}>{s.cps.toFixed(1)} CPS</span>
                                   {s.cps > 60 && <span className="text-[8px] bg-red-500/20 text-red-500 px-1.5 py-0.5 rounded uppercase font-black tracking-tighter">Extreme</span>}
                                 </div>
                               </div>
                           </div>
                           <div className="flex items-center gap-3">
                             {s.status === 'applied' ? (
                               <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-2xl text-[10px] font-bold uppercase border border-emerald-500/20 shadow-sm animate-in zoom-in-50">
                                 <CheckCircle2 size={16} /> Optimized
                               </div>
                             ) : s.status === 'processing' ? (
                               <div className="flex items-center gap-2 px-4 py-2 bg-indigo-500/20 text-indigo-400 rounded-2xl text-[10px] font-bold uppercase border border-indigo-500/30">
                                 <Loader2 size={16} className="animate-spin" /> Live Rewriting...
                               </div>
                             ) : s.status === 'error' ? (
                               <div className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-500 rounded-2xl text-[10px] font-bold uppercase border border-red-500/30">
                                 <AlertTriangle size={16} /> Failed
                               </div>
                             ) : (
                               <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-4 py-2 bg-slate-800 rounded-2xl border border-slate-700 shadow-inner">Waiting AI</div>
                             )}
                           </div>
                         </div>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                           <div className="space-y-3">
                             <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest pl-3 flex items-center gap-2">
                               <Clock size={12}/> Original Timing:
                             </p>
                             <div className="p-6 bg-slate-950/80 rounded-[1.5rem] border border-slate-800/80 group-hover:bg-slate-950/50 transition-colors">
                               <p className="text-[10px] font-mono text-slate-600 mb-3">{s.beforeTimestamp}</p>
                               <p className="text-xs text-slate-400 leading-relaxed font-serif-vi italic">{s.beforeText}</p>
                             </div>
                           </div>
                           <div className="space-y-3">
                             <p className="text-[10px] text-emerald-500 uppercase font-bold tracking-widest pl-3 flex items-center gap-2">
                               <Sparkles size={12}/> AI Optimization:
                             </p>
                             <div className={`p-6 rounded-[1.5rem] border transition-all duration-1000 ${s.status === 'applied' ? 'bg-emerald-500/10 border-emerald-500/40 shadow-inner shadow-emerald-500/5' : 'bg-slate-950/30 border-slate-800'}`}>
                               <p className={`text-[10px] font-mono mb-3 ${s.afterTimestamp !== s.beforeTimestamp ? 'text-emerald-400 font-bold' : 'text-slate-600'}`}>{s.afterTimestamp}</p>
                               <div className={`text-sm leading-relaxed font-serif-vi ${s.status === 'applied' ? 'text-slate-100' : 'text-slate-500 opacity-30'}`}>
                                 {s.status === 'applied' ? s.afterText : <span className="animate-pulse">Awaiting AI analysis...</span>}
                               </div>
                             </div>
                           </div>
                         </div>
                         {s.status === 'error' && s.error && (
                           <p className="mt-4 px-4 py-2 bg-red-500/10 text-red-500 text-[10px] font-mono rounded-lg border border-red-500/20">{s.error}</p>
                         )}
                       </div>
                       );
                     })}
                   </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="p-6 text-center border-t border-slate-900 bg-slate-950/90 z-20 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
           <p className="text-slate-700 text-[10px] uppercase tracking-[0.4em] font-black">Donghua AI Engine • v5.3 Realtime Hybrid</p>
           <div className="flex gap-8 text-[9px] font-bold text-slate-600 uppercase tracking-widest">
              <span className="flex items-center gap-2 group hover:text-indigo-400 transition-colors cursor-default">
                <ShieldCheck size={14} className="text-indigo-500"/> AI Contextual Review
              </span>
              <span className="flex items-center gap-2 group hover:text-emerald-400 transition-colors cursor-default">
                <Zap size={14} className="text-emerald-500"/> Math Safety Logic
              </span>
           </div>
        </div>
      </footer>
    </div>
  );
};

const ShieldCheck = ({size, className}: {size: number, className?: string}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>
  </svg>
);

export default App;

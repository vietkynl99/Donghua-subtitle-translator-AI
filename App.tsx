
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Play, CheckCircle2, AlertCircle, Loader2, Trash2, 
  FileText, Search, Sparkles, ChevronRight, Activity, Cpu, FileDown, 
  RefreshCw, Box, Tags, BookOpen, Target, FileSearch, Info, History,
  Clock, FastForward, Zap, Settings, Languages, BrainCircuit, Key, Save,
  Maximize2, Layers, CheckSquare, Square, PlusCircle, AlertTriangle,
  Brain, FileJson, FileUp, Sparkle, Scissors, ListChecks, XCircle, Gauge,
  ZapOff, Filter, BarChart3, MousePointer2, ShieldAlert, CheckCircle,
  TrendingUp, Layers3
} from 'lucide-react';
import { TitleAnalysis, SubtitleBlock, TranslationState, SessionStats, InterruptionInfo, HybridOptimizeSuggestion, HybridOptimizeResult, OptimizeStats } from './types';
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
  const [optimizeStats, setOptimizeStats] = useState<OptimizeStats>({ total: 0, processed: 0, failed: 0, autoFixed: 0, ignored: 0 });
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [isCancelled, setIsCancelled] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
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
      setIsFinished(false);
      cancelFlagRef.current = false;
      setOptimizeStats({ total: 0, processed: 0, failed: 0, autoFixed: 0, ignored: 0 });
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0]; if (file) processFile(file);
  };

  const handleAnalyze = async (title: string) => {
    setStatus(prev => ({ ...prev, isAnalyzing: true }));
    try {
      const { analysis: result, tokens } = await analyzeTitle(title, status.selectedModel);
      setAnalysis(result);
      setStats(prev => ({ ...prev, totalTokens: prev.totalTokens + tokens }));
    } catch (err) { console.error(err); } finally { setStatus(prev => ({ ...prev, isAnalyzing: false })); }
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
    setIsFinished(false);
    cancelFlagRef.current = false;
    setTimeout(() => {
      const result: HybridOptimizeResult = performQuickAnalyze(blocks);
      setAiRequiredList(result.aiRequiredSegments);
      setOptimizeStats({
        total: result.aiRequiredSegments.length,
        processed: 0,
        failed: 0,
        autoFixed: result.localFixCount,
        ignored: blocks.length - result.aiRequiredSegments.length - result.localFixCount
      });
      setIsQuickAnalyzing(false);
      setOptimizeStep(2);
    }, 800);
  };

  const applyOptimize = async () => {
    if (isAiProcessing) return;
    setIsAiProcessing(true);
    setOptimizeError(null);
    setIsCancelled(false);
    setIsFinished(false);
    cancelFlagRef.current = false;

    try {
      // 1. Local fixes (20-40 CPS) applied instantly
      const updatedWithLocal = applyLocalFixesOnly(blocks);
      setBlocks(updatedWithLocal);

      // 2. AI processing for >40 CPS
      const total = aiRequiredList.length;
      if (total > 0) {
        const BATCH_SIZE = 4;
        for (let i = 0; i < total; i += BATCH_SIZE) {
          if (cancelFlagRef.current) { setIsCancelled(true); break; }
          const batch = aiRequiredList.slice(i, i + BATCH_SIZE);
          
          setAiRequiredList(prev => prev.map(s => batch.some(b => b.index === s.index) ? { ...s, status: 'processing' } : s));

          try {
            const results = await optimizeHighCpsBatch(batch, updatedWithLocal, status.selectedModel);
            setBlocks(prev => {
              const next = [...prev];
              results.forEach(res => {
                const idx = next.findIndex(b => b.index === res.id);
                if (idx !== -1) { next[idx].translatedText = res.afterText; next[idx].timestamp = res.afterTimestamp; }
              });
              return next;
            });

            setAiRequiredList(prev => prev.map(s => {
              const res = results.find(r => r.id === s.index);
              return res ? { ...s, status: 'applied', afterText: res.afterText, afterTimestamp: res.afterTimestamp, appliedAt: Date.now() } : s;
            }));

            setOptimizeStats(prev => ({ ...prev, processed: prev.processed + results.length }));
          } catch (err: any) {
            setOptimizeError(err.message);
            setAiRequiredList(prev => prev.map(s => batch.some(b => b.index === s.index) ? { ...s, status: 'error', errorMsg: err.message } : s));
            setOptimizeStats(prev => ({ ...prev, failed: prev.failed + batch.length }));
            // Stop loop on serious error to avoid wasting credits
            break; 
          }
          await new Promise(r => setTimeout(r, 100));
        }
      }
      if (!cancelFlagRef.current && !optimizeError) setIsFinished(true);
    } catch (err: any) {
      setOptimizeError(err.message || "Failed to start optimization.");
    } finally { setIsAiProcessing(false); }
  };

  const cancelOptimize = () => { cancelFlagRef.current = true; };

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
            <button onClick={() => setActiveTab('hybrid-optimize')} className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'hybrid-optimize' ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20' : 'text-slate-400 hover:text-slate-200'}`}>🔥 OPTIMIZE</button>
          </nav>
          <div className="hidden md:flex items-center gap-3 bg-slate-900 px-4 py-2 rounded-2xl border border-slate-800">
            <div className={`w-2 h-2 rounded-full ${status.apiStatus === 'valid' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
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
                  <div onClick={() => fileInputRef.current?.click()} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className="border-2 border-dashed border-slate-700 rounded-3xl p-12 flex flex-col items-center justify-center cursor-pointer transition-all hover:border-indigo-500">
                    <div className="p-5 rounded-3xl bg-slate-800 mb-5"><Upload className="text-slate-500" size={48} /></div>
                    <p className="text-sm font-bold text-slate-300 uppercase tracking-widest text-center">Kéo thả file SRT</p>
                    <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} accept=".srt" className="hidden" />
                  </div>
                ) : (
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl flex justify-between items-center animate-in zoom-in-95 duration-300">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center"><FileText className="text-indigo-400" size={20} /></div>
                      <div><p className="text-sm font-bold truncate max-w-[200px]">{fileName}</p><p className="text-[10px] text-slate-600 font-mono">{blocks.length} lines</p></div>
                    </div>
                    <button onClick={() => {setFileName(''); setBlocks([]); setAnalysis(null);}} className="p-2.5 text-slate-500 hover:text-red-400"><Trash2 size={20} /></button>
                  </div>
                )}
                {analysis && (
                  <div className="mt-6 space-y-4 animate-in slide-in-from-top-4">
                    <div className="p-5 bg-slate-800/40 rounded-3xl border border-slate-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkle className="text-amber-400" size={16} />
                        <p className="text-sm font-bold text-indigo-400">{analysis.translatedTitle}</p>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">{analysis.summary}</p>
                    </div>
                    {!status.isTranslating && status.fileStatus !== 'completed' && (
                       <button onClick={startTranslation} className="w-full bg-indigo-600 hover:bg-indigo-700 py-4 rounded-2xl font-bold flex items-center justify-center gap-3 shadow-xl transition-all">
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
                      <button onClick={() => downloadSRT()} className="w-full bg-emerald-600 hover:bg-emerald-700 py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all"><Download size={22} /> Tải file đã dịch</button>
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
                  <div className="h-full flex flex-col items-center justify-center opacity-10"><Box size={100} strokeWidth={0.5} /><p className="text-sm font-bold uppercase tracking-widest mt-4">Waiting for file...</p></div>
                ) : (
                  blocks.slice(0, 150).map(b => (
                    <div key={b.index} className="group p-5 bg-slate-900/30 rounded-3xl border border-slate-800/50 hover:border-indigo-500/30 transition-all">
                      <div className="flex justify-between mb-3 text-[10px] font-mono text-slate-600 group-hover:text-indigo-400"><span>#{b.index.toString().padStart(3, '0')} — {b.timestamp}</span></div>
                      <p className="text-xs text-slate-500 italic mb-2.5 leading-relaxed">{b.originalText}</p>
                      <div className="pl-4 border-l-2 border-indigo-500/20"><p className="text-sm font-bold text-slate-100 font-serif-vi">{b.translatedText || <span className="text-slate-800">Pending...</span>}</p></div>
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
                  <div onClick={() => fileInputRef.current?.click()} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className="border-2 border-dashed border-slate-700 rounded-[2.5rem] p-20 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 transition-all duration-500 group">
                    <div className="w-24 h-24 bg-indigo-600/10 rounded-[2rem] flex items-center justify-center mb-8 border border-indigo-500/20 group-hover:scale-110 transition-transform"><Zap className="text-indigo-400" size={48} /></div>
                    <h2 className="text-3xl font-bold mb-4 tracking-tight">Hybrid Optimizer</h2>
                    <p className="text-slate-400 text-sm mb-10 leading-relaxed max-w-md mx-auto">Tự động fix toán học (20-40 CPS) và dùng AI chuyên sâu cho các ca nặng (>40 CPS).</p>
                    <div className="flex items-center gap-3 bg-indigo-600 px-10 py-5 rounded-2xl font-bold text-white shadow-2xl hover:bg-indigo-700 transition-all active:scale-95"><MousePointer2 size={24} /> Chọn file SRT</div>
                    <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} accept=".srt" className="hidden" />
                  </div>
               </section>
            ) : optimizeStep === 1 ? (
              <section className="bg-slate-900 border border-slate-800 rounded-[3rem] p-16 text-center max-w-3xl mx-auto shadow-2xl my-12 animate-in zoom-in-95">
                <div className="w-24 h-24 bg-indigo-600/10 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-indigo-500/20"><Gauge className="text-indigo-400" size={48} /></div>
                <h2 className="text-3xl font-bold mb-5 tracking-tight">Quick Analyze {fileName}</h2>
                <div className="flex gap-4 justify-center">
                  <button onClick={runQuickAnalyze} disabled={isQuickAnalyzing} className="px-12 py-5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl flex items-center justify-center gap-3 shadow-2xl transition-all">
                    {isQuickAnalyzing ? <Loader2 className="animate-spin" /> : <BarChart3 size={24} />} {isQuickAnalyzing ? 'Analyzing...' : 'Phân tích file'}
                  </button>
                  <button onClick={() => {setFileName(''); setBlocks([]);}} className="px-8 py-5 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold rounded-2xl transition-all">Đổi file</button>
                </div>
              </section>
            ) : (
              <div className="space-y-8 max-w-5xl mx-auto pb-12 animate-in slide-in-from-bottom-6 duration-500">
                {/* Statistics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 text-center shadow-lg group hover:border-indigo-500/30 transition-all">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-widest">Auto Fixed (20-40)</p>
                    <p className="text-2xl font-black text-indigo-400">{optimizeStats.autoFixed}</p>
                  </div>
                  <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 text-center shadow-lg group hover:border-red-500/30 transition-all">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-widest">AI Required (>40)</p>
                    <p className="text-2xl font-black text-red-500">{optimizeStats.total}</p>
                  </div>
                  <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 text-center shadow-lg group hover:border-emerald-500/30 transition-all">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-widest">AI Processed</p>
                    <p className="text-2xl font-black text-emerald-500">{optimizeStats.processed}</p>
                  </div>
                  <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 text-center shadow-lg group hover:border-orange-500/30 transition-all">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-widest">Failed</p>
                    <p className="text-2xl font-black text-orange-500">{optimizeStats.failed}</p>
                  </div>
                </div>

                {/* Status Notifications */}
                {isFinished && (
                  <div className="p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-3xl flex items-center gap-4 animate-in slide-in-from-top-4">
                    <CheckCircle className="text-emerald-500 flex-shrink-0" size={24} />
                    <div className="flex-1">
                      <p className="text-sm font-bold text-emerald-400">✅ Optimization completed successfully.</p>
                      <p className="text-[11px] text-slate-400 mt-1 uppercase font-bold tracking-widest">AI Processed: {optimizeStats.processed} | Auto Fixed: {optimizeStats.autoFixed} | Failed: {optimizeStats.failed}</p>
                    </div>
                  </div>
                )}

                {isCancelled && (
                  <div className="p-6 bg-amber-500/10 border border-amber-500/30 rounded-3xl flex items-center gap-4 animate-in slide-in-from-top-4">
                    <XCircle className="text-amber-500 flex-shrink-0" size={24} />
                    <div className="flex-1">
                      <p className="text-sm font-bold text-amber-500">⛔ Optimization cancelled by user.</p>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Processed: {optimizeStats.processed} / {optimizeStats.total}</p>
                    </div>
                  </div>
                )}

                {optimizeError && (
                  <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-3xl flex items-start gap-4 animate-in slide-in-from-top-4">
                    <ShieldAlert className="text-red-500 flex-shrink-0 mt-1" size={24} />
                    <div className="flex-1">
                      <p className="text-sm font-bold text-red-500 uppercase tracking-widest">❌ AI Optimization Error</p>
                      <p className="text-sm text-slate-300 mt-1 font-medium">{optimizeError}</p>
                      <p className="text-[10px] text-slate-500 mt-3 italic font-bold uppercase tracking-widest">Stats: {optimizeStats.processed} Processed | {optimizeStats.failed} Failed</p>
                    </div>
                  </div>
                )}

                {isAiProcessing && (
                  <div className="bg-slate-900/80 p-8 rounded-3xl border border-red-500/20 shadow-2xl relative overflow-hidden">
                    <div className="flex justify-between items-center mb-6 px-2">
                       <p className="text-xs font-bold text-red-400 uppercase tracking-[0.2em] flex items-center gap-3"><Activity size={18} className="animate-pulse" /> Processing {optimizeStats.processed + optimizeStats.failed} / {optimizeStats.total} critical segments...</p>
                       <span className="text-xs font-mono font-bold text-red-400">{Math.round(((optimizeStats.processed + optimizeStats.failed) / optimizeStats.total) * 100)}%</span>
                    </div>
                    <div className="h-4 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div className="h-full bg-gradient-to-r from-red-600 via-orange-500 to-amber-400 transition-all duration-700 ease-out" style={{ width: `${((optimizeStats.processed + optimizeStats.failed) / (optimizeStats.total || 1)) * 100}%` }} />
                    </div>
                  </div>
                )}

                {/* Main Controls & List */}
                <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] overflow-hidden shadow-2xl">
                   <div className="p-8 border-b border-slate-800 flex justify-between items-center bg-slate-900/90 backdrop-blur-xl sticky top-0 z-10">
                     <div className="flex items-center gap-6">
                        <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-3"><ListChecks size={22} /> AI Review List</h3>
                        {!isAiProcessing && !isFinished && !isCancelled && !optimizeError && (
                          <button onClick={applyOptimize} className="px-10 py-3.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl flex items-center gap-3 shadow-xl transition-all active:scale-95"><Brain size={20} /> APPLY AI OPTIMIZE</button>
                        )}
                        {isAiProcessing && (
                          <button onClick={cancelOptimize} className="px-10 py-3.5 bg-slate-800 text-red-400 font-bold rounded-2xl border border-red-500/20 hover:bg-red-500/5 transition-all"><XCircle size={20} /> Cancel</button>
                        )}
                        {(isFinished || isCancelled || optimizeError) && (
                          <button onClick={runQuickAnalyze} className="px-6 py-2 bg-slate-800 text-slate-400 font-bold rounded-xl border border-slate-700 text-xs flex items-center gap-2 transition-colors"><RefreshCw size={14} /> Analyze Again</button>
                        )}
                     </div>
                     <div className="flex gap-4">
                       <button onClick={() => downloadSRT(true)} className="px-8 py-3 bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600/20 border border-emerald-600/20 rounded-2xl text-xs font-bold uppercase transition-all flex items-center gap-2 shadow-inner active:scale-95"><Download size={18}/> Download Optimized File</button>
                     </div>
                   </div>

                   <div className="p-8 max-h-[700px] overflow-y-auto space-y-6 custom-scrollbar bg-slate-950/20">
                     {aiRequiredList.length === 0 ? (
                       <div className="py-32 text-center space-y-4 opacity-40">
                         <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20 shadow-inner">
                           <CheckCircle2 size={48} className="text-emerald-500" strokeWidth={1} />
                         </div>
                         <p className="text-sm font-bold uppercase tracking-[0.4em] text-emerald-400">All segments are below 40 CPS threshold</p>
                         <p className="text-xs text-slate-500 italic">No manual rewrite required for this file.</p>
                       </div>
                     ) : aiRequiredList.map(s => {
                       const isRecentlyApplied = s.appliedAt && (Date.now() - s.appliedAt < 2500);
                       return (
                         <div key={s.id} className={`group p-6 rounded-[2rem] border transition-all duration-700 ${
                           isRecentlyApplied ? 'bg-indigo-500/10 border-indigo-500/40 shadow-xl scale-[1.01]' :
                           s.status === 'applied' ? 'bg-emerald-500/5 border-emerald-500/20 shadow-lg' :
                           s.status === 'processing' ? 'bg-indigo-500/5 border-indigo-500/40 animate-pulse' :
                           s.status === 'error' ? 'bg-red-500/5 border-red-500/20' : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                         }`}>
                           <div className="flex justify-between items-center mb-5">
                             <div className="flex items-center gap-4">
                               <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${s.cps > 50 ? 'bg-red-500/20 text-red-500 shadow-md' : 'bg-red-500/10 text-red-400'}`}><Zap size={22} fill={s.cps > 50 ? "currentColor" : "none"} /></div>
                               <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Segment #{s.index}</p><span className={`text-sm font-black ${s.cps > 50 ? 'text-red-500' : 'text-red-400'}`}>{s.cps.toFixed(1)} CPS</span></div>
                             </div>
                             <div className="flex items-center gap-3">
                               {s.status === 'applied' ? <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-2xl text-[10px] font-bold uppercase border border-emerald-500/20 shadow-sm animate-in zoom-in-50"><CheckCircle2 size={16} /> Optimized</div> : 
                                s.status === 'processing' ? <div className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 text-indigo-400 rounded-2xl text-[10px] font-bold uppercase border border-indigo-500/20"><Loader2 size={16} className="animate-spin" /> Rewriting...</div> : 
                                s.status === 'error' ? <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-500 rounded-2xl text-[10px] font-bold uppercase border border-red-500/20"><AlertTriangle size={16} /> Error</div> : 
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-4 py-2 bg-slate-800 rounded-2xl border border-slate-700">Pending AI</div>}
                             </div>
                           </div>
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                             <div className="p-6 bg-slate-950/80 rounded-[1.8rem] border border-slate-800/80 group-hover:bg-slate-950/50 transition-colors">
                               <p className="text-[10px] font-mono text-slate-600 mb-2 flex items-center gap-2"><Clock size={12}/> {s.beforeTimestamp}</p>
                               <p className="text-xs text-slate-400 font-serif-vi italic leading-relaxed">{s.beforeText}</p>
                             </div>
                             <div className={`p-6 rounded-[1.8rem] border transition-all duration-700 ${s.status === 'applied' ? 'bg-emerald-500/10 border-emerald-500/40 shadow-inner' : 'bg-slate-950/30 border-slate-800'}`}>
                               <p className={`text-[10px] font-mono mb-2 flex items-center gap-2 ${s.afterTimestamp !== s.beforeTimestamp ? 'text-emerald-400 font-bold' : 'text-slate-600'}`}>
                                 <Sparkles size={12}/> {s.afterTimestamp}
                               </p>
                               <div className={`text-sm leading-relaxed font-serif-vi ${s.status === 'applied' ? 'text-slate-100 font-bold' : 'text-slate-500 opacity-30 italic'}`}>{s.status === 'applied' ? s.afterText : 'Đang phân tích bối cảnh...'}</div>
                             </div>
                           </div>
                           {s.status === 'error' && s.errorMsg && <p className="mt-4 px-4 py-2 bg-red-500/10 text-red-500 text-[10px] font-mono rounded-lg border border-red-500/20">❌ {s.errorMsg}</p>}
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

      <footer className="p-6 text-center border-t border-slate-900 bg-slate-950 z-20 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-[9px] font-bold text-slate-600 uppercase tracking-widest">
           <p className="opacity-60">Donghua AI Subtitle Engine • v5.5 Hybrid Realtime Stats</p>
           <div className="flex gap-8">
              <span className="flex items-center gap-2 group hover:text-indigo-400 transition-colors cursor-default"><TrendingUp size={14} className="text-indigo-500"/> Real-time Analytics</span>
              <span className="flex items-center gap-2 group hover:text-emerald-400 transition-colors cursor-default"><Layers3 size={14} className="text-emerald-500"/> Advanced Math Safety</span>
           </div>
        </div>
      </footer>
    </div>
  );
};

export default App;


import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, Download, Play, CheckCircle2, AlertCircle, Loader2, Trash2, 
  FileText, Sparkles, Activity, Box, Zap, Brain, Gauge, ListChecks, 
  XCircle, BarChart3, MousePointer2, ShieldAlert, CheckCircle, 
  Layers3, Merge as MergeIcon, Languages, TrendingUp, Info, Tag,
  ArrowRightLeft, BarChart, History, Key
} from 'lucide-react';
import { SubtitleBlock, TranslationState, TitleAnalysis, HybridOptimizeSuggestion, OptimizeStats } from './types';
import { parseSRT, stringifySRT, extractChineseTitle, generateFileName, performQuickAnalyze, applyLocalFixesOnly } from './utils/srtParser';
import { checkApiHealth, analyzeTitle, translateBatch, alignMergeBatch, optimizeHighCpsBatch } from './services/aiService';

// AI Models as specified
const AI_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
  { id: 'gpt-4.1-mini', name: 'gpt-4.1-mini' },
  { id: 'gpt-4.1', name: 'gpt-4.1' },
];

const App: React.FC = () => {
  // 1. Central State for Tool Selection
  const [currentTool, setCurrentTool] = useState<'translate' | 'merge' | 'optimize'>('translate');
  
  // 2. Persistent Global Data State
  const [blocks, setBlocks] = useState<SubtitleBlock[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [userApiKey, setUserApiKey] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');
  const [hardsubContent, setHardsubContent] = useState<string>('');
  const [analysis, setAnalysis] = useState<TitleAnalysis | null>(null);

  // Status for processes
  const [status, setStatus] = useState<TranslationState>({
    isProcessing: false, isAnalyzing: false, progress: 0, total: 0,
    error: null, fileStatus: null, apiStatus: 'checking', selectedModel: 'gemini-2.5-flash'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelFlagRef = useRef(false);

  // Sync state for API health
  useEffect(() => {
    const keyToUse = userApiKey || process.env.API_KEY || '';
    if (!keyToUse) {
      setStatus(prev => ({ ...prev, apiStatus: 'invalid' }));
      return;
    }
    checkApiHealth(selectedModel).then(v => setStatus(prev => ({ ...prev, apiStatus: v ? 'valid' : 'invalid' })));
  }, [selectedModel, userApiKey]);

  const handleFileLoad = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseSRT(ev.target?.result as string);
      setBlocks(parsed);
      setStatus(prev => ({ ...prev, total: parsed.length, progress: 0, error: null, fileStatus: 'new' }));
      if (currentTool === 'translate') {
        const title = extractChineseTitle(file.name);
        handleAnalysisInternal(title);
      }
    };
    reader.readAsText(file);
  };

  const handleAnalysisInternal = async (title: string) => {
    setStatus(prev => ({ ...prev, isAnalyzing: true }));
    try {
      const { analysis: result } = await analyzeTitle(title, selectedModel);
      setAnalysis(result);
    } catch (e: any) { 
      setStatus(prev => ({ ...prev, error: e.message }));
    } finally { 
      setStatus(prev => ({ ...prev, isAnalyzing: false })); 
    }
  };

  const downloadResult = (mode: 'Translated' | 'Merged' | 'Optimized') => {
    const content = stringifySRT(blocks);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = generateFileName(fileName, mode);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // TOOL RENDERER
  const renderCurrentTool = () => {
    switch (currentTool) {
      case 'translate':
        return (
          <TranslateTool 
            blocks={blocks} 
            setBlocks={setBlocks}
            status={status} 
            setStatus={setStatus}
            analysis={analysis}
            selectedModel={selectedModel}
            cancelFlagRef={cancelFlagRef}
            downloadResult={() => downloadResult('Translated')}
          />
        );
      case 'merge':
        return (
          <MergeTool 
            blocks={blocks}
            setBlocks={setBlocks}
            status={status}
            setStatus={setStatus}
            hardsubContent={hardsubContent}
            setHardsubContent={setHardsubContent}
            selectedModel={selectedModel}
            cancelFlagRef={cancelFlagRef}
            downloadResult={() => downloadResult('Merged')}
          />
        );
      case 'optimize':
        return (
          <OptimizeTool 
            blocks={blocks}
            setBlocks={setBlocks}
            status={status}
            setStatus={setStatus}
            selectedModel={selectedModel}
            cancelFlagRef={cancelFlagRef}
            downloadResult={() => downloadResult('Optimized')}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* HEADER SECTION - GLOBAL */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo Left */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="text-white" size={18} />
            </div>
            <h1 className="text-lg font-black bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent tracking-tighter hidden sm:block">SUBTITLE MASTER AI</h1>
          </div>
          
          {/* Tabs Center */}
          <nav className="flex items-center bg-slate-800/40 p-1 rounded-2xl border border-slate-700/30">
            {(['translate', 'merge', 'optimize'] as const).map(tool => (
              <button 
                key={tool}
                onClick={() => setCurrentTool(tool)} 
                className={`px-6 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 uppercase tracking-widest ${currentTool === tool ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {tool === 'translate' && <Languages size={14} />}
                {tool === 'merge' && <MergeIcon size={14} />}
                {tool === 'optimize' && <Gauge size={14} />}
                {tool}
              </button>
            ))}
          </nav>

          {/* Selector Right */}
          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-2 bg-slate-950/50 px-3 py-1.5 rounded-xl border border-slate-800">
              <Key size={12} className="text-slate-600" />
              <input 
                type="password" 
                placeholder="API KEY (OPTIONAL)" 
                value={userApiKey}
                onChange={e => setUserApiKey(e.target.value)}
                className="bg-transparent text-[10px] font-bold text-slate-400 uppercase outline-none w-32 placeholder:text-slate-800"
              />
            </div>
            <div className="flex items-center gap-3 bg-slate-900 px-4 py-2 rounded-2xl border border-slate-800 shadow-inner">
              <div className={`w-2 h-2 rounded-full ${status.apiStatus === 'valid' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
              <select 
                value={selectedModel} 
                onChange={e => setSelectedModel(e.target.value)} 
                className="bg-transparent text-[10px] font-black text-slate-400 uppercase outline-none cursor-pointer"
              >
                {AI_MODELS.map(m => <option key={m.id} value={m.id} className="bg-slate-900">{m.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-6 overflow-hidden flex flex-col gap-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 overflow-hidden">
          {/* SIDEBAR - FILE CONFIG */}
          <aside className="lg:col-span-3 space-y-6 overflow-y-auto custom-scrollbar pr-2">
            <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col gap-6">
              <div>
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                  <FileText size={14} /> Source Media
                </h3>
                {!fileName ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()} 
                    className="group border-2 border-dashed border-slate-800 rounded-3xl p-8 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-500/5 transition-all"
                  >
                    <Upload className="text-slate-600 mb-3 group-hover:text-indigo-400 transition-all" size={28} />
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Tải file .SRT</p>
                    <input type="file" ref={fileInputRef} onChange={e => e.target.files?.[0] && handleFileLoad(e.target.files[0])} accept=".srt" className="hidden" />
                  </div>
                ) : (
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl flex justify-between items-center group">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-8 h-8 bg-indigo-500/10 rounded-lg flex items-center justify-center shrink-0">
                        <FileText className="text-indigo-400" size={16} />
                      </div>
                      <div className="overflow-hidden">
                        <p className="text-xs font-bold truncate text-slate-200">{fileName}</p>
                        <p className="text-[9px] text-slate-600 font-black uppercase">{blocks.length} Lines</p>
                      </div>
                    </div>
                    <button onClick={() => { setFileName(''); setBlocks([]); setAnalysis(null); }} className="p-2 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
              
              {/* This divider will be used before tool-specific sidebar content */}
              <div className="h-px bg-slate-800 w-full" />
              
              {/* Sidebar Action Area will be rendered inside Tool components via props or context if needed, but for simplicity we'll pass it down or just keep it modular */}
              {/* Actually, let's keep the render logic in each Tool component for both Sidebar and Content */}
            </section>
          </aside>

          {/* TOOL CONTENT AREA */}
          <div className="lg:col-span-9 flex flex-col overflow-hidden">
            {renderCurrentTool()}
          </div>
        </div>
      </main>

      {/* GLOBAL FOOTER */}
      <footer className="p-4 border-t border-slate-900 bg-slate-950/80 flex justify-between items-center px-10 backdrop-blur-md text-[9px] font-black text-slate-600 uppercase tracking-[0.3em]">
        <p>Subtitle Master Engine v6.5 • Hybrid AI Active</p>
        <div className="flex gap-10">
           <span className="flex items-center gap-2"><TrendingUp size={12} className="text-indigo-500"/> Real-time Analytics</span>
           <span className="flex items-center gap-2"><Layers3 size={12} className="text-emerald-500"/> Context Alignment</span>
        </div>
      </footer>
    </div>
  );
};

// --- SUB-COMPONENTS (TOOLS) ---

const TranslateTool: React.FC<any> = ({ blocks, setBlocks, status, setStatus, analysis, selectedModel, cancelFlagRef, downloadResult }) => {
  const handleTranslate = async () => {
    if (!analysis) return;
    setStatus((prev: any) => ({ ...prev, isProcessing: true, progress: 0, error: null }));
    cancelFlagRef.current = false;
    const CHUNK = 8;
    try {
      for (let i = 0; i < blocks.length; i += CHUNK) {
        if (cancelFlagRef.current) break;
        const batch = blocks.slice(i, i + CHUNK);
        const results = await translateBatch(batch, analysis, selectedModel);
        setBlocks((prev: any) => {
          const next = [...prev];
          results.forEach((res: any) => {
            const idx = next.findIndex(b => b.index === res.id);
            if (idx !== -1) next[idx].translatedText = res.translated;
          });
          return next;
        });
        setStatus((prev: any) => ({ ...prev, progress: Math.min(i + CHUNK, blocks.length) }));
      }
      if (!cancelFlagRef.current) setStatus((prev: any) => ({ ...prev, fileStatus: 'completed' }));
    } catch (err: any) {
      setStatus((prev: any) => ({ ...prev, error: err.message }));
    } finally { setStatus((prev: any) => ({ ...prev, isProcessing: false })); }
  };

  return (
    <div className="flex flex-col h-full gap-6 lg:flex-row">
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-[2.5rem] flex flex-col shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex justify-between items-center px-10 bg-slate-900/90 backdrop-blur-xl">
           <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-3">
             <Activity size={14} className={status.isProcessing ? "animate-pulse text-indigo-500" : ""} /> 
             Live Monitor — Translate
           </span>
        </div>
        <div className="flex-1 overflow-y-auto p-8 space-y-5 custom-scrollbar bg-slate-950/20">
          {blocks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-10">
              <Box size={80} strokeWidth={0.5} />
              <p className="text-xs font-black uppercase tracking-[0.6em] mt-6">No Data Loaded</p>
            </div>
          ) : (
            blocks.slice(0, 150).map((b: any) => (
              <div key={b.index} className="group p-5 bg-slate-900/40 rounded-3xl border border-slate-800/60 hover:border-indigo-500/40 transition-all animate-in slide-in-from-bottom-2 duration-300">
                <div className="flex justify-between mb-3 text-[10px] font-mono text-slate-600">
                  <span className="tracking-widest font-black uppercase">Line #{b.index.padStart(3, '0')} — {b.timestamp}</span>
                </div>
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 italic font-serif-vi opacity-70 leading-relaxed">{b.originalText}</p>
                  <div className="pl-4 border-l-2 border-indigo-500/30 min-h-[1.5rem]">
                    <p className="text-sm font-bold font-serif-vi text-slate-100 leading-relaxed">
                      {b.translatedText || <span className="text-slate-800/50 font-black uppercase text-[9px] tracking-widest">Pending...</span>}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {/* Sidebar Overlay Action */}
      <div className="lg:w-72 shrink-0 space-y-4">
        {analysis && (
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-4">
            <h4 className="text-[10px] font-black text-indigo-400 uppercase">Analysis</h4>
            <p className="text-sm font-bold text-slate-200">{analysis.translatedTitle}</p>
            <p className="text-[10px] text-slate-500 leading-relaxed italic line-clamp-4">{analysis.summary}</p>
          </div>
        )}
        
        {blocks.length > 0 && !status.isProcessing && status.fileStatus !== 'completed' && (
          <button onClick={handleTranslate} className="w-full bg-indigo-600 hover:bg-indigo-700 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-indigo-500/20">
            <Languages size={18} /> Start AI Translate
          </button>
        )}
        
        {status.isProcessing && (
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-3">
            <div className="flex justify-between text-[10px] font-black text-indigo-400 uppercase">
              <span>Progress</span>
              <span>{Math.round((status.progress / (status.total || 1)) * 100)}%</span>
            </div>
            <div className="h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div className="h-full bg-gradient-to-r from-indigo-600 to-cyan-400 transition-all duration-500" style={{ width: `${(status.progress / (status.total || 1)) * 100}%` }} />
            </div>
            <button onClick={() => cancelFlagRef.current = true} className="w-full py-2 text-[9px] font-black text-slate-600 uppercase hover:text-red-400">Cancel</button>
          </div>
        )}
        
        {(status.fileStatus === 'completed' || status.error) && (
          <button onClick={downloadResult} className="w-full bg-emerald-600 hover:bg-emerald-700 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-emerald-500/20">
            <Download size={18} /> Download SRT
          </button>
        )}
      </div>
    </div>
  );
};

const MergeTool: React.FC<any> = ({ blocks, setBlocks, status, setStatus, hardsubContent, setHardsubContent, selectedModel, cancelFlagRef, downloadResult }) => {
  const handleMerge = async () => {
    if (!hardsubContent) return;
    setStatus((prev: any) => ({ ...prev, isProcessing: true, progress: 0, error: null }));
    cancelFlagRef.current = false;
    const hardLines = hardsubContent.split('\n').map(l => l.trim()).filter(l => l);
    const CHUNK = 8;
    try {
      for (let i = 0; i < blocks.length; i += CHUNK) {
        if (cancelFlagRef.current) break;
        const batch = blocks.slice(i, i + CHUNK);
        const hardBatch = hardLines.slice(i, i + CHUNK); 
        const results = await alignMergeBatch(batch, hardBatch, selectedModel);
        setBlocks((prev: any) => {
          const next = [...prev];
          results.forEach((res: any) => {
            const idx = next.findIndex(b => b.index === res.id);
            if (idx !== -1) next[idx].translatedText = res.merged;
          });
          return next;
        });
        setStatus((prev: any) => ({ ...prev, progress: Math.min(i + CHUNK, blocks.length) }));
      }
      if (!cancelFlagRef.current) setStatus((prev: any) => ({ ...prev, fileStatus: 'completed' }));
    } catch (err: any) {
      setStatus((prev: any) => ({ ...prev, error: err.message }));
    } finally { setStatus((prev: any) => ({ ...prev, isProcessing: false })); }
  };

  return (
    <div className="flex flex-col h-full gap-6 lg:flex-row">
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-[2.5rem] flex flex-col shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex justify-between items-center px-10 bg-slate-900/90 backdrop-blur-xl">
           <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-3">
             <Activity size={14} /> Live Monitor — Merge
           </span>
        </div>
        <div className="flex-1 overflow-y-auto p-8 space-y-5 custom-scrollbar bg-slate-950/20">
          {blocks.slice(0, 150).map((b: any, idx: number) => {
            const hardLines = hardsubContent.split('\n').filter(l => l.trim());
            const mappedHardLine = hardLines[idx] || "";
            return (
              <div key={b.index} className="group p-5 bg-slate-900/40 rounded-3xl border border-slate-800/60 hover:border-emerald-500/40 transition-all">
                <div className="flex justify-between mb-3 text-[10px] font-mono text-slate-600">
                  <span className="tracking-widest font-black uppercase">Alignment #{b.index.padStart(3, '0')}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                     <p className="text-[8px] font-black text-slate-700 uppercase mb-1">Timing Reference</p>
                     <p className="text-[11px] text-slate-400 font-serif-vi">{b.originalText}</p>
                   </div>
                   <div className="p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/10">
                     <p className="text-[8px] font-black text-emerald-500/50 uppercase mb-1">Content Match</p>
                     <p className="text-[11px] text-slate-100 font-serif-vi font-bold">
                       {b.translatedText || mappedHardLine || <span className="opacity-10 italic">Empty</span>}
                     </p>
                   </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      <div className="lg:w-72 shrink-0 space-y-4">
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-3">
           <h4 className="text-[10px] font-black text-slate-500 uppercase">Hardsub Input</h4>
           <textarea 
            value={hardsubContent} 
            onChange={e => setHardsubContent(e.target.value)} 
            placeholder="Paste raw hardsub text here..." 
            className="w-full h-48 bg-slate-950 border border-slate-800 rounded-2xl p-4 text-[11px] font-serif-vi outline-none focus:border-indigo-500 transition-all resize-none placeholder:text-slate-800" 
           />
        </div>
        
        {blocks.length > 0 && !status.isProcessing && status.fileStatus !== 'completed' && (
          <button onClick={handleMerge} disabled={!hardsubContent} className="w-full bg-emerald-600 hover:bg-emerald-700 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-emerald-500/20 disabled:opacity-30">
            <MergeIcon size={18} /> Merge Blocks
          </button>
        )}
        
        {status.isProcessing && (
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-3">
            <div className="h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${(status.progress / (status.total || 1)) * 100}%` }} />
            </div>
            <button onClick={() => cancelFlagRef.current = true} className="w-full py-2 text-[9px] font-black text-slate-600 uppercase hover:text-red-400">Cancel</button>
          </div>
        )}

        {(status.fileStatus === 'completed' || status.error) && (
          <button onClick={downloadResult} className="w-full bg-indigo-600 hover:bg-indigo-700 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-indigo-500/20">
            <Download size={18} /> Download Result
          </button>
        )}
      </div>
    </div>
  );
};

const OptimizeTool: React.FC<any> = ({ blocks, setBlocks, status, setStatus, selectedModel, cancelFlagRef, downloadResult }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [aiList, setAiList] = useState<HybridOptimizeSuggestion[]>([]);
  const [stats, setStats] = useState<OptimizeStats>({ total: 0, processed: 0, failed: 0, autoFixed: 0, ignored: 0 });

  const runAnalysis = () => {
    const result = performQuickAnalyze(blocks);
    setAiList(result.aiRequiredSegments);
    setStats({
      total: result.aiRequiredSegments.length,
      processed: 0,
      failed: 0,
      autoFixed: result.localFixCount,
      ignored: blocks.length - result.aiRequiredSegments.length - result.localFixCount
    });
    setStep(2);
  };

  const handleOptimize = async () => {
    setStatus((prev: any) => ({ ...prev, isProcessing: true, error: null }));
    cancelFlagRef.current = false;
    try {
      const updatedLocal = applyLocalFixesOnly(blocks);
      setBlocks(updatedLocal);
      const CHUNK = 4;
      for (let i = 0; i < aiList.length; i += CHUNK) {
        if (cancelFlagRef.current) break;
        const batch = aiList.slice(i, i + CHUNK);
        setAiList(prev => prev.map(s => batch.some(b => b.index === s.index) ? { ...s, status: 'processing' } : s));
        const results = await optimizeHighCpsBatch(batch, updatedLocal, selectedModel);
        setBlocks((prev: any) => {
          const next = [...prev];
          results.forEach((res: any) => {
            const idx = next.findIndex(b => b.index === res.id);
            if (idx !== -1) { next[idx].translatedText = res.afterText; next[idx].timestamp = res.afterTimestamp; }
          });
          return next;
        });
        setAiList(prev => prev.map(s => {
          const r = results.find(res => res.id === s.index);
          return r ? { ...s, status: 'applied', afterText: r.afterText, afterTimestamp: r.afterTimestamp, appliedAt: Date.now() } : s;
        }));
        setStats(prev => ({ ...prev, processed: prev.processed + results.length }));
      }
      if (!cancelFlagRef.current) setStatus((prev: any) => ({ ...prev, fileStatus: 'completed' }));
    } catch (err: any) {
      setStatus((prev: any) => ({ ...prev, error: err.message }));
    } finally { setStatus((prev: any) => ({ ...prev, isProcessing: false })); }
  };

  return (
    <div className="flex flex-col h-full gap-6 lg:flex-row">
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-[2.5rem] flex flex-col shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex justify-between items-center px-10 bg-slate-900/90 backdrop-blur-xl">
           <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-3">
             <Activity size={14} /> Live Monitor — Optimize
           </span>
           {step === 2 && (
             <div className="flex gap-5">
               <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Local Fix: {stats.autoFixed}</span>
               <span className="text-[9px] font-black text-red-400 uppercase tracking-widest">AI Target: {stats.total}</span>
             </div>
           )}
        </div>
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-950/20">
          {step === 1 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-6">
              <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center border border-indigo-500/20">
                <BarChart className="text-indigo-400" size={32} />
              </div>
              <div className="max-w-xs space-y-3">
                <h3 className="text-lg font-black uppercase tracking-widest">Ready for analysis</h3>
                <p className="text-xs text-slate-500">System will scan segments for high CPS (> 40). Local fixes will be applied to segments between 20-40 CPS.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {aiList.length === 0 ? (
                <div className="py-20 text-center space-y-4 opacity-50">
                  <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
                  <p className="text-xs font-black uppercase tracking-widest">All segments meet standard CPS {"(< 40)"}</p>
                </div>
              ) : (
                aiList.map(s => (
                  <div key={s.id} className={`p-6 rounded-[2rem] border transition-all duration-700 ${s.status === 'applied' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-900/50 border-slate-800'}`}>
                    <div className="flex justify-between items-center mb-4">
                       <div className="flex items-center gap-3">
                         <Zap size={14} className="text-red-500"/>
                         <span className="text-xs font-black text-red-500">{s.cps.toFixed(1)} CPS</span>
                         <span className="text-[9px] font-mono text-slate-600 uppercase">#{s.index}</span>
                       </div>
                       <span className="text-[8px] font-black uppercase px-2 py-1 bg-slate-800 rounded-md text-slate-500">{s.status}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                         <p className="text-[11px] text-slate-500 italic font-serif-vi">{s.beforeText}</p>
                      </div>
                      <div className={`p-3 rounded-xl border ${s.status === 'applied' ? 'bg-emerald-500/5 border-emerald-500/10' : 'bg-slate-950/20 border-slate-800/30'}`}>
                         <p className="text-[11px] font-serif-vi font-bold text-slate-200">
                           {s.status === 'applied' ? s.afterText : '...'}
                         </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      
      <div className="lg:w-72 shrink-0 space-y-4">
        {step === 1 ? (
          <button onClick={runAnalysis} className="w-full bg-indigo-600 hover:bg-indigo-700 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-indigo-500/20">
            <Gauge size={18} /> Quick Analysis
          </button>
        ) : (
          <>
            {!status.isProcessing && status.fileStatus !== 'completed' && (
              <button onClick={handleOptimize} className="w-full bg-red-600 hover:bg-red-700 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-red-500/20">
                <Brain size={18} /> AI Optimization
              </button>
            )}
            
            {status.isProcessing && (
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-3">
                <div className="h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${(stats.processed / (stats.total || 1)) * 100}%` }} />
                </div>
              </div>
            )}

            {(status.fileStatus === 'completed' || status.error) && (
              <button onClick={downloadResult} className="w-full bg-emerald-600 hover:bg-emerald-700 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-emerald-500/20">
                <Download size={18} /> Download Result
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default App;

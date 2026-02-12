
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Play, CheckCircle2, AlertCircle, Loader2, Trash2, 
  FileText, Search, Sparkles, ChevronRight, Activity, Cpu, FileDown, 
  RefreshCw, Box, Tags, BookOpen, Target, FileSearch, Info, History,
  Clock, FastForward, Zap, Settings, Languages, BrainCircuit, Key, Save,
  Maximize2, Layers, CheckSquare, Square, PlusCircle, AlertTriangle,
  Brain, FileJson, FileUp, Sparkle, Scissors, ListChecks, XCircle, Gauge,
  ZapOff, Filter, BarChart3
} from 'lucide-react';
import { TitleAnalysis, SubtitleBlock, TranslationState, SessionStats, InterruptionInfo, AiProvider, ProposedChange, AutoOptimizeSuggestion, HybridOptimizeSuggestion, HybridOptimizeStats } from './types';
// Fixed: Removed missing and unused exports from imports
import { parseSRT, stringifySRT, extractChineseTitle, generateFileName, performQuickAnalyze } from './utils/srtParser';
// Fixed: Removed missing analyzeSrtBatch from imports
import { translateSubtitles, analyzeTitle, checkApiHealth, optimizeHighCpsBatch } from './services/aiService';

const AI_MODELS = [
  { id: 'Gemini 3 Flash', name: 'Gemini 3 Flash' },
  { id: 'Gemini 3 Pro', name: 'Gemini 3 Pro' },
  { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'translator' | 'optimizer' | 'hybrid-optimize'>('translator');
  
  // Translator States
  const [blocks, setBlocks] = useState<SubtitleBlock[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [analysis, setAnalysis] = useState<TitleAnalysis | null>(null);
  const [stats, setStats] = useState<SessionStats>({ requests: 0, totalTokens: 0, translatedBlocks: 0 });
  
  // Fixed: Added missing fileInputRef to fix errors on lines 184 and 187
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<TranslationState>({
    isTranslating: false, isAnalyzing: false, progress: 0, total: 0,
    error: null, interruption: null, fileStatus: null,
    apiStatus: 'checking', selectedModel: 'Gemini 3 Flash'
  });

  // Hybrid Optimize States
  const [hybridResults, setHybridResults] = useState<HybridOptimizeSuggestion[]>([]);
  const [hybridStats, setHybridStats] = useState<HybridOptimizeStats | null>(null);
  const [isQuickAnalyzing, setIsQuickAnalyzing] = useState(false);
  const [isApplyingFix, setIsApplyingFix] = useState(false);
  const [optimizeStep, setOptimizeStep] = useState<1 | 2>(1);
  const cancelOptimizeRef = useRef(false);

  useEffect(() => {
    checkApiHealth(status.selectedModel).then(valid => setStatus(prev => ({ ...prev, apiStatus: valid ? 'valid' : 'invalid' })));
  }, [status.selectedModel]);

  const processFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.srt')) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseSRT(e.target?.result as string);
      setBlocks(parsed);
      setStatus(prev => ({ ...prev, total: parsed.length, progress: 0 }));
      if (activeTab === 'translator') handleAnalyze(extractChineseTitle(file.name));
    };
    reader.readAsText(file);
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

  // Fixed: Added missing downloadSRT function to fix error on line 204
  const downloadSRT = () => {
    if (blocks.length === 0) return;
    const content = stringifySRT(blocks);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generateFileName(fileName, true);
    a.click();
    URL.revokeObjectURL(url);
  };

  // HYBRID OPTIMIZE LOGIC
  const runQuickAnalyze = () => {
    if (blocks.length === 0) return;
    setIsQuickAnalyzing(true);
    setTimeout(() => {
      const { suggestions, stats } = performQuickAnalyze(blocks);
      setHybridResults(suggestions);
      setHybridStats(stats);
      setIsQuickAnalyzing(false);
      setOptimizeStep(2);
    }, 500);
  };

  const applyLocalFixes = () => {
    const locals = hybridResults.filter(s => s.type === 'local' && s.status === 'pending');
    if (locals.length === 0) return;

    let updatedBlocks = [...blocks];
    locals.forEach(s => {
      const idx = updatedBlocks.findIndex(b => b.index === s.index);
      if (idx !== -1) updatedBlocks[idx].timestamp = s.afterTimestamp;
    });

    setBlocks(updatedBlocks);
    setHybridResults(prev => prev.map(s => s.type === 'local' ? { ...s, status: 'applied' } : s));
    alert(`Đã áp dụng ${locals.length} sửa đổi timing cục bộ!`);
  };

  const applyAiOptimize = async () => {
    const aiRequired = hybridResults.filter(s => s.type === 'ai' && s.status === 'pending');
    if (aiRequired.length === 0) return;

    setIsApplyingFix(true);
    cancelOptimizeRef.current = false;
    
    try {
      // Chia batch 5 segment cho AI mỗi lần
      const BATCH_SIZE = 5;
      for (let i = 0; i < aiRequired.length; i += BATCH_SIZE) {
        if (cancelOptimizeRef.current) break;

        const batch = aiRequired.slice(i, i + BATCH_SIZE);
        const results = await optimizeHighCpsBatch(batch, blocks, status.selectedModel);
        
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

        setHybridResults(prev => prev.map(s => {
          const res = results.find(r => r.id === s.index);
          return res ? { ...s, status: 'applied', afterText: res.afterText, afterTimestamp: res.afterTimestamp } : s;
        }));

        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsApplyingFix(false);
    }
  };

  const downloadOptimized = () => {
    const content = stringifySRT(blocks);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generateFileName(fileName, true, undefined, true);
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="text-indigo-400" size={24} />
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Donghua AI Sub</h1>
          </div>
          <nav className="flex items-center bg-slate-800/50 p-1 rounded-xl border border-slate-700">
            <button onClick={() => setActiveTab('translator')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'translator' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Dịch SRT</button>
            <button onClick={() => setActiveTab('hybrid-optimize')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'hybrid-optimize' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>🔥 Optimize</button>
          </nav>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${status.apiStatus === 'valid' ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-[10px] font-bold text-slate-500 uppercase">{status.selectedModel}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">
        {activeTab === 'translator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 space-y-6">
              <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                {!fileName ? (
                  <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-slate-700 rounded-2xl p-10 flex flex-col items-center cursor-pointer hover:border-indigo-500 transition-all">
                    <Upload className="text-slate-500 mb-4" size={48} />
                    <p className="text-sm font-bold text-slate-400 uppercase">Kéo thả file SRT</p>
                    <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} accept=".srt" className="hidden" />
                  </div>
                ) : (
                  <div className="p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl flex justify-between items-center">
                    <span className="text-sm font-bold truncate pr-4">{fileName}</span>
                    <button onClick={() => {setFileName(''); setBlocks([]); setAnalysis(null);}} className="text-slate-500 hover:text-red-400"><Trash2 size={16} /></button>
                  </div>
                )}
                {analysis && (
                  <div className="mt-6 space-y-4">
                    <div className="p-4 bg-slate-800/40 rounded-2xl">
                      <p className="text-sm font-bold text-indigo-400">{analysis.translatedTitle}</p>
                      <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{analysis.summary}</p>
                    </div>
                    <button onClick={startTranslation} disabled={status.isTranslating} className="w-full bg-indigo-600 hover:bg-indigo-700 py-4 rounded-2xl font-bold flex items-center justify-center gap-2">
                      {status.isTranslating ? <Loader2 className="animate-spin" /> : <Play size={20} fill="currentColor" />} {status.isTranslating ? 'Đang dịch...' : 'Bắt đầu dịch AI'}
                    </button>
                    {status.fileStatus === 'completed' && <button onClick={() => downloadSRT()} className="w-full bg-emerald-600 hover:bg-emerald-700 py-4 rounded-2xl font-bold flex items-center justify-center gap-2"><Download size={20} /> Tải file SRT</button>}
                  </div>
                )}
              </section>
            </div>
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-[2.5rem] p-6 h-[calc(100vh-12rem)] overflow-y-auto custom-scrollbar">
              {blocks.length === 0 ? <div className="h-full flex flex-col items-center justify-center opacity-20"><Box size={64} /><p className="text-xs font-bold mt-2">CHƯA CÓ DỮ LIỆU</p></div> : blocks.slice(0, 100).map(b => (
                <div key={b.index} className="mb-4 p-4 bg-slate-950/50 rounded-2xl border border-slate-800">
                  <div className="flex justify-between mb-2"><span className="text-[9px] font-mono text-slate-600">#{b.index} | {b.timestamp}</span></div>
                  <p className="text-xs text-slate-500 italic mb-1">{b.originalText}</p>
                  <p className="text-sm font-bold text-slate-100">{b.translatedText || '---'}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'hybrid-optimize' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {optimizeStep === 1 ? (
              <section className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-12 text-center max-w-2xl mx-auto shadow-2xl">
                <div className="w-20 h-20 bg-indigo-600/20 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-indigo-500/30">
                  <Zap className="text-indigo-400" size={40} />
                </div>
                <h2 className="text-2xl font-bold mb-4">Hybrid Optimize System</h2>
                <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                  Hệ thống phân tích tốc độ đọc (CPS) và tự động tối ưu hóa. <br/>
                  Sử dụng toán học cho các lỗi nhẹ và AI cho các lỗi nghiêm trọng (>30 CPS).
                </p>
                <button onClick={runQuickAnalyze} disabled={blocks.length === 0 || isQuickAnalyzing} className="px-12 py-5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 text-white font-bold rounded-2xl flex items-center justify-center gap-3 mx-auto transition-all active:scale-95 shadow-xl shadow-indigo-600/20">
                  {isQuickAnalyzing ? <Loader2 className="animate-spin" /> : <BarChart3 size={24} />} 
                  {isQuickAnalyzing ? 'Đang phân tích...' : 'Quick Analyze (Bước 1)'}
                </button>
              </section>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 text-center">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Tổng segment</p>
                    <p className="text-2xl font-bold">{hybridStats?.total}</p>
                  </div>
                  <div className="bg-emerald-500/5 p-6 rounded-3xl border border-emerald-500/20 text-center">
                    <p className="text-[10px] text-emerald-500 uppercase font-bold mb-1">Bỏ qua (&lt;20 CPS)</p>
                    <p className="text-2xl font-bold text-emerald-400">{hybridStats?.ignored}</p>
                  </div>
                  <div className="bg-indigo-500/5 p-6 rounded-3xl border border-indigo-500/20 text-center">
                    <p className="text-[10px] text-indigo-500 uppercase font-bold mb-1">Local Fix (20-30 CPS)</p>
                    <p className="text-2xl font-bold text-indigo-400">{hybridStats?.localFix}</p>
                  </div>
                  <div className="bg-red-500/5 p-6 rounded-3xl border border-red-500/20 text-center">
                    <p className="text-[10px] text-red-500 uppercase font-bold mb-1">AI Required (&gt;30 CPS)</p>
                    <p className="text-2xl font-bold text-red-400">{hybridStats?.aiRequired}</p>
                  </div>
                </div>

                <div className="flex gap-4 justify-center">
                  <button onClick={applyLocalFixes} className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl flex items-center gap-2 shadow-lg transition-all active:scale-95"><Activity size={20}/> Áp dụng Local Fix (Toán học)</button>
                  <button onClick={applyAiOptimize} disabled={isApplyingFix} className="px-8 py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl flex items-center gap-2 shadow-lg transition-all active:scale-95">
                    {isApplyingFix ? <Loader2 className="animate-spin" /> : <Brain size={20}/>} {isApplyingFix ? 'AI đang xử lý...' : 'Áp dụng AI Optimize (Rút gọn)'}
                  </button>
                  {isApplyingFix && <button onClick={() => cancelOptimizeRef.current = true} className="px-8 py-4 bg-slate-800 text-red-400 font-bold rounded-2xl border border-red-500/30">Hủy</button>}
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
                   <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                     <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2"><ListChecks size={16}/> Danh sách đề xuất tối ưu</h3>
                     <button onClick={downloadOptimized} className="text-[10px] font-bold text-emerald-400 uppercase flex items-center gap-1 hover:underline"><Download size={14}/> Xuất file [Optimized]</button>
                   </div>
                   <div className="p-6 max-h-[600px] overflow-y-auto space-y-4 custom-scrollbar">
                     {hybridResults.length === 0 ? <p className="text-center text-slate-500 text-xs py-20 italic">Không có đề xuất nào cần thực hiện.</p> : hybridResults.map(s => (
                       <div key={s.id} className={`p-5 rounded-2xl border transition-all ${s.status === 'applied' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-950/40 border-slate-800'}`}>
                         <div className="flex justify-between items-center mb-4">
                           <div className="flex items-center gap-3">
                             <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${s.type === 'ai' ? 'bg-red-500/20 text-red-400' : 'bg-indigo-500/20 text-indigo-400'}`}>{s.type}</span>
                             <span className="text-[10px] font-mono text-slate-500">Đoạn #{s.index} | {s.cps.toFixed(1)} CPS</span>
                           </div>
                           {s.status === 'applied' && <CheckCircle2 className="text-emerald-500" size={16} />}
                         </div>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           <div className="space-y-1">
                             <p className="text-[9px] text-slate-600 uppercase font-bold">Hiện tại:</p>
                             <div className="p-3 bg-slate-900 rounded-xl text-xs text-slate-500 font-mono">{s.beforeTimestamp}</div>
                             <div className="p-3 bg-slate-900 rounded-xl text-xs text-slate-500">{s.beforeText}</div>
                           </div>
                           <div className="space-y-1">
                             <p className="text-[9px] text-emerald-500 uppercase font-bold">Đề xuất:</p>
                             <div className={`p-3 rounded-xl text-xs font-mono ${s.afterTimestamp !== s.beforeTimestamp ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-900 text-slate-500'}`}>{s.afterTimestamp}</div>
                             <div className={`p-3 rounded-xl text-xs ${s.afterText !== s.beforeText ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold' : 'bg-slate-900 text-slate-500'}`}>{s.afterText}</div>
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
      <footer className="p-4 text-center text-slate-700 text-[9px] uppercase tracking-[0.5em] font-bold">Donghua AI Subtitle System • v4.0 Hybrid Fast + AI Mode</footer>
    </div>
  );
};

export default App;

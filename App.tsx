
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Play, CheckCircle2, AlertCircle, Loader2, Trash2, 
  FileText, Search, Sparkles, ChevronRight, Activity, Cpu, FileDown, 
  RefreshCw, Box, Tags, BookOpen, Target, FileSearch, Info, History,
  Clock, FastForward, Zap, Settings, Languages, BrainCircuit, Key, Save,
  Maximize2, Layers, CheckSquare, Square, PlusCircle, AlertTriangle,
  Brain, FileJson, FileUp, Sparkle, Scissors, ListChecks, XCircle
} from 'lucide-react';
import { TitleAnalysis, SubtitleBlock, TranslationState, SessionStats, InterruptionInfo, AiProvider, ProposedChange, AutoOptimizeSuggestion } from './types';
import { parseSRT, stringifySRT, extractChineseTitle, generateFileName, adjustSrtTiming, findMissingSegments, mergeSRT, timestampToMs } from './utils/srtParser';
import { translateSubtitles, analyzeTitle, checkApiHealth, analyzeSrtBatch } from './services/aiService';

const AI_MODELS = [
  { id: 'Gemini 2.5 Flash', name: 'Gemini 2.5 Flash' },
  { id: 'Gemini 2.5 Pro', name: 'Gemini 2.5 Pro' },
  { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
  { id: 'gpt-4.1-mini', name: 'gpt-4.1-mini' },
  { id: 'gpt-4.1', name: 'gpt-4.1' },
];

const SPEED_PRESETS = [0.7, 0.8, 0.9, 1.1, 1.2, 1.3];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'translator' | 'speed-editor' | 'optimizer'>('translator');
  
  // Translator & General States
  const [blocks, setBlocks] = useState<SubtitleBlock[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isDraggingMain, setIsDraggingMain] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [detectedTitle, setDetectedTitle] = useState<string>('');
  const [analysis, setAnalysis] = useState<TitleAnalysis | null>(null);
  const [stats, setStats] = useState<SessionStats>({ requests: 0, totalTokens: 0, translatedBlocks: 0 });
  const [status, setStatus] = useState<TranslationState>({
    isTranslating: false, isAnalyzing: false, progress: 0, total: 0,
    error: null, interruption: null, fileStatus: null,
    apiStatus: 'checking', selectedModel: 'Gemini 2.5 Flash'
  });

  // Speed Editor State
  const [speed, setSpeed] = useState<number>(1.0);

  // Optimizer States
  const [optimizerMode, setOptimizerMode] = useState<'merge' | 'auto'>('merge');
  const [hardBlocks, setHardBlocks] = useState<SubtitleBlock[]>([]);
  const [softBlocks, setSoftBlocks] = useState<SubtitleBlock[]>([]);
  const [hardFileName, setHardFileName] = useState<string>('');
  const [softFileName, setSoftFileName] = useState<string>('');
  const [isDraggingHard, setIsDraggingHard] = useState(false);
  const [isDraggingSoft, setIsDraggingSoft] = useState(false);
  const [proposedChanges, setProposedChanges] = useState<ProposedChange[]>([]);
  const [autoSuggestions, setAutoSuggestions] = useState<AutoOptimizeSuggestion[]>([]);
  const [selectedChangeIds, setSelectedChangeIds] = useState<Set<string>>(new Set());
  const [optimizerError, setOptimizerError] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState({ current: 0, total: 0 });
  const [isAnalysisCancelled, setIsAnalysisCancelled] = useState(false);
  const cancelRef = useRef(false);

  // Single Auto Optimizer State
  const [singleFileBlocks, setSingleFileBlocks] = useState<SubtitleBlock[]>([]);
  const [singleFileName, setSingleFileName] = useState<string>('');
  const [isDraggingSingle, setIsDraggingSingle] = useState(false);

  const progressPercentage = status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0;

  useEffect(() => {
    const timer = setTimeout(async () => {
      setStatus(prev => ({ ...prev, apiStatus: 'checking' }));
      const isValid = await checkApiHealth(status.selectedModel);
      const isOpenAi = status.selectedModel.toLowerCase().includes('gpt');
      let finalStatus: 'valid' | 'invalid' | 'unknown' = 'unknown';
      if (isValid) finalStatus = 'valid';
      else if (isOpenAi) finalStatus = 'invalid';
      setStatus(prev => ({ ...prev, apiStatus: finalStatus }));
    }, 800);
    return () => clearTimeout(timer);
  }, [status.selectedModel]);

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
        if (!/[\u4e00-\u9fa5]/.test(block.originalText)) return { ...block, translatedText: block.originalText };
        return block;
      });
      setBlocks(processedBlocks);
      setStatus(prev => ({ ...prev, total: processedBlocks.length, progress: processedBlocks.filter(b => b.translatedText).length, error: null }));
      if (activeTab === 'translator') handleAnalyze(title);
    };
    reader.readAsText(file);
  };

  const handleAnalyze = async (title: string) => {
    if (!title.trim() || status.isAnalyzing) return;
    setStatus(prev => ({ ...prev, isAnalyzing: true, error: null }));
    try {
      const { analysis: result, tokens } = await analyzeTitle(title, status.selectedModel);
      setAnalysis(result);
      setStats(prev => ({ ...prev, requests: prev.requests + 1, totalTokens: prev.totalTokens + tokens }));
    } catch (err: any) {
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
      });
      setBlocks(translated);
      setStatus(prev => ({ ...prev, isTranslating: false, fileStatus: 'completed' }));
    } catch (err: any) {
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

  const handleUploadOptimizer = (file: File, type: 'hard' | 'soft' | 'single') => {
    if (!file.name.toLowerCase().endsWith('.srt')) {
      setOptimizerError("Vui lòng upload file .srt");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseSRT(e.target?.result as string);
      if (type === 'hard') {
        setHardBlocks(parsed);
        setHardFileName(file.name);
      } else if (type === 'soft') {
        setSoftBlocks(parsed);
        setSoftFileName(file.name);
      } else {
        setSingleFileBlocks(parsed);
        setSingleFileName(file.name);
      }
      setOptimizerError(null);
    };
    reader.readAsText(file);
  };

  const runAnalysis = () => {
    if (optimizerMode === 'merge') {
      if (hardBlocks.length === 0 || softBlocks.length === 0) {
        setOptimizerError("Cần upload cả Hard và Soft SRT.");
        return;
      }
      setIsOptimizing(true);
      setTimeout(() => {
        const missing = findMissingSegments(hardBlocks, softBlocks);
        setProposedChanges(missing);
        setSelectedChangeIds(new Set(missing.filter(m => m.isValid).map(m => m.id)));
        setIsOptimizing(false);
        if (missing.length === 0) setOptimizerError("Không tìm thấy đoạn thiếu nào từ Soft SRT.");
      }, 800);
    } else {
      if (singleFileBlocks.length === 0) {
        setOptimizerError("Vui lòng upload file SRT cần tối ưu.");
        return;
      }
      handleAutoOptimize();
    }
  };

  const handleAutoOptimize = async () => {
    setIsOptimizing(true);
    setOptimizerError(null);
    setAutoSuggestions([]);
    setSelectedChangeIds(new Set());
    setIsAnalysisCancelled(false);
    cancelRef.current = false;
    setOptimizeProgress({ current: 0, total: singleFileBlocks.length });

    const CHUNK_SIZE = 25;
    try {
      for (let i = 0; i < singleFileBlocks.length; i += CHUNK_SIZE) {
        if (cancelRef.current) {
          setIsAnalysisCancelled(true);
          break;
        }

        const chunk = singleFileBlocks.slice(i, i + CHUNK_SIZE).map(b => ({ id: b.index, ts: b.timestamp, text: b.originalText, charCount: b.originalText.length }));
        const { suggestions, tokens } = await analyzeSrtBatch(chunk, status.selectedModel);
        
        setAutoSuggestions(prev => {
          const updated = [...prev, ...suggestions];
          setSelectedChangeIds(ids => {
            const next = new Set(ids);
            suggestions.forEach(s => next.add(s.id));
            return next;
          });
          return updated;
        });

        setOptimizeProgress(prev => ({ ...prev, current: Math.min(i + CHUNK_SIZE, singleFileBlocks.length) }));
        setStats(prev => ({ ...prev, totalTokens: prev.totalTokens + tokens }));
        await new Promise(r => setTimeout(r, 400)); 
      }
    } catch (err: any) {
      setOptimizerError(err.message || "Lỗi khi phân tích tối ưu hóa.");
    } finally {
      setIsOptimizing(false);
    }
  };

  const cancelAnalysis = () => {
    cancelRef.current = true;
  };

  const toggleSelectAll = () => {
    if (optimizerMode === 'merge') {
      const validChanges = proposedChanges.filter(c => c.isValid);
      if (selectedChangeIds.size === validChanges.length) setSelectedChangeIds(new Set());
      else setSelectedChangeIds(new Set(validChanges.map(m => m.id)));
    } else {
      if (selectedChangeIds.size === autoSuggestions.length) setSelectedChangeIds(new Set());
      else setSelectedChangeIds(new Set(autoSuggestions.map(s => s.id)));
    }
  };

  const toggleChange = (id: string, isValid: boolean = true) => {
    if (!isValid) return;
    const next = new Set(selectedChangeIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedChangeIds(next);
  };

  const applyOptimization = () => {
    if (optimizerMode === 'merge') {
      const selected = proposedChanges.filter(c => selectedChangeIds.has(c.id));
      const merged = mergeSRT(hardBlocks, selected);
      const content = stringifySRT(merged);
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const newName = generateFileName(hardFileName, true, undefined, true);
      const a = document.createElement('a');
      a.href = url;
      a.download = newName;
      a.click();
      setProposedChanges([]);
      setHardBlocks([]);
      setSoftBlocks([]);
      setHardFileName('');
      setSoftFileName('');
      alert(`Đã gộp thành công!`);
    } else {
      const selectedIds = Array.from(selectedChangeIds);
      const suggestionsToApply = autoSuggestions.filter(s => selectedIds.includes(s.id));
      let optimizedBlocks = [...singleFileBlocks];
      const sortedSuggestions = [...suggestionsToApply].sort((a, b) => {
        const idxA = parseInt(a.indices[0]);
        const idxB = parseInt(b.indices[0]);
        return idxB - idxA;
      });

      sortedSuggestions.forEach(s => {
        const targetIndices = s.indices.map(i => parseInt(i));
        const minIdx = Math.min(...targetIndices);
        if (s.type === 'delete') {
          optimizedBlocks = optimizedBlocks.filter(b => !targetIndices.includes(parseInt(b.index)));
        } else if (s.type === 'merge' || s.type === 'edit') {
          const firstBlockIdx = optimizedBlocks.findIndex(b => parseInt(b.index) === minIdx);
          if (firstBlockIdx !== -1) {
            optimizedBlocks[firstBlockIdx].originalText = s.after;
            if (s.proposedTimestamp) optimizedBlocks[firstBlockIdx].timestamp = s.proposedTimestamp;
            const otherIndices = targetIndices.filter(i => i !== minIdx);
            optimizedBlocks = optimizedBlocks.filter(b => !otherIndices.includes(parseInt(b.index)));
          }
        } else if (s.type === 'adjust') {
          const targetBlock = optimizedBlocks.find(b => parseInt(b.index) === minIdx);
          if (targetBlock && s.proposedTimestamp) targetBlock.timestamp = s.proposedTimestamp;
        }
      });

      const finalBlocks = optimizedBlocks.map((b, i) => ({ ...b, index: (i + 1).toString() }));
      const content = stringifySRT(finalBlocks);
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const newName = `[TimingFixed]_` + (singleFileName || 'optimized.srt');
      const a = document.createElement('a');
      a.href = url;
      a.download = newName;
      a.click();
      setAutoSuggestions([]);
      setSingleFileBlocks([]);
      setSingleFileName('');
      alert(`Đã sửa timing thành công!`);
    }
  };

  const downloadChangesOnly = () => {
    const selected = proposedChanges.filter(c => selectedChangeIds.has(c.id));
    if (selected.length === 0) return;
    const deltaBlocks: SubtitleBlock[] = selected.map((c, idx) => ({
      index: (idx + 1).toString(),
      timestamp: `${c.start} --> ${c.end}`,
      originalText: c.text
    }));
    const content = stringifySRT(deltaBlocks);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const newName = `[Changes-Only]_` + (hardFileName || 'optimized.srt');
    const a = document.createElement('a');
    a.href = url;
    a.download = newName;
    a.click();
  };

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
              <Languages size={14} /> Dịch SRT
            </button>
            <button onClick={() => setActiveTab('speed-editor')} className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'speed-editor' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}>
              <Clock size={14} /> Tốc độ
            </button>
            <button onClick={() => setActiveTab('optimizer')} className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'optimizer' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}>
              <Layers size={14} /> SRT Optimizer
            </button>
          </nav>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${status.apiStatus === 'valid' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : status.apiStatus === 'checking' ? 'bg-amber-500 animate-pulse' : status.apiStatus === 'invalid' ? 'bg-red-500' : 'bg-slate-600'}`} />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">API STATUS</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">
        {activeTab === 'translator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-500">
            <div className="lg:col-span-5 space-y-6">
              <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
                <h2 className="text-xs font-bold mb-6 flex items-center gap-2 text-indigo-400 uppercase tracking-widest"><Settings size={16} /> Cấu hình Model AI</h2>
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">🤖 Chọn Model AI</label>
                    <div className="relative">
                      <select 
                        value={status.selectedModel} 
                        onChange={(e) => setStatus(prev => ({ ...prev, selectedModel: e.target.value, error: null }))} 
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm font-bold text-white focus:outline-none appearance-none cursor-pointer"
                      >
                        {AI_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                        <ChevronRight className="rotate-90" size={16} />
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
                <h2 className="text-xs font-bold mb-4 flex items-center gap-2 text-indigo-400 uppercase tracking-widest">📁 Upload file SRT</h2>
                {!fileName ? (
                  <div 
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingMain(true); }}
                    onDragLeave={() => setIsDraggingMain(false)}
                    onDrop={(e) => { e.preventDefault(); setIsDraggingMain(false); const f = e.dataTransfer.files[0]; if(f) processFile(f); }}
                    onClick={() => fileInputRef.current?.click()} 
                    className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer transition-all ${isDraggingMain ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 hover:border-indigo-500 hover:bg-indigo-500/5'}`}
                  >
                    <Upload className="text-slate-500 mb-2" size={40} />
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Chọn file hoặc kéo thả</p>
                    <input type="file" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if(f) processFile(f); }} accept=".srt" className="hidden" />
                  </div>
                ) : (
                  <div className="p-4 bg-indigo-600/10 border border-indigo-500/30 rounded-2xl relative">
                    <p className="text-sm font-bold text-white pr-8 break-all">{fileName}</p>
                    <button onClick={() => { setFileName(''); setBlocks([]); setAnalysis(null); }} className="absolute top-4 right-4 text-slate-500 hover:text-red-400"><Trash2 size={16} /></button>
                  </div>
                )}
              </section>
              {analysis && (
                <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
                  <div className="p-4 bg-slate-800/40 rounded-2xl space-y-2">
                    <p className="text-sm font-bold text-indigo-400">{analysis.translatedTitle}</p>
                    <div className="flex flex-wrap gap-1">
                      {analysis.mainGenres.map(g => <span key={g} className="px-2 py-0.5 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded text-[9px] font-bold">{g}</span>)}
                    </div>
                  </div>
                  {!status.isTranslating && !status.fileStatus && (
                    <button onClick={startTranslation} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2">
                      <Play size={20} fill="currentColor" /> Bắt đầu dịch AI
                    </button>
                  )}
                  {status.isTranslating && (
                    <div className="space-y-3">
                      <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                        <span>Đang dịch: {status.progress}/{status.total}</span>
                        <span>{progressPercentage}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500" style={{ width: `${progressPercentage}%` }} />
                      </div>
                    </div>
                  )}
                  {status.fileStatus === 'completed' && (
                    <button onClick={() => downloadSRT()} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2">
                      <Download size={20} /> Tải file SRT đã dịch
                    </button>
                  )}
                </section>
              )}
            </div>
            <div className="lg:col-span-7 h-[calc(100vh-12rem)] bg-slate-900 border border-slate-800 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
              <div className="p-4 border-b border-slate-800 flex justify-between items-center px-8">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Preview Monitor</span>
                <span className="text-[10px] font-bold text-indigo-400 uppercase">{status.selectedModel}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                {blocks.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-20">
                    <Box size={80} strokeWidth={0.5} className="mb-4" />
                    <p className="text-xs font-bold uppercase tracking-widest">Chưa có dữ liệu</p>
                  </div>
                ) : (
                  blocks.slice(0, 50).map((block) => (
                    <div key={block.index} className="bg-slate-950/50 p-4 rounded-2xl border border-slate-800 grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-[9px] text-slate-600 font-mono">#{block.index}</span>
                        <p className="text-xs text-slate-400 italic">{block.originalText}</p>
                      </div>
                      <div className="border-l border-slate-800 pl-4 flex items-center">
                        {block.translatedText ? <p className="text-[13px] text-slate-100 font-serif-vi font-bold">{block.translatedText}</p> : <div className="h-2 w-full bg-slate-800 rounded animate-pulse" />}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'optimizer' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-center mb-8">
              <div className="bg-slate-900/80 p-1.5 rounded-2xl border border-slate-800 flex gap-2">
                <button onClick={() => setOptimizerMode('merge')} className={`px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${optimizerMode === 'merge' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}><Layers size={16}/> Soft + Hard Merge</button>
                <button onClick={() => setOptimizerMode('auto')} className={`px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${optimizerMode === 'auto' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}><BrainCircuit size={16}/> TIMING-ONLY Check</button>
              </div>
            </div>

            {optimizerMode === 'merge' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                  <h3 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2"><FileText size={14}/> 1. Hard SRT (Master/OCR)</h3>
                  {!hardFileName ? (
                    <div 
                      onDragOver={(e) => { e.preventDefault(); setIsDraggingHard(true); }}
                      onDragLeave={() => setIsDraggingHard(false)}
                      onDrop={(e) => { e.preventDefault(); setIsDraggingHard(false); const f = e.dataTransfer.files[0]; if(f) handleUploadOptimizer(f, 'hard'); }}
                      onClick={() => { const i = document.createElement('input'); i.type='file'; i.accept='.srt'; i.onchange=(e:any)=>handleUploadOptimizer(e.target.files[0], 'hard'); i.click(); }} 
                      className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${isDraggingHard ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 hover:border-indigo-500'}`}
                    >
                      <Upload className="mx-auto text-slate-500 mb-2" size={32} />
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Bấm hoặc kéo thả file Hard SRT</p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-xl"><span className="text-xs font-bold text-white truncate max-w-[80%]">{hardFileName}</span><button onClick={() => {setHardFileName(''); setHardBlocks([]);}} className="text-red-400 p-1 hover:bg-red-400/10 rounded-lg"><Trash2 size={14}/></button></div>
                  )}
                </section>
                <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                  <h3 className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Activity size={14}/> 2. Soft SRT (Audio)</h3>
                  {!softFileName ? (
                    <div 
                      onDragOver={(e) => { e.preventDefault(); setIsDraggingSoft(true); }}
                      onDragLeave={() => setIsDraggingSoft(false)}
                      onDrop={(e) => { e.preventDefault(); setIsDraggingSoft(false); const f = e.dataTransfer.files[0]; if(f) handleUploadOptimizer(f, 'soft'); }}
                      onClick={() => { const i = document.createElement('input'); i.type='file'; i.accept='.srt'; i.onchange=(e:any)=>handleUploadOptimizer(e.target.files[0], 'soft'); i.click(); }} 
                      className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${isDraggingSoft ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-700 hover:border-cyan-500'}`}
                    >
                      <Upload className="mx-auto text-slate-500 mb-2" size={32} />
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Bấm hoặc kéo thả file Soft SRT</p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-3 bg-cyan-500/5 border border-cyan-500/20 rounded-xl"><span className="text-xs font-bold text-white truncate max-w-[80%]">{softFileName}</span><button onClick={() => {setSoftFileName(''); setSoftBlocks([]);}} className="text-red-400 p-1 hover:bg-red-400/10 rounded-lg"><Trash2 size={14}/></button></div>
                  )}
                </section>
              </div>
            ) : (
              <section className="bg-slate-900 border border-slate-800 rounded-3xl p-10 shadow-xl max-w-2xl mx-auto">
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-indigo-600/20 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-indigo-500/30"><Brain className="text-indigo-400" size={32}/></div>
                  <h3 className="text-lg font-bold text-white mb-2">Timing-Only Optimizer</h3>
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-[10px] text-amber-500 font-bold uppercase tracking-widest mb-4">
                    <Activity size={12}/> TECHNICAL STRICT MODE: Chỉ sửa Overlap & Speed
                  </div>
                  <p className="text-slate-400 text-xs">Phát hiện chồng chéo thời gian và tốc độ đọc quá cao. Không can thiệp nội dung.</p>
                </div>
                {!singleFileName ? (
                  <div 
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingSingle(true); }}
                    onDragLeave={() => setIsDraggingSingle(false)}
                    onDrop={(e) => { e.preventDefault(); setIsDraggingSingle(false); const f = e.dataTransfer.files[0]; if(f) handleUploadOptimizer(f, 'single'); }}
                    onClick={() => { const i = document.createElement('input'); i.type='file'; i.accept='.srt'; i.onchange=(e:any)=>handleUploadOptimizer(e.target.files[0], 'single'); i.click(); }} 
                    className={`border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer transition-all ${isDraggingSingle ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 hover:border-indigo-500 hover:bg-indigo-500/5'}`}
                  >
                    <FileUp className="mx-auto text-slate-500 mb-4" size={48} />
                    <p className="text-sm text-slate-300 font-bold uppercase tracking-widest">Kéo thả file SRT vào đây</p>
                    <p className="text-xs text-slate-500 mt-2">Chỉ chấp nhận file .srt</p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl">
                    <div className="flex items-center gap-3"><FileText className="text-indigo-400" size={24}/><span className="text-sm font-bold text-white">{singleFileName}</span></div>
                    <button onClick={() => {setSingleFileName(''); setSingleFileBlocks([]); setAutoSuggestions([]);}} className="text-red-400 p-2 hover:bg-red-400/10 rounded-xl"><Trash2 size={18}/></button>
                  </div>
                )}
              </section>
            )}

            <div className="flex justify-center flex-col items-center gap-4">
              <div className="flex gap-4">
                <button onClick={runAnalysis} disabled={isOptimizing || (optimizerMode === 'merge' ? (!hardFileName || !softFileName) : !singleFileName)} className="px-12 py-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 text-white font-bold rounded-2xl shadow-xl flex items-center gap-3 transition-all active:scale-95">
                  {isOptimizing ? <Loader2 className="animate-spin" size={20}/> : <Zap size={20}/>} {isOptimizing ? "Đang kiểm tra timing..." : "Bắt đầu kiểm tra Kỹ thuật"}
                </button>
                {isOptimizing && (
                   <button onClick={cancelAnalysis} className="px-6 py-4 bg-red-600/20 hover:bg-red-600/40 text-red-400 font-bold rounded-2xl border border-red-500/30 flex items-center gap-2 transition-all">
                      <XCircle size={20}/> HỦY KIỂM TRA
                   </button>
                )}
              </div>
              
              {(isOptimizing || isAnalysisCancelled) && optimizerMode === 'auto' && (
                <div className="w-full max-w-lg space-y-2 animate-in fade-in">
                  <div className="flex justify-between text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                    <span>{isAnalysisCancelled ? "⛔ Đã dừng phân tích" : `⏳ Đang kiểm tra đoạn ${optimizeProgress.current} / ${optimizeProgress.total}`}</span>
                    <span>{Math.round((optimizeProgress.current / (optimizeProgress.total || 1)) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full transition-all duration-500 ${isAnalysisCancelled ? 'bg-red-500' : 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]'}`} style={{ width: `${(optimizeProgress.current / (optimizeProgress.total || 1)) * 100}%` }} />
                  </div>
                  <p className="text-[10px] text-slate-500 text-center italic">Phát hiện {autoSuggestions.length} vấn đề Timing / Overlap</p>
                </div>
              )}
            </div>

            {optimizerError && <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-xs font-bold text-center">{optimizerError}</div>}

            {optimizerMode === 'auto' && autoSuggestions.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] overflow-hidden shadow-2xl animate-in slide-in-from-bottom-8">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/80 backdrop-blur-md sticky top-0 z-10">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2"><Target size={16}/> ĐỀ XUẤT SỬA LỖI TIMING ({autoSuggestions.length})</h3>
                    {isOptimizing && <p className="text-[10px] text-amber-400 animate-pulse font-bold flex items-center gap-1"><RefreshCw size={10} className="animate-spin"/> AI ĐANG KIỂM TRA TIẾP...</p>}
                  </div>
                  <button onClick={toggleSelectAll} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold uppercase rounded-xl transition-all border border-slate-700">
                    {selectedChangeIds.size === autoSuggestions.length ? "Hủy chọn tất cả" : "Chọn tất cả"}
                  </button>
                </div>
                <div className="p-6 max-h-[550px] overflow-y-auto space-y-6 custom-scrollbar">
                  {autoSuggestions.map((s) => (
                    <div key={s.id} onClick={() => toggleChange(s.id)} className={`p-6 rounded-3xl border transition-all flex items-start gap-6 cursor-pointer ${selectedChangeIds.has(s.id) ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'}`}>
                      <div className="mt-1">{selectedChangeIds.has(s.id) ? <CheckSquare className="text-indigo-400" size={24}/> : <Square className="text-slate-600" size={24}/>}</div>
                      <div className="flex-1 space-y-4">
                        <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-400">
                             <Clock size={14}/> {s.reason === 'Overlap' ? 'LỖI CHỒNG CHÉO THỜI GIAN' : 'TỐC ĐỘ ĐỌC QUÁ CAO'} (Đoạn {s.indices.join(', ')})
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                           <div className="space-y-1"><span className="text-[10px] font-bold text-slate-500 uppercase">Gốc:</span><div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800 text-xs text-slate-400 font-mono">{s.before}</div></div>
                           <div className="space-y-1"><span className="text-[10px] font-bold text-emerald-500 uppercase">Đề xuất:</span><div className="p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/30 text-xs text-white font-bold font-mono">{s.after}</div></div>
                        </div>
                        <div className="bg-slate-800/50 p-3 rounded-2xl border border-slate-700/50">
                          <p className="text-[10px] text-indigo-300 font-bold flex items-center gap-2 uppercase tracking-widest"><Info size={14}/> Giải pháp Kỹ thuật:</p>
                          <p className="text-[11px] text-slate-300 leading-relaxed italic mt-1">{s.explanation}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {isOptimizing && (
                    <div className="p-12 border-2 border-dashed border-slate-800 rounded-3xl flex flex-col items-center justify-center opacity-40">
                      <Loader2 size={32} className="animate-spin mb-2 text-indigo-500"/>
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em]">AI đang quét kỹ thuật các đoạn tiếp theo...</p>
                    </div>
                  )}
                </div>
                <div className="p-6 border-t border-slate-800 bg-slate-900/80 flex gap-4">
                  <button onClick={applyOptimization} disabled={selectedChangeIds.size === 0} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-30 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/20 active:scale-95"><CheckCircle2 size={20}/> ÁP DỤNG {selectedChangeIds.size} SỬA ĐỔI & XUẤT FILE [TimingFixed]</button>
                  <button onClick={() => { setAutoSuggestions([]); setSelectedChangeIds(new Set()); }} className="px-8 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl transition-all">HỦY</button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
      <footer className="p-4 text-center border-t border-slate-900 bg-slate-950/80 mt-auto">
        <p className="text-slate-700 text-[9px] uppercase tracking-[0.5em] font-bold">Donghua AI Subtitle System • v3.9 Timing-Only Mode</p>
      </footer>
    </div>
  );
};

export default App;

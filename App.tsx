
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Play, CheckCircle2, AlertCircle, Loader2, Trash2, 
  FileText, Search, Sparkles, ChevronRight, Activity, Cpu, FileDown, 
  RefreshCw, Box, Tags, BookOpen, Target, FileSearch, Info, History,
  Clock, FastForward, Zap, Settings, Languages
} from 'lucide-react';
import { TitleAnalysis, SubtitleBlock, TranslationState, SessionStats, InterruptionInfo } from './types';
import { parseSRT, stringifySRT, extractChineseTitle, generateFileName, adjustSrtTiming } from './utils/srtParser';
import { translateSubtitles, analyzeTitle, checkApiHealth } from './services/geminiService';

const MODELS = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', desc: 'Nhanh, Hiệu quả' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', desc: 'Thông minh, Chất lượng cao' },
];

// Cập nhật presets theo yêu cầu mới nhất: [ 0.7 ] [ 0.8 ] [ 0.9 ] [ 1.1 ] [ 1.2 ] [ 1.3 ]
const SPEED_PRESETS = [0.7, 0.8, 0.9, 1.1, 1.2, 1.3];

const App: React.FC = () => {
  // Shared State
  const [activeTab, setActiveTab] = useState<'translator' | 'speed-editor'>('translator');
  const [blocks, setBlocks] = useState<SubtitleBlock[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Translator State
  const [detectedTitle, setDetectedTitle] = useState<string>('');
  const [analysis, setAnalysis] = useState<TitleAnalysis | null>(null);
  const [stats, setStats] = useState<SessionStats>({ requests: 0, totalTokens: 0, translatedBlocks: 0 });
  const [status, setStatus] = useState<TranslationState>({
    isTranslating: false, isAnalyzing: false, progress: 0, total: 0,
    error: null, interruption: null, fileStatus: null,
    apiStatus: 'checking', selectedModel: 'gemini-3-flash-preview'
  });

  // Speed Editor State
  const [speed, setSpeed] = useState<number>(1.0);

  useEffect(() => {
    const verifyKey = async () => {
      const isValid = await checkApiHealth(status.selectedModel);
      setStatus(prev => ({ ...prev, apiStatus: isValid ? 'valid' : 'invalid' }));
    };
    verifyKey();
  }, [status.selectedModel]);

  const containsChinese = (text: string) => /[\u4e00-\u9fa5]/.test(text);

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
      
      let translatedCount = 0;
      const processedBlocks = parsed.map(block => {
        if (!containsChinese(block.originalText)) {
          translatedCount++;
          return { ...block, translatedText: block.originalText };
        }
        return block;
      });

      let fileStatus: 'new' | 'mixed' | 'completed' = 'new';
      if (translatedCount === parsed.length) fileStatus = 'completed';
      else if (translatedCount > 0) fileStatus = 'mixed';

      setBlocks(processedBlocks);
      setStatus(prev => ({ 
        ...prev, total: processedBlocks.length, progress: translatedCount, 
        error: null, interruption: null, fileStatus
      }));
      setStats(prev => ({ ...prev, translatedBlocks: translatedCount }));
      
      if (activeTab === 'translator') handleAnalyze(title);
    };
    reader.readAsText(file);
  };

  const handleAnalyze = async (title: string) => {
    if (!title.trim() || status.isAnalyzing) return;
    setStatus(prev => ({ ...prev, isAnalyzing: true, error: null, interruption: null }));
    try {
      const { analysis: result, tokens } = await analyzeTitle(title, status.selectedModel);
      setAnalysis(result);
      setStats(prev => ({ ...prev, requests: prev.requests + 1, totalTokens: prev.totalTokens + tokens }));
    } catch (err: any) {
      setStatus(prev => ({ ...prev, error: "Lỗi kết nối API phân tích tiêu đề." }));
    } finally {
      setStatus(prev => ({ ...prev, isAnalyzing: false }));
    }
  };

  const applySpeed = () => {
    if (blocks.length === 0) return;
    const adjusted = adjustSrtTiming(blocks, speed);
    setBlocks(adjusted);
    
    // Download logic for speed editor
    const content = stringifySRT(adjusted);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const newName = generateFileName(fileName, false, speed);
    const a = document.createElement('a');
    a.href = url;
    a.download = newName;
    a.click();
    setFileName(newName);
  };

  const startTranslation = async () => {
    if (blocks.length === 0 || !analysis) return;
    setStatus(prev => ({ ...prev, isTranslating: true, error: null, interruption: null }));
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
      setStatus(prev => ({ ...prev, isTranslating: false, fileStatus: 'completed' }));
    } catch (err: any) {
      const errStr = err?.toString() || "";
      let reason = "Khác: mô tả ngắn gọn";
      if (errStr.includes("429")) reason = "Hết quota API";
      else if (errStr.toLowerCase().includes("limit")) reason = "Quá giới hạn token";
      else if (errStr.toLowerCase().includes("timeout")) reason = "Timeout / mạng không ổn định";

      const currentTranslated = blocks.filter(b => b.translatedText && !containsChinese(b.translatedText)).length;
      setStatus(prev => ({ 
        ...prev, isTranslating: false, 
        interruption: {
          reason, total: prev.total, translated: currentTranslated, remaining: prev.total - currentTranslated
        }
      }));
    }
  };

  const downloadTranslated = (isPartial = false) => {
    const content = stringifySRT(blocks);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const newName = generateFileName(fileName, !isPartial);
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
            <button 
              onClick={() => setActiveTab('translator')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'translator' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Languages size={14} /> Dịch Phụ Đề (AI)
            </button>
            <button 
              onClick={() => setActiveTab('speed-editor')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'speed-editor' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Clock size={14} /> Chỉnh Tốc Độ
            </button>
          </nav>

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
               <button onClick={() => window.location.reload()} className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-all" title="Làm mới hệ thống">
                 <Trash2 size={18} />
               </button>
             )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-6">
          
          {/* Section A: Upload SRT */}
          <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
            <h2 className="text-xs font-bold mb-4 flex items-center gap-2 text-indigo-400 uppercase tracking-widest">
              <Box size={16} /> 📁 Upload file SRT
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
                <button onClick={() => { setFileName(''); setBlocks([]); setAnalysis(null); setDetectedTitle(''); }} className="absolute top-2 right-2 p-1 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </section>

          {/* Tab Content: Translator */}
          {activeTab === 'translator' && (
            <div className="space-y-6 animate-in slide-in-from-left-4 duration-500">
              <section className={`bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl transition-all ${!fileName ? 'opacity-30 pointer-events-none' : ''}`}>
                <h2 className="text-xs font-bold mb-6 flex items-center gap-2 text-indigo-400 uppercase tracking-widest">
                  <FileSearch size={16} /> Phân tích Tiêu đề (ZH)
                </h2>
                {status.isAnalyzing ? (
                  <div className="flex items-center justify-center py-8 gap-3 text-indigo-400">
                    <Loader2 className="animate-spin" size={20} />
                    <span className="text-xs font-bold uppercase tracking-widest">AI đang thẩm thấu cốt truyện...</span>
                  </div>
                ) : analysis ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-slate-800/40 border border-slate-700 rounded-2xl space-y-4 shadow-inner">
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">📌 TIÊU ĐỀ NHẬN DIỆN (ZH):</span>
                        <p className="text-sm font-bold text-white pl-2 break-words leading-relaxed">{detectedTitle}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">🇻🇳 TIÊU ĐỀ VIỆT GỢI Ý:</span>
                        <p className="text-lg font-bold text-indigo-400 pl-2 leading-tight">{analysis.translatedTitle}</p>
                      </div>
                      <div className="space-y-2">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">🎬 THỂ LOẠI:</span>
                        <div className="flex flex-wrap gap-2">
                          {analysis.mainGenres.map(g => <span key={g} className="px-3 py-1 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded-lg text-[9px] font-bold">{g}</span>)}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">📖 TÓM TẮT:</span>
                        <p className="text-[12px] text-slate-300 leading-relaxed italic border-l-2 border-indigo-500/30 pl-3">"{analysis.summary}"</p>
                      </div>
                      <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-700/50">
                        <span className="text-[9px] font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1 mb-1"><Target size={12}/> PHONG CÁCH DỊCH:</span>
                        <p className="text-[11px] text-slate-400 leading-normal font-medium">{analysis.recommendedStyle}</p>
                      </div>
                    </div>
                  </div>
                ) : fileName && (
                  <button onClick={() => handleAnalyze(detectedTitle)} className="w-full py-3 bg-indigo-600/20 text-indigo-400 border border-indigo-600/30 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-600/30 transition-all">
                    Bắt đầu Phân tích Tiêu đề
                  </button>
                )}
              </section>

              <section className={`bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl transition-all ${!analysis ? 'opacity-30 pointer-events-none' : ''}`}>
                <h2 className="text-xs font-bold mb-6 flex items-center gap-2 text-indigo-400 uppercase tracking-widest">
                  <Zap size={16} /> Dịch thuật & Hoàn tất
                </h2>
                <div className="space-y-4">
                  {status.fileStatus === 'mixed' && (
                    <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-emerald-400">
                      <RefreshCw size={14} className="animate-spin-slow" />
                      <span className="text-[9px] font-bold uppercase tracking-widest">✅ PHÁT HIỆN FILE MIX — SẴN SÀNG DỊCH TIẾP</span>
                    </div>
                  )}
                  {status.fileStatus === 'completed' && (
                    <div className="px-4 py-2 bg-indigo-500/10 border border-indigo-500/30 rounded-xl flex items-center gap-2 text-indigo-400">
                      <CheckCircle2 size={14} />
                      <span className="text-[9px] font-bold uppercase tracking-widest">✅ FILE ĐÃ HOÀN TẤT — KHÔNG CẦN DỊCH TIẾP</span>
                    </div>
                  )}

                  {!status.isTranslating && status.fileStatus !== 'completed' && (
                    <button onClick={startTranslation} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-xl shadow-indigo-500/20 active:scale-[0.98] transition-all">
                      <Play size={20} fill="currentColor" /> {status.fileStatus === 'mixed' ? 'Dịch tiếp phần còn lại' : 'Bắt đầu dịch AI ngay'}
                    </button>
                  )}

                  {status.isTranslating && (
                    <div className="space-y-3 p-5 bg-slate-800/30 rounded-2xl border border-slate-700/50">
                      <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        <div className="flex items-center gap-2 text-indigo-400">
                          <Loader2 className="animate-spin" size={14} /> <span>Đang dịch: {status.progress}/{status.total}</span>
                        </div>
                        <span>{progressPercentage}%</span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden shadow-inner">
                        <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-300" style={{ width: `${progressPercentage}%` }} />
                      </div>
                    </div>
                  )}

                  {status.interruption && (
                    <div className="p-6 bg-red-950/20 border border-red-500/30 rounded-3xl space-y-4">
                      <div className="flex items-center gap-2 text-red-400 font-bold text-xs uppercase tracking-widest">
                        <AlertCircle size={18} /> ⚠️ DỊCH BỊ GIÁN ĐOẠN
                      </div>
                      <div className="space-y-3 text-[11px] text-slate-300 border-t border-red-500/10 pt-3">
                        <p><span className="text-red-400/80 font-bold">📌 NGUYÊN NHÂN:</span> {status.interruption.reason}</p>
                        <div className="space-y-1">
                          <p className="text-indigo-400 font-bold">📊 TIẾN ĐỘ ĐÃ HOÀN THÀNH:</p>
                          <ul className="pl-4 space-y-1 opacity-80">
                            <li>• Tổng số block: {status.interruption.total}</li>
                            <li>• Đã dịch sang Việt: {status.interruption.translated}</li>
                            <li>• Còn lại tiếng Trung: {status.interruption.remaining}</li>
                          </ul>
                        </div>
                        <div className="space-y-1">
                          <p className="text-amber-400 font-bold">📝 TRẠNG THÁI FILE ĐẦU RA:</p>
                          <p className="opacity-80 pl-2">File dở dang chứa cả VN + ZH. Có thể tải xuống và upload lại để dịch tiếp.</p>
                        </div>
                        <div className="p-3 bg-red-500/5 border border-red-500/10 rounded-xl text-slate-400 font-medium">
                          <span className="font-bold text-white flex items-center gap-1 mb-1"><Info size={12}/> HƯỚNG DẪN:</span>
                          Tải file dở dang → chờ 1 phút → upload lại → bấm “Dịch tiếp phần còn lại”.
                        </div>
                      </div>
                      <button onClick={() => downloadTranslated(true)} className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
                        <FileDown size={16} /> Tải file dở dang (.SRT)
                      </button>
                    </div>
                  )}

                  {status.fileStatus === 'completed' && !status.isTranslating && (
                    <button onClick={() => downloadTranslated(false)} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/20 transition-all">
                      <Download size={20} /> Tải file hoàn thiện (.SRT)
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* Tab Content: Speed Editor */}
          {activeTab === 'speed-editor' && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
              <section className={`bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl transition-all ${!fileName ? 'opacity-30 pointer-events-none' : ''}`}>
                <h2 className="text-xs font-bold mb-6 flex items-center gap-2 text-indigo-400 uppercase tracking-widest">
                  <Clock size={16} /> Speed Editor
                </h2>
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                      ⏱️ Nhập tốc độ phụ đề (Playback speed):
                    </label>
                    <div className="flex items-center gap-4">
                      <input 
                        type="number" 
                        step="0.01"
                        min="0.1"
                        max="5.0"
                        value={speed}
                        onChange={(e) => setSpeed(parseFloat(e.target.value) || 1.0)}
                        className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-lg font-bold text-white focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                      <div className="w-12 h-12 bg-indigo-600/20 border border-indigo-500/30 rounded-xl flex items-center justify-center">
                        <span className="text-indigo-400 font-bold">x</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Gợi ý nhanh:</label>
                    <div className="flex flex-wrap gap-2">
                      {SPEED_PRESETS.map(val => (
                        <button 
                          key={val}
                          onClick={() => setSpeed(val)}
                          className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${Math.abs(speed - val) < 0.001 ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'}`}
                        >
                          [ {val.toFixed(1)} ]
                        </button>
                      ))}
                      <button 
                        onClick={() => setSpeed(1.0)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${Math.abs(speed - 1.0) < 0.001 ? 'bg-slate-800 border-indigo-500 text-indigo-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                      >
                        Mặc định (1.0)
                      </button>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-800/30 border border-slate-700/50 rounded-2xl flex gap-3 text-slate-400 text-[11px] italic">
                    <Info size={16} className="shrink-0 text-indigo-400" />
                    <p>Mọi mốc thời gian sẽ được tính lại theo công thức: <code className="text-indigo-300 font-mono">new = old / speed</code>. Nội dung chữ được giữ nguyên 100%.</p>
                  </div>

                  <button 
                    onClick={applySpeed}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-xl shadow-indigo-500/20 active:scale-[0.98] transition-all"
                  >
                    👉 Áp dụng tốc độ & tải file mới
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Preview Panel */}
        <div className="lg:col-span-7 h-[calc(100vh-10rem)] bg-slate-900 border border-slate-800 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
          <div className="p-6 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
            <h3 className="font-bold text-slate-400 text-[10px] uppercase tracking-[0.3em] flex items-center gap-3">
              <Activity size={18} className="text-indigo-500" /> Monitor Tiến trình Thực tế
            </h3>
            <div className="flex items-center gap-4">
              {stats.totalTokens > 0 && (
                <div className="hidden sm:flex items-center gap-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                   <History size={14} className="text-indigo-400"/>
                   <span>{stats.totalTokens.toLocaleString()} tokens</span>
                </div>
              )}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl">
                <Cpu size={14} className="text-indigo-400" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Engine v3.1</span>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            {blocks.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-800 opacity-20">
                <Box size={100} strokeWidth={0.5} className="mb-6 animate-pulse" />
                <p className="text-base font-bold uppercase tracking-[0.4em]">Đang chờ tải tệp phụ đề</p>
              </div>
            ) : (
              blocks.slice(0, 100).map((block) => {
                const isTranslated = !!block.translatedText && !containsChinese(block.originalText);
                return (
                  <div key={block.index} className={`grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-3xl border transition-all duration-700 ${isTranslated ? 'border-emerald-500/20 bg-emerald-500/5 shadow-inner' : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'}`}>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-[10px] font-mono font-bold text-slate-500">
                        <span className="bg-slate-800 px-2 py-0.5 rounded-lg text-indigo-400 border border-slate-700/50">#{block.index}</span>
                        <span className="opacity-50 flex items-center gap-1"><Clock size={10}/> {block.timestamp}</span>
                      </div>
                      <p className="text-xs text-slate-400 font-serif-vi leading-relaxed line-clamp-3">{block.originalText}</p>
                    </div>
                    <div className="md:border-l border-slate-800 md:pl-8 space-y-3 flex flex-col justify-center min-h-[60px]">
                      <div className="flex justify-between items-center">
                        <span className={`text-[9px] uppercase font-bold tracking-widest ${isTranslated ? 'text-emerald-500' : 'text-slate-600'}`}>
                          {isTranslated ? 'Bản dịch tối ưu' : activeTab === 'speed-editor' ? 'Dòng chữ gốc' : 'Đang chờ xử lý...'}
                        </span>
                        {isTranslated && <CheckCircle2 size={14} className="text-emerald-500 shadow-emerald-500/50" />}
                      </div>
                      {block.translatedText ? (
                        <p className="text-[15px] text-slate-100 font-serif-vi font-bold leading-relaxed animate-in fade-in duration-500">{block.translatedText}</p>
                      ) : (
                        <div className="space-y-2"><div className="h-3 w-full bg-slate-800/50 rounded-full animate-pulse" /><div className="h-3 w-4/5 bg-slate-800/50 rounded-full animate-pulse delay-75" /></div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            {blocks.length > 100 && (
              <div className="p-8 text-center border-t border-slate-800/50 mt-8">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-full text-slate-500 text-[10px] uppercase font-bold tracking-[0.2em]">
                   <Info size={12}/> Hiển thị tối đa 100 block xem trước
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="p-4 text-center border-t border-slate-900 bg-slate-950/80">
        <p className="text-slate-700 text-[9px] uppercase tracking-[0.5em] font-bold">Donghua AI Toolset v3.1 • Designed for the Cultivation Multiverse</p>
      </footer>
    </div>
  );
};

export default App;

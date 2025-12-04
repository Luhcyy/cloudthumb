
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Cloud, 
  Upload, 
  Image as ImageIcon, 
  Activity, 
  Server, 
  AlertTriangle, 
  CheckCircle, 
  Cpu,
  FileUp,
  Filter,
  XCircle,
  Download,
  Trash2,
  ChevronUp,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  RotateCcw,
  RotateCw,
  CheckSquare,
  Square,
  Camera,
  Share2,
  Settings,
  Sliders,
  Save,
  Edit3,
  Undo,
  Redo,
  RefreshCw,
  Eye,
  EyeOff,
  List,
  Play,
  ToggleLeft,
  ToggleRight,
  ArrowRight,
  Zap,
  Database,
  Lock,
  Loader2,
  LayoutGrid,
  HardDrive
} from 'lucide-react';
import { ProcessedImage, MetricPoint, LogEntry, OutputConfig, ImageFilters, AwsConfig } from './types';
import { generateThumbnail, fileToBase64, base64ToFile, estimateFileSize } from './services/imageUtils';
import { analyzeImage } from './services/geminiService';
import { uploadToS3Input, pollForProcessedImage, validateConnection } from './services/awsService';
import { InvocationsChart, DurationChart, ErrorChart } from './components/CloudCharts';

// Interface auxiliar para a fila de espera
interface StagedFile {
  id: string;
  file: File;
  previewUrl: string;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'generator' | 'monitoring'>('generator');
  
  // Main Gallery State - Initialized from LocalStorage if available
  const [images, setImages] = useState<ProcessedImage[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('cloudthumb_images');
        if (saved) {
          const parsed = JSON.parse(saved);
          return parsed.map((img: any) => ({
            ...img,
            processedAt: new Date(img.processedAt),
            file: undefined 
          }));
        }
      } catch (e) {
        console.warn("Failed to load images from local storage", e);
      }
    }
    return [];
  });

  const [statusFilter, setStatusFilter] = useState<'all' | 'processing' | 'completed' | 'error'>('all');
  
  // Staging Queue State
  const [stagingQueue, setStagingQueue] = useState<StagedFile[]>([]);
  const [selectedStagedIds, setSelectedStagedIds] = useState<Set<string>>(new Set());

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // Drag and Drop states
  const [isDragging, setIsDragging] = useState(false);
  const [showDropSuccess, setShowDropSuccess] = useState(false);

  // Card Expansion State
  const [expandedImageId, setExpandedImageId] = useState<string | null>(null);

  // Selection State (Gallery)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Delete Confirmation State
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);

  // Lightbox / Zoom State
  const [selectedImage, setSelectedImage] = useState<ProcessedImage | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  
  // Editor State
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [editFilters, setEditFilters] = useState<ImageFilters>({
    brightness: 100, contrast: 100, saturation: 100, rotation: 0
  });
  const [filterHistory, setFilterHistory] = useState<ImageFilters[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isPreviewEnabled, setIsPreviewEnabled] = useState(true);

  // Output Configuration State
  const [outputConfig, setOutputConfig] = useState<OutputConfig>({
    format: 'image/jpeg',
    maxWidth: 300,
    useCustomQuality: false,
    quality: 0.8,
    useCompression: false,
    compression: 0.5
  });
  const [showSettings, setShowSettings] = useState(false);
  
  // AWS Configuration State
  const [showAwsConfig, setShowAwsConfig] = useState(false);
  const [awsConfig, setAwsConfig] = useState<AwsConfig>({
    enabled: false,
    accessKeyId: '',
    secretAccessKey: '',
    region: 'us-east-1',
    inputBucket: 'cloudthumb-app-input',
    outputBucket: 'cloudthumb-app-output'
  });
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{success: boolean, message: string} | null>(null);
  
  // New Size Statistics State
  const [sizeStats, setSizeStats] = useState<{ original: number, estimated: number } | null>(null);

  // Refs for Inertia and Touch
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  // Persistence Effect
  useEffect(() => {
    try {
      const serializableImages = images.map(({ file, ...rest }) => rest);
      localStorage.setItem('cloudthumb_images', JSON.stringify(serializableImages));
    } catch (e) {
      console.error("Failed to save images", e);
    }
  }, [images]);

  // Size Estimation
  useEffect(() => {
      const calculateEstimate = async () => {
          let sourceFile: File | string | undefined;
          let originalSize = 0;
          
          if (stagingQueue.length > 0) {
             const selectedStaged = stagingQueue.find(item => selectedStagedIds.has(item.id));
             const target = selectedStaged || stagingQueue[0];
             sourceFile = target.file;
             originalSize = target.file.size;
          } else if (images.length > 0) {
             const img = images[0];
             sourceFile = img.file || img.thumbnailUrl;
             originalSize = img.originalSize;
          }

          if (sourceFile && showSettings) {
              const estimatedBytes = await estimateFileSize(sourceFile, outputConfig);
              setSizeStats({ original: originalSize, estimated: estimatedBytes });
          } else {
              setSizeStats(null);
          }
      };
      
      const timer = setTimeout(calculateEstimate, 500);
      return () => clearTimeout(timer);
  }, [outputConfig, images, stagingQueue, selectedStagedIds, showSettings]);

  // Camera Cleanup
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  // Connect stream
  useEffect(() => {
    if (isCameraOpen && videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [isCameraOpen, cameraStream]);

  const addLog = (level: 'INFO' | 'WARN' | 'ERROR', message: string, service: 'Lambda' | 'S3-Input' | 'S3-Output') => {
    if (!awsConfig.enabled) return;
    const newLog: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      level,
      message,
      service
    };
    setLogs(prev => [newLog, ...prev].slice(50));
  };

  const updateMetrics = (duration: number, error: boolean) => {
    setMetrics(prev => {
      const last = prev[prev.length - 1];
      const now = new Date();
      const timeLabel = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
      
      const newPoint: MetricPoint = {
        time: timeLabel,
        invocations: (last?.time === timeLabel ? last.invocations : 0) + 1,
        duration: duration,
        errors: (last?.time === timeLabel ? last.errors : 0) + (error ? 1 : 0)
      };

      if (last?.time === timeLabel) {
        return [...prev.slice(0, -1), newPoint];
      }
      return [...prev.slice(1), newPoint];
    });
  };

  const stageFiles = (fileList: FileList | File[]) => {
    const rawFiles = Array.from(fileList);
    if (rawFiles.length === 0) return;

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const newStagedItems: StagedFile[] = [];

    rawFiles.forEach(file => {
      if (file.size > MAX_FILE_SIZE) {
        addLog('WARN', `Arquivo ignorado: ${file.name} excede o limite de 10MB.`, 'S3-Input');
      } else {
        const id = Math.random().toString(36).substr(2, 9);
        newStagedItems.push({
            id,
            file,
            previewUrl: URL.createObjectURL(file)
        });
      }
    });

    if (newStagedItems.length > 0) {
        setStagingQueue(prev => [...prev, ...newStagedItems]);
        setSelectedStagedIds(prev => {
            const newSet = new Set(prev);
            newStagedItems.forEach(i => newSet.add(i.id));
            return newSet;
        });
        if (activeTab !== 'generator') setActiveTab('generator');
        setShowSettings(true);
    }
  };

  const removeFromStage = (id: string) => {
      setStagingQueue(prev => {
          const item = prev.find(i => i.id === id);
          if (item) URL.revokeObjectURL(item.previewUrl);
          return prev.filter(i => i.id !== id);
      });
      setSelectedStagedIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
      });
  };

  const clearStage = () => {
      stagingQueue.forEach(item => URL.revokeObjectURL(item.previewUrl));
      setStagingQueue([]);
      setSelectedStagedIds(new Set());
  };

  const toggleStagedSelection = (id: string) => {
      setSelectedStagedIds(prev => {
          const newSet = new Set(prev);
          if (newSet.has(id)) newSet.delete(id);
          else newSet.add(id);
          return newSet;
      });
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getNewExtension = (format: string) => {
      switch(format) {
          case 'image/png': return 'png';
          case 'image/webp': return 'webp';
          default: return 'jpg';
      }
  };

  const toggleAwsMode = async () => {
      // Se já estiver habilitado, desabilitar é direto
      if (awsConfig.enabled) {
          setAwsConfig(p => ({...p, enabled: false}));
          setConnectionStatus(null);
          return;
      }

      // Para habilitar, precisamos validar as credenciais primeiro
      if (!awsConfig.accessKeyId.trim() || !awsConfig.secretAccessKey.trim()) {
          setConnectionStatus({ success: false, message: "Preencha as credenciais antes de ativar." });
          return;
      }

      setIsTestingConnection(true);
      setConnectionStatus(null);
      
      try {
          // Valida a conexão tentando listar objetos
          await validateConnection(awsConfig);
          
          // Se passou, habilita
          setAwsConfig(p => ({...p, enabled: true}));
          setConnectionStatus({ success: true, message: "Conexão Verificada e Ativada!" });
      } catch (err: any) {
          let msg = "Erro na validação.";
          if (err.message === 'Failed to fetch') msg = "Erro de Rede/CORS. Verifique as regras do Bucket.";
          else if (err.$metadata?.httpStatusCode === 403) msg = "Acesso Negado (403). Verifique chaves e permissões.";
          else if (err.$metadata?.httpStatusCode === 404) msg = "Bucket não encontrado (404).";
          else msg = err.message || "Erro desconhecido";
          
          setConnectionStatus({ success: false, message: msg });
          // Mantém desabilitado
          setAwsConfig(p => ({...p, enabled: false}));
      } finally {
          setIsTestingConnection(false);
      }
  };

  const testAwsConnection = async () => {
    if (!awsConfig.accessKeyId || !awsConfig.secretAccessKey) {
        setConnectionStatus({ success: false, message: "Insira as chaves de acesso." });
        return;
    }
    setIsTestingConnection(true);
    setConnectionStatus(null);
    try {
        await validateConnection(awsConfig);
        setConnectionStatus({ success: true, message: "Conexão OK!" });
    } catch (err: any) {
        let msg = "Erro desconhecido.";
        if (err.message === 'Failed to fetch') msg = "Bloqueio CORS ou Rede.";
        else if (err.$metadata?.httpStatusCode === 403) msg = "Acesso Negado (403).";
        else if (err.$metadata?.httpStatusCode === 404) msg = "Bucket não encontrado (404).";
        else msg = err.message;
        setConnectionStatus({ success: false, message: msg });
    } finally {
        setIsTestingConnection(false);
    }
  };

  const processStagedFiles = async () => {
      const itemsToProcess = stagingQueue.filter(item => selectedStagedIds.has(item.id));
      if (itemsToProcess.length === 0) return;

      setIsProcessing(true);
      setProcessingProgress({ current: 0, total: itemsToProcess.length });
      setStatusFilter('all');

      const isAwsReady = awsConfig.enabled && awsConfig.accessKeyId && awsConfig.secretAccessKey;

      const newProcessItems = itemsToProcess.map(item => ({
        file: item.file, 
        id: item.id,
        originalName: item.file.name,
        originalSize: item.file.size,
        thumbnailUrl: '',
        processedAt: new Date(),
        status: 'processing' as const,
        processedSize: 0,
        processingSource: isAwsReady ? 'aws' as const : 'local' as const,
        processedName: item.file.name
      }));

      setImages(prev => [...newProcessItems, ...prev]);
      setStagingQueue(prev => prev.filter(item => !selectedStagedIds.has(item.id)));
      setSelectedStagedIds(new Set());

      let processedCount = 0;

      const processSingleFile = async (item: typeof newProcessItems[0]) => {
        const { file, id, originalName } = item;
        const startTime = performance.now();
        const uniqueKey = `${Date.now()}-${originalName}`;

        try {
          let thumbBase64 = '';
          let sourceUsed = 'local';
          let duration = 0;
          const rawBase64 = await fileToBase64(file);

          let analysis = { description: "", tags: [] as string[], suggestedName: "" };
          try {
             analysis = await analyzeImage(rawBase64);
          } catch (aiErr) {
             analysis = { description: "Análise indisponível", tags: ["erro"], suggestedName: originalName.split('.')[0] };
          }

          const newExt = getNewExtension(outputConfig.format);
          const baseName = analysis.suggestedName || originalName.substring(0, originalName.lastIndexOf('.')) || "imagem";
          const finalDisplayName = `${baseName}.${newExt}`;

          if (isAwsReady) {
             try {
                await uploadToS3Input(file, awsConfig, uniqueKey);
                thumbBase64 = await pollForProcessedImage(uniqueKey, awsConfig);
                sourceUsed = 'aws';
             } catch (awsError: any) {
                setImages(prev => prev.map(img => img.id === id ? { ...img, processingSource: 'local' } : img));
             }
          }

          if (!thumbBase64) {
             thumbBase64 = await generateThumbnail(file, outputConfig);
             sourceUsed = 'local';
          }
          
          const stringLength = thumbBase64.length - (thumbBase64.indexOf(',') + 1);
          const sizeInBytes = Math.round(stringLength * 0.75);
          const endTime = performance.now();
          duration = Math.round(endTime - startTime);
  
          setImages(prev => prev.map(img => {
            if (img.id === id) {
              return {
                ...img,
                thumbnailUrl: thumbBase64,
                processedSize: sizeInBytes,
                status: 'completed',
                aiDescription: analysis.description,
                aiTags: analysis.tags,
                processingSource: sourceUsed as 'aws' | 'local',
                processedName: finalDisplayName
              };
            }
            return img;
          }));
  
          if (sourceUsed === 'aws') {
            updateMetrics(duration, false);
            addLog('INFO', `Imagem processada com sucesso: ${finalDisplayName}`, 'Lambda');
          }
        } catch (error) {
          setImages(prev => prev.map(img => img.id === id ? { ...img, status: 'error' } : img));
          addLog('ERROR', `Erro Fatal: ${(error as Error).message}`, 'Lambda');
        } finally {
            processedCount++;
            setProcessingProgress(prev => ({ ...prev, current: processedCount }));
        }
      };

      await Promise.all(newProcessItems.map(item => processSingleFile(item)));
      setTimeout(() => setIsProcessing(false), 500);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      stageFiles(event.target.files);
      event.target.value = '';
    }
  };

  const handleDownload = (e: React.MouseEvent, url: string, filename: string) => {
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleShare = async (e: React.MouseEvent, img: ProcessedImage) => {
    e.stopPropagation();
    try {
        const file = await base64ToFile(img.thumbnailUrl, img.processedName || img.originalName, outputConfig.format);
        if (navigator.share) {
            await navigator.share({
                title: 'CloudThumb',
                text: img.aiDescription,
                files: [file]
            });
        } else {
            alert('Navegador não suporta compartilhamento.');
        }
    } catch (err) { console.error(err); }
  };

  const handleBatchShare = async () => {
      const selectedImages = images.filter(img => selectedIds.has(img.id));
      if (selectedImages.length === 0) return;
      try {
          if (navigator.share) {
            const filesPromise = selectedImages.map(img => 
                base64ToFile(img.thumbnailUrl, img.processedName || img.originalName, outputConfig.format)
            );
            const files = await Promise.all(filesPromise);
            await navigator.share({ title: 'CloudThumb Batch', files: files });
          }
      } catch (err) { console.error(err); }
  };

  const handleDelete = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    if (expandedImageId === id) setExpandedImageId(null);
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  };

  const confirmDelete = () => {
    if (deleteConfirmationId) {
      handleDelete(deleteConfirmationId);
      setDeleteConfirmationId(null);
    }
  };

  const handleBatchDelete = () => {
    setImages(prev => prev.filter(img => !selectedIds.has(img.id)));
    setSelectedIds(new Set());
  };

  const handleGenerateAll = async () => {
      if (isProcessing) return;
      const targets = images.filter(img => img.status !== 'error');
      if (targets.length === 0) return;
      setIsProcessing(true);
      setProcessingProgress({ current: 0, total: targets.length });
      
      let processedCount = 0;
      const processItem = async (item: ProcessedImage) => {
          try {
              const source = item.file || item.thumbnailUrl;
              const newThumb = await generateThumbnail(source, outputConfig);
              const currentName = item.processedName || item.originalName;
              const nameWithoutExt = currentName.substring(0, currentName.lastIndexOf('.')) || currentName;
              const newExt = getNewExtension(outputConfig.format);
              const finalDisplayName = `${nameWithoutExt}.${newExt}`;
              const stringLength = newThumb.length - (newThumb.indexOf(',') + 1);
              const sizeInBytes = Math.round(stringLength * 0.75);

              setImages(prev => prev.map(img => 
                  img.id === item.id 
                  ? { ...img, thumbnailUrl: newThumb, processedSize: sizeInBytes, processedAt: new Date(), status: 'completed', processingSource: 'local', processedName: finalDisplayName } 
                  : img
              ));
          } catch (e) { console.error(e); } finally {
              processedCount++;
              setProcessingProgress(prev => ({ ...prev, current: processedCount }));
          }
      };
      await Promise.all(targets.map(processItem));
      setTimeout(() => setIsProcessing(false), 500);
  };

  // Camera Logic
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setCameraStream(stream);
      setIsCameraOpen(true);
    } catch (err) { alert('Erro ao acessar câmera'); }
  };
  const stopCamera = () => {
    if (cameraStream) { cameraStream.getTracks().forEach(track => track.stop()); setCameraStream(null); }
    setIsCameraOpen(false);
  };
  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
          stopCamera();
          stageFiles([file]);
        }
      }, 'image/jpeg', 0.95);
    }
  };

  // Editor Logic
  const openEditor = (img: ProcessedImage) => {
      setEditingImageId(img.id);
      const initialFilters = { brightness: 100, contrast: 100, saturation: 100, rotation: 0 };
      setEditFilters(initialFilters);
      setFilterHistory([initialFilters]);
      setHistoryIndex(0);
      setIsPreviewEnabled(true);
  };
  const closeEditor = () => { setEditingImageId(null); setFilterHistory([]); setHistoryIndex(0); };
  const commitHistory = useCallback(() => {
    const current = editFilters;
    const previous = filterHistory[historyIndex];
    if (current.brightness !== previous?.brightness || current.contrast !== previous?.contrast || current.saturation !== previous?.saturation || current.rotation !== previous?.rotation) {
        const newHistory = filterHistory.slice(0, historyIndex + 1);
        newHistory.push(current);
        setFilterHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    }
  }, [editFilters, filterHistory, historyIndex]);
  const handleUndo = () => { if (historyIndex > 0) { setEditFilters(filterHistory[historyIndex - 1]); setHistoryIndex(historyIndex - 1); }};
  const handleRedo = () => { if (historyIndex < filterHistory.length - 1) { setEditFilters(filterHistory[historyIndex + 1]); setHistoryIndex(historyIndex + 1); }};
  const saveEditedImage = async () => {
      if (!editingImageId) return;
      const originalImg = images.find(i => i.id === editingImageId);
      if (!originalImg) return;
      try {
          const source = originalImg.file || originalImg.thumbnailUrl;
          const newThumbnail = await generateThumbnail(source, outputConfig, editFilters);
          const stringLength = newThumbnail.length - (newThumbnail.indexOf(',') + 1);
          const sizeInBytes = Math.round(stringLength * 0.75);
          setImages(prev => prev.map(img => img.id === editingImageId ? { ...img, thumbnailUrl: newThumbnail, processedSize: sizeInBytes, processedAt: new Date() } : img));
          closeEditor();
      } catch (err) { console.error(err); }
  };

  // Drag Handlers
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!isProcessing && !showDropSuccess) setIsDragging(true); }, [isProcessing, showDropSuccess]);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); if (isProcessing) return; if (e.dataTransfer.files && e.dataTransfer.files.length > 0) { setShowDropSuccess(true); setTimeout(() => setShowDropSuccess(false), 2000); stageFiles(e.dataTransfer.files); } }, [isProcessing]);

  // Lightbox
  const openLightbox = (img: ProcessedImage) => { if (img.status === 'completed') { setSelectedImage(img); setZoomLevel(1); setRotation(0); setPanPosition({ x: 0, y: 0 }); }};
  const closeLightbox = () => { setSelectedImage(null); };
  
  // Filtering
  const filteredImages = images.filter(img => statusFilter === 'all' ? true : img.status === statusFilter);
  const getCount = (status: typeof statusFilter) => status === 'all' ? images.length : images.filter(i => i.status === status).length;
  const areAllVisibleSelected = filteredImages.length > 0 && filteredImages.every(img => selectedIds.has(img.id));
  const handleSelectAll = () => { if (areAllVisibleSelected) setSelectedIds(prev => { const n = new Set(prev); filteredImages.forEach(i => n.delete(i.id)); return n; }); else setSelectedIds(prev => { const n = new Set(prev); filteredImages.forEach(i => n.add(i.id)); return n; }); };
  
  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const handleRotateCcw = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRotation(prev => prev - 90);
  };

  const handleRotateCw = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRotation(prev => prev + 90);
  };

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomLevel(prev => Math.min(prev + 0.25, 4));
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  };

  const currentEditingImage = editingImageId ? images.find(i => i.id === editingImageId) : null;

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-indigo-500/30 text-zinc-200">
      
      {/* Navbar Transparente e Flutuante */}
      <nav className="fixed top-0 left-0 right-0 z-40 bg-black/20 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-500/20 p-2 rounded-xl border border-indigo-500/30">
                <Cloud className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                  <h1 className="text-lg font-bold text-white tracking-tight leading-none">CloudThumb <span className="text-indigo-400">AI</span></h1>
                  <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-widest">Enterprise Edition</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-white/5 p-1 rounded-full border border-white/10">
              <button onClick={() => setActiveTab('generator')} className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${activeTab === 'generator' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25' : 'text-zinc-400 hover:text-white'}`}>Gerador</button>
              <button onClick={() => setActiveTab('monitoring')} className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${activeTab === 'monitoring' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25' : 'text-zinc-400 hover:text-white'}`}>Monitoramento</button>
            </div>
            <button onClick={() => setShowAwsConfig(true)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-2 transition-all ${awsConfig.enabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-white/5 border-white/10 text-zinc-500 hover:bg-white/10'}`}>
                   {awsConfig.enabled ? <Zap className="w-3 h-3 fill-current" /> : <Database className="w-3 h-3" />}
                   {awsConfig.enabled ? 'AWS Connected' : 'Simulação'}
            </button>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-24">
        {activeTab === 'generator' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            
            {/* Hero / Upload Area */}
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 relative overflow-hidden group">
               <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/2"></div>
               
               <div className="flex justify-between items-start mb-6">
                 <div>
                    <h2 className="text-2xl font-bold text-white mb-1">Central de Upload</h2>
                    <p className="text-sm text-zinc-400">Otimização inteligente de imagens com IA.</p>
                 </div>
                 <button onClick={() => setShowSettings(!showSettings)} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-all ${showSettings ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10'}`}>
                    <Sliders className="w-3 h-3" /> Ajustes {showSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                 </button>
               </div>

               {/* Settings Panel */}
               {showSettings && (
                   <div className="bg-black/20 p-6 rounded-2xl border border-white/5 mb-6 animate-in slide-in-from-top-2">
                       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                           <div className="space-y-3">
                              <label className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Formato & Dimensão</label>
                              <div className="flex gap-2">
                                <select value={outputConfig.format} onChange={(e) => setOutputConfig(p => ({...p, format: e.target.value as any}))} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 flex-1">
                                    <option value="image/jpeg" className="bg-zinc-900 text-zinc-200">JPEG</option>
                                    <option value="image/png" className="bg-zinc-900 text-zinc-200">PNG</option>
                                    <option value="image/webp" className="bg-zinc-900 text-zinc-200">WebP</option>
                                </select>
                                <select value={outputConfig.maxWidth} onChange={(e) => setOutputConfig(p => ({...p, maxWidth: parseInt(e.target.value)}))} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 flex-1">
                                    <option value="150" className="bg-zinc-900 text-zinc-200">150px</option>
                                    <option value="300" className="bg-zinc-900 text-zinc-200">300px</option>
                                    <option value="600" className="bg-zinc-900 text-zinc-200">600px</option>
                                    <option value="1080" className="bg-zinc-900 text-zinc-200">1080px</option>
                                </select>
                              </div>
                           </div>

                           {/* Controle de Qualidade */}
                           <div className="space-y-4">
                              <div className="flex justify-between items-center">
                                  <label className={`text-xs font-semibold uppercase tracking-wider transition-colors ${outputConfig.useCustomQuality ? 'text-indigo-400' : 'text-zinc-600'}`}>
                                      Qualidade {outputConfig.useCustomQuality && <span>{Math.round(outputConfig.quality * 100)}%</span>}
                                  </label>
                                  <button onClick={() => setOutputConfig(p => ({...p, useCustomQuality: !p.useCustomQuality}))} className="focus:outline-none">
                                      {outputConfig.useCustomQuality ? <ToggleRight className="w-6 h-6 text-indigo-500" /> : <ToggleLeft className="w-6 h-6 text-zinc-600" />}
                                  </button>
                              </div>
                              <input 
                                  type="range" 
                                  min="0.1" 
                                  max="1" 
                                  step="0.05" 
                                  disabled={!outputConfig.useCustomQuality}
                                  value={outputConfig.quality} 
                                  onChange={(e) => setOutputConfig(p => ({...p, quality: parseFloat(e.target.value)}))} 
                                  className={`w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500 ${!outputConfig.useCustomQuality ? 'opacity-30 grayscale cursor-not-allowed' : ''}`} 
                              />
                           </div>

                           {/* Controle de Compressão */}
                           <div className="space-y-4">
                              <div className="flex justify-between items-center">
                                  <label className={`text-xs font-semibold uppercase tracking-wider transition-colors ${outputConfig.useCompression ? 'text-pink-400' : 'text-zinc-600'}`}>
                                      Compressão {outputConfig.useCompression && <span>{Math.round(outputConfig.compression * 100)}%</span>}
                                  </label>
                                  <button onClick={() => setOutputConfig(p => ({...p, useCompression: !p.useCompression}))} className="focus:outline-none">
                                      {outputConfig.useCompression ? <ToggleRight className="w-6 h-6 text-pink-500" /> : <ToggleLeft className="w-6 h-6 text-zinc-600" />}
                                  </button>
                              </div>
                              <input 
                                  type="range" 
                                  min="0.1" 
                                  max="0.9" 
                                  step="0.1" 
                                  disabled={!outputConfig.useCompression}
                                  value={outputConfig.compression} 
                                  onChange={(e) => setOutputConfig(p => ({...p, compression: parseFloat(e.target.value)}))} 
                                  className={`w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-pink-500 ${!outputConfig.useCompression ? 'opacity-30 grayscale cursor-not-allowed' : ''}`} 
                              />
                              {sizeStats && (
                                <div className="flex items-center gap-2 text-[10px]">
                                   <span className="text-zinc-400">{formatBytes(sizeStats.original)}</span>
                                   <ArrowRight className="w-3 h-3 text-zinc-600" />
                                   <span className="text-emerald-400 font-bold">{formatBytes(sizeStats.estimated)}</span>
                                </div>
                              )}
                           </div>
                       </div>
                   </div>
               )}
               
               {/* Drop Zone */}
               <label 
                  className="relative cursor-pointer block w-full group/drop"
                  onDragOver={handleDragOver} onDragEnter={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
               >
                 <div className={`
                   border-2 border-dashed rounded-2xl p-12 transition-all duration-500 ease-out 
                   flex flex-col items-center justify-center min-h-[260px] relative overflow-hidden
                   ${isDragging 
                      ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02] shadow-[0_0_40px_rgba(99,102,241,0.2)]' 
                      : 'border-white/10 bg-white/5 hover:border-indigo-500/50 hover:bg-white/10'
                   }
                 `}>
                   {awsConfig.enabled && (
                       <div className="absolute top-4 right-4 flex items-center gap-2 bg-emerald-500/20 px-3 py-1 rounded-full border border-emerald-500/30">
                           <Cloud className="w-4 h-4 text-emerald-400" />
                           <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider">AWS S3 Enabled</span>
                       </div>
                   )}
                   <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} disabled={isProcessing} />
                   
                   <div className={`flex flex-col items-center space-y-4 transition-all duration-300 ${isProcessing || showDropSuccess ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
                     <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 group-hover/drop:scale-110 transition-transform duration-500">
                        <Upload className="w-8 h-8 text-indigo-400" />
                     </div>
                     <div className="text-center">
                        <span className="text-white font-medium block text-lg">Arraste seus arquivos aqui</span>
                        <span className="text-zinc-500 text-sm mt-1">ou clique para navegar</span>
                     </div>
                     <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); startCamera(); }} className="mt-4 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-xs font-medium text-zinc-300 flex items-center gap-2 transition-colors">
                        <Camera className="w-3 h-3" /> Usar Câmera
                     </button>
                   </div>

                   {/* Success Overlay */}
                   {showDropSuccess && (
                     <div className="absolute inset-0 flex flex-col items-center justify-center z-10 animate-in fade-in zoom-in duration-300">
                       <div className="bg-emerald-500 rounded-full p-4 shadow-[0_0_30px_rgba(16,185,129,0.4)]">
                          <CheckCircle className="w-12 h-12 text-white" />
                       </div>
                       <span className="text-emerald-400 font-bold text-lg mt-4 tracking-wide">Arquivos Recebidos</span>
                     </div>
                   )}
                 </div>
               </label>
            </div>

            {/* Staging Area */}
            {stagingQueue.length > 0 && (
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden animate-in slide-in-from-bottom-4">
                    <div className="p-4 border-b border-white/5 flex justify-between items-center">
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><List className="w-4 h-4 text-indigo-400" /> Fila de Preparação</h3>
                        <div className="flex gap-4 text-xs">
                             <span className="text-zinc-400">{selectedStagedIds.size} selecionados</span>
                             <button onClick={clearStage} className="text-red-400 hover:text-red-300">Limpar</button>
                        </div>
                    </div>
                    <div className="p-4 flex gap-3 overflow-x-auto custom-scrollbar pb-6">
                        {stagingQueue.map((item) => {
                            const isSelected = selectedStagedIds.has(item.id);
                            return (
                                <div key={item.id} onClick={() => toggleStagedSelection(item.id)} className={`relative group flex-shrink-0 w-32 cursor-pointer transition-all duration-200 ${isSelected ? 'scale-105' : 'opacity-60 hover:opacity-100'}`}>
                                    <div className={`aspect-square rounded-xl overflow-hidden border-2 ${isSelected ? 'border-indigo-500 shadow-lg shadow-indigo-500/20' : 'border-white/10'}`}>
                                        <img src={item.previewUrl} className="w-full h-full object-cover" />
                                        <div className="absolute top-2 right-2 p-1 rounded-full bg-black/50 backdrop-blur-sm">
                                            {isSelected ? <CheckSquare className="w-4 h-4 text-indigo-400" /> : <Square className="w-4 h-4 text-white/50" />}
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-zinc-400 mt-2 truncate text-center">{item.file.name}</p>
                                </div>
                            );
                        })}
                    </div>
                    <div className="p-4 bg-black/20 border-t border-white/5 flex justify-end">
                        <button onClick={processStagedFiles} disabled={selectedStagedIds.size === 0 || isProcessing} className="flex items-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-sm font-medium rounded-xl shadow-lg shadow-indigo-600/20 transition-all hover:scale-[1.02] active:scale-[0.98]">
                            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                            Processar Imagens
                        </button>
                    </div>
                </div>
            )}

            {/* Gallery Section */}
            <div>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                 <h3 className="text-lg font-bold text-white flex items-center gap-2"><LayoutGrid className="w-5 h-5 text-indigo-400" />Galeria</h3>
                 
                 <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
                    {[{id:'all',l:'Tudo'},{id:'completed',l:'Prontos'},{id:'processing',l:'Gerando'},{id:'error',l:'Falhas'}].map(f => (
                        <button key={f.id} onClick={() => setStatusFilter(f.id as any)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${statusFilter === f.id ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>
                            {f.l} <span className="opacity-50 ml-1">{getCount(f.id as any)}</span>
                        </button>
                    ))}
                 </div>
              </div>

              {images.length > 0 && (
                  <div className="flex items-center justify-between mb-4 px-1">
                     <button onClick={handleSelectAll} className="text-xs text-zinc-400 hover:text-white flex items-center gap-2 transition-colors">
                        {areAllVisibleSelected ? <CheckSquare className="w-4 h-4 text-indigo-500" /> : <Square className="w-4 h-4" />} Selecionar Tudo
                     </button>
                     {selectedIds.size > 0 && (
                        <div className="flex gap-2">
                           <button onClick={handleBatchShare} className="text-xs px-3 py-1.5 bg-indigo-500/10 text-indigo-300 rounded border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors">Compartilhar ({selectedIds.size})</button>
                           <button onClick={handleBatchDelete} className="text-xs px-3 py-1.5 bg-red-500/10 text-red-300 rounded border border-red-500/20 hover:bg-red-500/20 transition-colors">Excluir ({selectedIds.size})</button>
                           {images.length > 0 && <button onClick={handleGenerateAll} className="text-xs px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded border border-zinc-700 hover:bg-zinc-700 transition-colors">Regenerar</button>}
                        </div>
                     )}
                  </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {filteredImages.map((img) => {
                      const isSelected = selectedIds.has(img.id);
                      return (
                          <div key={img.id} className={`group relative bg-white/5 backdrop-blur-md rounded-2xl border overflow-hidden transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/10 hover:-translate-y-1 ${isSelected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-white/10 hover:border-white/20'}`}>
                              
                              {/* Image Area */}
                              <div className="aspect-[4/3] bg-black/40 relative overflow-hidden" onClick={() => openLightbox(img)}>
                                  {img.status === 'processing' ? (
                                      <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>
                                  ) : (
                                      <img src={img.thumbnailUrl} className="w-full h-full object-contain" />
                                  )}
                                  
                                  {/* Badges */}
                                  <div className="absolute top-2 right-2 flex flex-col gap-1 items-end pointer-events-none">
                                      {img.processingSource && (
                                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold border backdrop-blur-md uppercase tracking-wider ${img.processingSource === 'aws' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300' : 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300'}`}>{img.processingSource}</span>
                                      )}
                                      {img.processedSize && (
                                          <span className="px-2 py-0.5 rounded text-[9px] bg-black/60 text-zinc-300 border border-white/10">{formatBytes(img.processedSize)}</span>
                                      )}
                                  </div>

                                  {/* Selection Checkbox (Visible on Hover/Selected) */}
                                  <div className={`absolute top-2 left-2 transition-opacity duration-200 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} onClick={(e) => {e.stopPropagation(); toggleSelection(img.id);}}>
                                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center border backdrop-blur-sm cursor-pointer ${isSelected ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-black/40 border-white/20 text-transparent hover:bg-black/60'}`}>
                                          <CheckCircle className="w-4 h-4" />
                                      </div>
                                  </div>
                              </div>

                              {/* Footer */}
                              <div className="p-3 border-t border-white/5">
                                  <div className="flex justify-between items-start mb-2">
                                     <h4 className="text-xs font-medium text-zinc-200 truncate pr-2" title={img.processedName}>{img.processedName || img.originalName}</h4>
                                     {img.status === 'completed' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>}
                                  </div>
                                  
                                  {img.aiTags && (
                                      <div className="flex gap-1 overflow-hidden mb-3">
                                          {img.aiTags.slice(0,2).map(t => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-zinc-400 border border-white/5 whitespace-nowrap">#{t}</span>)}
                                      </div>
                                  )}

                                  <div className="flex justify-between items-center pt-2 border-t border-white/5 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <div className="flex gap-1">
                                          <button onClick={() => openEditor(img)} className="p-1.5 hover:bg-white/10 rounded-md text-zinc-400 hover:text-white transition-colors"><Edit3 className="w-3.5 h-3.5" /></button>
                                          <button onClick={(e) => handleDownload(e, img.thumbnailUrl, img.processedName || img.originalName)} className="p-1.5 hover:bg-white/10 rounded-md text-zinc-400 hover:text-white transition-colors"><Download className="w-3.5 h-3.5" /></button>
                                          <button onClick={(e) => handleShare(e, img)} className="p-1.5 hover:bg-white/10 rounded-md text-zinc-400 hover:text-white transition-colors"><Share2 className="w-3.5 h-3.5" /></button>
                                      </div>
                                      <button onClick={() => setDeleteConfirmationId(img.id)} className="p-1.5 hover:bg-red-500/10 rounded-md text-zinc-500 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                                  </div>
                              </div>
                          </div>
                      );
                  })}
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'monitoring' && (
           <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
             <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8">
                 <div className="flex items-center justify-between mb-8">
                     <div>
                        <h2 className="text-2xl font-bold text-white mb-1">Live Metrics</h2>
                        <p className="text-sm text-zinc-400">Monitoramento em tempo real do pipeline serverless.</p>
                     </div>
                     <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20"><Activity className="w-3 h-3" /> System Healthy</div>
                 </div>
                 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                    <div className="bg-black/20 rounded-2xl border border-white/5 overflow-hidden"><InvocationsChart data={metrics} /></div>
                    <div className="bg-black/20 rounded-2xl border border-white/5 overflow-hidden"><DurationChart data={metrics} /></div>
                    <div className="bg-black/20 rounded-2xl border border-white/5 overflow-hidden"><ErrorChart data={metrics} /></div>
                 </div>
                 <div className="bg-black/20 rounded-2xl border border-white/5 overflow-hidden">
                   <div className="px-6 py-3 border-b border-white/5 bg-white/5 flex items-center gap-2">
                       <Server className="w-4 h-4 text-zinc-400" />
                       <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">System Logs</span>
                   </div>
                   <div className="h-64 overflow-y-auto p-4 font-mono text-xs custom-scrollbar space-y-1">
                       {logs.map((log) => (
                           <div key={log.id} className="flex gap-4 p-1 hover:bg-white/5 rounded">
                               <span className="text-zinc-500 w-32 shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                               <span className={`w-16 shrink-0 font-bold ${log.level === 'ERROR' ? 'text-red-400' : log.level === 'WARN' ? 'text-amber-400' : 'text-emerald-400'}`}>{log.level}</span>
                               <span className="text-indigo-400 w-24 shrink-0">[{log.service}]</span>
                               <span className="text-zinc-300">{log.message}</span>
                           </div>
                       ))}
                   </div>
                 </div>
             </div>
           </div>
        )}
      </main>
      
      {/* Modern Processing Overlay */}
      {isProcessing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-500">
              <div className="bg-black/40 p-8 rounded-3xl border border-white/10 shadow-2xl backdrop-blur-xl max-w-sm w-full text-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/10 to-pink-500/10 animate-pulse"></div>
                  <div className="relative z-10">
                      <div className="w-16 h-16 rounded-full border-2 border-white/10 border-t-indigo-500 animate-spin mb-6 mx-auto"></div>
                      <h3 className="text-xl font-bold text-white mb-1">Otimizando</h3>
                      <p className="text-zinc-400 text-sm mb-6">Aplicando mágica de compressão...</p>
                      <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-indigo-500 h-full rounded-full transition-all duration-300" style={{ width: `${(processingProgress.current / Math.max(processingProgress.total, 1)) * 100}%` }}></div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Lightbox / Modals (Styling Updates) */}
      {selectedImage && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex items-center justify-center animate-in fade-in" onClick={closeLightbox}>
             <div className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-white/10 backdrop-blur-md rounded-full px-6 py-3 border border-white/10 shadow-xl z-50" onClick={e => e.stopPropagation()}>
               <button onClick={handleRotateCcw} className="text-zinc-400 hover:text-white transition-colors"><RotateCcw className="w-5 h-5" /></button>
               <button onClick={handleZoomOut} className="text-zinc-400 hover:text-white transition-colors"><ZoomOut className="w-5 h-5" /></button>
               <span className="text-xs font-mono text-zinc-500 w-8 text-center">{Math.round(zoomLevel * 100)}%</span>
               <button onClick={handleZoomIn} className="text-zinc-400 hover:text-white transition-colors"><ZoomIn className="w-5 h-5" /></button>
               <button onClick={handleRotateCw} className="text-zinc-400 hover:text-white transition-colors"><RotateCw className="w-5 h-5" /></button>
             </div>
             <button onClick={closeLightbox} className="absolute top-8 right-8 p-3 bg-white/5 hover:bg-white/10 rounded-full text-zinc-400 hover:text-white border border-white/10 transition-colors z-50"><X className="w-6 h-6" /></button>
             <div className="w-full h-full p-12 flex items-center justify-center overflow-hidden">
                 <img src={selectedImage.thumbnailUrl} className="max-w-full max-h-full object-contain shadow-2xl transition-transform duration-100 ease-out" style={{ transform: `translate(${panPosition.x}px, ${panPosition.y}px) rotate(${rotation}deg) scale(${zoomLevel})` }} onClick={e => e.stopPropagation()} />
             </div>
        </div>
      )}

      {/* Editor Modal */}
      {editingImageId && currentEditingImage && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 md:p-10">
             <div className="w-full h-full bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row">
                 <div className="flex-1 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-zinc-900/50 flex items-center justify-center p-8 relative overflow-hidden">
                    <img src={currentEditingImage.thumbnailUrl} className="max-w-full max-h-full object-contain shadow-[0_0_50px_rgba(0,0,0,0.5)]" style={isPreviewEnabled ? { filter: `brightness(${editFilters.brightness}%) contrast(${editFilters.contrast}%) saturate(${editFilters.saturation}%)`, transform: `rotate(${editFilters.rotation}deg)` } : {}} />
                 </div>
                 <div className="w-full md:w-80 bg-zinc-950/50 backdrop-blur-xl border-l border-white/5 p-6 flex flex-col">
                     <div className="flex justify-between items-center mb-8">
                         <h3 className="text-white font-bold">Editor</h3>
                         <div className="flex gap-2">
                             <button onClick={() => setIsPreviewEnabled(!isPreviewEnabled)} className="p-2 bg-white/5 rounded-lg text-zinc-400 hover:text-white">{isPreviewEnabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
                             <button onClick={closeEditor} className="p-2 hover:bg-red-500/10 rounded-lg text-zinc-400 hover:text-red-400"><X className="w-4 h-4" /></button>
                         </div>
                     </div>
                     <div className="space-y-6 flex-1 overflow-y-auto custom-scrollbar">
                         {['brightness','contrast','saturation'].map((f) => (
                             <div key={f} className="space-y-2">
                                 <div className="flex justify-between text-xs text-zinc-400 font-medium uppercase tracking-wider"><span className="capitalize">{f}</span><span>{(editFilters as any)[f]}%</span></div>
                                 <input type="range" min="0" max="200" value={(editFilters as any)[f]} onChange={(e) => setEditFilters(p => ({...p, [f]: parseInt(e.target.value)}))} onMouseUp={commitHistory} onTouchEnd={commitHistory} className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white" />
                             </div>
                         ))}
                     </div>
                     <div className="pt-6 mt-6 border-t border-white/5 flex gap-3">
                         <button onClick={handleUndo} disabled={historyIndex <= 0} className="flex-1 py-3 bg-white/5 rounded-xl text-zinc-400 disabled:opacity-50"><Undo className="w-5 h-5 mx-auto" /></button>
                         <button onClick={handleRedo} disabled={historyIndex >= filterHistory.length - 1} className="flex-1 py-3 bg-white/5 rounded-xl text-zinc-400 disabled:opacity-50"><Redo className="w-5 h-5 mx-auto" /></button>
                         <button onClick={saveEditedImage} className="flex-[2] py-3 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 transition-colors">Salvar</button>
                     </div>
                 </div>
             </div>
         </div>
      )}

      {/* AWS Config Modal */}
      {showAwsConfig && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
           <div className="bg-[#0f0f11] border border-white/10 p-8 rounded-3xl shadow-2xl max-w-lg w-full relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-cyan-500"></div>
              <button onClick={() => setShowAwsConfig(false)} className="absolute top-5 right-5 text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
              
              <h2 className="text-xl font-bold text-white mb-2">AWS Connection</h2>
              <p className="text-sm text-zinc-400 mb-6">Conecte seus buckets S3 para processamento real na nuvem. Preencha e valide para ativar.</p>
              
              <div className="space-y-5">
                 <div className="flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/5">
                    <div className="flex flex-col">
                        <span className="text-zinc-200 text-sm font-medium">Status da Integração</span>
                        <span className="text-xs text-zinc-500">{awsConfig.enabled ? "Ativo e Validado" : "Desativado"}</span>
                    </div>
                    <button onClick={toggleAwsMode} disabled={isTestingConnection} className="transition-colors disabled:opacity-50">
                        {isTestingConnection ? <Loader2 className="w-8 h-8 text-yellow-500 animate-spin" /> : 
                         awsConfig.enabled ? <ToggleRight className="w-8 h-8 text-emerald-500" /> : <ToggleLeft className="w-8 h-8 text-zinc-600" />}
                    </button>
                 </div>
                 
                 <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                    <input type="text" value={awsConfig.accessKeyId} onChange={(e) => setAwsConfig(p => ({...p, accessKeyId: e.target.value}))} className="w-full bg-black border border-white/10 rounded-lg p-3 text-white text-sm focus:border-emerald-500 outline-none transition-colors" placeholder="Access Key ID" />
                    <input type="password" value={awsConfig.secretAccessKey} onChange={(e) => setAwsConfig(p => ({...p, secretAccessKey: e.target.value}))} className="w-full bg-black border border-white/10 rounded-lg p-3 text-white text-sm focus:border-emerald-500 outline-none transition-colors" placeholder="Secret Access Key" />
                    <div className="grid grid-cols-3 gap-3">
                       <input type="text" value={awsConfig.region} onChange={(e) => setAwsConfig(p => ({...p, region: e.target.value}))} className="bg-black border border-white/10 rounded-lg p-3 text-white text-sm outline-none" placeholder="Region" />
                       <input type="text" value={awsConfig.inputBucket} onChange={(e) => setAwsConfig(p => ({...p, inputBucket: e.target.value}))} className="bg-black border border-white/10 rounded-lg p-3 text-white text-sm outline-none" placeholder="Input Bucket" />
                       <input type="text" value={awsConfig.outputBucket} onChange={(e) => setAwsConfig(p => ({...p, outputBucket: e.target.value}))} className="bg-black border border-white/10 rounded-lg p-3 text-white text-sm outline-none" placeholder="Output Bucket" />
                    </div>
                    
                    <button onClick={testAwsConnection} disabled={isTestingConnection} className="w-full py-3 mt-2 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 text-xs font-medium text-zinc-300 flex items-center justify-center gap-2 transition-all">
                            {isTestingConnection ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                            {isTestingConnection ? "Verificando..." : "Testar Conexão Manualmente"}
                    </button>
                    {connectionStatus && (
                        <div className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${connectionStatus.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                            {connectionStatus.success ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                            {connectionStatus.message}
                        </div>
                    )}
                 </div>
                 
                 <div className="pt-4 border-t border-white/5 flex justify-end">
                     <button onClick={() => setShowAwsConfig(false)} className="px-8 py-3 bg-white text-black rounded-xl font-bold text-sm hover:bg-zinc-200 transition-colors">Fechar</button>
                 </div>
              </div>
           </div>
        </div>
      )}
      
      {/* Delete Confirmation */}
      {deleteConfirmationId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0f0f11] border border-white/10 p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center">
             <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-6 mx-auto"><Trash2 className="w-8 h-8 text-red-500" /></div>
             <h3 className="text-xl font-bold text-white mb-2">Tem certeza?</h3>
             <p className="text-zinc-400 text-sm mb-8">Essa imagem será removida permanentemente.</p>
             <div className="flex gap-3">
                 <button onClick={() => setDeleteConfirmationId(null)} className="flex-1 py-3 bg-white/5 text-zinc-300 rounded-xl hover:bg-white/10 transition-colors">Cancelar</button>
                 <button onClick={confirmDelete} className="flex-1 py-3 bg-red-600 text-white rounded-xl hover:bg-red-500 transition-colors shadow-lg shadow-red-600/20">Excluir</button>
             </div>
          </div>
        </div>
      )}

      {isCameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
           <div className="relative w-full max-w-4xl px-4 flex flex-col items-center">
             <button onClick={stopCamera} className="absolute top-4 right-4 p-4 bg-white/10 text-white rounded-full backdrop-blur-md"><X className="w-6 h-6" /></button>
             <div className="rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-black relative aspect-video w-full max-h-[80vh]"><video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" /></div>
             <button onClick={capturePhoto} className="mt-8 w-20 h-20 rounded-full border-4 border-white flex items-center justify-center bg-transparent hover:bg-white/10 transition-colors"><div className="w-16 h-16 rounded-full bg-red-600 shadow-lg"></div></button>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;

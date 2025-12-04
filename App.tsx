
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
  Info,
  Code,
  Calendar,
  HardDrive,
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
  Globe,
  Database,
  Lock,
  Loader2
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
  
  // Main Gallery State
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'processing' | 'completed' | 'error'>('all');
  
  // Staging Queue State
  const [stagingQueue, setStagingQueue] = useState<StagedFile[]>([]);
  const [selectedStagedIds, setSelectedStagedIds] = useState<Set<string>>(new Set());

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 }); // Novo estado para progresso
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
  const [isDraggingZoom, setIsDraggingZoom] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

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
  const velocityRef = useRef({ x: 0, y: 0 });
  const lastPanTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const lastTouchDistanceRef = useRef<number | null>(null);

  // Camera State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  // Simulate initial metrics data
  useEffect(() => {
    const initialMetrics: MetricPoint[] = Array.from({ length: 12 }, (_, i) => ({
      time: `${10 + i}:00`,
      invocations: Math.floor(Math.random() * 50) + 10,
      duration: Math.floor(Math.random() * 200) + 100,
      errors: Math.random() > 0.9 ? 1 : 0,
    }));
    setMetrics(initialMetrics);

    const initialLogs: LogEntry[] = [
      { id: '1', timestamp: new Date().toISOString(), level: 'INFO', message: 'Sistema inicializado em modo Híbrido (AWS/Simulado)', service: 'Lambda' },
      { id: '2', timestamp: new Date().toISOString(), level: 'INFO', message: `Monitoramento ativo`, service: 'S3-Input' },
    ];
    setLogs(initialLogs);
  }, []); // Run once on mount

  // Calculate estimated size when settings change
  useEffect(() => {
      const calculateEstimate = async () => {
          let sourceFile: File | string | undefined;
          let originalSize = 0;
          
          if (stagingQueue.length > 0) {
             // Prioritize selected item in staging, or first item
             const selectedStaged = stagingQueue.find(item => selectedStagedIds.has(item.id));
             const target = selectedStaged || stagingQueue[0];
             sourceFile = target.file;
             originalSize = target.file.size;
          } else if (images.length > 0) {
             // Fallback to library
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

  // Camera cleanup
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
        // Auto-switch to generator tab if not there
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

  const testAwsConnection = async () => {
    if (!awsConfig.accessKeyId || !awsConfig.secretAccessKey) {
        setConnectionStatus({ success: false, message: "Insira as chaves de acesso." });
        return;
    }
    setIsTestingConnection(true);
    setConnectionStatus(null);
    try {
        await validateConnection(awsConfig);
        setConnectionStatus({ success: true, message: "Conexão estabelecida com sucesso! Bucket acessível." });
    } catch (err: any) {
        let msg = "Erro desconhecido.";
        if (err.name === 'NetworkingError' || err.message === 'Network Error') {
            msg = "Erro de Rede/CORS. Verifique se o CORS está configurado no bucket.";
        } else if (err.$metadata?.httpStatusCode === 403) {
            msg = "Acesso Negado (403). Verifique as permissões do usuário IAM.";
        } else if (err.$metadata?.httpStatusCode === 404) {
            msg = "Bucket não encontrado (404). Verifique o nome do bucket.";
        } else {
            msg = err.message || JSON.stringify(err);
        }
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

      const newProcessItems = itemsToProcess.map(item => ({
        file: item.file, 
        id: item.id,
        originalName: item.file.name,
        originalSize: item.file.size,
        thumbnailUrl: '',
        processedAt: new Date(),
        status: 'processing' as const,
        processedSize: 0,
        processingSource: 'local' as const,
        processedName: item.file.name // Inicialmente igual, muda ao completar
      }));

      setImages(prev => [...newProcessItems, ...prev]);
      setStagingQueue(prev => prev.filter(item => !selectedStagedIds.has(item.id)));
      setSelectedStagedIds(new Set());

      let processedCount = 0;

      const processSingleFile = async (item: typeof newProcessItems[0]) => {
        const { file, id, originalName } = item;
        const startTime = performance.now();
        
        // Gerar chave única para o S3 (Timestamp + Nome Original) para evitar sobrescrita
        const uniqueKey = `${Date.now()}-${originalName}`;

        try {
          let thumbBase64 = '';
          let sourceUsed = 'local';
          let duration = 0;

          // 1. Processar Base64 para IA (necessário tanto para IA quanto para fallback local)
          const rawBase64 = await fileToBase64(file);

          // 2. Análise de IA em paralelo ao Upload para ganhar tempo, mas usaremos os dados depois
          // Importante: A IA vai sugerir o nome do arquivo aqui.
          let analysis = { description: "", tags: [] as string[], suggestedName: "" };
          try {
             addLog('INFO', `Gemini: Analisando conteúdo de ${originalName}...`, 'Lambda');
             analysis = await analyzeImage(rawBase64);
          } catch (aiErr) {
             console.warn("AI Analysis skipped or failed", aiErr);
             analysis = { 
                description: "Análise indisponível", 
                tags: ["erro"], 
                suggestedName: originalName.split('.')[0] 
             };
          }

          // Definir o nome final com base na sugestão da IA e na extensão escolhida
          const newExt = getNewExtension(outputConfig.format);
          const baseName = analysis.suggestedName || originalName.substring(0, originalName.lastIndexOf('.')) || "imagem";
          const finalDisplayName = `${baseName}.${newExt}`;

          // 3. Tentativa de Processamento AWS
          if (awsConfig.enabled && awsConfig.accessKeyId && awsConfig.secretAccessKey) {
             try {
                addLog('INFO', `AWS S3: Iniciando Upload de ${originalName}...`, 'S3-Input');
                // Envia com a chave única
                await uploadToS3Input(file, awsConfig, uniqueKey);
                addLog('INFO', `AWS S3: Upload concluído. Aguardando Lambda...`, 'Lambda');
                
                // Polling para esperar a thumbnail com a chave única
                thumbBase64 = await pollForProcessedImage(uniqueKey, awsConfig);
                sourceUsed = 'aws';
                addLog('INFO', `AWS S3: Thumbnail recuperada com sucesso!`, 'S3-Output');
             } catch (awsError: any) {
                const msg = awsError.message || "Erro desconhecido";
                addLog('WARN', `Falha na AWS (${msg}). Usando fallback local.`, 'Lambda');
                console.warn("AWS Fallback Reason:", awsError);
                // Se falhar, cai para o fallback local abaixo
             }
          }

          // 4. Fallback Local (Simulação)
          if (!thumbBase64) {
             addLog('INFO', `Simulação Local: Processando ${originalName}`, 'Lambda');
             thumbBase64 = await generateThumbnail(file, outputConfig);
             sourceUsed = 'local';
             addLog('INFO', `Simulação: Salvo como ${finalDisplayName}`, 'S3-Output');
          }
          
          // Calcular tamanho
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
                processedName: finalDisplayName // Nome sugerido pela IA
              };
            }
            return img;
          }));
  
          updateMetrics(duration, false);
  
        } catch (error) {
          console.error(error);
          setImages(prev => prev.map(img => img.id === id ? { ...img, status: 'error' } : img));
          addLog('ERROR', `Erro Fatal em ${originalName}: ${(error as Error).message}`, 'Lambda');
          updateMetrics(5000, true); 
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
    link.download = filename; // O nome já inclui a extensão correta e a sugestão da IA
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
                title: 'CloudThumb Image',
                text: img.aiDescription || 'Imagem processada',
                files: [file]
            });
        } else {
            alert('Seu navegador não suporta compartilhamento nativo.');
        }
    } catch (err) {
        console.error(err);
        addLog('ERROR', 'Falha ao compartilhar imagem.', 'Lambda');
    }
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
            
            await navigator.share({
                title: 'CloudThumb Images',
                text: `Compartilhando ${files.length} imagens.`,
                files: files
            });
          } else {
             alert('Seu navegador não suporta compartilhamento de múltiplos arquivos.');
          }
      } catch (err) {
        console.error(err);
        addLog('ERROR', 'Falha ao compartilhar lote.', 'Lambda');
      }
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

  const toggleDetails = (id: string) => {
    setExpandedImageId(prev => prev === id ? null : id);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const handleBatchDelete = () => {
    const count = selectedIds.size;
    setImages(prev => prev.filter(img => !selectedIds.has(img.id)));
    setSelectedIds(new Set());
    setExpandedImageId(null);
    addLog('INFO', `Exclusão em lote: ${count} imagens removidas.`, 'S3-Output');
  };

  const handleGenerateAll = async () => {
      if (isProcessing) return;
      const targets = images.filter(img => img.status !== 'error');
      if (targets.length === 0) return;

      setIsProcessing(true);
      setProcessingProgress({ current: 0, total: targets.length });
      addLog('INFO', `Regenerando ${targets.length} imagens...`, 'Lambda');
      
      let processedCount = 0;

      const processItem = async (item: ProcessedImage) => {
          try {
              // Regeneração é sempre local (simulação) pois AWS exigiria re-upload e custo
              const source = item.file || item.thumbnailUrl;
              const newThumb = await generateThumbnail(source, outputConfig);
              
              // Mantém o nome base da IA se já existir, apenas atualiza a extensão
              const currentName = item.processedName || item.originalName;
              const nameWithoutExt = currentName.substring(0, currentName.lastIndexOf('.')) || currentName;
              const newExt = getNewExtension(outputConfig.format);
              const finalDisplayName = `${nameWithoutExt}.${newExt}`;

              const stringLength = newThumb.length - (newThumb.indexOf(',') + 1);
              const sizeInBytes = Math.round(stringLength * 0.75);

              setImages(prev => prev.map(img => 
                  img.id === item.id 
                  ? { 
                      ...img, 
                      thumbnailUrl: newThumb, 
                      processedSize: sizeInBytes, 
                      processedAt: new Date(), 
                      status: 'completed', 
                      processingSource: 'local',
                      processedName: finalDisplayName 
                    } 
                  : img
              ));
          } catch (e) {
              console.error(e);
          } finally {
              processedCount++;
              setProcessingProgress(prev => ({ ...prev, current: processedCount }));
          }
      };

      await Promise.all(targets.map(processItem));
      setTimeout(() => setIsProcessing(false), 500);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setCameraStream(stream);
      setIsCameraOpen(true);
    } catch (err) {
      addLog('ERROR', 'Acesso à câmera negado.', 'S3-Input');
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
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

  const openEditor = (img: ProcessedImage) => {
      setEditingImageId(img.id);
      const initialFilters = { brightness: 100, contrast: 100, saturation: 100, rotation: 0 };
      setEditFilters(initialFilters);
      setFilterHistory([initialFilters]);
      setHistoryIndex(0);
      setIsPreviewEnabled(true);
  };

  const closeEditor = () => {
      setEditingImageId(null);
      setFilterHistory([]);
      setHistoryIndex(0);
      setIsPreviewEnabled(true);
  };

  const commitHistory = useCallback(() => {
    const current = editFilters;
    const previous = filterHistory[historyIndex];
    const isDifferent = 
        current.brightness !== previous?.brightness ||
        current.contrast !== previous?.contrast ||
        current.saturation !== previous?.saturation ||
        current.rotation !== previous?.rotation;

    if (isDifferent) {
        const newHistory = filterHistory.slice(0, historyIndex + 1);
        newHistory.push(current);
        setFilterHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    }
  }, [editFilters, filterHistory, historyIndex]);

  const handleUndo = () => {
      if (historyIndex > 0) {
          const prev = filterHistory[historyIndex - 1];
          setEditFilters(prev);
          setHistoryIndex(historyIndex - 1);
      }
  };

  const handleRedo = () => {
      if (historyIndex < filterHistory.length - 1) {
          const next = filterHistory[historyIndex + 1];
          setEditFilters(next);
          setHistoryIndex(historyIndex + 1);
      }
  };

  const saveEditedImage = async () => {
      if (!editingImageId) return;
      const originalImg = images.find(i => i.id === editingImageId);
      if (!originalImg) return;
      try {
          const source = originalImg.file || originalImg.thumbnailUrl;
          const newThumbnail = await generateThumbnail(source, outputConfig, editFilters);
          
          const stringLength = newThumbnail.length - (newThumbnail.indexOf(',') + 1);
          const sizeInBytes = Math.round(stringLength * 0.75);

          setImages(prev => prev.map(img => 
              img.id === editingImageId ? { ...img, thumbnailUrl: newThumbnail, processedSize: sizeInBytes, processedAt: new Date() } : img
          ));
          closeEditor();
      } catch (err) {
          console.error(err);
      }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isProcessing && !showDropSuccess) setIsDragging(true);
  }, [isProcessing, showDropSuccess]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isProcessing) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setShowDropSuccess(true);
      setTimeout(() => setShowDropSuccess(false), 2000);
      stageFiles(e.dataTransfer.files);
    }
  }, [isProcessing]);

  // Lightbox & Pan logic omitted for brevity (unchanged)
  const openLightbox = (img: ProcessedImage) => {
    if (img.status === 'completed') {
      setSelectedImage(img);
      setZoomLevel(1);
      setRotation(0);
      setPanPosition({ x: 0, y: 0 });
      velocityRef.current = { x: 0, y: 0 };
    }
  };
  const closeLightbox = () => {
      setSelectedImage(null);
      if(animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
  };
  const handleZoomIn = () => setZoomLevel(p => Math.min(p + 0.5, 5));
  const handleZoomOut = () => setZoomLevel(p => Math.max(p - 0.5, 0.5));
  const handleRotateCw = () => setRotation(p => p + 90);
  const handleRotateCcw = () => setRotation(p => p - 90);
  const handleResetZoom = () => {
    setZoomLevel(1); setRotation(0); setPanPosition({x:0,y:0}); velocityRef.current={x:0,y:0};
  };
  
  // Filtering
  const filteredImages = images.filter(img => statusFilter === 'all' ? true : img.status === statusFilter);
  const getCount = (status: typeof statusFilter) => status === 'all' ? images.length : images.filter(i => i.status === status).length;
  const areAllVisibleSelected = filteredImages.length > 0 && filteredImages.every(img => selectedIds.has(img.id));
  const handleSelectAll = () => {
    if (areAllVisibleSelected) setSelectedIds(prev => { const n = new Set(prev); filteredImages.forEach(i => n.delete(i.id)); return n; });
    else setSelectedIds(prev => { const n = new Set(prev); filteredImages.forEach(i => n.add(i.id)); return n; });
  };

  const currentEditingImage = editingImageId ? images.find(i => i.id === editingImageId) : null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-slate-200">
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md bg-opacity-80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-2 rounded-lg shadow-lg shadow-blue-500/20"><Cloud className="w-6 h-6 text-white" /></div>
              <div>
                  <h1 className="text-xl font-bold text-white tracking-tight">CloudThumb <span className="text-blue-500">AI</span></h1>
                  <p className="text-xs text-slate-400 font-medium">Serverless Architecture</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={() => setShowAwsConfig(true)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-2 transition-all ${awsConfig.enabled ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                   {awsConfig.enabled ? <Zap className="w-3 h-3 fill-current" /> : <Database className="w-3 h-3" />}
                   {awsConfig.enabled ? 'AWS Live' : 'Simulação'}
              </button>
              <div className="h-6 w-px bg-slate-800"></div>
              <button onClick={() => setActiveTab('generator')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'generator' ? 'bg-slate-800 text-blue-400' : 'text-slate-400 hover:text-white'}`}>Gerador</button>
              <button onClick={() => setActiveTab('monitoring')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'monitoring' ? 'bg-slate-800 text-blue-400' : 'text-slate-400 hover:text-white'}`}>Monitoramento</button>
            </div>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'generator' && (
          <div className="space-y-8 animate-in fade-in">
            <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8 relative overflow-hidden backdrop-blur-xl">
               <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"></div>
               <div className="max-w-xl mx-auto space-y-6">
                 <div className="text-center">
                    <div className="inline-flex items-center justify-center p-3 bg-slate-900 rounded-full mb-4 ring-1 ring-slate-700 shadow-xl"><Upload className="w-6 h-6 text-blue-400" /></div>
                    <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">Upload e Otimização</h2>
                    <p className="text-slate-400">Arraste imagens ou use a câmera. Configure compressão e qualidade abaixo.</p>
                 </div>

                 <div className="flex justify-center">
                    <button onClick={() => setShowSettings(!showSettings)} className={`flex items-center gap-2 text-sm transition-colors ${showSettings ? 'text-blue-400' : 'text-slate-400 hover:text-blue-400'}`}>
                        <Settings className="w-4 h-4" /> Configurações de Saída {showSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                 </div>

                 {showSettings && (
                     <div className="bg-slate-900/80 p-5 rounded-xl border border-slate-700 animate-in slide-in-from-top-2 shadow-2xl backdrop-blur-md">
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                             {/* Coluna 1: Formato e Tamanho */}
                             <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Formato de Saída</label>
                                    <select 
                                        value={outputConfig.format}
                                        onChange={(e) => setOutputConfig(prev => ({...prev, format: e.target.value as any}))}
                                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none"
                                    >
                                        <option value="image/jpeg">JPEG (Padrão)</option>
                                        <option value="image/png">PNG (Transparente)</option>
                                        <option value="image/webp">WebP (Moderno)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Largura Máxima ({outputConfig.maxWidth}px)</label>
                                    <select 
                                        value={outputConfig.maxWidth}
                                        onChange={(e) => setOutputConfig(prev => ({...prev, maxWidth: parseInt(e.target.value)}))}
                                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-white outline-none"
                                    >
                                        <option value="150">150px (Ícone)</option>
                                        <option value="300">300px (Padrão)</option>
                                        <option value="600">600px (Grande)</option>
                                        <option value="1080">1080px (HD)</option>
                                    </select>
                                </div>
                             </div>

                             {/* Coluna 2: Controles de Otimização */}
                             <div className="space-y-4 bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                                {/* Toggle Quality */}
                                <div>
                                   <div className="flex items-center justify-between mb-2">
                                       <label className="text-sm font-medium text-white flex items-center gap-2">
                                            <Sliders className="w-4 h-4 text-purple-400" />
                                            Ajustar Qualidade
                                       </label>
                                       <button onClick={() => setOutputConfig(p => ({...p, useCustomQuality: !p.useCustomQuality}))}>
                                           {outputConfig.useCustomQuality ? <ToggleRight className="w-8 h-8 text-blue-500" /> : <ToggleLeft className="w-8 h-8 text-slate-600" />}
                                       </button>
                                   </div>
                                   {outputConfig.useCustomQuality && (
                                       <div className="animate-in fade-in slide-in-from-top-1">
                                            <div className="flex justify-between text-xs text-slate-400 mb-1">
                                                <span>Baixa</span>
                                                <span>{Math.round(outputConfig.quality * 100)}%</span>
                                                <span>Alta</span>
                                            </div>
                                            <input 
                                                type="range" min="0.1" max="1" step="0.05"
                                                value={outputConfig.quality}
                                                onChange={(e) => setOutputConfig(prev => ({...prev, quality: parseFloat(e.target.value)}))}
                                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                            />
                                            {outputConfig.format === 'image/png' && (
                                                <p className="text-[10px] text-yellow-500 mt-1 flex items-center gap-1">
                                                    <AlertTriangle className="w-3 h-3" />
                                                    PNG ignora perda de qualidade (Use Compressão).
                                                </p>
                                            )}
                                       </div>
                                   )}
                                </div>

                                {/* Toggle Compression */}
                                <div className="border-t border-slate-700 pt-3">
                                   <div className="flex items-center justify-between mb-2">
                                       <label className="text-sm font-medium text-white flex items-center gap-2">
                                            <HardDrive className="w-4 h-4 text-orange-400" />
                                            Ativar Compressão
                                       </label>
                                       <button onClick={() => setOutputConfig(p => ({...p, useCompression: !p.useCompression}))}>
                                           {outputConfig.useCompression ? <ToggleRight className="w-8 h-8 text-blue-500" /> : <ToggleLeft className="w-8 h-8 text-slate-600" />}
                                       </button>
                                   </div>
                                   {outputConfig.useCompression && (
                                       <div className="animate-in fade-in slide-in-from-top-1">
                                            <div className="flex justify-between text-xs text-slate-400 mb-1">
                                                <span>Leve</span>
                                                <span>Força: {Math.round(outputConfig.compression * 100)}%</span>
                                                <span>Agressiva</span>
                                            </div>
                                            <input 
                                                type="range" min="0.1" max="0.9" step="0.1"
                                                value={outputConfig.compression}
                                                onChange={(e) => setOutputConfig(prev => ({...prev, compression: parseFloat(e.target.value)}))}
                                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                            />
                                            <p className="text-[10px] text-slate-500 mt-1">Reduz resolução para economizar espaço.</p>
                                       </div>
                                   )}
                                </div>
                             </div>
                         </div>

                         {/* Seção de Estimativa e Botão de Ação */}
                         <div className="flex flex-col md:flex-row md:items-center justify-between border-t border-slate-700 pt-4 mt-2 gap-4">
                             <div className="flex-1">
                                 {sizeStats && (
                                     <div className="flex flex-col gap-2">
                                        <div className="flex items-center justify-between text-xs text-slate-400">
                                            <span>Estimativa de Redução</span>
                                            {sizeStats.original > 0 && (
                                                <span className={`${sizeStats.estimated < sizeStats.original ? 'text-green-400' : 'text-slate-400'}`}>
                                                    {sizeStats.estimated < sizeStats.original ? 'Economia de ' : ''}
                                                    {Math.abs(Math.round(((sizeStats.original - sizeStats.estimated) / sizeStats.original) * 100))}%
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 bg-slate-800/50 p-2 rounded-lg border border-slate-700">
                                            <div className="text-xs text-slate-400">
                                                <span className="block mb-0.5 font-medium text-slate-500 uppercase tracking-wider text-[10px]">Original</span>
                                                <span className="font-mono text-slate-300">{formatBytes(sizeStats.original)}</span>
                                            </div>
                                            <ArrowRight className="w-4 h-4 text-slate-600" />
                                            <div className="text-xs text-blue-300">
                                                <span className="block mb-0.5 font-medium text-blue-500 uppercase tracking-wider text-[10px]">Final</span>
                                                <span className="font-mono font-bold text-blue-200">{formatBytes(sizeStats.estimated)}</span>
                                            </div>
                                        </div>
                                     </div>
                                 )}
                             </div>
                             <button
                                 onClick={handleGenerateAll}
                                 disabled={isProcessing || images.length === 0}
                                 className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 disabled:opacity-50 text-slate-300 text-xs font-medium rounded transition-colors whitespace-nowrap self-end md:self-auto"
                             >
                                 <RefreshCw className="w-3 h-3" />
                                 Regenerar Biblioteca
                             </button>
                         </div>
                     </div>
                 )}
                 
                 <div className="mt-4">
                   <label 
                      className="relative group cursor-pointer block w-full"
                      onDragOver={handleDragOver}
                      onDragEnter={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                   >
                     <div className={`
                       border-3 border-dashed rounded-2xl p-14 transition-all duration-300 ease-out transform
                       flex flex-col items-center justify-center min-h-[220px] relative overflow-hidden
                       ${isDragging 
                          ? 'border-blue-500 bg-blue-500/10 scale-105 ring-8 ring-blue-500/20 shadow-2xl' 
                          : 'border-slate-600 hover:border-blue-400 hover:bg-slate-800/50'
                       }
                     `}>
                       {awsConfig.enabled && (
                          <div className="absolute top-4 right-4 z-20 bg-green-500/10 border border-green-500/20 text-green-400 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 backdrop-blur-sm animate-in fade-in slide-in-from-top-2">
                             <Database className="w-3 h-3" />
                             <span>Upload S3 Ativo</span>
                          </div>
                       )}

                       <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} disabled={isProcessing} />
                       <div className={`flex flex-col items-center space-y-3 transition-opacity duration-300 ${isProcessing || showDropSuccess || isDragging ? 'opacity-20 blur-[2px]' : 'opacity-100'}`}>
                         <Cloud className="w-12 h-12 text-slate-500 group-hover:text-blue-400 transition-colors" />
                         <span className="text-white font-medium block text-lg">Clique ou Arraste Imagens</span>
                       </div>
                       <div className={`mt-4 relative z-30 transition-opacity duration-300 ${isProcessing || showDropSuccess || isDragging ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); startCamera(); }} className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-full text-sm font-medium transition-colors border border-slate-600 shadow-lg">
                            <Camera className="w-4 h-4" /> Usar Câmera
                          </button>
                       </div>
                       {isDragging && (
                         <div className="absolute inset-0 flex flex-col items-center justify-center bg-blue-500/10 z-10 animate-in fade-in duration-200">
                            <FileUp className="w-16 h-16 text-blue-400 animate-bounce" />
                            <span className="text-blue-300 font-bold text-xl mt-4 drop-shadow-md">Solte para processar</span>
                         </div>
                       )}
                       {showDropSuccess && (
                         <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 z-50 animate-in fade-in duration-300 backdrop-blur-md rounded-2xl">
                           <div className="bg-green-500 rounded-full p-6 mb-4 shadow-[0_0_50px_rgba(34,197,94,0.5)] animate-[bounce_0.6s_infinite]"><CheckCircle className="w-20 h-20 text-white" /></div>
                           <span className="text-green-400 font-bold text-2xl animate-in slide-in-from-bottom-4">Sucesso!</span>
                         </div>
                       )}
                     </div>
                   </label>
                 </div>
               </div>
            </div>

            {stagingQueue.length > 0 && (
                <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-lg animate-in slide-in-from-top-4 backdrop-blur-sm bg-opacity-80">
                    <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                             <List className="w-5 h-5 text-blue-400" /><h3 className="font-semibold text-white">Fila de Upload ({stagingQueue.length})</h3>
                        </div>
                        <div className="flex items-center gap-3">
                             <span className="text-xs text-slate-400">{selectedStagedIds.size} selecionados</span>
                             <button onClick={clearStage} className="text-xs text-red-400 hover:underline">Limpar Tudo</button>
                        </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                        {stagingQueue.map((item) => {
                            const isSelected = selectedStagedIds.has(item.id);
                            return (
                                <div key={item.id} className={`flex items-center gap-4 p-3 rounded-lg border transition-all ${isSelected ? 'bg-blue-500/10 border-blue-500/30' : 'bg-slate-900 border-slate-700'}`}>
                                    <div onClick={() => toggleStagedSelection(item.id)} className="cursor-pointer text-slate-400 hover:text-white">
                                        {isSelected ? <CheckSquare className="w-5 h-5 text-blue-500" /> : <Square className="w-5 h-5" />}
                                    </div>
                                    <img src={item.previewUrl} alt="preview" className="w-10 h-10 rounded object-cover border border-slate-600" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-white truncate">{item.file.name}</p>
                                        <p className="text-xs text-slate-500">{formatBytes(item.file.size)}</p>
                                    </div>
                                    <button onClick={() => removeFromStage(item.id)} className="p-2 hover:bg-slate-800 rounded text-slate-500 hover:text-red-400"><X className="w-4 h-4" /></button>
                                </div>
                            );
                        })}
                    </div>
                    <div className="p-4 bg-slate-900/50 border-t border-slate-700 flex justify-end">
                        <button onClick={processStagedFiles} disabled={selectedStagedIds.size === 0 || isProcessing} className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg shadow-lg transition-colors">
                            {isProcessing ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>Processando...</> : <><Play className="w-4 h-4 fill-current" />Processar Selecionados ({selectedStagedIds.size})</>}
                        </button>
                    </div>
                </div>
            )}

            {/* Gallery Section */}
            <div>
              <div className="flex flex-col gap-4 mb-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2"><ImageIcon className="w-5 h-5 text-blue-400" />Biblioteca de Uploads</h3>
                  <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 overflow-x-auto max-w-full">
                    {[
                      { id: 'all', label: 'Todos', icon: null },
                      { id: 'processing', label: 'Processando', icon: Cpu },
                      { id: 'completed', label: 'Concluído', icon: CheckCircle },
                      { id: 'error', label: 'Erro', icon: AlertTriangle },
                    ].map((filter) => {
                      const count = getCount(filter.id as any);
                      const isActive = statusFilter === filter.id;
                      const Icon = filter.icon;
                      return (
                        <button key={filter.id} onClick={() => setStatusFilter(filter.id as any)} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${isActive ? 'bg-slate-700 text-white shadow-sm ring-1 ring-slate-600' : 'text-slate-400 hover:text-slate-200'}`}>
                          {Icon && <Icon className={`w-3 h-3 ${filter.id === 'error' ? 'text-red-400' : filter.id === 'completed' ? 'text-green-400' : 'text-blue-400'}`} />}
                          {filter.label} <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${isActive ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-500'}`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {images.length > 0 && (
                  <div className="flex items-center justify-between bg-slate-900/50 p-3 rounded-lg border border-slate-800 animate-in fade-in slide-in-from-top-2">
                     <div className="flex items-center gap-3">
                        <button onClick={handleSelectAll} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
                          {areAllVisibleSelected ? <CheckSquare className="w-5 h-5 text-blue-500" /> : <Square className="w-5 h-5" />}
                          <span>Selecionar Tudo ({filteredImages.length})</span>
                        </button>
                     </div>
                     <div className="flex items-center gap-2">
                        {selectedIds.size > 0 && (
                            <>
                                <button onClick={handleBatchShare} className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 rounded-md text-sm font-medium transition-all animate-in zoom-in"><Share2 className="w-4 h-4" /> Compartilhar</button>
                                <button onClick={handleBatchDelete} className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 rounded-md text-sm font-medium transition-all animate-in zoom-in"><Trash2 className="w-4 h-4" /> Excluir</button>
                            </>
                        )}
                     </div>
                  </div>
                )}
              </div>

              {/* Gallery Grid */}
              {images.length === 0 ? (
                <div className="text-center py-20 bg-slate-800/30 rounded-xl border border-dashed border-slate-700"><p className="text-slate-500">Nenhuma imagem enviada ainda.</p></div>
              ) : filteredImages.length === 0 ? (
                <div className="text-center py-20 bg-slate-800/30 rounded-xl border border-dashed border-slate-700 flex flex-col items-center">
                  <div className="bg-slate-800 p-3 rounded-full mb-3"><Filter className="w-6 h-6 text-slate-500" /></div>
                  <p className="text-slate-400 font-medium">Nenhum resultado para este filtro.</p>
                  <button onClick={() => setStatusFilter('all')} className="mt-3 text-sm text-blue-400 hover:underline flex items-center gap-1"><XCircle className="w-3 h-3" /> Limpar filtros</button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {filteredImages.map((img) => {
                    const isSelected = selectedIds.has(img.id);
                    return (
                      <div key={img.id} className={`bg-slate-800 rounded-xl border overflow-hidden shadow-lg transition-all duration-300 flex flex-col h-full group hover:-translate-y-1 hover:shadow-2xl ${isSelected ? 'ring-2 ring-blue-500 border-blue-500/50 shadow-blue-500/10' : 'border-slate-700 hover:border-slate-500'}`}>
                         {/* Card Header/Image */}
                         <div className={`relative aspect-video flex items-center justify-center p-4 overflow-hidden transition-colors ${isSelected ? 'bg-blue-900/10' : 'bg-slate-900'}`} onClick={() => openLightbox(img)}>
                            <div className="absolute top-2 left-2 z-10" onClick={(e) => { e.stopPropagation(); toggleSelection(img.id); }}>
                               <div className={`p-1 rounded bg-slate-900/80 backdrop-blur-sm border transition-all cursor-pointer hover:bg-slate-800 ${isSelected ? 'border-blue-500 text-blue-500' : 'border-slate-600 text-slate-400'}`}>
                                 {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                               </div>
                            </div>
                            {/* Source Badge */}
                            <div className="absolute top-2 right-2 z-10">
                               <div className={`px-2 py-0.5 rounded text-[10px] font-bold border backdrop-blur-sm ${img.processingSource === 'aws' ? 'bg-green-500/20 border-green-500/30 text-green-400' : 'bg-blue-500/20 border-blue-500/30 text-blue-400'}`}>
                                   {img.processingSource === 'aws' ? 'AWS' : 'LOCAL'}
                               </div>
                            </div>

                            {img.status === 'processing' ? <Cpu className="w-8 h-8 text-slate-500 animate-bounce" /> : <img src={img.thumbnailUrl} alt={img.originalName} className="max-h-full max-w-full rounded shadow-md object-contain" />}
                            {img.status === 'completed' && <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[1px]"><div className="bg-slate-900/80 p-2 rounded-full text-white transform scale-90 group-hover:scale-100 transition-transform"><Maximize2 className="w-6 h-6" /></div></div>}
                         </div>
                         
                         {/* Card Body */}
                         <div className="p-4 flex flex-col flex-1">
                            <div className="flex items-start justify-between mb-2">
                               <h4 className="font-medium text-white truncate w-full pr-2" title={img.processedName || img.originalName}>
                                   {img.status === 'completed' && img.processedName ? img.processedName : img.originalName}
                               </h4>
                               {img.status === 'completed' && <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />}
                            </div>
                            
                            {/* Size Info */}
                            <div className="mb-3 text-xs flex items-center gap-1.5 text-slate-400 bg-slate-900/50 p-1.5 rounded border border-slate-700/50">
                                <HardDrive className="w-3 h-3 text-slate-500" />
                                <span>{formatBytes(img.originalSize)}</span>
                                {img.processedSize && img.processedSize < img.originalSize && (
                                    <>
                                        <ArrowRight className="w-3 h-3 text-slate-600" />
                                        <span className="text-green-400 font-bold">{formatBytes(img.processedSize)}</span>
                                        <span className="ml-auto text-[10px] bg-green-500/10 text-green-400 px-1 rounded">
                                            -{Math.round(((img.originalSize - img.processedSize) / img.originalSize) * 100)}%
                                        </span>
                                    </>
                                )}
                            </div>

                            {img.status === 'completed' && <div className="space-y-2 flex-1"><div className="bg-slate-900/50 p-2 rounded text-xs text-slate-300 border border-slate-700 line-clamp-2"><span className="text-blue-400 font-semibold inline mr-1">IA:</span>{img.aiDescription || '...'}</div></div>}
                            
                            {/* Expanded Details */}
                            {expandedImageId === img.id && img.status === 'completed' && (
                               <div className="mt-4 animate-in slide-in-from-top-2">
                                 <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 text-xs space-y-3">
                                    <div className="pt-2"><pre className="bg-slate-900 p-2 rounded text-[10px] text-slate-300 overflow-x-auto font-mono custom-scrollbar">{JSON.stringify({tags: img.aiTags}, null, 2)}</pre></div>
                                 </div>
                               </div>
                            )}

                            {/* Actions Toolbar */}
                            <div className="mt-4 pt-3 border-t border-slate-700/50 grid grid-cols-5 gap-1">
                               {img.status === 'completed' && (
                                 <>
                                   <button onClick={(e) => handleDownload(e, img.thumbnailUrl, img.processedName || img.originalName)} className="group relative flex items-center justify-center p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-600 hover:border-blue-500 transition-colors"><Download className="w-4 h-4" /></button>
                                   <button onClick={() => openEditor(img)} className="flex items-center justify-center p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-600 hover:border-blue-500 transition-colors"><Edit3 className="w-4 h-4" /></button>
                                   <button onClick={(e) => handleShare(e, img)} className="flex items-center justify-center p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-600 hover:border-blue-500 transition-colors"><Share2 className="w-4 h-4" /></button>
                                   <button onClick={() => toggleDetails(img.id)} className="flex items-center justify-center p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-600 transition-colors">{expandedImageId === img.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
                                 </>
                               )}
                               <button onClick={() => setDeleteConfirmationId(img.id)} className={`flex items-center justify-center p-2 bg-slate-800 hover:bg-red-500/10 hover:text-red-400 text-slate-400 border border-slate-600 hover:border-red-500/30 rounded transition-colors ${img.status !== 'completed' ? 'col-span-5' : ''}`}><Trash2 className="w-4 h-4" /></button>
                            </div>
                         </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
        
        {activeTab === 'monitoring' && (
           <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
             <div className="flex items-center justify-between mb-2"><h2 className="text-2xl font-bold text-white flex items-center gap-2"><Activity className="w-6 h-6 text-green-400" />Painel CloudWatch</h2></div>
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-6"><InvocationsChart data={metrics} /><DurationChart data={metrics} /><ErrorChart data={metrics} /></div>
             <div className="bg-slate-800 rounded-lg border border-slate-700 shadow-sm overflow-hidden">
               <div className="px-6 py-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center"><h3 className="text-white font-medium flex items-center gap-2"><Server className="w-4 h-4 text-slate-400" />Logs</h3></div>
               <div className="h-80 overflow-y-auto bg-slate-950 p-4 font-mono text-xs custom-scrollbar">{logs.map((log) => (<div key={log.id} className="mb-2 flex gap-3 border-b border-slate-900/50 pb-1"><span className="text-slate-500 shrink-0 w-36">{new Date(log.timestamp).toLocaleTimeString()}</span><span className={`font-bold shrink-0 w-16 ${log.level === 'ERROR' ? 'text-red-500' : log.level === 'WARN' ? 'text-yellow-500' : 'text-green-500'}`}>{log.level}</span><span className="text-purple-400 shrink-0 w-24">[{log.service}]</span><span className="text-slate-300 break-all">{log.message}</span></div>))}</div>
             </div>
           </div>
        )}
      </main>
      
      {/* Processing Overlay */}
      {isProcessing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
              <div className="bg-slate-900 p-8 rounded-2xl border border-slate-700 shadow-2xl max-w-md w-full mx-4 flex flex-col items-center text-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-transparent"></div>
                  <div className="relative z-10">
                      <div className="w-16 h-16 rounded-full border-4 border-slate-800 border-t-blue-500 animate-spin mb-6 mx-auto shadow-lg shadow-blue-500/20"></div>
                      <h3 className="text-xl font-bold text-white mb-2">Processando Imagens</h3>
                      <p className="text-slate-400 mb-6 text-sm">Otimizando, redimensionando e gerando metadados de IA...</p>
                      
                      {/* Progress Bar */}
                      <div className="w-full bg-slate-800 rounded-full h-3 mb-2 overflow-hidden border border-slate-700">
                          <div 
                             className="bg-gradient-to-r from-blue-500 to-purple-600 h-full rounded-full transition-all duration-300 ease-out" 
                             style={{ width: `${(processingProgress.current / Math.max(processingProgress.total, 1)) * 100}%` }}
                          ></div>
                      </div>
                      <div className="flex justify-between w-full text-xs text-slate-500 font-mono">
                          <span>{processingProgress.current} de {processingProgress.total}</span>
                          <span>{Math.round((processingProgress.current / Math.max(processingProgress.total, 1)) * 100)}%</span>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Modals and Overlays (Lightbox, Editor, Camera, DeleteConfirm) */}
      {selectedImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={closeLightbox}>
             {/* Controls reuse previous logic */}
             <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-slate-800/80 backdrop-blur rounded-full px-4 py-2 border border-slate-700 z-50" onClick={e => e.stopPropagation()}>
               <button onClick={handleRotateCcw} className="p-2 text-slate-300 hover:text-white"><RotateCcw className="w-5 h-5" /></button>
               <button onClick={handleRotateCw} className="p-2 text-slate-300 hover:text-white"><RotateCw className="w-5 h-5" /></button>
               <div className="w-px h-6 bg-slate-700 mx-1"></div>
               <button onClick={handleZoomOut} className="p-2 text-slate-300 hover:text-white"><ZoomOut className="w-5 h-5" /></button>
               <button onClick={handleZoomIn} className="p-2 text-slate-300 hover:text-white"><ZoomIn className="w-5 h-5" /></button>
               <button onClick={handleResetZoom} className="p-2 text-slate-300 hover:text-white"><RotateCcw className="w-4 h-4" /></button>
             </div>
             <button onClick={closeLightbox} className="absolute top-6 right-6 p-2 bg-slate-800/50 hover:bg-red-500/20 text-slate-400 hover:text-red-500 rounded-full border border-slate-700 z-50"><X className="w-6 h-6" /></button>
             <div className="w-full h-full p-10 flex items-center justify-center overflow-hidden"><img src={selectedImage.thumbnailUrl} className="max-w-full max-h-full object-contain shadow-2xl transition-transform duration-75 ease-out" style={{ transform: `translate(${panPosition.x}px, ${panPosition.y}px) rotate(${rotation}deg) scale(${zoomLevel})` }} onClick={e => e.stopPropagation()} /></div>
        </div>
      )}
      
      {editingImageId && currentEditingImage && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm">
             <div className="w-full max-w-5xl h-full md:h-auto md:max-h-[90vh] flex flex-col md:flex-row bg-slate-900 border border-slate-800 md:rounded-2xl overflow-hidden shadow-2xl">
                 <div className="flex-1 bg-black relative flex items-center justify-center p-8 overflow-hidden">
                    <img src={currentEditingImage.thumbnailUrl} className="max-w-full max-h-full object-contain shadow-lg" style={isPreviewEnabled ? { filter: `brightness(${editFilters.brightness}%) contrast(${editFilters.contrast}%) saturate(${editFilters.saturation}%)`, transform: `rotate(${editFilters.rotation}deg)` } : {}} />
                 </div>
                 <div className="w-full md:w-80 bg-slate-800 p-6 flex flex-col border-l border-slate-700">
                     <div className="flex items-center justify-between mb-6"><h3 className="text-lg font-bold text-white flex items-center gap-2"><Sliders className="w-5 h-5 text-blue-400" />Editor</h3><div className="flex gap-1"><button onClick={() => setIsPreviewEnabled(!isPreviewEnabled)} className={`p-1.5 rounded ${isPreviewEnabled ? 'text-blue-400' : 'text-slate-400'}`}>{isPreviewEnabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button><button onClick={handleUndo} disabled={historyIndex <= 0} className="p-1.5 text-slate-400 disabled:opacity-30"><Undo className="w-4 h-4" /></button><button onClick={handleRedo} disabled={historyIndex >= filterHistory.length - 1} className="p-1.5 text-slate-400 disabled:opacity-30"><Redo className="w-4 h-4" /></button><button onClick={closeEditor} className="p-1.5 text-slate-400"><X className="w-5 h-5" /></button></div></div>
                     <div className="space-y-6 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                         {['brightness','contrast','saturation'].map((f) => (
                             <div key={f}><label className="flex justify-between text-xs font-medium text-slate-400 mb-2"><span className="capitalize">{f}</span><span>{(editFilters as any)[f]}%</span></label><input type="range" min="0" max="200" value={(editFilters as any)[f]} onChange={(e) => setEditFilters(p => ({...p, [f]: parseInt(e.target.value)}))} onMouseUp={commitHistory} onTouchEnd={commitHistory} className="w-full h-2 bg-slate-900 rounded-lg appearance-none cursor-pointer" /></div>
                         ))}
                         <div className="pt-4 border-t border-slate-700"><label className="block text-xs font-medium text-slate-400 mb-3">Rotação</label><div className="flex gap-2"><button onClick={() => { setEditFilters(p => ({...p, rotation: p.rotation - 90})); setTimeout(commitHistory, 0); }} className="flex-1 py-2 bg-slate-900 border border-slate-600 rounded text-slate-300"><RotateCcw className="w-4 h-4 mx-auto" /></button><button onClick={() => { setEditFilters(p => ({...p, rotation: p.rotation + 90})); setTimeout(commitHistory, 0); }} className="flex-1 py-2 bg-slate-900 border border-slate-600 rounded text-slate-300"><RotateCw className="w-4 h-4 mx-auto" /></button></div></div>
                     </div>
                     <div className="mt-6 pt-6 border-t border-slate-700 flex gap-3"><button onClick={closeEditor} className="flex-1 py-2.5 border border-slate-600 text-slate-300 rounded-lg">Cancelar</button><button onClick={saveEditedImage} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg shadow-lg flex items-center justify-center gap-2"><Save className="w-4 h-4" />Salvar</button></div>
                 </div>
             </div>
         </div>
      )}

      {isCameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
           <div className="relative w-full max-w-4xl px-4 flex flex-col items-center">
             <button onClick={stopCamera} className="absolute top-4 right-4 p-2 bg-gray-900/50 text-white rounded-full"><X className="w-6 h-6" /></button>
             <div className="rounded-2xl overflow-hidden shadow-2xl border border-gray-800 bg-gray-900 relative aspect-video w-full max-h-[80vh]"><video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" /></div>
             <div className="flex items-center gap-6 mt-8"><button onClick={stopCamera} className="px-6 py-3 rounded-full bg-gray-800 text-white font-medium">Cancelar</button><button onClick={capturePhoto} className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center bg-transparent hover:bg-white/10 group"><div className="w-16 h-16 rounded-full bg-red-600 group-hover:bg-red-500 shadow-lg"></div></button><div className="w-[96px]"></div></div>
           </div>
        </div>
      )}

      {deleteConfirmationId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-xl shadow-2xl max-w-sm w-full mx-4">
             <div className="flex flex-col items-center text-center"><div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-4"><Trash2 className="w-6 h-6 text-red-500" /></div><h3 className="text-lg font-bold text-white mb-2">Excluir Miniatura?</h3><p className="text-slate-400 text-sm mb-6">Esta ação não pode ser desfeita.</p><div className="flex gap-3 w-full"><button onClick={() => setDeleteConfirmationId(null)} className="flex-1 px-4 py-2 bg-slate-800 text-slate-300 rounded-lg">Cancelar</button><button onClick={confirmDelete} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg">Excluir</button></div></div>
          </div>
        </div>
      )}

      {/* AWS Config Modal */}
      {showAwsConfig && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-sm">
           <div className="bg-slate-900 border border-slate-700 p-8 rounded-2xl shadow-2xl max-w-lg w-full mx-4 relative">
              <button onClick={() => setShowAwsConfig(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white"><X className="w-6 h-6" /></button>
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2"><Database className="w-6 h-6 text-blue-500" /> AWS Configuration</h2>
              <p className="text-sm text-slate-400 mb-6">Insira credenciais para usar buckets S3 reais. Deixe desabilitado para simulação.</p>
              
              <div className="space-y-4">
                 <div className="flex items-center justify-between bg-slate-800 p-3 rounded-lg border border-slate-700">
                    <span className="text-white font-medium">Habilitar Integração AWS</span>
                    <button onClick={() => setAwsConfig(p => ({...p, enabled: !p.enabled}))}>
                        {awsConfig.enabled ? <ToggleRight className="w-8 h-8 text-green-500" /> : <ToggleLeft className="w-8 h-8 text-slate-500" />}
                    </button>
                 </div>
                 
                 {awsConfig.enabled && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Access Key ID</label>
                            <input type="text" value={awsConfig.accessKeyId} onChange={(e) => setAwsConfig(p => ({...p, accessKeyId: e.target.value}))} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-sm" placeholder="AKIA..." />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Secret Access Key</label>
                            <div className="relative">
                                <input type="password" value={awsConfig.secretAccessKey} onChange={(e) => setAwsConfig(p => ({...p, secretAccessKey: e.target.value}))} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-sm pr-8" placeholder="Secret..." />
                                <Lock className="w-4 h-4 text-slate-500 absolute right-2 top-2.5" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Region</label>
                                <input type="text" value={awsConfig.region} onChange={(e) => setAwsConfig(p => ({...p, region: e.target.value}))} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-sm" placeholder="us-east-1" />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Input Bucket</label>
                                <input type="text" value={awsConfig.inputBucket} onChange={(e) => setAwsConfig(p => ({...p, inputBucket: e.target.value}))} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-sm" />
                            </div>
                        </div>
                        <p className="text-[10px] text-yellow-500 mt-2 flex gap-1"><AlertTriangle className="w-3 h-3" /> Certifique-se de que o CORS está configurado no bucket.</p>
                        
                        {/* Test Connection UI */}
                        <div className="pt-2">
                            <button 
                                onClick={testAwsConnection} 
                                disabled={isTestingConnection}
                                className="w-full py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 rounded border border-slate-600 text-xs font-medium text-slate-300 flex items-center justify-center gap-2 transition-colors"
                            >
                                {isTestingConnection ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                                {isTestingConnection ? "Testando..." : "Testar Conexão"}
                            </button>
                            {connectionStatus && (
                                <div className={`mt-2 p-2 rounded text-xs flex items-center gap-2 border ${connectionStatus.success ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                                    {connectionStatus.success ? <CheckCircle className="w-3 h-3 shrink-0" /> : <AlertTriangle className="w-3 h-3 shrink-0" />}
                                    {connectionStatus.message}
                                </div>
                            )}
                        </div>
                    </div>
                 )}

                 <div className="pt-4 flex justify-end">
                     <button onClick={() => setShowAwsConfig(false)} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">Salvar Configuração</button>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;

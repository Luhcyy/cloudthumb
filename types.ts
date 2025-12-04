
export interface ProcessedImage {
  id: string;
  originalName: string;
  originalSize: number;
  thumbnailUrl: string;
  processedAt: Date;
  aiDescription?: string;
  aiTags?: string[];
  status: 'processing' | 'completed' | 'error';
  // Referência opcional para permitir re-edição com qualidade máxima durante a sessão
  file?: File;
  // Tamanho final do arquivo gerado em bytes
  processedSize?: number;
  // Flag indicando se foi processado na AWS real ou localmente
  processingSource?: 'aws' | 'local';
  // Nome final do arquivo após processamento (ex: image.webp)
  processedName?: string;
}

export interface MetricPoint {
  time: string;
  invocations: number;
  duration: number; // in ms
  errors: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  service: 'Lambda' | 'S3-Input' | 'S3-Output';
}

export interface OutputConfig {
  format: 'image/jpeg' | 'image/png' | 'image/webp';
  maxWidth: number;
  
  // Controle de Qualidade (Artefatos JPEG/WEBP)
  useCustomQuality: boolean;
  quality: number; // 0.1 to 1.0

  // Controle de Compressão (Redução de Escala/Resolução)
  useCompression: boolean;
  compression: number; // 0.0 to 1.0
}

export interface ImageFilters {
  brightness: number; // 100 default
  contrast: number; // 100 default
  saturation: number; // 100 default
  rotation: number; // 0 default
}

export interface AwsConfig {
  enabled: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  inputBucket: string;
  outputBucket: string;
}
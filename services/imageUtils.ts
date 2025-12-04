
import { OutputConfig, ImageFilters } from '../types';

/**
 * Simulates the Serverless Function resizing capability in the browser.
 * Now supports filters, dynamic configuration, explicit quality control, and resolution compression.
 */
export const generateThumbnail = (
  source: File | string, 
  config: OutputConfig,
  filters: ImageFilters = { brightness: 100, contrast: 100, saturation: 100, rotation: 0 }
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      
      // Determine rotation handling
      const rotationRad = (filters.rotation * Math.PI) / 180;
      const isRotated90 = Math.abs(filters.rotation) % 180 === 90;

      // 1. CALCULATE BASE DIMENSIONS based on maxWidth
      let scaleFactor = config.maxWidth / img.width;
      
      // 2. APPLY COMPRESSION (Resolution Reduction)
      // If compression is enabled, we further reduce the scale factor.
      // E.g., Compression 0.5 (50%) -> Reduces dimensions by 25% (visual impact)
      if (config.useCompression && config.compression > 0) {
          // Mapping: 0.0 -> 1.0 scale (no change)
          //          1.0 -> 0.3 scale (70% reduction in size)
          const compressionImpact = 1 - (config.compression * 0.7); 
          scaleFactor *= compressionImpact;
      }

      const targetWidth = Math.round(config.maxWidth * (config.useCompression ? (1 - (config.compression * 0.7)) : 1));
      // Aspect ratio calc
      const originalAspect = img.height / img.width;
      const targetHeight = Math.round(targetWidth * originalAspect);

      // Swap dimensions for canvas if rotated 90/270 degrees
      canvas.width = isRotated90 ? targetHeight : targetWidth;
      canvas.height = isRotated90 ? targetWidth : targetHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      // 3. APPLY FILTERS
      ctx.filter = `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturation}%)`;

      // 4. DRAWING (Translate center, rotate, draw image)
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rotationRad);
      
      // Draw image centered
      // We draw using targetWidth/Height relative to the unrotated coordinate system
      // Smoothing quality depends on browser, but 'high' is default usually.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
      
      // 5. DETERMINE OUTPUT QUALITY (JPEG/WebP Artifacts)
      // Default high quality if disabled
      let finalQuality = 0.92; 

      if (config.useCustomQuality) {
          // Ensure we don't pass 0, minimum 0.05
          finalQuality = Math.max(0.05, config.quality);
      }

      // Note: PNG ignores 'finalQuality' in most browsers.
      // Compression (step 2) is the only way to reduce PNG size here.
      resolve(canvas.toDataURL(config.format, finalQuality));
    };

    img.onerror = reject;

    // Handle source type
    if (typeof source === 'string') {
        img.setAttribute('crossOrigin', 'anonymous'); 
        img.src = source;
    } else {
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(source);
    }
  });
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = error => reject(error);
  });
};

export const base64ToFile = (base64: string, filename: string, mimeType: string): Promise<File> => {
    return fetch(base64)
        .then(res => res.blob())
        .then(blob => new File([blob], filename, { type: mimeType }));
};

// Helper to estimate file size of the generated thumbnail
export const estimateFileSize = async (
    source: File | string, 
    config: OutputConfig,
    filters: ImageFilters = { brightness: 100, contrast: 100, saturation: 100, rotation: 0 }
): Promise<number> => {
    try {
        const base64 = await generateThumbnail(source, config, filters);
        const stringLength = base64.length - (base64.indexOf(',') + 1);
        const sizeInBytes = stringLength * 0.75; 
        return Math.round(sizeInBytes);
    } catch (e) {
        console.warn("Failed to estimate size", e);
        return 0;
    }
};

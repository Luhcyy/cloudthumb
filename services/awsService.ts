
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { AwsConfig } from "../types";

let s3Client: S3Client | null = null;
let currentConfig: AwsConfig | null = null;

const getClient = (config: AwsConfig) => {
  // Always recreate client if key config properties change or if it doesn't exist
  if (!s3Client || 
      currentConfig?.accessKeyId !== config.accessKeyId || 
      currentConfig?.secretAccessKey !== config.secretAccessKey ||
      currentConfig?.region !== config.region
     ) {
    
    s3Client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Force standard defaults to avoid some node-specific resolution paths
      defaultsMode: 'standard'
    });
    currentConfig = { ...config };
  }
  return s3Client;
};

export const validateConnection = async (config: AwsConfig): Promise<boolean> => {
  try {
    const client = getClient(config);
    // Tenta listar objetos no bucket de entrada para verificar permissões e existência
    const command = new ListObjectsV2Command({
        Bucket: config.inputBucket,
        MaxKeys: 1
    });
    await client.send(command);
    return true;
  } catch (error: any) {
    console.error("AWS Validation Error:", error);
    if (error.message?.includes("fs.readFile")) {
        throw new Error("Erro de ambiente (fs module). Por favor, recarregue a página.");
    }
    throw error;
  }
}

export const uploadToS3Input = async (file: File, config: AwsConfig, customKey?: string): Promise<string> => {
  const client = getClient(config);
  const key = customKey || file.name;
  
  const command = new PutObjectCommand({
    Bucket: config.inputBucket,
    Key: key,
    Body: file,
    ContentType: file.type,
  });
  await client.send(command);
  return key;
};

// Converte um ReadableStream (retorno do S3 GetObject no navegador) para Blob/File
const streamToBlob = async (stream: ReadableStream): Promise<Blob> => {
    return new Response(stream).blob();
};

export const pollForProcessedImage = async (
  filename: string,
  config: AwsConfig,
  maxAttempts = 30, // 30 tentativas * 1s = 30s timeout
  interval = 1000
): Promise<string> => {
  const client = getClient(config);
  const outputKey = `thumb-${filename}`; // Assumindo que a Lambda prefixa com 'thumb-'

  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Tenta pegar o objeto
      const command = new GetObjectCommand({
        Bucket: config.outputBucket,
        Key: outputKey,
      });
      
      const response = await client.send(command);
      
      if (response.Body) {
        // Sucesso! O arquivo existe.
        // Converter stream para base64 URL para exibição
        const blob = await streamToBlob(response.Body as ReadableStream);
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
        });
      }
    } catch (error: any) {
      // Se for "NoSuchKey" ou "NotFound", a Lambda ainda está processando
      if (error.name === 'NoSuchKey' || error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
         // Continua o loop esperando processamento
      } else {
         // Erros de permissão (403) ou outros devem falhar imediatamente
         throw error;
      }
    }
    
    // Espera antes da próxima tentativa
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error("Timeout: A imagem processada não apareceu no S3 Output a tempo.");
};

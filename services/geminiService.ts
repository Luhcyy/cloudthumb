import { GoogleGenAI, Type } from "@google/genai";

export interface ImageAnalysisResult {
  description: string;
  tags: string[];
  suggestedName: string;
}

export const analyzeImage = async (base64Image: string, mimeType: string = 'image/jpeg'): Promise<ImageAnalysisResult> => {
  try {
    // Tenta obter a chave de várias fontes possíveis para compatibilidade (Vite, Amplify, Node)
    // @ts-ignore
    const apiKey = (typeof process !== 'undefined' && process.env?.API_KEY) || 
                   // @ts-ignore
                   (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_KEY) ||
                   // @ts-ignore
                   (typeof window !== 'undefined' && window.process?.env?.API_KEY);

    if (!apiKey) {
      console.warn("No API Key provided. Returning mock data.");
      return {
        description: "Descrição simulada: Uma imagem processada mostrando elementos de computação em nuvem.",
        tags: ["nuvem", "simulacao", "demo"],
        suggestedName: "imagem_processada_demo"
      };
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          },
          {
            text: "Analise esta imagem. 1. Uma descrição curta em Português. 2. Três tags relevantes. 3. Sugira um nome de arquivo (campo 'suggestedName') em snake_case baseado no conteúdo visual (ex: cachorro_correndo_praia), SEM extensão de arquivo."
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING },
            tags: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            suggestedName: { type: Type.STRING, description: "Nome do arquivo em snake_case sem extensão" }
          },
          required: ["description", "tags", "suggestedName"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    return JSON.parse(text) as ImageAnalysisResult;

  } catch (error: any) {
    console.error("Gemini analysis failed:", error);
    
    let errorMsg = "Falha ao analisar imagem via IA.";
    if (error.message) {
        if (error.message.includes("403")) errorMsg += " (Chave Inválida/Permissão)";
        else if (error.message.includes("400")) errorMsg += " (Requisição Inválida)";
        else errorMsg += ` (${error.message})`;
    }

    return {
      description: errorMsg,
      tags: ["erro"],
      suggestedName: "imagem_erro_analise"
    };
  }
};
import { GoogleGenAI, Type } from "@google/genai";

export interface ImageAnalysisResult {
  description: string;
  tags: string[];
  suggestedName: string;
}

export const analyzeImage = async (base64Image: string, mimeType: string = 'image/jpeg'): Promise<ImageAnalysisResult> => {
  try {
    // Lazy Initialization: Initialize the client inside the function.
    // This ensures that the 'index.tsx' adapter has run and populated process.env.API_KEY
    // from import.meta.env before we try to access it.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    if (!process.env.API_KEY) {
      console.warn("No API Key provided. Returning mock data.");
      // Simulação melhorada para demonstrar a funcionalidade sem chave
      return {
        description: "Descrição simulada: Uma imagem processada mostrando elementos de computação em nuvem.",
        tags: ["nuvem", "simulacao", "demo"],
        suggestedName: "imagem_processada_demo"
      };
    }

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

  } catch (error) {
    console.error("Gemini analysis failed:", error);
    return {
      description: "Falha ao analisar imagem via IA.",
      tags: ["erro"],
      suggestedName: "imagem_erro_analise"
    };
  }
};
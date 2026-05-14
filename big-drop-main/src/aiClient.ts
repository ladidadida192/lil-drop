import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config({
  path: "C:/Users/janba/OneDrive/Desktop/Schule/ATS/mt4-trade-api/.env",
  override: true
});

const apiKey = process.env.OPENROUTER_API_KEY;

console.log("OPENROUTER_API_KEY loaded:", !!apiKey);

if (!apiKey) {
  throw new Error("Missing OPENROUTER_API_KEY in .env");
}

export const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: apiKey,
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-OpenRouter-Title": "MT4 Trading Analyzer"
  }
});

export async function callAi(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-v3.2",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI request failed: ${response.status} ${text}`);
  }

  const data: any = await response.json();

  return data.choices?.[0]?.message?.content ?? "";
}
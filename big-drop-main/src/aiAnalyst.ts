import { openai } from "./aiClient";
import { getMarketContext } from "./marketContext";

export async function analyzeTradingSystem(symbol: string) {
  const context = await getMarketContext(symbol);

  const prompt = `
You are a trading system analyst. 
Do not place trades. Do not give financial guarantees.
Analyze the bot's current condition based only on this database summary.

Return JSON only with:
{
  "marketRegime": "TREND" | "RANGE" | "HIGH_VOL" | "LOW_VOL" | "BREAKOUT" | "MIXED",
  "risk": "LOW" | "MEDIUM" | "HIGH",
  "sessionAssessment": string,
  "volatilityAssessment": string,
  "performanceAssessment": string,
  "executionRisks": string[],
  "suggestedParameterChanges": {
    "atrMultiplier": string,
    "volumeMultiplier": string,
    "sessionFilter": string,
    "rangingFilter": string,
    "trailingStop": string
  },
  "confidence": "LOW" | "MEDIUM" | "HIGH",
  "reasoningSummary": string
text
Return ONLY valid JSON. Do not wrap it in markdown. Do not use json.
}

Data:
${JSON.stringify(context, null, 2)}
`;

 const response = await openai.chat.completions.create({
  model: "deepseek/deepseek-v4-flash",
  temperature: 0.2,
  messages: [
    {
      role: "system",
      content: "You are a conservative trading system analyst. Do not place trades."
    },
    {
      role: "user",
      content: prompt
    }
  ]
});

  return response.choices[0].message.content;
}
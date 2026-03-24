import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../.env") });

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "not-needed-for-mock-mode",
  defaultHeaders: {
    "HTTP-Referer": "https://startchain.os",
    "X-Title": "StartChain OS",
  }
});

const MODEL = "openai/gpt-oss-120b:free";

/**
 * Orchestrates a three-agent debate for a given operations decision.
 * @param {string} moduleType - LEAD, SUPPORT, or TASK
 * @param {object} inputData - The form data to evaluate
 */
export async function deliberate(moduleType, inputData) {
  const context = JSON.stringify(inputData);

  // Agent 1: The Advocate — argues FOR
  const advocateRes = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `You are the Advocate AI for a startup operations system.
Your job: argue WHY this ${moduleType} input should be ACCEPTED/prioritized.
Be specific about the business value. Max 2 sentences. End with a confidence score 0-100.
Respond ONLY in valid JSON: { "argument": "...", "confidence": 75 }`,
      },
      { role: "user", content: context },
    ],
    response_format: { type: "json_object" },
  });

  // Agent 2: The Skeptic — argues AGAINST
  const skepticRes = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `You are the Skeptic AI for a startup operations system.
Your job: argue WHY this ${moduleType} input should be REJECTED/deprioritized.
Identify risks, missing data, or red flags. Max 2 sentences. End with a concern score 0-100.
Respond ONLY in valid JSON: { "argument": "...", "concern": 60 }`,
      },
      { role: "user", content: context },
    ],
    response_format: { type: "json_object" },
  });

  let advocate, skeptic;
  try {
    advocate = JSON.parse(advocateRes.choices[0].message.content);
  } catch {
    advocate = { argument: advocateRes.choices[0].message.content.slice(0, 200), confidence: 65 };
  }
  try {
    skeptic = JSON.parse(skepticRes.choices[0].message.content);
  } catch {
    skeptic = { argument: skepticRes.choices[0].message.content.slice(0, 200), concern: 50 };
  }

  // Agent 3: The Judge — final verdict
  const judgeRes = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `You are the Judge AI. Given two arguments about a ${moduleType} decision, make the final call.
Consider both the Advocate and Skeptic perspectives carefully.
Respond ONLY in valid JSON:
{
  "verdict": "ACCEPTED" or "REJECTED" or "ESCALATED",
  "confidence": 0 to 100,
  "summary": "one line reason for the verdict",
  "actionItem": "specific next step the team should take"
}`,
      },
      {
        role: "user",
        content: `Input: ${context}
Advocate says: ${advocate.argument} (confidence: ${advocate.confidence})
Skeptic says: ${skeptic.argument} (concern: ${skeptic.concern})`,
      },
    ],
    response_format: { type: "json_object" },
  });

  let judge;
  try {
    judge = JSON.parse(judgeRes.choices[0].message.content);
  } catch {
    judge = {
      verdict: "ESCALATED",
      confidence: 50,
      summary: "Could not parse judge response cleanly",
      actionItem: "Review manually",
    };
  }

  // Normalize verdict
  if (!["ACCEPTED", "REJECTED", "ESCALATED"].includes(judge.verdict.toUpperCase())) {
    judge.verdict = "ESCALATED";
  } else {
    judge.verdict = judge.verdict.toUpperCase();
  }

  return { advocate, skeptic, judge };
}

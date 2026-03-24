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

const MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

/**
 * Orchestrates a three-agent debate for a given operations decision.
 * @param {string} moduleType - LEAD, SUPPORT, or TASK
 * @param {object} inputData - The form data to evaluate
 */
export async function deliberate(moduleType, inputData) {
  const context = JSON.stringify(inputData);

  try {
    // Agent 1: The Advocate
    const advocateRes = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: `You are the Advocate AI for a startup operations system. Argue WHY this ${moduleType} should be ACCEPTED. Max 2 sentences. JSON: { "argument": "...", "confidence": 75 }` },
        { role: "user", content: context },
      ],
      response_format: { type: "json_object" },
    });

    if (!advocateRes.choices || advocateRes.choices.length === 0) {
      throw new Error("Advocate AI returned no choices. OpenRouter might be busy.");
    }

    // Agent 2: The Skeptic
    const skepticRes = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: `You are the Skeptic AI. Argue WHY this ${moduleType} should be REJECTED. Max 2 sentences. JSON: { "argument": "...", "concern": 60 }` },
        { role: "user", content: context },
      ],
      response_format: { type: "json_object" },
    });

    if (!skepticRes.choices || skepticRes.choices.length === 0) {
      throw new Error("Skeptic AI returned no choices. OpenRouter might be busy.");
    }

    let advocate, skeptic;
    try {
      advocate = JSON.parse(advocateRes.choices[0].message.content);
    } catch {
      advocate = { argument: advocateRes.choices[0].message.content.slice(0, 150), confidence: 65 };
    }
    try {
      skeptic = JSON.parse(skepticRes.choices[0].message.content);
    } catch {
      skeptic = { argument: skepticRes.choices[0].message.content.slice(0, 150), concern: 50 };
    }

    // Agent 3: The Judge
    const judgeRes = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `You are the Judge AI. Given two arguments about a ${moduleType} decision, make the final call. IMPORTANT: Be decisive. JSON: { "verdict": "ACCEPTED/REJECTED/ESCALATED", "confidence": 0-100, "summary": "...", "actionItem": "..." }`,
        },
        { role: "user", content: `Input: ${context}\nAdvoc: ${advocate.argument}\nSkeptip: ${skeptic.argument}` },
      ],
      response_format: { type: "json_object" },
    });

    if (!judgeRes.choices || judgeRes.choices.length === 0) {
      throw new Error("Judge AI returned no choices. OpenRouter might be busy.");
    }

    let judge;
    try {
      judge = JSON.parse(judgeRes.choices[0].message.content);
    } catch {
      judge = { verdict: "ESCALATED", confidence: 50, summary: "Parse Error", actionItem: "Manual Review" };
    }

    if (!["ACCEPTED", "REJECTED", "ESCALATED"].includes(judge.verdict.toUpperCase())) {
      judge.verdict = "ESCALATED";
    } else {
       judge.verdict = judge.verdict.toUpperCase();
    }

    return { advocate, skeptic, judge };

  } catch (err) {
    console.error("AI Deliberation Error:", err.message);
    throw err;
  }
}

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, ABI } from "./contractConfig.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend
app.use(express.static(path.join(__dirname, "..", "frontend")));

// ── Blockchain setup ─────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(
  process.env.SHARDEUM_TESTNET_RPC || "https://api-mezame.shardeum.org"
);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

console.log(`Wallet: ${wallet.address}`);
console.log(`Contract: ${CONTRACT_ADDRESS}`);

// ── OpenRouter AI setup ──────────────────────────────────────────
const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://startchain.os", // Site URL for OpenRouter ranking
    "X-Title": "StartChain OS", // Site title for OpenRouter ranking
  }
});
const MODEL = "openai/gpt-oss-120b:free";

// ── DUAL-AGENT DELIBERATION ─────────────────────────────────────

async function deliberate(moduleType, inputData) {
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
  if (!["ACCEPTED", "REJECTED", "ESCALATED"].includes(judge.verdict)) {
    judge.verdict = "ESCALATED";
  }

  return { advocate, skeptic, judge };
}

// ── API ROUTES ───────────────────────────────────────────────────

app.post("/api/process", async (req, res) => {
  const { module: mod, data } = req.body;
  // mod: "LEAD" | "SUPPORT" | "TASK"

  if (!mod || !data) {
    return res.status(400).json({ success: false, error: "Missing module or data" });
  }

  try {
    console.log(`\n[${new Date().toISOString()}] Processing ${mod} decision...`);
    const { advocate, skeptic, judge } = await deliberate(mod, data);
    console.log(`  Advocate: ${advocate.argument.slice(0, 60)}...`);
    console.log(`  Skeptic: ${skeptic.argument.slice(0, 60)}...`);
    console.log(`  Verdict: ${judge.verdict} (${judge.confidence}% conf)`);

    // Hash everything for blockchain (privacy-preserving)
    const inputHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(data)));
    const advocateHash = ethers.keccak256(ethers.toUtf8Bytes(advocate.argument));
    const skepticHash = ethers.keccak256(ethers.toUtf8Bytes(skeptic.argument));

    // Map to solidity enums
    const moduleEnum = { LEAD: 0, SUPPORT: 1, TASK: 2 }[mod];
    const verdictEnum = { ACCEPTED: 0, REJECTED: 1, ESCALATED: 2 }[judge.verdict];

    // Write to Shardeum
    console.log("  Submitting to Shardeum...");
    const tx = await contract.logDecision(
      inputHash,
      moduleEnum,
      verdictEnum,
      judge.confidence,
      advocateHash,
      skepticHash
    );
    const receipt = await tx.wait();
    console.log(`  TX confirmed: ${receipt.hash}`);

    // Get the decision ID from event logs
    const event = receipt.logs
      .map((log) => {
        try { return contract.interface.parseLog(log); } catch { return null; }
      })
      .find((e) => e?.name === "DecisionLogged");

    const decisionId = event?.args?.[0]?.toString() ?? "0";

    // Check if SLA was auto-minted (ACCEPTED verdict)
    const slaEvent = receipt.logs
      .map((log) => {
        try { return contract.interface.parseLog(log); } catch { return null; }
      })
      .find((e) => e?.name === "SLAMinted");

    const slaId = slaEvent?.args?.[0]?.toString() ?? null;

    res.json({
      success: true,
      verdict: judge.verdict,
      confidence: judge.confidence,
      summary: judge.summary,
      actionItem: judge.actionItem,
      advocate: advocate.argument,
      skeptic: skeptic.argument,
      txHash: receipt.hash,
      decisionId,
      slaId,
      slaDeadline: slaId ? new Date(Date.now() + 86400000).toISOString() : null,
      explorerUrl: `https://explorer-mezame.shardeum.org/tx/${receipt.hash}`,
    });
  } catch (err) {
    console.error("Process error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/fulfill-sla", async (req, res) => {
  const { slaId } = req.body;
  try {
    const tx = await contract.fulfillSLA(slaId);
    const receipt = await tx.wait();
    res.json({ success: true, txHash: receipt.hash });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/profile/:address", async (req, res) => {
  try {
    const profile = await contract.getProfile(req.params.address);
    res.json({
      opsScore: profile[0].toString(),
      totalSLAs: profile[1].toString(),
      fulfilled: profile[2].toString(),
      fulfillRate: (Number(profile[3]) / 100).toFixed(1) + "%",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/decisions/:address", async (req, res) => {
  try {
    const total = await contract.totalDecisions();
    const results = [];
    const count = Number(total);
    // Return last 50 decisions max
    const start = Math.max(0, count - 50);
    for (let i = start; i < count; i++) {
      const d = await contract.getDecision(i);
      if (d.operator.toLowerCase() === req.params.address.toLowerCase()) {
        results.push({
          id: i,
          module: ["Lead", "Support", "Task"][Number(d.module)],
          verdict: ["Accepted", "Rejected", "Escalated"][Number(d.verdict)],
          confidence: Number(d.confidence),
          timestamp: Number(d.timestamp),
          slaCreated: d.slaCreated,
        });
      }
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats", async (req, res) => {
  try {
    const totalDec = await contract.totalDecisions();
    const totalSLA = await contract.totalSLACommitments();
    res.json({
      totalDecisions: totalDec.toString(),
      totalSLAs: totalSLA.toString(),
      walletAddress: wallet.address,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback — serve index.html for all non-API routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 StartChain OS Backend running on http://localhost:${PORT}`);
  console.log(`   Frontend:  http://localhost:${PORT}`);
  console.log(`   API:       http://localhost:${PORT}/api/stats\n`);
});

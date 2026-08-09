#!/usr/bin/env node
// init-openclaw.mjs — gera ~/.openclaw/openclaw.json a partir de ENV VARS (Render)
// Idempotente: roda a cada boot do container, estado fresco por design.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.join(os.homedir(), ".openclaw");
const cfgPath = path.join(dir, "openclaw.json");
fs.mkdirSync(dir, { recursive: true });

// --- Providers detectados por env var (ordem = prioridade) ---
const PROVIDERS = [
  { key: "GROQ_API_KEY",       name: "groq",       base: "https://api.groq.com/openai/v1",   model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile" },
  { key: "OPENROUTER_API_KEY", name: "openrouter", base: "https://openrouter.ai/api/v1",     model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct" },
  { key: "OPENAI_API_KEY",     name: "openai",     base: "https://api.openai.com/v1",        model: process.env.OPENAI_MODEL || "gpt-4o-mini" },
  { key: "DEEPSEEK_API_KEY",   name: "deepseek",   base: "https://api.deepseek.com/v1",      model: process.env.DEEPSEEK_MODEL || "deepseek-chat" },
  { key: "TOGETHER_API_KEY",   name: "together",   base: "https://api.together.xyz/v1",      model: process.env.TOGETHER_MODEL || "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { key: "ANTHROPIC_API_KEY",  name: "anthropic",  base: "https://api.anthropic.com/v1",     model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest" },
];

const providers = {};
const modelIds = [];
for (const p of PROVIDERS) {
  const key = process.env[p.key];
  if (!key) continue;
  providers[p.name] = {
    baseUrl: p.base,
    apiKey: key,
    models: [{ id: p.model, name: p.model, api: "openai-completions", contextWindow: 128000 }],
  };
  modelIds.push(`${p.name}/${p.model}`);
}

if (Object.keys(providers).length === 0) {
  console.error("[init-openclaw] Nenhuma chave de IA encontrada (GROQ_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY...). Usando catálogo default.");
}

const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.OPENCLAW_TELEGRAM_BOT_TOKEN || "";

const config = {
  agents: {
    defaults: {
      model: {
        primary: modelIds[0] || "groq/llama-3.3-70b-versatile",
        fallbacks: modelIds.slice(1),
      },
      bootstrapMaxChars: 6000,
      contextTokens: 65536,
      heartbeat: { every: "" },
    },
    list: [
      {
        id: "main",
        model: {
          primary: modelIds[0] || "groq/llama-3.3-70b-versatile",
          fallbacks: modelIds.slice(1),
        },
        heartbeat: { every: "" },
      },
    ],
  },
  models: { providers },
  channels: {
    telegram: {
      enabled: Boolean(botToken),
      botToken: botToken || "",
    },
  },
};

fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

// Workspace mínimo para o agente main
const ws = path.join(dir, "workspace", "main");
fs.mkdirSync(path.join(ws, "memory"), { recursive: true });
if (!fs.existsSync(path.join(ws, "SOUL.md"))) {
  fs.writeFileSync(path.join(ws, "SOUL.md"), `# SOUL.md - OpenClaw Render [🤖]\n\n## Role\nVocê é OpenClaw, o agente do nó render. Responde em português.\n`);
}
if (!fs.existsSync(path.join(ws, "IDENTITY.md"))) {
  fs.writeFileSync(path.join(ws, "IDENTITY.md"), `# IDENTITY.md\n\n- id: main\n- emoji: 🤖\n- vibe: util\n`);
}

console.log(`[init-openclaw] OK — providers: ${Object.keys(providers).join(", ") || "nenhum"} | telegram: ${botToken ? "ON" : "OFF"} | primary: ${modelIds[0] || "default"}`);
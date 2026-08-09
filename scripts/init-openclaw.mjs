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
// OPENCLAW_PROVIDERS (opcional): lista de providers a usar, ex. "groq,deepseek".
// Reduz o nº de plugins instalados no boot → menos RAM (crítico no Render free).
const only = (process.env.OPENCLAW_PROVIDERS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
for (const p of PROVIDERS) {
  const key = process.env[p.key];
  if (!key) continue;
  if (only.length > 0 && !only.includes(p.name)) continue;
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

// Token do bot: prioridade TELEGRAM_BOT_TOKEN_2 (novo bot) > TELEGRAM_BOT_TOKEN > OPENCLAW_TELEGRAM_BOT_TOKEN
const botToken =
  process.env.TELEGRAM_BOT_TOKEN_2 ||
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.OPENCLAW_TELEGRAM_BOT_TOKEN ||
  "";

// ID do dono (OPENCLAW_OWNER_ID). O OpenClaw constrói o senderId de DMs do
// Telegram como "telegram:<chatId>" e o allowlist casa por IGUALDADE EXATA
// (allow.entries.includes(senderId)). Por isso "7648987349" sem o prefixo
// "telegram:" NÃO casa e em dmPolicy=allowlist toda DM é descartada em silêncio.
// Normaliza para aceitar o valor com ou sem prefixo (e com "@" à frente).
const rawOwner = (process.env.OPENCLAW_OWNER_ID || "telegram:7648987349").trim();
const ownerId = /^telegram:/i.test(rawOwner) ? rawOwner : `telegram:${rawOwner.replace(/^@/, "")}`;

const config = {
  gateway: {
    mode: "local",
    bind: "loopback",
    port: 18789,
    auth: { mode: "none" },
  },
  commands: {
    ownerAllowFrom: [ownerId],
  },
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
      // allowlist (em vez de pairing): o dono (ownerAllowFrom) é aceito direto,
      // sem pareamento manual — crítico em container efêmero (Render), onde o
      // estado de pairing reseta a cada deploy e deixaria o dono no silêncio.
      // ⚠️ OBRIGATÓRIO: dmPolicy="allowlist" exige allowFrom preenchido, senão
      // "all DMs will be dropped" (ownerAllowFrom NÃO alimenta allowFrom).
      dmPolicy: "allowlist",
      allowFrom: [ownerId],
      groupPolicy: "allowlist",
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
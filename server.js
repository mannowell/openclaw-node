import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "1mb" }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Health check (Render requere para o serviço estar vivo)
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "openclaw-node",
    tailscale: process.env.TAILSCALE_IP ? process.env.TAILSCALE_IP : "not-set",
    time: new Date().toISOString(),
  });
});

/**
 * POST /scrape
 * Body: { url, instruction?, selector?, waitFor?, format? }
 *   url        — página a abrir (obrigatório)
 *   selector   — se vier, devolve o texto do primeiro elemento que casa
 *   wait       — ms para esperar após load (default 1500)
 *   format     — "markdown" | "text" | "json" (default "text")
 * Retorna o conteúdo da página (texto do body, ou selector, ou snapshot stats)
 */
app.post("/scrape", async (req, res) => {
  const { url, selector, instruction, wait: waitFor = 3000, format = "text" } = req.body || {};
  if (!url) return res.status(400).json({ error: "Campo 'url' é obrigatório" });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    );

    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(waitFor);

    const result = { url, status: response?.status() || 200, format };

    if (selector) {
      const el = await page.$(selector);
      result.selector = selector;
      result.value = el ? await el.evaluate((n) => n.innerText || n.textContent || n.value || "") : null;
    } else if (format === "json") {
      result.data = await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        links: Array.from(document.querySelectorAll("a")).slice(0, 50).map((a) => a.href),
        text: document.body?.innerText?.slice(0, 5000) || "",
      }));
    } else {
      result.text = await page.evaluate(() => document.body?.innerText?.slice(0, 15000) || "");
    }

    if (instruction) result.instruction = instruction;
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// Health check separado para o Render
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// === IA / Chat (usa as env vars configuradas no Render) ===
const PROVIDERS = [
  { key: "GROQ_API_KEY",       name: "groq",       base: "https://api.groq.com/openai/v1",                 defaultModel: "llama-3.3-70b-versatile" },
  { key: "OPENROUTER_API_KEY", name: "openrouter", base: "https://openrouter.ai/api/v1",                   defaultModel: "meta-llama/llama-3.3-70b-instruct" },
  { key: "OPENAI_API_KEY",     name: "openai",     base: "https://api.openai.com/v1",                      defaultModel: "gpt-4o-mini" },
  { key: "TOGETHER_API_KEY",   name: "together",   base: "https://api.together.xyz/v1",                    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { key: "DEEPSEEK_API_KEY",   name: "deepseek",   base: "https://api.deepseek.com/v1",                    defaultModel: "deepseek-chat" },
  { key: "ANTHROPIC_API_KEY",  name: "anthropic",  base: "https://api.anthropic.com/v1",                   defaultModel: "claude-3-5-haiku-latest" },
];

function detectedProvider() {
  return PROVIDERS.find((p) => process.env[p.key]);
}

// Lista QUAL provider está configurado (sem expor valores)
app.get("/ai/config", (_req, res) => {
  const configured = PROVIDERS.filter((p) => process.env[p.key]).map((p) => ({
    provider: p.name,
    base: p.base,
    model: process.env[`${p.name.toUpperCase()}_MODEL`] || p.defaultModel,
  }));
  const baseUrl = process.env.OPENAI_BASE_URL;
  const globalModel = process.env.MODEL;
  res.json({
    ok: true,
    count: configured.length,
    configured,
    baseUrl: baseUrl || "default",
    model: globalModel || configured[0]?.model || null,
  });
});

/**
 * POST /chat
 * Body: { prompt, system?, model? }
 * Usa o primeiro provider disponível (GROQ → OpenRouter → OpenAI → ...)
 * endpoint compatível com OpenAI: /chat/completions
 */
app.post("/chat", async (req, res) => {
  const { prompt, system, model } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Campo 'prompt' é obrigatório" });

  const provider = detectedProvider();
  if (!provider) {
    return res.status(503).json({
      ok: false,
      error: "Nenhuma chave de IA configurada no Render (ex.: GROQ_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY)",
    });
  }

  const apiKey = process.env[provider.key];
  const chosenModel =
    model || process.env[`${provider.name.toUpperCase()}_MODEL`] || process.env.MODEL || provider.defaultModel;
  const baseUrl = process.env.OPENAI_BASE_URL || provider.base;

  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: chosenModel,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt },
        ],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(502).json({ ok: false, provider: provider.name, error: data?.error?.message || `HTTP ${r.status}` });
    }

    const reply = data?.choices?.[0]?.message?.content?.trim();
    res.json({
      ok: true,
      provider: provider.name,
      model: chosenModel,
      reply,
      usage: data?.usage || undefined,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`openclaw-node listening on :${PORT}`);
});
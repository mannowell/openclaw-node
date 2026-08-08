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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`openclaw-node listening on :${PORT}`);
});
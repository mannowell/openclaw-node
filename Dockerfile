# openclaw-node — API de scraping com Tailscale embutido
# Imagem otimizada para Render.com (porta 10000)
FROM node:20-slim AS base

# Dependências do Puppeteer/Chromium no Debian slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    iproute2 \
    iptables \
    tcpdump \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libxshmfence1 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# --- Tailscale -----------------------------------------------------------------
# Instala o Tailscale no container (sem systemd — corre via entrypoint)
RUN curl -fsSL https://tailscale.com/install.sh | sh

# --- Aplicação -----------------------------------------------------------------
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server.js ./

# --- OpenClaw (multi-agent gateway) ---------------------------------------------
# Instala o CLI do OpenClaw globalmente (config gerada por scripts/init-openclaw.mjs
# a partir das env vars a cada boot — estado fresco por design no Render)
RUN npm i -g openclaw && openclaw --version

COPY scripts/ ./scripts/

# Porta padrão do Render
ENV PORT=10000
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fs http://127.0.0.1:10000/healthz || exit 1

# Entrypoint: Tailscale + API
# dos2unix corrige quebras de linha CRLF (Windows); fallback sed caso dos2unix não exista
COPY entrypoint.sh /entrypoint.sh
RUN dos2unix /entrypoint.sh || sed -i -e 's/\r$//' /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["sh", "/entrypoint.sh"]
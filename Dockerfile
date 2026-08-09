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
    && rm -rf /var/lib/apt/lists/*

# --- Tailscale -----------------------------------------------------------------
# Instala o Tailscale no container (sem systemd — corre via entrypoint)
RUN curl -fsSL https://tailscale.com/install.sh | sh

# --- Aplicação -----------------------------------------------------------------
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server.js ./

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
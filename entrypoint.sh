#!/bin/sh
# 1. Inicia o daemon do Tailscale em modo userspace
tailscaled --tun=userspace-networking --outbound-http-proxy-listen=localhost:1055 &
sleep 2

# 2. Tenta autenticar no Tailscale sem bloquear a execução do script
if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "Autenticando no Tailscale..."
    # --ephemeral: nós efêmeros são removidos automaticamente do tailnet
    # quando o container cai/desconecta — evita acúmulo de instâncias
    # órfãs (openclaw-node-1, openclaw-node-2, ...) a cada deploy.
    # --reset: reaproveita a identidade/sessão do nó com o mesmo hostname.
    tailscale up --authkey="${TAILSCALE_AUTHKEY}" --hostname=openclaw-node --accept-dns=false --reset --ephemeral &
else
    echo "AVISO: TAILSCALE_AUTHKEY não encontrada."
fi

# 3. Gera a configuração do OpenClaw a partir das env vars (idempotente)
echo "Gerando config do OpenClaw..."
node /app/scripts/init-openclaw.mjs || echo "AVISO: falha ao gerar config OpenClaw (continua sem gateway)"

# 4. Sobe o gateway OpenClaw em background (porta interna 18789)
echo "Iniciando gateway OpenClaw (porta 18789)..."
nohup openclaw gateway --port 18789 > /app/openclaw-gateway.log 2>&1 &
sleep 3

# 5. Inicia a API Node.js imediatamente para responder ao Render na porta 10000
exec node server.js
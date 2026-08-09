#!/bin/sh
# ============================================================
# openclaw-node — entrypoint (Render)
# 1. Tailscale (userspace) + auth com --ephemeral
# 2. Gera config do OpenClaw a partir das env vars
# 3. Sobe gateway OpenClaw (18789, bg)
# 4. Exporta TAILSCALE_IP (lido pelo server.js no "/")
# 5. Sobe API Node (10000, foreground)
# ============================================================

# 1. Inicia o daemon do Tailscale em modo userspace
echo "[entrypoint] Iniciando tailscaled (userspace)..."
tailscaled --tun=userspace-networking --outbound-http-proxy-listen=localhost:1055 &
sleep 3

# 2. Autentica no Tailscale (se houver chave)
if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "[entrypoint] Autenticando no Tailscale..."
    # --ephemeral: remove nós órfãos quando o container cai (sem acúmulo de -2, -3...)
    # --reset: reutiliza identidade do nó com mesmo hostname
    tailscale up --authkey="${TAILSCALE_AUTHKEY}" --hostname=openclaw-node \
        --accept-dns=false --reset --ephemeral &
else
    echo "[entrypoint] AVISO: TAILSCALE_AUTHKEY não definida — sem malha privada."
fi

# 3. Espera até 30s pelo IP (não bloqueia o app se falhar)
TS_IP=""
i=0
while [ $i -lt 30 ]; do
    TS_IP=$(tailscale ip -4 2>/dev/null | head -1)
    [ -n "$TS_IP" ] && break
    i=$((i + 1))
    sleep 1
done
if [ -n "$TS_IP" ]; then
    export TAILSCALE_IP="$TS_IP"
    echo "[entrypoint] Tailscale OK: $TS_IP"
else
    echo "[entrypoint] AVISO: Tailscale não conectou em 30s (continua sem IP)"
fi

# 4. Gera a configuração do OpenClaw a partir das env vars (idempotente)
echo "[entrypoint] Gerando config do OpenClaw..."
node /app/scripts/init-openclaw.mjs || echo "[entrypoint] AVISO: falha ao gerar config OpenClaw (continua sem gateway)"

# 5. Sobe o gateway OpenClaw em background (porta interna 18789)
echo "[entrypoint] Iniciando gateway OpenClaw (porta 18789)..."
nohup openclaw gateway --port 18789 > /app/openclaw-gateway.log 2>&1 &
sleep 3

# 6. Inicia a API Node.js imediatamente para responder ao Render na porta 10000
echo "[entrypoint] Subindo API na porta ${PORT:-10000}..."
exec node server.js
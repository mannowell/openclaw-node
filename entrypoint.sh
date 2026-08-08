#!/bin/sh
# entrypoint.sh — openclaw-node
# 1) Inicia o Tailscale (tailscaled) em background
# 2) Faz tailscale up com o auth key do ambiente
# 3) Inicia o servidor HTTP da API

set -e

echo "[entrypoint] A iniciar openclaw-node..."

# ------------------------------------------------------------------------------
# Tailscale — se TAILSCALE_AUTHKEY estiver definido, entra na malha
# ------------------------------------------------------------------------------
if [ -n "${TAILSCALE_AUTHKEY}" ]; then
    echo "[entrypoint] A iniciar tailscaled (daemon em background)"
    # tailscaled precisa de --tun=userspace-networking em containers
    tailscaled --tun=userspace-networking --socks5-server=localhost:1055 \
        --outbound-http-proxy-listen=localhost:1055 &
    TS_PID=$!
    echo "[entrypoint] tailscaled PID=${TS_PID}"

    # Espera o daemon estar pronto
    sleep 3

    echo "[entrypoint] tailscale up --authkey (provided)"
    tailscale up --authkey="${TAILSCALE_AUTHKEY}" \
        --hostname="openclaw-node" \
        --ssh=false || echo "[entrypoint] WARN: tailscale up falhou (vou continuar sem malha)"

    # Exibe o IP atribuído (útil para diagnóstico)
    TS_IP=$(tailscale ip -4 2>/dev/null | head -1 || true)
    echo "[entrypoint] Tailscale IP: ${TS_IP:-N/A}"
else
    echo "[entrypoint] TAILSCALE_AUTHKEY não definido — a correr sem Tailscale"
fi

# ------------------------------------------------------------------------------
# 2) Servidor HTTP — porta $PORT (Render usa 10000)
# ------------------------------------------------------------------------------
echo "[entrypoint] A iniciar API na porta ${PORT:-10000}..."
exec node server.js
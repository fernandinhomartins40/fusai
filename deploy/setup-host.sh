#!/usr/bin/env bash
# Configuração ÚNICA do nginx do host para a FuseAI (VPS compartilhada 72.60.10.112).
# Só cria o site fuseai.com.br; não toca em nenhum outro site. Faz reload (não restart).
# Rodar apenas com aprovação, depois que o DNS de fuseai.com.br, www e api apontar para a VPS:
#   bash /root/fuseai/deploy/setup-host.sh
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/nginx-host/fuseai.com.br"
DEST=/etc/nginx/sites-available/fuseai.com.br
VPS_IP=72.60.10.112

for host in fuseai.com.br www.fuseai.com.br api.fuseai.com.br; do
  ip="$(getent hosts "$host" | awk '{print $1}' | head -1)"
  if [ "$ip" != "$VPS_IP" ]; then
    echo "DNS: $host -> ${ip:-sem registro} (esperado $VPS_IP). Ajuste o DNS antes." >&2
    exit 1
  fi
done

if [ -f "$DEST" ]; then
  echo "$DEST já existe (o certbot pode ter acrescentado HTTPS). Nada a fazer." >&2
  exit 0
fi

install -m 644 "$SRC" "$DEST"
ln -sfn "$DEST" /etc/nginx/sites-enabled/fuseai.com.br
nginx -t
systemctl reload nginx

certbot --nginx --non-interactive --agree-tos --redirect \
  -d fuseai.com.br -d www.fuseai.com.br -d api.fuseai.com.br \
  --cert-name fuseai.com.br -m "${CERTBOT_EMAIL:?defina CERTBOT_EMAIL}"
nginx -t
systemctl reload nginx
echo "OK: https://www.fuseai.com.br e https://api.fuseai.com.br"

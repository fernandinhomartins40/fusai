#!/usr/bin/env bash
# Configuração do nginx do HOST para a FuseAI (VPS compartilhada 72.60.10.112).
# Executado SÓ pelo workflow manual .github/workflows/setup-host.yml (botão "Run workflow").
#
# - Confere que fusai.com.br, www e api já apontam para a VPS (senão o certbot falharia).
# - Cria o site /etc/nginx/sites-available/fusai.com.br, se ainda não existir, e o ativa.
#   Não toca em nenhum outro site e faz `reload` (não restart): os outros apps não caem.
# - Emite o certificado (certbot --nginx), se ainda não existir.
# Pode ser rodado de novo com segurança: cada etapa já feita é pulada.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/nginx-host/fusai.com.br"
AVAILABLE=/etc/nginx/sites-available/fusai.com.br
ENABLED=/etc/nginx/sites-enabled/fusai.com.br
VPS_IP=72.60.10.112
DOMAINS=(fusai.com.br www.fusai.com.br api.fusai.com.br)
: "${CERTBOT_EMAIL:?defina CERTBOT_EMAIL}"

echo "==> DNS"
for host in "${DOMAINS[@]}"; do
  ip="$(getent ahostsv4 "$host" | awk '{print $1}' | head -1 || true)"
  echo "  $host -> ${ip:-sem registro}"
  if [ "$ip" != "$VPS_IP" ]; then
    echo "ERRO: $host precisa apontar para $VPS_IP (registro A). Ajuste o DNS e rode de novo." >&2
    exit 1
  fi
done

echo "==> Site no nginx do host"
if [ -f "$AVAILABLE" ]; then
  echo "  $AVAILABLE já existe (mantido como está)."
else
  # Nenhum outro site pode já responder por estes domínios.
  if grep -RlsE "server_name[^;]*\b(www\.|api\.)?fusai\.com\.br\b" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/; then
    echo "ERRO: outro arquivo do nginx já usa fusai.com.br (listado acima). Nada foi alterado." >&2
    exit 1
  fi
  install -m 644 "$SRC" "$AVAILABLE"
  echo "  criado $AVAILABLE"
fi
ln -sfn "$AVAILABLE" "$ENABLED"
if ! nginx -t; then
  echo "ERRO: configuração do nginx inválida; desfazendo o link do site." >&2
  rm -f "$ENABLED"
  exit 1
fi
systemctl reload nginx

echo "==> Certificado HTTPS"
if [ -d /etc/letsencrypt/live/fusai.com.br ]; then
  echo "  certificado já existe; o certbot renova sozinho."
else
  certbot --nginx --non-interactive --agree-tos --redirect \
    --cert-name fusai.com.br -m "$CERTBOT_EMAIL" \
    -d fusai.com.br -d www.fusai.com.br -d api.fusai.com.br
  nginx -t
  systemctl reload nginx
fi

echo "==> Conferência local por HTTPS"
for host in www.fusai.com.br api.fusai.com.br; do
  path=/docs; [ "$host" = api.fusai.com.br ] && path=/health
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host$path")"
  echo "  https://$host$path -> $code"
  [ "$code" = "200" ] || { echo "ERRO: esperado 200" >&2; exit 1; }
done
echo "OK: https://www.fusai.com.br e https://api.fusai.com.br"

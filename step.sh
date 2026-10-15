set -uo pipefail
check() {
  local url="$1" expect="$2"
  for i in $(seq 1 12); do
    body=$(curl -fsS --max-time 10 "$url" 2>/dev/null) && echo "$body" | grep -q "$expect" && { echo "OK  $url"; return 0; }
    sleep 5
  done
  echo "ERRO $url (esperado: $expect)"; return 1
}
ok=0
check "$PUBLIC_API_URL/health" '"fuseai-api"' || ok=1
check "$PUBLIC_WEB_URL/docs" 'Documentação' || ok=1
check "$PUBLIC_WEB_URL/llms.txt" '# FuseAI' || ok=1
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://fuseai.com.br/")
[ "$code" = "301" ] && echo "OK  apex -> www (301)" || { echo "ERRO apex respondeu $code"; ok=1; }
exit $ok

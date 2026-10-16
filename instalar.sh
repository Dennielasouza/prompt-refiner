#!/usr/bin/env bash
#
# Instalador do Prompt Refiner. Faz tudo o que o guia manual faria, numa passada só,
# e pode ser rodado de novo quantas vezes quiser: ele detecta o que já está pronto.
#
#   ./instalar.sh                  instala tudo (no macOS, inclui Serviços e o atalho ⌥⌥)
#   ./instalar.sh --so-backend     só o backend e a extensão, sem mexer no sistema
#
# Mensagens em português, como o resto do que a pessoa vê.
set -uo pipefail

cd "$(dirname "$0")"
APENAS_BACKEND=false
[ "${1:-}" = "--so-backend" ] && APENAS_BACKEND=true
MACOS=false
[ "$(uname -s)" = "Darwin" ] && MACOS=true
PORTA=8787
[ -f backend/.env ] && PORTA=$(grep -E '^PORT=' backend/.env | tail -1 | cut -d= -f2 | tr -d ' ' || true)
PORTA=${PORTA:-8787}

passo() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()    { printf '  ✓ %s\n' "$*"; }
aviso() { printf '  ! %s\n' "$*"; }
erro()  { printf '\n\033[1m✖ %s\033[0m\n' "$*" >&2; }

parar() {
  erro "$1"
  shift
  for l in "$@"; do printf '  %s\n' "$l" >&2; done
  printf '\nNada foi deixado pela metade: rode este script de novo depois de resolver.\n' >&2
  exit 1
}

# --- 1. Node -----------------------------------------------------------------
passo "1/6  Conferindo o Node.js"
if ! command -v node >/dev/null 2>&1; then
  parar "O Node.js não está instalado." \
    "Ele é o motor que roda o Prompt Refiner." \
    "Baixe a versão LTS em https://nodejs.org (o instalador faz tudo) e rode este script de novo."
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  parar "O seu Node.js é a versão $(node -v), e o projeto precisa da 22 ou mais nova." \
    "Baixe a versão LTS em https://nodejs.org e rode este script de novo."
fi
ok "Node $(node -v)"

# --- 2. Dependências ---------------------------------------------------------
passo "2/6  Baixando as peças do projeto"
echo "  Isso leva alguns segundos e faz várias linhas passarem na tela. É normal."
if ! npm install --no-fund --no-audit >/tmp/pr-npm.log 2>&1; then
  tail -20 /tmp/pr-npm.log >&2
  parar "O npm install falhou." "As últimas linhas do erro estão acima, e o registro completo em /tmp/pr-npm.log."
fi
ok "Dependências instaladas"

# --- 3. Configuração ---------------------------------------------------------
passo "3/6  Preparando a configuração"
if [ -f backend/.env ]; then
  ok "backend/.env já existe (não mexi nele)"
else
  cp backend/.env.example backend/.env
  ok "backend/.env criado a partir do exemplo"
fi

PROVIDER=$(grep -E '^PROMPT_COMPILER_PROVIDER=' backend/.env | tail -1 | cut -d= -f2 | tr -d ' ' || true)
if [ "$PROVIDER" = "claude-cli" ]; then
  if ! command -v claude >/dev/null 2>&1; then
    parar "A configuração usa a sua assinatura do Claude, mas o Claude Code não está instalado." \
      "Ou instale o Claude Code em https://code.claude.com e rode: claude  →  /login" \
      "Ou edite backend/.env e troque PROMPT_COMPILER_PROVIDER para anthropic ou openai, com a sua chave."
  fi
  if ! claude auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
    parar "O Claude Code está instalado, mas não está logado." \
      "No terminal, rode:  claude" \
      "Lá dentro, digite /login, escolha a conta com assinatura (não a do Console) e depois /exit." \
      "Então rode este script de novo."
  fi
  ok "Claude Code logado — os refinamentos não gastam créditos de API"
else
  ok "Provedor configurado: ${PROVIDER:-(automático pela chave)}"
fi

# --- 4. Extensão -------------------------------------------------------------
passo "4/6  Gerando a extensão do navegador"
if ! npm run build -w extension >/tmp/pr-build.log 2>&1; then
  tail -20 /tmp/pr-build.log >&2
  parar "A geração da extensão falhou." "O registro completo está em /tmp/pr-build.log."
fi
ok "Pronta em $(pwd)/extension/dist"

# --- 5. Backend --------------------------------------------------------------
passo "5/6  Ligando o backend"
if $MACOS && ! $APENAS_BACKEND; then
  if ! npm run install-service -w backend >/tmp/pr-service.log 2>&1; then
    tail -20 /tmp/pr-service.log >&2
    parar "Não consegui instalar o backend como serviço." "O registro completo está em /tmp/pr-service.log."
  fi
  ok "Instalado como serviço: liga sozinho com o Mac e volta se cair"
else
  aviso "Sem instalar serviço. Deixe o backend rodando numa aba do terminal com: npm run dev"
fi

printf '  aguardando responder'
SAUDE=""
for _ in $(seq 1 20); do
  SAUDE=$(curl -sS -m 2 "http://127.0.0.1:${PORTA}/api/health" 2>/dev/null || true)
  [ -n "$SAUDE" ] && break
  printf '.'
  sleep 1
done
echo
if [ -z "$SAUDE" ]; then
  parar "O backend não respondeu na porta ${PORTA}." \
    "Se outro programa estiver usando essa porta, mude PORT em backend/.env e rode este script de novo." \
    "Para ver o que aconteceu: tail -20 ~/Library/Logs/PromptRefiner/backend.log"
fi
case "$SAUDE" in
  *'"status":"ok"'*) ok "Backend no ar em http://127.0.0.1:${PORTA}" ;;
  *) parar "O backend subiu, mas está mal configurado." "Ele respondeu: $SAUDE" ;;
esac

# --- 6. Integração com o Mac -------------------------------------------------
passo "6/6  Integrando com os apps do Mac"
if ! $MACOS; then
  aviso "Esta parte é só do macOS. No seu sistema, use a extensão do Chrome."
elif $APENAS_BACKEND; then
  aviso "Pulado (--so-backend)."
else
  npm run install-services -w desktop >/tmp/pr-services.log 2>&1 \
    && ok "14 Serviços instalados (⌃⌥⌘R refina, ⌃⌥⌘P refina fundo)" \
    || aviso "Não consegui instalar os Serviços. Veja /tmp/pr-services.log"
  # Recompilar o app ✦ invalida a permissão de Acessibilidade já concedida (ele é assinado de
  # forma improvisada, e cada build é "outro app" para o macOS). Então só instala se faltar.
  if [ -d "$HOME/Applications/Prompt Refiner.app" ]; then
    ok "App ✦ já instalado (não reinstalei, para não derrubar a Acessibilidade)"
    echo "    Para forçar uma reinstalação: npm run install-hotkey -w desktop"
  else
    npm run install-hotkey -w desktop >/tmp/pr-hotkey.log 2>&1 \
      && ok "App ✦ instalado (duplo toque no ⌥ para refinar)" \
      || aviso "Não consegui instalar o app do ⌥⌥. Veja /tmp/pr-hotkey.log"
  fi
fi

# --- Teste de verdade --------------------------------------------------------
passo "Testando um refinamento de verdade"
TESTE=$(curl -sS -m 90 -X POST "http://127.0.0.1:${PORTA}/api/refine" \
  -H 'Content-Type: application/json' \
  -d '{"text":"preciso avisar meu time que a entrega vai atrasar uns dias","target":"chatgpt"}' 2>/dev/null || true)
REFINADO=$(printf '%s' "$TESTE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).refinedPrompt||"")}catch{}})' 2>/dev/null || true)
if [ -n "$REFINADO" ]; then
  echo "  Pedi para refinar:  \"preciso avisar meu time que a entrega vai atrasar uns dias\""
  echo
  printf '  \033[1m%s\033[0m\n' "$REFINADO"
  echo
  ok "O motor está funcionando"
else
  aviso "O refinamento de teste não voltou. O backend está no ar, mas algo barrou a chamada."
  aviso "Veja o motivo em: tail -20 ~/Library/Logs/PromptRefiner/backend.log"
fi

# --- O que falta -------------------------------------------------------------
cat <<FIM

────────────────────────────────────────────────────────────────────
  Falta você fazer 2 coisas que só podem ser feitas à mão:

  1) CARREGAR A EXTENSÃO NO CHROME
     • abra  chrome://extensions
     • ligue o "Modo do desenvolvedor" (canto superior direito)
     • clique em "Carregar sem compactação"
     • escolha a pasta:
       $(pwd)/extension/dist
FIM
if $MACOS && ! $APENAS_BACKEND; then
cat <<FIM

  2) LIBERAR O ATALHO ⌥⌥ (duplo toque no Option) — pule se já tiver feito
     • Ajustes do Sistema › Privacidade e Segurança › Acessibilidade
     • se "Prompt Refiner" já estiver na lista, remova com o botão −
     • clique em + e escolha:  ~/Applications/Prompt Refiner.app
     (ligar e desligar o botão não basta: tem que remover e adicionar)
FIM
fi
cat <<FIM

  Depois disso: selecione um texto, clique com o botão direito
  e escolha "Prompt Refiner › Refinar prompt".
────────────────────────────────────────────────────────────────────
FIM

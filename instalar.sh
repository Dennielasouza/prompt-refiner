#!/usr/bin/env bash
#
# Instalador do Prompt Refiner. Faz tudo o que o guia manual faria, numa passada só,
# e pode ser rodado de novo quantas vezes quiser: ele detecta o que já está pronto.
#
#   ./instalar.sh                  instala tudo (no macOS, inclui Serviços e o atalho ⌥⌥)
#   ./instalar.sh --so-backend     só o backend e a extensão, sem mexer no sistema
#
# A instalação fica SEMPRE no mesmo lugar (~/prompt-refiner, ou PROMPT_REFINER_DIR),
# igual ao caminho que o guia manda abrir no Chrome — não importa de onde este script rodou.
#
# Mensagens em português, como o resto do que a pessoa vê.
set -uo pipefail

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

# Problemas que não impedem o resto, mas que a pessoa precisa ver no fim (e não no meio da tela).
PROBLEMAS=""
N_PROBLEMAS=0
problema() { PROBLEMAS="${PROBLEMAS}  ! $1
"; N_PROBLEMAS=$((N_PROBLEMAS + 1)); aviso "$1"; }

# Registros desta execução: pasta privada e só nossa (em /tmp qualquer um pode criar /tmp/pr-*.log
# antes de nós, e aí o log não é escrito e o erro aparece como se fosse outro).
REG="$(mktemp -d "${TMPDIR:-/tmp}/prompt-refiner-instalacao.XXXXXX")" \
  || parar "Não consegui criar a pasta dos registros em ${TMPDIR:-/tmp}." "Confira o espaço em disco e as permissões dessa pasta."

# --- Opções ------------------------------------------------------------------
APENAS_BACKEND=false
if [ $# -gt 0 ]; then
  for arg in "$@"; do
    case "$arg" in
      --so-backend) APENAS_BACKEND=true ;;
      "") ;;
      *) parar "Não conheço a opção \"$arg\"." "Use:  ./instalar.sh  ou  ./instalar.sh --so-backend" ;;
    esac
  done
fi

# --- Onde a instalação vai ficar ---------------------------------------------
# Um lugar só, decidido antes de qualquer trabalho e impresso na primeira linha: é o mesmo
# caminho que o guia manda escolher no Chrome. Antes, o script instalava na pasta onde ele
# por acaso estava (um ZIP no ~/Downloads, uma pasta temporária) — dava todos os ✓ e depois
# ninguém achava a extensão.
DESTINO="${PROMPT_REFINER_DIR:-$HOME/prompt-refiner}"
DESTINO="${DESTINO/#\~/$HOME}"
case "$DESTINO" in /*) ;; *) DESTINO="$PWD/$DESTINO" ;; esac
AQUI="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P || echo "$PWD")"
caminho_real() { (cd "$1" 2>/dev/null && pwd -P); }
eh_projeto() { grep -q '"name": "prompt-refiner"' "$1/package.json" 2>/dev/null; }
DESTINO_REAL="$(caminho_real "$DESTINO" || true)"

if [ -z "${PROMPT_REFINER_SEM_CABECALHO:-}" ]; then
  printf '\n\033[1mPrompt Refiner — instalação\033[0m\n'
  printf '  Vai instalar em:   %s\n' "$DESTINO"
  printf '  Pasta da extensão: %s/extension/dist   ← é esta que você escolhe no Chrome\n' "$DESTINO"
  printf '  (para instalar em outro lugar: PROMPT_REFINER_DIR=/outra/pasta ./instalar.sh)\n'
fi

MACOS=false
[ "$(uname -s)" = "Darwin" ] && MACOS=true

# As ferramentas de linha de comando da Apple (git, swiftc) são "atalhos" que, quando não estão
# instaladas, abrem uma janela do sistema e ficam esperando alguém clicar. Conferir antes evita
# que a instalação pare no meio esperando um clique.
ferramentas_apple() { ! $MACOS || xcode-select -p >/dev/null 2>&1; }

if [ -n "$DESTINO_REAL" ] && [ "$DESTINO_REAL" = "$AQUI" ]; then
  : # Já estamos no lugar certo — segue o jogo.
elif eh_projeto "$AQUI"; then
  # Uma cópia do projeto fora do destino: ZIP do GitHub, pasta temporária, pen drive.
  if [ -n "${PROMPT_REFINER_REEXEC:-}" ]; then
    parar "Não consegui me reexecutar de dentro de $DESTINO." "Rode:  cd \"$DESTINO\" && ./instalar.sh"
  elif [ -e "$DESTINO" ] && eh_projeto "$DESTINO"; then
    parar "Esta é uma cópia do projeto fora do destino, e já existe um Prompt Refiner em $DESTINO." \
      "Não vou escolher por você qual das duas cópias é a boa — foi assim que, numa tentativa" \
      "anterior, a versão antiga acabou instalada sem ninguém perceber." \
      "" \
      "Para instalar o que já está no destino:   cd \"$DESTINO\" && ./instalar.sh" \
      "Para instalar ESTA cópia no lugar dele:   apague ou renomeie $DESTINO e rode de novo" \
      "Para instalar ESTA cópia em outra pasta:  PROMPT_REFINER_DIR=$HOME/prompt-refiner-novo $0"
  elif [ -e "$DESTINO" ]; then
    parar "Já existe algo em $DESTINO que não é o projeto." \
      "Renomeie ou apague essa pasta, ou escolha outro lugar:" \
      "PROMPT_REFINER_DIR=$HOME/outra-pasta $0"
  else
    passo "Levando esta cópia para o lugar certo"
    echo "  Você rodou o instalador de $AQUI."
    echo "  Essa pasta pode ser apagada (um ZIP baixado, uma pasta temporária), então a instalação"
    echo "  não pode morar nela. Vou copiar o projeto para $DESTINO e continuar de lá."
    mkdir -p "$DESTINO" || parar "Não consegui criar a pasta $DESTINO."
    # node_modules e dist são refeitos nos passos 2 e 4; copiar atrasaria por nada.
    if ! (cd "$AQUI" && tar -cf - --exclude=node_modules --exclude=dist --exclude=dist-e2e .) \
        | (cd "$DESTINO" && tar -xf -); then
      parar "Não consegui copiar o projeto para $DESTINO."
    fi
    chmod +x "$DESTINO/instalar.sh" 2>/dev/null
    ok "Copiado para $DESTINO"
    PROMPT_REFINER_SEM_CABECALHO=1 PROMPT_REFINER_REEXEC=1 exec bash "$DESTINO/instalar.sh" "$@"
  fi
else
  # Modo "um comando só": o script chegou pelo curl, sem projeto nenhum em volta.
  passo "Baixando o Prompt Refiner"
  if ! ferramentas_apple; then
    parar "Faltam as ferramentas de linha de comando da Apple (é delas que vem o git)." \
      "Rode:  xcode-select --install" \
      "Confirme na janela que aparecer, espere terminar e rode este comando de novo."
  fi
  if ! command -v git >/dev/null 2>&1; then
    parar "O git não está instalado." \
      "No Mac, rode:  xcode-select --install" \
      "Depois rode este comando de novo."
  fi
  if [ -d "$DESTINO/.git" ]; then
    printf '  ✓ Já estava baixado em %s — atualizando\n' "$DESTINO"
    git -C "$DESTINO" pull --quiet --ff-only 2>/dev/null \
      || aviso "Não consegui atualizar $DESTINO (deve ter mudança sua lá dentro); sigo com o código que já está aí."
  elif [ -e "$DESTINO" ]; then
    parar "Já existe algo em $DESTINO que não é o projeto." \
      "Renomeie ou apague essa pasta, ou escolha outro lugar:" \
      "PROMPT_REFINER_DIR=$HOME/outra-pasta  e rode de novo."
  else
    git clone --quiet "https://github.com/Dennielasouza/prompt-refiner.git" "$DESTINO" || {
      parar "Não consegui baixar o projeto." "Confira sua conexão com a internet."
    }
    printf '  ✓ Baixado em %s\n' "$DESTINO"
  fi
  PROMPT_REFINER_SEM_CABECALHO=1 PROMPT_REFINER_REEXEC=1 exec bash "$DESTINO/instalar.sh" "$@"
fi

cd "$DESTINO" || parar "Não consegui entrar em $DESTINO."
PORTA=8787
[ -f backend/.env ] && PORTA=$(grep -E '^PORT=' backend/.env | tail -1 | cut -d= -f2 | tr -d ' ' || true)
PORTA=${PORTA:-8787}
SERVICO="gui/$(id -u)/com.promptrefiner.backend"

# PID do nosso backend instalado como serviço (vazio se não estiver rodando).
pid_do_servico() {
  $MACOS || return 0
  launchctl print "$SERVICO" 2>/dev/null | sed -n 's/^[[:space:]]*pid = \([0-9]\{1,\}\).*/\1/p' | head -1
}
# PIDs escutando na porta que NÃO são o nosso serviço.
ocupantes_estranhos() {
  command -v lsof >/dev/null 2>&1 || return 0
  local nosso p
  nosso="$(pid_do_servico)"
  for p in $(lsof -nP -iTCP:"$PORTA" -sTCP:LISTEN -t 2>/dev/null | sort -u); do
    [ "$p" = "${nosso:-x}" ] || printf '%s ' "$p"
  done
}

# --- 1. O computador ---------------------------------------------------------
passo "1/6  Conferindo o computador"
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

# A porta tem de estar livre (ou ocupada pelo nosso próprio serviço, que sabemos substituir).
# Se outro programa estiver lá, o backend não consegue subir — e um teste que encontra OUTRO
# servidor e dá ✓ é pior do que um teste que falha.
ESTRANHOS="$(ocupantes_estranhos)"
if [ -n "${ESTRANHOS// /}" ]; then
  for p in $ESTRANHOS; do printf '    PID %s: %s\n' "$p" "$(ps -o command= -p "$p" 2>/dev/null | head -1)"; done
  parar "A porta $PORTA já está ocupada por outro programa (os processos estão listados acima)." \
    "Normalmente é um \`npm run dev\` esquecido em algum terminal." \
    "Feche esse terminal, ou rode:  kill ${ESTRANHOS% }" \
    "Se a porta for de outro programa que você quer manter, mude PORT no backend/.env." \
    "Depois rode este script de novo."
fi
ok "Porta $PORTA livre para o backend"

# --- 2. Dependências ---------------------------------------------------------
passo "2/6  Baixando as peças do projeto"
echo "  Isso leva alguns segundos e faz várias linhas passarem na tela. É normal."
if ! npm install --no-fund --no-audit >"$REG/npm-install.log" 2>&1; then
  tail -20 "$REG/npm-install.log" >&2
  parar "O npm install falhou." "As últimas linhas do erro estão acima, e o registro completo em $REG/npm-install.log."
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
if ! npm run build -w extension >"$REG/extensao.log" 2>&1; then
  tail -20 "$REG/extensao.log" >&2
  parar "A geração da extensão falhou." "O registro completo está em $REG/extensao.log."
fi
if [ ! -f "$DESTINO/extension/dist/manifest.json" ]; then
  parar "A extensão não apareceu em $DESTINO/extension/dist." "O registro está em $REG/extensao.log."
fi
ok "Pronta em $DESTINO/extension/dist"

# --- 5. Backend --------------------------------------------------------------
passo "5/6  Ligando o backend"
NOSSO_PID=""
SO_USEI_O_QUE_JA_ESTAVA=false
if $MACOS && ! $APENAS_BACKEND; then
  # Sempre reinstala o serviço, mesmo que já exista um respondendo: é a reinstalação que leva o
  # código novo para o serviço e que libera a pasta da extensão no CORS. Pular isso porque "já
  # havia algo no ar" era o que deixava a versão ANTERIOR rodando, com todos os ✓ na tela.
  if ! npm run install-service -w backend >"$REG/servico.log" 2>&1; then
    tail -20 "$REG/servico.log" >&2
    parar "Não consegui instalar o backend como serviço." "O registro completo está em $REG/servico.log."
  fi
  ok "Instalado como serviço: liga sozinho com o Mac e volta se cair"
elif [ -n "$(pid_do_servico)" ]; then
  SO_USEI_O_QUE_JA_ESTAVA=true
  aviso "O backend já está no ar como serviço; não mexi nele (--so-backend)."
else
  # Fora do macOS (ou com --so-backend) não há serviço. Subimos o backend aqui só para provar
  # que funciona, e desligamos no fim — senão a pessoa fica com um processo solto sem saber.
  if ! npm run build -w backend >"$REG/backend-build.log" 2>&1; then
    tail -20 "$REG/backend-build.log" >&2
    parar "Não consegui preparar o backend." "O registro completo está em $REG/backend-build.log."
  fi
  (cd backend && node dist/index.js >"$REG/backend.log" 2>&1 &
   echo $! > "$REG/backend.pid")
  NOSSO_PID=$(cat "$REG/backend.pid" 2>/dev/null || true)
  ok "Backend iniciado aqui, só para o teste"
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
desligar_o_nosso() { [ -n "${NOSSO_PID:-}" ] && kill "$NOSSO_PID" 2>/dev/null; }
if [ -z "$SAUDE" ]; then
  desligar_o_nosso
  parar "O backend não respondeu na porta ${PORTA}." \
    "Para ver o que aconteceu:  tail -20 \"$REG/backend.log\"  ou  tail -20 ~/Library/Logs/PromptRefiner/backend.log"
fi
case "$SAUDE" in
  *'"status":"ok"'*) ok "Backend no ar em http://127.0.0.1:${PORTA}" ;;
  *) desligar_o_nosso
     parar "O backend subiu, mas está mal configurado." "Ele respondeu: $SAUDE" ;;
esac

# O que está no ar é o código desta pasta? (É aqui que "instalei e veio a versão antiga" aparece.)
VERSAO_CODIGO=$(sed -n 's/.*COMPILER_VERSION = "\([^"]*\)".*/\1/p' backend/src/engine/instruction.ts 2>/dev/null | head -1)
VERSAO_NO_AR=$(printf '%s' "$SAUDE" | sed -n 's/.*"compilerVersion":"\([^"]*\)".*/\1/p')
if [ -n "$VERSAO_CODIGO" ] && [ -n "$VERSAO_NO_AR" ] && [ "$VERSAO_CODIGO" != "$VERSAO_NO_AR" ]; then
  if $SO_USEI_O_QUE_JA_ESTAVA; then
    problema "O backend no ar é a versão $VERSAO_NO_AR, e esta pasta é a $VERSAO_CODIGO. Rode sem --so-backend para atualizar o serviço."
  else
    desligar_o_nosso
    parar "O backend que está respondendo não é o que acabei de instalar." \
      "No ar: versão $VERSAO_NO_AR. Nesta pasta: versão $VERSAO_CODIGO." \
      "Alguém mais está escutando na porta ${PORTA}. Feche esse programa e rode este script de novo."
  fi
elif [ -n "$VERSAO_CODIGO" ] && [ -n "$VERSAO_NO_AR" ]; then
  ok "Versão no ar confere com esta pasta ($VERSAO_NO_AR)"
else
  aviso "Não consegui comparar a versão no ar com a desta pasta (o /api/health não informou)."
fi

# --- 6. Integração com o Mac -------------------------------------------------
passo "6/6  Integrando com os apps do Mac"
if ! $MACOS; then
  aviso "Esta parte é só do macOS. No seu sistema, use a extensão do Chrome."
elif $APENAS_BACKEND; then
  aviso "Pulado (--so-backend)."
else
  npm run install-services -w desktop >"$REG/servicos-mac.log" 2>&1 \
    && ok "14 Serviços instalados (⌃⌥⌘R refina, ⌃⌥⌘P refina fundo)" \
    || problema "Não consegui instalar os Serviços do Mac (⌃⌥⌘R). Veja $REG/servicos-mac.log"
  # Recompilar o app ✦ invalida a permissão de Acessibilidade já concedida (ele é assinado de
  # forma improvisada, e cada build é "outro app" para o macOS). Então só instala se faltar.
  if [ -d "$HOME/Applications/Prompt Refiner.app" ]; then
    ok "App ✦ já instalado (não reinstalei, para não derrubar a Acessibilidade)"
    echo "    Para forçar uma reinstalação: npm run install-hotkey -w desktop"
  elif ! ferramentas_apple; then
    problema "O app do ⌥⌥ precisa das ferramentas da Apple (swiftc). Rode: xcode-select --install — e depois: npm run install-hotkey -w desktop"
  else
    npm run install-hotkey -w desktop >"$REG/hotkey.log" 2>&1 \
      && ok "App ✦ instalado (duplo toque no ⌥ para refinar)" \
      || problema "Não consegui instalar o app do ⌥⌥. Veja $REG/hotkey.log"
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
  problema "O refinamento de teste não voltou: o backend está no ar, mas algo barrou a chamada. Motivo em: tail -20 ~/Library/Logs/PromptRefiner/backend.log"
fi

# --- Desliga o que nós mesmos subimos ----------------------------------------
if [ -n "${NOSSO_PID:-}" ]; then
  kill "$NOSSO_PID" 2>/dev/null
  rm -f "$REG/backend.pid"
  aviso "Desliguei o backend de teste. Para usar o plugin, deixe-o rodando com: npm run dev"
fi

# --- O que falta -------------------------------------------------------------
cat <<FIM

────────────────────────────────────────────────────────────────────
  Instalado em: $DESTINO

  Falta você fazer 2 coisas que só podem ser feitas à mão:

  1) CARREGAR A EXTENSÃO NO CHROME
     • abra  chrome://extensions
     • ligue o "Modo do desenvolvedor" (canto superior direito)
     • clique em "Carregar sem compactação"
     • escolha a pasta:
       $DESTINO/extension/dist
     (não acha a pasta na janela do Chrome? aperte ⌘⇧G e cole o caminho acima)
FIM
if $MACOS && ! $APENAS_BACKEND; then
cat <<FIM

  2) LIBERAR O ATALHO ⌥⌥ (duplo toque no Option) — pule se já tiver feito
     • Ajustes do Sistema › Privacidade e Segurança › Acessibilidade
     • se "Prompt Refiner" já estiver na lista, remova com o botão −
     • clique em + e escolha:  $HOME/Applications/Prompt Refiner.app
     (ligar e desligar o botão não basta: tem que remover e adicionar)
FIM
fi
cat <<FIM

  Depois disso: selecione um texto, clique com o botão direito
  e escolha "Prompt Refiner › Refinar prompt".
────────────────────────────────────────────────────────────────────
FIM
if [ "$N_PROBLEMAS" -gt 0 ]; then
  printf '\n\033[1mO essencial ficou pronto, mas %s coisa(s) não deram certo:\033[0m\n' "$N_PROBLEMAS"
  printf '%s' "$PROBLEMAS"
  printf '  Registros desta instalação: %s\n' "$REG"
  exit 1
fi
rm -rf "$REG"

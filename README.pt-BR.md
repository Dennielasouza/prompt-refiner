[English](README.md) | **Português**

# Prompt Refiner

Selecione o texto cru que você acabou de escrever — notas soltas, frases pela metade, erros de digitação e tudo — e o Prompt Refiner reescreve como um prompt bem estruturado para a IA que você vai usar. Ele substitui **só a sua seleção**, no mesmo lugar onde você estava escrevendo: no Chrome ou em qualquer app do Mac.

<!-- TODO: add demo GIF (docs/demo.gif) -->

> ### TODO — o GIF de demonstração entra aqui
> `docs/demo.gif`: um antes/depois curto, mostrando uma seleção bagunçada sendo substituída no lugar.

> **Idioma da interface:** os menus da extensão, a página de configurações e as mensagens do macOS estão em português do Brasil. Os seus prompts são refinados no idioma em que você escrever. Interface em inglês está nos [próximos passos](#próximos-passos).

## O que ele tem de diferente

- **Funciona onde você escreve.** Sem segunda janela, sem chat separado, sem copiar e colar. Você seleciona, escolhe, e o texto do campo passa a ser o prompt refinado. No Chrome (menu do botão direito ou atalho de teclado) e em qualquer app do Mac que aceite os Serviços do macOS, inclusive com um toque duplo no ⌥ Option.
- **Você não precisa de chave de API paga.** Se você já paga uma assinatura do Claude, o Prompt Refiner pode usar ela pelo Claude Code oficial — sem créditos de API. Veja [Escolha o motor](#2-escolha-o-motor).
- **Ele nunca inventa fatos sobre você.** O refinador organiza o que você escreveu e, no modo profundo, acrescenta *método* (critérios de sucesso, processo, formato de saída, checagem final). Nunca acrescenta dados, público, prazos, nomes nem um tom que você não pediu.
- **Se algo falhar, o seu texto não muda.** Se a chamada falhar, se o campo se mexer, se o editor recusar a inserção — nada é escrito. No navegador aparece um aviso com o botão **Copiar prompt**; num app do Mac a seleção fica exatamente como estava.
- **Um clique para desfazer**, além do ⌘Z / Ctrl+Z do próprio campo.
- **Roda na sua máquina.** Um backend local pequeno faz uma chamada por refinamento ao provedor de IA que *você* configurou. O texto dos prompts nunca vai para o log — só metadados.
- **Também escreve arquivos de instruções.** As mesmas notas soltas podem virar o conteúdo de um `CLAUDE.md` ou `AGENTS.md`.

## Como funciona

```
Extensão do Chrome ─────┐
                        ├─► backend local (127.0.0.1:8787) ─► o seu motor de IA
Serviços do macOS / ⌥⌥ ─┘              │                     (uma chamada por refinamento)
                                       ▼
            o prompt refinado substitui a sua seleção (com Desfazer)
```

O motor que *refina* e o destino para o qual você está *escrevendo* são independentes: o Claude pode escrever um prompt otimizado para o ChatGPT, e vice-versa.

## Requisitos

- **Node.js 22 ou mais novo**, e npm.
- **Google Chrome ou Microsoft Edge 120 ou mais novo**, para a parte do navegador.
- **Um motor de IA** — a sua assinatura do Claude ou a sua própria chave de API. As duas opções estão explicadas abaixo; você não precisa das duas.
- **macOS** para a integração com o desktop (Serviços do macOS e o app ✦ do ⌥⌥; o app do ⌥⌥ também precisa das Xcode Command Line Tools, por causa do `swiftc`). A extensão e o backend em si não são exclusivos do macOS, mas o projeto é desenvolvido e testado no macOS — no Windows e no Linux você roda o backend num terminal em vez de instalar como serviço.
- Um terminal, para instalar. O uso do dia a dia não precisa de terminal.

> Ainda não está na Chrome Web Store, então a extensão é carregada sem compactação, no modo do desenvolvedor. É a troca honesta desta versão — veja os [próximos passos](#próximos-passos).

## Instalação

### 1. Clone e instale

```bash
git clone https://github.com/Dennielasouza/prompt-refiner.git
cd prompt-refiner
npm install
```

Depois crie o seu arquivo de configuração a partir do exemplo:

```bash
cp backend/.env.example backend/.env
```

É no `backend/.env` que o motor é configurado. Ele está no `.gitignore` — nunca versione esse arquivo.

### 2. Escolha o motor

#### Opção 1 — a sua assinatura do Claude, sem chave de API (recomendada)

Se você já paga o Claude (Pro ou Max), pode usar essa assinatura em vez de comprar créditos de API. O backend roda o [Claude Code](https://code.claude.com) oficial em modo sem interface (`claude -p`), logado como você. Sem chave de API, sem cartão, sem conta por chamada: as chamadas contam nos limites normais de uso do seu plano e aparecem como **US$ 0** no relatório de custo.

1. Instale o Claude Code (instruções em [code.claude.com](https://code.claude.com)) e faça login com a sua assinatura:

   ```bash
   claude          # e rode /login dentro dele
   ```

   O backend procura o binário em `~/.local/bin/claude`, que é onde a instalação nativa o
   coloca. Se o seu estiver em outro lugar, defina o caminho absoluto em `PROMPT_COMPILER_CLAUDE_BIN`.

2. Edite o `backend/.env`:

   ```bash
   PROMPT_COMPILER_PROVIDER=claude-cli
   PROMPT_COMPILER_MODEL=claude-sonnet-5-5
   PROMPT_COMPILER_EFFORT=medium
   ```

   Deixe `ANTHROPIC_API_KEY` e `OPENAI_API_KEY` vazias — elas **não** são passadas para a CLI de propósito, porque uma chave de API passaria por cima do login da assinatura.

É só isso. Assim, um refinamento leva cerca de 4 segundos em média.

**O que este modo é, e o que não é:**

- Cada pessoa entra com a **própria** assinatura, no binário oficial e não modificado do Claude Code. O Prompt Refiner nunca pede, guarda nem repassa credenciais do Claude — a autenticação é feita pela própria CLI `claude`, e o uso é cobrado pela Anthropic direto de quem está usando.
- **Nunca encaminhe pedidos de outras pessoas por um único login do Claude.** Isso é para o seu uso, na sua máquina. Não coloque atrás de um endpoint compartilhado.
- Não modifique o binário do Claude Code. O Prompt Refiner apenas o chama com opções suportadas.
- Refinar alguns prompts por dia é uso individual comum. Transformar isso num pipeline de alto volume, não.
- **Uma ressalva honesta:** isso depende de uma política que é da Anthropic, e que mudou mais de uma vez ao longo de 2026 — a Anthropic reserva o direito de agir sem aviso prévio, então esse caminho pode parar de funcionar. A opção 2 continua sempre disponível.

Se o backend estiver instalado como serviço no macOS e não conseguir ler o seu login do Chaveiro, gere um token de longa duração da assinatura com `claude setup-token` e coloque em `CLAUDE_CODE_OAUTH_TOKEN`. É uma credencial — trate como senha.

#### Opção 2 — a sua própria chave de API

Funciona em qualquer lugar e não depende da política de assinatura de ninguém. Você paga ao seu provedor, por chamada.

Anthropic:

```bash
PROMPT_COMPILER_PROVIDER=anthropic
PROMPT_COMPILER_MODEL=claude-sonnet-5-5
ANTHROPIC_API_KEY=sua-chave-aqui
PROMPT_COMPILER_EFFORT=medium
```

OpenAI:

```bash
PROMPT_COMPILER_PROVIDER=openai
PROMPT_COMPILER_MODEL=o-modelo-openai-da-sua-preferência
OPENAI_API_KEY=sua-chave-aqui
```

Não há modelo fixo no código: `PROMPT_COMPILER_MODEL` é sempre obrigatório. Cada refinamento é uma única chamada, e `npm run usage -w backend` mostra quanto os seus custaram de verdade.

### 3. Inicie o backend

```bash
# macOS: instala como serviço sempre ligado (inicia no login e volta sozinho se cair)
npm run install-service -w backend

# Qualquer sistema: roda no terminal (recarrega quando você salva um arquivo)
npm run dev
```

Não rode os dois — eles disputam a porta 8787. Para conferir se está no ar:

```bash
curl -s http://127.0.0.1:8787/api/health
```

Deve aparecer `"status":"ok"` e o provedor que você escolheu. Se aparecer `misconfigured`, a mensagem diz qual variável está faltando.

Numa máquina sem o serviço do macOS (Windows, Linux) e para rodar sem o modo de recarregar, gere o build uma vez e inicie: `npm run build -w backend && npm start -w backend`.

Para remover o serviço do macOS depois: `npm run uninstall-service -w backend` (ele apaga também a cópia do seu `.env`).

### 4. Gere e carregue a extensão

```bash
npm run build -w extension
```

1. Abra `chrome://extensions` (no Edge: `edge://extensions`).
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta `extension/dist`.

A página de configurações abre na primeira instalação (para reabrir, clique no ícone da extensão). Confira se o **Endpoint da API** é `http://localhost:8787` e clique em **Testar conexão** — deve aparecer *Conectado*.

Agora selecione um texto em qualquer campo, clique com o botão direito e escolha **Prompt Refiner ▸ Refinar prompt**.

> Se você instalou o backend como serviço do macOS, rode `npm run install-service -w backend` de novo sempre que editar o `backend/.env`, mover a pasta do projeto ou carregar a extensão de outra pasta. O serviço copia as suas configurações e se restringe ao ID da sua extensão, então precisa ser avisado da mudança.

### 5. Opcional — use em qualquer app do Mac

Nos dois casos abaixo, o backend precisa estar rodando.

**Serviços do macOS** (funcionam no Claude, no ChatGPT, no Editor de Texto, no Notas, no Mail, no Slack e em tudo o mais que aceite Serviços):

```bash
npm run install-services -w desktop
```

Isso instala 14 Serviços, dois deles com atalho:

| Serviço | O que faz |
|---|---|
| **Refinar prompt (Automático)** — **⌃⌥⌘R** | Modo equilibrado; destino detectado pelo app em primeiro plano (app Claude → Claude, app ChatGPT → ChatGPT, web app do Gemini → Gemini, todo o resto → genérico) |
| **Refinar prompt profundo (Automático)** — **⌃⌥⌘P** | Modo profundo, mesma detecção |
| Refinar prompt \[profundo] para ChatGPT / Claude / Gemini / Codex / Claude Code | Destino fixo, equilibrado ou profundo |
| **Gerar CLAUDE.md** / **Gerar AGENTS.md** | Transforma as suas notas num arquivo de instruções para agentes |

Use pelo atalho, pelo botão direito › **Serviços** ou pelo menu do próprio app (*Claude › Serviços*, por exemplo). Para desfazer, **⌘Z** no app. Se os itens não aparecerem num app que já estava aberto, feche e abra o app. Os atalhos podem ser trocados em **Ajustes do Sistema › Teclado › Atalhos de Teclado › Serviços › Texto**. Para remover tudo: `npm run uninstall-services -w desktop`.

**Toque duplo no ⌥ Option** (um app ✦ pequeno na barra de menu):

```bash
npm run install-hotkey -w desktop
```

| Gesto | Ação |
|---|---|
| **⌥⌥** — toque duplo rápido no Option | Refinar (Automático), equilibrado |
| **⇧ + ⌥⌥** — segure Shift e toque duas vezes no Option | Refinar (Automático), profundo |

Na primeira vez, autorize o **Prompt Refiner** em **Ajustes do Sistema › Privacidade e Segurança › Acessibilidade**. O app abre sozinho no login; pela barra de menu dá para pausar ou sair. Atalhos normais com ⌥ (⌥←, por exemplo) não disparam o gesto. Para remover: `npm run uninstall-hotkey -w desktop`.

Ele funciona copiando a seleção (⌘C, guardando e devolvendo a sua área de transferência), chamando o backend local, mostrando um aviso flutuante e — **só se der certo**, e só se o mesmo app ainda estiver em primeiro plano — colando o resultado (⌘V). Ele observa apenas as teclas modificadoras, para reconhecer o gesto; nunca lê nem guarda o que você digita.

Três coisas para saber sobre ele:

- **Recompilar o app invalida a permissão de Acessibilidade.** A assinatura é ad hoc, então cada build é "outro app" para o macOS: é preciso **removê-lo (−) e adicioná-lo de novo** em Acessibilidade — desligar e ligar não resolve.
- **O app Claude também usa ⌥⌥**, para a entrada rápida dele. Para usar ⌥⌥ aqui, desative isso em *Claude › Configurações › Sistema*.
- O ⌘C/⌘V é enviado pela posição das teclas: funciona em layouts US e ABNT2, não em Dvorak (nesse caso, use os Serviços).

## Como usar

### No navegador

1. Escreva em qualquer campo de texto — ChatGPT, Claude, Gemini ou qualquer `<input>`, `<textarea>` ou editor rico.
2. Selecione o trecho que quer refinar.
3. Clique com o botão direito dentro do campo → **Prompt Refiner**, e escolha:
   - **Refinar prompt** — equilibrado
   - **Refinar prompt (profundo)** — profundo
   - **Gerar arquivo de instruções** — um `CLAUDE.md` ou `AGENTS.md`
4. Escolha o destino. O **✨ Automático** descobre pelo site: `chatgpt.com` e `chat.openai.com` → ChatGPT, `claude.ai` → Claude, `gemini.google.com` e `aistudio.google.com` → Gemini, qualquer outro → prompt genérico. Codex e Claude Code nunca são deduzidos — escolha você.
5. A seleção é substituída e um aviso oferece **Desfazer**.

**Atalho de teclado: Alt+Shift+R** refina a seleção com o destino e a profundidade padrão da página de configurações. A tecla pode ser trocada em `chrome://extensions/shortcuts`.

O menu só aparece dentro de campos editáveis. Se algo falhar onde a extensão não consegue desenhar um aviso (páginas `chrome://`, a Chrome Web Store, PDFs), o ícone da extensão ganha um **!** vermelho — passe o mouse para ver o motivo, ou abra a página de configurações, que mostra o último problema.

### Equilibrado ou profundo

| Modo | O que faz | Bom para |
|---|---|---|
| **Equilibrado** | Organiza e esclarece o que você escreveu: objetivo, o contexto que você deu, restrições, formato. | Pedidos do dia a dia — o seu pedido, só que claro. |
| **Profundo** | Acrescenta também o *método* de quem tem experiência: critério de sucesso, o que avaliar, como tratar a incerteza, um formato de saída que força qualidade, uma checagem final. | Análises, críticas, textos que importam, código, tarefas de agentes. |

Nenhum dos dois modos inventa fatos sobre a sua situação. Pedidos triviais ("corrige essa frase") continuam curtos até no modo profundo.

### Formato do resultado

Por padrão, o prompt refinado vem em **Markdown** — seções com `##`, listas, **negrito** no essencial, blocos de código para dados, e nenhuma tag XML. Pedidos simples continuam em frases normais. Na página de configurações, **Formato do prompt › Automático** deixa o destino decidir (o Claude e o Claude Code podem então receber tags XML).

### `CLAUDE.md` e `AGENTS.md`

Escreva notas soltas sobre um projeto — *"app em react native com expo, roda com npx expo start, testes com jest, nunca commitar o google-services.json"* — selecione e use **Gerar arquivo de instruções › CLAUDE.md** (para o Claude Code) ou **AGENTS.md** (para o Codex e outros agentes), ou o Serviço correspondente no Mac.

O que volta é o conteúdo do arquivo que um agente lê no começo de cada sessão: comandos, estrutura, convenções, limites — **montado só com o que está nas suas notas**. Nada é inventado: o que faltar de essencial (o comando de testes, por exemplo) vira uma linha `TODO:` para você completar.

## Configuração

São dois lugares, com papéis diferentes.

**A página de configurações da extensão** (clique no ícone dela) guarda: o endereço do backend, o destino e a profundidade padrão usados pelo atalho de teclado, e o formato de saída. Isso fica no `chrome.storage.sync` do próprio Chrome.

**O `backend/.env`** guarda o motor:

| Variável | Obrigatória | O que faz |
|---|---|---|
| `PROMPT_COMPILER_MODEL` | **sim** | O modelo refinador, ex.: `claude-sonnet-5-5`. Não há modelo fixo no código. |
| `PROMPT_COMPILER_PROVIDER` | não | `anthropic`, `openai` ou `claude-cli`. Se ficar vazia, usa o provedor cuja chave estiver definida (a Anthropic tem prioridade se houver as duas). |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | para a opção 2 | A sua chave do provedor. Ela só existe no backend. |
| `PROMPT_COMPILER_EFFORT` | não | `low`, `medium` ou `high`. `medium` é o padrão do projeto: no eval de 18 casos, empatou em qualidade com o `high`, com menos tokens de saída e menos espera. Deixe vazia para modelos que não aceitam o parâmetro. |
| `PROMPT_COMPILER_CLAUDE_BIN` | não | Só no `claude-cli`: caminho absoluto do binário `claude` (padrão `~/.local/bin/claude`). |
| `CLAUDE_CODE_OAUTH_TOKEN` | não | Só no `claude-cli`, para quando o serviço não alcança o login do Chaveiro. É uma credencial — nunca compartilhe. |
| `PROMPT_DEFAULT_FORMAT` | não | Formato usado quando a requisição não pede um: `markdown` (padrão) ou `auto`. |
| `PORT` / `HOST` | não | Padrão `8787` e `127.0.0.1` (alcançável só da sua própria máquina). |
| `PROMPT_COMPILER_TIMEOUT_MS` | não | Timeout da chamada ao motor (padrão `45000`). |
| `PROMPT_COMPILER_MAX_TOKENS` | não | Limite de saída do modelo refinador (padrão `16000`). |
| `ALLOWED_ORIGINS` | não | Origens CORS aceitas, separadas por vírgula (padrão `chrome-extension://*`). O `install-service` restringe isso ao ID da sua própria extensão descompactada, a menos que você defina a variável. |
| `ANTHROPIC_REFUSAL_FALLBACK` | não | Nos modelos Claude 5.x, repete uma requisição recusada num modelo de fallback. Ligado por padrão; `false` desativa. |

### Quanto cada refinamento custou

Toda chamada registra os tokens e um custo estimado — nunca o texto.

```bash
npm run usage -w backend                  # todo o histórico
npm run usage -w backend -- --days 7      # últimos 7 dias
npm run usage -w backend -- --detalhes    # com tokens e detalhes de cache
```

As chamadas por assinatura (`claude-cli`) aparecem em seção própria, com US$ 0, ao lado do valor que *teriam* custado na API, para comparação. Os preços usados na estimativa ficam em `backend/src/config/pricing.ts`; modelos desconhecidos ficam sem estimativa.

## Privacidade, em palavras simples

O texto completo está em [PRIVACY.md](PRIVACY.md). A versão curta:

- **Não existe servidor nosso.** O backend roda no seu computador. Nada é enviado para a autora deste projeto, nunca.
- **Só o que você selecionou é enviado**, mais o idioma do seu navegador e — apenas no modo Automático — o nome de domínio do site em que você está (`chatgpt.com`, nunca o endereço completo). A leitura acontece no momento em que você clica, e em nenhum outro.
- **O texto selecionado vai, sim, para o provedor de IA que você configurou** — Anthropic, OpenAI ou a sua própria assinatura do Claude — porque é assim que ele é refinado. Valem a política e os termos de privacidade daquele provedor.
- **Campos de senha são recusados** antes de qualquer envio.
- **O texto dos prompts nunca vai para o log.** O log do backend tem só metadados: destino, profundidade, contagem de caracteres, tempos, tokens, custo estimado. Um teste automatizado garante isso.
- **Permissões mínimas**: `contextMenus`, `activeTab`, `scripting`, `storage`. Sem `host_permissions`, sem content scripts estáticos, sem acesso ao seu histórico, cookies ou abas, sem código remoto, sem métricas.
- **A saída da IA é tratada como dado não confiável**: validada e inserida só como texto puro — nunca como HTML.

O backend não tem autenticação nem rate limiting, o que está de bom tamanho para algo que escuta em `127.0.0.1`. Acrescente os dois antes de colocá-lo em qualquer outro lugar.

## Limitações conhecidas

- Ainda não está na Chrome Web Store; a extensão é carregada sem compactação.
- O backend local precisa estar rodando.
- A integração com o desktop é só para macOS.
- O Google Docs não é suportado (o editor dele é desenhado em canvas). Também não funcionam páginas `chrome://`, a Chrome Web Store, PDFs e `input type="email"` / `number`. Iframes de outra origem só funcionam quando o Chrome concede acesso ao frame em que você clicou.
- Se um site trata a colagem do próprio jeito — transformando um texto longo em anexo, por exemplo — a extensão percebe que o texto não entrou, não altera nada e oferece copiar o prompt.
- O app do ⌥⌥ envia ⌘C/⌘V pela posição das teclas: layouts US e ABNT2, não Dvorak.
- O Desfazer não sobrevive a recarregar a página. Isso é de propósito: sem histórico persistente.
- A interface está só em português do Brasil.

## Próximos passos

- **Publicação na Chrome Web Store — v2.** O objetivo é ninguém precisar abrir um terminal. Isso exige um motor empacotado, que funcione sem backend local, então é uma versão própria, não um ajuste. Sem data.
- Interface em inglês / i18n.
- Integração com o desktop no Windows e no Linux (atalho global + área de transferência).
- Suporte ao Firefox.

---

## Para quem desenvolve

### Arquitetura

Uma chamada ao LLM por refinamento, com saída estruturada. Essa única chamada cobre análise de intenção, classificação da tarefa, complexidade (1–5), adaptação ao destino e geração; depois, um quality gate determinístico (`backend/src/engine/output.ts`) valida o resultado. Os adaptadores de destino mudam *como* as instruções são estruturadas, nunca *o que* a tarefa é. O modo profundo tira o método de guias por tipo de tarefa (`backend/src/engine/playbooks.ts`) e só o aplica por completo em tarefas complexas.

O system prompt é montado com as partes cacheáveis primeiro e a parte do destino por último: core → profundidade → formato → destino.

```
shared/      O contrato entre extensão, backend e desktop (destinos, profundidades, formatos,
             tipos, limites) e o mapa site → destino. Fonte única da verdade.
backend/     Servidor Fastify (src/server.ts), motor de prompts (src/engine/), provedores
             (src/providers/: anthropic, openai, claude-cli), preços (src/config/pricing.ts),
             relatório de custo (src/usage/), scripts de eval e do serviço (scripts/)
extension/   Chrome MV3: background.ts (menus, injeção sob demanda, chamada ao backend),
             content.ts + dom/editable.ts (captura e substituição da seleção), ui/toast.ts,
             página de opções, script de build, testes e fixtures
desktop/     macOS: src/refine.ts (a CLI que os Serviços chamam), scripts/services.mjs
             (instalador), helper/ (o app Swift do ⌥⌥ na barra de menu)
```

`backend`, `extension` e `desktop` são npm workspaces; `shared` é importado direto pelos três.

### API

`POST /api/refine`

```json
{ "text": "prompt original", "target": "claude", "depth": "deep", "format": "markdown", "kind": "prompt", "language": "pt-BR" }
```

`target`: `auto | generic | chatgpt | claude | gemini | codex | claude-code`. `depth`: `balanced` (padrão) ou `deep`. `format`: `markdown` ou `auto` (padrão: `PROMPT_DEFAULT_FORMAT`). `kind`: `prompt` (padrão), `claude-md` ou `agents-md` — nesses dois o destino é implícito. O `hostname` só é enviado, e só é usado, com `target: "auto"`.

O `200` devolve `{ refinedPrompt, target, depth, format, kind, taskType, complexity, strategies, warnings }` (`strategies` é sempre `[]`, mantido por compatibilidade). Erros devolvem `{ "error": { "code", "message" } }`: `400` entrada inválida · `403` origem não permitida · `413` texto acima de 12.000 caracteres · `415` não é JSON · `422` o modelo recusou · `502` erro do provedor ou saída inválida do modelo · `503` backend não configurado, ou rate limit · `504` timeout.

O `GET /api/health` informa status, provedor e a versão do compilador.

### Substituição

A seleção é capturada de forma síncrona no instante do clique, antes da chamada assíncrona; depois, exatamente aquele trecho é substituído — e só se for possível verificar que ele continua lá.

- `input` / `textarea`: `execCommand("insertText")`, para frameworks como o React verem eventos de digitação reais e o desfazer nativo continuar funcionando; o fallback é `setRangeText`. Dentro de um `<input>`, quebras de linha viram espaços.
- `contenteditable`: confere se o texto selecionado continua no lugar e tenta, nesta ordem e verificando cada passo — um evento `paste` sintético (editores ricos como ProseMirror/Tiptap, Lexical, Quill, Slate e Draft inserem pelo próprio modelo), `execCommand("insertText")` e, por fim, edição direta do DOM.
- Se o texto mudou e a substituição não é segura, nada é alterado e o aviso oferece **Copiar prompt**.

### Comandos

```bash
npm install
npm test                        # unitários dos três workspaces (o desktop compila Swift — só macOS)
npm run typecheck
npm run lint                    # Biome (lint + formato); npm run lint:fix aplica as correções seguras
npm run build
npm run test:e2e -w extension   # Playwright + Chromium com a extensão real
npm run eval -w backend         # o eval de 18 casos contra o motor real
npm run usage -w backend        # relatório de custo
```

- No Linux e no Windows, rode os unitários por workspace: `npm test -w backend && npm test -w extension`.
- O e2e precisa do Chromium do Playwright, uma vez (`npx playwright install chromium`). Ele carrega a extensão de verdade contra um backend real com um provedor falso determinístico, então não custa nada.
- O `npm run eval -w backend` faz chamadas reais: custa dinheiro de API no `anthropic`/`openai` e conta no seu plano no `claude-cli`. Filtre pelo nome do caso com `npm run eval -w backend -- FILE`.
- Páginas para teste manual: `extension/test/fixtures/index.html` (input, textarea, contenteditable, um campo de senha, uma textarea estilo React) e `editors.html` (Tiptap/ProseMirror, Quill, Lexical). Sirva com qualquer servidor estático, ex.: `npx http-server extension/test/fixtures -p 5500`.

### Como verificar uma mudança

- **Backend:** `npm test -w backend && npm run typecheck -w backend`. Mudanças no motor pedem também o eval.
- **Mudou a instrução do refinador** (`backend/src/engine/instruction.ts`): incremente o `COMPILER_VERSION`, rode os testes e o eval, reinstale o serviço e confirme a versão com `curl -s http://127.0.0.1:8787/api/health`.
- **Extensão:** unitários, `npm run test:e2e -w extension` (rode duas vezes) e o build. Apague o `extension/dist-e2e` depois. Depois de um novo build, clique em ↻ no card da extensão em `chrome://extensions`; se esquecer, a extensão percebe a diferença no próximo uso e se recarrega sozinha.
- **Desktop:** `npm test -w desktop` (inclui os testes em Swift).
- **Backend instalado:** `launchctl print gui/$(id -u)/com.promptrefiner.backend`, com o log em `~/Library/Logs/PromptRefiner/backend.log`.

As regras que não podem ser quebradas — nenhum texto de prompt no log, nenhum fato inventado, o texto da pessoa nunca muda em caso de falha, nenhuma permissão nova na extensão — estão no [`CLAUDE.md`](CLAUDE.md), que também é o que os agentes de código leem. O [CONTRIBUTING.md](CONTRIBUTING.md) tem o checklist de PR.

## Como contribuir

Issues e pull requests são bem-vindos, em inglês ou em português — veja o [CONTRIBUTING.md](CONTRIBUTING.md) e o [Código de Conduta](CODE_OF_CONDUCT.md).

Problemas de segurança: por favor, não abra uma issue pública. O [SECURITY.md](SECURITY.md) explica como reportar em privado.

## Licença

[MIT](LICENSE) © Denniela Souza

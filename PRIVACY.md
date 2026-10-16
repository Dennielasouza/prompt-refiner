# Privacy

**English** below · **[Português](#política-de-privacidade--prompt-refiner)** mais abaixo

> This page describes version **0.1.0**, the first public release, which is distributed as
> source code on GitHub. It is not legal advice.
> **Last updated:** 2026-10-15

---

# Privacy Policy — Prompt Refiner

**Version covered:** 0.1.0 · **Effective:** from the first public release
**Source code:** https://github.com/Dennielasouza/prompt-refiner
**Contact:** open an issue, or use the contact details on https://github.com/Dennielasouza · for security problems, use the private reporting link described in [SECURITY.md](SECURITY.md) instead of a public issue.

## 1. Who is responsible

Prompt Refiner is a free, open-source project developed by Denniela Souza, an individual, not
a company. There is no company behind it, no server operated by the developer, and no business
model. It is a personal project, and all of its code is public.

## 2. In one paragraph

Prompt Refiner takes text **you select yourself** and rewrites it into a better prompt. To do
that, the selected text has to reach an AI model. It never goes to any server belonging to the
developer, because the developer operates no server: the backend that does the work runs on
**your own computer**, and from there the text goes only to the AI provider **you** configured.
Nothing about you is collected for analytics, advertising or profiling — ever.

## 3. What is handled, and where it goes

### 3.1 The text you select

When you right-click a selection and choose a Prompt Refiner menu item, press the keyboard
shortcut, or use one of the macOS integrations, that selection is read and sent to be refined.
It is the only page content the extension ever reads.

- It is read **only at that moment**, after your explicit click or keypress. Nothing watches,
  reads or records what you type at any other time.
- No other part of the page is read, and the extension has no permission to reach pages you
  have not acted on. It uses Chrome's `activeTab` permission, which grants access to a single
  tab, only in response to your action, and has no `host_permissions` at all.
- **Password fields are refused.** If the selection is inside an `<input type="password">`, the
  extension stops and shows a notice without sending anything.

### 3.2 What is sent together with the text

| Field | What it is | Example |
| --- | --- | --- |
| the selected text | what you highlighted | *your own words* |
| destination | which AI tool the prompt is being written for | `chatgpt`, `claude`, `gemini`, `codex`, `claude-code`, `generic`, `auto` |
| depth | balanced or deep | `balanced` |
| format | Markdown or automatic | `markdown` |
| kind | a normal prompt, or a `CLAUDE.md` / `AGENTS.md` instruction file | `prompt` |
| browser language | the language your browser reports, so the result comes back in your language | `pt-BR` |
| site hostname | **only when the destination is "Automatic"**, the domain of the site you are on, so the destination can be guessed | `chatgpt.com` |

The hostname is the domain only — never the full address of the page, never the page title,
never anything else about your browsing. Requests are capped at 12,000 characters of text.

### 3.3 Where it is sent

The extension sends the request to the address configured on its own settings page. The default
is `http://localhost:8787` — a program running on your own computer — so that request does not
leave your machine. Plain `http://` is accepted **only** for local addresses (`localhost`,
`127.0.0.1`, `[::1]`, `*.localhost`); any other address must be `https://`. If you point the
setting at a server somewhere else, your text goes to that server and that is your decision and
your responsibility.

That local program then calls the AI engine you configured in `backend/.env` — one of:

- the **Anthropic API** (Claude), using **your** API key;
- the **OpenAI API**, using **your** API key; or
- **Claude Code** installed on your machine, signed in with **your own** Claude subscription.
  In this mode the prompt text is passed to the CLI through standard input, never on the
  command line, in a process with a minimal environment and no API keys forwarded.

Your selected text is therefore processed by the AI provider you chose, under **that provider's
own privacy policy and terms**. The developer of Prompt Refiner has no access to it, and there
is no intermediary.

### 3.4 On macOS, outside the browser

The macOS Services call the same local backend through a small command-line program. The ✦
menu bar app (the ⌥⌥ gesture) copies your selection with ⌘C, which means the selected text is
briefly on the system clipboard; your previous clipboard contents are saved in full and put
back afterwards, and what the app writes there is marked as transient so clipboard managers
skip it. The app watches modifier keys only, to recognize the gesture — it never reads or
stores what you type. It pastes the result only on success, and only if the same app is still
in front.

### 3.5 The refined prompt that comes back

It replaces your selection as plain text. It is not stored, not uploaded anywhere, and not kept
after the page closes. "Undo" works only while the page stays open.

## 4. What is stored, and where

| What | Where | Why | How long |
| --- | --- | --- | --- |
| Your settings: backend address, default destination, default depth, output format | `chrome.storage.sync`, Chrome's own extension storage. If you use Chrome Sync, Chrome syncs it to your Google account — that is Chrome's mechanism, not the developer's. | so the extension remembers your choices | until you change them or uninstall the extension |
| The reason for the last failure (a short message and a timestamp) | `chrome.storage.session`, cleared when you close the browser | so the settings page can tell you what went wrong | until the browser closes |
| Your API key, if you use one | only in `backend/.env` on your own computer, and in the copy the macOS service installer makes at `~/Library/Application Support/PromptRefiner/backend/.env` with file permissions 600 | so the backend can call your provider | until you delete it; uninstalling the service deletes the copy |

**The extension holds no API key and no credentials**, and there is no key field on its settings
page. Nothing else is stored: no history of your prompts, no copies of your text, no
identifiers, no cookies, no analytics, no crash reports.

## 5. What the local backend writes to its log

The backend writes one line per refinement to a log file on your own computer
(`~/Library/Logs/PromptRefiner/backend.log` when installed as a macOS service; standard output
otherwise).

That line contains **metadata only**: the destination, the depth, the format, the kind, the
detected task type and complexity score, **how many characters** went in and came out, how many
warnings the quality gate raised, how long the call took, which provider and model were used,
token counts, and an estimated cost. Failed calls log the failure kind and a short internal
reason.

**It never contains your text or the refined prompt.** An automated test in the project's test
suite enforces this. You can delete the log at any time; nothing depends on it.

## 6. What Prompt Refiner does not do

- It does not collect personally identifiable information: no name, email, address, phone
  number, account or ID.
- It does not collect or use your web browsing activity — no history, no list of visited sites,
  no tabs, no cookies, no bookmarks.
- It does not read pages you have not acted on, and has no permission to.
- It does not track you, profile you, or show ads.
- It does not sell, rent or share any data with anyone. There is no data broker, no advertising
  network, no analytics provider.
- It contains no remotely hosted code: all of its logic ships inside the extension package and
  can be audited in the public repository.
- The AI's output is treated as untrusted data: it is validated and inserted as plain text
  only, never as HTML, and the extension uses no `eval`.

## 7. Children

Prompt Refiner is not directed at children and collects no data about anyone's age or identity.

## 8. Your choices

- Uninstalling the extension deletes the settings it stored.
- You can change or clear your settings at any time on the settings page.
- You can delete the backend's log file at any time.
- You choose which AI provider processes your text, and you can stop sending anything anywhere
  by stopping the backend or uninstalling the extension.

## 9. Distribution and store policies

This release is distributed as source code on GitHub and is loaded unpacked in developer mode;
it is not published on the Chrome Web Store. The practices described here are the ones the code
implements: the selected text is used only to produce the refined prompt you asked for, it is
never transferred to anyone other than the AI provider you chose, it is never sold, never used
for advertising or credit-scoring purposes, and never read by a human. If a Chrome Web Store
release happens, this page will be updated with the formal statement that store's User Data
Policy requires.

## 10. Changes to this page

If the way Prompt Refiner handles data changes, this page is updated and the change is recorded
in [CHANGELOG.md](CHANGELOG.md).

---
---

# Política de Privacidade — Prompt Refiner

**Versão coberta:** 0.1.0 · **Em vigor:** desde a primeira versão pública
**Última atualização:** 15/10/2026
**Código-fonte:** https://github.com/Dennielasouza/prompt-refiner
**Contato:** abra uma issue, ou use os contatos do perfil https://github.com/Dennielasouza · para problemas de segurança, use o canal privado descrito no [SECURITY.md](SECURITY.md), em vez de abrir uma issue pública.

> Este texto descreve a versão **0.1.0**, a primeira versão pública, distribuída como
> código-fonte no GitHub. Não é parecer jurídico.

## 1. Quem é responsável

O Prompt Refiner é um projeto gratuito e de código aberto desenvolvido por Denniela Souza,
pessoa física, não empresa. Não existe empresa por trás dele, não existe servidor operado pela
desenvolvedora e não existe modelo de negócio. É um projeto pessoal, e todo o código é público.

## 2. Em um parágrafo

O Prompt Refiner pega o texto que **você mesma seleciona** e reescreve como um prompt melhor.
Para isso, o texto selecionado precisa chegar a um modelo de IA. Ele nunca vai para nenhum
servidor da desenvolvedora, porque a desenvolvedora não opera servidor nenhum: o backend que
faz o trabalho roda **no seu próprio computador**, e de lá o texto vai somente para o provedor
de IA que **você** configurou. Nada sobre você é coletado para métricas, publicidade ou criação
de perfil. Nunca.

## 3. O que é tratado, e para onde vai

### 3.1 O texto que você seleciona

Quando você clica com o botão direito numa seleção e escolhe um item do menu do Prompt Refiner,
usa o atalho de teclado ou usa uma das integrações do macOS, essa seleção é lida e enviada para
ser refinada. É o único conteúdo de página que a extensão lê.

- A leitura acontece **só naquele momento**, depois do seu clique ou atalho. Nada observa, lê
  ou grava o que você digita em nenhum outro momento.
- Nenhuma outra parte da página é lida, e a extensão não tem permissão para alcançar páginas
  nas quais você não a acionou. Ela usa a permissão `activeTab` do Chrome, que dá acesso a uma
  única aba, somente em resposta à sua ação, e não tem nenhum `host_permissions`.
- **Campos de senha são recusados.** Se a seleção estiver dentro de um `<input type="password">`,
  a extensão para e mostra um aviso, sem enviar nada.

### 3.2 O que é enviado junto com o texto

| Campo | O que é | Exemplo |
| --- | --- | --- |
| o texto selecionado | o que você marcou | *as suas próprias palavras* |
| destino | para qual ferramenta de IA o prompt está sendo escrito | `chatgpt`, `claude`, `gemini`, `codex`, `claude-code`, `generic`, `auto` |
| profundidade | equilibrado ou profundo | `balanced` |
| formato | Markdown ou automático | `markdown` |
| tipo | um prompt normal, ou um arquivo de instruções `CLAUDE.md` / `AGENTS.md` | `prompt` |
| idioma do navegador | o idioma que o seu navegador informa, para o resultado voltar no seu idioma | `pt-BR` |
| domínio do site | **só quando o destino é "Automático"**, o domínio do site em que você está, para o destino poder ser deduzido | `chatgpt.com` |

É só o domínio — nunca o endereço completo da página, nunca o título da página, nunca mais nada
sobre a sua navegação. Cada pedido é limitado a 12.000 caracteres de texto.

### 3.3 Para onde é enviado

A extensão envia o pedido para o endereço configurado na própria página de configurações dela.
O padrão é `http://localhost:8787` — um programa rodando no seu próprio computador — então esse
pedido não sai da sua máquina. O `http://` simples é aceito **apenas** para endereços locais
(`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`); qualquer outro endereço precisa ser
`https://`. Se você apontar a configuração para um servidor em outro lugar, o seu texto vai
para aquele servidor, e essa é a sua decisão e a sua responsabilidade.

Esse programa local então chama o motor de IA que você configurou no `backend/.env` — um destes:

- a **API da Anthropic** (Claude), com a **sua** chave de API;
- a **API da OpenAI**, com a **sua** chave de API; ou
- o **Claude Code** instalado na sua máquina, logado com a **sua própria** assinatura do Claude.
  Nesse modo, o texto do prompt é passado para a CLI por entrada padrão, nunca na linha de
  comando, num processo com ambiente mínimo e sem repassar nenhuma chave de API.

Portanto, o texto que você selecionou é processado pelo provedor de IA que você escolheu, sob a
**política de privacidade e os termos daquele provedor**. A desenvolvedora do Prompt Refiner não
tem acesso a ele, e não há intermediário.

### 3.4 No macOS, fora do navegador

Os Serviços do macOS chamam o mesmo backend local, por um programa de linha de comando pequeno.
O app ✦ da barra de menu (o gesto ⌥⌥) copia a sua seleção com ⌘C, o que significa que o texto
selecionado passa rapidamente pela área de transferência do sistema; o conteúdo anterior da sua
área de transferência é guardado por completo e devolvido depois, e o que o app escreve lá é
marcado como transitório, para gerenciadores de área de transferência ignorarem. O app observa
apenas as teclas modificadoras, para reconhecer o gesto — nunca lê nem guarda o que você digita.
Ele cola o resultado só em caso de sucesso, e só se o mesmo app ainda estiver em primeiro plano.

### 3.5 O prompt refinado que volta

Ele substitui a sua seleção como texto simples. Não é armazenado, não é enviado para nenhum
outro lugar e não é guardado depois que a página fecha. O "Desfazer" vale só enquanto a página
continua aberta.

## 4. O que fica armazenado, e onde

| O que | Onde | Para que | Por quanto tempo |
| --- | --- | --- | --- |
| Suas preferências: endereço do backend, destino padrão, profundidade padrão, formato de saída | `chrome.storage.sync`, o armazenamento do próprio Chrome para extensões. Se você usa a Sincronização do Chrome, o Chrome sincroniza isso com a sua Conta Google — mecanismo do Chrome, não da desenvolvedora. | para a extensão lembrar das suas escolhas | até você mudar ou desinstalar a extensão |
| O motivo da última falha (uma frase curta e a data/hora) | `chrome.storage.session`, apagado quando você fecha o navegador | para a página de configurações poder dizer o que deu errado | até fechar o navegador |
| A sua chave de API, se você usar uma | só no `backend/.env` no seu próprio computador e na cópia que o instalador do serviço do macOS faz em `~/Library/Application Support/PromptRefiner/backend/.env`, com permissão 600 | para o backend poder chamar o seu provedor | até você apagar; desinstalar o serviço apaga a cópia |

**A extensão não guarda chave de API nem credencial nenhuma**, e não há campo de chave na página
de configurações dela. Nada mais é armazenado: nenhum histórico dos seus prompts, nenhuma cópia
do seu texto, nenhum identificador, nenhum cookie, nenhuma métrica, nenhum relatório de erro.

## 5. O que o backend local grava no registro (log)

O backend grava uma linha por refinamento num arquivo no seu próprio computador
(`~/Library/Logs/PromptRefiner/backend.log` quando instalado como serviço do macOS; saída padrão
nos outros casos).

Essa linha contém **apenas metadados**: o destino, a profundidade, o formato, o tipo, o tipo de
tarefa e a nota de complexidade detectados, **quantos caracteres** entraram e saíram, quantos
avisos o quality gate levantou, quanto tempo a chamada levou, qual provedor e qual modelo foram
usados, a contagem de tokens e o custo estimado. Chamadas que falham registram o tipo da falha e
um motivo interno curto.

**Nunca contém o seu texto nem o prompt refinado.** Um teste automatizado do projeto garante
isso. Você pode apagar o log quando quiser; nada depende dele.

## 6. O que o Prompt Refiner não faz

- Não coleta dados que identifiquem você: nome, e-mail, endereço, telefone, conta ou documento.
- Não coleta nem usa a sua atividade de navegação — nada de histórico, lista de sites visitados,
  abas, cookies ou favoritos.
- Não lê páginas nas quais você não o acionou, e não tem permissão para isso.
- Não rastreia você, não cria perfil seu e não exibe anúncios.
- Não vende, não aluga e não compartilha dado nenhum com ninguém. Não há corretor de dados, rede
  de publicidade nem serviço de métricas.
- Não contém código vindo de fora: toda a lógica está dentro do pacote da extensão e pode ser
  auditada no repositório público.
- A saída da IA é tratada como dado não confiável: é validada e inserida só como texto puro,
  nunca como HTML, e a extensão não usa `eval`.

## 7. Crianças

O Prompt Refiner não é dirigido a crianças e não coleta nenhum dado sobre a idade ou a
identidade de quem o usa.

## 8. Suas escolhas

- Desinstalar a extensão apaga as preferências guardadas por ela.
- Você pode mudar ou limpar as suas preferências quando quiser, na página de configurações.
- Você pode apagar o arquivo de log do backend quando quiser.
- Você escolhe qual provedor de IA processa o seu texto, e pode parar de enviar qualquer coisa
  para qualquer lugar parando o backend ou desinstalando a extensão.

## 9. Distribuição e políticas de loja

Esta versão é distribuída como código-fonte no GitHub e carregada sem compactação, no modo do
desenvolvedor; não está publicada na Chrome Web Store. As práticas descritas aqui são as que o
código implementa: o texto selecionado é usado somente para produzir o prompt refinado que você
pediu, nunca é transferido para ninguém além do provedor de IA que você escolheu, nunca é
vendido, nunca é usado para publicidade ou análise de crédito e nunca é lido por uma pessoa. Se
houver uma publicação na Chrome Web Store, esta página será atualizada com a declaração formal
exigida pela política de dados daquela loja.

## 10. Mudanças nesta página

Se a forma como o Prompt Refiner trata dados mudar, esta página é atualizada e a mudança fica
registrada no [CHANGELOG.md](CHANGELOG.md).

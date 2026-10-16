[English](INSTALL.md) | **Português**

# Instalar o Prompt Refiner

Este é o guia da instalação, e só isso. O que o Prompt Refiner faz, como configurar e como funciona por dentro está no [README](README.pt-BR.md).

É **um comando** e mais duas coisas feitas no mouse. Leva uns 3 minutos.

---

## O que você precisa

- **Um Mac**, ou qualquer computador com o Chrome. O atalho ⌥⌥ nos apps é só do macOS.
- **Node.js 22 ou mais novo.** Se você não tem, o instalador avisa e diz onde baixar.
- **Um motor de IA** — a sua assinatura do Claude (sem chave, sem cartão) ou uma chave de API sua. O instalador também confere isso e avisa se faltar.

Não precisa conferir nada à mão. O instalador verifica tudo e para com uma mensagem clara se algo estiver faltando.

---

## Passo 1 — Instalar

Abra o app **Terminal**, cole esta linha e aperte Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/Dennielasouza/prompt-refiner/main/instalar.sh | bash
```

> Use o **botão de copiar** no canto do bloco. As crases ``` que aparecem na tela **não fazem parte do comando**.

Pronto. Ele faz tudo sozinho, em 6 etapas numeradas, e termina **refinando uma frase de verdade** para você ver funcionando.

**Onde fica instalado:** sempre em `~/prompt-refiner`, não importa de onde você rodou o comando. O instalador imprime esse caminho na **primeira** linha e no **fim**, junto com a pasta da extensão — é esse o caminho que você vai usar no passo 2. Para instalar em outro lugar, ponha `PROMPT_REFINER_DIR=~/outra-pasta` antes do comando.

**Baixou o ZIP do GitHub em vez de usar o comando?** Pode rodar o `./instalar.sh` de dentro da pasta descompactada: ele copia o projeto para `~/prompt-refiner` e continua de lá. Se já existir uma instalação em `~/prompt-refiner`, ele para e mostra as opções — o que ele nunca faz é instalar escondido dentro da pasta de Downloads, de onde você não acharia a extensão depois.

**Se parar no meio**, a mensagem diz o motivo e o que fazer. Pode rodar de novo quantas vezes quiser: ele detecta o que já está pronto.

<details>
<summary><strong>Prefere ver o que o script faz antes de rodar?</strong></summary>

Ele **não pede senha** e **não escreve nada fora da sua pasta de usuário**. As 6 etapas são: conferir o computador (Node e a porta livre), baixar as peças, criar a configuração, gerar a extensão, ligar o backend e integrar com os apps do Mac.

Para ler o script inteiro antes:

```bash
curl -fsSL https://raw.githubusercontent.com/Dennielasouza/prompt-refiner/main/instalar.sh | less
```

Aperte `q` para sair.

</details>

## Passo 2 — Carregar a extensão no Chrome

Isso o instalador não consegue fazer: o Chrome só aceita no mouse.

1. Abra `chrome://extensions`
2. Ligue o **Modo do desenvolvedor**, no canto superior direito
3. Clique em **Carregar sem compactação**
4. Escolha a pasta `~/prompt-refiner/extension/dist` — é o caminho que o instalador imprimiu na primeira e na última linha

> **Não acha a pasta na janela do Chrome?** Aperte **⌘⇧G**, cole `~/prompt-refiner/extension/dist` e dê Enter. O instalador também imprime o caminho exato no fim.
>
> Ela só existe **depois** que o instalador roda — é ele que a cria.

*Carregar sem compactação* quer dizer que o Chrome roda a extensão direto dessa pasta, em vez de pegá-la na loja. Nada é verificado pelo Google e ela não se atualiza sozinha — você está confiando no código dessa pasta, que está todo aberto para leitura.

## Passo 3 — Liberar o atalho ⌥⌥ *(só no Mac)*

1. Abra **Ajustes do Sistema › Privacidade e Segurança › Acessibilidade**
2. Se o **Prompt Refiner** já estiver na lista, remova com o botão **−**
3. Clique em **+** e escolha `~/Applications/Prompt Refiner.app`

> Se você já tinha instalado antes, **remover e adicionar de novo é obrigatório**. Desligar e religar o botão não funciona, porque para o macOS cada versão do app é um app diferente.

---

## Pronto — como usar

- **No Chrome:** selecione o texto, clique com o botão direito e escolha **Prompt Refiner › Refinar prompt**.
- **Em qualquer app do Mac:** selecione o texto e dê **dois toques rápidos no ⌥ Option**. Segurando **⇧ Shift** junto, ele usa o modo profundo.

O texto selecionado é substituído pelo prompt refinado, ali mesmo. Se algo falhar, **o seu texto não muda**.

---

## Quando algo dá errado

| O que você vê | O que fazer |
|---|---|
| O terminal virou `bash-3.2$` e apareceu um aviso sobre zsh | As crases ``` foram copiadas junto. Digite `exit`, aperte Enter e copie o comando usando o botão de copiar do bloco |
| `command not found: node` | O Node não está instalado. Baixe a versão LTS em [nodejs.org](https://nodejs.org) |
| `destination path ... already exists` | Só aparece se você clonar à mão: a pasta já existe de uma tentativa anterior. Rode `cd ~/prompt-refiner && ./instalar.sh`. Pelo comando único isso é tratado sozinho |
| O instalador diz que o Claude Code não está logado | Rode `claude` no terminal, digite `/login`, escolha a conta com assinatura e depois `/exit` |
| O instalador diz que a porta já está ocupada | Ele para **antes** de começar e mostra o PID de quem está na porta (quase sempre um `npm run dev` esquecido num terminal). Feche aquele terminal, ou rode `kill <PID>`, e rode o instalador de novo. Se a porta é de outro programa que você quer manter, mude `PORT=` no `backend/.env` |
| Instalei, mas continuo com a versão anterior | Não acontece mais: o instalador reinstala o serviço em toda rodada e confere se a versão que está no ar é a desta pasta. Se não for, ele para e diz qual é qual |
| Rodei o instalador de dentro de um ZIP e não achei a extensão no Chrome | Não acontece mais: a instalação vai sempre para `~/prompt-refiner`, e esse caminho é a primeira e a última coisa que aparece na tela |
| A extensão diz *Desconectado* | Veja se a porta no campo **Endpoint da API** é a mesma do `backend/.env`. Se você moveu a pasta do projeto, rode o instalador de novo |
| O ⌥⌥ não faz nada | A Acessibilidade não está concedida, ou foi concedida a uma versão antiga do app. Refaça o passo 3, removendo com **−** antes de adicionar |
| O ⌥⌥ abre a entrada rápida do Claude | O app do Claude usa o mesmo atalho. Desligue em Claude › Ajustes › Sistema |

**Para ver o que o backend registrou:**

```bash
tail -20 ~/Library/Logs/PromptRefiner/backend.log
```

Se nada disso resolver, [abra uma issue](https://github.com/Dennielasouza/prompt-refiner/issues) contando o que apareceu na tela. Print serve perfeitamente. **Não cole a sua chave de API nem o texto dos seus prompts.**

---

## Desinstalar

Os comandos ficam dentro da pasta do projeto, então **rode-os antes de apagar a pasta**.

```bash
cd ~/prompt-refiner && npm run uninstall-hotkey -w desktop && npm run uninstall-services -w desktop && npm run uninstall-service -w backend
```

Depois remova a extensão em `chrome://extensions`, tire o Prompt Refiner da lista de Acessibilidade e apague a pasta `~/prompt-refiner`.

O histórico de uso fica em `~/Library/Logs/PromptRefiner/backend.log` e não é apagado por nenhum desses comandos — apague à mão se quiser.

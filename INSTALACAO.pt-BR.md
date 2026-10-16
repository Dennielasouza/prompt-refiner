[English](INSTALL.md) | **Português**

# Instalar o Prompt Refiner

Este é o guia da instalação, e só isso. O que o Prompt Refiner faz, como configurar e como funciona por dentro está no [README](README.pt-BR.md).

É **um comando** e mais duas coisas feitas no mouse. Leva uns 3 minutos.

---

## Antes de começar

> **Copiando os comandos:** passe o mouse sobre o bloco cinza e use o **botão de copiar** que aparece no canto. As crases ``` que você vê na tela **não fazem parte do comando** — se elas forem junto, o terminal abre outro terminal dentro dele e parece que tudo deu errado.

Você vai precisar de:

- **Um Mac, ou qualquer computador com o Chrome.** A parte dos apps do Mac (o atalho ⌥⌥) é só do macOS.
- **Node.js 22 ou mais novo.** Para saber se você já tem, abra o app **Terminal** e rode:

  ```bash
  node --version
  ```

  Se aparecer um número como `v22.11.0` ou maior, está pronto. Se disser *command not found*, baixe a versão **LTS** em [nodejs.org](https://nodejs.org) — o instalador faz tudo sozinho.

- **Um motor de IA.** Você escolhe um dos dois, não precisa dos dois:
  - **A sua assinatura do Claude** (Pro ou Max), sem chave de API nem cartão. É o caminho recomendado, e é o que o instalador já espera encontrar. Para isso o [Claude Code](https://code.claude.com) precisa estar instalado e logado.
  - **Uma chave de API sua**, da Anthropic ou da OpenAI, paga por uso. Veja como configurar no [README](README.pt-BR.md#motores).

---

## Instalar — um comando

Abra o app **Terminal**, cole a linha abaixo e aperte Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/Dennielasouza/prompt-refiner/main/instalar.sh | bash
```

Esse comando baixa um script da internet e roda. Vale saber o que ele faz antes: são **6 etapas** — conferir o Node, baixar as peças, criar a configuração, gerar a extensão, ligar o backend e integrar com o Mac. Ele **não pede senha** e **não escreve nada fora da sua pasta de usuário**. Para ler antes de rodar:

```bash
curl -fsSL https://raw.githubusercontent.com/Dennielasouza/prompt-refiner/main/instalar.sh | less
```

(aperte `q` para sair)

É só isso. Ele baixa o projeto, instala tudo, liga o backend e termina **refinando uma frase de verdade** para você ver funcionando. Mostra 6 etapas numeradas pelo caminho.

> **Copiando:** passe o mouse sobre o bloco cinza e use o **botão de copiar** no canto. As crases ``` que aparecem na tela **não fazem parte do comando**.

Se preferir ler o script antes de rodar — é o que eu faria com qualquer comando da internet — baixe e abra primeiro:

```bash
git clone https://github.com/Dennielasouza/prompt-refiner.git ~/prompt-refiner && open ~/prompt-refiner/instalar.sh
```

e depois rode:

```bash
cd ~/prompt-refiner && ./instalar.sh
```

**Se ele parar no meio**, a mensagem diz o motivo e o que fazer. Pode rodar de novo quantas vezes quiser: ele detecta o que já está pronto e não repete.

## Passo 2 — Carregar a extensão no Chrome

Isso o instalador não consegue fazer: o Chrome só aceita no mouse.

1. Abra `chrome://extensions`
2. Ligue o **Modo do desenvolvedor**, no canto superior direito
3. Clique em **Carregar sem compactação**
4. Escolha a pasta `~/prompt-refiner/extension/dist`

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
| O instalador diz que a porta já está em uso | Outro programa ocupa a 8787. Abra `backend/.env`, mude a linha `PORT=` e rode o instalador de novo |
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

/**
 * Mensagem curta (pt-BR) para uma falha ao abrir a porta do servidor. Nunca inclui stack nem texto de prompt.
 *
 * `watching`: sob `npm run dev` quem observa os arquivos é o `tsx watch`, que segue vivo depois que o
 * servidor sai — sem este aviso o terminal parece travado. Rodando direto, o processo encerra e o aviso
 * seria mentira, por isso ele é condicional.
 */
export function startupErrorMessage(err: unknown, port: number, opts: { watching?: boolean } = {}): string {
  const watchHint = opts.watching
    ? "\nO modo de desenvolvimento continua observando os arquivos: pressione Ctrl+C para sair."
    : "";
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  if (code === "EADDRINUSE") {
    return (
      [
        `A porta ${port} já está em uso por outro processo.`,
        "  1. Encerre o outro processo, ou",
        "  2. defina PORT em backend/.env com outra porta (ex.: PORT=8788).",
        'Se mudar a PORT, use a mesma porta no campo "Endpoint da API" da extensão.',
      ].join("\n") + watchHint
    );
  }
  if (code === "EACCES") {
    return (
      [
        `Sem permissão para usar a porta ${port} (portas abaixo de 1024 exigem privilégios).`,
        'Defina PORT em backend/.env com uma porta maior (ex.: PORT=8787) e use a mesma no "Endpoint da API" da extensão.',
      ].join("\n") + watchHint
    );
  }
  return `Não foi possível iniciar o servidor na porta ${port} (código: ${code || "desconhecido"}).${watchHint}`;
}

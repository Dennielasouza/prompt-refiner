import { existsSync } from "node:fs";
import { loadConfig } from "./config/env.js";
import { createProvider } from "./providers/index.js";
import { buildServer } from "./server.js";
import { startupErrorMessage } from "./startup.js";

const envFileExists = existsSync(".env");
if (envFileExists) process.loadEnvFile(".env");

const config = loadConfig();
const provider = createProvider(config);
const app = buildServer(config, provider);

// Sem o .env, qualquer erro de configuração tem a mesma causa e o mesmo conserto. Dizer isso evita
// mandar a pessoa atrás de uma chave de API quando ela só esqueceu de criar o arquivo.
if (config.configError && !envFileExists) {
  app.log.warn("backend/.env não encontrado. Crie-o a partir do exemplo: cp backend/.env.example backend/.env");
} else if (config.configError) app.log.warn(config.configError);
else app.log.info({ provider: config.provider, model: config.model }, "compiler provider ready");

app.listen({ port: config.port, host: config.host }).catch((err) => {
  // `npm run dev` roda sob `tsx watch`; npm define npm_lifecycle_event com o nome do script.
  console.error(startupErrorMessage(err, config.port, { watching: process.env.npm_lifecycle_event === "dev" }));
  process.exit(1);
});

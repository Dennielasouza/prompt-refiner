import { existsSync } from "node:fs";
import { loadConfig } from "./config/env.js";
import { createProvider } from "./providers/index.js";
import { buildServer } from "./server.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const config = loadConfig();
const provider = createProvider(config);
const app = buildServer(config, provider);

if (config.configError) app.log.warn(config.configError);
else app.log.info({ provider: config.provider, model: config.model }, "compiler provider ready");

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

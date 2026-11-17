// @ts-check
/** Entry point: `npm start` (with an AI provider) or `npm run demo` (no AI needed). */
import http from 'node:http';
import { loadDotEnv, loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createProvider } from './ai/providers/index.js';
import { createListingFetcher } from './listing/fetch.js';
import { createApp } from './app.js';

loadDotEnv();
const { config, errors, warnings } = loadConfig();
const log = createLogger(config.logLevel);

if (errors.length) {
  for (const e of errors) process.stderr.write(`Configuration problem: ${e}\n`);
  process.exit(1);
}
for (const w of warnings) log.warn(w);

const provider = createProvider(config, { log });
const fetchListing = createListingFetcher({ userAgent: config.userAgent });
const app = createApp({ config, provider, fetchListing, log });

const server = http.createServer(app);
server.requestTimeout = config.timeoutMs * 3 + 60000;
server.headersTimeout = 30000;

server.listen(config.port, config.host, () => {
  const host = config.host.includes(':') ? `[${config.host}]` : config.host;
  const mode = provider.name === 'demo' ? 'demo mode, keyword rules, no AI' : `${provider.name}, model ${provider.model}`;
  process.stdout.write(`\nNestWorth is running at http://${host}:${config.port} (${mode})\n\n`);
  log.info('server started', { host: config.host, port: config.port, provider: provider.name, model: provider.model, webResearch: config.webResearch });
});

/** @param {string} signal */
function shutdown(signal) {
  log.info('shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

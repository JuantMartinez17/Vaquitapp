import { app } from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Vaquitapp API escuchando en http://localhost:${env.PORT}`);
  console.log(`   Entorno: ${env.NODE_ENV}`);
});

// Graceful shutdown
const shutdown = (signal: string) => {
  console.log(`\n${signal} recibido, cerrando servidor...`);
  server.close(() => {
    console.log('Servidor cerrado.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

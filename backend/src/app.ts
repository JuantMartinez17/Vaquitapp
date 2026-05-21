import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGINS.split(',') }));
app.use(express.json());
app.use(pinoHttp({ level: env.LOG_LEVEL }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ready check (verifica DB)
app.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'not ready', database: 'disconnected' });
  }
});

// Prueba: listar monedas
app.get('/api/v1/currencies', async (_req, res) => {
  const currencies = await prisma.currency.findMany({
    orderBy: { code: 'asc' },
  });
  res.json(currencies);
});

// Manejador de errores global (al final)
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Algo salió mal' } });
});
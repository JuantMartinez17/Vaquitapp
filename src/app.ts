import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { currenciesRouter } from './modules/currencies/currencies.routes.js';

export const app = express();

// Middlewares globales
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGINS.split(',') }));
app.use(express.json({ limit: '1mb' }));
app.use(
  pinoHttp({
    level: env.LOG_LEVEL,
    // Request ID: reutiliza el X-Request-Id entrante o genera uno, y lo
    // devuelve en la respuesta para poder correlacionar logs y reportes.
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
  }),
);

// Health checks
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'not ready', database: 'disconnected' });
  }
});

// Rutas de la API v1
const apiRouter = express.Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/currencies', currenciesRouter);

app.use('/api/v1', apiRouter);

// 404 para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Ruta no encontrada: ${req.method} ${req.path}` },
  });
});

// Middleware de errores (SIEMPRE va al final)
app.use(errorMiddleware);

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { errorMiddleware } from './middlewares/error.middleware.js';

export const app = express();

// Middlewares globales
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGINS.split(',') }));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ level: env.LOG_LEVEL }));

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

// Rutas de la API (los módulos se van montando acá a medida que se crean)
const apiRouter = express.Router();

// Endpoint temporal de prueba (lo borrás cuando ya no lo necesites)
apiRouter.get('/currencies', async (_req, res) => {
  const currencies = await prisma.currency.findMany({ orderBy: { code: 'asc' } });
  res.json(currencies);
});

// Acá vamos a montar los módulos. Por ejemplo, cuando exista auth:
// import { authRouter } from './modules/auth/auth.routes.js';
// apiRouter.use('/auth', authRouter);

app.use('/api/v1', apiRouter);

// 404 para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Ruta no encontrada: ${req.method} ${req.path}` },
  });
});

// Middleware de errores (SIEMPRE va al final)
app.use(errorMiddleware);
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config.js';
import { prisma } from '../infrastructure/database/prisma.js';
import { logger } from '../infrastructure/logging/logger.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { usersRouter } from '../modules/users/users.routes.js';
import { householdsRouter } from '../modules/households/households.routes.js';
import { currenciesRouter } from '../modules/currencies/currencies.routes.js';
import {
  householdInvitationsRouter,
  invitationsRouter,
} from '../modules/invitations/invitations.routes.js';
import {
  categoriesRouter,
  householdCategoriesRouter,
} from '../modules/categories/categories.routes.js';
import { expensesRouter } from '../modules/expenses/expenses.routes.js';
import { settlementsRouter } from '../modules/settlements/settlements.routes.js';
import { balancesRouter } from '../modules/balances/balances.routes.js';
import { incomesRouter } from '../modules/incomes/incomes.routes.js';
import { transfersRouter } from '../modules/transfers/transfers.routes.js';
import { activityRouter } from '../modules/activity/activity.routes.js';
import { recurringExpensesRouter } from '../modules/recurring-expenses/recurring-expenses.routes.js';
import { attachmentsRouter } from '../modules/attachments/attachments.routes.js';
import { localFilesRouter } from '../infrastructure/storage/local-files.routes.js';
import { analyticsRouter } from '../modules/analytics/analytics.routes.js';
import { openApiRouter } from '../infrastructure/openapi/openapi.routes.js';

export const app = express();

// Render (and most PaaS) sit behind a reverse proxy: without this, req.ip is
// the proxy's address for every request, and IP-based rate limiting would
// lump all clients into one bucket instead of limiting per real client.
app.set('trust proxy', 1);

// Global middlewares
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGINS.split(',') }));
app.use(express.json({ limit: '1mb' }));
app.use(
  pinoHttp({
    logger,
    // Request ID: reuse the incoming X-Request-Id or generate one, and
    // return it in the response so logs and reports can be correlated.
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

// API documentation, generated from the same Zod schemas that validate
// requests (F10). Not versioned like /api/v1: it describes the whole API.
app.use('/docs', openApiRouter);

// API v1 routes
const apiRouter = express.Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/households', householdsRouter);
apiRouter.use('/households/:householdId/invitations', householdInvitationsRouter);
apiRouter.use('/invitations', invitationsRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/households/:householdId/categories', householdCategoriesRouter);
apiRouter.use('/households/:householdId/expenses', expensesRouter);
apiRouter.use('/households/:householdId/settlements', settlementsRouter);
apiRouter.use('/households/:householdId/balances', balancesRouter);
apiRouter.use('/households/:householdId/incomes', incomesRouter);
apiRouter.use('/households/:householdId/transfers', transfersRouter);
apiRouter.use('/households/:householdId/activity', activityRouter);
apiRouter.use('/households/:householdId/recurring-expenses', recurringExpensesRouter);
apiRouter.use('/households/:householdId/expenses/:expenseId/attachments', attachmentsRouter);
apiRouter.use('/households/:householdId/analytics', analyticsRouter);
apiRouter.use('/currencies', currenciesRouter);
apiRouter.use('/files/local', localFilesRouter);

app.use('/api/v1', apiRouter);

// 404 for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` },
  });
});

// Error-handling middleware (ALWAYS last)
app.use(errorMiddleware);

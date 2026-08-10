import { Router } from 'express';
import * as currenciesController from './currencies.controller.js';

export const currenciesRouter = Router();

// Public catalog of supported currencies (consumed by the frontend for selects).
currenciesRouter.get('/', currenciesController.list);

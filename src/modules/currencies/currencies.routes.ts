import { Router } from 'express';
import * as currenciesController from './currencies.controller.js';

export const currenciesRouter = Router();

// Catálogo público de monedas soportadas (lo consume el front para selects).
currenciesRouter.get('/', currenciesController.list);

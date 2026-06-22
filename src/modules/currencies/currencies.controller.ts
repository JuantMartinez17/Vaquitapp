import { asyncHandler } from '../../utils/asyncHandler.js';
import * as currenciesService from './currencies.service.js';

export const list = asyncHandler(async (_req, res) => {
  const currencies = await currenciesService.listCurrencies();
  res.json(currencies);
});

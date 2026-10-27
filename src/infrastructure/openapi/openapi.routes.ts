import { Router } from 'express';
import helmet from 'helmet';
import { openApiDocument } from './openapi.spec.js';

/**
 * `/docs`: interactive API reference generated from the same Zod schemas
 * that validate every request, so it can't drift from real behavior. Uses
 * Swagger UI's static bundle from a CDN instead of the `swagger-ui-dist`
 * package, which would otherwise ship the whole UI in `node_modules` just
 * to serve one static HTML shell.
 */
export const openApiRouter = Router();

// Helmet's default CSP (script-src 'self') blocks both the CDN bundle and
// the inline bootstrap script, leaving /docs blank. The policy is relaxed
// here only, for the one CDN host, and the bootstrap lives in a same-origin
// file so no 'unsafe-inline' is needed for scripts. Swagger UI injects
// <style> tags and style attributes at runtime, hence 'unsafe-inline' for
// styles only.
openApiRouter.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://unpkg.com'],
      styleSrc: ["'self'", 'https://unpkg.com', "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://unpkg.com'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  }),
);

openApiRouter.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});

openApiRouter.get('/swagger-init.js', (_req, res) => {
  res.type('js').send(`window.ui = SwaggerUIBundle({
  url: '/docs/openapi.json',
  dom_id: '#swagger-ui',
});
`);
});

openApiRouter.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html>
  <head>
    <title>Vaquitapp API docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script src="/docs/swagger-init.js"></script>
  </body>
</html>`);
});

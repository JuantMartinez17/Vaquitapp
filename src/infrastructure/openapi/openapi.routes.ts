import { Router } from 'express';
import { openApiDocument } from './openapi.spec.js';

/**
 * `/docs`: interactive API reference generated from the same Zod schemas
 * that validate every request, so it can't drift from real behavior. Uses
 * Swagger UI's static bundle from a CDN instead of the `swagger-ui-dist`
 * package, which would otherwise ship the whole UI in `node_modules` just
 * to serve one static HTML shell.
 */
export const openApiRouter = Router();

openApiRouter.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument);
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
    <script>
      window.ui = SwaggerUIBundle({
        url: '/docs/openapi.json',
        dom_id: '#swagger-ui',
      });
    </script>
  </body>
</html>`);
});

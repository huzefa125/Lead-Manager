import { Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi';

/**
 * Serves the interactive Swagger UI and the raw OpenAPI document.
 *
 *   GET /api/docs       → Swagger UI
 *   GET /api/docs.json  → the spec, for client generators and Postman imports
 *
 * Mounted only when ENABLE_API_DOCS is true (see app.ts). Turning it off in
 * production is a reasonable default: the spec enumerates every endpoint and
 * its validation rules, which is a free reconnaissance map for an attacker.
 */
export const docsRouter = Router();

// Served before the UI so the raw spec stays fetchable regardless of UI state.
docsRouter.get('/docs.json', (_req, res) => {
  res.json(openApiDocument);
});

docsRouter.use(
  '/docs',
  // Swagger UI ships inline scripts and styles, which the app-wide helmet CSP
  // blocks. This re-runs helmet for this route only, relaxing script/style-src
  // and leaving every other security header intact.
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  }),
  // Cast: the spec is `as const`, which is deeper than the loose JsonObject
  // type swagger-ui-express expects. The shape is valid OpenAPI 3.0.3.
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument as unknown as swaggerUi.JsonObject, {
    customSiteTitle: 'Auth Service API',
    swaggerOptions: {
      persistAuthorization: true, // survives a page reload while testing
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      tryItOutEnabled: true,
      // Send cookies with "Try it out" requests so /auth/refresh and
      // /auth/logout work from the browser without manual setup.
      withCredentials: true,
    },
  }),
);

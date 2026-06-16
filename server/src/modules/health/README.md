# Health Module

Exposes simple operational endpoints.

## Entry Points

- `health.routes.js` registers `GET /api/health`.

## AI Context

Keep health checks lightweight. Do not add peer internals or socket state unless deployment monitoring needs it.

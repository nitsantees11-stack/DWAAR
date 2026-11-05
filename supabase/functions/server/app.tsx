import { Hono } from "npm:hono@4";
import { cors } from "npm:hono@4/cors";
import { logger } from "npm:hono@4/logger";
import { publicCatalog } from "./catalog.tsx";
import { customerApp } from "./customer.tsx";
import { partnerApp } from "./partner-api.tsx";
import { importerApp } from "./importer.tsx";
import { CORS_HEADERS } from "./partner-http.tsx";
import { errorOf } from "./http.tsx";

/**
 * dwaar backend on Supabase (edge function `make-server-4d6fa028`). Tables: see
 * supabase/sql/dwaar-schema.sql, which must be run once in the Supabase SQL editor.
 *
 *   /catalog            public catalog (categories, services, models, offers, config)
 *   /c/*                customer API, called server-side by the dwaar app
 *   /partner/v1/*       dwaar Partner API (the dwaar app proxies /api/partner/v1/* here)
 *   /admin/import/*     one-time Payload import (token protected)
 */
const BASE = "/make-server-4d6fa028";
export const app = new Hono();

app.use("*", logger(console.log));

// Partner routes set their own CORS headers (same as the Payload Partner API).
app.use(`${BASE}/partner/*`, async (c, next) => {
  if (c.req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  await next();
});
app.use(
  `${BASE}/*`,
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "apikey", "x-client-info", "X-Dwaar-Session"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

app.onError((err, c) => {
  const e = errorOf(err);
  return c.json(e.body, e.status as 500);
});

app.get(`${BASE}/health`, (c) => c.json({ status: "ok" }));
app.get(`${BASE}/version`, (c) => c.json({ service: "dwaar", phase: 2, backend: "postgres", build: "2026-11-05.2" }));

app.get(`${BASE}/catalog`, async (c) => {
  c.header("Cache-Control", "public, max-age=30");
  return c.json({ ok: true, ...(await publicCatalog()) });
});

app.route(`${BASE}/c`, customerApp);
app.route(`${BASE}/partner/v1`, partnerApp);
app.route(`${BASE}/admin/import`, importerApp);

app.notFound((c) => c.json({ ok: false, error: "not_found" }, 404));

export default app;

// Serves the edge function locally on real Postgres (PGlite) + storage doubles, for testing the
// Payload -> Supabase export end to end:  deno run --import-map=supabase/tests/import_map.json -A supabase/tests/local-server.ts 8788
Deno.env.set('SUPABASE_URL', 'http://supabase.test')
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key-for-tests')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-for-tests')
const { app } = await import('../functions/server/app.tsx')
const port = Number(Deno.args[0] ?? 8788)
Deno.serve({ port, hostname: '127.0.0.1' }, app.fetch)

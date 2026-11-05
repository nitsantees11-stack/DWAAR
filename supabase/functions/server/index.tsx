import app from "./app.tsx";

// Entry point of the `make-server-4d6fa028` edge function. Routes live in app.tsx.
Deno.serve(app.fetch);

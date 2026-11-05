// Regenerates supabase/sql/dwaar-schema.sql from schema.tsx:
//   deno run -A supabase/tests/gen-sql.ts
import { buildSql } from '../functions/server/schema.tsx'
Deno.writeTextFileSync(new URL('../sql/dwaar-schema.sql', import.meta.url), buildSql())
console.log('wrote supabase/sql/dwaar-schema.sql')

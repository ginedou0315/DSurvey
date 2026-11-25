// Netlify Server entry. Runs the same request handler used for local and
// Cloudflare deployments, backed by Netlify Database (Postgres).
import { getDatabase } from '@netlify/database';
import worker from '../../dist/server/index.js';

let pool;
const getPool = () => (pool ??= getDatabase().pool);

// Minimal D1-compatible adapter: prepare(sql).bind(...).first()/all()/run()
const toPg = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
const DB = {
  prepare(sql) {
    const text = toPg(sql);
    return { bind(...values) {
      const query = () => getPool().query(text, values);
      return {
        first: async () => (await query()).rows[0] ?? null,
        all: async () => ({ results: (await query()).rows }),
        run: async () => ({ meta: { changes: (await query()).rowCount } }),
      };
    } };
  },
};

export default {
  fetch(request) {
    return worker.fetch(request, { DB, DSURVEY_CREATOR_KEY: process.env.DSURVEY_CREATOR_KEY });
  },
};

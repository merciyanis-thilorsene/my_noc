import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { status?: string; severity?: string } }>(
    '/alerts',
    async (req) => {
      const { status, severity } = req.query;
      const args: unknown[] = [];
      const clauses: string[] = [];
      if (status === 'active')  clauses.push('cleared_at IS NULL');
      if (status === 'cleared') clauses.push('cleared_at IS NOT NULL');
      if (severity) { args.push(severity); clauses.push(`severity = $${args.length}`); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM alerts ${where} ORDER BY raised_at DESC LIMIT 500`,
        args,
      );
      return { items: rows };
    },
  );

  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/alerts/history',
    async (req) => {
      const from = req.query.from ?? new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
      const to = req.query.to ?? new Date().toISOString();
      const { rows } = await pool.query(
        `SELECT * FROM alerts
          WHERE raised_at BETWEEN $1 AND $2
          ORDER BY raised_at DESC
          LIMIT 2000`,
        [from, to],
      );
      return { from, to, items: rows };
    },
  );
}

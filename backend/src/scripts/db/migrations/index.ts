/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import init001 from 'scripts/db/migrations/001_init';
import uplinkDedup002 from 'scripts/db/migrations/002_uplink_dedup';

/**
 * A forward-only schema migration. `id` must be a stable, ascending integer.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * Ordered list of migrations applied on startup. Append new entries; never edit or
 * renumber existing ones.
 */
const migrations: Migration[] = [
  { id: 1, name: 'init', sql: init001 },
  { id: 2, name: 'uplink_dedup', sql: uplinkDedup002 },
];

export default migrations;

import type { Config } from 'drizzle-kit'

export default {
  schema: '../shared/src/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.POS_DB ?? './pos.db' },
} satisfies Config

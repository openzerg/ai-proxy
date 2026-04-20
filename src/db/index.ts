import postgres from "postgres"
import { Kysely } from "kysely"
import { PostgresJSDialect } from "kysely-postgres-js"
import { ResultAsync } from "neverthrow"
import { DbError } from "../errors.js"
import type { Database } from "../entities/index.js"

export type DB = Kysely<Database>

export function openDB(databaseURL: string): DB {
  const sql = postgres(databaseURL)
  return new Kysely<Database>({
    dialect: new PostgresJSDialect({ postgres: sql }),
  })
}

export async function autoMigrate(databaseURL: string): Promise<void> {
  const sql = postgres(databaseURL)
  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ai_proxy_logs (
        "id"                       TEXT NOT NULL PRIMARY KEY,
        "proxyId"                  TEXT NOT NULL,
        "sourceModel"              TEXT NOT NULL,
        "targetModel"              TEXT NOT NULL,
        "upstream"                 TEXT NOT NULL,
        "inputTokens"              BIGINT NOT NULL,
        "outputTokens"             BIGINT NOT NULL,
        "totalTokens"              BIGINT NOT NULL,
        "durationMs"               BIGINT NOT NULL,
        "timeToFirstTokenMs"       BIGINT NOT NULL,
        "isStream"                 BOOLEAN NOT NULL,
        "isSuccess"                BOOLEAN NOT NULL,
        "errorMessage"             TEXT NOT NULL DEFAULT '',
        "createdAt"                BIGINT NOT NULL
      )
    `)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ai_proxy_logs_proxyId ON ai_proxy_logs ("proxyId")`)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ai_proxy_logs_createdAt ON ai_proxy_logs ("createdAt")`)

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ai_proxy_provider_model_configs (
        "id"                       TEXT NOT NULL PRIMARY KEY,
        "providerId"               TEXT NOT NULL,
        "providerName"             TEXT NOT NULL,
        "modelId"                  TEXT NOT NULL,
        "modelName"                TEXT NOT NULL,
        "upstream"                 TEXT NOT NULL,
        "apiKey"                   TEXT NOT NULL,
        "supportStreaming"         BOOLEAN NOT NULL,
        "supportTools"             BOOLEAN NOT NULL,
        "supportVision"            BOOLEAN NOT NULL,
        "supportReasoning"         BOOLEAN NOT NULL,
        "defaultMaxTokens"         INTEGER NOT NULL,
        "contextLength"            INTEGER NOT NULL,
        "autoCompactLength"        INTEGER NOT NULL,
        "enabled"                  BOOLEAN NOT NULL,
        "createdAt"                BIGINT NOT NULL,
        "updatedAt"                BIGINT NOT NULL
      )
    `)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_cpmc_providerId ON ai_proxy_provider_model_configs ("providerId")`)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_cpmc_enabled ON ai_proxy_provider_model_configs ("enabled")`)

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ai_proxy_proxies (
        "id"                       TEXT NOT NULL PRIMARY KEY,
        "sourceModel"              TEXT NOT NULL UNIQUE,
        "providerModelConfigId"    TEXT NOT NULL,
        "apiKey"                   TEXT NOT NULL,
        "enabled"                  BOOLEAN NOT NULL,
        "createdAt"                BIGINT NOT NULL,
        "updatedAt"                BIGINT NOT NULL
      )
    `)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ai_proxy_proxies_enabled ON ai_proxy_proxies ("enabled")`)

    console.log("[ai-proxy] auto-migration complete")
  } finally {
    await sql.end()
  }
}

export function dbQuery<T>(fn: () => Promise<T>): ResultAsync<T, DbError> {
  return ResultAsync.fromPromise(
    fn(),
    e => new DbError(e instanceof Error ? e.message : String(e)),
  )
}

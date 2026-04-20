import { okAsync, errAsync, ResultAsync } from "neverthrow"
import type { DB } from "../db/index.js"
import { dbQuery } from "../db/index.js"
import { NotFoundError, DbError } from "../errors.js"
import type { ProviderModelConfig, ProviderModelConfigInsert, ProviderModelConfigUpdate } from "../entities/index.js"
import { randomId, nowSec } from "./util.js"

type ConfigError = NotFoundError | DbError

export function createProviderModelConfigService(db: DB) {
  return {
    list(enabledOnly: boolean): ResultAsync<ProviderModelConfig[], DbError> {
      return dbQuery(() => {
        let q = db.selectFrom("ai_proxy_provider_model_configs").selectAll()
        if (enabledOnly) q = q.where("enabled", "=", true)
        return q.execute()
      })
    },

    get(id: string): ResultAsync<ProviderModelConfig, ConfigError> {
      return dbQuery(() =>
        db.selectFrom("ai_proxy_provider_model_configs").selectAll().where("id", "=", id).executeTakeFirst()
      ).andThen(row =>
        row ? okAsync(row) : errAsync(new NotFoundError(`provider model config not found: ${id}`))
      )
    },

    create(data: ProviderModelConfigInsert): ResultAsync<ProviderModelConfig, DbError> {
      const id  = randomId()
      const now = BigInt(nowSec())
      return dbQuery(() =>
        db.insertInto("ai_proxy_provider_model_configs")
          .values({
            id,
            ...data,
            autoCompactLength: data.autoCompactLength ??
              Math.floor((data.contextLength ?? 0) * 0.9),
            enabled:   true,
            createdAt: now,
            updatedAt: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
      )
    },

    update(data: ProviderModelConfigUpdate): ResultAsync<ProviderModelConfig, ConfigError> {
      const { id, ...fields } = data
      const updates = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined)
      )
      return dbQuery(() =>
        db.updateTable("ai_proxy_provider_model_configs")
          .set({ ...updates, updatedAt: BigInt(nowSec()) })
          .where("id", "=", id)
          .returningAll()
          .executeTakeFirst()
      ).andThen(row =>
        row ? okAsync(row) : errAsync(new NotFoundError(`provider model config not found: ${id}`))
      )
    },

    delete(id: string): ResultAsync<void, DbError> {
      return dbQuery(() =>
        db.deleteFrom("ai_proxy_provider_model_configs").where("id", "=", id).execute()
      ).map(() => undefined)
    },
  }
}

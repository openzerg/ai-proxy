import { ResultAsync } from "neverthrow"
import type { DB } from "../db/index.js"
import { dbQuery } from "../db/index.js"
import type { DbError } from "../errors.js"
import type { Log } from "../entities/index.js"
import { randomId } from "./util.js"

export interface LogQuery {
  proxyId?: string
  fromTs?:  bigint
  toTs?:    bigint
  limit?:   number
  offset?:  number
}

export interface LogStats {
  totalInputTokens:  bigint
  totalOutputTokens: bigint
  totalTokens:       bigint
  requestCount:      bigint
}

export function createLogsService(db: DB) {
  return {
    query(req: LogQuery): ResultAsync<{ entries: Log[]; total: number }, DbError> {
      return dbQuery(async () => {
        let base = db.selectFrom("ai_proxy_logs")
        if (req.proxyId) base = base.where("proxyId",   "=",  req.proxyId) as typeof base
        if (req.fromTs)  base = base.where("createdAt", ">=", req.fromTs)  as typeof base
        if (req.toTs)    base = base.where("createdAt", "<=", req.toTs)    as typeof base

        const { count } = await base
          .select(db.fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow()

        const entries = await base
          .selectAll()
          .orderBy("createdAt", "desc")
          .limit(req.limit  ?? 50)
          .offset(req.offset ?? 0)
          .execute()

        return { entries, total: Number(count) }
      })
    },

    tokenStats(
      proxyId?: string,
      fromTs?:  bigint,
      toTs?:    bigint,
    ): ResultAsync<LogStats, DbError> {
      return dbQuery(async () => {
        let q = db.selectFrom("ai_proxy_logs")
        if (proxyId) q = q.where("proxyId",   "=",  proxyId) as typeof q
        if (fromTs)  q = q.where("createdAt", ">=", fromTs)  as typeof q
        if (toTs)    q = q.where("createdAt", "<=", toTs)    as typeof q

        const row = await q
          .select([
            db.fn.sum<bigint>("inputTokens").as("totalInput"),
            db.fn.sum<bigint>("outputTokens").as("totalOutput"),
            db.fn.sum<bigint>("totalTokens").as("totalTokens"),
            db.fn.countAll<bigint>().as("requestCount"),
          ])
          .executeTakeFirstOrThrow()

        return {
          totalInputTokens:  row.totalInput   ?? 0n,
          totalOutputTokens: row.totalOutput  ?? 0n,
          totalTokens:       row.totalTokens  ?? 0n,
          requestCount:      row.requestCount ?? 0n,
        }
      })
    },

    insert(entry: Omit<Log, "id">): ResultAsync<void, DbError> {
      return dbQuery(() =>
        db.insertInto("ai_proxy_logs")
          .values({ id: randomId(), ...entry })
          .execute()
      ).map(() => undefined)
    },
  }
}

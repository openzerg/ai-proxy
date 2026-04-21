import { ResultAsync } from "neverthrow"
import { gelQuery } from "@openzerg/common/gel"
import type { GelClient } from "@openzerg/common/gel"
import {
  countLogs,
  queryLogs,
  tokenStats,
  insertLog,
} from "@openzerg/common/queries"
import type { DbError } from "../errors.js"

export interface LogQuery {
  proxyId?: string
  fromTs?:  number
  toTs?:    number
  limit?:   number
  offset?:  number
}

export interface LogStats {
  totalInputTokens:  number
  totalOutputTokens: number
  totalTokens:       number
  requestCount:      number
}

export interface LogEntry {
  id: string
  proxyId: string
  sourceModel: string
  targetModel: string
  upstream: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  durationMs: number
  timeToFirstTokenMs: number
  isStream: boolean
  isSuccess: boolean
  errorMessage: string
  createdAt: number
}

export interface LogInsertInput {
  proxyId:            string
  sourceModel:        string
  targetModel:        string
  upstream:           string
  inputTokens:        number
  outputTokens:       number
  totalTokens:        number
  durationMs:         number
  timeToFirstTokenMs: number
  isStream:           boolean
  isSuccess:          boolean
  errorMessage:       string
  createdAt:          number
}

export function createLogsService(gel: GelClient) {
  return {
    query(req: LogQuery): ResultAsync<{ entries: LogEntry[]; total: number }, DbError> {
      return gelQuery(async () => {
        const countResult = await countLogs(gel, {
          proxyId: req.proxyId ?? undefined,
          fromTs: req.fromTs ?? undefined,
          toTs: req.toTs ?? undefined,
        })

        const entries = await queryLogs(gel, {
          proxyId: req.proxyId ?? undefined,
          fromTs: req.fromTs ?? undefined,
          toTs: req.toTs ?? undefined,
          limit: req.limit ?? 50,
          offset: req.offset ?? 0,
        })

        return { entries, total: countResult.count }
      })
    },

    tokenStats(
      proxyId?: string,
      fromTs?:  number,
      toTs?:    number,
    ): ResultAsync<LogStats, DbError> {
      return gelQuery(() =>
        tokenStats(gel, {
          proxyId: proxyId ?? undefined,
          fromTs: fromTs ?? undefined,
          toTs: toTs ?? undefined,
        })
      ).map(row => ({
        totalInputTokens:  row.totalInput ?? 0,
        totalOutputTokens: row.totalOutput ?? 0,
        totalTokens:       row.totalTokens ?? 0,
        requestCount:      row.requestCount ?? 0,
      }))
    },

    insert(entry: LogInsertInput): ResultAsync<void, DbError> {
      return gelQuery(() =>
        insertLog(gel, {
          proxyId: entry.proxyId,
          sourceModel: entry.sourceModel,
          targetModel: entry.targetModel,
          upstream: entry.upstream,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          totalTokens: entry.totalTokens,
          durationMs: entry.durationMs,
          timeToFirstTokenMs: entry.timeToFirstTokenMs,
          isStream: entry.isStream,
          isSuccess: entry.isSuccess,
          errorMessage: entry.errorMessage,
          createdAt: entry.createdAt,
        })
      ).map(() => undefined)
    },
  }
}

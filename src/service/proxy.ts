import { okAsync, errAsync, ResultAsync } from "neverthrow"
import { gelQuery } from "@openzerg/common/gel"
import type { GelClient } from "@openzerg/common/gel"
import {
  listProxies,
  getProxyById,
  insertProxy,
  updateProxy,
  deleteProxyById,
  listEnabledProxySourceModels,
} from "@openzerg/common/queries"
import { NotFoundError, DbError } from "../errors.js"
import { nowSec, generateApiKey } from "./util.js"

type ProxyError = NotFoundError | DbError

export interface ProxyJoined {
  id: string
  sourceModel: string
  providerModelConfigId: string
  apiKey: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  upstream: string
  targetModel: string
  supportStreaming: boolean
  supportTools: boolean
  supportVision: boolean
  supportReasoning: boolean
  defaultMaxTokens: number
  contextLength: number
  autoCompactLength: number
}

export interface ProxyCreateInput {
  sourceModel: string
  providerModelConfigId: string
  apiKey: string
  enabled: boolean
}

export interface ProxyUpdateInput {
  id: string
  sourceModel?: string
  providerModelConfigId?: string
  enabled?: boolean
}

interface ProxyRow {
  id: string
  sourceModel: string
  apiKey: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  providerModelConfig: {
    id: string
    providerId: string
    providerName: string
    modelId: string
    modelName: string
    upstream: string
    apiKey: string
    supportStreaming: boolean
    supportTools: boolean
    supportVision: boolean
    supportReasoning: boolean
    defaultMaxTokens: number
    contextLength: number
    autoCompactLength: number
    enabled: boolean
  }
}

function rowToJoined(row: ProxyRow): ProxyJoined {
  return {
    id: row.id,
    sourceModel: row.sourceModel,
    providerModelConfigId: row.providerModelConfig.id,
    apiKey: row.apiKey,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    providerId: row.providerModelConfig.providerId,
    providerName: row.providerModelConfig.providerName,
    modelId: row.providerModelConfig.modelId,
    modelName: row.providerModelConfig.modelName,
    upstream: row.providerModelConfig.upstream,
    targetModel: row.providerModelConfig.modelId,
    supportStreaming: row.providerModelConfig.supportStreaming,
    supportTools: row.providerModelConfig.supportTools,
    supportVision: row.providerModelConfig.supportVision,
    supportReasoning: row.providerModelConfig.supportReasoning,
    defaultMaxTokens: row.providerModelConfig.defaultMaxTokens,
    contextLength: row.providerModelConfig.contextLength,
    autoCompactLength: row.providerModelConfig.autoCompactLength,
  }
}

export function createProxyService(gel: GelClient) {
  return {
    list(enabledOnly: boolean): ResultAsync<ProxyJoined[], DbError> {
      return gelQuery(() =>
        listProxies(gel, { enabledOnly: enabledOnly || undefined })
      ).map(rows => rows.map(rowToJoined))
    },

    get(id: string): ResultAsync<ProxyJoined, ProxyError> {
      return gelQuery(() =>
        getProxyById(gel, { id })
      ).andThen(row =>
        row ? okAsync(rowToJoined(row)) : errAsync(new NotFoundError(`proxy not found: ${id}`))
      )
    },

    getByApiKey(_apiKey: string, _sourceModel: string): ResultAsync<ProxyJoined, ProxyError> {
      return errAsync(new NotFoundError("use getProxyBySourceModel from queries instead"))
    },

    getUpstreamKey(_providerModelConfigId: string): ResultAsync<string, ProxyError> {
      return errAsync(new NotFoundError("deprecated: use getProviderModelConfigById"))
    },

    create(data: ProxyCreateInput): ResultAsync<ProxyJoined, DbError> {
      const apiKey = generateApiKey()
      const now = nowSec()
      return gelQuery(() =>
        insertProxy(gel, {
          sourceModel: data.sourceModel,
          providerModelConfigId: data.providerModelConfigId,
          apiKey,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        })
      ).map(rowToJoined)
    },

    update(data: ProxyUpdateInput): ResultAsync<ProxyJoined, ProxyError> {
      const now = nowSec()
      return gelQuery(() =>
        updateProxy(gel, {
          id: data.id,
          updatedAt: now,
          sourceModel: data.sourceModel ?? undefined,
          providerModelConfigId: data.providerModelConfigId ?? undefined,
          enabled: data.enabled ?? undefined,
        })
      ).andThen(row =>
        row ? okAsync(rowToJoined(row)) : errAsync(new NotFoundError(`proxy not found: ${data.id}`))
      )
    },

    delete(id: string): ResultAsync<void, DbError> {
      return gelQuery(() =>
        deleteProxyById(gel, { id })
      ).map(() => undefined)
    },

    listModels(): ResultAsync<string[], DbError> {
      return gelQuery(() =>
        listEnabledProxySourceModels(gel)
      ).map(rows => [...new Set(rows.map(r => r.sourceModel))])
    },
  }
}

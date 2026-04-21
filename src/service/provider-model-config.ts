import { okAsync, errAsync, ResultAsync } from "neverthrow"
import { gelQuery } from "@openzerg/common/gel"
import type { GelClient } from "@openzerg/common/gel"
import {
  listProviderModelConfigs,
  getProviderModelConfigById,
  insertProviderModelConfig,
  updateProviderModelConfig,
  deleteProviderModelConfigById,
} from "@openzerg/common/queries"
import { NotFoundError, DbError } from "../errors.js"
import { nowSec } from "./util.js"

type ConfigError = NotFoundError | DbError

export interface ProviderModelConfigCreateInput {
  providerId:        string
  providerName:      string
  modelId:           string
  modelName:         string
  upstream:          string
  apiKey:            string
  supportStreaming:  boolean
  supportTools:      boolean
  supportVision:     boolean
  supportReasoning:  boolean
  defaultMaxTokens:  number
  contextLength:     number
  autoCompactLength: number
  enabled:           boolean
}

export interface ProviderModelConfigUpdateInput {
  id:                string
  providerName?:     string
  modelName?:        string
  upstream?:         string
  apiKey?:           string
  supportStreaming?: boolean
  supportTools?:     boolean
  supportVision?:    boolean
  supportReasoning?: boolean
  defaultMaxTokens?: number
  contextLength?:    number
  autoCompactLength?:number
  enabled?:          boolean
}

interface ConfigRow {
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
  createdAt: number
  updatedAt: number
}

export function createProviderModelConfigService(gel: GelClient) {
  return {
    list(enabledOnly: boolean): ResultAsync<ConfigRow[], DbError> {
      return gelQuery(() =>
        listProviderModelConfigs(gel, { enabledOnly: enabledOnly || undefined })
      )
    },

    get(id: string): ResultAsync<ConfigRow, ConfigError> {
      return gelQuery(() =>
        getProviderModelConfigById(gel, { id })
      ).andThen(row =>
        row ? okAsync(row) : errAsync(new NotFoundError(`provider model config not found: ${id}`))
      )
    },

    create(data: ProviderModelConfigCreateInput): ResultAsync<ConfigRow, DbError> {
      const now = nowSec()
      const autoCompactLength = data.autoCompactLength ?? Math.floor((data.contextLength ?? 0) * 0.9)
      return gelQuery(() =>
        insertProviderModelConfig(gel, {
          providerId: data.providerId,
          providerName: data.providerName,
          modelId: data.modelId,
          modelName: data.modelName,
          upstream: data.upstream,
          apiKey: data.apiKey,
          supportStreaming: data.supportStreaming,
          supportTools: data.supportTools,
          supportVision: data.supportVision,
          supportReasoning: data.supportReasoning,
          defaultMaxTokens: data.defaultMaxTokens,
          contextLength: data.contextLength,
          autoCompactLength,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        })
      )
    },

    update(data: ProviderModelConfigUpdateInput): ResultAsync<ConfigRow, ConfigError> {
      const now = nowSec()
      return gelQuery(() =>
        updateProviderModelConfig(gel, {
          id: data.id,
          updatedAt: now,
          providerName: data.providerName ?? undefined,
          modelName: data.modelName ?? undefined,
          upstream: data.upstream ?? undefined,
          apiKey: data.apiKey ?? undefined,
          supportStreaming: data.supportStreaming ?? undefined,
          supportTools: data.supportTools ?? undefined,
          supportVision: data.supportVision ?? undefined,
          supportReasoning: data.supportReasoning ?? undefined,
          defaultMaxTokens: data.defaultMaxTokens ?? undefined,
          contextLength: data.contextLength ?? undefined,
          autoCompactLength: data.autoCompactLength ?? undefined,
          enabled: data.enabled ?? undefined,
        })
      ).andThen(row =>
        row ? okAsync(row) : errAsync(new NotFoundError(`provider model config not found: ${data.id}`))
      )
    },

    delete(id: string): ResultAsync<void, DbError> {
      return gelQuery(() =>
        deleteProviderModelConfigById(gel, { id })
      ).map(() => undefined)
    },
  }
}

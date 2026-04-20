import { ResultAsync, okAsync, errAsync, ok, err } from "neverthrow"
import { UpstreamError, InternalError, AppError } from "@openzerg/common"

// ── 类型定义 ────────────────────────────────────────────────────────────────

export interface ProviderTemplate {
  id:       string
  name:     string
  api?:     string
  doc:      string
  env:      string[]
  npm:      string
  website?: string
  apiKeyUrl?: string
}

export interface ModelTemplate {
  id:               string
  name:             string
  family?:          string
  reasoning:        boolean
  tool_call:        boolean
  attachment:       boolean
  temperature:      boolean
  structured_output?: boolean
  modalities:       {
    input:  string[]
    output: string[]
  }
  limit: {
    context: number
    input?:  number
    output:  number
  }
  cost?: {
    input?:           number
    output?:          number
    cache_read?:      number
    cache_write?:     number
    reasoning?:       number
    input_audio?:     number
    output_audio?:    number
  }
  status?: "alpha" | "beta" | "deprecated"
  provider?: {
    npm?: string
    api?: string
  }
}

/** 给 WebUI 使用的扁平化模型模板，字段与 CreateProxyRequest 对齐 */
export interface FlatModelTemplate {
  providerId:        string
  providerName:      string
  /** 创建 Proxy 时同时作为 sourceModel 和 targetModel */
  modelId:           string
  modelName:         string
  /** 上游 base URL，与 CreateProxyRequest.upstream 对齐 */
  upstream:          string
  /** 以下能力字段与 CreateProxyRequest 完全一致 */
  supportStreaming:  boolean
  supportTools:      boolean
  supportVision:     boolean
  supportReasoning:  boolean
  defaultMaxTokens:  number
  contextLength:     number
  /** 派生自 contextLength * 0.9，与 CreateProxyRequest.autoCompactLength 对齐 */
  autoCompactLength: number
  /** 模型状态：alpha / beta / deprecated / 空 */
  status?:           string
}

// ── 缓存 ────────────────────────────────────────────────────────────────────

const MODELS_DEV_URL = "https://models.dev/api.json"
const CACHE_TTL_MS   = 5 * 60 * 1000 // 5 分钟

interface CachedData {
  providers:    ProviderTemplate[]
  modelsByProvider: Record<string, ModelTemplate[]>
  fetchedAt:    number
}

let cache: CachedData | null = null

// ── 获取与解析 ──────────────────────────────────────────────────────────────

function fetchModelsDev(): ResultAsync<CachedData, AppError> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return okAsync(cache)
  }

  return ResultAsync.fromPromise(
    (async () => {
      const res = await fetch(MODELS_DEV_URL)
      if (!res.ok) throw new UpstreamError(`models.dev fetch failed: ${res.status}`)
      return res.json() as Promise<Record<string, any>>
    })(),
    (e) => e instanceof AppError ? e : new UpstreamError(`models.dev fetch failed: ${e instanceof Error ? e.message : String(e)}`),
  ).andThen((data) => {
    const providers: ProviderTemplate[] = []
    const modelsByProvider: Record<string, ModelTemplate[]> = {}

    for (const [id, raw] of Object.entries(data)) {
      const p = raw as Record<string, any>
      providers.push({
        id,
        name:     p.name     ?? id,
        api:      p.api,
        doc:      p.doc      ?? "",
        env:      p.env      ?? [],
        npm:      p.npm       ?? "",
      })

      const models: ModelTemplate[] = []
      for (const [modelId, rawM] of Object.entries(p.models ?? {})) {
        const m = rawM as Record<string, any>
        models.push({
          id:                modelId,
          name:              m.name              ?? modelId,
          family:            m.family,
          reasoning:         m.reasoning         ?? false,
          tool_call:         m.tool_call         ?? false,
          attachment:        m.attachment        ?? false,
          temperature:       m.temperature       ?? true,
          structured_output: m.structured_output,
          modalities:        m.modalities        ?? { input: ["text"], output: ["text"] },
          limit:             m.limit             ?? { context: 0, output: 4096 },
          cost:              m.cost,
          status:            m.status,
          provider:          m.provider,
        })
      }
      modelsByProvider[id] = models
    }

    providers.sort((a, b) => a.name.localeCompare(b.name))

    cache = { providers, modelsByProvider, fetchedAt: Date.now() }
    return okAsync(cache)
  })
}

// ── 公开 API ─────────────────────────────────────────────────────────────────

export function getProviders(): ResultAsync<ProviderTemplate[], AppError> {
  return fetchModelsDev().map(c => c.providers)
}

export function getModelsForProvider(providerId: string): ResultAsync<ModelTemplate[], AppError> {
  return fetchModelsDev().map(c => c.modelsByProvider[providerId] ?? [])
}

export function getAllModels(): ResultAsync<FlatModelTemplate[], AppError> {
  return fetchModelsDev().map(({ providers, modelsByProvider }) => {
    const provMap = new Map(providers.map(p => [p.id, p]))
    const results: FlatModelTemplate[] = []

    for (const [pid, models] of Object.entries(modelsByProvider)) {
      const provider = provMap.get(pid)
      for (const m of models) {
        const upstream = resolveUpstream(m, provider)
        results.push({
          providerId:       pid,
          providerName:     provider?.name ?? pid,
          modelId:          m.id,
          modelName:        m.name,
          upstream,
          supportStreaming:  true,
          supportTools:      m.tool_call,
          supportVision:     m.modalities?.input?.includes("image") ?? m.attachment,
          supportReasoning:  m.reasoning,
          defaultMaxTokens:  Math.min(m.limit.output, 65536) || 4096,
          contextLength:     m.limit.context,
          autoCompactLength: Math.floor(m.limit.context * 0.9),
          status:            m.status,
        })
      }
    }

    return results
  })
}

export function getFlatModelsForProvider(providerId: string): ResultAsync<FlatModelTemplate[], AppError> {
  return fetchModelsDev().map(({ providers, modelsByProvider }) => {
    const provider = providers.find(p => p.id === providerId)
    const models = modelsByProvider[providerId] ?? []
    return models.map((m: ModelTemplate) => ({
      providerId:       providerId,
      providerName:     provider?.name ?? providerId,
      modelId:          m.id,
      modelName:        m.name,
      upstream:         resolveUpstream(m, provider),
      supportStreaming:  true,
      supportTools:      m.tool_call,
      supportVision:     m.modalities?.input?.includes("image") ?? m.attachment,
      supportReasoning:  m.reasoning,
      defaultMaxTokens:  Math.min(m.limit.output, 65536) || 4096,
      contextLength:     m.limit.context,
      autoCompactLength: Math.floor(m.limit.context * 0.9),
      status:            m.status,
    }))
  })
}

export function resetCache(): void {
  cache = null
}

// ── 内部工具 ─────────────────────────────────────────────────────────────────

function resolveUpstream(
  m: ModelTemplate,
  provider?: ProviderTemplate,
): string {
  if (m.provider?.api) return m.provider.api
  if (provider?.api)   return provider.api
  return ""
}

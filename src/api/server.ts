import { ConnectRouter } from "@connectrpc/connect"
import { AiProxyService } from "@openzerg/common/gen/ai_proxy/v1_pb.js"
import type { GelClient } from "@openzerg/common/gel"
import { gelQuery } from "@openzerg/common/gel"
import {
  getProviderModelConfigForTest,
  getProxyForTest,
} from "@openzerg/common/queries"
import { createProxyService, type ProxyJoined, type ProxyCreateInput, type ProxyUpdateInput } from "../service/proxy.js"
import { createProviderModelConfigService, type ProviderModelConfigCreateInput, type ProviderModelConfigUpdateInput } from "../service/provider-model-config.js"
import { createLogsService, type LogEntry } from "../service/logs.js"
import { getProviders, getFlatModelsForProvider } from "../providers.js"

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

function logToEntry(log: LogEntry) {
  return {
    id:                log.id,
    proxyId:           log.proxyId,
    sourceModel:       log.sourceModel,
    targetModel:       log.targetModel,
    upstream:          log.upstream,
    inputTokens:       BigInt(log.inputTokens),
    outputTokens:      BigInt(log.outputTokens),
    totalTokens:       BigInt(log.totalTokens),
    durationMs:        BigInt(log.durationMs),
    timeToFirstTokenMs:BigInt(log.timeToFirstTokenMs),
    isStream:          log.isStream,
    isSuccess:         log.isSuccess,
    errorMessage:      log.errorMessage,
    createdAt:         BigInt(log.createdAt),
  }
}

export function createRouter(gel: GelClient) {
  const proxySvc  = createProxyService(gel)
  const configSvc = createProviderModelConfigService(gel)
  const logsSvc   = createLogsService(gel)

  return (router: ConnectRouter) => {
    router.service(AiProxyService, {

      async listProxies(req) {
        const result = await proxySvc.list(req.enabledOnly)
        if (result.isErr()) throw result.error
        return { proxies: result.value.map(toProxyInfo) }
      },

      async getProxy(req) {
        const result = await proxySvc.get(req.id)
        if (result.isErr()) throw result.error
        return toProxyInfo(result.value)
      },

      async createProxy(req) {
        const created = await proxySvc.create({
          sourceModel: req.sourceModel,
          providerModelConfigId: req.providerModelConfigId,
          apiKey: "",
          enabled: true,
        })
        if (created.isErr()) throw created.error
        return toProxyInfo(created.value)
      },

      async updateProxy(req) {
        const result = await proxySvc.update({
          id: req.id,
          sourceModel: req.sourceModel,
          providerModelConfigId: req.providerModelConfigId,
          enabled: req.enabled,
        })
        if (result.isErr()) throw result.error
        return toProxyInfo(result.value)
      },

      async deleteProxy(req) {
        const result = await proxySvc.delete(req.id)
        if (result.isErr()) throw result.error
        return {}
      },

      async listProviderModelConfigs(req) {
        const result = await configSvc.list(req.enabledOnly)
        if (result.isErr()) throw result.error
        return { configs: result.value.map(toConfigInfo) }
      },

      async getProviderModelConfig(req) {
        const result = await configSvc.get(req.id)
        if (result.isErr()) throw result.error
        return toConfigInfo(result.value)
      },

      async createProviderModelConfig(req) {
        const result = await configSvc.create({
          providerId:        req.providerId,
          providerName:      req.providerName,
          modelId:           req.modelId,
          modelName:         req.modelName,
          upstream:          req.upstream,
          apiKey:            req.apiKey,
          supportStreaming:  req.supportStreaming,
          supportTools:      req.supportTools,
          supportVision:     req.supportVision,
          supportReasoning:  req.supportReasoning,
          defaultMaxTokens:  req.defaultMaxTokens,
          contextLength:     req.contextLength,
          autoCompactLength: req.autoCompactLength,
          enabled:           true,
        })
        if (result.isErr()) throw result.error
        return toConfigInfo(result.value)
      },

      async updateProviderModelConfig(req) {
        const result = await configSvc.update({
          id:                req.id,
          providerName:      req.providerName,
          modelName:         req.modelName,
          upstream:          req.upstream,
          apiKey:            req.apiKey,
          supportStreaming:  req.supportStreaming,
          supportTools:      req.supportTools,
          supportVision:     req.supportVision,
          supportReasoning:  req.supportReasoning,
          defaultMaxTokens:  req.defaultMaxTokens,
          contextLength:     req.contextLength,
          autoCompactLength: req.autoCompactLength,
          enabled:           req.enabled,
        })
        if (result.isErr()) throw result.error
        return toConfigInfo(result.value)
      },

      async deleteProviderModelConfig(req) {
        const result = await configSvc.delete(req.id)
        if (result.isErr()) throw result.error
        return {}
      },

      async listProviders() {
        const result = await getProviders()
        if (result.isErr()) throw result.error
        return { providers: result.value.map(p => ({ id: p.id, name: p.name, api: p.api ?? "", doc: p.doc, env: p.env })) }
      },

      async listProviderModels(req) {
        const result = await getFlatModelsForProvider(req.providerId)
        if (result.isErr()) throw result.error
        return { models: result.value }
      },

      async queryLogs(req) {
        const result = await logsSvc.query({
          proxyId: req.proxyId || undefined,
          fromTs:  req.fromTs  ? Number(req.fromTs)  : undefined,
          toTs:    req.toTs    ? Number(req.toTs)    : undefined,
          limit:   req.limit   || 50,
          offset:  req.offset  || 0,
        })
        if (result.isErr()) throw result.error
        return {
          logs:  result.value.entries.map(logToEntry),
          total: BigInt(result.value.total),
        }
      },

      async getTokenStats(req) {
        const result = await logsSvc.tokenStats(
          req.proxyId || undefined,
          req.fromTs ? Number(req.fromTs) : undefined,
          req.toTs   ? Number(req.toTs)   : undefined,
        )
        if (result.isErr()) throw result.error
        return {
          totalInputTokens:  BigInt(result.value.totalInputTokens),
          totalOutputTokens: BigInt(result.value.totalOutputTokens),
          totalTokens:       BigInt(result.value.totalTokens),
          requestCount:      BigInt(result.value.requestCount),
        }
      },

      async testProviderModelConfig(req) {
        const result = await gelQuery(() =>
          getProviderModelConfigForTest(gel, { id: req.id })
        )
        if (result.isErr()) return { success: false, message: result.error.message, statusCode: 500, latencyMs: 0 }
        const row = result.value
        if (!row) return { success: false, message: "Config not found", statusCode: 404, latencyMs: 0 }
        if (!row.upstream) return { success: false, message: "No upstream URL", statusCode: 0, latencyMs: 0 }
        if (!row.apiKey) return { success: false, message: "No API key", statusCode: 0, latencyMs: 0 }

        const start = Date.now()
        try {
          const resp = await fetch(`${row.upstream}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${row.apiKey}` },
            body: JSON.stringify({
              model: row.modelId,
              messages: [{ role: "user", content: "Say Hello World" }],
              max_tokens: 32,
            }),
          })
          const json = await resp.json() as OpenAIChatResponse
          const latencyMs = Date.now() - start
          if (resp.ok && json.choices?.[0]?.message?.content) {
            return { success: true, message: json.choices[0].message.content, statusCode: resp.status, latencyMs }
          }
          return { success: false, message: json.error?.message || JSON.stringify(json).slice(0, 200), statusCode: resp.status, latencyMs }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          return { success: false, message: msg, statusCode: 0, latencyMs: Date.now() - start }
        }
      },

      async testProxy(req) {
        const result = await gelQuery(() =>
          getProxyForTest(gel, { id: req.id })
        )
        if (result.isErr()) return { success: false, message: result.error.message, statusCode: 500, latencyMs: 0 }
        const row = result.value
        if (!row) return { success: false, message: "Proxy not found", statusCode: 404, latencyMs: 0 }
        if (!row.enabled) return { success: false, message: "Proxy is disabled", statusCode: 0, latencyMs: 0 }
        if (!row.providerModelConfig.upstream) return { success: false, message: "No upstream URL", statusCode: 0, latencyMs: 0 }

        const apiKey = row.providerModelConfig.apiKey
        const start = Date.now()
        try {
          const resp = await fetch(`${row.providerModelConfig.upstream}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: row.providerModelConfig.modelId,
              messages: [{ role: "user", content: "Say Hello World" }],
              max_tokens: 32,
            }),
          })
          const json = await resp.json() as OpenAIChatResponse
          const latencyMs = Date.now() - start
          if (resp.ok && json.choices?.[0]?.message?.content) {
            return { success: true, message: json.choices[0].message.content, statusCode: resp.status, latencyMs }
          }
          return { success: false, message: json.error?.message || JSON.stringify(json).slice(0, 200), statusCode: resp.status, latencyMs }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          return { success: false, message: msg, statusCode: 0, latencyMs: Date.now() - start }
        }
      },
    })
  }
}

function toProxyInfo(p: ProxyJoined) {
  return {
    id:                     p.id,
    sourceModel:            p.sourceModel,
    providerModelConfigId:  p.providerModelConfigId,
    apiKey:                 p.apiKey,
    enabled:                p.enabled,
    createdAt:              BigInt(p.createdAt),
    updatedAt:              BigInt(p.updatedAt),
    providerId:             p.providerId,
    providerName:           p.providerName,
    modelId:                p.modelId,
    modelName:              p.modelName,
    upstream:               p.upstream,
    targetModel:            p.targetModel,
    supportStreaming:       p.supportStreaming,
    supportTools:           p.supportTools,
    supportVision:          p.supportVision,
    supportReasoning:       p.supportReasoning,
    defaultMaxTokens:       p.defaultMaxTokens,
    contextLength:          p.contextLength,
    autoCompactLength:      p.autoCompactLength,
  }
}

function toConfigInfo(c: { id: string; providerId: string; providerName: string; modelId: string; modelName: string; upstream: string; apiKey: string; supportStreaming: boolean; supportTools: boolean; supportVision: boolean; supportReasoning: boolean; defaultMaxTokens: number; contextLength: number; autoCompactLength: number; enabled: boolean; createdAt: number; updatedAt: number }) {
  return {
    id:                c.id,
    providerId:        c.providerId,
    providerName:      c.providerName,
    modelId:           c.modelId,
    modelName:         c.modelName,
    upstream:          c.upstream,
    apiKey:            c.apiKey,
    supportStreaming:  c.supportStreaming,
    supportTools:      c.supportTools,
    supportVision:     c.supportVision,
    supportReasoning:  c.supportReasoning,
    defaultMaxTokens:  c.defaultMaxTokens,
    contextLength:     c.contextLength,
    autoCompactLength: c.autoCompactLength,
    enabled:           c.enabled,
    createdAt:         BigInt(c.createdAt),
    updatedAt:         BigInt(c.updatedAt),
  }
}

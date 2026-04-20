import { ConnectRouter } from "@connectrpc/connect"
import { AiProxyService } from "@openzerg/common/gen/ai_proxy/v1_pb.js"
import type { DB } from "../db/index.js"
import { createProxyService, type ProxyJoined } from "../service/proxy.js"
import { createProviderModelConfigService } from "../service/provider-model-config.js"
import { createLogsService } from "../service/logs.js"
import { getProviders, getFlatModelsForProvider } from "../providers.js"
import type { ProviderModelConfig } from "../entities/index.js"

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

export function createRouter(db: DB) {
  const proxySvc  = createProxyService(db)
  const configSvc = createProviderModelConfigService(db)
  const logsSvc   = createLogsService(db)

  return (router: ConnectRouter) => {
    router.service(AiProxyService, {

      // ── Proxy ────────────────────────────────────────────────────────────

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
        const joined = await proxySvc.get(created.value.id)
        if (joined.isErr()) throw joined.error
        return toProxyInfo(joined.value)
      },

      async updateProxy(req) {
        const result = await proxySvc.update({
          id: req.id,
          sourceModel: req.sourceModel,
          providerModelConfigId: req.providerModelConfigId,
          enabled: req.enabled,
        })
        if (result.isErr()) throw result.error
        const joined = await proxySvc.get(result.value.id)
        if (joined.isErr()) throw joined.error
        return toProxyInfo(joined.value)
      },

      async deleteProxy(req) {
        const result = await proxySvc.delete(req.id)
        if (result.isErr()) throw result.error
        return {}
      },

      // ── ProviderModelConfig ───────────────────────────────────────────────

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

      // ── Provider templates (from models.dev) ──────────────────────────────

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

      // ── Logs & Stats ─────────────────────────────────────────────────────

      async queryLogs(req) {
        const result = await logsSvc.query({
          proxyId: req.proxyId || undefined,
          fromTs:  req.fromTs  ? BigInt(req.fromTs)  : undefined,
          toTs:    req.toTs    ? BigInt(req.toTs)    : undefined,
          limit:   req.limit   || 50,
          offset:  req.offset  || 0,
        })
        if (result.isErr()) throw result.error
        return {
          logs:  result.value.entries,
          total: BigInt(result.value.total),
        }
      },

      async getTokenStats(req) {
        const result = await logsSvc.tokenStats(
          req.proxyId || undefined,
          req.fromTs ? BigInt(req.fromTs) : undefined,
          req.toTs   ? BigInt(req.toTs)   : undefined,
        )
        if (result.isErr()) throw result.error
        return result.value
      },

      // ── Test ──────────────────────────────────────────────────────────────

      async testProviderModelConfig(req) {
        const row = await db.selectFrom("ai_proxy_provider_model_configs")
          .selectAll().where("id", "=", req.id).executeTakeFirst()
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
        const row = await db.selectFrom("ai_proxy_proxies")
          .innerJoin("ai_proxy_provider_model_configs", "ai_proxy_proxies.providerModelConfigId", "ai_proxy_provider_model_configs.id")
          .select([
            "ai_proxy_proxies.id",
            "ai_proxy_proxies.sourceModel",
            "ai_proxy_proxies.apiKey as proxyApiKey",
            "ai_proxy_proxies.enabled",
            "ai_proxy_provider_model_configs.upstream",
            "ai_proxy_provider_model_configs.modelId",
            "ai_proxy_provider_model_configs.apiKey as upstreamApiKey",
          ])
          .where("ai_proxy_proxies.id", "=", req.id)
          .executeTakeFirst()
        if (!row) return { success: false, message: "Proxy not found", statusCode: 404, latencyMs: 0 }
        if (!row.enabled) return { success: false, message: "Proxy is disabled", statusCode: 0, latencyMs: 0 }
        if (!row.upstream) return { success: false, message: "No upstream URL", statusCode: 0, latencyMs: 0 }

        const apiKey = row.upstreamApiKey
        const start = Date.now()
        try {
          const resp = await fetch(`${row.upstream}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
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

function toConfigInfo(c: ProviderModelConfig) {
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

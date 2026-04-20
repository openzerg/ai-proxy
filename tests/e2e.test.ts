import { describe, test, beforeAll, afterAll, expect } from "bun:test"
import { createServer } from "node:http"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import { AiProxyClient } from "@openzerg/common"
import { openDB, autoMigrate } from "../src/db/index.js"
import { createRouter } from "../src/api/server.js"

const PG_PORT = 15439
const PG_URL = `postgres://e2e:e2e@127.0.0.1:${PG_PORT}/e2e_ai_proxy`
const SERVICE_PORT = 25085

let client: AiProxyClient
let server: ReturnType<typeof createServer>
let db: Awaited<ReturnType<typeof openDB>>

beforeAll(async () => {
  const { execSync } = await import("node:child_process")
  try { execSync(`podman rm -f e2e-ai-proxy-pg`, { stdio: "pipe" }) } catch {}
  execSync(
    `podman run -d --name e2e-ai-proxy-pg -p ${PG_PORT}:5432 ` +
    `-e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e_ai_proxy ` +
    `docker.io/library/postgres:17-alpine`,
    { stdio: "pipe" },
  )
  let migrated = false
  for (let i = 0; i < 15; i++) {
    try { await autoMigrate(PG_URL); migrated = true; break } catch { await new Promise(r => setTimeout(r, 1000)) }
  }
  if (!migrated) throw new Error("autoMigrate failed")

  db = openDB(PG_URL)
  const handler = connectNodeAdapter({ routes: createRouter(db) })
  server = createServer(handler)
  await new Promise<void>(r => server.listen(SERVICE_PORT, () => r()))
  client = new AiProxyClient({ baseURL: `http://localhost:${SERVICE_PORT}` })
}, 30_000)

afterAll(async () => {
  server?.close()
  db?.destroy()
  const { execSync } = await import("node:child_process")
  try { execSync(`podman rm -f e2e-ai-proxy-pg`, { stdio: "pipe" }) } catch {}
}, 15_000)

describe("AI Proxy E2E", () => {
  test("listProviders returns providers", async () => {
    const result = await client.listProviders()
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.providers.length).toBeGreaterThan(0)
  })

  test("createProviderModelConfig + get + list + update + delete", async () => {
    const created = await client.createProviderModelConfig({
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-4o",
      modelName: "GPT-4o",
      upstream: "https://api.openai.com/v1",
      apiKey: "sk-test-key",
      supportStreaming: true,
      supportTools: true,
      supportVision: true,
      supportReasoning: false,
      defaultMaxTokens: 4096,
      contextLength: 128000,
      autoCompactLength: 0,
    })
    expect(created.isOk()).toBe(true)
    if (!created.isOk()) return
    const configId = created.value.id
    expect(configId).toBeTruthy()
    expect(created.value.modelId).toBe("gpt-4o")

    const got = await client.getProviderModelConfig(configId)
    expect(got.isOk()).toBe(true)
    if (!got.isOk()) return
    expect(got.value.modelName).toBe("GPT-4o")

    const listed = await client.listProviderModelConfigs()
    expect(listed.isOk()).toBe(true)
    if (!listed.isOk()) return
    expect(listed.value.configs.length).toBeGreaterThanOrEqual(1)

    const updated = await client.updateProviderModelConfig({
      id: configId,
      modelName: "GPT-4o Updated",
      upstream: "https://api.openai.com/v1",
      apiKey: "sk-test-key",
      supportStreaming: true,
      supportTools: true,
      supportVision: false,
      supportReasoning: false,
      defaultMaxTokens: 8192,
      contextLength: 128000,
      autoCompactLength: 0,
      enabled: true,
    })
    expect(updated.isOk()).toBe(true)
    if (!updated.isOk()) return
    expect(updated.value.modelName).toBe("GPT-4o Updated")

    const del = await client.deleteProviderModelConfig(configId)
    expect(del.isOk()).toBe(true)
  })

  test("createProxy + get + list + update + delete", async () => {
    const config = await client.createProviderModelConfig({
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-3.5-sonnet",
      modelName: "Claude 3.5 Sonnet",
      upstream: "https://api.anthropic.com/v1",
      apiKey: "sk-ant-test",
      supportStreaming: true,
      supportTools: true,
      supportVision: true,
      supportReasoning: true,
      defaultMaxTokens: 4096,
      contextLength: 200000,
      autoCompactLength: 0,
    })
    expect(config.isOk()).toBe(true)
    if (!config.isOk()) return
    const configId = config.value.id

    const created = await client.createProxy("my-claude", configId)
    expect(created.isOk()).toBe(true)
    if (!created.isOk()) return
    const proxyId = created.value.id
    expect(proxyId).toBeTruthy()
    expect(created.value.sourceModel).toBe("my-claude")
    expect(created.value.apiKey).toBeTruthy()

    const got = await client.getProxy(proxyId)
    expect(got.isOk()).toBe(true)
    if (!got.isOk()) return
    expect(got.value.targetModel).toBe("claude-3.5-sonnet")

    const listed = await client.listProxies()
    expect(listed.isOk()).toBe(true)
    if (!listed.isOk()) return
    expect(listed.value.proxies.length).toBeGreaterThanOrEqual(1)

    const listedEnabled = await client.listProxies(true)
    expect(listedEnabled.isOk()).toBe(true)
    if (!listedEnabled.isOk()) return
    expect(listedEnabled.value.proxies.length).toBeGreaterThanOrEqual(1)

    const updated = await client.updateProxy({
      id: proxyId,
      sourceModel: "my-claude-v2",
      providerModelConfigId: configId,
      enabled: false,
    })
    expect(updated.isOk()).toBe(true)
    if (!updated.isOk()) return
    expect(updated.value.sourceModel).toBe("my-claude-v2")
    expect(updated.value.enabled).toBe(false)

    const del = await client.deleteProxy(proxyId)
    expect(del.isOk()).toBe(true)

    await client.deleteProviderModelConfig(configId)
  })

  test("queryLogs and getTokenStats on empty data", async () => {
    const logs = await client.queryLogs({ limit: 10, offset: 0 })
    expect(logs.isOk()).toBe(true)
    if (!logs.isOk()) return
    expect(logs.value.logs.length).toBe(0)

    const stats = await client.getTokenStats({})
    expect(stats.isOk()).toBe(true)
    if (!stats.isOk()) return
    expect(stats.value.totalInputTokens).toBe(0n)
    expect(stats.value.totalOutputTokens).toBe(0n)
  })

  test("listProviderModels returns models for known provider", async () => {
    const result = await client.listProviderModels("openai")
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.models.length).toBeGreaterThan(0)
  })

  test("testProviderModelConfig returns not found for missing id", async () => {
    const result = await client.testProviderModelConfig("nonexistent-id")
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.success).toBe(false)
    expect(result.value.statusCode).toBe(404)
  })

  test("testProxy returns not found for missing id", async () => {
    const result = await client.testProxy("nonexistent-id")
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.success).toBe(false)
    expect(result.value.statusCode).toBe(404)
  })
})

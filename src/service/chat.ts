import { ResultAsync, okAsync, errAsync } from "neverthrow"
import { gelQuery } from "@openzerg/common/gel"
import type { GelClient } from "@openzerg/common/gel"
import { getProxyBySourceModel } from "@openzerg/common/queries"
import { createLogsService, type LogInsertInput } from "./logs.js"
import type { ProxyJoined } from "./proxy.js"
import {
  UnauthenticatedError, NotFoundError, UpstreamError,
  type AppError,
} from "../errors.js"
import { nowSec } from "./util.js"

type ChatError =
  | UnauthenticatedError
  | NotFoundError
  | UpstreamError

interface BodyWithModel {
  model: string
  stream?: boolean
  [key: string]: unknown
}

function parseBody(req: Request): ResultAsync<BodyWithModel, AppError> {
  return ResultAsync.fromPromise(
    req.json() as Promise<BodyWithModel>,
    () => new UnauthenticatedError("invalid json body"),
  ).andThen(body =>
    typeof body?.model === "string"
      ? okAsync(body)
      : errAsync(new UnauthenticatedError("missing required field: model"))
  )
}

function extractBearerToken(req: Request): string {
  const header = req.headers.get("Authorization") ?? ""
  return header.startsWith("Bearer ") ? header.slice(7).trim() : ""
}

export function createChatService(gel: GelClient) {
  const logsSvc = createLogsService(gel)

  return {
    async openaiPassthrough(req: Request): Promise<Response> {
      return runPipeline(req, gel, logsSvc).catch(
        e => new Response(
          JSON.stringify({ error: { message: String(e), type: "server_error" } }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        )
      )
    },
  }
}

function rowToProxyJoined(row: NonNullable<Awaited<ReturnType<typeof getProxyBySourceModel>>>): ProxyJoined {
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

async function runPipeline(
  req:     Request,
  gel:     GelClient,
  logsSvc: ReturnType<typeof createLogsService>,
): Promise<Response> {
  const result = await parseBody(req)
    .andThen(body => {
      const token = extractBearerToken(req)
      if (!token) return errAsync(new UnauthenticatedError("missing Authorization header"))
      return okAsync({ body, token })
    })
    .andThen(({ body, token }) =>
      gelQuery(() =>
        getProxyBySourceModel(gel, { sourceModel: body.model })
      ).andThen(row => {
        if (!row) return errAsync(new NotFoundError(`no proxy for model: ${body.model}`))
        const proxy = rowToProxyJoined(row)
        if (proxy.apiKey !== token)
          return errAsync(new UnauthenticatedError("invalid API key"))
        const upstreamApiKey = row.providerModelConfig.apiKey
        return okAsync({ body, proxy, upstreamApiKey })
      })
    )
    .andThen(({ body, proxy, upstreamApiKey }) =>
      ResultAsync.fromPromise(
        fetch(`${proxy.upstream}/chat/completions`, {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${upstreamApiKey}`,
          },
          body: JSON.stringify({ ...body, model: proxy.targetModel }),
        }),
        e => new UpstreamError(String(e), proxy.upstream),
      ).map(resp => ({ body, proxy, resp }))
    )

  if (result.isErr()) {
    const e = result.error
    const status =
      e instanceof UnauthenticatedError ? 401 :
      e instanceof NotFoundError          ? 404 :
      e instanceof UpstreamError          ? 502 : 500
    return new Response(
      JSON.stringify({ error: { message: e.message, code: e.code } }),
      { status, headers: { "Content-Type": "application/json" } },
    )
  }

  const { body, proxy, resp } = result.value
  const isStream   = !!body.stream
  const durationMs = Date.now()

  if (isStream) {
    const [forLog, forClient] = resp.body!.tee()
    void logStream(forLog, { logsSvc, proxy, isStream: true, durationMs })
    return new Response(forClient, {
      status:  resp.status,
      headers: {
        "Content-Type":      "text/event-stream",
        "Cache-Control":     "no-cache",
        "Transfer-Encoding": "chunked",
      },
    })
  }

  const json = await resp.json() as { usage?: { prompt_tokens: number; completion_tokens: number } }
  const inputTokens  = json.usage?.prompt_tokens     ?? 0
  const outputTokens = json.usage?.completion_tokens ?? 0
  void logsSvc.insert({
    proxyId:            proxy.id,
    sourceModel:        proxy.sourceModel,
    targetModel:        proxy.targetModel,
    upstream:           proxy.upstream,
    inputTokens,
    outputTokens,
    totalTokens:        inputTokens + outputTokens,
    durationMs:         Date.now() - durationMs,
    timeToFirstTokenMs: 0,
    isStream:           false,
    isSuccess:          resp.ok,
    errorMessage:       resp.ok ? "" : "upstream error",
    createdAt:          nowSec(),
  })

  return new Response(JSON.stringify(json), {
    status:  resp.status,
    headers: { "Content-Type": "application/json" },
  })
}

async function logStream(
  stream: ReadableStream,
  opts: {
    logsSvc:     ReturnType<typeof createLogsService>
    proxy:       { id: string; sourceModel: string; targetModel: string; upstream: string }
    isStream:    boolean
    durationMs:  number
  }
) {
  const reader  = stream.getReader()
  const decoder = new TextDecoder()
  let buf          = ""
  let inputTokens  = 0
  let outputTokens = 0

  const drain = async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const raw = line.slice(6).trim()
        if (raw === "[DONE]") continue
        const chunk = JSON.parse(raw) as { usage?: { prompt_tokens: number; completion_tokens: number } }
        if (chunk.usage) {
          inputTokens  = chunk.usage.prompt_tokens
          outputTokens = chunk.usage.completion_tokens
        }
      }
    }
  }

  await ResultAsync.fromPromise(drain(), () => null)

  await opts.logsSvc.insert({
    proxyId:            opts.proxy.id,
    sourceModel:        opts.proxy.sourceModel,
    targetModel:        opts.proxy.targetModel,
    upstream:           opts.proxy.upstream,
    inputTokens,
    outputTokens,
    totalTokens:        inputTokens + outputTokens,
    durationMs:         Date.now() - opts.durationMs,
    timeToFirstTokenMs: 0,
    isStream:           true,
    isSuccess:          true,
    errorMessage:       "",
    createdAt:          nowSec(),
  })
}

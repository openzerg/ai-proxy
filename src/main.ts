import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import { loadConfig } from "./config.js"
import { openDB, autoMigrate } from "./db/index.js"
import { createRouter } from "./api/server.js"
import { createChatService } from "./service/chat.js"

const cfg = loadConfig()
const db  = openDB(cfg.databaseURL)

async function main() {
  await autoMigrate(cfg.databaseURL)
  console.log("[ai-proxy] database ready")

  const router = createRouter(db)
  const chatSvc = createChatService(db)
  const connectHandler = connectNodeAdapter({ routes: router })

  function setCORSHeaders(res: ServerResponse, origin: string) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Connect-Protocol-Version, Connect-Timeout-Ms, Grpc-Timeout, X-Grpc-Web, X-User-Agent")
    res.setHeader("Access-Control-Allow-Credentials", "true")
    res.setHeader("Access-Control-Expose-Headers", "Grpc-Status, Grpc-Message, Connect-Protocol-Version")
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/"
    const origin = req.headers.origin ?? "*"

    if (req.method === "OPTIONS") {
      setCORSHeaders(res, origin)
      res.writeHead(204)
      res.end()
      return
    }

    setCORSHeaders(res, origin)

    if (url === "/v1/chat/completions" && req.method === "POST") {
      const chunks: Buffer[] = []
      req.on("data", (c: Buffer) => chunks.push(c))
      req.on("end", async () => {
        const bunReq = new Request(`http://ai-proxy${url}`, {
          method: "POST",
          headers: Object.fromEntries(
            Object.entries(req.headers)
              .filter(([, v]) => v != null)
              .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v as string])
          ),
          body: Buffer.concat(chunks),
        })
        const response = await chatSvc.openaiPassthrough(bunReq)
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
        if (response.body) {
          const reader = response.body.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            res.write(value)
          }
        }
        res.end()
      })
      return
    }

    connectHandler(req, res)
  })

  server.listen(cfg.port, cfg.host, () => {
    console.log(`[ai-proxy] listening on ${cfg.host}:${cfg.port}`)
    console.log(`[ai-proxy] OpenAI-compatible endpoint: http://${cfg.host}:${cfg.port}/v1`)
  })

  process.on("SIGINT",  () => { server.close(); process.exit(0) })
  process.on("SIGTERM", () => { server.close(); process.exit(0) })

  if (cfg.registryURL && cfg.adminToken) {
    let instanceId: string | null = null
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null

    const doRegister = async () => {
      const loginResp = await fetch(
        `${cfg.registryURL}/registry.v1.RegistryService/Login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: cfg.adminToken }),
        }
      )
      if (!loginResp.ok) throw new Error(`registry login failed: ${loginResp.status}`)
      const { userToken } = await loginResp.json() as { userToken: string }

      const publicURL = cfg.publicURL || `http://${cfg.hostIP}:${cfg.port}`
      const regResp = await fetch(
        `${cfg.registryURL}/registry.v1.RegistryService/Register`,
        {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${userToken}`,
          },
          body: JSON.stringify({
            name:         "ai-proxy",
            instanceType: "ai-proxy",
            ip:           cfg.hostIP,
            port:         cfg.port,
            publicUrl:    publicURL,
          }),
        }
      )
      if (!regResp.ok) throw new Error(`registry register failed: ${regResp.status}`)
      const { instanceId: id, serviceToken } = await regResp.json() as { instanceId: string; serviceToken: string }
      instanceId = id
      console.log(`[ai-proxy] registered with registry (${instanceId})`)
      return serviceToken
    }

    const startHeartbeat = (serviceToken: string) => {
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      heartbeatTimer = setInterval(async () => {
        if (!instanceId) return
        try {
          const resp = await fetch(
            `${cfg.registryURL}/registry.v1.RegistryService/Heartbeat`,
            {
              method: "POST",
              headers: {
                "Content-Type":  "application/json",
                "Authorization": `Bearer ${serviceToken}`,
              },
              body: JSON.stringify({ instanceId }),
            }
          )
          if (!resp.ok) throw new Error(`heartbeat ${resp.status}`)
        } catch (e) {
          console.error("[ai-proxy] heartbeat failed, re-registering:", e)
          clearInterval(heartbeatTimer!)
          heartbeatTimer = null
          try {
            const token = await doRegister()
            startHeartbeat(token)
          } catch (err) {
            console.error("[ai-proxy] re-register failed:", err)
          }
        }
      }, 30_000)
    }

    doRegister()
      .then(token => startHeartbeat(token))
      .catch(e => {
        console.error("[ai-proxy] initial registry register failed:", e)
        const retryInterval = setInterval(async () => {
          try {
            const token = await doRegister()
            startHeartbeat(token)
            clearInterval(retryInterval)
          } catch {
            console.error("[ai-proxy] registry register retry failed")
          }
        }, 10_000)
      })
  }
}

main().catch(e => {
  console.error("[ai-proxy] fatal:", e)
  process.exit(1)
})

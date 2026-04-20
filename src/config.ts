export interface Config {
  host:         string
  port:         number
  publicURL:    string
  databaseURL:  string
  registryURL: string
  adminToken:   string
  hostIP:       string
}

export function loadConfig(): Config {
  const databaseURL = process.env.DATABASE_URL
  if (!databaseURL) throw new Error("DATABASE_URL is required")
  return {
    host:         process.env.AI_PROXY_HOST      ?? "0.0.0.0",
    port:         parseInt(process.env.AI_PROXY_PORT ?? "15316"),
    publicURL:    process.env.AI_PROXY_PUBLIC_URL ?? "",
    databaseURL,
    registryURL:  process.env.REGISTRY_URL        ?? "",
    adminToken:   process.env.ADMIN_TOKEN          ?? "",
    hostIP:       process.env.HOST_IP              ?? "127.0.0.1",
  }
}

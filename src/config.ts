export interface Config {
  host:         string
  port:         number
  publicURL:    string
  gelDSN:       string
  registryURL: string
  adminToken:   string
  hostIP:       string
}

export function loadConfig(): Config {
  return {
    host:         process.env.AI_PROXY_HOST      ?? "0.0.0.0",
    port:         parseInt(process.env.AI_PROXY_PORT ?? "15316"),
    publicURL:    process.env.AI_PROXY_PUBLIC_URL ?? "",
    gelDSN:       process.env.GEL_DSN ?? "gel://admin@uz-gel/main?tls_security=insecure",
    registryURL:  process.env.REGISTRY_URL        ?? "",
    adminToken:   process.env.ADMIN_TOKEN          ?? "",
    hostIP:       process.env.HOST_IP              ?? "127.0.0.1",
  }
}

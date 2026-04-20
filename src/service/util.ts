import { randomBytes } from "node:crypto"

export function randomId(): string {
  return randomBytes(8).toString("hex")
}

export function generateApiKey(): string {
  return "cpk_" + randomBytes(24).toString("base64url")
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

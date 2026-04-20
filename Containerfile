FROM oven/bun:alpine AS builder
RUN apk add --no-cache git
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install
COPY src/ src/
COPY tsconfig.json ./
RUN bun build --compile src/main.ts --outfile ai-proxy
FROM alpine:latest
RUN apk add --no-cache ca-certificates libstdc++
WORKDIR /app
COPY --from=builder /app/ai-proxy /app/ai-proxy
RUN chmod +x /app/ai-proxy
EXPOSE 25300
ENTRYPOINT ["/app/ai-proxy"]

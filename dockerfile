FROM oven/bun:1-alpine

ENV NODE_ENV=production
ENV PORT=3000

# Install openssl for Prisma compatibility in Alpine
USER root
RUN apk add --no-cache openssl

WORKDIR /app

# Ensure correct permissions for the bun user
RUN chown -R bun:bun /app

USER bun

# Copy package files and install dependencies
COPY --chown=bun:bun package.json package-lock.json* bun.lock* ./
RUN bun install

# Copy the rest of the application code
COPY --chown=bun:bun . .

# Run build scripts (Prisma generate, Next build, and custom server build)
RUN DATABASE_URL=mysql://user:pass@localhost:3306/dummy bun run build

# Expose the application port
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthcheck >/dev/null 2>&1 || exit 1

# Run the application using bun
CMD ["bun", "run", "start:bun"]

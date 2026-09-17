# Optional Container host for the Node engine + Chromium.
# Spike this before relying on it. Fallback is Worker recorded-replay.
FROM mcr.microsoft.com/playwright:v1.55.0-jammy
WORKDIR /app
COPY . .
RUN npm i -g pnpm@10.15.0 && pnpm install --frozen-lockfile
ENV BANK_PORT=4177
EXPOSE 4177 8787
CMD ["pnpm", "serve", "--", "--port", "8787"]

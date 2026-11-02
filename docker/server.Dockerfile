# A clean Linux test bench for the server. Not how schools install the app (they use the Windows installer).
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY contracts/package.json contracts/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --filter @ict/server... --filter @ict/contracts
COPY contracts contracts
COPY server server
WORKDIR /app/server
ENV ICT_DATA_DIR=/data
EXPOSE 7700
CMD ["pnpm", "start"]

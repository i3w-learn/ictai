# The test server plus llama.cpp's Linux llama-server, so the AI can be tested offline too.
# Built on the llama.cpp image (it needs a newer Linux than node:22-slim), with Node and the server copied in.
# The model is not baked in: mount a folder with manifest.json + the .gguf at /ai.
FROM ict-server-test AS server
FROM ghcr.io/ggml-org/llama.cpp:server
COPY --from=server /usr/local /usr/local
COPY --from=server /app /app
WORKDIR /app/server
ENV ICT_DATA_DIR=/data ICT_AI_DIR=/ai ICT_AI_BIN=/app/llama-server LD_LIBRARY_PATH=/app
ENTRYPOINT []
# Start with tsx directly: "pnpm start" makes corepack fetch pnpm, which fails offline.
CMD ["./node_modules/.bin/tsx", "src/main.ts"]

# ICT App shortcuts. Run `just` to see the list.

set dotenv-load := false

# Show all commands
default:
    @just --list

# Install all dependencies
install:
    pnpm install

# Start the school server (dev admin: admin / admin123)
server:
    cd server && ICT_DEV_ADMIN_USER=admin ICT_DEV_ADMIN_PASSWORD=admin123 pnpm dev

# Start the desktop app (Console / Student PC / Board)
app:
    cd apps/client && pnpm tauri dev

# Second app window with its own settings, e.g. a Student PC (run `just app` first)
student profile="student":
    ICT_PROFILE={{profile}} apps/client/src-tauri/target/debug/ict-client

# Run all tests (server + app + Rust)
test:
    pnpm test
    cd apps/client/src-tauri && cargo test

# Live check: app finds the server and pins its certificate (server must be running)
e2e:
    cd apps/client/src-tauri && ICT_E2E=1 cargo test e2e -- --nocapture

# Type-check everything
check:
    pnpm typecheck

# Regenerate contracts/openapi.json
openapi:
    pnpm --filter @ict/contracts openapi

# Build the server bundle (server/dist/server.cjs)
build-server:
    pnpm --filter @ict/server build

# Wipe the dev server's data (database, certificate) for a fresh start
reset-server:
    rm -rf server/.data

# Pretend to be a lab PC and join with the console's code, e.g. `just enrol 549102`
enrol code name="TEST-PC-01":
    @curl -sk -X POST https://127.0.0.1:7700/api/v1/auth/device/enrol \
      -H 'content-type: application/json' \
      -d '{"code":"{{code}}","kind":"lab_pc","name":"{{name}}","appVersion":"0.1.0"}' \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.deviceId?"Joined the lab as {{name}}":"Not joined: "+r.message)})'

# Dev AI: small Gemma (3.1 GB) + llama.cpp from Homebrew, into server/.data/ai (school server uses `ai-install`)
ai-dev:
    mkdir -p server/.data/ai
    test -f server/.data/ai/gemma-4-E2B-it-Q4_K_M.gguf || curl -L -o server/.data/ai/gemma-4-E2B-it-Q4_K_M.gguf https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf
    ln -sf "$(which llama-server)" server/.data/ai/llama-server
    printf '{"name":"Gemma 4 E2B (dev)","file":"gemma-4-E2B-it-Q4_K_M.gguf","sha256":"%s","ctx":8192}\n' "$(shasum -a 256 server/.data/ai/gemma-4-E2B-it-Q4_K_M.gguf | cut -d' ' -f1)" > server/.data/ai/manifest.json
    @echo "AI ready: Gemma 4 E2B (dev)"

# Install the AI kit from a USB folder (manifest.json, the .gguf model, llama-server) and check it
ai-install folder:
    cd server && pnpm exec tsx scripts/ai-install.ts "{{folder}}"

# Time the quiz maker on this PC and write a CSV for a teacher to mark, e.g. `just ai-bench topics.txt hi 10`
ai-bench topics lang="en" count="10":
    cd server && pnpm exec tsx scripts/ai-bench.ts "{{topics}}" {{lang}} {{count}}

# Run the server tests inside a clean Linux container (needs Docker running)
docker-test:
    docker build -f docker/server.Dockerfile -t ict-server-test .
    docker run --rm ict-server-test pnpm test

# Start the server in Docker on a COPY of your dev database, on port 7800. Your real data is not touched.
docker-server:
    docker build -f docker/server.Dockerfile -t ict-server-test .
    rm -rf .docker-data && mkdir .docker-data && sqlite3 server/.data/ict.db ".backup .docker-data/ict.db"
    docker run --rm --name ict-test -p 7800:7700 -v "$PWD/.docker-data:/data" -e ICT_DEV_ADMIN_USER=admin -e ICT_DEV_ADMIN_PASSWORD=admin123 ict-server-test

# Pretend there is no Wi-Fi: tests with no network, then server + a "lab PC" on a network with no internet
docker-offline:
    docker build -f docker/server.Dockerfile -t ict-server-test .
    docker run --rm --network none ict-server-test pnpm test
    docker network create --internal ict-offline 2>/dev/null || true
    rm -rf .docker-data && mkdir .docker-data && sqlite3 server/.data/ict.db ".backup .docker-data/ict.db"
    docker rm -f ict-test 2>/dev/null || true
    docker run -d --name ict-test --network ict-offline -v "$PWD/.docker-data:/data" -e ICT_DEV_ADMIN_USER=admin -e ICT_DEV_ADMIN_PASSWORD=admin123 ict-server-test
    until docker logs ict-test 2>&1 | grep -q ready; do sleep 1; done
    docker run --rm --network ict-offline -v "$PWD/docker:/check:ro" -e NODE_TLS_REJECT_UNAUTHORIZED=0 node:22-slim node --no-warnings /check/offline-check.mjs
    docker rm -f ict-test

# Pretend there is no Wi-Fi and test the AI: server + dev model (run `just ai-dev` once first) + a "teacher PC" asking for a quiz
docker-ai-offline:
    docker build -f docker/server.Dockerfile -t ict-server-test .
    docker build -f docker/server-ai.Dockerfile -t ict-server-ai .
    docker network create --internal ict-offline 2>/dev/null || true
    rm -rf .docker-data && mkdir .docker-data && sqlite3 server/.data/ict.db ".backup .docker-data/ict.db"
    docker rm -f ict-test 2>/dev/null || true
    docker run -d --name ict-test --network ict-offline -v "$PWD/.docker-data:/data" -v "$PWD/server/.data/ai:/ai:ro" -e ICT_DEV_ADMIN_USER=admin -e ICT_DEV_ADMIN_PASSWORD=admin123 ict-server-ai
    until docker logs ict-test 2>&1 | grep -q ready; do sleep 1; done
    docker run --rm --network ict-offline -v "$PWD/docker:/check:ro" -e NODE_TLS_REJECT_UNAUTHORIZED=0 node:22-slim node --no-warnings /check/ai-check.mjs
    docker rm -f ict-test

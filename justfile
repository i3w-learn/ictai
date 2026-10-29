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

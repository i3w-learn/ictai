# ICT App

Offline-first ICT lab platform. Specs and diagrams live in [`docs/`](docs/); `docs/ict-app-final-spec.md` is the source of truth.

## Layout

```
contracts/          Shared API contract (zod). One table of endpoints → server routes, client calls, openapi.json
server/             School server: Node 22 + Fastify + SQLite. HTTPS :7700, UDP finder :7701
  src/core/         Errors, clock, audit, contract-driven route helper
  src/infra/        Database + migrations, TLS, discovery beacon, network, single-instance lock
  src/modules/      One folder per feature: *.repository (SQL) → *.service (rules) → *.routes (HTTP)
  src/container.ts  The only place objects are built and wired
apps/client/        Tauri 2 + React app: Console, Student PC and Board in one codebase
  src/platform/     Interface to native features (Tauri implementation behind it)
  src/core/         Typed API client, server finder, saved settings
  src/features/     Screens: setup (role, find server, enrol), sign-in, home
  src-tauri/        Rust: UDP discovery, pinned HTTPS, settings file
installer/          Inno Setup script + WinSW service definition
.github/workflows/  Windows build: tests, Tauri app, server bundle, installer
docs/               Spec, PRD, PRAXIS notes, system design
```

## Develop on a Mac

Shortcuts live in the `justfile` (`brew install just`). Run `just` to list them.

```bash
just install
just server   # terminal 1: school server (dev admin: admin / admin123)
just app      # terminal 2: the app. First run compiles Rust for a few minutes.
```

Pick **Server PC** to use the console, or **Student PC** / **Smart board** to test enrolment. Use **Reset device** in the top bar to switch roles.

## Test

```bash
just test      # server + app + Rust
just check     # type-check
just e2e       # live check against a running server
just openapi   # regenerate contracts/openapi.json
```

## Windows installer

Every push runs `.github/workflows/windows.yml` on a Windows machine. Download `ICT-Setup` from the run's artifacts.
The installer asks **Server PC / Student PC / Smart board**. For a server it also asks for the first Super Admin, installs the `ICTServer` Windows service and opens TCP 7700 + UDP 7701 on Private networks. Server data lives in `C:\ProgramData\ICT App\server`.

# StarRocks Admin UI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A modern React dashboard for managing StarRocks clusters. Provides multi-environment SQL querying, schema browsing, ingestion management (routine load + batch load), query monitoring, and cluster health overview.

> [!IMPORTANT]
> **This repository is only the front end.** The UI depends on the backend, [starrocks-api](https://github.com/PttemDev/starrocks-api), and does not work without it. Sign-in, queries and every other feature call that API. Start the API first (see the [Quick start](#quick-start)).

## Tech Stack

- **React 19** + **TypeScript 6**
- **Vite 5** (dev server + build)
- **Ant Design 6** (UI components)
- **Monaco Editor** (SQL editor with autocomplete)
- **AG Grid** (query result tables)
- **Recharts** (dashboard charts)
- **Zustand** (state management with persistence)

## Quick Start

You run two things: the backend ([starrocks-api](https://github.com/PttemDev/starrocks-api)) and this UI. Clone both repositories.

**1. Backend** (listens on `127.0.0.1:8081` by default)

```bash
cd starrocks-api
cp config.example.json config.json   # edit with your StarRocks hosts, credentials and tokens
go build -o bin/server .
./bin/server -config config.json
```

**2. UI**

```bash
cd starrocks-admin-ui
npm ci
npm run dev
```

Opens at `http://localhost:5173`. The dev server proxies `/api` requests to the backend at `http://127.0.0.1:8081`. To use another backend address, set `VITE_PROXY_TARGET`:

```bash
VITE_PROXY_TARGET=http://127.0.0.1:9000 npm run dev
```

Sign in with a user from the `login_users` section of the backend's `config.json`. The values in `config.example.json` are placeholders; change them before you expose anything.

## Docker

```bash
# Build
docker build -t starrocks-admin-ui .

# Run, pointing nginx at your backend
docker run -d -p 8080:80 --name starrocks-admin-ui \
  -e API_BACKEND_URL=http://starrocks-api:8081 \
  starrocks-admin-ui
```

The image uses nginx to serve the built SPA and proxy `/api/*` requests to the backend. Set `API_BACKEND_URL` to the address where the container can reach [starrocks-api](https://github.com/PttemDev/starrocks-api). The default is `http://backend:8081`.

The image only serves the static UI. Without a reachable backend, sign-in and all data features will not work.

For more control, mount your own nginx config:

```bash
docker run -d -p 8080:80 \
  -v $(pwd)/nginx.conf:/etc/nginx/templates/default.conf.template:ro \
  starrocks-admin-ui
```

## Build

```bash
npm run build    # outputs to dist/
npm run preview  # preview the production build locally
```

By default the UI calls `/api` on the same origin. Set `VITE_API_URL` at build time to call a backend on another origin (the backend must then allow your UI origin in `server.cors_origins`). `VITE_*` values are baked into the public bundle, so never put secrets in them.

## Features

### Query Console
- Monaco-based SQL editor with keyword + schema autocomplete
- Resizable editor area (drag to resize)
- Per-environment query tabs (each environment keeps its own tab list)
- Streaming NDJSON results displayed in AG Grid
- Export results as CSV, Excel, or JSON
- Session variables (SET key=value) applied per-connection before query execution — useful for optimizer hints like `enable_topn_opt`, `query_timeout`
- Query history sidebar with duration, row count, status

### Schema Browser
- Database and table explorer
- Column details with types and comments
- Create table wizard with key type, partitioning, distribution
- Add column dialog
- Drop table with confirmation

### Ingestion
- **Routine Load:** View, create, pause, resume, stop Kafka routine load jobs
- **Batch Load:** S3/HDFS Broker Load, Table-to-Table (INSERT INTO SELECT), HTTP Stream Load (file upload)
- Batch load wizard with 4-step flow: Source -> Target & Format -> Options -> Review
- Job monitoring with progress bars, state tags, cancel actions

### Dashboard
- Cluster health overview (FE/BE nodes)
- Node status, capacity, tablet counts
- Routine load job summary

### Query Monitoring
- Active queries with CPU, memory, scan bytes
- Process list
- Slow query log
- Kill query capability

### Authentication
- Login with username/password
- Role-based UI (admin sees write actions, viewer sees read-only)
- Token persisted in localStorage

## Project Structure

```
starrocks-admin-ui/
├── src/
│   ├── api/           # API client functions and types
│   ├── components/
│   │   ├── Dashboard/     # Cluster health overview
│   │   ├── Ingestion/     # Routine load + batch load management
│   │   ├── Layout/        # App shell, sidebar, header, env switcher
│   │   ├── Login/         # Authentication page
│   │   ├── Queries/       # Query monitoring (active, slow, processes)
│   │   ├── QueryConsole/  # SQL editor, results, tabs, history
│   │   ├── Tables/        # Schema browser, create table, add column
│   │   └── shared/        # Reusable components (AutoRefresh, RoutineLoadTable)
│   ├── hooks/         # Custom hooks (useStreamingQuery)
│   ├── store/         # Zustand stores (auth, env, query tabs, history)
│   ├── styles/        # Global CSS
│   └── utils/         # SQL completion, helpers
├── nginx.conf         # Production nginx config (used in Docker)
├── vite.config.ts     # Vite dev server + proxy config
└── Dockerfile
```

## Security

Checks run before the initial public release (November 2026):

- [x] `npm run build` (`tsc && vite build`) passes
- [x] The UI was run against the backend end to end (dev server proxy and the Docker images): sign-in, rejected wrong password and rejected unauthenticated query
- [x] Source tree and production bundle scanned for committed secrets, `.env` files and internal hostnames; none found
- [x] `npm audit` reports no critical or high severity advisories
- [ ] `npm audit` still reports 2 moderate advisories in `react-router-dom` 6.x (open-redirect issues fixed in 7.x, which is a major upgrade). See [SECURITY.md](SECURITY.md).
- [ ] The project has **no automated tests** and no lint configuration yet

`package.json` uses `overrides` to pin a patched `dompurify`, which `monaco-editor` otherwise pulls in at an older, vulnerable version.

These checks are a point-in-time snapshot, not a security audit. Run `npm audit` regularly. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).

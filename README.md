# Pi Web UI

A full-stack web interface for the [Pi coding agent](https://github.com/badlogic/pi-mono), providing browser access to a system-level Pi agent with bash, file read/write/edit, and extension tools.

## Architecture

```
Browser (Lit + pi-web-ui components)
  │  WebSocket (/api/ws)
  ▼
Node.js server (Express + ws)
  │  Pi SDK (createAgentSession)
  ▼
System tools (bash, files, skills, extensions)
```

- **Server** (`server/index.ts`): Runs the Pi SDK `AgentSession` with full system access. Loads auth and model config from `~/.pi/agent`. Streams agent events to connected clients over WebSocket. Fetches models from a local LiteLLM instance.
- **Client** (`client/main.ts`): Lit-based UI using `@mariozechner/pi-web-ui` components (`MessageList`, `MessageEditor`, `StreamingMessageContainer`). Communicates exclusively via WebSocket.
- **Protocol** (`shared/protocol.ts`): Typed JSON message definitions for the WebSocket wire format.

## Setup

```bash
npm install
npm run build
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server listen port |
| `LITELLM_URL` | `http://192.168.50.240:4000` | LiteLLM API base URL |
| `LITELLM_KEY` | *(from ~/.pi/agent)* | LiteLLM API key (auto-detected from Pi config if unset) |

### Development

```bash
npm run dev
```

Starts the server (`tsx watch`) on port 3001 and Vite dev server on port 5173 with WebSocket proxy.

### Production

```bash
npm run build
PORT=8085 npm start
```

Or use the systemd user service:

```bash
cp pi-webui.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pi-webui.service
```

## Features

- Full Pi agent with system access (bash, read, edit, write, extensions)
- Session persistence and history — create new sessions, browse and resume previous ones
- Model switching with sorted, filterable dropdown (pulls from LiteLLM + Pi model registry)
- Configurable thinking level (off, minimal, low, medium, high)
- Streaming responses with tool execution display
- Collapsible session sidebar (inline on desktop, overlay on mobile)
- Dark/light theme toggle with green accent
- Deployed at `pi.zetaphor.space` via Caddy + Tailscale

## Project structure

```
├── client/
│   ├── index.html        Entry point
│   ├── main.ts           Client application (state, WebSocket, rendering)
│   └── app.css           Theme overrides and sidebar styles
├── server/
│   └── index.ts          Express + WebSocket server, Pi SDK session
├── shared/
│   └── protocol.ts       WebSocket message type definitions
├── vite.config.ts        Vite config (build, dev proxy)
├── tsconfig.json         TypeScript config
└── package.json          Dependencies and scripts
```

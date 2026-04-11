# Agent Guidelines for pi-webui

## Project overview

This is a full-stack web UI for the Pi coding agent. The server runs a real Pi `AgentSession` with system-level tools (bash, file I/O, extensions). The client is a Lit-based SPA using `@mariozechner/pi-web-ui` components. They communicate over a JSON WebSocket protocol defined in `shared/protocol.ts`.

## Key conventions

- **No framework** on the client — plain Lit `html` templates with `render()`, no components or classes. State is module-level variables; call `renderApp()` after mutation.
- **Pi SDK types** come from `@mariozechner/pi-coding-agent` (server) and `@mariozechner/pi-agent-core` / `@mariozechner/pi-ai` (shared types). Do not duplicate SDK types — import them.
- **Protocol changes** must update `shared/protocol.ts` (the `ClientMessage` and `ServerMessage` unions), the server handler in `handleClientMessage()`, and the client handler in `handleServerMessage()`.
- **CSS** uses Tailwind utility classes in Lit templates plus custom CSS in `client/app.css`. Theme variables come from `@mariozechner/pi-web-ui/app.css` — override them in `app.css` `:root` / `.dark` blocks.
- The sidebar uses plain CSS transitions (not Tailwind `transition-*`). Desktop uses `position: relative` with width animation; mobile uses `position: fixed` with transform.

## Working directory

The agent session defaults to `os.homedir()`. This is passed as `cwd` to `createAgentSession` and `SessionManager.create()`.

## Build and run

- `npm run dev` — concurrent dev server (tsx watch + vite)
- `npm run build` — vite production build to `dist/`
- `npm start` — run production server (serves `dist/` static files)
- Systemd service: `systemctl --user restart pi-webui`
- Deployed at `pi.zetaphor.space` via Caddy reverse proxy on port 8085

## After making changes

1. Run `npx vite build` to rebuild the client
2. Run `systemctl --user restart pi-webui.service` to pick up server changes
3. Both steps are needed — the production server serves the built `dist/` output

## File layout

- `server/index.ts` — the entire backend (Express, WebSocket, Pi SDK session, LiteLLM integration, session management)
- `client/main.ts` — the entire frontend (WebSocket client, state management, all UI rendering)
- `client/app.css` — theme overrides (green accent), sidebar CSS, session item styles
- `shared/protocol.ts` — all WebSocket message types shared between client and server
- `vite.config.ts` — Vite config with Tailwind plugin and dev proxy for `/api/ws`

## Things to watch out for

- The `pi-web-ui` custom elements (`message-list`, `message-editor`, `streaming-message-container`) must be imported and referenced with `void` to prevent tree-shaking.
- `AgentSessionEvent` objects may contain circular references — the server uses `safeSerializeEvent()` to handle this before sending over WebSocket.
- Express 5 uses `path-to-regexp` v8 which requires `/{*path}` syntax for catch-all routes, not `*`.
- The model dropdown uses `position: fixed` with `z-index: 200` to escape all stacking contexts.

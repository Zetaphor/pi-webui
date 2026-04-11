import express from "express";
import { createServer } from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type { Model, Api } from "@mariozechner/pi-ai";
import type {
  ClientMessage,
  ServerMessage,
  ModelInfo,
  SerializedAgentState,
  SessionListItem,
} from "../shared/protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3001");
const LITELLM_URL = process.env.LITELLM_URL || "http://192.168.50.240:4000";
let litellmKey = process.env.LITELLM_KEY || "";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/api/ws" });

// Serve static client files in production
const clientDist = path.resolve(__dirname, "../dist");
app.use(express.static(clientDist));
app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(clientDist, "client", "index.html"));
});

const HOME_DIR = os.homedir();

let session: AgentSession;
let authStorage: AuthStorage;
let modelRegistry: ModelRegistry;
let sessionUnsubscribe: (() => void) | undefined;
const clients = new Set<WebSocket>();

function modelToInfo(model: Model<Api>): ModelInfo {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name || model.id,
  };
}

function serializeState(): SerializedAgentState {
  const state = session.agent.state;
  return {
    messages: state.messages,
    model: state.model ? modelToInfo(state.model) : undefined,
    thinkingLevel: session.thinkingLevel,
    systemPrompt: state.systemPrompt,
    isStreaming: state.isStreaming,
    streamingMessage: state.streamingMessage,
    errorMessage: state.errorMessage,
    tools: session.getActiveToolNames(),
    sessionId: session.sessionId,
    sessionName: session.sessionName,
  };
}

function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

async function fetchLiteLLMModels(): Promise<ModelInfo[]> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (litellmKey) {
      headers["Authorization"] = `Bearer ${litellmKey}`;
    }
    const res = await fetch(`${LITELLM_URL}/v1/models`, { headers });
    if (!res.ok) {
      console.error(`LiteLLM /v1/models returned ${res.status}`);
      return [];
    }
    const json = await res.json() as { data?: Array<{ id: string; owned_by?: string }> };
    return (json.data || []).map((m) => ({
      provider: "ollama",
      id: m.id,
      name: m.id,
    }));
  } catch (err) {
    console.error("Failed to fetch LiteLLM models:", err);
    return [];
  }
}

function getRegistryModels(): ModelInfo[] {
  return modelRegistry
    .getAll()
    .filter((m) => m.provider === "ollama")
    .map(modelToInfo);
}

async function getModels(): Promise<ModelInfo[]> {
  const litellmModels = await fetchLiteLLMModels();
  const registryModels = getRegistryModels();

  // Merge: registry models first, then any LiteLLM models not already in registry
  const seen = new Set(registryModels.map((m) => `${m.provider}/${m.id}`));
  const merged = [...registryModels];
  for (const m of litellmModels) {
    const key = `${m.provider}/${m.id}`;
    if (!seen.has(key)) {
      merged.push(m);
      seen.add(key);
    }
  }
  return merged;
}

function findModel(provider: string, modelId: string): Model<Api> | undefined {
  return modelRegistry.find(provider, modelId);
}

function safeSerializeEvent(event: AgentSessionEvent): any {
  try {
    const json = JSON.stringify(event);
    return JSON.parse(json);
  } catch {
    // If circular refs or non-serializable data, return a simplified version
    return { type: (event as any).type, _serialized: false };
  }
}

function setupSessionEvents() {
  if (sessionUnsubscribe) sessionUnsubscribe();

  sessionUnsubscribe = session.subscribe((event: AgentSessionEvent) => {
    const safeEvent = safeSerializeEvent(event);
    broadcast({ type: "agentEvent", event: safeEvent });

    if (
      event.type === "agent_start" ||
      event.type === "agent_end" ||
      event.type === "message_end" ||
      event.type === "turn_end"
    ) {
      broadcast({ type: "stateSync", state: serializeState() });
    }
  });
}

async function handleClientMessage(ws: WebSocket, msg: ClientMessage) {
  try {
    switch (msg.type) {
      case "prompt": {
        session.prompt(msg.text).catch((err: any) => {
          console.error("Prompt error:", err);
          broadcast({ type: "error", message: err.message || String(err) });
        });
        break;
      }
      case "steer": {
        await session.steer(msg.text);
        break;
      }
      case "followUp": {
        await session.followUp(msg.text);
        break;
      }
      case "abort": {
        await session.abort();
        broadcast({ type: "stateSync", state: serializeState() });
        break;
      }
      case "getModels": {
        const models = await getModels();
        const current = session.model ? modelToInfo(session.model) : undefined;
        send(ws, {
          type: "models",
          models,
          current,
          thinkingLevel: session.thinkingLevel,
        });
        break;
      }
      case "setModel": {
        const model = findModel(msg.provider, msg.modelId);
        if (!model) {
          send(ws, { type: "error", message: `Model not found: ${msg.provider}/${msg.modelId}` });
          return;
        }
        await session.setModel(model);
        broadcast({
          type: "modelChanged",
          model: modelToInfo(model),
          thinkingLevel: session.thinkingLevel,
        });
        break;
      }
      case "setThinkingLevel": {
        session.setThinkingLevel(msg.level as any);
        const currentModel = session.model ? modelToInfo(session.model) : { provider: "", id: "", name: "" };
        broadcast({
          type: "modelChanged",
          model: currentModel,
          thinkingLevel: session.thinkingLevel,
        });
        break;
      }
      case "getState": {
        send(ws, { type: "stateSync", state: serializeState() });
        break;
      }
      case "newSession": {
        if (session.isStreaming) {
          await session.abort();
        }
        if (sessionUnsubscribe) sessionUnsubscribe();

        const { session: newSession } = await createAgentSession({
          cwd: HOME_DIR,
          authStorage,
          modelRegistry,
          sessionManager: SessionManager.create(HOME_DIR),
        });
        session = newSession;
        setupSessionEvents();
        broadcast({ type: "sessionChanged", sessionId: session.sessionId });
        broadcast({ type: "stateSync", state: serializeState() });
        console.log(`New session created: ${session.sessionId}`);
        break;
      }
      case "getSessions": {
        const sessionInfos = await SessionManager.list(HOME_DIR);
        const items: SessionListItem[] = sessionInfos
          .sort((a, b) => b.modified.getTime() - a.modified.getTime())
          .map((s) => ({
            id: s.id,
            path: s.path,
            name: s.name,
            cwd: s.cwd,
            created: s.created.toISOString(),
            modified: s.modified.toISOString(),
            messageCount: s.messageCount,
            firstMessage: s.firstMessage,
          }));
        send(ws, { type: "sessions", sessions: items, currentSessionId: session.sessionId });
        break;
      }
      case "loadSession": {
        if (session.isStreaming) {
          await session.abort();
        }
        if (sessionUnsubscribe) sessionUnsubscribe();

        const loadedManager = SessionManager.open(msg.sessionPath, undefined, HOME_DIR);
        const { session: loadedSession } = await createAgentSession({
          cwd: HOME_DIR,
          authStorage,
          modelRegistry,
          sessionManager: loadedManager,
        });
        session = loadedSession;
        setupSessionEvents();
        broadcast({ type: "sessionChanged", sessionId: session.sessionId });
        broadcast({ type: "stateSync", state: serializeState() });
        console.log(`Loaded session: ${session.sessionId}`);
        break;
      }
    }
  } catch (err: any) {
    console.error(`Error handling ${msg.type}:`, err);
    send(ws, { type: "error", message: err.message || String(err) });
  }
}

async function main() {
  console.log("Initializing Pi agent session...");

  authStorage = AuthStorage.create();
  modelRegistry = ModelRegistry.create(authStorage);

  if (!litellmKey) {
    const key = await modelRegistry.getApiKeyForProvider("ollama");
    if (key) litellmKey = key;
  }

  const { session: agentSession, modelFallbackMessage } = await createAgentSession({
    cwd: HOME_DIR,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.create(HOME_DIR),
  });

  session = agentSession;

  if (modelFallbackMessage) {
    console.log("Model fallback:", modelFallbackMessage);
  }

  console.log(`Model: ${session.model?.provider}/${session.model?.id}`);
  console.log(`Thinking: ${session.thinkingLevel}`);
  console.log(`Tools: ${session.getActiveToolNames().join(", ")}`);

  setupSessionEvents();

  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`Client connected (${clients.size} total)`);

    send(ws, { type: "ready" });
    send(ws, { type: "stateSync", state: serializeState() });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;
        handleClientMessage(ws, msg);
      } catch (err) {
        console.error("Invalid message:", err);
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`Client disconnected (${clients.size} total)`);
    });
  });

  server.listen(PORT, () => {
    console.log(`Pi WebUI server listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

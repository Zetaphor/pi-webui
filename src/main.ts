import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import {
	type AgentState,
	ApiKeyPromptDialog,
	AppStorage,
	ChatPanel,
	CustomProvidersStore,
	createJavaScriptReplTool,
	IndexedDBStorageBackend,
	ProviderKeysStore,
	ProvidersModelsTab,
	ProxyTab,
	SessionListDialog,
	SessionsStore,
	SettingsDialog,
	SettingsStore,
	setAppStorage,
} from "@mariozechner/pi-web-ui";
import { html, render } from "lit";
import { Bell, History, Plus, Settings } from "lucide";
import "./app.css";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { createSystemNotification, customConvertToLlm, registerCustomMessageRenderers } from "./custom-messages.js";

registerCustomMessageRenderers();

const settings = new SettingsStore();
const providerKeys = new ProviderKeysStore();
const sessions = new SessionsStore();
const customProviders = new CustomProvidersStore();

const configs = [
	settings.getConfig(),
	SessionsStore.getMetadataConfig(),
	providerKeys.getConfig(),
	customProviders.getConfig(),
	sessions.getConfig(),
];

const backend = new IndexedDBStorageBackend({
	dbName: "pi-web-ui-example",
	version: 2,
	stores: configs,
});

settings.setBackend(backend);
providerKeys.setBackend(backend);
customProviders.setBackend(backend);
sessions.setBackend(backend);

const storage = new AppStorage(settings, providerKeys, sessions, customProviders, backend);
setAppStorage(storage);

let currentSessionId: string | undefined;
let currentTitle = "";
let isEditingTitle = false;
let agent: Agent;
let chatPanel: ChatPanel;
let agentUnsubscribe: (() => void) | undefined;

const generateTitle = (messages: AgentMessage[]): string => {
	const firstUserMsg = messages.find((m) => m.role === "user" || m.role === "user-with-attachments");
	if (!firstUserMsg || (firstUserMsg.role !== "user" && firstUserMsg.role !== "user-with-attachments")) return "";

	let text = "";
	const content = firstUserMsg.content;

	if (typeof content === "string") {
		text = content;
	} else {
		const textBlocks = content.filter((c: any) => c.type === "text");
		text = textBlocks.map((c: any) => c.text || "").join(" ");
	}

	text = text.trim();
	if (!text) return "";

	const sentenceEnd = text.search(/[.!?]/);
	if (sentenceEnd > 0 && sentenceEnd <= 50) {
		return text.substring(0, sentenceEnd + 1);
	}
	return text.length <= 50 ? text : `${text.substring(0, 47)}...`;
};

const shouldSaveSession = (messages: AgentMessage[]): boolean => {
	const hasUserMsg = messages.some((m: any) => m.role === "user" || m.role === "user-with-attachments");
	const hasAssistantMsg = messages.some((m: any) => m.role === "assistant");
	return hasUserMsg && hasAssistantMsg;
};

const saveSession = async () => {
	if (!storage.sessions || !currentSessionId || !agent || !currentTitle) return;

	const state = agent.state;
	if (!shouldSaveSession(state.messages)) return;

	try {
		const sessionData = {
			id: currentSessionId,
			title: currentTitle,
			model: state.model!,
			thinkingLevel: state.thinkingLevel,
			messages: state.messages,
			createdAt: new Date().toISOString(),
			lastModified: new Date().toISOString(),
		};

		const metadata = {
			id: currentSessionId,
			title: currentTitle,
			createdAt: sessionData.createdAt,
			lastModified: sessionData.lastModified,
			messageCount: state.messages.length,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0,
				},
			},
			modelId: state.model?.id || null,
			thinkingLevel: state.thinkingLevel,
			preview: generateTitle(state.messages),
		};

		await storage.sessions.save(sessionData, metadata);
	} catch (err) {
		console.error("Failed to save session:", err);
	}
};

const updateUrl = (sessionId: string) => {
	const url = new URL(window.location.href);
	url.searchParams.set("session", sessionId);
	window.history.replaceState({}, "", url);
};

const createAgent = async (initialState?: Partial<AgentState>) => {
	if (agentUnsubscribe) {
		agentUnsubscribe();
	}

	agent = new Agent({
		initialState: initialState || {
			systemPrompt: `You are a helpful AI assistant with access to various tools.

Available tools:
- JavaScript REPL: Execute JavaScript code in a sandboxed browser environment (can do calculations, get time, process data, create visualizations, etc.)
- Artifacts: Create interactive HTML, SVG, Markdown, and text artifacts

Feel free to use these tools when needed to provide accurate and helpful responses.`,
			model: getModel("anthropic", "claude-sonnet-4-5-20250929"),
			thinkingLevel: "off",
			messages: [],
			tools: [],
		},
		convertToLlm: customConvertToLlm,
	});

	agentUnsubscribe = agent.subscribe((event: any) => {
		if (event.type === "state-update") {
			const messages = event.state.messages;

			if (!currentTitle && shouldSaveSession(messages)) {
				currentTitle = generateTitle(messages);
			}

			if (!currentSessionId && shouldSaveSession(messages)) {
				currentSessionId = crypto.randomUUID();
				updateUrl(currentSessionId);
			}

			if (currentSessionId) {
				saveSession();
			}

			renderApp();
		}
	});

	await chatPanel.setAgent(agent, {
		onApiKeyRequired: async (provider: string) => {
			return await ApiKeyPromptDialog.prompt(provider);
		},
		toolsFactory: (_agent, _agentInterface, _artifactsPanel, runtimeProvidersFactory) => {
			const replTool = createJavaScriptReplTool();
			replTool.runtimeProvidersFactory = runtimeProvidersFactory;
			return [replTool];
		},
	});
};

const loadSession = async (sessionId: string): Promise<boolean> => {
	if (!storage.sessions) return false;

	const sessionData = await storage.sessions.get(sessionId);
	if (!sessionData) {
		console.error("Session not found:", sessionId);
		return false;
	}

	currentSessionId = sessionId;
	const metadata = await storage.sessions.getMetadata(sessionId);
	currentTitle = metadata?.title || "";

	await createAgent({
		model: sessionData.model,
		thinkingLevel: sessionData.thinkingLevel,
		messages: sessionData.messages,
		tools: [],
	});

	updateUrl(sessionId);
	renderApp();
	return true;
};

const newSession = () => {
	const url = new URL(window.location.href);
	url.search = "";
	window.location.href = url.toString();
};

const renderApp = () => {
	const app = document.getElementById("app");
	if (!app) return;

	const appHtml = html`
		<div style="display: flex; flex-direction: column; height: 100vh; width: 100vw;">
			<div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border);">
				<div style="display: flex; align-items: center; gap: 4px;">
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(History, "sm"),
						onClick: () => {
							SessionListDialog.open(
								async (sessionId) => {
									await loadSession(sessionId);
								},
								(deletedSessionId) => {
									if (deletedSessionId === currentSessionId) {
										newSession();
									}
								},
							);
						},
						title: "Sessions",
					})}
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(Plus, "sm"),
						onClick: newSession,
						title: "New Session",
					})}
				</div>
				${
					currentTitle
						? isEditingTitle
							? html`<div style="flex: 1; display: flex; justify-content: center;">
									${Input({
										type: "text",
										value: currentTitle,
										className: "text-sm w-64",
										onChange: async (e: Event) => {
											const newTitle = (e.target as HTMLInputElement).value.trim();
											if (newTitle && newTitle !== currentTitle && storage.sessions && currentSessionId) {
												await storage.sessions.updateTitle(currentSessionId, newTitle);
												currentTitle = newTitle;
											}
											isEditingTitle = false;
											renderApp();
										},
										onKeyDown: async (e: KeyboardEvent) => {
											if (e.key === "Enter") {
												const newTitle = (e.target as HTMLInputElement).value.trim();
												if (newTitle && newTitle !== currentTitle && storage.sessions && currentSessionId) {
													await storage.sessions.updateTitle(currentSessionId, newTitle);
													currentTitle = newTitle;
												}
												isEditingTitle = false;
												renderApp();
											} else if (e.key === "Escape") {
												isEditingTitle = false;
												renderApp();
											}
										},
									})}
								</div>`
							: html`<div
									style="flex: 1; text-align: center; font-size: 0.875rem; font-weight: 500; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
									@click=${() => {
										isEditingTitle = true;
										renderApp();
										requestAnimationFrame(() => {
											const input = app?.querySelector('input[type="text"]') as HTMLInputElement;
											if (input) {
												input.focus();
												input.select();
											}
										});
									}}
									title="Click to edit title"
								>
									${currentTitle}
								</div>`
						: html`<div style="flex: 1; text-align: center; font-size: 0.875rem; font-weight: 500;">Pi Web UI</div>`
				}
				<div style="display: flex; align-items: center; gap: 4px;">
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(Bell, "sm"),
						onClick: () => {
							if (agent) {
								agent.steer(
									createSystemNotification(
										"This is a custom message! It appears in the UI but is never sent to the LLM.",
									),
								);
							}
						},
						title: "Demo: Add Custom Notification",
					})}
					<theme-toggle></theme-toggle>
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(Settings, "sm"),
						onClick: () => SettingsDialog.open([new ProvidersModelsTab(), new ProxyTab()]),
						title: "Settings",
					})}
				</div>
			</div>

			<div style="flex: 1; overflow: hidden;">
				${chatPanel}
			</div>
		</div>
	`;

	render(appHtml, app);
};

async function initApp() {
	const app = document.getElementById("app");
	if (!app) throw new Error("App container not found");

	render(
		html`<div style="display: flex; align-items: center; justify-content: center; height: 100vh;">
			<div>Loading...</div>
		</div>`,
		app,
	);

	chatPanel = new ChatPanel();

	const urlParams = new URLSearchParams(window.location.search);
	const sessionIdFromUrl = urlParams.get("session");

	if (sessionIdFromUrl) {
		const loaded = await loadSession(sessionIdFromUrl);
		if (!loaded) {
			newSession();
			return;
		}
	} else {
		await createAgent();
	}

	renderApp();
}

initApp();

import { Alert } from "@mariozechner/mini-lit/dist/Alert.js";
import type { Message } from "@mariozechner/pi-ai";
import type { AgentMessage, MessageRenderer } from "@mariozechner/pi-web-ui";
import { defaultConvertToLlm, registerMessageRenderer } from "@mariozechner/pi-web-ui";
import { html } from "lit";

export interface SystemNotificationMessage {
	role: "system-notification";
	message: string;
	variant: "default" | "destructive";
	timestamp: string;
}

declare module "@mariozechner/pi-agent-core" {
	interface CustomAgentMessages {
		"system-notification": SystemNotificationMessage;
	}
}

const systemNotificationRenderer: MessageRenderer<SystemNotificationMessage> = {
	render: (notification) => {
		return html`
			<div style="padding: 8px 0;">
				${Alert({
					variant: notification.variant,
					children: html`
						<div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
							<span>${notification.message}</span>
							<span style="font-size: 0.75rem; opacity: 0.6;">${new Date(notification.timestamp).toLocaleTimeString()}</span>
						</div>
					`,
				})}
			</div>
		`;
	},
};

export function registerCustomMessageRenderers() {
	registerMessageRenderer("system-notification", systemNotificationRenderer);
}

export function createSystemNotification(
	message: string,
	variant: "default" | "destructive" = "default",
): SystemNotificationMessage {
	return {
		role: "system-notification",
		message,
		variant,
		timestamp: new Date().toISOString(),
	};
}

export function customConvertToLlm(messages: AgentMessage[]): Message[] {
	const processed = messages.map((m): AgentMessage => {
		if (m.role === "system-notification") {
			const notification = m as SystemNotificationMessage;
			return {
				role: "user",
				content: `<system-notification>${notification.message}</system-notification>`,
				timestamp: Date.now(),
			};
		}
		return m;
	});

	return defaultConvertToLlm(processed);
}

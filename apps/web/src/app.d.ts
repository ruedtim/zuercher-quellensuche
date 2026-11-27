// See https://kit.svelte.dev/docs/types#app

import type { SearchAnalytics, DocAnalytics, McpAnalytics, ExportAnalytics } from "$lib/server/analytics/extract";

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			analytics: {
				search?: SearchAnalytics;
				doc?: DocAnalytics;
				mcp?: McpAnalytics;
				export?: ExportAnalytics;
			};
		}
		// interface PageData {}
		// interface PageState {}
		// adapter-node reicht die rohe Anfrage durch; im Dev-Server fehlt sie.
		interface Platform {
			req?: import("node:http").IncomingMessage;
		}
	}
}

export {};

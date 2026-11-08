import { type ChatEvent, chatEventSchema } from "@orbita/shared";

/**
 * Leitor de SSE: recebe pedaços de texto do fluxo (que podem cortar uma linha ao meio) e devolve os eventos já
 * completos. Cada `data:` é um JSON de `ChatEvent`; o que não passa pelo schema é ignorado (a rede nunca derruba o app).
 */
export function createSseParser() {
	let buffer = "";
	return {
		feed(chunk: string): ChatEvent[] {
			buffer += chunk;
			const events: ChatEvent[] = [];
			// Eventos são separados por linha em branco; aceita \n\n e \r\n\r\n.
			for (;;) {
				const match = /\r?\n\r?\n/.exec(buffer);
				if (!match) break;
				const block = buffer.slice(0, match.index);
				buffer = buffer.slice(match.index + match[0].length);
				const event = parseBlock(block);
				if (event) events.push(event);
			}
			return events;
		},
	};
}

function parseBlock(block: string): ChatEvent | null {
	const data = block
		.split(/\r?\n/)
		// Linhas que começam com ":" são comentários (batimento do servidor).
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).replace(/^ /, ""))
		.join("\n");
	if (!data) return null;
	try {
		const parsed = chatEventSchema.safeParse(JSON.parse(data));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

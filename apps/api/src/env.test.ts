import { describe, expect, it } from "vitest";
import { chatModelsFromEnv, loadEnv } from "./env.ts";

const base = { DATABASE_URL: "postgresql://x", APP_SECRET: "s".repeat(40) };

describe("variáveis do chat", () => {
	it("sem nada definido, usa o padrão do código", () => {
		expect(chatModelsFromEnv(loadEnv(base))).toEqual({
			main: "claude-sonnet-5-5",
			fast: "claude-haiku-5-5",
			effort: "low",
		});
	});

	it("variável vazia (como o compose repassa) vale como não definida", () => {
		const env = loadEnv({ ...base, CHAT_MODEL: "", CHAT_MODEL_FAST: "", CHAT_EFFORT: "" });
		expect(chatModelsFromEnv(env).main).toBe("claude-sonnet-5-5");
	});

	it("troca os modelos pelo ambiente e desliga a rota barata com off", () => {
		const env = loadEnv({
			...base,
			CHAT_MODEL: "claude-opus-5-5",
			CHAT_MODEL_FAST: "OFF",
			CHAT_EFFORT: "high",
		});
		expect(chatModelsFromEnv(env)).toEqual({ main: "claude-opus-5-5", fast: null, effort: "high" });
	});

	it("esforço desconhecido falha cedo, com mensagem em pt-BR", () => {
		expect(() => loadEnv({ ...base, CHAT_EFFORT: "turbo" })).toThrow(/Use low, medium ou high/);
	});
});

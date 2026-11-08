import { describe, expect, it } from "vitest";
import { needsReconnect, PLUGGY_RECONNECT_MESSAGE } from "./pluggy-api.ts";

describe("needsReconnect", () => {
	it("erro com a frase de reconectar", () => {
		expect(needsReconnect({ lastStatus: "error", lastError: PLUGGY_RECONNECT_MESSAGE })).toBe(true);
	});
	it("mensagem antiga (outro final) também", () => {
		expect(
			needsReconnect({
				lastStatus: "error",
				lastError:
					"O banco pediu para você reconectar. Abra o Meu Pluggy, atualize a conexão e sincronize de novo.",
			}),
		).toBe(true);
	});
	it("outro erro, outro status ou sem mensagem não é", () => {
		expect(needsReconnect({ lastStatus: "error", lastError: "O Pluggy está fora do ar agora." })).toBe(false);
		expect(needsReconnect({ lastStatus: "ok", lastError: PLUGGY_RECONNECT_MESSAGE })).toBe(false);
		expect(needsReconnect({ lastStatus: "error", lastError: null })).toBe(false);
		expect(needsReconnect({ lastStatus: null, lastError: null })).toBe(false);
	});
});

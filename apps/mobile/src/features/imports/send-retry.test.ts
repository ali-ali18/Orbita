import { describe, expect, it } from "vitest";
import { sendRetryingOnce } from "./send-retry.ts";

describe("sendRetryingOnce", () => {
	it("não repete quando a primeira tentativa recebe resposta, mesmo de erro do servidor", async () => {
		let calls = 0;
		const result = await sendRetryingOnce(async () => {
			calls++;
			return { status: 422 };
		});
		expect(result).toEqual({ status: 422 });
		expect(calls).toBe(1);
	});

	it("repete uma vez depois de falha de conexão e devolve a segunda resposta", async () => {
		let calls = 0;
		const result = await sendRetryingOnce(async () => {
			calls++;
			if (calls === 1) throw new TypeError("Network request failed");
			return { status: 200 };
		});
		expect(result).toEqual({ status: 200 });
		expect(calls).toBe(2);
	});

	it("se a segunda tentativa também cai, a falha sobe (quem chama mostra a mensagem de conexão)", async () => {
		let calls = 0;
		await expect(
			sendRetryingOnce(async () => {
				calls++;
				throw new TypeError("Network request failed");
			}),
		).rejects.toThrow("Network request failed");
		expect(calls).toBe(2);
	});
});

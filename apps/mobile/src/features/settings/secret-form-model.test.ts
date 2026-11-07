import type { SecretName } from "@orbita/shared";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api.ts";
import {
	initialSecretForm,
	removeSecret,
	type SecretFormAction,
	secretFormReducer,
	submitSecret,
} from "./secret-form-model.ts";

const VALUE = "sk-ant-teste-0000111122223333aaaa";
const run = (actions: SecretFormAction[]) => actions.reduce(secretFormReducer, initialSecretForm);

describe("estado da gaveta", () => {
	it("guarda o que foi digitado", () => {
		expect(run([{ type: "typed", text: VALUE }]).value).toBe(VALUE);
	});
	it("salvar zera o valor e todo o resto", () => {
		const state = run([{ type: "typed", text: VALUE }, { type: "started" }, { type: "saved" }]);
		expect(state).toEqual(initialSecretForm);
		expect(JSON.stringify(state)).not.toContain(VALUE);
	});
	it("falha mantém o valor para tentar de novo e libera o botão", () => {
		const state = run([
			{ type: "typed", text: VALUE },
			{ type: "started" },
			{ type: "failed", message: "Falhou." },
		]);
		expect(state).toMatchObject({ value: VALUE, busy: false, message: "Falhou." });
	});
	it("digitar apaga a mensagem de erro", () => {
		expect(
			run([
				{ type: "invalid", message: "x" },
				{ type: "typed", text: "a" },
			]).message,
		).toBeNull();
	});
	it("pedir remoção troca para a confirmação e cancelar volta", () => {
		expect(run([{ type: "ask-remove" }]).confirmingRemove).toBe(true);
		expect(
			run([{ type: "ask-remove" }, { type: "cancel-remove" }].map((a) => a as SecretFormAction))
				.confirmingRemove,
		).toBe(false);
	});
	it("a gaveta fechada nasce vazia: o estado inicial não tem valor", () => {
		expect(initialSecretForm.value).toBe("");
	});
});

describe("submitSecret", () => {
	it("formato inválido não chama o servidor e a mensagem não repete o valor", async () => {
		const save = vi.fn();
		const out = await submitSecret("anthropic_api_key", "valor-errado-123456", save);
		expect(out.status).toBe("invalid");
		expect(save).not.toHaveBeenCalled();
		expect(JSON.stringify(out)).not.toContain("valor-errado-123456");
	});
	it("válido grava o valor sem espaços nas pontas", async () => {
		const save = vi.fn(async (_n: SecretName, _v: string) => {});
		expect(await submitSecret("anthropic_api_key", `  ${VALUE} `, save)).toEqual({ status: "saved" });
		expect(save).toHaveBeenCalledWith("anthropic_api_key", VALUE);
	});
	it("erro da API mostra a mensagem dela", async () => {
		const out = await submitSecret("anthropic_api_key", VALUE, async () => {
			throw new ApiError("Servidor ocupado.", 503, "x");
		});
		expect(out).toEqual({ status: "failed", message: "Servidor ocupado." });
	});
	it("erro inesperado que cita o valor vira mensagem genérica", async () => {
		const out = await submitSecret("anthropic_api_key", VALUE, async () => {
			throw new Error(`falhou com ${VALUE}`);
		});
		expect(out.status).toBe("failed");
		expect(JSON.stringify(out)).not.toContain(VALUE);
	});
});

describe("removeSecret", () => {
	it("sucesso e falha", async () => {
		expect(await removeSecret("pluggy_client_id", async () => {})).toEqual({ status: "saved" });
		const out = await removeSecret("pluggy_client_id", async () => {
			throw new ApiError("Não deu.", 500, "x");
		});
		expect(out).toEqual({ status: "failed", message: "Não deu." });
	});
});

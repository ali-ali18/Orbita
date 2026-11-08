import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api.ts";
import {
	CONNECT_WAIT_MS,
	canConnect,
	connectButtonLabel,
	connectErrorMessage,
	connectExplainerText,
	connectionArrived,
	connectionUsage,
	connectUrl,
	explainerBankName,
	FREE_PLAN_CONNECTION_LIMIT,
	isWaitingForConnect,
	returnedToApp,
} from "./connect-model.ts";

const TOKEN = "a".repeat(43);
const PATH = `/pluggy/conectar#s=${TOKEN}`;

describe("connectUrl", () => {
	it("monta a URL com o endereço do servidor pareado e mantém o token no fragmento", () => {
		expect(connectUrl("https://financas.exemplo.dev", PATH)).toBe(
			`https://financas.exemplo.dev/pluggy/conectar#s=${TOKEN}`,
		);
		expect(connectUrl("https://financas.exemplo.dev/", PATH)).toBe(
			`https://financas.exemplo.dev/pluggy/conectar#s=${TOKEN}`,
		);
		expect(connectUrl("http://192.168.0.5:3000", PATH)).toBe(
			`http://192.168.0.5:3000/pluggy/conectar#s=${TOKEN}`,
		);
	});

	it("recusa caminho que sai do servidor", () => {
		expect(connectUrl("https://financas.exemplo.dev", "//evil.example/x")).toBeNull();
		expect(connectUrl("https://financas.exemplo.dev", "https://evil.example/x")).toBeNull();
		expect(connectUrl("https://financas.exemplo.dev", "pluggy/conectar")).toBeNull();
		expect(connectUrl("https://financas.exemplo.dev", "/\\evil.example")).toBeNull();
	});

	it("recusa endereço que não é http(s) ou não é endereço", () => {
		expect(connectUrl("javascript:alert(1)", PATH)).toBeNull();
		expect(connectUrl("orbita://x", PATH)).toBeNull();
		expect(connectUrl("não é url", PATH)).toBeNull();
	});
});

describe("espera da volta ao app", () => {
	it("espera por 15 min depois de abrir a página", () => {
		expect(isWaitingForConnect(null, 1000)).toBe(false);
		expect(isWaitingForConnect(1000, 1000 + CONNECT_WAIT_MS - 1)).toBe(true);
		expect(isWaitingForConnect(1000, 1000 + CONNECT_WAIT_MS)).toBe(false);
	});

	it("só conta como volta ao passar de fora para ativo", () => {
		expect(returnedToApp("background", "active")).toBe(true);
		expect(returnedToApp("inactive", "active")).toBe(true);
		expect(returnedToApp("active", "active")).toBe(false);
		expect(returnedToApp("active", "background")).toBe(false);
	});

	it("detecta conexão nova pela contagem", () => {
		expect(connectionArrived(1, 2)).toBe(true);
		expect(connectionArrived(1, 1)).toBe(false);
		expect(connectionArrived(2, 1)).toBe(false);
	});
});

describe("mensagens", () => {
	it("sem chaves manda para Servidor e chaves", () => {
		expect(connectErrorMessage(new ApiError("x", 409, "sem_chaves"))).toBe(
			"Cadastre o Client ID e o Client Secret em Servidor e chaves.",
		);
		expect(connectErrorMessage(new ApiError("Servidor fora.", 500, "erro"))).toBe("Servidor fora.");
	});

	it("o botão exige as chaves", () => {
		expect(canConnect({ keysConfigured: true })).toBe(true);
		expect(canConnect({ keysConfigured: false })).toBe(false);
	});
});

describe("connectionUsage", () => {
	it("conta as conexões contra o limite do plano gratuito", () => {
		expect(FREE_PLAN_CONNECTION_LIMIT).toBe(5);
		expect(connectionUsage(4)).toEqual({ used: 4, limit: 5, label: "4 de 5", remaining: 1, full: false });
		expect(connectionUsage(0)).toMatchObject({ label: "0 de 5", remaining: 5, full: false });
	});

	it("marca cheio no limite e não deixa o restante ficar negativo", () => {
		expect(connectionUsage(5)).toMatchObject({ remaining: 0, full: true });
		expect(connectionUsage(7)).toMatchObject({ label: "7 de 5", remaining: 0, full: true });
	});
});

describe("connectButtonLabel", () => {
	it("troca para 'outro banco' quando já há conexão", () => {
		expect(connectButtonLabel(0)).toBe("Conectar banco");
		expect(connectButtonLabel(1)).toBe("Conectar outro banco");
	});
});

describe("connectExplainerText", () => {
	it("usa o nome do banco no título e no passo 2", () => {
		const t = connectExplainerText("Santander");
		expect(t.title).toBe("Conectar o Santander");
		expect(t.steps).toHaveLength(3);
		expect(t.steps[1]?.title).toBe("Você entra no app do Santander");
		expect(t.button).toBe("Abrir o Meu Pluggy");
	});

	it("sem nome fala do 'seu banco'", () => {
		for (const name of [undefined, null, "", "   "]) {
			const t = connectExplainerText(name);
			expect(t.title).toBe("Conectar um banco");
			expect(t.steps[1]?.title).toBe("Você entra no app do seu banco");
		}
	});
});

describe("explainerBankName", () => {
	it("trata o nome como dado: tira quebras de linha e limita o tamanho", () => {
		expect(explainerBankName("  Banco\n do   Brasil ")).toBe("Banco do Brasil");
		const long = explainerBankName("x".repeat(100));
		expect(long?.length).toBe(40);
		expect(long?.endsWith("…")).toBe(true);
	});
});

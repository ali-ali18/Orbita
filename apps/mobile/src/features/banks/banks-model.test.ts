import type { PluggyConnectionDto, PluggyStatusResponse } from "@orbita/shared";
import { banks } from "@orbita/tokens";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api.ts";
import {
	addErrorMessage,
	bankColorByName,
	canSync,
	connectionCaption,
	connectionName,
	connectionStatusLine,
	disconnectedConnections,
	formatAgo,
	homeRefreshDecision,
	isHomeQuery,
	isSlowSync,
	nextPollDelay,
	parseConnectionInput,
	parseRenameInput,
	REIMPORT_WARNING,
	reconnectBannerText,
	reimportErrorMessage,
	syncAnnouncement,
	syncButtonLabel,
	syncCardText,
	syncErrorMessage,
	syncSignature,
} from "./banks-model.ts";
import {
	addFormReducer,
	initialAddForm,
	removeConnection,
	renameConnection,
	submitConnection,
} from "./connection-form-model.ts";

const NOW = new Date("2026-11-07T15:00:00.000Z");
const ID = "3F2504E0-4F89-11D3-9A0C-0305E82C3301";

const conn = (over: Partial<PluggyConnectionDto> = {}): PluggyConnectionDto => ({
	id: ID.toLowerCase(),
	label: "Nubank",
	createdAt: "2026-11-01T10:00:00.000Z",
	lastSyncAt: null,
	lastStatus: null,
	lastError: null,
	summary: { accounts: 0, cards: 0 },
	...over,
});
const status = (over: Partial<PluggyStatusResponse> = {}): PluggyStatusResponse => ({
	keysConfigured: true,
	sync: "idle",
	lastSyncAt: null,
	connections: [conn()],
	...over,
});

describe("formatAgo", () => {
	it("escolhe a unidade", () => {
		expect(formatAgo("2026-11-07T14:59:40.000Z", NOW)).toBe("agora");
		expect(formatAgo("2026-11-07T14:55:00.000Z", NOW)).toBe("há 5 min");
		expect(formatAgo("2026-11-07T13:00:00.000Z", NOW)).toBe("há 2 h");
		expect(formatAgo("2026-11-04T15:00:00.000Z", NOW)).toBe("há 3 d");
	});
	it("data futura vale agora e texto inválido vira null", () => {
		expect(formatAgo("2026-11-07T16:00:00.000Z", NOW)).toBe("agora");
		expect(formatAgo("ontem", NOW)).toBeNull();
	});
});

describe("situação da conexão", () => {
	it("nunca sincronizou", () => {
		expect(connectionStatusLine(conn(), NOW)).toBe("Nunca sincronizou");
	});
	it("ok com há X", () => {
		const c = conn({ lastStatus: "ok", lastSyncAt: "2026-11-07T13:00:00.000Z" });
		expect(connectionStatusLine(c, NOW)).toBe("Sincronizado há 2 h");
		expect(connectionStatusLine({ ...c, lastSyncAt: "2026-11-07T14:59:59.000Z" }, NOW)).toBe(
			"Sincronizado agora",
		);
	});
	it("parcial", () => {
		const c = conn({ lastStatus: "partial", lastSyncAt: "2026-11-07T13:00:00.000Z" });
		expect(connectionStatusLine(c, NOW)).toBe("Sincronizou em parte · último ok há 2 h");
		expect(connectionStatusLine(conn({ lastStatus: "partial" }), NOW)).toBe("Sincronizou em parte");
	});
	it("erro com a mensagem", () => {
		const c = conn({ lastStatus: "error", lastError: "Reconecte o banco no Meu Pluggy." });
		expect(connectionStatusLine(c, NOW)).toBe("Erro: Reconecte o banco no Meu Pluggy.");
		expect(connectionStatusLine({ ...c, lastError: null }, NOW)).toBe("Erro: a última sincronização falhou");
		expect(connectionStatusLine({ ...c, lastSyncAt: "2026-11-06T15:00:00.000Z" }, NOW)).toBe(
			"Erro: Reconecte o banco no Meu Pluggy. · último ok há 1 d",
		);
	});
	it("sem chaves", () => {
		expect(connectionStatusLine(conn({ lastStatus: "no_keys" }), NOW)).toBe("Sem chaves do Pluggy");
	});
	it("nome cai num texto neutro", () => {
		expect(connectionName(conn({ label: null }))).toBe("Conexão sem nome");
		expect(connectionName(conn({ label: "  " }))).toBe("Conexão sem nome");
	});
});

describe("cartão e botão de sincronização", () => {
	it("textos por estado", () => {
		expect(syncCardText({ sync: "running", lastSyncAt: null }, NOW).title).toBe("Sincronizando…");
		expect(syncCardText({ sync: "queued", lastSyncAt: null }, NOW).title).toBe("Na fila");
		expect(syncCardText({ sync: "unavailable", lastSyncAt: null }, NOW).title).toBe(
			"Sincronização indisponível",
		);
		expect(syncCardText({ sync: "idle", lastSyncAt: "2026-11-07T13:00:00.000Z" }, NOW).caption).toBe(
			"Sincronizado há 2 h",
		);
		expect(syncCardText({ sync: "idle", lastSyncAt: null }, NOW).caption).toBe(
			"Alguma conexão ainda não sincronizou.",
		);
	});
	it("rótulo do botão", () => {
		expect(syncButtonLabel("idle")).toBe("Sincronizar agora");
		expect(syncButtonLabel("queued")).toBe("Na fila…");
		expect(syncButtonLabel("running")).toBe("Sincronizando…");
	});
	it("só sincroniza com chaves, conexão e nada em andamento", () => {
		expect(canSync(status())).toBe(true);
		expect(canSync(status({ keysConfigured: false }))).toBe(false);
		expect(canSync(status({ connections: [] }))).toBe(false);
		expect(canSync(status({ sync: "running" }))).toBe(false);
		expect(canSync(status({ sync: "unavailable" }))).toBe(false);
	});
});

describe("polling", () => {
	it("3 s no começo, 30 s depois de 5 min, nunca para enquanto roda", () => {
		expect(nextPollDelay("queued", 0)).toBe(3000);
		expect(nextPollDelay("running", 299_999)).toBe(3000);
		expect(nextPollDelay("running", 300_000)).toBe(30_000);
		expect(nextPollDelay("queued", 3_600_000)).toBe(30_000);
		expect(nextPollDelay("idle", 0)).toBe(false);
		expect(nextPollDelay("unavailable", 600_000)).toBe(false);
		expect(nextPollDelay(undefined, 0)).toBe(false);
	});
	it("demora: marca depois de 5 min e zera quando nada roda", () => {
		expect(isSlowSync(null, 10_000_000)).toBe(false);
		expect(isSlowSync(1000, 1000 + 299_999)).toBe(false);
		expect(isSlowSync(1000, 1000 + 300_000)).toBe(true);
		expect(syncCardText({ sync: "running", lastSyncAt: null }, NOW, true).caption).toMatch(
			/Pode sair desta tela/,
		);
		expect(syncCardText({ sync: "running", lastSyncAt: null }, NOW, false).caption).toBe(
			"Isso pode levar alguns minutos.",
		);
	});
	it("anuncia só a troca de estado", () => {
		const ok = status({ connections: [conn({ lastStatus: "ok" })] });
		expect(syncAnnouncement(undefined, status({ sync: "queued" }))).toBe("Sincronização na fila.");
		expect(syncAnnouncement("queued", status({ sync: "running" }))).toBe("Sincronizando.");
		expect(syncAnnouncement("running", ok)).toBe("Sincronização concluída.");
		expect(syncAnnouncement("running", status({ connections: [conn({ lastStatus: "error" })] }))).toBe(
			"A sincronização terminou com erro.",
		);
		expect(syncAnnouncement("running", status({ sync: "running" }))).toBeNull();
		expect(syncAnnouncement("idle", ok)).toBeNull();
		expect(syncAnnouncement(undefined, ok)).toBeNull();
	});
});

describe("Início desatualizado", () => {
	const a = conn({ id: "a", lastStatus: "ok", lastSyncAt: "2026-11-07T10:00:00.000Z" });
	const b = conn({ id: "b", lastStatus: "ok", lastSyncAt: "2026-11-07T10:00:00.000Z" });
	it("assinatura não depende da ordem e muda com a sincronização", () => {
		expect(syncSignature({ connections: [a, b] })).toBe(syncSignature({ connections: [b, a] }));
		const newer = { ...a, lastSyncAt: "2026-11-07T14:00:00.000Z" };
		expect(syncSignature({ connections: [newer, b] })).not.toBe(syncSignature({ connections: [a, b] }));
		expect(syncSignature({ connections: [] })).toBe("");
	});
	it("primeira vez só registra", () => {
		const d = homeRefreshDecision(undefined, status({ connections: [a] }));
		expect(d).toEqual({ reload: false, seen: syncSignature({ connections: [a] }) });
	});
	it("igual não recarrega", () => {
		const sig = syncSignature({ connections: [a] });
		expect(homeRefreshDecision(sig, status({ connections: [a] }))).toEqual({ reload: false, seen: sig });
	});
	it("mudou fora da tela (diária) recarrega e registra", () => {
		const before = syncSignature({ connections: [a] });
		const after = { ...a, lastSyncAt: "2026-11-08T09:00:00.000Z" };
		const d = homeRefreshDecision(before, status({ connections: [after] }));
		expect(d).toEqual({ reload: true, seen: syncSignature({ connections: [after] }) });
	});
	it("em andamento espera, sem registrar", () => {
		const before = syncSignature({ connections: [a] });
		const d = homeRefreshDecision(
			before,
			status({ sync: "running", connections: [{ ...a, lastSyncAt: null }] }),
		);
		expect(d).toEqual({ reload: false, seen: before });
	});
	it("mudou mas sem dado novo (erro) registra sem recarregar", () => {
		const before = syncSignature({ connections: [a] });
		const failed = { ...a, lastStatus: "error" as const, lastError: "x" };
		expect(homeRefreshDecision(before, status({ connections: [failed] })).reload).toBe(false);
	});
	it("consultas do Início", () => {
		for (const k of ["summary", "transactions", "accounts", "cards", "invoice", "installments"]) {
			expect(isHomeQuery(["srv", k, "x"], "srv")).toBe(true);
		}
		expect(isHomeQuery(["srv", "pluggy", "status"], "srv")).toBe(false);
		expect(isHomeQuery(["outro", "summary"], "srv")).toBe(false);
	});
});

describe("validação do ID", () => {
	it("aceita UUID, em minúsculo, e tira os espaços da colagem", () => {
		expect(parseConnectionInput(`  ${ID}\n`, "")).toEqual({ ok: true, itemId: ID.toLowerCase() });
	});
	it("nome opcional vai junto", () => {
		expect(parseConnectionInput(ID, "  Nubank ")).toEqual({
			ok: true,
			itemId: ID.toLowerCase(),
			label: "Nubank",
		});
	});
	it("recusa o que não é UUID", () => {
		for (const bad of ["", "abc", "3f2504e0-4f89-11d3-9a0c-0305e82c330", `${ID}x`]) {
			const r = parseConnectionInput(bad, "");
			expect(r.ok).toBe(false);
		}
		const r = parseConnectionInput("abc", "");
		expect(r.ok ? "" : r.message).toMatch(/ID da conexão/);
	});
	it("recusa nome longo demais", () => {
		expect(parseConnectionInput(ID, "a".repeat(61)).ok).toBe(false);
	});
});

describe("erros em pt-BR", () => {
	it("409 e 422", () => {
		expect(addErrorMessage(new ApiError("x", 409, "conflito"))).toBe("Esta conexão já está cadastrada.");
		expect(addErrorMessage(new ApiError("x", 422, "conexao_invalida"))).toMatch(/Não achei essa conexão/);
		expect(addErrorMessage(new ApiError("Falhou no servidor.", 500, "erro"))).toBe("Falhou no servidor.");
		expect(addErrorMessage(new Error("boom"))).toBe("Algo deu errado. Tente de novo.");
	});
	it("erros da sincronização", () => {
		expect(syncErrorMessage(new ApiError("x", 400, "sem_chaves"))).toMatch(/Servidor e chaves/);
		expect(syncErrorMessage(new ApiError("x", 400, "sem_conexoes"))).toMatch(/Adicione uma conexão/);
		expect(syncErrorMessage(new ApiError("x", 503, "fila_indisponivel"))).toMatch(/fila/);
	});
});

describe("cor do banco", () => {
	it("pelo nome, sem acento nem caixa", () => {
		expect(bankColorByName("Nubank")).toBe(banks.nubank);
		expect(bankColorByName("Itaú Unibanco")).toBe(banks.itau);
		expect(bankColorByName("Banco Inter")).toBe(banks.inter);
		expect(bankColorByName("Mercado Pago")).toBe(banks.mercadoPago);
		expect(bankColorByName("Banco Qualquer")).toBe(banks.generic);
	});
});

describe("formulário", () => {
	it("começa vazio", () => {
		expect(initialAddForm).toEqual({ itemId: "", label: "", message: null, busy: false });
	});
	it("inválido não chama a API", async () => {
		let calls = 0;
		const out = await submitConnection({ itemId: "abc", label: "" }, async () => {
			calls++;
		});
		expect(out.status).toBe("invalid");
		expect(calls).toBe(0);
	});
	it("salva com o ID normalizado", async () => {
		const seen: unknown[] = [];
		const out = await submitConnection({ itemId: ID, label: " Inter " }, async (b) => {
			seen.push(b);
		});
		expect(out).toEqual({ status: "saved" });
		expect(seen).toEqual([{ itemId: ID.toLowerCase(), label: "Inter" }]);
	});
	it("409 vira mensagem amiga", async () => {
		const out = await submitConnection({ itemId: ID, label: "" }, async () => {
			throw new ApiError("x", 409, "conflito");
		});
		expect(out).toEqual({ status: "failed", message: "Esta conexão já está cadastrada." });
	});
	it("remover com 404 vale como removido (a conexão já sumiu)", async () => {
		const out = await removeConnection("a", async () => {
			throw new ApiError("Conexão não encontrada.", 404, "nao_encontrado");
		});
		expect(out).toEqual({ status: "saved" });
	});
	it("remover devolve falha com a mensagem", async () => {
		expect(await removeConnection("a", async () => {})).toEqual({ status: "saved" });
		const out = await removeConnection("a", async () => {
			throw new ApiError("Sem resposta do servidor.", 500, "erro");
		});
		expect(out).toEqual({ status: "failed", message: "Sem resposta do servidor." });
	});
});

describe("addFormReducer", () => {
	it("digitar o ID ou o nome limpa a mensagem e guarda o texto", () => {
		const failed = addFormReducer(initialAddForm, {
			type: "failed",
			message: "Esta conexão já está cadastrada.",
		});
		const typed = addFormReducer(failed, { type: "id", text: ID });
		expect(typed).toEqual({ itemId: ID, label: "", message: null, busy: false });
		expect(addFormReducer(typed, { type: "label", text: "Inter" }).label).toBe("Inter");
	});
	it("started trava e limpa a mensagem", () => {
		const failed = addFormReducer(initialAddForm, { type: "failed", message: "x" });
		expect(addFormReducer(failed, { type: "started" })).toMatchObject({ busy: true, message: null });
	});
	it("failed destrava, mostra a mensagem e mantém o que foi digitado", () => {
		let s = addFormReducer(initialAddForm, { type: "id", text: ID });
		s = addFormReducer(s, { type: "started" });
		s = addFormReducer(s, { type: "failed", message: "Não achei essa conexão." });
		expect(s).toEqual({ itemId: ID, label: "", message: "Não achei essa conexão.", busy: false });
	});
	it("não muda o estado anterior", () => {
		const before = { ...initialAddForm };
		addFormReducer(initialAddForm, { type: "id", text: "abc" });
		expect(initialAddForm).toEqual(before);
	});
});

describe("legenda da conexão", () => {
	const synced = { lastStatus: "ok", lastSyncAt: NOW.toISOString() } as const;
	it("junta contas, cartões e a situação", () => {
		expect(connectionCaption(conn({ ...synced, summary: { accounts: 1, cards: 1 } }), NOW)).toBe(
			"1 conta · 1 cartão · Sincronizado agora",
		);
		expect(connectionCaption(conn({ ...synced, summary: { accounts: 2, cards: 0 } }), NOW)).toBe(
			"2 contas · Sincronizado agora",
		);
		expect(connectionCaption(conn({ ...synced, summary: { accounts: 0, cards: 3 } }), NOW)).toBe(
			"3 cartões · Sincronizado agora",
		);
	});
	it("sem nada trazido mostra só a situação", () => {
		expect(connectionCaption(conn(), NOW)).toBe("Nunca sincronizou");
	});
});

describe("renomear", () => {
	it("valida como o servidor e apara", () => {
		expect(parseRenameInput("  Inter ")).toEqual({ ok: true, label: "Inter" });
		expect(parseRenameInput("   ")).toMatchObject({ ok: false, message: "Informe um nome." });
		expect(parseRenameInput("x".repeat(61))).toMatchObject({
			ok: false,
			message: "O nome passa de 60 letras.",
		});
		expect(parseRenameInput("a\nb").ok).toBe(false);
	});
	it("inválido não chama a API; salvo manda o nome aparado", async () => {
		let seen: string[] = [];
		const rename = async (l: string) => {
			seen.push(l);
		};
		expect((await renameConnection(" ", rename)).status).toBe("invalid");
		expect(seen).toEqual([]);
		expect(await renameConnection(" Inter ", rename)).toEqual({ status: "saved" });
		expect(seen).toEqual(["Inter"]);
		seen = [];
	});
	it("erros viram mensagem em pt-BR", async () => {
		const gone = await renameConnection("A", async () => {
			throw new ApiError("x", 404, "nao_encontrado");
		});
		expect(gone).toEqual({
			status: "failed",
			message: "Esta conexão não existe mais. Volte e atualize a lista.",
		});
		const down = await renameConnection("A", async () => {
			throw new ApiError("Sem resposta do servidor.", 500, "erro");
		});
		expect(down).toEqual({ status: "failed", message: "Sem resposta do servidor." });
	});
});

describe("reimportar do zero", () => {
	it("explica o que some e o que fica, sem jargão", () => {
		expect(REIMPORT_WARNING).toContain("só o que veio do Meu Pluggy");
		expect(REIMPORT_WARNING).toContain("à mão");
		expect(REIMPORT_WARNING).toContain("contas e os cartões ficam");
	});
	it("mensagens de erro: sincronização em andamento e os recusas comuns", () => {
		expect(reimportErrorMessage(new ApiError("x", 409, "sincronizando"))).toContain("em andamento");
		expect(reimportErrorMessage(new ApiError("x", 400, "sem_chaves"))).toContain("Client ID");
		expect(reimportErrorMessage(new ApiError("Sem resposta do servidor.", 500, "erro"))).toBe(
			"Sem resposta do servidor.",
		);
	});
});

describe("banco desconectado", () => {
	const RECONNECT = "O banco pediu para você reconectar. Toque em Reconectar no app e sincronize de novo.";
	const lost = (over: Partial<PluggyConnectionDto> = {}) =>
		conn({ label: "Santander", lastStatus: "error", lastError: RECONNECT, ...over });

	it("só conta erro de login, não qualquer erro", () => {
		const other = conn({ id: "b", lastStatus: "error", lastError: "O Pluggy está fora do ar agora." });
		const ok = conn({ id: "c", lastStatus: "ok" });
		expect(disconnectedConnections([lost(), other, ok]).map((c) => c.id)).toEqual([ID.toLowerCase()]);
	});
	it("conexão nova do mesmo banco sincronizando bem apaga o aviso da velha", () => {
		const fresh = conn({ id: "novo", label: "santander", lastStatus: "ok" });
		expect(disconnectedConnections([lost(), fresh])).toEqual([]);
		const stillBad = conn({ id: "novo", label: "Santander", lastStatus: "error", lastError: RECONNECT });
		expect(disconnectedConnections([lost(), stillBad])).toHaveLength(2);
	});
	it("a linha da conexão diz desconectado", () => {
		expect(connectionStatusLine(lost({ lastSyncAt: "2026-11-07T13:00:00.000Z" }), NOW)).toBe(
			"Desconectado · último ok há 2 h",
		);
	});
	it("texto do aviso com a data do último dado bom", () => {
		const text = reconnectBannerText(lost({ lastSyncAt: "2026-11-04T13:00:00.000Z" }), NOW);
		expect(text).toEqual({
			title: "O Santander desconectou",
			caption: "Última sincronização há 3 d",
			body: "Reconecte para eu buscar o que faltou desde 4 de nov.",
			button: "Reconectar o Santander",
		});
	});
	it("sem sincronização anterior, texto sem data", () => {
		const text = reconnectBannerText(lost(), NOW);
		expect(text.caption).toBe("O banco pediu para você entrar de novo.");
		expect(text.body).toBe("Reconecte para eu buscar seus lançamentos.");
	});
});

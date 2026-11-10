import { describe, expect, it } from "vitest";
import {
	chooseConnectionLabel,
	isAutoLabel,
	labelFromAccounts,
	labelIsReplaceable,
} from "./connection-label.ts";
import type { PluggyAccount } from "./schemas.ts";

// Tudo fictício: nomes no formato que o Pluggy manda, nenhum dado real.
const acc = (over: Partial<PluggyAccount> & { id: string }): PluggyAccount => ({
	type: "BANK",
	name: "Conta",
	...over,
});
const card = (over: Partial<PluggyAccount> & { id: string }): PluggyAccount =>
	acc({ type: "CREDIT", name: "Cartão", ...over });
const meu = (accounts: PluggyAccount[]) => labelFromAccounts({ connectorName: "MeuPluggy", accounts });

describe("labelFromAccounts", () => {
	it("é o nome curto do banco citado nas contas, sem juntar o nome do cartão", () => {
		expect(meu([acc({ id: "1", name: "BANCO INTER" }), card({ id: "2", name: "GOLD" })])).toBe("Inter");
		expect(
			meu([
				acc({ id: "1", name: "Conta", marketingName: "Nu Pagamentos S.A. - Instituição de Pagamento" }),
				card({ id: "2", name: "gold" }),
			]),
		).toBe("Nubank");
		expect(
			meu([acc({ id: "1", name: "Banco Santander Pessoa Física" }), card({ id: "2", name: "FREE VISA" })]),
		).toBe("Santander");
		expect(meu([acc({ id: "1", name: "Mercado Pago (Conta Pré-paga)" })])).toBe("Mercado Pago");
	});

	it.each([
		["C6 Bank", "C6 Bank"],
		["Banco C6 S.A.", "C6 Bank"],
		["C6 Carbon Mastercard", "C6 Bank"],
		["Itaú Unibanco S.A.", "Itaú"],
		["Banco Bradesco S.A.", "Bradesco"],
		["Banco do Brasil S.A.", "Banco do Brasil"],
		["Caixa Econômica Federal", "Caixa"],
		["PicPay", "PicPay"],
	])("reconhece %s como %s", (name, bank) => {
		expect(meu([acc({ id: "1", name })])).toBe(bank);
		// O cartão também serve de pista quando a conta não diz o banco.
		expect(meu([acc({ id: "1", name: "Conta Corrente" }), card({ id: "2", name })])).toBe(bank);
	});

	it("sem banco no nome, usa o COMPE do transferNumber", () => {
		const accounts = [
			acc({ id: "1", name: "Conta Corrente", bankData: { transferNumber: "336/0001/12345-0" } }),
			card({ id: "2", name: "Mastercard Black" }),
		];
		expect(meu(accounts)).toBe("C6 Bank");
		expect(meu([acc({ id: "1", name: "Conta", bankData: { transferNumber: "1 / 1234 / 5678-9" } })])).toBe(
			"Banco do Brasil",
		);
		// "agência/conta" (dois trechos) não é COMPE.
		expect(
			meu([acc({ id: "1", name: "Conta Corrente", bankData: { transferNumber: "0336/12345-0" } })]),
		).toBe("Conta Corrente");
	});

	it("conector que é o banco vale mais que as contas", () => {
		expect(
			labelFromAccounts({
				connectorName: "Banco Bradesco S.A.",
				accounts: [acc({ id: "1", name: "Conta" })],
			}),
		).toBe("Bradesco");
		expect(labelFromAccounts({ connectorName: "Banco Exemplo", accounts: [] })).toBe("Banco Exemplo");
	});

	it("banco desconhecido: o nome da conta que não é só o tipo, sem o cartão", () => {
		expect(meu([acc({ id: "1", name: "BANCO EXEMPLO S.A." }), card({ id: "2", name: "Visa Gold" })])).toBe(
			"Banco Exemplo S.A.",
		);
		expect(meu([acc({ id: "1", name: "Conta Corrente" }), card({ id: "2", name: "Exemplo Platinum" })])).toBe(
			"Exemplo Platinum",
		);
		expect(meu([acc({ id: "1", name: "Conta Corrente" }), card({ id: "2", name: "Gold" })])).toBe(
			"Conta Corrente",
		);
	});

	it("saneia e limita a 60 letras", () => {
		const label = meu([acc({ id: "1", name: `  Banco\n\tExemplo ${"Z".repeat(90)}  ` })]);
		expect(label?.startsWith("Banco Exemplo")).toBe(true);
		expect(label?.length).toBeLessThanOrEqual(60);
		expect(label).not.toMatch(/\p{Cc}/u);
	});

	it("sem conta, ou sem nome, não há pista: null (nunca 'MeuPluggy')", () => {
		expect(meu([])).toBeNull();
		expect(meu([acc({ id: "1", name: " \n ", marketingName: "" })])).toBeNull();
		expect(labelFromAccounts({ connectorName: null, accounts: [] })).toBeNull();
	});
});

describe("isAutoLabel", () => {
	const inter = [acc({ id: "1", name: "BANCO INTER" }), card({ id: "2", name: "GOLD" })];
	it("reconhece os nomes que a sincronização antiga gerava", () => {
		expect(isAutoLabel("Inter, GOLD", inter)).toBe(true);
		// Cortado com reticências: só o rótulo antigo cortava assim, mesmo que o banco tenha mudado o nome depois.
		expect(isAutoLabel("Banco Santander Pessoa F…", [])).toBe(true);
		expect(isAutoLabel("Nu Pagamentos S.A. - Ins…, Gold", [])).toBe(true);
		expect(
			isAutoLabel("Conta Inter, Poupança +2", [
				acc({ id: "1", name: "Conta Inter" }),
				acc({ id: "2", name: "Poupança" }),
			]),
		).toBe(true);
		expect(isAutoLabel("", [])).toBe(true);
	});
	it("não confunde com nome que o dono digitou", () => {
		expect(isAutoLabel("Minha conta", inter)).toBe(false);
		expect(isAutoLabel("Inter do casal", inter)).toBe(false);
		expect(isAutoLabel("Inter, reserva", inter)).toBe(false);
		expect(isAutoLabel("Banco principal", [])).toBe(false);
	});
});

describe("labelIsReplaceable", () => {
	it("troca vazio, 'MeuPluggy' e o nome do conector; nunca o do dono", () => {
		expect(labelIsReplaceable(null, "MeuPluggy", false)).toBe(true);
		expect(labelIsReplaceable("  ", "MeuPluggy", false)).toBe(true);
		expect(labelIsReplaceable("Meu Pluggy", "MeuPluggy", false)).toBe(true);
		expect(labelIsReplaceable("MeuPluggy", null, false)).toBe(true);
		expect(labelIsReplaceable("MeuPluggy", "MeuPluggy", true)).toBe(false);
		expect(labelIsReplaceable("Reserva", "MeuPluggy", false)).toBe(false);
		expect(labelIsReplaceable("Banco Exemplo S.A.", "Banco Exemplo S.A.", false)).toBe(true);
		expect(labelIsReplaceable(null, "Nubank", false)).toBe(true);
	});
});

describe("chooseConnectionLabel", () => {
	const accounts = [acc({ id: "1", name: "BANCO INTER" }), card({ id: "2", name: "GOLD" })];
	const base = { connectorName: "MeuPluggy", editedByOwner: false, accounts };
	it("escolhe o nome, ou null quando nada muda", () => {
		expect(chooseConnectionLabel({ ...base, current: "MeuPluggy" })).toBe("Inter");
		expect(chooseConnectionLabel({ ...base, current: null })).toBe("Inter");
		expect(chooseConnectionLabel({ ...base, current: "Inter" })).toBeNull();
		expect(chooseConnectionLabel({ ...base, connectorName: "Nubank", current: "Nubank" })).toBeNull();
	});
	it("refaz o nome antigo já gravado (conta + cartão juntos, razão social cortada)", () => {
		expect(chooseConnectionLabel({ ...base, current: "Inter, GOLD" })).toBe("Inter");
		const nu = [
			acc({ id: "1", name: "Conta", marketingName: "Nu Pagamentos S.A. - Instituição de Pagamento" }),
			card({ id: "2", name: "gold" }),
		];
		expect(chooseConnectionLabel({ ...base, accounts: nu, current: "Nu Pagamentos S.A. - Ins…, Gold" })).toBe(
			"Nubank",
		);
		const santander = [acc({ id: "1", name: "Santander" }), card({ id: "2", name: "FREE VISA" })];
		expect(
			chooseConnectionLabel({ ...base, accounts: santander, current: "Banco Santander Pessoa F…" }),
		).toBe("Santander");
	});
	it("nunca troca o nome que o dono deu, nem o que não parece gerado", () => {
		expect(chooseConnectionLabel({ ...base, current: "Inter, GOLD", editedByOwner: true })).toBeNull();
		expect(chooseConnectionLabel({ ...base, current: "MeuPluggy", editedByOwner: true })).toBeNull();
		expect(chooseConnectionLabel({ ...base, current: "Conta do casal" })).toBeNull();
	});
	it("sem contas fica como está: não há pista do banco", () => {
		expect(chooseConnectionLabel({ ...base, current: "MeuPluggy", accounts: [] })).toBeNull();
		expect(chooseConnectionLabel({ ...base, current: null, accounts: [] })).toBeNull();
	});
});

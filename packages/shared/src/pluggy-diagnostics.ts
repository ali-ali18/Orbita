/*
 * Diagnóstico do Meu Pluggy: o que o Pluggy devolve AGORA, já redigido (sem CPF/CNPJ nem número de conta/cartão
 * completos). Só o dono autenticado lê. Os valores em dinheiro são os que o Pluggy mandou (reais, número ou texto),
 * só para mostrar: nada daqui entra em conta. Todo texto de terceiro é dado, nunca instrução.
 */

export type DiagMoney = number | string | null;

export interface DiagError {
	/** "not_found", "timeout"… ; nunca corpo de resposta. */
	code: string;
	status: number | null;
	message: string;
}

export interface DiagLink {
	kind: "card" | "account";
	id: string;
	name: string;
	archived: boolean;
}

export interface DiagBillPayment {
	date: string;
	amount: DiagMoney;
}

export interface DiagBill {
	dueDate: string | null;
	closingDate: string | null;
	totalAmount: DiagMoney;
	minimumPaymentAmount: DiagMoney;
	payments: DiagBillPayment[];
}

export interface DiagParty {
	name: string | null;
	/** Últimos dígitos do documento (ex.: "•••890"); nunca o número inteiro. */
	documentEnd: string | null;
}

export interface DiagTransaction {
	date: string;
	description: string | null;
	amount: DiagMoney;
	type: string;
	status: string | null;
	category: string | null;
	installmentNumber: number | null;
	totalInstallments: number | null;
	purchaseDate: string | null;
	merchantName: string | null;
	operationType: string | null;
	/** Começo do id da transação no banco (só Open Finance). */
	providerIdStart: string | null;
	billIdStart: string | null;
	billPostDate: string | null;
	billForecastDate: string | null;
	paymentType: string | null;
	payer: DiagParty | null;
	receiver: DiagParty | null;
}

export interface DiagAccount {
	/** Começo do ID da conta no Pluggy (8 letras): só para distinguir. */
	idStart: string;
	type: string;
	subtype: string | null;
	name: string;
	marketingName: string | null;
	numberLast4: string | null;
	balance: DiagMoney;
	currencyCode: string | null;
	credit: {
		creditLimit: DiagMoney;
		availableCreditLimit: DiagMoney;
		balanceCloseDate: string | null;
		balanceDueDate: string | null;
		minimumPayment: DiagMoney;
		brand: string | null;
		level: string | null;
	} | null;
	link: DiagLink | null;
	/** Só em conta de cartão. `bills.error` preenchido = `/bills` falhou (a lista fica vazia). */
	bills: { error: DiagError | null; list: DiagBill[] } | null;
	transactions: {
		error: DiagError | null;
		windowDays: number;
		posted: number;
		pending: number;
		other: number;
		dropped: number;
		/** Cartão: soma (compras menos créditos) dos PENDING, em R$ já formatado; `null` fora de cartão. */
		pendingTotal: string | null;
		recent: DiagTransaction[];
	};
}

export interface DiagConnection {
	/** Rótulo que o dono deu no Órbita. */
	label: string | null;
	itemIdStart: string;
	connectorName: string | null;
	status: string | null;
	executionStatus: string | null;
	lastUpdatedAt: string | null;
	connectorIsOpenFinance: boolean | null;
	connectorType: string | null;
	nextAutoSyncAt: string | null;
	consentExpiresAt: string | null;
	/** Por produto do item. */
	products: { name: string; isUpdated: boolean | null; lastUpdatedAt: string | null; warnings: string[] }[];
	itemError: { code: string | null; message: string | null } | null;
	/** Falha ao ler o item ou as contas (a conexão inteira). */
	error: DiagError | null;
	accounts: DiagAccount[];
}

export interface PluggyDiagnosticsResponse {
	generatedAt: string;
	connections: DiagConnection[];
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

function errorLine(e: DiagError): string {
	return `ERRO ${e.code}${e.status ? ` (HTTP ${e.status})` : ""}: ${e.message}`;
}

function party(label: string, p: DiagParty | null): string | null {
	if (!p || (!p.name && !p.documentEnd)) return null;
	return `${label}: ${show(p.name)} doc ${show(p.documentEnd)}`;
}

/** Cabeçalho da conexão (banco, estado do item, erros). */
export function formatDiagConnectionHead(c: DiagConnection): string {
	const out = [`Banco: ${show(c.connectorName)}`];
	out.push(
		`Item: status ${show(c.status)} · execução ${show(c.executionStatus)} · atualizado ${show(c.lastUpdatedAt)}`,
	);
	out.push(
		`Conector: Open Finance ${show(c.connectorIsOpenFinance)} · tipo ${show(c.connectorType)} · próxima sync ${show(c.nextAutoSyncAt)} · consentimento até ${show(c.consentExpiresAt)}`,
	);
	for (const p of c.products) {
		out.push(
			`  produto ${p.name}: atualizado ${show(p.isUpdated)} · em ${show(p.lastUpdatedAt)}${p.warnings.length ? ` · avisos: ${p.warnings.join(" | ")}` : ""}`,
		);
	}
	if (c.itemError) out.push(`Erro do item: ${show(c.itemError.code)} · ${show(c.itemError.message)}`);
	if (c.error) out.push(errorLine(c.error));
	return out.join("\n");
}

/** Uma conta: dados, crédito, ligação com o Órbita, faturas e lançamentos. */
export function formatDiagAccount(a: DiagAccount): string {
	const out: string[] = [];
	out.push(`Nome comercial: ${show(a.marketingName)} · final ${show(a.numberLast4)}`);
	out.push(`Saldo: ${show(a.balance)} ${show(a.currencyCode)}`);
	if (a.credit) {
		const k = a.credit;
		out.push(
			`Crédito: limite ${show(k.creditLimit)} · disponível ${show(k.availableCreditLimit)} · fecha ${show(k.balanceCloseDate)} · vence ${show(k.balanceDueDate)} · mínimo ${show(k.minimumPayment)} · ${show(k.brand)} ${show(k.level)}`,
		);
	}
	out.push(
		a.link
			? `Ligada no Órbita a: ${a.link.kind === "card" ? "cartão" : "conta"} "${a.link.name}" (${a.link.id})${a.link.archived ? " [arquivado]" : ""}`
			: "Ligada no Órbita a: não ligada",
	);
	if (a.bills) {
		out.push(a.bills.error ? `Faturas: ${errorLine(a.bills.error)}` : `Faturas: ${a.bills.list.length}`);
		for (const b of a.bills.list) {
			out.push(
				`  fatura vence ${show(b.dueDate)} · fecha ${show(b.closingDate)} · total ${show(b.totalAmount)} · mínimo ${show(b.minimumPaymentAmount)}`,
			);
			for (const p of b.payments) out.push(`    pagamento ${show(p.date)} · ${show(p.amount)}`);
		}
	}
	const t = a.transactions;
	if (t.error) out.push(`Lançamentos: ${errorLine(t.error)}`);
	else {
		out.push(
			`Lançamentos (${t.windowDays} dias): ${t.posted} POSTED · ${t.pending} PENDING${t.pendingTotal ? ` (total PENDING ${t.pendingTotal})` : ""}${t.other ? ` · ${t.other} outros` : ""}${t.dropped ? ` · ${t.dropped} fora do formato` : ""}`,
		);
	}
	for (const x of t.recent) {
		const parcel =
			x.installmentNumber || x.totalInstallments
				? ` parcela ${show(x.installmentNumber)}/${show(x.totalInstallments)}`
				: "";
		out.push(
			`  ${x.date} · ${show(x.description)} · ${show(x.amount)} · ${x.type} · ${show(x.status)} · cat ${show(x.category)}${parcel}${x.purchaseDate ? ` compra ${x.purchaseDate}` : ""}${x.merchantName ? ` · loja ${x.merchantName}` : ""}`,
		);
		const extra = [
			x.operationType && `op ${x.operationType}`,
			x.providerIdStart && `providerId ${x.providerIdStart}…`,
			x.billIdStart && `fatura ${x.billIdStart}…`,
			x.billPostDate && `lançada na fatura em ${x.billPostDate}`,
			x.billForecastDate && `previsão fatura ${x.billForecastDate}`,
			x.paymentType && `pagamento ${x.paymentType}`,
		].filter(Boolean);
		if (extra.length) out.push(`    ${extra.join(" · ")}`);
		for (const line of [party("pagador", x.payer), party("recebedor", x.receiver)]) {
			if (line) out.push(`    ${line}`);
		}
	}
	return out.join("\n");
}

export const diagAccountTitle = (a: DiagAccount) =>
	`Conta ${a.idStart}… · ${a.type}/${show(a.subtype)} · ${a.name}`;
export const diagConnectionTitle = (c: DiagConnection) => `Conexão ${show(c.label)} (item ${c.itemIdStart}…)`;

/** O diagnóstico inteiro como texto puro, para o dono copiar e mandar. */
export function formatPluggyDiagnostics(d: PluggyDiagnosticsResponse): string {
	const out: string[] = [`Diagnóstico do Meu Pluggy · ${d.generatedAt}`];
	if (d.connections.length === 0) out.push("", "Nenhuma conexão cadastrada.");
	for (const c of d.connections) {
		out.push("", `== ${diagConnectionTitle(c)} ==`, formatDiagConnectionHead(c));
		for (const a of c.accounts) out.push("", `-- ${diagAccountTitle(a)}`, formatDiagAccount(a));
	}
	return out.join("\n");
}

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

export interface DiagInvestmentTransaction {
	date: string | null;
	type: string | null;
	movementType: string | null;
	amount: DiagMoney;
	quantity: DiagMoney;
	value: DiagMoney;
	description: string | null;
}

/** Uma posição, com os campos como o Pluggy mandou (reais; `null` = não veio). */
export interface DiagInvestment {
	idStart: string;
	type: string | null;
	subtype: string | null;
	name: string | null;
	code: string | null;
	isin: string | null;
	currencyCode: string | null;
	/** Saldo líquido. */
	balance: DiagMoney;
	/** Valor bruto. */
	amount: DiagMoney;
	/** Valor aplicado. */
	amountOriginal: DiagMoney;
	/** Rendimento informado pelo banco. */
	amountProfit: DiagMoney;
	amountWithdrawal: DiagMoney;
	taxes: DiagMoney;
	taxes2: DiagMoney;
	quantity: DiagMoney;
	/** Valor da cota / preço unitário. */
	value: DiagMoney;
	rate: DiagMoney;
	rateType: string | null;
	fixedAnnualRate: DiagMoney;
	annualRate: DiagMoney;
	lastMonthRate: DiagMoney;
	lastTwelveMonthsRate: DiagMoney;
	/** Data da posição (referência do valor). */
	date: string | null;
	dueDate: string | null;
	issueDate: string | null;
	purchaseDate: string | null;
	status: string | null;
	issuer: string | null;
	institutionName: string | null;
	/** NOMES de outros campos que vieram preenchidos e o Órbita ainda não lê (nunca os valores). */
	otherFields: string[];
	/** `null` = não consultado (passou do teto de posições com movimentações). */
	transactions: {
		outcome: "ok" | "unavailable" | "error";
		error: DiagError | null;
		count: number;
		dropped: number;
		firstDate: string | null;
		lastDate: string | null;
		/** Quantas por tipo (BUY, SELL, INTEREST…). */
		byType: { type: string; count: number }[];
		recent: DiagInvestmentTransaction[];
	} | null;
}

/**
 * Investimentos de uma conexão. `outcome`: "ok" (vieram posições), "empty" (o endpoint respondeu com lista vazia),
 * "unavailable" (o endpoint recusou com 403/404: o conector não entrega o produto) ou "error" (rede, timeout, 5xx…).
 */
export interface DiagInvestments {
	outcome: "ok" | "empty" | "unavailable" | "error";
	error: DiagError | null;
	/** Posições que vieram (todas, mesmo as não listadas em `positions`). */
	count: number;
	dropped: number;
	/** Soma dos saldos em BRL, já formatada; `null` se não há saldo legível. */
	balanceTotal: string | null;
	/** "INVESTMENTS" está nos produtos pedidos para o item? `null` = o item não informa. */
	productRequested: boolean | null;
	transactionsProductRequested: boolean | null;
	/** A autorização do item (`consentExpiresAt`) já venceu? A doc diz que aí as leituras voltam vazias. */
	consentExpired: boolean | null;
	/** Avisos de investimentos no `statusDetail` do item. */
	warnings: string[];
	positions: DiagInvestment[];
	/** Soma das movimentações de todas as posições consultadas e o intervalo de datas. */
	transactionsCount: number;
	transactionsFirstDate: string | null;
	transactionsLastDate: string | null;
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
	/** `null` quando nem o item pôde ser lido. */
	investments: DiagInvestments | null;
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

/** Por que não veio posição nenhuma: só o que foi OBSERVADO na resposta, sem adivinhar. */
export function diagInvestmentsReason(i: DiagInvestments): string | null {
	if (i.outcome === "ok") return null;
	if (i.outcome === "unavailable") {
		return `produto não suportado pelo conector: o endpoint recusou${i.error?.status ? ` (HTTP ${i.error.status})` : ""}`;
	}
	if (i.outcome === "error") return `erro ao consultar${i.error ? `: ${errorLine(i.error)}` : ""}`;
	const hints: string[] = [];
	if (i.consentExpired) hints.push("a autorização do item venceu (consentExpiresAt no passado)");
	if (i.productRequested === false) hints.push("INVESTMENTS não está nos produtos do item");
	if (i.warnings.length) hints.push(`avisos do item: ${i.warnings.join(" | ")}`);
	if (i.dropped) hints.push(`${i.dropped} posição(ões) fora do formato foram descartadas`);
	return `endpoint vazio: respondeu sem nenhuma posição${hints.length ? ` · ${hints.join(" · ")}` : ""}`;
}

const field = (label: string, v: unknown) =>
	v === null || v === undefined || v === "" ? null : `${label} ${v}`;

function formatDiagInvestment(p: DiagInvestment): string[] {
	const out = [`• ${show(p.type)}/${show(p.subtype)} · ${show(p.name)} (${p.idStart}…)`];
	out.push(
		`  saldo ${show(p.balance)} · bruto ${show(p.amount)} · aplicado ${show(p.amountOriginal)} · rendimento ${show(p.amountProfit)} · ${show(p.currencyCode)}`,
	);
	out.push(
		`  quantidade ${show(p.quantity)} · cota/preço ${show(p.value)} · taxa ${show(p.rate)}${p.rateType ? ` ${p.rateType}` : ""} · fixa a.a. ${show(p.fixedAnnualRate)}`,
	);
	out.push(`  vencimento ${show(p.dueDate)} · data da posição ${show(p.date)} · status ${show(p.status)}`);
	const extra = [
		field("código", p.code),
		field("ISIN", p.isin),
		field("resgatável", p.amountWithdrawal),
		field("IR", p.taxes),
		field("IOF", p.taxes2),
		field("rent. mês", p.lastMonthRate),
		field("rent. ano", p.annualRate),
		field("rent. 12m", p.lastTwelveMonthsRate),
		field("emissão", p.issueDate),
		field("compra", p.purchaseDate),
		field("emissor", p.issuer),
		field("instituição", p.institutionName),
	].filter(Boolean);
	if (extra.length) out.push(`  ${extra.join(" · ")}`);
	if (p.otherFields.length) out.push(`  outros campos preenchidos: ${p.otherFields.join(", ")}`);
	const t = p.transactions;
	if (!t) out.push("  movimentações: não consultadas");
	else if (t.outcome !== "ok") {
		out.push(
			`  movimentações: ${t.outcome === "unavailable" ? "não disponíveis · " : ""}${t.error ? errorLine(t.error) : "—"}`,
		);
	} else {
		const types = t.byType.map((x) => `${x.count} ${x.type}`).join(" · ");
		out.push(
			`  movimentações: ${t.count}${t.count ? ` · de ${show(t.firstDate)} a ${show(t.lastDate)} · ${types}` : ""}${t.dropped ? ` · ${t.dropped} fora do formato` : ""}`,
		);
		for (const x of t.recent) {
			out.push(
				`    ${show(x.date)} · ${show(x.type)}${x.movementType ? `/${x.movementType}` : ""} · ${show(x.amount)}${x.quantity === null ? "" : ` · qtd ${x.quantity}`}${x.value === null ? "" : ` · preço ${x.value}`}${x.description ? ` · ${x.description}` : ""}`,
			);
		}
	}
	return out;
}

/** A seção "Investimentos" de uma conexão: se o endpoint respondeu, as posições e as movimentações, ou o motivo. */
export function formatDiagInvestments(i: DiagInvestments | null | undefined): string {
	if (!i) return "Não consultado (o item não pôde ser lido ou o servidor ainda não tem esta seção).";
	const out: string[] = [];
	const answered = i.outcome === "ok" || i.outcome === "empty";
	out.push(
		`Endpoint /investments: ${answered ? "respondeu" : i.outcome === "unavailable" ? "recusou" : "falhou"} · ${i.count} ${i.count === 1 ? "posição" : "posições"}${i.outcome === "ok" && i.dropped ? ` · ${i.dropped} fora do formato` : ""}`,
	);
	const reason = diagInvestmentsReason(i);
	if (reason) out.push(`Motivo observado: ${reason}`);
	out.push(
		`Produtos do item: INVESTMENTS ${show(i.productRequested)} · INVESTMENTS_TRANSACTIONS ${show(i.transactionsProductRequested)}`,
	);
	if (i.outcome === "ok") {
		if (i.warnings.length) out.push(`Avisos do item: ${i.warnings.join(" | ")}`);
		out.push(`Soma dos saldos (BRL): ${show(i.balanceTotal)}`);
		out.push(
			`Movimentações: ${i.transactionsCount}${i.transactionsCount ? ` · de ${show(i.transactionsFirstDate)} a ${show(i.transactionsLastDate)}` : ""}`,
		);
		if (i.positions.length < i.count) out.push(`Mostrando ${i.positions.length} de ${i.count} posições.`);
		for (const p of i.positions) out.push("", ...formatDiagInvestment(p));
	}
	return out.join("\n");
}

export const diagInvestmentsTitle = (c: DiagConnection) => `Investimentos · ${show(c.label)}`;
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
		out.push("", `-- ${diagInvestmentsTitle(c)}`, formatDiagInvestments(c.investments));
	}
	return out.join("\n");
}

import type { Cents, LocalDate } from "@orbita/core";
import { type Brand, brandOf } from "../../lib/brands.ts";
import { relativeDate } from "../../lib/format.ts";
import type { IconName } from "../../ui/index.ts";

export interface TransactionLike {
	kind: "expense" | "income" | "transfer" | "card_payment" | "refund" | "investment" | "redemption";
	amountCents: Cents;
	date: LocalDate;
	accountId: string | null;
	cardId: string | null;
	installmentNumber: number | null;
	installmentCount: number | null;
	status: "pending" | "confirmed";
	/** O banco ainda não efetivou (compra da fatura aberta). Não é "Para revisar": conta no gasto. */
	bankPending?: boolean | undefined;
}

/**
 * Selo da linha: "Pendente" é o "Para revisar" do Órbita (`status`); "Pendente no banco" é a compra que o banco ainda
 * não efetivou (`bankPending`). Os dois não se confundem: o primeiro pede sua conferência, o segundo só informa.
 */
export function transactionBadge(t: Pick<TransactionLike, "status" | "bankPending">): string | undefined {
	if (t.status === "pending") return "Pendente";
	return t.bankPending ? "Pendente no banco" : undefined;
}

/** Sinal do valor: saída −, entrada +, movimento entre contas sem sinal. A cor vem de `amountTone`. */
export function signedAmount(t: Pick<TransactionLike, "kind" | "amountCents">): Cents {
	if (t.kind === "expense" || t.kind === "investment") return -t.amountCents;
	return t.amountCents;
}

/**
 * Cor do valor de dinheiro (aplicação em investimento é neutra: o dinheiro foi guardado, não gasto): o que entra (receita, estorno, pagamento de fatura) é verde (`positive`), a saída
 * segue branca e a transferência entre contas próprias é neutra, porque o dinheiro só mudou de lugar.
 */
export function amountTone(kind: TransactionLike["kind"]): "positive" | "primary" | "secondary" {
	switch (kind) {
		case "income":
		case "refund":
		case "card_payment":
			return "positive";
		case "transfer":
		case "investment":
		case "redemption":
			return "secondary";
		case "expense":
			return "primary";
	}
}

export function amountSignMode(kind: TransactionLike["kind"]): "always" | "never" {
	return kind === "transfer" || kind === "card_payment" ? "never" : "always";
}

/** "Hoje · Nubank ••••0695 · 2/3 · Para revisar". */
export function transactionCaption(
	t: TransactionLike,
	today: LocalDate,
	sources: {
		accounts: ReadonlyMap<string, { name: string }>;
		cards: ReadonlyMap<string, { name: string; last4: string | null }>;
	},
): string {
	const parts: string[] = [relativeDate(t.date, today)];
	const card = t.cardId ? sources.cards.get(t.cardId) : undefined;
	const account = t.accountId ? sources.accounts.get(t.accountId) : undefined;
	if (card) parts.push(card.last4 ? `${card.name} ••••${card.last4}` : card.name);
	else if (account) parts.push(account.name);
	if (t.installmentNumber !== null && t.installmentCount !== null) {
		parts.push(`${t.installmentNumber}/${t.installmentCount}`);
	}
	if (t.status === "pending") parts.push("Para revisar");
	else if (t.bankPending) parts.push("Pendente no banco");
	return parts.join(" · ");
}

/** Letras do círculo quando não há logo: primeira letra do nome, maiúscula. */
export function initialOf(name: string): string {
	return name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "·";
}

/** Ícone de cada categoria do sistema, pelo slug (o slug não muda depois de criado). */
const SLUG_ICON: Readonly<Record<string, IconName>> = {
	mercado: "mercado",
	delivery: "comida",
	transporte: "transporte",
	assinaturas: "assinatura",
	lazer: "lazer",
	moradia: "inicio",
	saude: "saude",
	transferencias: "transferir",
	investimentos: "investimento",
	outros: "etiqueta",
	salario: "salario",
	"fatura-cartao": "cartao",
};

/**
 * Categoria criada pelo dono não tem slug conhecido: procura palavras do nome (sem acento) na ordem da lista.
 * Cada palavra casa o começo de uma palavra do nome ("farmac" casa "Farmácia").
 */
const NAME_ICON: ReadonlyArray<readonly [IconName, readonly string[]]> = [
	["mercado", ["mercad", "supermerc", "feira", "hortifruti", "açougue", "acougue"]],
	["comida", ["restaurante", "lanche", "padaria", "cafe", "pizza", "delivery", "comida", "aliment"]],
	[
		"transporte",
		["transport", "uber", "combust", "gasolina", "estacion", "onibus", "metro", "carro", "pedagio"],
	],
	[
		"saude",
		["saude", "farmac", "medic", "dentist", "consulta", "exame", "hospital", "plano de saude", "academia"],
	],
	["educacao", ["educa", "escola", "curso", "faculdade", "livro", "mensalidade"]],
	["assinatura", ["assinat", "stream"]],
	["inicio", ["moradia", "casa", "aluguel", "condominio", "luz", "energia", "agua", "internet", "reforma"]],
	["lazer", ["lazer", "cinema", "jogo", "game", "show", "festa", "diversao"]],
	["aviao", ["viagem", "viagens", "hotel", "passagem", "turismo"]],
	["compras", ["compra", "roupa", "vestuario", "shopping", "eletro", "presente"]],
	["salario", ["salario", "renda", "freela", "pagamento recebido"]],
	["investimento", ["invest", "poupanca", "reserva", "cofrinho"]],
	["transferir", ["transfer"]],
	["cartao", ["fatura", "cartao"]],
];

const plain = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Ícone da categoria: pelo slug do sistema; senão pelas palavras do nome; senão "etiqueta" (Outros). */
export function categoryIcon(slug: string | undefined, name?: string | undefined): IconName {
	const bySlug = slug === undefined ? undefined : SLUG_ICON[slug];
	if (bySlug) return bySlug;
	const words = plain(name ?? "")
		.split(/[^a-z0-9]+/)
		.filter((w) => w !== "");
	if (words.length > 0) {
		const text = ` ${words.join(" ")} `;
		for (const [icon, stems] of NAME_ICON) {
			if (stems.some((stem) => text.includes(` ${plain(stem)}`))) return icon;
		}
	}
	return "etiqueta";
}

/**
 * Ícone do lançamento (Figma: "Icone/<nome>" dentro do disco de 44). Despesa segue a categoria (slug do sistema ou
 * palavras do nome da categoria do dono, ver `categoryIcon`). Entrada é "salario", aplicação e resgate são
 * "investimento", Pix/transferência é "pix".
 */
export function transactionIcon(
	kind: TransactionLike["kind"],
	categorySlug: string | undefined,
	categoryName?: string | undefined,
): IconName {
	switch (kind) {
		case "income":
			return "salario";
		case "investment":
		case "redemption":
			return "investimento";
		case "transfer":
			return "pix";
		case "card_payment":
			return "cartao";
		case "refund":
			return "desfazer";
		case "expense":
			return categoryIcon(categorySlug, categoryName);
	}
}

/** Marca da loja ou serviço de uma despesa (ou estorno) pelo texto do lançamento; os outros tipos não têm marca. */
export function transactionBrand(t: { kind: TransactionLike["kind"]; description: string }): Brand | null {
	return t.kind === "expense" || t.kind === "refund" ? brandOf(t.description) : null;
}

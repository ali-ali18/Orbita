import { addDays, type Cents, formatBRL, type LocalDate } from "@orbita/core";
import {
	type InstallmentCreateBody,
	installmentCreateBody,
	isLocalDate,
	MAX_CENTS,
	MAX_INSTALLMENT_COUNT,
	type TransactionApiCreateBody,
	transactionApiCreateBody,
} from "@orbita/shared";
import { chart, chartSeries } from "@orbita/tokens";
import { monthName } from "../../lib/format.ts";

/*
 * Lógica pura da tela "Novo lançamento": valor em centavos, escolha de conta/cartão, parcelas, data
 * e montagem do corpo da requisição. Nenhuma conta de fatura ou de parcela exata: isso é do servidor
 * (a prévia da parcela é só uma estimativa com "~").
 */

export type EntryKind = "expense" | "income";

export interface NewTransactionForm {
	kind: EntryKind;
	amountCents: Cents;
	description: string;
	/** `account:<id>` ou `card:<id>`; `null` = ainda não escolheu (vale a primeira da lista). */
	sourceKey: string | null;
	/** 1 = à vista. */
	installments: number;
	date: LocalDate;
	categoryId: string | null;
}

export function initialForm(today: LocalDate): NewTransactionForm {
	return {
		kind: "expense",
		amountCents: 0,
		description: "",
		sourceKey: null,
		installments: 1,
		date: today,
		categoryId: null,
	};
}

// ------------------------------------------------------------------ valor

/**
 * Teclado de centavos: o campo de texto escondido guarda só os dígitos digitados; "4690" vale
 * R$ 46,90. Passou do teto aceito pela API? Ignora o último dígito e mantém o valor anterior.
 */
export function applyAmountText(previous: Cents, text: string): Cents {
	const digits = text.replace(/\D/g, "").replace(/^0+/, "");
	if (digits === "") return 0;
	if (digits.length > String(MAX_CENTS).length) return previous;
	const value = Number(digits);
	return Number.isSafeInteger(value) && value <= MAX_CENTS ? value : previous;
}

/** O que o campo escondido mostra de volta: os dígitos do valor ("" para zero). */
export function amountToDigits(cents: Cents): string {
	return cents > 0 ? String(cents) : "";
}

/** "R$ 46,90", sempre com o símbolo (o valor ainda não digitado aparece como "R$ 0,00"). */
export function formatAmount(cents: Cents): string {
	return formatBRL(cents);
}

// ------------------------------------------------------ conta ou cartão

export interface SourceOption {
	key: string;
	type: "account" | "card";
	id: string;
	name: string;
	bankCode: string | null;
	/** Cartão com os 4 últimos dígitos: "••••0695". */
	detail: string | null;
	/** Como aparece no campo: "Nubank · crédito" para cartão. */
	label: string;
}

interface AccountLike {
	id: string;
	name: string;
	bankCode: string | null;
	archivedAt: string | null;
}
interface CardLike extends AccountLike {
	last4: string | null;
}

/**
 * Onde o lançamento pode cair. Receita só entra em conta (cashback é estorno), então no modo
 * "Entrada" os cartões somem. Contas e cartões arquivados não aparecem.
 */
export function sourceOptions(
	kind: EntryKind,
	accounts: readonly AccountLike[],
	cards: readonly CardLike[],
): SourceOption[] {
	const fromAccounts = accounts
		.filter((a) => a.archivedAt === null)
		.map<SourceOption>((a) => ({
			key: `account:${a.id}`,
			type: "account",
			id: a.id,
			name: a.name,
			bankCode: a.bankCode,
			detail: null,
			label: a.name,
		}));
	if (kind === "income") return fromAccounts;
	const fromCards = cards
		.filter((c) => c.archivedAt === null)
		.map<SourceOption>((c) => ({
			key: `card:${c.id}`,
			type: "card",
			id: c.id,
			name: c.name,
			bankCode: c.bankCode,
			detail: c.last4 ? `••••${c.last4}` : null,
			label: `${c.name} · crédito`,
		}));
	return [...fromAccounts, ...fromCards];
}

/** A escolhida, ou a primeira da lista enquanto o usuário não escolheu (ou se a escolhida saiu da lista). */
export function effectiveSource(
	sourceKey: string | null,
	options: readonly SourceOption[],
): SourceOption | null {
	return options.find((o) => o.key === sourceKey) ?? options[0] ?? null;
}

/** Só despesa no cartão parcela. */
export function canInstall(kind: EntryKind, source: SourceOption | null): boolean {
	return kind === "expense" && source?.type === "card";
}

/** Troca Saída/Entrada: Entrada nunca fica com cartão nem com parcelas. */
export function withKind(form: NewTransactionForm, kind: EntryKind): NewTransactionForm {
	if (kind === form.kind) return form;
	const keepSource = kind === "expense" || form.sourceKey?.startsWith("account:");
	return {
		...form,
		kind,
		sourceKey: keepSource ? form.sourceKey : null,
		installments: kind === "income" ? 1 : form.installments,
	};
}

/** Trocar para conta zera as parcelas (só cartão parcela). */
export function withSource(form: NewTransactionForm, key: string): NewTransactionForm {
	return { ...form, sourceKey: key, installments: key.startsWith("card:") ? form.installments : 1 };
}

// --------------------------------------------------------------- parcelas

export const INSTALLMENT_COUNTS: readonly number[] = Array.from(
	{ length: MAX_INSTALLMENT_COUNT },
	(_, i) => i + 1,
);

/**
 * Estimativa do valor de cada parcela, só para mostrar "6× de ~R$ 7,82". O servidor divide de
 * verdade (a diferença de centavos vai numa parcela). Arredonda ao centavo mais próximo, em inteiros.
 */
export function installmentPreview(totalCents: Cents, count: number): Cents | null {
	if (count < 2 || totalCents <= 0) return null;
	return Math.floor((totalCents * 2 + count) / (count * 2));
}

/** "À vista", "6×" ou, com valor, "6× de ~R$ 7,82". */
export function installmentLabel(count: number, totalCents: Cents): string {
	if (count < 2) return "À vista";
	const each = installmentPreview(totalCents, count);
	return each === null ? `${count}×` : `${count}× de ~${formatBRL(each)}`;
}

// ------------------------------------------------------------------ data

/** "6 de novembro" ou, de outro ano, "6 de novembro de 2025". */
function longDate(date: LocalDate, today: LocalDate): string {
	const day = Number(date.slice(8, 10));
	const month = monthName(date.slice(0, 7)).toLocaleLowerCase("pt-BR");
	const base = `${day} de ${month}`;
	return date.slice(0, 4) === today.slice(0, 4) ? base : `${base} de ${date.slice(0, 4)}`;
}

/** "Hoje, 6 de novembro", "Ontem, 5 de novembro" ou "3 de novembro". */
export function formatEntryDate(date: LocalDate, today: LocalDate): string {
	if (date === today) return `Hoje, ${longDate(date, today)}`;
	if (date === addDays(today, -1)) return `Ontem, ${longDate(date, today)}`;
	return longDate(date, today);
}

/** Atalhos do seletor de data: hoje e os dois dias anteriores. */
export function quickDates(today: LocalDate): LocalDate[] {
	return [today, addDays(today, -1), addDays(today, -2)];
}

/** "05/11/2026" (ou só dígitos, "05112026") para "2026-11-05"; `null` se não existe no calendário. */
export function parseBrDate(text: string): LocalDate | null {
	const digits = text.replace(/\D/g, "");
	if (digits.length !== 8) return null;
	const iso = `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
	return isLocalDate(iso) ? iso : null;
}

/** Máscara de digitação: "05112026" vira "05/11/2026". */
export function maskBrDate(text: string): string {
	const d = text.replace(/\D/g, "").slice(0, 8);
	if (d.length <= 2) return d;
	if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
	return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

// ------------------------------------------------------------- categorias

/** Bolinha da categoria: a cor do espaço no gráfico (0..4) ou o cinza de "Outros". */
export function categoryDot(chartSlot: number | null): string {
	return (chartSlot === null ? undefined : chartSeries[chartSlot]) ?? chart.other;
}

// -------------------------------------------------------------- requisição

export type SubmitRequest =
	| { type: "single"; body: TransactionApiCreateBody }
	| { type: "installments"; body: InstallmentCreateBody };

export type BuildResult = { ok: true; request: SubmitRequest } | { ok: false; message: string };

function firstMessage(error: { issues: readonly { message: string }[] }): string {
	return error.issues[0]?.message ?? "Confira os dados do lançamento.";
}

/**
 * Valida na borda com os mesmos schemas da API e monta o corpo. Despesa em cartão com 2+ parcelas
 * vai para `/installments`; o resto é um lançamento à vista. Devolve a primeira mensagem em pt-BR.
 */
export function buildRequest(form: NewTransactionForm, source: SourceOption | null): BuildResult {
	if (!source) return { ok: false, message: "Escolha a conta ou o cartão." };
	const description = form.description.trim();
	const categoryId = form.categoryId ? { categoryId: form.categoryId } : {};

	if (form.installments > 1) {
		if (!canInstall(form.kind, source)) {
			return { ok: false, message: "Só compra no cartão pode ser parcelada." };
		}
		const parsed = installmentCreateBody.safeParse({
			cardId: source.id,
			totalCents: form.amountCents,
			count: form.installments,
			date: form.date,
			description,
			...categoryId,
		});
		return parsed.success
			? { ok: true, request: { type: "installments", body: parsed.data } }
			: { ok: false, message: firstMessage(parsed.error) };
	}

	const parsed = transactionApiCreateBody.safeParse({
		kind: form.kind,
		amountCents: form.amountCents,
		date: form.date,
		description,
		...(source.type === "card" ? { cardId: source.id } : { accountId: source.id }),
		...categoryId,
	});
	return parsed.success
		? { ok: true, request: { type: "single", body: parsed.data } }
		: { ok: false, message: firstMessage(parsed.error) };
}

/** Consultas do Início que mudam quando entra um lançamento (a chave é `[baseUrl, assunto, …]`). */
const AFFECTED_QUERIES: ReadonlySet<unknown> = new Set([
	"summary",
	"transactions",
	"invoice",
	"installments",
]);

export function isAffectedByNewTransaction(queryKey: readonly unknown[], baseUrl: string): boolean {
	return queryKey[0] === baseUrl && AFFECTED_QUERIES.has(queryKey[1]);
}

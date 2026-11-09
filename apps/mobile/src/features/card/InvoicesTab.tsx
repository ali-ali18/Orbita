import { daysBetween } from "@orbita/core";
import { spacing } from "@orbita/tokens";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { money, monthName } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { ErrorState, Segmented, Skeleton, Text } from "../../ui/index.ts";
import { useCategories, useInvoice, useInvoicesOverview } from "../summary/queries.ts";
import {
	type CardLike,
	defaultInvoiceMonth,
	INVOICE_FILTERS,
	type InvoiceFilter,
	invoiceDatesCaption,
	monthChipLabel,
	monthWindow,
	openInvoiceMonth,
	type PaymentStatusLike,
	payableCents,
	paymentBadge,
	statusOfMonth,
} from "./card-model.ts";
import { InvoiceComposition } from "./InvoiceComposition.tsx";
import { InvoiceHistoryChart } from "./InvoiceHistoryChart.tsx";
import { InvoiceLines } from "./InvoiceLines.tsx";
import { InvoiceOverviewCard } from "./InvoiceOverviewCard.tsx";
import { dueShort, historyBars } from "./invoices-model.ts";
import { MonthChips } from "./MonthChips.tsx";
import { PayInvoice } from "./PayInvoice.tsx";
import { BigNumber, BleedRow, CardChip, Notice } from "./parts.tsx";
import { useInvoiceTotals } from "./queries.ts";

/** "em 4 dias", "amanhã", "hoje" (ou "venceu" se já passou). */
function untilText(days: number): string {
	if (days < 0) return "venceu";
	if (days === 0) return "hoje";
	return days === 1 ? "amanhã" : `em ${days} dias`;
}

/** Aba Faturas: cartão, total, mês, composição e lançamentos. */
export function InvoicesTab({
	cards,
	today,
	hidden,
	initialCardId,
}: {
	cards: readonly CardLike[];
	today: string;
	hidden: boolean;
	initialCardId: string | undefined;
}) {
	// `null` é "Todos": a visão geral (total, barras dos meses e uma fatura por cartão). Com um cartão, o detalhe dele.
	const [cardId, setCardId] = useState<string | null>(() => initialCardId ?? null);
	const card = cardId ? (cards.find((c) => c.id === cardId) ?? null) : null;
	const overviewQ = useInvoicesOverview();
	const overview = toLoadable(overviewQ);
	// Escolha de mês por cartão: trocar de cartão volta para a fatura padrão dele.
	const [picked, setPicked] = useState<{ cardId: string; month: string } | null>(null);
	const [filter, setFilter] = useState<InvoiceFilter>("all");
	const month = card
		? picked?.cardId === card.id
			? picked.month
			: defaultInvoiceMonth(card, today)
		: undefined;

	const invoiceQ = useInvoice(card?.id, month);
	const categoriesQ = useCategories();
	const invoice = toLoadable(invoiceQ);

	const months = useMemo(() => (card ? monthWindow(openInvoiceMonth(card, today)) : []), [card, today]);
	const totals = useInvoiceTotals(card ? months.map((month) => ({ cardId: card.id, month })) : []);
	const options = months.map((month, index) => ({
		month,
		status: monthChipLabel(
			card ? statusOfMonth(card, month, today) : "open",
			totals[index]?.data?.invoice.paymentStatus as PaymentStatusLike | undefined,
		),
	}));

	const chips = (
		<BleedRow>
			<CardChip card={null} selected={card === null} onPress={() => setCardId(null)} />
			{cards.map((c) => (
				<CardChip key={c.id} card={c} selected={c.id === card?.id} onPress={() => setCardId(c.id)} />
			))}
		</BleedRow>
	);

	const history =
		overview.phase === "ready" ? (
			<InvoiceHistoryChart bars={historyBars(overview.data.history, card?.id ?? null)} hidden={hidden} />
		) : overview.phase === "loading" ? (
			<Skeleton height={180} />
		) : (
			<ErrorState message={overview.message} onRetry={overview.retry} />
		);

	if (!card || !month) {
		return (
			<View style={{ gap: spacing.lg }}>
				{overview.phase === "ready" ? (
					<BigNumber
						label={`Total em faturas em ${monthName(today.slice(0, 7)).toLocaleLowerCase("pt-BR")}`}
						value={money(overview.data.owedCents, hidden, { sign: "never" })}
						caption={
							overview.data.nextDueDate
								? `Próximo vencimento ${dueShort(overview.data.nextDueDate)} (${untilText(daysBetween(today, overview.data.nextDueDate))})`
								: "Nenhuma fatura a pagar"
						}
					/>
				) : overview.phase === "loading" ? (
					<View accessibilityLabel="Carregando faturas" style={{ gap: spacing.sm }}>
						<Skeleton width="60%" height={40} />
						<Skeleton width="50%" height={14} />
					</View>
				) : null}
				{history}
				{chips}
				{overview.phase === "ready"
					? overview.data.cards.map((line) => (
							<InvoiceOverviewCard
								key={line.card.id}
								line={line}
								hidden={hidden}
								onPress={() => setCardId(line.card.id)}
							/>
						))
					: null}
				{overview.phase === "ready" &&
				overview.data.cards.some((l) => l.due.source === "ledger" || l.limit.source === "estimated") ? (
					<Notice text="Alguns valores são estimados pelo Órbita." />
				) : null}
			</View>
		);
	}

	return (
		<View style={{ gap: spacing.lg }}>
			{chips}
			{history}

			{invoice.phase === "ready" ? (
				<BigNumber
					label={card.name}
					value={money(invoice.data.composition.totalCents, hidden)}
					caption={invoiceDatesCaption(invoice.data.invoice)}
					badge={paymentBadge(invoice.data.invoice, invoice.data.composition.totalCents, (c) =>
						money(c, hidden),
					)}
				/>
			) : (
				<View style={{ gap: spacing.sm }}>
					<Text variant="cardTitle" tone="secondary">
						{card.name}
					</Text>
					{invoice.phase === "loading" ? (
						<View accessibilityLabel="Carregando a fatura" style={{ gap: spacing.sm }}>
							<Skeleton width="60%" height={40} />
							<Skeleton width="50%" height={14} />
						</View>
					) : null}
				</View>
			)}

			<MonthChips
				options={options}
				value={month}
				onChange={(m) => setPicked({ cardId: card.id, month: m })}
			/>

			{invoice.phase === "error" ? (
				<ErrorState message={invoice.message} onRetry={invoice.retry} />
			) : invoice.phase === "loading" ? (
				<Skeleton height={220} />
			) : (
				<>
					<InvoiceComposition data={invoice.data} hidden={hidden} />
					{invoice.data.invoice.status !== "overdue" ? (
						<Notice text="Valor estimado. O banco pode levar até 3 dias para mandar compras recentes." />
					) : null}
					<Segmented options={INVOICE_FILTERS} value={filter} onChange={setFilter} />
					<InvoiceLines
						lines={invoice.data.transactions}
						categories={categoriesQ.data?.categories ?? []}
						filter={filter}
						hidden={hidden}
					/>
					<PayInvoice
						key={`${card.id}:${month}`}
						cardId={card.id}
						month={month}
						remainingCents={payableCents(invoice.data.invoice, invoice.data.composition.totalCents)}
						hidden={hidden}
					/>
				</>
			)}
		</View>
	);
}

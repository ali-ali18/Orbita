import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { money } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { ErrorState, Segmented, Skeleton, Text } from "../../ui/index.ts";
import { useCategories, useInvoice, useInvoicesOverview } from "../summary/queries.ts";
import {
	type CardLike,
	defaultInvoiceMonth,
	INVOICE_FILTERS,
	type InvoiceFilter,
	payableCents,
} from "./card-model.ts";
import { InvoiceComposition } from "./InvoiceComposition.tsx";
import { InvoiceHistoryChart } from "./InvoiceHistoryChart.tsx";
import { InvoiceLines } from "./InvoiceLines.tsx";
import { InvoiceOverviewCard } from "./InvoiceOverviewCard.tsx";
import {
	historyBars,
	invoiceStateLabel,
	invoiceStateWord,
	overviewDefaultMonth,
	selectedBarMonth,
} from "./invoices-model.ts";
import { PayInvoice } from "./PayInvoice.tsx";
import { BleedRow, CardChip, Notice } from "./parts.tsx";

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
	// O mês é escolhido tocando numa barra; trocar de cartão (ou voltar a "Todos") volta ao mês padrão.
	const [picked, setPicked] = useState<{ key: string; month: string } | null>(null);
	const [filter, setFilter] = useState<InvoiceFilter>("all");
	const key = card?.id ?? "all";
	const bars = overview.phase === "ready" ? historyBars(overview.data.history, card?.id ?? null) : [];
	const preferred = card
		? defaultInvoiceMonth(card, today)
		: overviewDefaultMonth(overview.phase === "ready" ? overview.data.nextDueDate : null, bars, today);
	const pickedMonth = picked?.key === key ? picked.month : null;
	const month = selectedBarMonth(bars, pickedMonth, preferred) ?? (card ? (pickedMonth ?? preferred) : null);
	const bar = bars.find((b) => b.month === month);

	const invoiceQ = useInvoice(card?.id, card ? (month ?? undefined) : undefined);
	const categoriesQ = useCategories();
	const invoice = toLoadable(invoiceQ);

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
			<InvoiceHistoryChart
				bars={bars}
				month={month}
				onSelect={(m) => setPicked({ key, month: m })}
				hidden={hidden}
			/>
		) : overview.phase === "loading" ? (
			<Skeleton height={200} />
		) : (
			<ErrorState message={overview.message} onRetry={overview.retry} />
		);

	// Situação honesta do mês escolhido; a data de vencimento vem da fatura (quando ainda carrega, só a palavra).
	const owed =
		invoice.phase === "ready" ? payableCents(invoice.data.invoice, invoice.data.composition.totalCents) : 0;
	const stateCaption = !bar
		? ""
		: invoice.phase === "ready"
			? `${invoiceStateLabel({ state: bar.state, dueDate: invoice.data.invoice.dueDate })}${
					invoice.data.invoice.paymentStatus === "partial" && owed > 0
						? ` · falta ${money(owed, hidden, { sign: "never" })}`
						: ""
				}`
			: invoiceStateWord(bar.state);

	if (!card || !month) {
		return (
			<View style={{ gap: spacing.lg }}>
				{chips}
				{history}
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

			<View style={{ gap: 2 }}>
				<Text variant="bodyStrong">{card.name}</Text>
				{bar ? (
					<Text variant="caption" tone="secondary">
						{stateCaption}
					</Text>
				) : null}
			</View>

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

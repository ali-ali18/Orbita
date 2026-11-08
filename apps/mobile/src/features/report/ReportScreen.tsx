import { colors, layout, radius, spacing } from "@orbita/tokens";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import type { MonthReportView } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { money, monthName } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import {
	Button,
	Card,
	ErrorState,
	IconButton,
	OrbitaAvatar,
	Screen,
	Skeleton,
	Text,
} from "../../ui/index.ts";
import { MonthChips } from "../card/MonthChips.tsx";
import { Dot } from "../card/parts.tsx";
import { useCards, useCategories } from "../summary/queries.ts";
import { useReport, useReportMonths } from "./queries.ts";
import {
	budgetLine,
	type CategoryBar,
	categoryBars,
	changeCaption,
	headline,
	initialMonth,
	MIN_BAR,
	monthChoices,
	narrative,
	reportSubtitle,
} from "./report-model.ts";

/** Nome do agente que assina o relatório (Figma: "Fechamento"). */
const AGENT_NAME = "Fechamento";
const BAR_HEIGHT = 8;
/** Cinza da barra do mês de comparação. */
const PREVIOUS_BAR = colors.textTertiary;

/**
 * Relatório do mês (Figma 54:1233). Todos os números vêm de `GET /v1/reports/:month` (o `monthReport` do engine);
 * a tela só desenha. O texto "Fechamento diz" é um modelo fixo (`narrative`), ainda sem IA.
 */
export function ReportScreen() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { month: currentMonth } = useClock();
	const { hidden } = usePrivacy();
	const monthsQ = useReportMonths();
	const [picked, setPicked] = useState<string | null>(null);
	const month = picked ?? (monthsQ.data ? initialMonth(monthsQ.data.months, currentMonth) : null);
	const reportQ = useReport(month);
	const categoriesQ = useCategories();
	const cardsQ = useCards();
	const [refreshing, setRefreshing] = useState(false);

	const choices = monthChoices(monthsQ.data?.months ?? [], currentMonth);
	const report = toLoadable(reportQ);
	const categories = categoriesQ.data?.categories ?? [];

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await queryClient.invalidateQueries();
		} finally {
			setRefreshing(false);
		}
	};

	return (
		<Screen>
			<ScrollView
				contentContainerStyle={{
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
					gap: spacing.md,
				}}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={onRefresh}
						tintColor={colors.text}
						colors={[colors.text]}
						progressBackgroundColor={colors.surface2}
					/>
				}
			>
				<View style={{ height: layout.touchTarget, justifyContent: "center", alignItems: "flex-start" }}>
					<IconButton
						icon="voltar"
						label="Voltar"
						onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
					/>
				</View>

				{month ? (
					<MonthChips options={choices} value={month} onChange={setPicked} />
				) : monthsQ.isError ? (
					<ErrorState message="Não consegui carregar os meses." onRetry={() => void monthsQ.refetch()} />
				) : null}

				{report.phase === "loading" ? (
					<ReportSkeleton />
				) : report.phase === "error" ? (
					<ErrorState message={report.message} onRetry={report.retry} />
				) : (
					<ReportBody
						report={report.data}
						currentMonth={currentMonth}
						hidden={hidden}
						categories={categories}
						cards={cardsQ.data?.cards ?? []}
						onChat={() => router.push("/chat")}
						onExport={() => router.push("/configuracoes/exportar")}
					/>
				)}
			</ScrollView>
		</Screen>
	);
}

function ReportSkeleton() {
	return (
		<View accessibilityLabel="Carregando" style={{ gap: spacing.md }}>
			<Skeleton width="60%" height={32} />
			<Skeleton width="100%" height={99} />
			<Skeleton width="100%" height={200} />
		</View>
	);
}

type CardLike = { id: string; name: string };

function ReportBody({
	report,
	currentMonth,
	hidden,
	categories,
	cards,
	onChat,
	onExport,
}: {
	report: MonthReportView;
	currentMonth: string;
	hidden: boolean;
	categories: Parameters<typeof categoryBars>[1];
	cards: readonly CardLike[];
	onChat: () => void;
	onExport: () => void;
}) {
	const top = headline(report.totals.balanceCents);
	const previousMonth = report.vsPrevious?.months[0];
	const bars = categoryBars(report.topCategories, categories);
	const budget = budgetLine(report.budget);
	const invoices = report.invoices.cards.filter((c) => c.totalCents !== 0);
	const empty =
		report.totals.incomeCents === 0 && report.totals.spentCents === 0 && report.biggestExpenses.length === 0;

	return (
		<>
			<View
				style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: layout.touchTarget }}
			>
				<OrbitaAvatar size={layout.touchTarget} />
				<View style={{ flex: 1 }}>
					<Text variant="bodyStrong">{AGENT_NAME}</Text>
					<Text variant="caption" tone="secondary">
						{reportSubtitle(report, currentMonth)}
					</Text>
				</View>
			</View>

			<View style={{ paddingVertical: spacing.sm, gap: spacing.xs }}>
				<Text variant="body" tone="secondary">
					{monthName(report.month)} {top.lead}
				</Text>
				<Text variant="numberLarge" accessibilityRole="header">
					{money(top.amount, hidden, { sign: "never" })} {top.tail}
				</Text>
			</View>

			{empty ? (
				<Card>
					<Text variant="body" tone="secondary">
						Nenhum lançamento em {monthName(report.month).toLocaleLowerCase("pt-BR")}.
					</Text>
				</Card>
			) : null}

			<View style={{ flexDirection: "row", gap: spacing.md }}>
				<Stat
					label="Entrou"
					cents={report.totals.incomeCents}
					caption={changeCaption(report.vsPrevious?.income, previousMonth)}
					hidden={hidden}
					tone="positive"
				/>
				<Stat
					label="Saiu"
					cents={report.totals.spentCents}
					caption={changeCaption(report.vsPrevious?.spent, previousMonth)}
					hidden={hidden}
				/>
			</View>

			{report.vsAverage ? <AverageNote report={report} hidden={hidden} /> : null}

			{bars.length > 0 ? (
				<Card style={{ gap: spacing.lg }}>
					<Text variant="cardTitle" accessibilityRole="header">
						{previousMonth
							? `Por categoria, contra ${monthName(previousMonth).toLocaleLowerCase("pt-BR")}`
							: "Por categoria"}
					</Text>
					<View style={{ flexDirection: "row", gap: spacing.lg }}>
						<Text variant="caption" tone="secondary">
							Colorida: {monthName(report.month).toLocaleLowerCase("pt-BR")}
						</Text>
						{previousMonth ? (
							<Legend
								color={PREVIOUS_BAR}
								label={`Cinza: ${monthName(previousMonth).toLocaleLowerCase("pt-BR")}`}
							/>
						) : null}
					</View>
					{bars.map((b) => (
						<CategoryRow key={b.key} bar={b} hidden={hidden} showPrevious={previousMonth !== undefined} />
					))}
				</Card>
			) : null}

			{report.biggestExpenses.length > 0 ? (
				<Section title="Maiores gastos">
					{report.biggestExpenses.map((e) => (
						<Line
							key={e.id}
							label={e.description}
							value={money(e.amountCents, hidden, { sign: "never" })}
							caption={categories.find((c) => c.id === e.categoryId)?.name}
						/>
					))}
				</Section>
			) : null}

			{report.subscriptions.count > 0 ? (
				<Section title="Assinaturas">
					<Line
						label={`${report.subscriptions.count} ${report.subscriptions.count === 1 ? "assinatura" : "assinaturas"}`}
						value={money(report.subscriptions.totalCents, hidden, { sign: "never" })}
						caption={
							report.subscriptions.change && previousMonth
								? changeCaption(report.subscriptions.change, previousMonth)
								: undefined
						}
					/>
				</Section>
			) : null}

			{budget ? (
				<Section title="Orçamento">
					<Line
						label={budget}
						value={report.budget.adherencePercent === null ? "" : `${report.budget.adherencePercent}%`}
					/>
				</Section>
			) : null}

			{invoices.length > 0 ? (
				<Section title="Faturas dos cartões">
					{invoices.map((c) => (
						<Line
							key={c.cardId}
							label={cards.find((x) => x.id === c.cardId)?.name ?? "Cartão"}
							value={money(c.totalCents, hidden, { sign: "never" })}
						/>
					))}
				</Section>
			) : null}

			{!empty ? (
				<Card style={{ flexDirection: "row", gap: spacing.md }}>
					<OrbitaAvatar size={spacing.xxl} />
					<View style={{ flex: 1, gap: spacing.xs }}>
						<Text variant="micro" tone="secondary">
							{AGENT_NAME}
						</Text>
						{/* O texto vem do modelo fixo; o resumo por IA entra aqui depois (ver `narrative`). */}
						<Text variant="body">{hiddenNarrative(narrative(report, categories), hidden)}</Text>
					</View>
				</Card>
			) : null}

			<View style={{ flexDirection: "row", gap: spacing.md }}>
				<Button label="Conversar" variant="secondary" onPress={onChat} style={{ flex: 1 }} />
				<Button label="Exportar" onPress={onExport} style={{ flex: 1 }} />
			</View>
		</>
	);
}

/** Com os valores escondidos, o texto que cita dinheiro não pode vazar: sem valores, fica só a parte sem números. */
function hiddenNarrative(text: string, hidden: boolean): string {
	return hidden ? text.replace(/R\$\s?[\d.]+,\d{2}/g, "••••") : text;
}

function Stat({
	label,
	cents,
	caption,
	hidden,
	tone = "primary",
}: {
	label: string;
	cents: number;
	caption: string;
	hidden: boolean;
	tone?: "primary" | "positive";
}) {
	return (
		<Card style={{ flex: 1, padding: spacing.lg, gap: spacing.xs }}>
			<Text variant="caption" tone="secondary">
				{label}
			</Text>
			<Text variant="numberMedium" tone={tone}>
				{money(cents, hidden, { sign: "never" })}
			</Text>
			<Text variant="caption" tone="tertiary">
				{caption}
			</Text>
		</Card>
	);
}

function AverageNote({ report, hidden }: { report: MonthReportView; hidden: boolean }) {
	const avg = report.vsAverage;
	if (!avg) return null;
	const n = avg.months.length;
	const side = avg.spent.deltaCents === 0 ? "igual à" : avg.spent.deltaCents > 0 ? "acima da" : "abaixo da";
	return (
		<Card style={{ gap: spacing.xs }}>
			<Text variant="cardTitle" tone="secondary">
				Contra a média {n === 1 ? "do mês anterior" : `dos últimos ${n} meses`}
			</Text>
			<Text variant="body">
				Saída {side} média ({money(avg.spent.referenceCents, hidden, { sign: "never" })}
				{avg.spent.percent !== null && avg.spent.percent !== 0 ? `, ${Math.abs(avg.spent.percent)}%` : ""}).
			</Text>
		</Card>
	);
}

function Legend({ color, label }: { color: string; label: string }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
			<Dot color={color} />
			<Text variant="caption" tone="secondary">
				{label}
			</Text>
		</View>
	);
}

function CategoryRow({
	bar,
	hidden,
	showPrevious,
}: {
	bar: CategoryBar;
	hidden: boolean;
	showPrevious: boolean;
}) {
	return (
		<View style={{ gap: spacing.xs }} accessible accessibilityLabel={rowLabel(bar, hidden)}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
				<Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
					{bar.name}
				</Text>
				<Text variant="bodyStrong">{money(bar.spentCents, hidden, { sign: "never" })}</Text>
				<Text variant="caption" tone="secondary" style={{ minWidth: 44, textAlign: "right" }}>
					{bar.percent ?? ""}
				</Text>
			</View>
			<Bar ratio={bar.currentRatio} color={bar.color} />
			{showPrevious ? <Bar ratio={bar.previousRatio} color={PREVIOUS_BAR} /> : null}
		</View>
	);
}

function rowLabel(bar: CategoryBar, hidden: boolean): string {
	const now = money(bar.spentCents, hidden, { sign: "never" });
	return `${bar.name}, ${now}${bar.percent ? `, ${bar.percent} contra o mês anterior` : ""}`;
}

function Bar({ ratio, color }: { ratio: number; color: string }) {
	return (
		<View style={{ height: BAR_HEIGHT, flexDirection: "row" }}>
			<View
				style={{
					flex: Math.max(ratio, 0),
					minWidth: ratio > 0 ? MIN_BAR : 0,
					borderRadius: radius.sm,
					backgroundColor: color,
				}}
			/>
			<View style={{ flex: Math.max(1 - ratio, 0) }} />
		</View>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<Card style={{ gap: spacing.md }}>
			<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
				{title}
			</Text>
			{children}
		</Card>
	);
}

function Line({ label, value, caption }: { label: string; value: string; caption?: string | undefined }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
			<View style={{ flex: 1 }}>
				<Text variant="body" numberOfLines={1}>
					{label}
				</Text>
				{caption ? (
					<Text variant="caption" tone="tertiary" numberOfLines={1}>
						{caption}
					</Text>
				) : null}
			</View>
			<Text variant="bodyStrong">{value}</Text>
		</View>
	);
}

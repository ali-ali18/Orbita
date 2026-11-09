import { spacing } from "@orbita/tokens";
import { ScrollView, View } from "react-native";
import type { CategoriesView, InvoiceView, MonthSummary } from "../../lib/api.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { IconButton, Screen, Segmented, Text, TOP_FADE } from "../../ui/index.ts";
import { CARD_TABS, type CardLike } from "../card/card-model.ts";
import { InvoiceComposition } from "../card/InvoiceComposition.tsx";
import { InvoiceLines } from "../card/InvoiceLines.tsx";
import { MonthChips } from "../card/MonthChips.tsx";
import { BigNumber, BleedRow, CardChip, Notice } from "../card/parts.tsx";
import { CategoriesCard } from "../summary/CategoriesCard.tsx";
import { HeroCard } from "../summary/HeroCard.tsx";
import { HomeHeader } from "../summary/HomeHeader.tsx";

const noop = () => {};

const inter: CardLike = {
	id: "inter",
	name: "Inter",
	bankCode: "00416968",
	last4: "9697",
	closingDay: 5,
	dueDay: 12,
	closingRule: "closing-day-next",
	limitCents: 500000,
	archivedAt: null,
};

const categories = [
	{ id: "mer", name: "Mercado", slug: "mercado", chartSlot: 0, isSystem: true, archivedAt: null },
	{ id: "del", name: "Delivery", slug: "delivery", chartSlot: 1, isSystem: true, archivedAt: null },
	{ id: "tra", name: "Transporte", slug: "transporte", chartSlot: 2, isSystem: true, archivedAt: null },
	{ id: "ass", name: "Assinaturas", slug: "assinaturas", chartSlot: 3, isSystem: true, archivedAt: null },
	{ id: "laz", name: "Lazer", slug: "lazer", chartSlot: 4, isSystem: true, archivedAt: null },
	{ id: "mor", name: "Moradia", slug: "moradia", chartSlot: 5, isSystem: true, archivedAt: null },
	{ id: "sau", name: "Saúde", slug: "saude", chartSlot: 6, isSystem: true, archivedAt: null },
	{
		id: "pix",
		name: "Transferências",
		slug: "transferencias",
		chartSlot: 7,
		isSystem: true,
		archivedAt: null,
	},
	{ id: "inv", name: "Investimentos", slug: "investimentos", chartSlot: 8, isSystem: true, archivedAt: null },
	{ id: "out", name: "Outros", slug: "outros", chartSlot: 9, isSystem: true, archivedAt: null },
];

/**
 * Carrefour, iFood, Uber e Netflix nas categorias de consumo. PIX sem compra (Rei Dos) em
 * Transferências. Aplicação em Investimentos.
 */
const summary = {
	month: "2026-11",
	summary: {
		spentCents: 52067,
		incomeCents: 13,
		refundCreditCents: 0,
		byCategory: {
			mer: 15237,
			del: 4890,
			tra: 2350,
			ass: 5590,
			laz: 4000,
			mor: 6000,
			sau: 2500,
			pix: 1500,
			inv: 8000,
			out: 2000,
		},
	},
	budgets: [
		{
			scope: "total",
			limitCents: 230000,
			spentCents: 52067,
			remainingCents: 177933,
			ratio: 0.23,
			overBudget: false,
		},
	],
	safeToSpend: { availableCents: 177933, perDayCents: 8088, remainingDays: 22 },
	pendingRecurring: { expenseCents: 0, incomeCents: 0 },
	projection: null,
	refundCreditCents: 0,
} as unknown as MonthSummary;

const homeState: Loadable<[MonthSummary, CategoriesView]> = {
	phase: "ready",
	data: [summary, { categories } as CategoriesView],
};

const invoice = {
	card: inter,
	invoice: {
		month: "2026-12",
		closingDate: "2026-12-05",
		dueDate: "2026-12-12",
		status: "open",
		paidCents: 0,
		paymentStatus: "open",
	},
	composition: {
		purchasesCents: 0,
		installmentsCents: 35620,
		recurringCents: 0,
		refundsCents: 0,
		totalCents: 35620,
	},
	transactions: [
		{
			id: "est-5-kabum",
			kind: "expense",
			amountCents: 35620,
			date: "2026-12-05",
			description: "Kabum",
			categoryId: null,
			accountId: null,
			cardId: "inter",
			counterpartAccountId: null,
			refundOfId: null,
			budgetMonth: "2026-12",
			invoiceMonth: "2026-12",
			installmentGroupId: "g1",
			installmentNumber: 5,
			installmentCount: 10,
			status: "confirmed",
			source: "import",
			externalId: null,
			note: "Estimada: o banco ainda não lançou esta parcela.",
			sourceCategory: null,
			merchantName: null,
			categoryEditedByOwner: false,
			editedByOwner: false,
			createdAt: "2026-11-08T00:00:00.000Z",
			updatedAt: "2026-11-08T00:00:00.000Z",
		},
	],
} as InvoiceView;

/** Início com o gasto separado por categoria, do jeito que a tela real desenha. */
export function HomePreview() {
	return (
		<Screen fadeTop>
			<ScrollView
				contentContainerStyle={{ paddingTop: TOP_FADE, paddingHorizontal: spacing.lg, gap: spacing.md }}
			>
				<HomeHeader initial="V" hidden={false} onToggleHidden={noop} onAvatarPress={noop} />
				<View style={{ paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs }}>
					<Text variant="greeting">Boa noite</Text>
					<Text variant="caption" tone="secondary">
						novembro · faltam 22 dias
					</Text>
				</View>
				<HeroCard state={homeState} hidden={false} />
				<CategoriesCard state={homeState} hidden={false} onPress={noop} />
			</ScrollView>
		</Screen>
	);
}

/** Fatura de dezembro com a parcela estimada e os meses pagos, nos mesmos blocos da tela Cartão. */
export function InvoicePreview() {
	return (
		<Screen fadeTop>
			<ScrollView
				contentContainerStyle={{
					paddingTop: TOP_FADE,
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
					gap: spacing.lg,
				}}
			>
				<View
					style={{ height: 100, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
				>
					<IconButton icon="voltar" label="Voltar" onPress={noop} />
					<IconButton icon="olho" label="Esconder valores" onPress={noop} />
				</View>
				<Segmented options={CARD_TABS} value="faturas" onChange={noop} />
				<BleedRow>
					<CardChip card={inter} selected onPress={noop} />
				</BleedRow>
				<BigNumber
					label="Inter"
					value="R$ 356,20"
					caption="Fecha 5 de dez · vence 12 de dez"
					badge={{ label: "Em aberto", tone: "secondary" }}
				/>
				<MonthChips
					options={[
						{ month: "2026-09", status: "paga" },
						{ month: "2026-10", status: "paga" },
						{ month: "2026-11", status: "paga" },
						{ month: "2026-12", status: "aberta" },
						{ month: "2027-01", status: "aberta" },
					]}
					value="2026-12"
					onChange={noop}
				/>
				<InvoiceComposition data={invoice} hidden={false} />
				<Notice text="Valor estimado. O banco pode levar até 3 dias para mandar compras recentes." />
				<Segmented
					options={[
						{ id: "all", label: "Tudo" },
						{ id: "purchases", label: "Compras" },
						{ id: "installments", label: "Parcelas" },
					]}
					value="all"
					onChange={noop}
				/>
				<InvoiceLines lines={invoice.transactions} categories={categories} filter="all" hidden={false} />
			</ScrollView>
		</Screen>
	);
}

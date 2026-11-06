import { colors, spacing } from "@orbita/tokens";
import { View } from "react-native";
import type { CardsView, InstallmentsView, InvoiceView } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import { Card, Icon, LetterAvatar, Text } from "../../ui/index.ts";
import { bankColor, installmentsOverview, invoiceCaption } from "./summary-model.ts";
import { initialOf } from "./transaction-model.ts";

const SQUARE_MIN_HEIGHT = 190;

function Square({
	top,
	label,
	value,
	caption,
}: {
	top: React.ReactNode;
	label: string;
	value: string;
	caption: string;
}) {
	return (
		<Card style={{ flex: 1, minHeight: SQUARE_MIN_HEIGHT, justifyContent: "space-between" }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>{top}</View>
			<View>
				<Text variant="caption" tone="secondary">
					{label}
				</Text>
				<Text variant="numberMedium" adjustsFontSizeToFit numberOfLines={1}>
					{value}
				</Text>
				<Text variant="caption" tone="secondary">
					{caption}
				</Text>
			</View>
		</Card>
	);
}

export function InvoiceSquare({
	card,
	invoice,
	today,
	hidden,
}: {
	card: CardsView["cards"][number] | undefined;
	invoice: InvoiceView | undefined;
	today: string;
	hidden: boolean;
}) {
	if (!card) {
		return (
			<Square
				top={<Icon name="card" />}
				label="Fatura atual"
				value="Sem cartão"
				caption="Cadastre um cartão para acompanhar a fatura."
			/>
		);
	}
	const title = card.last4 ? `•••• ${card.last4}` : card.name;
	return (
		<Square
			top={
				<>
					<LetterAvatar letter={initialOf(card.name)} size={32} color={bankColor(card.bankCode)} />
					<Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
						{title}
					</Text>
				</>
			}
			label="Fatura atual"
			value={invoice ? money(invoice.composition.totalCents, hidden) : "—"}
			caption={invoice ? invoiceCaption(invoice.invoice, today) : "Carregando…"}
		/>
	);
}

export function InstallmentsSquare({
	installments,
	month,
	hidden,
}: {
	installments: InstallmentsView | undefined;
	month: string;
	hidden: boolean;
}) {
	const overview = installments ? installmentsOverview(installments.groups, month) : null;
	return (
		<Square
			top={
				<View
					style={{
						width: 44,
						height: 44,
						borderRadius: 22,
						backgroundColor: colors.surface2,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Icon name="layers" />
				</View>
			}
			label="Parcelamentos"
			value={
				overview
					? overview.activeCount === 0
						? "Nenhum"
						: `${overview.activeCount} ${overview.activeCount === 1 ? "ativo" : "ativos"}`
					: "—"
			}
			caption={
				overview && overview.activeCount > 0
					? `${money(overview.monthlyCents, hidden, { sign: "never" })} por mês`
					: "Nada parcelado agora"
			}
		/>
	);
}

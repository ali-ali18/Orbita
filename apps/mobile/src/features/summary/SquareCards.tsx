import { colors, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { CardsView, InstallmentsView, InvoiceView } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { BankLogo, Card, ErrorState, Icon, type IconName, Skeleton, Text } from "../../ui/index.ts";
import { bankBadge, installmentsOverview, invoiceCaption } from "./summary-model.ts";

/** Altura dos cards quadrados no Figma (173 de largura por 221 de altura). */
const SQUARE_MIN_HEIGHT = 221;

function Frame({
	top,
	children,
	onPress,
	label,
}: {
	top: ReactNode;
	children: ReactNode;
	onPress?: (() => void) | undefined;
	label: string;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			disabled={!onPress}
			onPress={onPress}
			style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.8 : 1 })}
		>
			<Card style={{ flex: 1, minHeight: SQUARE_MIN_HEIGHT, justifyContent: "space-between" }}>
				<View style={{ flexDirection: "row", alignItems: "flex-start" }}>
					<View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>{top}</View>
					<Icon name="seta-direita" size={18} color={colors.textTertiary} />
				</View>
				<View>{children}</View>
			</Card>
		</Pressable>
	);
}

function Facts({ label, value, caption }: { label: string; value: string; caption: string }) {
	return (
		<>
			<Text variant="caption" tone="secondary">
				{label}
			</Text>
			<Text variant="numberMedium" adjustsFontSizeToFit numberOfLines={1}>
				{value}
			</Text>
			<Text variant="caption" tone="secondary">
				{caption}
			</Text>
		</>
	);
}

function Placeholder({ label }: { label: string }) {
	return (
		<View accessibilityLabel={`${label}: carregando`} style={{ gap: spacing.sm }}>
			<Skeleton width="50%" height={14} />
			<Skeleton width="80%" height={22} />
			<Skeleton width="60%" height={14} />
		</View>
	);
}

function IconCircle({ name }: { name: IconName }) {
	return (
		<View
			style={{
				width: 44,
				height: 44,
				borderRadius: radius.pill,
				backgroundColor: colors.surface2,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Icon name={name} />
		</View>
	);
}

/**
 * Fatura do primeiro cartão ativo. `cards` é a lista de cartões; `invoice` só existe quando há cartão.
 * Cada fase é distinta: carregando (esqueleto), falha (tentar de novo) ou vazio de verdade ("Sem cartão").
 */
export function InvoiceSquare({
	cards,
	invoice,
	today,
	hidden,
	onPress,
}: {
	onPress?: () => void;
	cards: Loadable<CardsView>;
	invoice: Loadable<InvoiceView> | null;
	today: string;
	hidden: boolean;
}) {
	if (cards.phase === "loading") {
		return (
			<Frame label="Fatura atual, abrir o cartão" onPress={onPress} top={<Skeleton width={96} height={32} />}>
				<Placeholder label="Fatura atual" />
			</Frame>
		);
	}
	if (cards.phase === "error") {
		return (
			<Frame label="Fatura atual, abrir o cartão" onPress={onPress} top={<IconCircle name="cartao" />}>
				<ErrorState message={cards.message} onRetry={cards.retry} />
			</Frame>
		);
	}
	const card = cards.data.cards.find((c) => c.archivedAt === null);
	if (!card) {
		return (
			<Frame label="Fatura atual, abrir o cartão" onPress={onPress} top={<IconCircle name="cartao" />}>
				<Facts
					label="Fatura atual"
					value="Sem cartão"
					caption="Cadastre um cartão para acompanhar a fatura."
				/>
			</Frame>
		);
	}
	const top = (
		<>
			<BankLogo {...bankBadge(card)} size={32} />
			<Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
				{card.last4 ? `•••• ${card.last4}` : card.name}
			</Text>
		</>
	);
	if (!invoice || invoice.phase === "loading") {
		return (
			<Frame label="Fatura atual, abrir o cartão" onPress={onPress} top={top}>
				<Placeholder label="Fatura atual" />
			</Frame>
		);
	}
	if (invoice.phase === "error") {
		return (
			<Frame label="Fatura atual, abrir o cartão" onPress={onPress} top={top}>
				<ErrorState message={invoice.message} onRetry={invoice.retry} />
			</Frame>
		);
	}
	return (
		<Frame label="Fatura atual, abrir o cartão" onPress={onPress} top={top}>
			<Facts
				label="Fatura atual"
				value={money(invoice.data.composition.totalCents, hidden)}
				caption={invoiceCaption(invoice.data.invoice, today)}
			/>
		</Frame>
	);
}

export function InstallmentsSquare({
	installments,
	month,
	hidden,
	onPress,
}: {
	onPress?: () => void;
	installments: Loadable<InstallmentsView>;
	month: string;
	hidden: boolean;
}) {
	const top = <IconCircle name="parcelas" />;
	if (installments.phase === "loading") {
		return (
			<Frame label="Parcelamentos, abrir o cartão" onPress={onPress} top={top}>
				<Placeholder label="Parcelamentos" />
			</Frame>
		);
	}
	if (installments.phase === "error") {
		return (
			<Frame label="Parcelamentos, abrir o cartão" onPress={onPress} top={top}>
				<ErrorState message={installments.message} onRetry={installments.retry} />
			</Frame>
		);
	}
	const { activeCount, monthlyCents } = installmentsOverview(installments.data.groups, month);
	return (
		<Frame label="Parcelamentos, abrir o cartão" onPress={onPress} top={top}>
			<Facts
				label="Parcelamentos"
				value={activeCount === 0 ? "Nenhum" : `${activeCount} ${activeCount === 1 ? "ativo" : "ativos"}`}
				caption={
					activeCount > 0
						? `${money(monthlyCents, hidden, { sign: "never" })} por mês`
						: "Nada parcelado agora"
				}
			/>
		</Frame>
	);
}

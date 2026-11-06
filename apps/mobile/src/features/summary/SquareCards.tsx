import { colors, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { CardsView, InstallmentsView, InvoiceView } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { Card, ErrorState, Icon, LetterAvatar, Skeleton, Text } from "../../ui/index.ts";
import { bankColor, installmentsOverview, invoiceCaption } from "./summary-model.ts";
import { initialOf } from "./transaction-model.ts";

const SQUARE_MIN_HEIGHT = 190;

function Frame({ top, children }: { top: ReactNode; children: ReactNode }) {
	return (
		<Card style={{ flex: 1, minHeight: SQUARE_MIN_HEIGHT, justifyContent: "space-between" }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>{top}</View>
			<View>{children}</View>
		</Card>
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

function IconCircle({ name }: { name: "layers" | "card" }) {
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
}: {
	cards: Loadable<CardsView>;
	invoice: Loadable<InvoiceView> | null;
	today: string;
	hidden: boolean;
}) {
	if (cards.phase === "loading") {
		return (
			<Frame top={<Skeleton width={96} height={32} />}>
				<Placeholder label="Fatura atual" />
			</Frame>
		);
	}
	if (cards.phase === "error") {
		return (
			<Frame top={<IconCircle name="card" />}>
				<ErrorState message={cards.message} onRetry={cards.retry} />
			</Frame>
		);
	}
	const card = cards.data.cards.find((c) => c.archivedAt === null);
	if (!card) {
		return (
			<Frame top={<IconCircle name="card" />}>
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
			<LetterAvatar letter={initialOf(card.name)} size={32} color={bankColor(card.bankCode)} />
			<Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
				{card.last4 ? `•••• ${card.last4}` : card.name}
			</Text>
		</>
	);
	if (!invoice || invoice.phase === "loading") {
		return (
			<Frame top={top}>
				<Placeholder label="Fatura atual" />
			</Frame>
		);
	}
	if (invoice.phase === "error") {
		return (
			<Frame top={top}>
				<ErrorState message={invoice.message} onRetry={invoice.retry} />
			</Frame>
		);
	}
	return (
		<Frame top={top}>
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
}: {
	installments: Loadable<InstallmentsView>;
	month: string;
	hidden: boolean;
}) {
	const top = <IconCircle name="layers" />;
	if (installments.phase === "loading") {
		return (
			<Frame top={top}>
				<Placeholder label="Parcelamentos" />
			</Frame>
		);
	}
	if (installments.phase === "error") {
		return (
			<Frame top={top}>
				<ErrorState message={installments.message} onRetry={installments.retry} />
			</Frame>
		);
	}
	const { activeCount, monthlyCents } = installmentsOverview(installments.data.groups, month);
	return (
		<Frame top={top}>
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

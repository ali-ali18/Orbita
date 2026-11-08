import { colors, spacing } from "@orbita/tokens";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import {
	Button,
	ErrorState,
	IconButton,
	Screen,
	Segmented,
	Skeleton,
	Text,
	TOP_FADE,
} from "../../ui/index.ts";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { useCards } from "../summary/queries.ts";
import { activeCards, CARD_TABS, type CardTab } from "./card-model.ts";
import { InstallmentsTab } from "./InstallmentsTab.tsx";
import { InvoicesTab } from "./InvoicesTab.tsx";
import { LimitsTab } from "./LimitsTab.tsx";

/** Tela "Cartão" (Figma 33:501 Faturas · 28:306 Parcelas · 36:636 Limites): três abas sobre os mesmos cartões. */
export function CardScreen({ initialTab, initialCardId }: { initialTab: CardTab; initialCardId?: string }) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { hidden, toggle } = usePrivacy();
	const { today } = useClock();
	const [tab, setTab] = useState<CardTab>(initialTab);
	const [refreshing, setRefreshing] = useState(false);
	const cardsQuery = useCards();
	const cardsQ = toLoadable(cardsQuery);

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await queryClient.invalidateQueries();
		} finally {
			setRefreshing(false);
		}
	};

	const cards = cardsQ.phase === "ready" ? activeCards(cardsQ.data.cards) : [];

	if (isUnreachableQuery(cardsQuery)) {
		return <ServerDownScreen onRetry={() => cardsQuery.refetch()} />;
	}

	return (
		<Screen fadeTop>
			<ScrollView
				contentContainerStyle={{
					paddingTop: TOP_FADE,
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl + spacing.lg,
					gap: spacing.lg,
				}}
				keyboardShouldPersistTaps="handled"
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
				<View
					style={{ height: 100, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
				>
					<IconButton
						icon="voltar"
						label="Voltar"
						onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
					/>
					<IconButton
						icon={hidden ? "olho-cortado" : "olho"}
						label={hidden ? "Mostrar valores" : "Esconder valores"}
						onPress={toggle}
					/>
				</View>
				<Segmented options={CARD_TABS} value={tab} onChange={setTab} />

				{cardsQ.phase === "loading" ? (
					<View accessibilityLabel="Carregando cartões" style={{ gap: spacing.lg }}>
						<Skeleton height={44} />
						<Skeleton width="60%" height={40} />
						<Skeleton height={200} />
					</View>
				) : cardsQ.phase === "error" ? (
					<ErrorState message={cardsQ.message} onRetry={cardsQ.retry} />
				) : cards.length === 0 ? (
					<View style={{ gap: spacing.lg, alignItems: "flex-start" }}>
						<Text variant="body" tone="secondary">
							Você ainda não tem cartão. Conecte um banco para trazer as faturas, as parcelas e o limite.
						</Text>
						<Button label="Conectar um banco" onPress={() => router.push("/configuracoes/bancos")} />
					</View>
				) : tab === "faturas" ? (
					<InvoicesTab cards={cards} today={today} hidden={hidden} initialCardId={initialCardId} />
				) : tab === "parcelas" ? (
					<InstallmentsTab cards={cards} hidden={hidden} />
				) : (
					<LimitsTab cards={cards} hidden={hidden} />
				)}
			</ScrollView>
		</Screen>
	);
}

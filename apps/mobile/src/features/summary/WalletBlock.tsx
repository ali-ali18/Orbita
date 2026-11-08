import { daysBetween } from "@orbita/core";
import { colors, motion, radius, spacing } from "@orbita/tokens";
import { useEffect, useRef, useState } from "react";
import {
	AccessibilityInfo,
	Animated,
	Pressable,
	ScrollView,
	type ScrollViewInstance,
	useWindowDimensions,
	View,
} from "react-native";
import type { InvoicesOverviewView } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { BankLogo, Card, ErrorState, Skeleton, Text } from "../../ui/index.ts";
import {
	bandLook,
	bandRight,
	dueLine,
	isLastBand,
	nextDueText,
	openLine,
	orderBands,
	stackHeight,
} from "./wallet-model.ts";

/** Altura da faixa inteira e do pedaço que aparece embaixo da anterior (a "bolsa" da carteira). */
const BAND_HEIGHT = 56;
/** A última faixa (a da frente) é mais alta, para ler como o cartão de cima da pilha. */
const FRONT_BAND_HEIGHT = Math.round(BAND_HEIGHT * 1.6);
const PEEK = 30;
const LIFT = -6;

function useReduceMotion(): boolean {
	const [reduced, setReduced] = useState(false);
	useEffect(() => {
		let alive = true;
		AccessibilityInfo.isReduceMotionEnabled()
			.then((value) => {
				if (alive) setReduced(value);
			})
			.catch(() => {});
		const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
		return () => {
			alive = false;
			sub.remove();
		};
	}, []);
	return reduced;
}

type Line = InvoicesOverviewView["cards"][number];

/**
 * "Faturas": uma faixa colorida por cartão, empilhadas como numa carteira (cada uma aparece um pedaço sob a anterior),
 * e embaixo o total que ainda se deve e o próximo vencimento. A segunda página (pontinhos) traz o detalhe do cartão
 * tocado: "Vence dd/mm R$ X · paga/falta R$ Z" e "Fatura atual R$ Y · fecha em N dias". Os números vêm do engine.
 */
export function WalletBlock({
	overview,
	today,
	hidden,
	onOpen,
}: {
	overview: Loadable<InvoicesOverviewView>;
	today: string;
	hidden: boolean;
	onOpen: () => void;
}) {
	const reduceMotion = useReduceMotion();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [page, setPage] = useState(0);
	// Largura de uma página: a tela menos a margem do Início (lg) e o enchimento do card (xl), dos dois lados.
	const width = Math.max(0, useWindowDimensions().width - spacing.lg * 2 - spacing.xl * 2);
	const scroller = useRef<ScrollViewInstance>(null);
	const lifts = useRef(new Map<string, Animated.Value>());
	const liftOf = (id: string) => {
		let value = lifts.current.get(id);
		if (!value) {
			value = new Animated.Value(0);
			lifts.current.set(id, value);
		}
		return value;
	};
	const animate = (id: string, to: number) => {
		const value = liftOf(id);
		if (reduceMotion) {
			value.setValue(to);
			return;
		}
		Animated.timing(value, { toValue: to, duration: motion.duration.fast, useNativeDriver: true }).start();
	};

	if (overview.phase === "loading") {
		return (
			<Card>
				<View accessibilityLabel="Faturas: carregando" style={{ gap: spacing.sm }}>
					<Skeleton width="100%" height={86} />
					<Skeleton width="50%" height={22} />
				</View>
			</Card>
		);
	}
	if (overview.phase === "error") {
		return (
			<Card>
				<ErrorState message={overview.message} onRetry={overview.retry} />
			</Card>
		);
	}
	const bands = orderBands(overview.data.cards as Line[]);
	if (bands.length === 0) {
		return (
			<Card>
				<Text variant="caption" tone="secondary">
					Faturas
				</Text>
				<Text variant="bodyStrong">Sem cartão</Text>
				<Text variant="caption" tone="secondary">
					Cadastre um cartão para acompanhar as faturas.
				</Text>
			</Card>
		);
	}
	const selected = bands.find((b) => b.card.id === selectedId) ?? (bands[0] as Line);
	const height = stackHeight(bands.length, PEEK, BAND_HEIGHT, FRONT_BAND_HEIGHT);
	const goTo = (next: number) => {
		setPage(next);
		scroller.current?.scrollTo({ x: next * width, animated: !reduceMotion });
	};
	const fmt = (cents: number) => money(cents, hidden, { sign: "never" });

	const summary = (
		<View style={{ gap: spacing.xs }}>
			<View style={{ height, marginBottom: spacing.md }}>
				{bands.map((line, index) => {
					const look = bandLook(line.card);
					const lift = liftOf(line.card.id);
					const last = isLastBand(index, bands.length);
					return (
						<Animated.View
							key={line.card.id}
							style={{
								position: "absolute",
								top: index * PEEK,
								left: 0,
								right: 0,
								height: last ? FRONT_BAND_HEIGHT : BAND_HEIGHT,
								zIndex: index,
								transform: [{ translateY: lift }],
							}}
						>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`${line.card.name}${line.card.last4 ? ` final ${line.card.last4}` : ""}, ver a fatura`}
								onPressIn={() => animate(line.card.id, LIFT)}
								onPressOut={() => animate(line.card.id, 0)}
								onPress={() => {
									setSelectedId(line.card.id);
									goTo(1);
								}}
								style={{
									flex: 1,
									backgroundColor: look.band,
									borderTopLeftRadius: radius.inner,
									borderTopRightRadius: radius.inner,
									paddingHorizontal: spacing.md,
									borderWidth: 1,
									borderColor: colors.surface,
									// Só a última (embaixo, inteira) arredonda por baixo; as outras ficam sob a seguinte.
									borderBottomWidth: last ? 1 : 0,
									borderBottomLeftRadius: last ? radius.inner : 0,
									borderBottomRightRadius: last ? radius.inner : 0,
								}}
							>
								<View
									style={{
										height: PEEK - 1,
										flexDirection: "row",
										alignItems: "center",
										justifyContent: "space-between",
									}}
								>
									<BankLogo initial={look.initial} color={look.band} logo={look.logo} size={20} />
									<Text variant="caption" style={{ color: look.text }}>
										{bandRight(line.card)}
									</Text>
								</View>
							</Pressable>
						</Animated.View>
					);
				})}
			</View>
			<Text variant="caption" tone="secondary">
				Total em faturas
			</Text>
			<Text variant="numberHero" adjustsFontSizeToFit numberOfLines={1}>
				{fmt(overview.data.owedCents)}
			</Text>
			<Text variant="caption" tone="secondary">
				{nextDueText(overview.data.nextDueDate)}
			</Text>
		</View>
	);

	const pickedLook = bandLook(selected.card);
	const details = (
		<View style={{ gap: spacing.sm }}>
			<View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
				{bands.map((line) => {
					const look = bandLook(line.card);
					const active = line.card.id === selected.card.id;
					return (
						<Pressable
							key={line.card.id}
							accessibilityRole="button"
							accessibilityState={{ selected: active }}
							accessibilityLabel={`${line.card.name}${line.card.last4 ? ` final ${line.card.last4}` : ""}`}
							onPress={() => setSelectedId(line.card.id)}
							hitSlop={8}
							style={{ opacity: active ? 1 : 0.5 }}
						>
							<BankLogo initial={look.initial} color={look.band} logo={look.logo} size={32} />
						</Pressable>
					);
				})}
			</View>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
				<View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: pickedLook.band }} />
				<Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
					{selected.card.name} {bandRight(selected.card)}
				</Text>
			</View>
			<Text variant="body">{dueLine(selected.due, fmt)}</Text>
			{selected.open.dueDate !== selected.due.dueDate ? (
				<Text variant="body" tone="secondary">
					{openLine(selected.open, today, fmt, daysBetween)}
				</Text>
			) : null}
			<Text variant="caption" tone="secondary">
				Ainda se deve neste cartão: {fmt(selected.owedCents)}
			</Text>
		</View>
	);

	return (
		<Card>
			<View accessibilityLabel={`Faturas, total ${fmt(overview.data.owedCents)}`}>
				<ScrollView
					ref={scroller}
					horizontal
					pagingEnabled
					showsHorizontalScrollIndicator={false}
					scrollEventThrottle={16}
					onMomentumScrollEnd={(e) => {
						if (width > 0) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
					}}
				>
					<View style={{ width: width || undefined }}>{summary}</View>
					<View style={{ width: width || undefined }}>{details}</View>
				</ScrollView>
				<View
					style={{ flexDirection: "row", justifyContent: "center", gap: spacing.sm, marginTop: spacing.md }}
				>
					{[0, 1].map((dot) => (
						<Pressable
							key={dot}
							accessibilityRole="button"
							accessibilityLabel={dot === 0 ? "Resumo das faturas" : "Detalhe do cartão"}
							onPress={() => goTo(dot)}
							hitSlop={10}
						>
							<View
								style={{
									width: 8,
									height: 8,
									borderRadius: radius.pill,
									backgroundColor: page === dot ? colors.text : colors.textTertiary,
								}}
							/>
						</Pressable>
					))}
				</View>
				<Pressable accessibilityRole="button" onPress={onOpen} style={{ marginTop: spacing.sm }}>
					<Text variant="caption" tone="secondary">
						Abrir cartões
					</Text>
				</Pressable>
			</View>
		</Card>
	);
}

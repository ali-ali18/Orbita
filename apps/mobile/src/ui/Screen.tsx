import { colors, layout, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

/**
 * Altura do esmaecimento logo abaixo do topo: o conteúdo some suave ao rolar para baixo da faixa.
 * Numa tela com `fadeTop`, a rolagem soma esta folga ao próprio `paddingTop` (o `Screen` tira a mesma da faixa do topo),
 * então o cabeçalho fica no lugar de sempre e só o que rola passa por baixo do degradê.
 */
export const TOP_FADE = spacing.xxl;

/**
 * Degradê linear do fundo (opaco) para transparente, por cima do conteúdo e sem receber toques. `style` dá a posição e
 * a altura; o Início o usa na base do header fixo, para o conteúdo sumir suave ao passar por baixo dele.
 */
export function FadeEdge({ style }: { style?: StyleProp<ViewStyle> }) {
	return (
		<View
			pointerEvents="none"
			style={style ?? styles.topFade}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		>
			<Svg width="100%" height="100%" preserveAspectRatio="none">
				<Defs>
					<LinearGradient id="top-fade" x1="0" y1="0" x2="0" y2="1">
						<Stop offset="0" stopColor={colors.background} stopOpacity={1} />
						<Stop offset="1" stopColor={colors.background} stopOpacity={0} />
					</LinearGradient>
				</Defs>
				<Rect width="100%" height="100%" fill="url(#top-fade)" />
			</Svg>
		</View>
	);
}

/**
 * Fundo preto da tela, respeitando as áreas seguras. A faixa do topo fica fixa e o conteúdo que rola
 * para baixo dela esmaece num degradê linear, em vez de ser cortado seco. Com `fadeTop`, a rolagem soma `TOP_FADE`
 * ao próprio `paddingTop`; assim o degradê nunca cobre o cabeçalho em repouso. `footer` fica fixo embaixo (fora da rolagem);
 * com `floatingFooter` ele flutua sobre o conteúdo e cuida sozinho da área segura (a barra de baixo).
 */
export function Screen({
	children,
	footer,
	floatingFooter = false,
	fadeTop = false,
	style,
}: {
	children: ReactNode;
	footer?: ReactNode;
	floatingFooter?: boolean;
	/** Esmaece o conteúdo que rola para baixo da faixa do topo (telas cujo topo rola junto). */
	fadeTop?: boolean;
	style?: StyleProp<ViewStyle>;
}) {
	const insets = useSafeAreaInsets();
	const fade = fadeTop ? TOP_FADE : 0;
	return (
		<View
			style={[
				{
					flex: 1,
					backgroundColor: colors.background,
					paddingTop: Math.max(insets.top, layout.statusBar) - fade,
				},
				style,
			]}
		>
			<View style={{ flex: 1 }}>
				{children}
				{fadeTop ? <FadeEdge /> : null}
			</View>
			{footer && floatingFooter ? (
				<View style={styles.floating} pointerEvents="box-none">
					{footer}
				</View>
			) : footer ? (
				<View style={{ paddingBottom: Math.max(insets.bottom, layout.homeIndicator) }}>{footer}</View>
			) : (
				<View style={{ height: insets.bottom }} />
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	floating: { position: "absolute", left: 0, right: 0, bottom: 0 },
	topFade: { position: "absolute", top: 0, left: 0, right: 0, height: TOP_FADE },
});

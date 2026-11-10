import { colors, layout, radius, spacing } from "@orbita/tokens";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Animated,
	type LayoutChangeEvent,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	Pressable,
	ScrollView,
	type ScrollViewInstance,
	useWindowDimensions,
	View,
} from "react-native";
import { useAccent } from "../../lib/theme.tsx";
import { FadeEdge, Text, TOP_FADE } from "../../ui/index.ts";
import {
	HOME_TABS,
	offsetOfPage,
	pageFromOffset,
	resolvePage,
	tabsFade,
	tabsTouchable,
} from "./home-tabs-model.ts";

/**
 * Estado do pager do Início: qual página está à vista (pelo arrasto ou pelo toque na aba) e como rolar até outra.
 * A página vem da posição da rolagem, então a aba acompanha o dedo; tocar na aba rola até a página.
 */
export function useHomePager() {
	const scrollRef = useRef<ScrollViewInstance>(null);
	const window = useWindowDimensions();
	const [width, setWidth] = useState(window.width);
	const [height, setHeight] = useState(0);
	const [page, setPage] = useState(0);
	// A aba tocada enquanto a rolagem anima; o `onScroll` não a troca de volta pelo caminho.
	const target = useRef<number | null>(null);
	const current = useRef(0);

	const show = useCallback((next: number) => {
		current.current = next;
		setPage(next);
	}, []);
	const onLayout = useCallback((event: LayoutChangeEvent) => {
		const { width: w, height: h } = event.nativeEvent.layout;
		if (w > 0) setWidth(Math.round(w));
		if (h > 0) setHeight(Math.round(h));
	}, []);
	// Largura nova (girar o aparelho, fonte): a rolagem fica na página atual, não no deslocamento antigo.
	useEffect(() => {
		scrollRef.current?.scrollTo({ x: offsetOfPage(current.current, width), animated: false });
	}, [width]);
	const onScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			const next = resolvePage(event.nativeEvent.contentOffset.x, width, HOME_TABS.length, target.current);
			target.current = next.target;
			show(next.page);
		},
		[width, show],
	);
	/** O dedo pegou a rolagem no meio da animação: o arrasto volta a mandar. */
	const onScrollBeginDrag = useCallback(() => {
		target.current = null;
	}, []);
	const onMomentumScrollEnd = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			target.current = null;
			show(pageFromOffset(event.nativeEvent.contentOffset.x, width, HOME_TABS.length));
		},
		[width, show],
	);
	const goTo = useCallback(
		(index: number) => {
			target.current = index;
			show(index);
			scrollRef.current?.scrollTo({ x: offsetOfPage(index, width), animated: true });
		},
		[width, show],
	);
	return { scrollRef, width, height, page, onLayout, onScroll, onScrollBeginDrag, onMomentumScrollEnd, goTo };
}

/**
 * As abas somem com a rolagem vertical da página à vista (como no Pierre): opacidade 1 no topo, caindo linearmente até
 * 0 ao rolar a altura das abas, e a faixa encolhe junto, então o degradê do header sobe para logo abaixo do avatar e do
 * olho. Cada página guarda a própria rolagem; trocar de aba pelo arrasto passa a seguir a da página que ficou à vista.
 * Animated do RN, sem módulo nativo (o valor é atualizado direto, sem renderizar a tela a cada quadro).
 */
export function useTabsFade(activePage: number) {
	const scrollY = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
	const touchRef = useRef([true, true]);
	const [touchable, setTouchable] = useState([true, true]);
	const fades = useMemo(
		() =>
			scrollY.map((y) =>
				y.interpolate({ inputRange: [0, layout.homeTabs], outputRange: [1, 0], extrapolate: "clamp" }),
			),
		[scrollY],
	);
	/** Chamada pela rolagem de cada página com o `contentOffset.y`. */
	const report = useCallback(
		(index: number, y: number) => {
			scrollY[index]?.setValue(y);
			const ok = tabsTouchable(tabsFade(y, layout.homeTabs));
			if (touchRef.current[index] !== ok) {
				touchRef.current[index] = ok;
				setTouchable([...touchRef.current]);
			}
		},
		[scrollY],
	);
	const opacity = fades[activePage] ?? fades[0];
	return { opacity, touchable: touchable[activePage] ?? true, report };
}

export type TabsFadeState = ReturnType<typeof useTabsFade>;

/** Envolve as abas: só a opacidade muda (altura inteira, nada é cortado); invisíveis, não recebem toque nem leitor. */
export function HomeTabsFade({ fade, children }: { fade: TabsFadeState; children: ReactNode }) {
	if (!fade.opacity) return <>{children}</>;
	return (
		<Animated.View
			pointerEvents={fade.touchable ? "auto" : "none"}
			accessibilityElementsHidden={!fade.touchable}
			importantForAccessibility={fade.touchable ? "auto" : "no-hide-descendants"}
			style={{ opacity: fade.opacity }}
		>
			{children}
		</Animated.View>
	);
}

/**
 * O fundo sob as abas: uma faixa do fundo e, logo abaixo, o degradê linear. Ele SOBE junto com o sumiço das abas
 * (translação, sem recorte), até o degradê ficar logo abaixo do avatar e do olho. O que passa por baixo some em
 * gradiente; nunca há uma borda reta entre o header e o conteúdo.
 */
export function HomeHeaderBackdrop({ fade }: { fade: TabsFadeState }) {
	const shift = fade.opacity?.interpolate({ inputRange: [0, 1], outputRange: [-layout.homeTabs, 0] });
	return (
		<Animated.View
			pointerEvents="none"
			style={{
				position: "absolute",
				top: layout.homeHeader,
				left: 0,
				right: 0,
				transform: shift ? [{ translateY: shift }] : [],
			}}
		>
			<View style={{ height: layout.homeTabs, backgroundColor: colors.background }} />
			<FadeEdge style={{ height: TOP_FADE }} />
		</Animated.View>
	);
}

export type HomePagerState = ReturnType<typeof useHomePager>;

/** As abas fixas logo abaixo do header: a ativa na cor primária do tema. */
export function HomeTabsBar({ pager }: { pager: HomePagerState }) {
	const { accent } = useAccent();
	return (
		<View
			accessibilityRole="tablist"
			style={{
				flexDirection: "row",
				gap: spacing.sm,
				paddingHorizontal: spacing.lg,
				paddingBottom: spacing.md,
			}}
		>
			{HOME_TABS.map((tab, index) => {
				const active = pager.page === index;
				return (
					<Pressable
						key={tab.id}
						accessibilityRole="tab"
						accessibilityLabel={tab.label}
						accessibilityState={{ selected: active }}
						onPress={() => pager.goTo(index)}
						style={{
							minHeight: layout.touchTarget,
							paddingHorizontal: spacing.lg,
							justifyContent: "center",
							borderRadius: radius.pill,
							backgroundColor: active ? accent : colors.surface,
						}}
					>
						<Text variant="bodyStrong" tone={active ? "onAccent" : "secondary"} numberOfLines={1}>
							{tab.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

/**
 * As duas páginas lado a lado numa rolagem horizontal paginada (só React Native, sem módulo nativo). Cada página tem a
 * própria rolagem vertical; o sistema entrega o gesto ao eixo certo, então o arrasto de lado não atrapalha a rolagem
 * dos widgets, e o toque longo de um widget cede ao arrasto assim que o dedo se move.
 */
export function HomePager({
	pager,
	children,
}: {
	pager: HomePagerState;
	children: readonly [ReactNode, ReactNode];
}) {
	return (
		<ScrollView
			ref={pager.scrollRef}
			horizontal
			pagingEnabled
			bounces={false}
			overScrollMode="never"
			showsHorizontalScrollIndicator={false}
			scrollEventThrottle={16}
			onScroll={pager.onScroll}
			onScrollBeginDrag={pager.onScrollBeginDrag}
			onMomentumScrollEnd={pager.onMomentumScrollEnd}
			onLayout={pager.onLayout}
			style={{ flex: 1 }}
			contentContainerStyle={{ flexGrow: 1 }}
		>
			{children.map((child, index) => (
				<View
					// biome-ignore lint/suspicious/noArrayIndexKey: duas páginas fixas, em ordem
					key={index}
					accessibilityElementsHidden={pager.page !== index}
					importantForAccessibility={pager.page === index ? "auto" : "no-hide-descendants"}
					style={{ width: pager.width, ...(pager.height > 0 ? { height: pager.height } : { flex: 1 }) }}
				>
					{child}
				</View>
			))}
		</ScrollView>
	);
}

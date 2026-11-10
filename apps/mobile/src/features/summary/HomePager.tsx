import { colors, radius, spacing } from "@orbita/tokens";
import { type ReactNode, useCallback, useRef, useState } from "react";
import {
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
import { Text } from "../../ui/index.ts";
import { HOME_TABS, offsetOfPage, pageFromOffset } from "./home-tabs-model.ts";

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

	const onLayout = useCallback((event: LayoutChangeEvent) => {
		const { width: w, height: h } = event.nativeEvent.layout;
		if (w > 0) setWidth(Math.round(w));
		if (h > 0) setHeight(Math.round(h));
	}, []);
	const onScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			setPage(pageFromOffset(event.nativeEvent.contentOffset.x, width, HOME_TABS.length));
		},
		[width],
	);
	const goTo = useCallback(
		(index: number) => {
			setPage(index);
			scrollRef.current?.scrollTo({ x: offsetOfPage(index, width), animated: true });
		},
		[width],
	);
	return { scrollRef, width, height, page, onLayout, onScroll, goTo };
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
							minHeight: 44,
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

import type { HomeLayout, HomeWidgetId } from "@orbita/shared";
import { layout as layoutTokens, spacing } from "@orbita/tokens";
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	type ScrollViewInstance,
	useWindowDimensions,
	type View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type MenuViewport, type Rect, revealScroll, widgetMenuModel } from "./widget-menu-model.ts";

/** Distância entre o widget e o menu, e folga até as bordas da tela. */
export const MENU_GAP = spacing.sm;
export const MENU_MARGIN = spacing.sm;
/** Altura do menu antes da primeira medida (o `onLayout` corrige em seguida). */
const MENU_HEIGHT_GUESS = 304;

/** A `View` montada de um widget (o que `ref` entrega). */
export type WidgetNode = ComponentRef<typeof View>;

const sameRect = (a: Rect | null, b: Rect) =>
	a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * O menu de segurar, ancorado no widget: guarda qual widget está aberto e onde ele está na janela. Ao abrir (e a
 * cada mudança de tamanho ou de ordem com o menu aberto) mede o widget com `measureInWindow`, rola a lista o
 * necessário para ele aparecer inteiro e mede de novo, então o menu acompanha o widget de verdade.
 */
export function useWidgetMenu(layout: HomeLayout | null, bottomBar: number) {
	const insets = useSafeAreaInsets();
	const window = useWindowDimensions();
	const viewport: MenuViewport = useMemo(
		() => ({
			width: window.width,
			height: window.height,
			top: Math.max(insets.top, layoutTokens.statusBar),
			bottom: Math.max(insets.bottom, layoutTokens.homeIndicator),
		}),
		[window.width, window.height, insets.top, insets.bottom],
	);

	const scrollRef = useRef<ScrollViewInstance>(null);
	const scrollY = useRef(0);
	const nodes = useRef(new Map<HomeWidgetId, WidgetNode>());
	const [openId, setOpenId] = useState<HomeWidgetId | null>(null);
	const [anchor, setAnchor] = useState<Rect | null>(null);
	const [menuHeight, setMenuHeight] = useState(MENU_HEIGHT_GUESS);

	// O que a medição precisa, sempre atual, sem refazer `locate` a cada render.
	const live = useRef({ viewport, bottomBar, menuHeight });
	live.current = { viewport, bottomBar, menuHeight };

	const locate = useCallback((id: HomeWidgetId, mayScroll: boolean) => {
		const node = nodes.current.get(id);
		if (!node) return;
		node.measureInWindow((x, y, width, height) => {
			if (width === 0 && height === 0) return;
			const rect: Rect = { x, y, width, height };
			const dy = mayScroll
				? revealScroll({
						anchor: rect,
						menuHeight: live.current.menuHeight,
						viewport: live.current.viewport,
						bottomBar: live.current.bottomBar,
						gap: MENU_GAP,
						margin: MENU_MARGIN,
					})
				: 0;
			if (Math.abs(dy) < 1) {
				setAnchor((current) => (sameRect(current, rect) ? current : rect));
				return;
			}
			// A rolagem para nas pontas da lista, então a posição final é medida, não calculada.
			scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current + dy), animated: false });
			requestAnimationFrame(() => requestAnimationFrame(() => locate(id, false)));
		});
	}, []);

	const open = useCallback(
		(id: HomeWidgetId) => {
			setAnchor(null);
			setOpenId(id);
			locate(id, true);
		},
		[locate],
	);
	const close = useCallback(() => {
		setOpenId(null);
		setAnchor(null);
	}, []);

	const model = useMemo(() => (layout ? widgetMenuModel(layout, openId) : null), [layout, openId]);

	// Tamanho ou ordem mudou com o menu aberto (ou o menu foi medido): o widget está em outro lugar. Um quadro depois
	// do novo layout, mede de novo. Se o widget saiu do Início (removido, ou o servidor recusou), o menu fecha.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `layout` e `menuHeight` são os gatilhos da nova medida
	useEffect(() => {
		if (!openId) return;
		if (!model) {
			close();
			return;
		}
		const frame = requestAnimationFrame(() => locate(openId, true));
		return () => cancelAnimationFrame(frame);
	}, [openId, model, layout, menuHeight, viewport, close, locate]);

	const register = useCallback((id: HomeWidgetId, node: WidgetNode | null) => {
		if (node) nodes.current.set(id, node);
		else nodes.current.delete(id);
	}, []);

	const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
		scrollY.current = event.nativeEvent.contentOffset.y;
	}, []);

	return {
		/** Para o `ScrollView` do Início. */
		scrollRef,
		onScroll,
		/** Para cada widget da grade. */
		register,
		open,
		close,
		/** O menu aberto: o que oferece e onde o widget está; `null` fechado ou ainda medindo. */
		menu: model && anchor ? { model, anchor } : null,
		viewport,
		menuHeight,
		setMenuHeight,
	};
}

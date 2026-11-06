import { spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { Loadable } from "../../lib/loadable.ts";
import { Card, CardHeader, ErrorState, Skeleton } from "../../ui/index.ts";

/** Card com título que mostra esqueleto enquanto carrega, erro com "Tentar de novo" ou o conteúdo. */
export function LoadableCard<T>({
	title,
	state,
	skeletonLines = 3,
	chevron = false,
	action,
	gap = spacing.md,
	children,
}: {
	title: string;
	state: Loadable<T>;
	skeletonLines?: number;
	chevron?: boolean;
	action?: string | undefined;
	/** Espaço entre o título e o conteúdo carregado (esqueleto e erro usam sempre `md`). */
	gap?: number;
	children: (data: T) => ReactNode;
}) {
	return (
		<Card>
			<CardHeader title={title} chevron={chevron} action={action} />
			<View style={{ marginTop: state.phase === "loading" || state.phase === "error" ? spacing.md : gap }}>
				{state.phase === "loading" ? (
					<View accessibilityLabel="Carregando" style={{ gap: spacing.md }}>
						{Array.from({ length: skeletonLines }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: linhas de esqueleto fixas
							<Skeleton key={i} width={i === 0 ? "60%" : "100%"} height={i === 0 ? 32 : 16} />
						))}
					</View>
				) : state.phase === "error" ? (
					<ErrorState message={state.message} onRetry={state.retry} />
				) : (
					children(state.data)
				)}
			</View>
		</Card>
	);
}

import { spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { Loadable } from "../../lib/loadable.ts";
import { Card, ErrorState, Skeleton, Text } from "../../ui/index.ts";

/** Card com título que mostra esqueleto enquanto carrega, erro com "Tentar de novo" ou o conteúdo. */
export function LoadableCard<T>({
	title,
	state,
	skeletonLines = 3,
	children,
}: {
	title: string;
	state: Loadable<T>;
	skeletonLines?: number;
	children: (data: T) => ReactNode;
}) {
	return (
		<Card>
			<Text variant="cardTitle" tone="secondary">
				{title}
			</Text>
			<View style={{ marginTop: spacing.md }}>
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

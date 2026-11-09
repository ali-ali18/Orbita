import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import type { InvoiceView } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import { Card, ProgressBar, Text } from "../../ui/index.ts";
import { compositionBar, compositionRows } from "./card-model.ts";
import { Dot } from "./parts.tsx";

/** "O que entrou nela" com a barra por tipo e as quatro linhas. */
export function InvoiceComposition({ data, hidden }: { data: InvoiceView; hidden: boolean }) {
	const rows = compositionRows(data.composition);
	return (
		<Card style={{ gap: spacing.md }}>
			<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
				O que entrou nela
			</Text>
			<ProgressBar parts={compositionBar(rows)} height={10} />
			{rows.map((r) => (
				<View key={r.key} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
					<Dot color={r.color} />
					<Text variant="body" style={{ flex: 1 }}>
						{r.label}
					</Text>
					<Text variant="bodyStrong" tone={r.cents > 0 ? "primary" : "secondary"}>
						{money(r.cents, hidden, { sign: "never" })}
					</Text>
				</View>
			))}
		</Card>
	);
}

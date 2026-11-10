import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import { Card, OrbitaAvatar, Text } from "../../ui/index.ts";
import { EMPTY_HERO_BODY, EMPTY_HERO_TITLE } from "./checklist-model.ts";

/** "Ainda estou aprendendo seus números" (Figma 55:1138): ocupa o lugar do card principal no primeiro uso. */
export function EmptyHero() {
	return (
		<Card highlight={false} style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxxl }}>
			<OrbitaAvatar size={72} />
			<Text variant="numberMedium" style={{ textAlign: "center" }} accessibilityRole="header">
				{EMPTY_HERO_TITLE}
			</Text>
			<View style={{ paddingHorizontal: spacing.lg }}>
				<Text variant="caption" tone="secondary" style={{ textAlign: "center" }}>
					{EMPTY_HERO_BODY}
				</Text>
			</View>
		</Card>
	);
}

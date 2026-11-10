import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { useAccent } from "../../lib/theme.tsx";
import { Icon, Text } from "../../ui/index.ts";
import {
	type Checklist as ChecklistData,
	type ChecklistHref,
	type ChecklistItem,
	DISMISS_LABEL,
	progressText,
} from "./checklist-model.ts";

const CIRCLE = 24;

function Mark({ done }: { done: boolean }) {
	const { accent, onAccent } = useAccent();
	return (
		<View
			style={{
				width: CIRCLE,
				height: CIRCLE,
				borderRadius: radius.pill,
				backgroundColor: done ? accent : "transparent",
				borderWidth: done ? 0 : 2,
				borderColor: colors.textTertiary,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{done ? <Icon name="check" size={14} color={onAccent} /> : null}
		</View>
	);
}

function Row({
	item,
	last,
	onOpen,
}: {
	item: ChecklistItem;
	last: boolean;
	onOpen: (href: ChecklistHref) => void;
}) {
	const body = (
		<View
			style={{
				minHeight: 51,
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.md,
				paddingHorizontal: spacing.lg,
				borderBottomWidth: last ? 0 : 1,
				borderBottomColor: colors.border,
			}}
		>
			<Mark done={item.done} />
			<Text variant="body" tone={item.done ? "secondary" : "primary"} style={{ flex: 1 }}>
				{item.title}
			</Text>
			{item.done ? null : <Icon name="seta-direita" size={16} color={colors.textTertiary} />}
		</View>
	);
	if (item.done) {
		return (
			<View accessible accessibilityLabel={`${item.title}, concluído`}>
				{body}
			</View>
		);
	}
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${item.title}, pendente`}
			onPress={() => onOpen(item.href)}
			style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
		>
			{body}
		</Pressable>
	);
}

/** Primeiros passos do Início (Figma 55:1138). Cada passo pendente abre a tela onde se resolve. */
export function Checklist({
	checklist,
	onOpen,
	onDismiss,
}: {
	checklist: ChecklistData;
	onOpen: (href: ChecklistHref) => void;
	onDismiss: () => void;
}) {
	return (
		<View style={{ gap: spacing.sm }}>
			<View style={{ backgroundColor: colors.surface, borderRadius: radius.block, overflow: "hidden" }}>
				{checklist.items.map((item, i) => (
					<Row key={item.id} item={item} last={i === checklist.items.length - 1} onOpen={onOpen} />
				))}
			</View>
			<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
				<Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
					{progressText(checklist)}
				</Text>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={DISMISS_LABEL}
					onPress={onDismiss}
					hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
					style={{ minHeight: 44, justifyContent: "center" }}
				>
					<Text variant="caption" tone="secondary">
						{DISMISS_LABEL}
					</Text>
				</Pressable>
			</View>
		</View>
	);
}

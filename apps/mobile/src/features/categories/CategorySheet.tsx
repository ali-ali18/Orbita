import { chartSeries, colors, radius, spacing, text as typography } from "@orbita/tokens";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Button, familyByWeight, Sheet, Text } from "../../ui/index.ts";
import { COLOR_SLOTS, NAME_MAX } from "./categories-model.ts";

export interface CategoryDraft {
	name: string;
	chartSlot: number;
}

/** Gaveta de categoria: nome + cor do gráfico. Em categoria existente, também "Excluir" (menos nas do sistema). */
export function CategorySheet({
	visible,
	title,
	initial,
	canDelete,
	saving,
	deleting,
	error,
	onSave,
	onDelete,
	onClose,
}: {
	visible: boolean;
	title: string;
	initial: CategoryDraft;
	canDelete: boolean;
	saving: boolean;
	deleting: boolean;
	error: string | null;
	onSave: (draft: CategoryDraft) => void;
	onDelete: () => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title={title} onClose={onClose}>
			{visible ? (
				<Body
					initial={initial}
					canDelete={canDelete}
					saving={saving}
					deleting={deleting}
					error={error}
					onSave={onSave}
					onDelete={onDelete}
				/>
			) : null}
		</Sheet>
	);
}

function Body({
	initial,
	canDelete,
	saving,
	deleting,
	error,
	onSave,
	onDelete,
}: {
	initial: CategoryDraft;
	canDelete: boolean;
	saving: boolean;
	deleting: boolean;
	error: string | null;
	onSave: (draft: CategoryDraft) => void;
	onDelete: () => void;
}) {
	const [name, setName] = useState(initial.name);
	const [slot, setSlot] = useState(initial.chartSlot);
	const busy = saving || deleting;
	return (
		<View style={{ gap: spacing.lg, paddingVertical: spacing.md }}>
			<View style={{ gap: spacing.sm }}>
				<Text variant="caption" tone="secondary">
					Nome
				</Text>
				<TextInput
					value={name}
					onChangeText={setName}
					maxLength={NAME_MAX}
					autoFocus
					placeholder="Ex.: Viagem"
					placeholderTextColor={colors.textTertiary}
					accessibilityLabel="Nome da categoria"
					style={{
						height: 52,
						borderRadius: radius.inner,
						backgroundColor: colors.surface2,
						paddingHorizontal: spacing.lg,
						color: colors.text,
						fontFamily: familyByWeight[400],
						fontSize: typography.body.fontSize,
						lineHeight: typography.body.lineHeight,
					}}
				/>
			</View>
			<View style={{ gap: spacing.sm }}>
				<Text variant="caption" tone="secondary">
					Cor
				</Text>
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
					{chartSeries.slice(0, COLOR_SLOTS).map((color, i) => (
						<Pressable
							key={color}
							accessibilityRole="button"
							accessibilityLabel={`Cor ${i + 1}`}
							accessibilityState={{ selected: slot === i }}
							onPress={() => setSlot(i)}
							style={{
								width: 44,
								height: 44,
								borderRadius: radius.pill,
								alignItems: "center",
								justifyContent: "center",
								borderWidth: 2,
								borderColor: slot === i ? colors.text : "transparent",
							}}
						>
							<View style={{ width: 28, height: 28, borderRadius: radius.pill, backgroundColor: color }} />
						</Pressable>
					))}
				</View>
			</View>
			{error ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite">
					<Text variant="caption" tone="secondary">
						{error}
					</Text>
				</View>
			) : null}
			<Button
				label="Salvar"
				loading={saving}
				disabled={deleting || name.trim() === ""}
				onPress={() => onSave({ name, chartSlot: slot })}
			/>
			{canDelete ? (
				<Button
					label="Excluir categoria"
					variant="secondary"
					loading={deleting}
					disabled={busy}
					onPress={onDelete}
				/>
			) : null}
		</View>
	);
}

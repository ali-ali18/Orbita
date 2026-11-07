import { colors, radius, spacing, text as typography } from "@orbita/tokens";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Button, familyByWeight, Icon, type IconName, Sheet, Text } from "../../ui/index.ts";
import { CategoryChips, type CategoryOption } from "./CategoryChips.tsx";
import { type DeleteChoice, deleteMessage } from "./detail-model.ts";

function ErrorLine({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ paddingTop: spacing.md }}>
			<Text variant="caption" tone="secondary">
				{message}
			</Text>
		</View>
	);
}

/** Gaveta de categorias: tocar numa salva na hora (PATCH); tocar na atual tira a categoria. */
export function CategorySheet({
	visible,
	categories,
	selectedId,
	busy,
	message,
	onSelect,
	onClose,
}: {
	visible: boolean;
	categories: readonly CategoryOption[];
	selectedId: string | null;
	busy: boolean;
	message: string | null;
	onSelect: (id: string | null) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Categoria" onClose={onClose}>
			<View
				style={{ paddingTop: spacing.md, paddingBottom: spacing.sm, opacity: busy ? 0.5 : 1 }}
				pointerEvents={busy ? "none" : "auto"}
			>
				<CategoryChips categories={categories} selectedId={selectedId} onSelect={onSelect} allowNew={false} />
			</View>
			<ErrorLine message={message} />
		</Sheet>
	);
}

/** Gaveta com um campo de texto (descrição ou nota) e "Salvar". O rascunho nasce do valor atual a cada abertura. */
export function TextEditSheet({
	visible,
	title,
	label,
	initial,
	multiline = false,
	maxLength,
	busy,
	message,
	onSave,
	onClose,
}: {
	visible: boolean;
	title: string;
	label: string;
	initial: string;
	multiline?: boolean;
	maxLength: number;
	busy: boolean;
	message: string | null;
	onSave: (text: string) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title={title} onClose={onClose}>
			{visible ? (
				<TextEditBody
					label={label}
					initial={initial}
					multiline={multiline}
					maxLength={maxLength}
					busy={busy}
					message={message}
					onSave={onSave}
				/>
			) : null}
		</Sheet>
	);
}

function TextEditBody({
	label,
	initial,
	multiline,
	maxLength,
	busy,
	message,
	onSave,
}: {
	label: string;
	initial: string;
	multiline: boolean;
	maxLength: number;
	busy: boolean;
	message: string | null;
	onSave: (text: string) => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<View style={{ paddingTop: spacing.md, gap: spacing.md }}>
			<TextInput
				value={value}
				onChangeText={setValue}
				multiline={multiline}
				maxLength={maxLength}
				autoFocus
				accessibilityLabel={label}
				placeholder={label}
				placeholderTextColor={colors.textTertiary}
				style={{
					minHeight: multiline ? 104 : 52,
					borderRadius: radius.inner,
					backgroundColor: colors.surface2,
					paddingHorizontal: spacing.lg,
					paddingVertical: multiline ? spacing.md : 0,
					textAlignVertical: multiline ? "top" : "center",
					color: colors.text,
					fontFamily: familyByWeight[400],
					fontSize: typography.body.fontSize,
					lineHeight: typography.body.lineHeight,
					letterSpacing: typography.body.letterSpacing,
				}}
			/>
			<ErrorLine message={message} />
			<Button label="Salvar" onPress={() => onSave(value)} loading={busy} />
		</View>
	);
}

/** Linha de ação de uma gaveta (56 de altura, ícone à esquerda). */
function ActionRow({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: 56,
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.md,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<Icon name={icon} size={20} />
			<Text variant="body">{label}</Text>
		</Pressable>
	);
}

/** Menu das reticências do topo. */
export function MoreSheet({
	visible,
	onEditDescription,
	onEditNote,
	onDelete,
	onClose,
}: {
	visible: boolean;
	onEditDescription: () => void;
	onEditNote: () => void;
	onDelete: () => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Mais opções" onClose={onClose}>
			<ActionRow icon="lapis" label="Editar descrição" onPress={onEditDescription} />
			<ActionRow icon="etiqueta" label="Editar nota" onPress={onEditNote} />
			<ActionRow icon="lixeira" label="Apagar lançamento" onPress={onDelete} />
		</Sheet>
	);
}

/** Confirmação de apagar. Parcela oferece "só esta" ou "todo o parcelamento"; o botão explica o que some. */
export function DeleteSheet({
	visible,
	choices,
	installment,
	busy,
	message,
	onChoose,
	onClose,
}: {
	visible: boolean;
	choices: readonly DeleteChoice[];
	installment: boolean;
	busy: boolean;
	message: string | null;
	onChoose: (scope: DeleteChoice["scope"]) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title={installment ? "Apagar parcela" : "Apagar lançamento"} onClose={onClose}>
			<View style={{ paddingTop: spacing.md, gap: spacing.sm }}>
				<Text variant="body" tone="secondary" style={{ paddingBottom: spacing.sm }}>
					{deleteMessage(installment)}
				</Text>
				{choices.map((c) => (
					<Button
						key={c.scope}
						label={c.label}
						variant={c.scope === "item" ? "primary" : "secondary"}
						onPress={() => onChoose(c.scope)}
						loading={busy}
					/>
				))}
				<Button label="Cancelar" variant="secondary" onPress={onClose} disabled={busy} />
				<ErrorLine message={message} />
			</View>
		</Sheet>
	);
}

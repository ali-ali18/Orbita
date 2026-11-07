import type { Cents } from "@orbita/core";
import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { Button, Sheet, Text } from "../../ui/index.ts";
import { AmountInput } from "../transactions/AmountInput.tsx";

/** Gaveta do limite (total ou de uma categoria): teclado de centavos, "Salvar" e, se já havia limite, "Remover limite". */
export function BudgetSheet({
	visible,
	title,
	hint,
	initialCents,
	canRemove,
	saving,
	removing,
	error,
	onSave,
	onRemove,
	onClose,
}: {
	visible: boolean;
	title: string;
	hint?: string;
	initialCents: Cents;
	canRemove: boolean;
	saving: boolean;
	removing: boolean;
	error: string | null;
	onSave: (cents: Cents) => void;
	onRemove: () => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title={title} onClose={onClose}>
			{visible ? (
				<Body
					hint={hint}
					initialCents={initialCents}
					canRemove={canRemove}
					saving={saving}
					removing={removing}
					error={error}
					onSave={onSave}
					onRemove={onRemove}
				/>
			) : null}
		</Sheet>
	);
}

function Body({
	hint,
	initialCents,
	canRemove,
	saving,
	removing,
	error,
	onSave,
	onRemove,
}: {
	hint: string | undefined;
	initialCents: Cents;
	canRemove: boolean;
	saving: boolean;
	removing: boolean;
	error: string | null;
	onSave: (cents: Cents) => void;
	onRemove: () => void;
}) {
	const [cents, setCents] = useState<Cents>(initialCents);
	const busy = saving || removing;
	return (
		<View style={{ gap: spacing.lg, paddingVertical: spacing.md }}>
			{hint ? (
				<Text variant="caption" tone="secondary">
					{hint}
				</Text>
			) : null}
			<AmountInput cents={cents} onChange={setCents} autoFocus label="Limite do mês" />
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
				disabled={removing || cents <= 0}
				onPress={() => onSave(cents)}
			/>
			{canRemove ? (
				<Button
					label="Remover limite"
					variant="secondary"
					loading={removing}
					disabled={busy}
					onPress={onRemove}
				/>
			) : null}
		</View>
	);
}

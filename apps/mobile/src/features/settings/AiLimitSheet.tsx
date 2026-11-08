import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { errorMessage } from "../../lib/loadable.ts";
import { Button, Sheet, Text, TextField } from "../../ui/index.ts";
import { LIMIT_HINT, LIMIT_SHEET_TITLE, limitFieldValue, parseUsdInput } from "./ai-model.ts";

/** Gaveta do limite mensal de gasto com a IA, em dólares (US$). Vazio não vale: "Sem limite" é um botão. */
export function AiLimitSheet({
	visible,
	currentUsdCents,
	onSave,
	onClose,
}: {
	visible: boolean;
	currentUsdCents: number | null;
	onSave: (usdCents: number | null) => Promise<unknown>;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title={LIMIT_SHEET_TITLE} onClose={onClose}>
			{visible ? <LimitForm currentUsdCents={currentUsdCents} onSave={onSave} onClose={onClose} /> : null}
		</Sheet>
	);
}

function LimitForm({
	currentUsdCents,
	onSave,
	onClose,
}: {
	currentUsdCents: number | null;
	onSave: (usdCents: number | null) => Promise<unknown>;
	onClose: () => void;
}) {
	const [value, setValue] = useState(limitFieldValue(currentUsdCents));
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const save = async (cents: number | null) => {
		setBusy(true);
		setMessage(null);
		try {
			await onSave(cents);
			onClose();
		} catch (error) {
			setMessage(errorMessage(error));
		} finally {
			setBusy(false);
		}
	};

	const submit = () => {
		const parsed = parseUsdInput(value);
		if (!parsed.ok) {
			setMessage(parsed.message);
			return;
		}
		void save(parsed.cents);
	};

	return (
		<View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
			<Text variant="caption" tone="secondary">
				{LIMIT_HINT}
			</Text>
			<TextField
				value={value}
				onChangeText={(text) => {
					setValue(text);
					setMessage(null);
				}}
				keyboardType="decimal-pad"
				placeholder="Ex.: 10,00"
				accessibilityLabel="Limite mensal em dólares"
				onSubmitEditing={submit}
				returnKeyType="done"
			/>
			{message ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite">
					<Text variant="caption" tone="secondary">
						{message}
					</Text>
				</View>
			) : null}
			<Button label="Salvar" loading={busy} disabled={value.trim() === ""} onPress={submit} />
			<Button label="Sem limite" variant="secondary" disabled={busy} onPress={() => void save(null)} />
		</View>
	);
}

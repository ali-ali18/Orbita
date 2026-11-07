import { parseSecretValue, SECRET_LABELS, type SecretName } from "@orbita/shared";
import { colors, radius, spacing, text as typography } from "@orbita/tokens";
import { useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { errorMessage } from "../../lib/loadable.ts";
import { Button, familyByWeight, Sheet, Text } from "../../ui/index.ts";
import { pasteHint } from "./settings-model.ts";

/**
 * Gaveta para colar o valor de uma chave. O valor vive só neste estado: é limpo ao fechar e ao salvar,
 * não aparece na tela (campo protegido), não vai para log nem para cache, e as mensagens de erro nunca o citam.
 */
export function SecretSheet({
	name,
	configured,
	onSave,
	onAskRemove,
	onClose,
}: {
	/** `null` = fechada. */
	name: SecretName | null;
	configured: boolean;
	onSave: (name: SecretName, value: string) => Promise<void>;
	onAskRemove: (name: SecretName) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={name !== null} title={name ? SECRET_LABELS[name] : ""} onClose={onClose}>
			{/* O formulário só existe com a gaveta aberta: fechar desmonta e o valor digitado some. */}
			{name ? (
				<SecretForm
					key={name}
					name={name}
					configured={configured}
					onSave={onSave}
					onAskRemove={onAskRemove}
					onClose={onClose}
				/>
			) : null}
		</Sheet>
	);
}

function SecretForm({
	name,
	configured,
	onSave,
	onAskRemove,
	onClose,
}: {
	name: SecretName;
	configured: boolean;
	onSave: (name: SecretName, value: string) => Promise<void>;
	onAskRemove: (name: SecretName) => void;
	onClose: () => void;
}) {
	const [value, setValue] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const busy = useRef(false);

	const submit = async () => {
		if (busy.current) return;
		const parsed = parseSecretValue(name, value);
		if (!parsed.ok) {
			setMessage(parsed.message);
			return;
		}
		busy.current = true;
		setSaving(true);
		setMessage(null);
		try {
			await onSave(name, parsed.value);
			setValue("");
			onClose();
		} catch (error) {
			setMessage(errorMessage(error));
			busy.current = false;
			setSaving(false);
		}
	};

	const label = SECRET_LABELS[name];
	return (
		<View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
			<Text variant="caption" tone="secondary">
				{pasteHint(name)}
			</Text>
			<TextInput
				value={value}
				onChangeText={(t) => {
					setValue(t);
					setMessage(null);
				}}
				secureTextEntry
				autoCorrect={false}
				autoCapitalize="none"
				autoComplete="off"
				spellCheck={false}
				textContentType="none"
				importantForAutofill="no"
				contextMenuHidden
				placeholder={configured ? "Cole o novo valor" : "Cole o valor"}
				placeholderTextColor={colors.textTertiary}
				accessibilityLabel={`Valor de ${label}`}
				onSubmitEditing={() => void submit()}
				returnKeyType="done"
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
			{message ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite">
					<Text variant="caption" tone="secondary">
						{message}
					</Text>
				</View>
			) : null}
			<Button label="Salvar" loading={saving} disabled={value.trim() === ""} onPress={() => void submit()} />
			{configured ? (
				<Button label="Remover" variant="secondary" disabled={saving} onPress={() => onAskRemove(name)} />
			) : null}
		</View>
	);
}

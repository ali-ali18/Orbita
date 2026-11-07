import { SECRET_LABELS, type SecretName } from "@orbita/shared";
import { colors, radius, spacing, text as typography } from "@orbita/tokens";
import { useReducer, useRef } from "react";
import { TextInput, View } from "react-native";
import { Button, familyByWeight, Sheet, Text } from "../../ui/index.ts";
import { initialSecretForm, removeSecret, secretFormReducer, submitSecret } from "./secret-form-model.ts";
import { pasteHint, removeConfirmMessage, removeConfirmTitle } from "./settings-model.ts";

/**
 * Gaveta para colar o valor de uma chave. O valor vive só no estado do formulário: é zerado ao salvar,
 * a gaveta desmonta ao fechar, o campo é protegido e nada vai para log nem para cache.
 * "Remover" pede confirmação aqui dentro (um único Modal aberto, como o iOS exige).
 */
export function SecretSheet({
	name,
	configured,
	actions,
	onClose,
}: {
	/** `null` = fechada. */
	name: SecretName | null;
	configured: boolean;
	actions: {
		save: (name: SecretName, value: string) => Promise<void>;
		remove: (name: SecretName) => Promise<void>;
	};
	onClose: () => void;
}) {
	return (
		<Sheet visible={name !== null} title={name ? SECRET_LABELS[name] : ""} onClose={onClose}>
			{name ? (
				<SecretForm key={name} name={name} configured={configured} actions={actions} onClose={onClose} />
			) : null}
		</Sheet>
	);
}

function SecretForm({
	name,
	configured,
	actions,
	onClose,
}: {
	name: SecretName;
	configured: boolean;
	actions: {
		save: (name: SecretName, value: string) => Promise<void>;
		remove: (name: SecretName) => Promise<void>;
	};
	onClose: () => void;
}) {
	const [form, dispatch] = useReducer(secretFormReducer, initialSecretForm);
	// `busy` do estado só muda no próximo render; a trava em ref barra o segundo toque no mesmo instante.
	const locked = useRef(false);
	const label = SECRET_LABELS[name];

	const run = async (work: () => ReturnType<typeof submitSecret>) => {
		if (locked.current) return;
		locked.current = true;
		dispatch({ type: "started" });
		const outcome = await work();
		if (outcome.status === "saved") {
			dispatch({ type: "saved" });
			onClose();
			return;
		}
		locked.current = false;
		dispatch({ type: outcome.status === "invalid" ? "invalid" : "failed", message: outcome.message });
	};

	const submit = () => void run(() => submitSecret(name, form.value, actions.save));

	if (form.confirmingRemove) {
		return (
			<View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
				<Text variant="bodyStrong" accessibilityRole="header">
					{removeConfirmTitle(name)}
				</Text>
				<Text variant="caption" tone="secondary">
					{removeConfirmMessage(name)}
				</Text>
				{form.message ? (
					<View accessibilityRole="alert" accessibilityLiveRegion="polite">
						<Text variant="caption" tone="secondary">
							{form.message}
						</Text>
					</View>
				) : null}
				<Button
					label="Remover"
					loading={form.busy}
					onPress={() => void run(() => removeSecret(name, actions.remove))}
				/>
				<Button
					label="Cancelar"
					variant="secondary"
					disabled={form.busy}
					onPress={() => dispatch({ type: "cancel-remove" })}
				/>
			</View>
		);
	}

	return (
		<View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
			<Text variant="caption" tone="secondary">
				{pasteHint(name)}
			</Text>
			<TextInput
				value={form.value}
				onChangeText={(text) => dispatch({ type: "typed", text })}
				secureTextEntry
				autoCorrect={false}
				autoCapitalize="none"
				autoComplete="off"
				spellCheck={false}
				textContentType="none"
				importantForAutofill="no"
				placeholder={configured ? "Cole o novo valor" : "Cole o valor"}
				placeholderTextColor={colors.textTertiary}
				accessibilityLabel={`Valor de ${label}`}
				onSubmitEditing={submit}
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
			{form.message ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite">
					<Text variant="caption" tone="secondary">
						{form.message}
					</Text>
				</View>
			) : null}
			<Button label="Salvar" loading={form.busy} disabled={form.value.trim() === ""} onPress={submit} />
			{configured ? (
				<Button
					label="Remover"
					variant="secondary"
					disabled={form.busy}
					onPress={() => dispatch({ type: "ask-remove" })}
				/>
			) : null}
		</View>
	);
}

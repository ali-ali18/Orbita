import type { PluggyConnectionDto } from "@orbita/shared";
import { colors, radius, spacing, text as typography } from "@orbita/tokens";
import { type ReactNode, useReducer, useRef, useState } from "react";
import { Linking, Pressable, TextInput, View } from "react-native";
import { Button, familyByWeight, Sheet, Text } from "../../ui/index.ts";
import { ADD_HINT, connectionName, PLUGGY_LABEL_MAX, PLUGGY_URL } from "./banks-model.ts";
import {
	addFormReducer,
	type ConnectionOutcome,
	initialAddForm,
	removeConnection,
	submitConnection,
} from "./connection-form-model.ts";

type Add = (body: { itemId: string; label?: string }) => Promise<void>;
type Remove = (id: string) => Promise<void>;

function Field({
	label,
	value,
	onChangeText,
	placeholder,
	onSubmit,
	maxLength,
}: {
	label: string;
	value: string;
	onChangeText: (text: string) => void;
	placeholder: string;
	onSubmit?: () => void;
	maxLength?: number;
}) {
	// Sem `contextMenuHidden` e sem `secureTextEntry`: o ID não é segredo e precisa aceitar "colar".
	return (
		<TextInput
			value={value}
			onChangeText={onChangeText}
			autoCorrect={false}
			autoCapitalize="none"
			spellCheck={false}
			placeholder={placeholder}
			placeholderTextColor={colors.textTertiary}
			accessibilityLabel={label}
			onSubmitEditing={onSubmit}
			returnKeyType="done"
			{...(maxLength ? { maxLength } : {})}
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
	);
}

function Message({ children }: { children: ReactNode }) {
	return (
		<View accessibilityRole="alert" accessibilityLiveRegion="polite">
			<Text variant="caption" tone="secondary">
				{children}
			</Text>
		</View>
	);
}

/** Gaveta "Adicionar conexão": o ID da conexão do Meu Pluggy (UUID) e, se quiser, um nome. */
export function AddConnectionSheet({
	visible,
	add,
	onClose,
}: {
	visible: boolean;
	add: Add;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Adicionar conexão" onClose={onClose}>
			{visible ? <AddForm add={add} onClose={onClose} /> : null}
		</Sheet>
	);
}

function AddForm({ add, onClose }: { add: Add; onClose: () => void }) {
	const [form, dispatch] = useReducer(addFormReducer, initialAddForm);
	// Trava no mesmo instante do toque: `busy` só muda no próximo render.
	const locked = useRef(false);

	const submit = async () => {
		if (locked.current) return;
		locked.current = true;
		dispatch({ type: "started" });
		const outcome: ConnectionOutcome = await submitConnection(form, add);
		if (outcome.status === "saved") {
			onClose();
			return;
		}
		locked.current = false;
		dispatch({ type: "failed", message: outcome.message });
	};

	return (
		<View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
			<Text variant="caption" tone="secondary">
				{ADD_HINT}
			</Text>
			<Pressable
				accessibilityRole="link"
				accessibilityLabel="Abrir meu.pluggy.ai no navegador"
				onPress={() => void Linking.openURL(PLUGGY_URL).catch(() => {})}
				style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
			>
				<Text variant="bodyStrong">Abrir meu.pluggy.ai</Text>
			</Pressable>
			<Field
				label="ID da conexão"
				value={form.itemId}
				onChangeText={(text) => dispatch({ type: "id", text })}
				placeholder="00000000-0000-0000-0000-000000000000"
				onSubmit={() => void submit()}
			/>
			<Field
				label="Nome da conexão (opcional)"
				value={form.label}
				onChangeText={(text) => dispatch({ type: "label", text })}
				placeholder="Nome (opcional), ex.: Nubank"
				maxLength={PLUGGY_LABEL_MAX}
				onSubmit={() => void submit()}
			/>
			{form.message ? <Message>{form.message}</Message> : null}
			<Button
				label="Adicionar"
				loading={form.busy}
				disabled={form.itemId.trim() === ""}
				onPress={() => void submit()}
			/>
		</View>
	);
}

/** Gaveta de uma conexão: situação e "Remover" (a confirmação fica aqui dentro, num modal só). */
export function ConnectionSheet({
	connection,
	statusLine,
	remove,
	onClose,
}: {
	/** `null` = fechada. */
	connection: PluggyConnectionDto | null;
	statusLine: string;
	remove: Remove;
	onClose: () => void;
}) {
	return (
		<Sheet
			visible={connection !== null}
			title={connection ? connectionName(connection) : ""}
			onClose={onClose}
		>
			{connection ? (
				<ConnectionDetail
					key={connection.id}
					connection={connection}
					statusLine={statusLine}
					remove={remove}
					onClose={onClose}
				/>
			) : null}
		</Sheet>
	);
}

function ConnectionDetail({
	connection,
	statusLine,
	remove,
	onClose,
}: {
	connection: PluggyConnectionDto;
	statusLine: string;
	remove: Remove;
	onClose: () => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const locked = useRef(false);
	const name = connectionName(connection);

	const confirmRemove = async () => {
		if (locked.current) return;
		locked.current = true;
		setBusy(true);
		setMessage(null);
		const outcome = await removeConnection(connection.id, remove);
		if (outcome.status === "saved") {
			onClose();
			return;
		}
		locked.current = false;
		setBusy(false);
		setMessage(outcome.message);
	};

	if (confirming) {
		return (
			<View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
				<Text variant="bodyStrong" accessibilityRole="header">
					{`Remover ${name}?`}
				</Text>
				<Text variant="caption" tone="secondary">
					O Órbita para de sincronizar essa conexão. Os lançamentos, contas e cartões que já foram importados
					continuam no app.
				</Text>
				{message ? <Message>{message}</Message> : null}
				<Button label="Remover" loading={busy} onPress={() => void confirmRemove()} />
				<Button
					label="Cancelar"
					variant="secondary"
					disabled={busy}
					onPress={() => {
						setConfirming(false);
						setMessage(null);
					}}
				/>
			</View>
		);
	}

	return (
		<View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
			<Text variant="body" accessibilityLiveRegion="polite">
				{statusLine}
			</Text>
			<Text variant="caption" tone="secondary" selectable>
				{`ID da conexão: ${connection.id}`}
			</Text>
			<Button label="Remover conexão" variant="secondary" onPress={() => setConfirming(true)} />
		</View>
	);
}

import type { PluggyConnectionDto } from "@orbita/shared";
import { layout, spacing } from "@orbita/tokens";
import { type ComponentRef, type ReactNode, type Ref, useReducer, useRef, useState } from "react";
import { Linking, Pressable, type TextInput, View } from "react-native";
import { Button, Sheet, Text, TextField } from "../../ui/index.ts";
import {
	ADD_HINT,
	connectionName,
	connectionStatusDetail,
	PLUGGY_LABEL_MAX,
	PLUGGY_URL,
	REIMPORT_TITLE,
	REIMPORT_WARNING,
	reimportErrorMessage,
	UNNAMED_CONNECTION,
} from "./banks-model.ts";
import {
	addFormReducer,
	type ConnectionOutcome,
	initialAddForm,
	removeConnection,
	renameConnection,
	submitConnection,
} from "./connection-form-model.ts";

type Add = (body: { itemId: string; label?: string }) => Promise<void>;
type Remove = (id: string) => Promise<void>;
type Rename = (id: string, label: string) => Promise<void>;

/**
 * Número que sobe a cada abertura da gaveta. Serve de `key` do conteúdo: o formulário nasce limpo
 * a cada abertura, mas continua montado durante a animação de saída (a gaveta não esvazia ao fechar).
 */
function useOpenSeq(open: boolean): number {
	const [seq, setSeq] = useState(0);
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) setSeq((n) => n + 1);
	}
	return seq;
}

function Field({
	label,
	value,
	onChangeText,
	placeholder,
	onSubmit,
	maxLength,
	inputRef,
	returnKeyType = "done",
}: {
	label: string;
	value: string;
	onChangeText: (text: string) => void;
	placeholder: string;
	onSubmit?: () => void;
	maxLength?: number;
	inputRef?: Ref<ComponentRef<typeof TextInput>> | undefined;
	returnKeyType?: "done" | "next";
}) {
	// Sem `contextMenuHidden` e sem `secureTextEntry`: o ID não é segredo e precisa aceitar "colar".
	return (
		<TextField
			inputRef={inputRef}
			value={value}
			onChangeText={onChangeText}
			autoCorrect={false}
			autoCapitalize="none"
			spellCheck={false}
			placeholder={placeholder}
			accessibilityLabel={label}
			onSubmitEditing={onSubmit}
			returnKeyType={returnKeyType}
			submitBehavior={returnKeyType === "next" ? "submit" : "blurAndSubmit"}
			{...(maxLength ? { maxLength } : {})}
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
	const seq = useOpenSeq(visible);
	return (
		<Sheet visible={visible} title="Adicionar conexão" onClose={onClose}>
			<AddForm key={seq} add={add} onClose={onClose} />
		</Sheet>
	);
}

function AddForm({ add, onClose }: { add: Add; onClose: () => void }) {
	const [form, dispatch] = useReducer(addFormReducer, initialAddForm);
	// Trava no mesmo instante do toque: `busy` só muda no próximo render.
	const locked = useRef(false);
	const labelInput = useRef<ComponentRef<typeof TextInput>>(null);

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
				style={{ minHeight: layout.touchTarget, justifyContent: "center", alignSelf: "flex-start" }}
			>
				<Text variant="bodyStrong">Abrir meu.pluggy.ai</Text>
			</Pressable>
			<Field
				label="ID da conexão"
				value={form.itemId}
				onChangeText={(text) => dispatch({ type: "id", text })}
				placeholder="00000000-0000-0000-0000-000000000000"
				returnKeyType="next"
				onSubmit={() => labelInput.current?.focus()}
			/>
			<Field
				inputRef={labelInput}
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
	rename,
	remove,
	onClose,
}: {
	/** `null` = fechada. */
	connection: PluggyConnectionDto | null;
	statusLine: string;
	rename: Rename;
	remove: Remove;
	onClose: () => void;
}) {
	const seq = useOpenSeq(connection !== null);
	// Guarda o último conteúdo: ao fechar (ou se a conexão sumir da lista) a gaveta não esvazia na animação de saída.
	const [shown, setShown] = useState({ connection, statusLine });
	if (connection && (shown.connection !== connection || shown.statusLine !== statusLine)) {
		setShown({ connection, statusLine });
	}
	const content = shown.connection;
	return (
		<Sheet visible={connection !== null} title={content ? connectionName(content) : ""} onClose={onClose}>
			{content ? (
				<ConnectionDetail
					key={`${seq}:${content.id}`}
					connection={content}
					statusLine={shown.statusLine}
					rename={rename}
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
	rename,
	remove,
	onClose,
}: {
	connection: PluggyConnectionDto;
	statusLine: string;
	rename: Rename;
	remove: Remove;
	onClose: () => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const locked = useRef(false);
	const name = connectionName(connection);
	const statusDetail = connectionStatusDetail(connection);
	// "MeuPluggy" é o nome do conector, não um nome dado à conexão: o campo abre vazio para o dono escrever o banco.
	const currentLabel = name === UNNAMED_CONNECTION ? "" : (connection.label ?? "");
	const [labelText, setLabelText] = useState(currentLabel);
	const [saving, setSaving] = useState(false);
	const [saveMessage, setSaveMessage] = useState<string | null>(null);
	const saveLocked = useRef(false);

	const nameChanged = labelText.trim() !== "" && labelText.trim() !== currentLabel;

	const saveName = async () => {
		if (saveLocked.current || !nameChanged) return;
		saveLocked.current = true;
		setSaving(true);
		setSaveMessage(null);
		const outcome = await renameConnection(labelText, (label) => rename(connection.id, label));
		saveLocked.current = false;
		setSaving(false);
		if (outcome.status === "saved") onClose();
		else setSaveMessage(outcome.message);
	};

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
			<Text variant="body">{statusLine}</Text>
			{statusDetail ? (
				<Text variant="caption" tone="secondary">
					{statusDetail}
				</Text>
			) : null}
			<Text variant="caption" tone="secondary" selectable>
				{`ID da conexão: ${connection.id}`}
			</Text>
			<Field
				label="Nome da conexão"
				value={labelText}
				onChangeText={(text) => {
					setLabelText(text);
					setSaveMessage(null);
				}}
				placeholder="Nome da conexão"
				maxLength={PLUGGY_LABEL_MAX}
				onSubmit={() => void saveName()}
			/>
			{saveMessage ? <Message>{saveMessage}</Message> : null}
			<Button
				label="Salvar nome"
				variant="secondary"
				loading={saving}
				disabled={!nameChanged}
				onPress={() => void saveName()}
			/>
			<Button
				label="Remover conexão"
				variant="secondary"
				disabled={saving}
				onPress={() => setConfirming(true)}
			/>
		</View>
	);
}

/** Gaveta "Reimportar do zero": explica o que some e o que fica, e só então confirma (um modal só). */
export function ReimportSheet({
	visible,
	reimport,
	onClose,
}: {
	visible: boolean;
	reimport: () => Promise<void>;
	onClose: () => void;
}) {
	const seq = useOpenSeq(visible);
	return (
		<Sheet visible={visible} title={REIMPORT_TITLE} onClose={onClose}>
			<ReimportForm key={seq} reimport={reimport} onClose={onClose} />
		</Sheet>
	);
}

function ReimportForm({ reimport, onClose }: { reimport: () => Promise<void>; onClose: () => void }) {
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const locked = useRef(false);

	const confirm = async () => {
		if (locked.current) return;
		locked.current = true;
		setBusy(true);
		setMessage(null);
		try {
			await reimport();
			onClose();
		} catch (error) {
			locked.current = false;
			setBusy(false);
			setMessage(reimportErrorMessage(error));
		}
	};

	return (
		<View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
			<Text variant="caption" tone="secondary">
				{REIMPORT_WARNING}
			</Text>
			{message ? <Message>{message}</Message> : null}
			<Button label="Apagar e reimportar" loading={busy} onPress={() => void confirm()} />
			<Button label="Cancelar" variant="secondary" disabled={busy} onPress={onClose} />
		</View>
	);
}

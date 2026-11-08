import { colors, layout, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { type ReactNode, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { errorMessage } from "../../lib/loadable.ts";
import { Button, Icon, IconButton, type IconName, Screen, Sheet, Text, TextField } from "../../ui/index.ts";
import type { ParsedName } from "./profile-model.ts";

/**
 * Esqueleto das telas de Configurações: voltar, título, linha de apoio e o conteúdo rolando.
 * `back` é para onde o botão volta quando não há histórico (abriu direto no link).
 */
export function SubScreen({
	title,
	subtitle,
	children,
	footer,
}: {
	title: string;
	subtitle?: string;
	children: ReactNode;
	footer?: ReactNode;
}) {
	const router = useRouter();
	return (
		<Screen {...(footer ? { footer } : {})}>
			<ScrollView
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={{
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
					gap: spacing.md,
				}}
			>
				<View style={{ height: layout.touchTarget, justifyContent: "center", alignItems: "flex-start" }}>
					<IconButton
						icon="voltar"
						label="Voltar"
						onPress={() => (router.canGoBack() ? router.back() : router.replace("/configuracoes"))}
					/>
				</View>
				<View style={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
					<Text variant="greeting" accessibilityRole="header">
						{title}
					</Text>
					{subtitle ? (
						<Text variant="body" tone="secondary">
							{subtitle}
						</Text>
					) : null}
				</View>
				{children}
			</ScrollView>
		</Screen>
	);
}

/** Cartão de aviso (ícone + texto). `alert` faz o leitor de tela anunciar quando aparece. */
export function Note({ icon, text, alert = false }: { icon: IconName; text: string; alert?: boolean }) {
	return (
		<View
			{...(alert ? { accessibilityRole: "alert" as const } : {})}
			style={{
				flexDirection: "row",
				gap: spacing.md,
				alignItems: "flex-start",
				backgroundColor: colors.surface,
				borderRadius: radius.group,
				padding: spacing.lg,
			}}
		>
			<Icon name={icon} size={20} color={colors.textSecondary} />
			<View style={{ flex: 1 }}>
				<Text variant="caption" tone="secondary">
					{text}
				</Text>
			</View>
		</View>
	);
}

/**
 * Gaveta com um campo de texto: valida com `parse` (mesmas regras do servidor), grava com `onSave` e mostra o erro
 * em linha. Com `onClear`, aparece "Remover" (para campo opcional, como o nome).
 */
export function TextEditSheet({
	visible,
	title,
	hint,
	initial,
	placeholder,
	parse,
	onSave,
	onClear,
	clearLabel = "Remover",
	onClose,
}: {
	visible: boolean;
	title: string;
	hint?: string;
	initial: string;
	placeholder: string;
	parse: (input: string) => ParsedName;
	onSave: (value: string) => Promise<unknown>;
	onClear?: () => Promise<unknown>;
	clearLabel?: string;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title={title} onClose={onClose}>
			{visible ? (
				<TextEditForm
					initial={initial}
					hint={hint}
					placeholder={placeholder}
					parse={parse}
					onSave={onSave}
					onClear={onClear}
					clearLabel={clearLabel}
					onClose={onClose}
					label={title}
				/>
			) : null}
		</Sheet>
	);
}

function TextEditForm({
	initial,
	hint,
	placeholder,
	parse,
	onSave,
	onClear,
	clearLabel,
	onClose,
	label,
}: {
	initial: string;
	hint: string | undefined;
	placeholder: string;
	parse: (input: string) => ParsedName;
	onSave: (value: string) => Promise<unknown>;
	onClear: (() => Promise<unknown>) | undefined;
	clearLabel: string;
	onClose: () => void;
	label: string;
}) {
	const [value, setValue] = useState(initial);
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// `busy` só muda no próximo render; a trava em ref barra o segundo toque no mesmo instante.
	const locked = useRef(false);

	const run = async (work: () => Promise<unknown>) => {
		if (locked.current) return;
		locked.current = true;
		setBusy(true);
		setMessage(null);
		try {
			await work();
			onClose();
		} catch (error) {
			locked.current = false;
			setBusy(false);
			setMessage(errorMessage(error));
		}
	};

	const save = () => {
		const parsed = parse(value);
		if (!parsed.ok) {
			setMessage(parsed.message);
			return;
		}
		void run(() => onSave(parsed.value));
	};

	return (
		<View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
			{hint ? (
				<Text variant="caption" tone="secondary">
					{hint}
				</Text>
			) : null}
			<TextField
				value={value}
				onChangeText={(text) => {
					setValue(text);
					setMessage(null);
				}}
				placeholder={placeholder}
				accessibilityLabel={label}
				autoFocus
				returnKeyType="done"
				onSubmitEditing={save}
			/>
			{message ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite">
					<Text variant="caption" tone="secondary">
						{message}
					</Text>
				</View>
			) : null}
			<Button label="Salvar" loading={busy} onPress={save} />
			{onClear && initial !== "" ? (
				<Button label={clearLabel} variant="secondary" disabled={busy} onPress={() => void run(onClear)} />
			) : null}
		</View>
	);
}

/** Linha de escolha única (rádio): título, legenda e a bolinha. Sem `onPress` fica esmaecida, com "Em breve". */
export function ChoiceRow({
	title,
	caption,
	selected,
	onPress,
	last = false,
}: {
	title: string;
	caption: string;
	selected: boolean;
	/** Ausente = ainda não existe: esmaecida, sem toque, com "Em breve". */
	onPress?: () => void;
	last?: boolean;
}) {
	const enabled = onPress !== undefined;
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityLabel={[title, caption, enabled ? undefined : "em breve"].filter(Boolean).join(", ")}
			accessibilityState={{ checked: selected, disabled: !enabled }}
			disabled={!enabled}
			onPress={onPress}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.lg,
				minHeight: layout.touchTarget,
				paddingHorizontal: spacing.lg,
				paddingVertical: spacing.md,
				borderBottomWidth: last ? 0 : 1,
				borderBottomColor: colors.border,
				opacity: !enabled ? 0.45 : pressed ? 0.8 : 1,
			})}
		>
			<View
				style={{
					width: spacing.xl,
					height: spacing.xl,
					borderRadius: radius.pill,
					borderWidth: 2,
					borderColor: selected ? colors.accent : colors.textSecondary,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{selected ? (
					<View
						style={{
							width: spacing.md,
							height: spacing.md,
							borderRadius: radius.pill,
							backgroundColor: colors.accent,
						}}
					/>
				) : null}
			</View>
			<View style={{ flex: 1 }}>
				<Text variant="body">{title}</Text>
				<Text variant="caption" tone="secondary">
					{caption}
				</Text>
			</View>
			{enabled ? null : (
				<Text variant="caption" tone="tertiary">
					Em breve
				</Text>
			)}
		</Pressable>
	);
}

import { formatBRL } from "@orbita/core";
import { chart, colors, layout, radius, spacing } from "@orbita/tokens";
import { type ComponentRef, useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { percentOf } from "../../lib/format.ts";
import { Icon, IconButton, type IconName, OrbitaAvatar, Screen, Text } from "../../ui/index.ts";
import type { MonthRow } from "./reply.ts";

const SUGGESTIONS = [
	"Quanto gastei com delivery?",
	"Lançar um gasto",
	"Como fecha o mês?",
	"Ler um comprovante",
];

export type ChatBubble =
	| { id: string; kind: "user"; text: string }
	| { id: string; kind: "text"; text: string }
	| { id: string; kind: "month"; text: string; rows: readonly MonthRow[] }
	| {
			id: string;
			kind: "launch";
			description: string;
			caption: string;
			amount: string;
			onUndo?: () => void;
			onEdit?: () => void;
	  };

const TONE_COLOR = {
	income: chart.aqua,
	spent: chart.orange,
	projection: chart.blue,
} as const;

function MonthCard({ text, rows }: { text: string; rows: readonly MonthRow[] }) {
	const max = rows.reduce((highest, row) => Math.max(highest, row.cents), 0);
	return (
		<View style={{ gap: spacing.md, alignSelf: "stretch" }}>
			<Text variant="body">{text}</Text>
			<View
				style={{
					backgroundColor: colors.surface,
					borderRadius: radius.group,
					padding: spacing.lg,
					gap: spacing.md,
				}}
			>
				{rows.map((row) => (
					<View key={row.label} style={{ gap: spacing.sm }}>
						<View style={{ flexDirection: "row", alignItems: "center" }}>
							<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
								{row.label}
							</Text>
							<Text variant="bodyStrong">{formatBRL(row.cents)}</Text>
						</View>
						<View
							style={{
								height: 6,
								borderRadius: radius.pill,
								backgroundColor: colors.surface3,
								overflow: "hidden",
							}}
						>
							<View
								style={{
									height: 6,
									width: `${percentOf(row.cents, max)}%`,
									borderRadius: radius.pill,
									backgroundColor: TONE_COLOR[row.tone],
								}}
							/>
						</View>
					</View>
				))}
			</View>
		</View>
	);
}

function LaunchCard({
	description,
	caption,
	amount,
	onUndo,
	onEdit,
}: {
	description: string;
	caption: string;
	amount: string;
	onUndo?: () => void;
	onEdit?: () => void;
}) {
	return (
		<View
			style={{
				alignSelf: "stretch",
				backgroundColor: colors.surface,
				borderRadius: radius.group,
				padding: spacing.lg,
				gap: spacing.md,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
				<View
					style={{
						width: 20,
						height: 20,
						borderRadius: radius.sm,
						backgroundColor: colors.accent,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Icon name="check" size={12} color={colors.onAccent} />
				</View>
				<Text variant="caption" tone="secondary">
					Lancei
				</Text>
			</View>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
				<View
					style={{
						width: 44,
						height: 44,
						borderRadius: radius.pill,
						backgroundColor: colors.surface2,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Icon name="comida" size={20} />
				</View>
				<View style={{ flex: 1, gap: 2 }}>
					<Text variant="bodyStrong">{description}</Text>
					<Text variant="caption" tone="secondary">
						{caption}
					</Text>
				</View>
				<Text variant="bodyStrong">{amount}</Text>
			</View>
			{onUndo || onEdit ? (
				<View style={{ flexDirection: "row", gap: spacing.sm }}>
					{onUndo ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Desfazer"
							onPress={onUndo}
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: 6,
								backgroundColor: colors.surface2,
								borderRadius: radius.pill,
								paddingHorizontal: spacing.md,
								paddingVertical: spacing.sm,
							}}
						>
							<Icon name="desfazer" size={16} />
							<Text variant="caption">Desfazer</Text>
						</Pressable>
					) : null}
					{onEdit ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Mudar categoria"
							onPress={onEdit}
							style={{
								backgroundColor: colors.surface2,
								borderRadius: radius.pill,
								paddingHorizontal: spacing.md,
								paddingVertical: spacing.sm,
							}}
						>
							<Text variant="caption">Mudar categoria</Text>
						</Pressable>
					) : null}
				</View>
			) : null}
		</View>
	);
}

function Bubble({ message }: { message: ChatBubble }) {
	if (message.kind === "user") {
		return (
			<View style={{ alignSelf: "flex-end", maxWidth: "88%" }}>
				<View
					style={{
						backgroundColor: colors.surface2,
						borderRadius: radius.block,
						paddingHorizontal: spacing.lg,
						paddingVertical: 11,
					}}
				>
					<Text variant="body">{message.text}</Text>
				</View>
			</View>
		);
	}
	if (message.kind === "month") return <MonthCard text={message.text} rows={message.rows} />;
	if (message.kind === "launch") return <LaunchCard {...message} />;
	return <Text variant="body">{message.text}</Text>;
}

/** Tela do chat. Os números das respostas já vêm prontos de quem chamou. */
export function ChatView({
	messages,
	onClose,
	onReset,
	onSend,
	onAttach,
}: {
	messages: readonly ChatBubble[];
	onClose: () => void;
	onReset: () => void;
	onSend: (text: string) => void;
	/** Comprovante ou foto, depois que a folha fecha. */
	onAttach?: (kind: "receipt" | "photo") => void;
}) {
	const [draft, setDraft] = useState("");
	const [attachOpen, setAttachOpen] = useState(false);
	const empty = messages.length === 0;
	const send = () => {
		const text = draft.trim();
		if (!text) return;
		setDraft("");
		onSend(text);
	};
	return (
		<Screen>
			<View style={{ flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg }}>
				<View style={{ flexDirection: "row", alignItems: "center" }}>
					<IconButton icon="fechar" label="Fechar" onPress={onClose} />
					<View
						style={{
							flex: 1,
							flexDirection: "row",
							alignItems: "center",
							justifyContent: "center",
							gap: spacing.sm,
						}}
					>
						<OrbitaAvatar size={24} />
						<Text variant="bodyStrong">Órbita</Text>
					</View>
					<IconButton icon="relogio" label="Nova conversa" onPress={onReset} />
				</View>
				{empty ? (
					<View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 6 }}>
						<OrbitaAvatar size={88} />
						<View style={{ height: spacing.md }} />
						<Text variant="numberMedium">Olá</Text>
						<Text variant="body" tone="secondary">
							Como posso te ajudar com o seu dinheiro?
						</Text>
					</View>
				) : (
					<ScrollView
						style={{ flex: 1 }}
						contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", gap: 14 }}
					>
						{messages.map((message) => (
							<Bubble key={message.id} message={message} />
						))}
					</ScrollView>
				)}
				{empty ? <Suggestions onSend={onSend} onAttach={() => setAttachOpen(true)} /> : null}
				<Composer draft={draft} onChange={setDraft} onSend={send} onAttach={() => setAttachOpen(true)} />
			</View>
			<AttachSheet
				visible={attachOpen}
				onClose={() => setAttachOpen(false)}
				onChoose={(kind) => {
					setAttachOpen(false);
					onAttach?.(kind);
				}}
			/>
		</Screen>
	);
}

function AttachChoice({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			style={{
				flex: 1,
				height: 88,
				borderRadius: radius.group,
				backgroundColor: colors.surface2,
				alignItems: "center",
				justifyContent: "center",
				gap: 6,
			}}
		>
			<Icon name={icon} size={24} />
			<Text variant="caption">{label}</Text>
		</Pressable>
	);
}

const SHEET_LIFT = 180;
const SHEET_DISMISS = 72;

function pageYOf(event: Event): number | null {
	if ("pageY" in event && typeof event.pageY === "number") return event.pageY;
	return null;
}

/** Folha de baixo, sem o X: a barrinha sobe ou desce o painel e, puxada para baixo, fecha. */
function AttachSheet({
	visible,
	onClose,
	onChoose,
}: {
	visible: boolean;
	onClose: () => void;
	onChoose: (kind: "receipt" | "photo") => void;
}) {
	const insets = useSafeAreaInsets();
	const rest = useRef(0);
	const [offset, setOffset] = useState(0);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	useEffect(() => {
		if (visible) return;
		rest.current = 0;
		setOffset(0);
	}, [visible]);
	const drag = useRef({ y: 0, last: 0, time: 0, velocity: 0, active: false });
	const begin = (pageY: number) => {
		drag.current = { y: pageY, last: pageY, time: Date.now(), velocity: 0, active: true };
	};
	const slide = (pageY: number) => {
		if (!drag.current.active) return;
		const now = Date.now();
		drag.current.velocity = (pageY - drag.current.last) / Math.max(1, now - drag.current.time);
		drag.current.last = pageY;
		drag.current.time = now;
		setOffset(Math.min(SHEET_LIFT, rest.current - (pageY - drag.current.y)));
	};
	const end = () => {
		if (!drag.current.active) return;
		drag.current.active = false;
		const next = rest.current - (drag.current.last - drag.current.y);
		if (next < -SHEET_DISMISS || drag.current.velocity > 0.8) {
			rest.current = 0;
			setOffset(0);
			onCloseRef.current();
			return;
		}
		const settled = next > SHEET_LIFT / 2 ? SHEET_LIFT : 0;
		rest.current = settled;
		setOffset(settled);
	};
	const handlers = useRef({ begin, slide, end });
	handlers.current = { begin, slide, end };
	const detachDrag = useRef<(() => void) | null>(null);
	const bindHandle = useCallback((node: ComponentRef<typeof View> | null) => {
		detachDrag.current?.();
		detachDrag.current = null;
		const element = node as unknown as {
			addEventListener?: (type: string, listener: (event: Event) => void) => void;
			removeEventListener?: (type: string, listener: (event: Event) => void) => void;
			ownerDocument?: {
				addEventListener: (type: string, listener: (event: Event) => void) => void;
				removeEventListener: (type: string, listener: (event: Event) => void) => void;
			};
		} | null;
		if (!element?.addEventListener || !element.ownerDocument) return;
		const documentNode = element.ownerDocument;
		const down = (event: Event) => {
			const pageY = pageYOf(event);
			if (pageY === null) return;
			handlers.current.begin(pageY);
			const move = (pointer: Event) => {
				const y = pageYOf(pointer);
				if (y !== null) handlers.current.slide(y);
			};
			const up = () => {
				documentNode.removeEventListener("pointermove", move);
				documentNode.removeEventListener("pointerup", up);
				handlers.current.end();
			};
			documentNode.addEventListener("pointermove", move);
			documentNode.addEventListener("pointerup", up);
		};
		element.addEventListener("pointerdown", down);
		detachDrag.current = () => element.removeEventListener?.("pointerdown", down);
	}, []);
	const lifted = Math.max(0, offset);
	const pulled = Math.max(0, -offset);
	return (
		<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
			<View style={{ flex: 1, justifyContent: "flex-end" }}>
				<Pressable
					accessibilityLabel="Fechar"
					onPress={onClose}
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						backgroundColor: colors.background,
						opacity: 0.7,
					}}
				/>
				<View
					accessibilityViewIsModal
					style={{
						backgroundColor: colors.surface,
						borderTopLeftRadius: radius.card,
						borderTopRightRadius: radius.card,
						paddingHorizontal: spacing.xl,
						paddingBottom: Math.max(insets.bottom, layout.homeIndicator),
						transform: [{ translateY: pulled - lifted }],
					}}
				>
					<View
						ref={bindHandle}
						accessibilityRole="adjustable"
						accessibilityLabel="Mover a folha"
						onTouchStart={(event) => begin(event.nativeEvent.pageY)}
						onTouchMove={(event) => slide(event.nativeEvent.pageY)}
						onTouchEnd={end}
						onTouchCancel={end}
						style={{ alignItems: "center", paddingTop: 10, paddingBottom: spacing.lg }}
					>
						<View
							style={{
								width: 36,
								height: 4,
								borderRadius: radius.pill,
								backgroundColor: colors.textSecondary,
							}}
						/>
					</View>
					<View style={{ flexDirection: "row", gap: spacing.md, paddingBottom: spacing.sm }}>
						<AttachChoice icon="escanear" label="Comprovante" onPress={() => onChoose("receipt")} />
						<AttachChoice icon="foto" label="Foto" onPress={() => onChoose("photo")} />
					</View>
				</View>
			</View>
		</Modal>
	);
}

function Suggestion({ label, onSend }: { label: string; onSend: (text: string) => void }) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={() => onSend(label)}
			style={{
				flexShrink: 1,
				minWidth: 0,
				maxWidth: "48%",
				backgroundColor: colors.surface,
				borderWidth: 1,
				borderColor: colors.border,
				borderRadius: radius.pill,
				paddingHorizontal: 12,
				paddingVertical: 6,
			}}
		>
			<Text variant="caption" numberOfLines={1} ellipsizeMode="tail">
				{label}
			</Text>
		</Pressable>
	);
}

/** Duas linhas menores. O que não cabe na pílula termina em reticências. */
function Suggestions({ onSend, onAttach }: { onSend: (text: string) => void; onAttach: () => void }) {
	const rows = [SUGGESTIONS.slice(0, 2), SUGGESTIONS.slice(2)];
	return (
		<View style={{ alignSelf: "stretch", gap: spacing.sm }}>
			{rows.map((row) => (
				<View key={row[0]} style={{ flexDirection: "row", gap: spacing.sm }}>
					{row.map((label) => (
						<Suggestion
							key={label}
							label={label}
							onSend={label === "Ler um comprovante" ? () => onAttach() : onSend}
						/>
					))}
				</View>
			))}
		</View>
	);
}

function Composer({
	draft,
	onChange,
	onSend,
	onAttach,
}: {
	draft: string;
	onChange: (text: string) => void;
	onSend: () => void;
	onAttach: () => void;
}) {
	const ready = draft.trim().length > 0;
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
			<IconButton icon="mais" label="Anexar" size={52} iconSize={22} bordered onPress={onAttach} />
			<View
				style={{
					flex: 1,
					height: 52,
					borderRadius: radius.pill,
					backgroundColor: colors.surface,
					borderWidth: 1,
					borderColor: colors.border,
					flexDirection: "row",
					alignItems: "center",
					paddingLeft: 18,
					paddingRight: 6,
					gap: spacing.sm,
				}}
			>
				<TextInput
					value={draft}
					onChangeText={onChange}
					placeholder="Pergunte ou lance um gasto"
					placeholderTextColor={colors.textSecondary}
					style={{ flex: 1, color: colors.text, fontSize: 15 }}
					onSubmitEditing={onSend}
					accessibilityLabel="Pergunte ou lance um gasto"
				/>
				<Icon name="escanear" size={20} color={colors.textSecondary} />
				<IconButton
					icon={ready ? "enviar" : "microfone"}
					label={ready ? "Enviar" : "Ditar"}
					size={40}
					iconSize={20}
					filled
					{...(ready ? { onPress: onSend } : { disabled: true })}
				/>
			</View>
		</View>
	);
}

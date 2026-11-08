import type { ChatCard, ChatRowsCard, ProposalDto, SetupSelection } from "@orbita/shared";
import { chart, colors, radius, spacing } from "@orbita/tokens";
import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { percentOf } from "../../lib/format.ts";
import {
	Button,
	Icon,
	IconButton,
	OrbitaAvatar,
	Screen,
	Sheet,
	SheetGroup,
	SheetRow,
	Text,
} from "../../ui/index.ts";
import { hello } from "../settings/profile-model.ts";
import { type ChatBubble, NO_KEY_ACTION_LABEL, PROPOSAL_STATUS_LABEL, proposalAmount } from "./chat-model.ts";
import { SetupCard } from "./SetupCard.tsx";

const SUGGESTIONS = [
	"Quanto gastei com delivery?",
	"Lançar um gasto",
	"Como fecha o mês?",
	"Ler um comprovante",
];

export type ProposalAction = "confirm" | "cancel" | "undo";

/** Card de resultado de ferramenta: título, linhas (rótulo, legenda, valor) e uma barra quando a linha é dinheiro. */
function RowsCard({ card }: { card: ChatRowsCard }) {
	const max = card.rows.reduce((highest, row) => Math.max(highest, row.cents ?? 0), 0);
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
			<Text variant="bodyStrong" accessibilityRole="header">
				{card.title}
			</Text>
			{card.rows.length === 0 ? (
				<Text variant="caption" tone="secondary">
					Nada por aqui.
				</Text>
			) : null}
			{card.rows.map((row) => (
				<View key={`${row.label}|${row.caption}|${row.value}`} style={{ gap: spacing.sm }}>
					<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
						<View style={{ flex: 1, gap: 2 }}>
							<Text variant="caption" numberOfLines={1}>
								{row.label}
							</Text>
							{row.caption ? (
								<Text variant="caption" tone="secondary" numberOfLines={1}>
									{row.caption}
								</Text>
							) : null}
						</View>
						<Text variant="bodyStrong">{row.value}</Text>
					</View>
					{row.cents !== null && max > 0 ? (
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
									backgroundColor: chart.blue,
								}}
							/>
						</View>
					) : null}
				</View>
			))}
			{card.total ? (
				<View style={{ flexDirection: "row", alignItems: "center", paddingTop: spacing.xs }}>
					<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
						{card.total.label}
					</Text>
					<Text variant="bodyStrong">{card.total.value}</Text>
				</View>
			) : null}
		</View>
	);
}

/**
 * Proposta de escrita da IA. Nada foi gravado até o dono tocar em "Confirmar"; depois de confirmada ganha
 * "Desfazer" (e abre o lançamento, quando há um).
 */
function ProposalCard({
	proposal,
	busy,
	onAction,
	onOpenTransaction,
}: {
	proposal: ProposalDto;
	busy: boolean;
	onAction: (action: ProposalAction, proposal: ProposalDto) => void;
	onOpenTransaction?: ((id: string) => void) | undefined;
}) {
	const done = proposal.status === "confirmed";
	const closed = proposal.status === "canceled" || proposal.status === "undone";
	const amount = proposalAmount(proposal);
	const rest = proposal.lines.filter((line) => line.label !== "Valor");
	return (
		<View
			style={{
				alignSelf: "stretch",
				backgroundColor: colors.surface,
				borderRadius: radius.group,
				padding: spacing.lg,
				gap: spacing.md,
				opacity: closed ? 0.7 : 1,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
				<View
					style={{
						width: 20,
						height: 20,
						borderRadius: radius.sm,
						backgroundColor: done ? colors.accent : colors.surface3,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Icon name="check" size={12} color={done ? colors.onAccent : colors.textSecondary} />
				</View>
				<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
					{proposal.title} · {PROPOSAL_STATUS_LABEL[proposal.status]}
				</Text>
				{amount ? <Text variant="bodyStrong">{amount}</Text> : null}
			</View>
			<View style={{ gap: spacing.xs }}>
				{rest.map((line) => (
					<View key={line.label} style={{ flexDirection: "row", gap: spacing.md }}>
						<Text variant="caption" tone="secondary" style={{ width: 88 }}>
							{line.label}
						</Text>
						<Text variant="caption" style={{ flex: 1 }}>
							{line.value}
						</Text>
					</View>
				))}
			</View>
			{proposal.status === "pending" ? (
				<View style={{ flexDirection: "row", gap: spacing.sm }}>
					<Button
						label="Confirmar"
						compact
						loading={busy}
						onPress={() => onAction("confirm", proposal)}
						style={{ flex: 1 }}
					/>
					<Button
						label="Cancelar"
						variant="secondary"
						compact
						disabled={busy}
						onPress={() => onAction("cancel", proposal)}
						style={{ flex: 1 }}
					/>
				</View>
			) : null}
			{done ? (
				<View style={{ flexDirection: "row", gap: spacing.sm }}>
					<Button
						label="Desfazer"
						variant="secondary"
						compact
						icon="desfazer"
						loading={busy}
						onPress={() => onAction("undo", proposal)}
						style={{ flex: 1 }}
					/>
					{proposal.transactionId && onOpenTransaction ? (
						<Button
							label="Ver lançamento"
							variant="secondary"
							compact
							disabled={busy}
							onPress={() => onOpenTransaction(proposal.transactionId as string)}
							style={{ flex: 1 }}
						/>
					) : null}
				</View>
			) : null}
		</View>
	);
}

function CardView({
	card,
	busyProposalId,
	onProposal,
	onOpenTransaction,
}: {
	card: ChatCard;
	busyProposalId: string | null;
	onProposal: (action: ProposalAction, proposal: ProposalDto, selection?: SetupSelection) => void;
	onOpenTransaction?: ((id: string) => void) | undefined;
}) {
	if (card.type === "rows") return <RowsCard card={card} />;
	const { proposal } = card;
	if (proposal.kind === "setup" && proposal.setup) {
		return (
			<SetupCard
				proposal={proposal}
				setup={proposal.setup}
				busy={busyProposalId === proposal.id}
				onConfirm={(selection) => onProposal("confirm", proposal, selection)}
				onCancel={() => onProposal("cancel", proposal)}
				onUndo={() => onProposal("undo", proposal)}
			/>
		);
	}
	return (
		<ProposalCard
			proposal={card.proposal}
			busy={busyProposalId === card.proposal.id}
			onAction={onProposal}
			onOpenTransaction={onOpenTransaction}
		/>
	);
}

function Bubble({
	message,
	busyProposalId,
	onProposal,
	onOpenTransaction,
	onOpenServer,
}: {
	message: ChatBubble;
	busyProposalId: string | null;
	onProposal: (action: ProposalAction, proposal: ProposalDto, selection?: SetupSelection) => void;
	onOpenTransaction?: ((id: string) => void) | undefined;
	onOpenServer?: (() => void) | undefined;
}) {
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
	if (message.kind === "notice") {
		return (
			<View style={{ gap: spacing.md, alignSelf: "stretch" }} accessibilityRole="alert">
				<Text variant="body" tone="secondary">
					{message.text}
				</Text>
				{message.action === "open-server" && onOpenServer ? (
					<Button label={NO_KEY_ACTION_LABEL} variant="secondary" compact onPress={onOpenServer} />
				) : null}
			</View>
		);
	}
	const waiting = message.streaming && message.text === "" && message.cards.length === 0;
	return (
		<View style={{ gap: spacing.md, alignSelf: "stretch" }}>
			{message.text !== "" ? <Text variant="body">{message.text}</Text> : null}
			{message.cards.map((card) => (
				<CardView
					key={card.type === "proposal" ? card.proposal.id : `${card.tool}:${card.title}`}
					card={card}
					busyProposalId={busyProposalId}
					onProposal={onProposal}
					onOpenTransaction={onOpenTransaction}
				/>
			))}
			{message.streaming && (waiting || message.tool) ? (
				<Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
					{message.tool ?? "Pensando…"}
				</Text>
			) : null}
		</View>
	);
}

/** Tela do chat. Os textos e os números das respostas já vêm prontos do servidor. */
export function ChatView({
	messages,
	busy = false,
	busyProposalId = null,
	onClose,
	onHistory,
	onSend,
	onAttach,
	onProposal,
	onOpenTransaction,
	onOpenServer,
	displayName = null,
	modelName = null,
}: {
	messages: readonly ChatBubble[];
	/** Uma resposta está chegando: o envio espera. */
	busy?: boolean;
	/** Proposta com o toque em andamento (o botão mostra o carregando). */
	busyProposalId?: string | null;
	onClose: () => void;
	/** Abre a lista de conversas anteriores. */
	onHistory: () => void;
	onSend: (text: string) => void;
	/** Comprovante ou foto, depois que a folha fecha. */
	onAttach?: (kind: "receipt" | "photo") => void;
	onProposal: (action: ProposalAction, proposal: ProposalDto, selection?: SetupSelection) => void;
	onOpenTransaction?: (id: string) => void;
	onOpenServer?: () => void;
	/** Como a Órbita chama o dono ("Olá, Alisson"); sem nome, só "Olá". */
	displayName?: string | null;
	/** Nome do modelo que respondeu o último turno (ex.: "Sonnet 5.5"). */
	modelName?: string | null;
}) {
	const [draft, setDraft] = useState("");
	const [attachOpen, setAttachOpen] = useState(false);
	const empty = messages.length === 0;
	const send = () => {
		const text = draft.trim();
		if (!text || busy) return;
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
						<View>
							<Text variant="bodyStrong">Órbita</Text>
							{modelName ? (
								<Text variant="caption" tone="secondary" accessibilityLabel={`Respondendo com ${modelName}`}>
									{modelName}
								</Text>
							) : null}
						</View>
					</View>
					<IconButton icon="relogio" label="Conversas" onPress={onHistory} />
				</View>
				{empty ? (
					<View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 6 }}>
						<OrbitaAvatar size={88} />
						<View style={{ height: spacing.md }} />
						<Text variant="numberMedium">{hello(displayName)}</Text>
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
							<Bubble
								key={message.id}
								message={message}
								busyProposalId={busyProposalId}
								onProposal={onProposal}
								onOpenTransaction={onOpenTransaction}
								onOpenServer={onOpenServer}
							/>
						))}
					</ScrollView>
				)}
				{empty ? <Suggestions onSend={onSend} onAttach={() => setAttachOpen(true)} /> : null}
				<Composer
					draft={draft}
					busy={busy}
					onChange={setDraft}
					onSend={send}
					onAttach={() => setAttachOpen(true)}
				/>
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

/** Menu do "+": Comprovante ou Foto, na gaveta única do app (sobre o campo de mensagem e as sugestões). */
function AttachSheet({
	visible,
	onClose,
	onChoose,
}: {
	visible: boolean;
	onClose: () => void;
	onChoose: (kind: "receipt" | "photo") => void;
}) {
	return (
		<Sheet visible={visible} onClose={onClose}>
			<SheetGroup gap={false}>
				<SheetRow icon="escanear" label="Comprovante" onPress={() => onChoose("receipt")} />
				<SheetRow icon="foto" label="Foto" onPress={() => onChoose("photo")} />
			</SheetGroup>
		</Sheet>
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
	busy,
	onChange,
	onSend,
	onAttach,
}: {
	draft: string;
	busy: boolean;
	onChange: (text: string) => void;
	onSend: () => void;
	onAttach: () => void;
}) {
	const ready = draft.trim().length > 0 && !busy;
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

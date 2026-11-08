import type { ProposalDto, SetupProposal, SetupSelection } from "@orbita/shared";
import { colors, radius, spacing } from "@orbita/tokens";
import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";
import { Button, Icon, Text } from "../../ui/index.ts";
import { useCategories } from "../summary/queries.ts";
import { PROPOSAL_STATUS_LABEL } from "./chat-model.ts";
import { type EditTarget, SetupEditSheet } from "./SetupEditSheet.tsx";
import {
	buildSelection,
	confirmLabel,
	type ItemRef,
	incomeLine,
	initialDraft,
	occurrencesLine,
	ruleLine,
	SETUP_NO_CATEGORY,
	SETUP_PLAN_NOTE,
	SETUP_PLAN_TITLE,
	SETUP_RETRO_LABEL,
	SETUP_SECTION_BUDGET,
	SETUP_SECTION_INCOME,
	SETUP_SECTION_RULES,
	SETUP_SECTION_SUBSCRIPTIONS,
	type SetupDraft,
	selectedCount,
	setCategory,
	setName,
	subscriptionLine,
	toggleItem,
	toggleRetro,
} from "./setup-card-model.ts";

const BOX = 24;

function Box({ checked, disabled }: { checked: boolean; disabled: boolean }) {
	return (
		<View
			style={{
				width: BOX,
				height: BOX,
				borderRadius: radius.sm,
				backgroundColor: checked ? colors.accent : "transparent",
				borderWidth: checked ? 0 : 2,
				borderColor: colors.textTertiary,
				opacity: disabled ? 0.5 : 1,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{checked ? <Icon name="check" size={14} color={colors.onAccent} /> : null}
		</View>
	);
}

/** Uma linha do card: caixa de marcar, o que o item é (toque abre a edição) e o valor só para leitura. */
function ItemRow({
	checked,
	locked,
	readOnly,
	title,
	detail,
	caption,
	value,
	onToggle,
	onEdit,
}: {
	checked: boolean;
	/** Não dá para marcar enquanto falta escolher a categoria. */
	locked: boolean;
	readOnly: boolean;
	title: string;
	detail: string;
	caption: string | null;
	value: string | null;
	onToggle: () => void;
	onEdit: () => void;
}) {
	const body = (
		<View style={{ flex: 1, gap: 2 }}>
			<Text variant="body" numberOfLines={1}>
				{title}
			</Text>
			<Text variant="caption" tone={locked ? "primary" : "secondary"} numberOfLines={2}>
				{detail}
			</Text>
			{caption ? (
				<Text variant="caption" tone="tertiary" numberOfLines={1}>
					{caption}
				</Text>
			) : null}
		</View>
	);
	if (readOnly) {
		return (
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 }}>
				{body}
				{value ? <Text variant="bodyStrong">{value}</Text> : null}
			</View>
		);
	}
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
			<Pressable
				accessibilityRole="checkbox"
				accessibilityLabel={`Marcar ${title}`}
				accessibilityState={{ checked, disabled: locked }}
				onPress={locked ? onEdit : onToggle}
				hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
				style={{ minHeight: 48, minWidth: 32, justifyContent: "center" }}
			>
				<Box checked={checked} disabled={locked} />
			</Pressable>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`Editar ${title}`}
				onPress={onEdit}
				style={({ pressed }) => ({
					flex: 1,
					minHeight: 48,
					flexDirection: "row",
					alignItems: "center",
					gap: spacing.md,
					opacity: pressed ? 0.8 : 1,
				})}
			>
				{body}
				{value ? <Text variant="bodyStrong">{value}</Text> : null}
				<Icon name="seta-direita" size={16} color={colors.textTertiary} />
			</Pressable>
		</View>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<View style={{ gap: spacing.xs }}>
			<Text variant="caption" tone="secondary" accessibilityRole="header">
				{title}
			</Text>
			{children}
		</View>
	);
}

/** O alvo da gaveta com o nome e a categoria de AGORA (a gaveta fica aberta enquanto o dono digita). */
function currentTarget(target: EditTarget, draft: SetupDraft): EditTarget {
	const ref = target.ref;
	if (ref.section === "sub") {
		const d = draft.subs[ref.key];
		return d ? { ...target, name: d.name, categoryId: d.categoryId } : target;
	}
	if (ref.section === "rule") {
		const d = draft.rules[ref.key];
		return d ? { ...target, categoryId: d.categoryId } : target;
	}
	return draft.income ? { ...target, name: draft.income.name } : target;
}

/**
 * "Configurar com a Órbita" como lista de conferência. Cada item tem caixa de marcar, nome e categoria editáveis e o
 * valor só para leitura (vem do engine). "Confirmar selecionados" manda ao servidor só o que foi marcado e editado;
 * tudo é aplicado de uma vez e o "Desfazer" reverte o lote inteiro. Depois de confirmada, o card mostra o que entrou.
 */
export function SetupCard({
	proposal,
	setup,
	busy,
	onConfirm,
	onCancel,
	onUndo,
}: {
	proposal: ProposalDto;
	setup: SetupProposal;
	busy: boolean;
	onConfirm: (selection: SetupSelection) => void;
	onCancel: () => void;
	onUndo: () => void;
}) {
	const pending = proposal.status === "pending";
	const [draft, setDraft] = useState<SetupDraft>(() => initialDraft(setup));
	const [editing, setEditing] = useState<EditTarget | null>(null);
	const [error, setError] = useState<string | null>(null);
	const categories = (useCategories().data?.categories ?? []).filter((c) => c.archivedAt === null);
	const nameOfCategory = (id: string | null) =>
		id === null ? SETUP_NO_CATEGORY : (categories.find((c) => c.id === id)?.name ?? "Categoria");
	const count = selectedCount(draft);
	const closed = proposal.status === "canceled" || proposal.status === "undone";

	const update = (next: SetupDraft) => {
		setDraft(next);
		setError(null);
	};
	const confirm = () => {
		const built = buildSelection(setup, draft);
		if (!built.ok) return setError(built.message);
		onConfirm(built.selection);
	};

	const edit = (ref: ItemRef) => {
		if (ref.section === "sub") {
			const item = setup.subscriptions.find((s) => s.key === ref.key);
			const d = draft.subs[ref.key];
			if (item && d) {
				setEditing({
					ref,
					title: "Assinatura",
					caption: item.merchant,
					name: d.name,
					categoryId: d.categoryId,
				});
			}
		} else if (ref.section === "rule") {
			const item = setup.categoryRules.find((r) => r.key === ref.key);
			const d = draft.rules[ref.key];
			if (item && d) {
				setEditing({
					ref,
					title: "Regra de categoria",
					caption: item.merchant,
					name: null,
					categoryId: d.categoryId,
				});
			}
		} else if (ref.section === "income" && setup.income && draft.income) {
			setEditing({
				ref,
				title: "Renda",
				caption: setup.income.payer,
				name: draft.income.name,
				categoryId: null,
			});
		}
	};

	return (
		<View
			style={{
				alignSelf: "stretch",
				backgroundColor: colors.surface,
				borderRadius: radius.group,
				padding: spacing.lg,
				gap: spacing.lg,
				opacity: closed ? 0.7 : 1,
			}}
		>
			<Text variant="caption" tone="secondary">
				{proposal.title} · {PROPOSAL_STATUS_LABEL[proposal.status]}
			</Text>

			{setup.subscriptions.length > 0 ? (
				<Section title={SETUP_SECTION_SUBSCRIPTIONS}>
					{setup.subscriptions.map((s) => {
						const d = draft.subs[s.key];
						if (!d) return null;
						const ref: ItemRef = { section: "sub", key: s.key };
						return (
							<ItemRow
								key={s.key}
								checked={d.checked}
								locked={d.categoryId === null}
								readOnly={!pending}
								title={pending ? d.name : s.name}
								detail={`${nameOfCategory(pending ? d.categoryId : s.categoryId)} · ${subscriptionLine(s)}`}
								caption={occurrencesLine(s)}
								value={s.amountText}
								onToggle={() => update(toggleItem(draft, ref))}
								onEdit={() => edit(ref)}
							/>
						);
					})}
				</Section>
			) : null}

			{setup.categoryRules.length > 0 ? (
				<Section title={SETUP_SECTION_RULES}>
					{setup.categoryRules.map((r) => {
						const d = draft.rules[r.key];
						if (!d) return null;
						const ref: ItemRef = { section: "rule", key: r.key };
						return (
							<View key={r.key}>
								<ItemRow
									checked={d.checked}
									locked={d.categoryId === null}
									readOnly={!pending}
									title={r.merchant}
									detail={`→ ${nameOfCategory(pending ? d.categoryId : r.categoryId)}`}
									caption={ruleLine(r)}
									value={null}
									onToggle={() => update(toggleItem(draft, ref))}
									onEdit={() => edit(ref)}
								/>
								{pending && d.checked ? (
									<Pressable
										accessibilityRole="checkbox"
										accessibilityLabel={SETUP_RETRO_LABEL}
										accessibilityState={{ checked: d.applyToExisting }}
										onPress={() => update(toggleRetro(draft, r.key))}
										style={{
											flexDirection: "row",
											alignItems: "center",
											gap: spacing.sm,
											paddingLeft: BOX + spacing.md,
											minHeight: 44,
										}}
									>
										<Box checked={d.applyToExisting} disabled={false} />
										<Text variant="caption" tone="secondary">
											{SETUP_RETRO_LABEL}
										</Text>
									</Pressable>
								) : null}
							</View>
						);
					})}
				</Section>
			) : null}

			{setup.income && draft.income ? (
				<Section title={SETUP_SECTION_INCOME}>
					<ItemRow
						checked={draft.income.checked}
						locked={false}
						readOnly={!pending}
						title={pending ? draft.income.name : setup.income.name}
						detail={incomeLine(setup.income)}
						caption={setup.income.payer}
						value={setup.income.amountText}
						onToggle={() => update(toggleItem(draft, { section: "income" }))}
						onEdit={() => edit({ section: "income" })}
					/>
				</Section>
			) : null}

			{setup.plan && draft.plan ? (
				<Section title={SETUP_SECTION_BUDGET}>
					<ItemRow
						checked={draft.plan.checked}
						locked={false}
						readOnly={!pending}
						title={SETUP_PLAN_TITLE}
						detail={SETUP_PLAN_NOTE}
						caption={null}
						value={null}
						onToggle={() => update(toggleItem(draft, { section: "plan" }))}
						onEdit={() => update(toggleItem(draft, { section: "plan" }))}
					/>
				</Section>
			) : null}

			{error ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert">
					{error}
				</Text>
			) : null}

			{pending ? (
				<View style={{ flexDirection: "row", gap: spacing.sm }}>
					<Button
						label={confirmLabel(count)}
						compact
						loading={busy}
						disabled={count === 0}
						onPress={confirm}
						style={{ flex: 1 }}
					/>
					<Button label="Cancelar" variant="secondary" compact disabled={busy} onPress={onCancel} />
				</View>
			) : null}
			{proposal.status === "confirmed" ? (
				<Button
					label="Desfazer"
					variant="secondary"
					compact
					icon="desfazer"
					loading={busy}
					onPress={onUndo}
				/>
			) : null}

			<SetupEditSheet
				target={editing ? currentTarget(editing, draft) : null}
				categories={categories}
				onName={(name) => editing && update(setName(draft, editing.ref, name))}
				onCategory={(id) => editing && update(setCategory(draft, editing.ref, id))}
				onClose={() => setEditing(null)}
			/>
		</View>
	);
}

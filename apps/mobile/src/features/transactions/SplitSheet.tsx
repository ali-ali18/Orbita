import type { Cents } from "@orbita/core";
import type { TransactionSplitBody } from "@orbita/shared";
import { colors, spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { money } from "../../lib/format.ts";
import { createSubmissionKey } from "../../lib/idempotency.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { Button, IconButton, Sheet, Text, TextField } from "../../ui/index.ts";
import { CategoryChips, type CategoryOption } from "./CategoryChips.tsx";
import {
	addPart,
	buildSplitRequest,
	canAddPart,
	canRemovePart,
	differenceLabel,
	evaluateSplit,
	initialSplitDraft,
	removePart,
	type SplitDraft,
	updatePart,
} from "./split-model.ts";

/**
 * Gaveta "Dividir": o lançamento vira N partes, cada uma com valor e categoria, e a soma tem de fechar exatamente
 * (o que falta ou passou vem do engine). Começa em duas partes iguais; adicionar ou tirar refaz em partes iguais.
 */
export function SplitSheet({
	visible,
	totalCents,
	categoryId,
	categories,
	busy,
	message,
	onSubmit,
	onClose,
}: {
	visible: boolean;
	totalCents: Cents;
	/** Categoria atual do lançamento: já vem na primeira parte. */
	categoryId: string | null;
	categories: readonly CategoryOption[];
	busy: boolean;
	message: string | null;
	onSubmit: (body: TransactionSplitBody, idempotencyKey: string) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Dividir" onClose={onClose}>
			{visible ? (
				<SplitBody
					totalCents={totalCents}
					categoryId={categoryId}
					categories={categories}
					busy={busy}
					message={message}
					onSubmit={onSubmit}
				/>
			) : null}
		</Sheet>
	);
}

function SplitBody({
	totalCents,
	categoryId,
	categories,
	busy,
	message,
	onSubmit,
}: {
	totalCents: Cents;
	categoryId: string | null;
	categories: readonly CategoryOption[];
	busy: boolean;
	message: string | null;
	onSubmit: (body: TransactionSplitBody, idempotencyKey: string) => void;
}) {
	const { hidden } = usePrivacy();
	const [draft, setDraft] = useState<SplitDraft>(() => initialSplitDraft(totalCents, categoryId));
	const [localMessage, setLocalMessage] = useState<string | null>(null);
	// Uma chave por pedido: igual enquanto o rascunho é o mesmo (nova tentativa depois de rede caída), nova se mudar.
	const [submission] = useState(() => createSubmissionKey());
	const evaluation = evaluateSplit(totalCents, draft);

	const change = (next: SplitDraft) => {
		setLocalMessage(null);
		submission.renew();
		setDraft(next);
	};

	const submit = () => {
		const built = buildSplitRequest(totalCents, draft);
		if (!built.ok) {
			setLocalMessage(built.message);
			return;
		}
		onSubmit(built.body, submission.current());
	};

	const shownMessage = localMessage ?? message;
	return (
		<View style={{ paddingTop: spacing.md, gap: spacing.md, opacity: busy ? 0.6 : 1 }}>
			<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
				<Text variant="body" tone="secondary">
					Total
				</Text>
				<Text variant="bodyStrong">{money(totalCents, hidden)}</Text>
			</View>

			{draft.parts.map((part, i) => (
				<View
					// biome-ignore lint/suspicious/noArrayIndexKey: partes sem id; a posição é a identidade e o rascunho é refeito por inteiro
					key={i}
					style={{
						gap: spacing.sm,
						paddingTop: spacing.md,
						borderTopWidth: 1,
						borderTopColor: colors.border,
					}}
				>
					<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
						<Text variant="bodyStrong" style={{ flex: 1 }}>
							{`Parte ${i + 1}`}
						</Text>
						<TextField
							value={part.amountText}
							onChangeText={(amountText) => change(updatePart(draft, i, { amountText }))}
							keyboardType="decimal-pad"
							inputMode="decimal"
							selectTextOnFocus
							accessibilityLabel={`Valor da parte ${i + 1}`}
							placeholder="0,00"
							style={{ width: 128, minHeight: 44, textAlign: "right" }}
						/>
						{canRemovePart(draft) ? (
							<IconButton
								icon="fechar"
								label={`Remover parte ${i + 1}`}
								size={36}
								iconSize={16}
								onPress={() => change(removePart(totalCents, draft, i))}
							/>
						) : null}
					</View>
					<CategoryChips
						categories={categories}
						selectedId={part.categoryId}
						onSelect={(id) => change(updatePart(draft, i, { categoryId: id }))}
						allowNew={false}
					/>
				</View>
			))}

			<View
				accessibilityLiveRegion="polite"
				style={{
					flexDirection: "row",
					justifyContent: "space-between",
					paddingTop: spacing.md,
					borderTopWidth: 1,
					borderTopColor: colors.border,
				}}
			>
				<Text variant="body" tone="secondary">
					Soma das partes
				</Text>
				<Text variant="bodyStrong" tone={evaluation.ok ? "primary" : "secondary"}>
					{differenceLabel(evaluation)}
				</Text>
			</View>

			{shownMessage ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite">
					<Text variant="caption" tone="secondary">
						{shownMessage}
					</Text>
				</View>
			) : null}

			{canAddPart(totalCents, draft) ? (
				<Button
					variant="secondary"
					label="Adicionar parte"
					onPress={() => change(addPart(totalCents, draft))}
					disabled={busy}
				/>
			) : null}
			<Button label="Dividir" onPress={submit} loading={busy} disabled={!evaluation.ok} />
		</View>
	);
}

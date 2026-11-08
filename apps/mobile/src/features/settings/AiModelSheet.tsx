import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { errorMessage } from "../../lib/loadable.ts";
import { Button, Sheet, SheetGroup, SheetRow, Text } from "../../ui/index.ts";
import type { ModelChoice } from "./ai-model.ts";

/** Gaveta de escolha de modelo: uma linha por opção (nome, descrição e preço), a atual marcada. */
export function AiModelSheet({
	visible,
	title,
	hint,
	choices,
	currentId,
	isCustom,
	onPick,
	onClose,
}: {
	visible: boolean;
	title: string;
	hint: string;
	choices: readonly ModelChoice[];
	currentId: string | null;
	/** Foi o dono que escolheu (e não o padrão do servidor): habilita "Voltar ao padrão". */
	isCustom: boolean;
	/** `null` = voltar ao padrão do servidor. */
	onPick: (id: string | null) => Promise<unknown>;
	onClose: () => void;
}) {
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const pick = async (id: string | null) => {
		if (busy) return;
		setBusy(true);
		setMessage(null);
		try {
			await onPick(id);
			onClose();
		} catch (error) {
			setMessage(errorMessage(error));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Sheet visible={visible} title={title} onClose={onClose}>
			<View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
				<Text variant="caption" tone="secondary">
					{hint}
				</Text>
				<SheetGroup gap={false}>
					{choices.map((c) => (
						<SheetRow
							key={c.id}
							label={c.label}
							variant="detailed"
							caption={c.description}
							note={c.price}
							selected={c.id === currentId}
							role="radio"
							onPress={() => void pick(c.id)}
						/>
					))}
				</SheetGroup>
				{message ? (
					<View accessibilityRole="alert" accessibilityLiveRegion="polite">
						<Text variant="caption" tone="secondary">
							{message}
						</Text>
					</View>
				) : null}
				<Button
					label="Voltar ao padrão do servidor"
					variant="secondary"
					disabled={busy || !isCustom}
					onPress={() => void pick(null)}
				/>
			</View>
		</Sheet>
	);
}

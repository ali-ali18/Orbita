import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import { Button, Sheet, SheetGroup, SheetRow, Text, TextField } from "../../ui/index.ts";
import type { ItemRef } from "./setup-card-model.ts";

export interface EditTarget {
	ref: ItemRef;
	title: string;
	/** Texto de fora (o jeito que o banco escreveu), mostrado como legenda. */
	caption: string;
	name: string | null;
	categoryId: string | null;
}

/**
 * Gaveta de edição de um item do card: o nome (quando o item tem nome) e a categoria. Só estes dois campos mudam;
 * valor e dia ficam como a Órbita achou. Usa os primitivos de gaveta do app.
 */
export function SetupEditSheet({
	target,
	categories,
	onName,
	onCategory,
	onClose,
}: {
	target: EditTarget | null;
	categories: ReadonlyArray<{ id: string; name: string }>;
	onName: (name: string) => void;
	onCategory: (categoryId: string) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={target !== null} title={target?.title ?? ""} onClose={onClose}>
			{target ? (
				<View style={{ gap: spacing.md }}>
					<Text variant="caption" tone="secondary" numberOfLines={2}>
						{target.caption}
					</Text>
					{target.name !== null ? (
						<TextField
							value={target.name}
							onChangeText={onName}
							placeholder="Nome"
							accessibilityLabel="Nome"
							maxLength={60}
						/>
					) : null}
					{target.categoryId !== undefined && target.ref.section !== "income" ? (
						<>
							<Text variant="caption" tone="secondary">
								Categoria
							</Text>
							<SheetGroup gap={false}>
								{categories.map((c) => (
									<SheetRow
										key={c.id}
										label={c.name}
										selected={c.id === target.categoryId}
										onPress={() => onCategory(c.id)}
									/>
								))}
							</SheetGroup>
						</>
					) : null}
					<Button label="Pronto" onPress={onClose} />
				</View>
			) : null}
		</Sheet>
	);
}

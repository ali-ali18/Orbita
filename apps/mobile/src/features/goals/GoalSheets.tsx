import type { MonthKey } from "@orbita/core";
import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import { Sheet, SheetGroup, SheetRow, Text } from "../../ui/index.ts";
import { deadlineOptions, monthTitle } from "./goals-model.ts";

/** Gaveta "Até quando": "Sem prazo" e os próximos 4 anos, mês a mês (o prazo vale até o último dia do mês). */
export function DeadlineSheet({
	visible,
	currentMonth,
	selected,
	onSelect,
	onClose,
}: {
	visible: boolean;
	currentMonth: MonthKey;
	selected: MonthKey | null;
	onSelect: (month: MonthKey | null) => void;
	onClose: () => void;
}) {
	// Na edição o prazo pode já ter passado: ele continua na lista para não "sumir" da escolha.
	const options = deadlineOptions(currentMonth);
	const list = selected !== null && !options.includes(selected) ? [selected, ...options] : options;
	return (
		<Sheet visible={visible} title="Até quando" onClose={onClose}>
			<SheetGroup>
				<SheetRow label="Sem prazo" selected={selected === null} onPress={() => onSelect(null)} />
				{list.map((m) => (
					<SheetRow key={m} label={monthTitle(m)} selected={m === selected} onPress={() => onSelect(m)} />
				))}
			</SheetGroup>
		</Sheet>
	);
}

interface AccountOption {
	id: string;
	name: string;
}

/** Gaveta "Onde está guardado": só informação (a conta não recebe nem perde dinheiro por causa da meta). */
export function AccountSheet({
	visible,
	accounts,
	selectedId,
	onSelect,
	onClose,
}: {
	visible: boolean;
	accounts: readonly AccountOption[];
	selectedId: string | null;
	onSelect: (id: string | null) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Onde está guardado" onClose={onClose}>
			<View style={{ paddingBottom: spacing.md }}>
				<SheetGroup>
					<SheetRow label="Nenhuma" selected={selectedId === null} onPress={() => onSelect(null)} />
					{accounts.map((a) => (
						<SheetRow
							key={a.id}
							label={a.name}
							selected={a.id === selectedId}
							onPress={() => onSelect(a.id)}
						/>
					))}
				</SheetGroup>
				<Text variant="caption" tone="secondary" style={{ paddingHorizontal: spacing.xs }}>
					Serve só para lembrar onde o dinheiro está. A conta não é mexida.
				</Text>
			</View>
		</Sheet>
	);
}

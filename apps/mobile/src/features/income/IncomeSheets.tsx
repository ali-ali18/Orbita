import { addMonths, type MonthKey } from "@orbita/core";
import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import { Sheet, SheetGroup, SheetRow, Text } from "../../ui/index.ts";
import { monthTitle } from "../goals/goals-model.ts";

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/** Gaveta "Dia do pagamento": de 1 a 31; em mês curto o dia 31 vale o último dia do mês. */
export function PaydaySheet({
	visible,
	selected,
	onSelect,
	onClose,
}: {
	visible: boolean;
	selected: number;
	onSelect: (day: number) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Dia do pagamento" onClose={onClose}>
			<View style={{ paddingBottom: spacing.md }}>
				<SheetGroup>
					{DAYS.map((day) => (
						<SheetRow
							key={day}
							label={`Dia ${day}`}
							selected={day === selected}
							onPress={() => onSelect(day)}
						/>
					))}
				</SheetGroup>
				<Text variant="caption" tone="secondary" style={{ paddingHorizontal: spacing.xs }}>
					Em meses mais curtos, vale o último dia do mês.
				</Text>
			</View>
		</Sheet>
	);
}

/** Gaveta "Em que mês": a renda avulsa conta só neste mês (do atual até 12 meses à frente). */
export function IncomeMonthSheet({
	visible,
	currentMonth,
	selected,
	onSelect,
	onClose,
}: {
	visible: boolean;
	currentMonth: MonthKey;
	selected: MonthKey;
	onSelect: (month: MonthKey) => void;
	onClose: () => void;
}) {
	const options = Array.from({ length: 13 }, (_, i) => addMonths(currentMonth, i));
	const list = options.includes(selected) ? options : [selected, ...options];
	return (
		<Sheet visible={visible} title="Em que mês" onClose={onClose}>
			<SheetGroup>
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

/** Gaveta "Cai em qual conta": só informação, nenhuma conta é mexida. */
export function IncomeAccountSheet({
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
		<Sheet visible={visible} title="Cai em qual conta" onClose={onClose}>
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
					Serve só para lembrar onde o dinheiro cai. A conta não é mexida.
				</Text>
			</View>
		</Sheet>
	);
}

import type { AgentSchedule } from "@orbita/shared";
import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { Button, Chip, Sheet, SheetGroup, SheetRow, Text } from "../../ui/index.ts";
import {
	DUPLICATE_DAY_OPTIONS,
	daysLabel,
	FREQUENCY_OPTIONS,
	HOUR_OPTIONS,
	MONTH_DAY_OPTIONS,
	scheduleLabel,
	WEEKDAY_OPTIONS,
	withFrequency,
} from "./agents-model.ts";

const wrap = { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm } as const;

/** Gaveta "Quando eu olho": frequência, dia (da semana ou do mês) e hora. Só horas cheias, no fuso de São Paulo. */
export function ScheduleSheet({
	visible,
	schedule,
	saving,
	error,
	onSave,
	onClose,
}: {
	visible: boolean;
	schedule: AgentSchedule;
	saving: boolean;
	error: string | null;
	onSave: (schedule: AgentSchedule) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Quando eu olho" onClose={onClose}>
			{visible ? <ScheduleBody initial={schedule} saving={saving} error={error} onSave={onSave} /> : null}
		</Sheet>
	);
}

function ScheduleBody({
	initial,
	saving,
	error,
	onSave,
}: {
	initial: AgentSchedule;
	saving: boolean;
	error: string | null;
	onSave: (schedule: AgentSchedule) => void;
}) {
	const [draft, setDraft] = useState(initial);
	return (
		<View style={{ gap: spacing.lg, paddingVertical: spacing.md }}>
			<ScheduleFields schedule={draft} onChange={setDraft} />
			<Text variant="caption" tone="secondary">
				Eu olho {scheduleLabel(draft)}, no horário de São Paulo.
			</Text>
			{error ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite">
					<Text variant="caption" tone="secondary">
						{error}
					</Text>
				</View>
			) : null}
			<Button label="Salvar" loading={saving} onPress={() => onSave(draft)} />
		</View>
	);
}

/** Os campos da agenda, sem gaveta (a gaveta "Ajustar" do Novo agente usa os mesmos). */
export function ScheduleFields({
	schedule,
	onChange,
}: {
	schedule: AgentSchedule;
	onChange: (schedule: AgentSchedule) => void;
}) {
	return (
		<View style={{ gap: spacing.lg }}>
			<View style={{ gap: spacing.xs }}>
				<Text variant="caption" tone="secondary">
					Frequência
				</Text>
				<View style={wrap}>
					{FREQUENCY_OPTIONS.map((o) => (
						<Chip
							key={o.value}
							label={o.label}
							active={schedule.frequency === o.value}
							onPress={() => onChange(withFrequency(schedule, o.value))}
						/>
					))}
				</View>
			</View>
			{schedule.frequency === "weekly" ? (
				<View style={{ gap: spacing.xs }}>
					<Text variant="caption" tone="secondary">
						Dia da semana
					</Text>
					<View style={wrap}>
						{WEEKDAY_OPTIONS.map((o) => (
							<Chip
								key={o.day}
								label={o.name}
								active={schedule.day === o.day}
								onPress={() => onChange({ ...schedule, day: o.day })}
							/>
						))}
					</View>
				</View>
			) : null}
			{schedule.frequency === "monthly" ? (
				<View style={{ gap: spacing.xs }}>
					<Text variant="caption" tone="secondary">
						Dia do mês
					</Text>
					<View style={wrap}>
						{MONTH_DAY_OPTIONS.map((day) => (
							<Chip
								key={day}
								label={String(day)}
								active={schedule.day === day}
								onPress={() => onChange({ ...schedule, day })}
							/>
						))}
					</View>
				</View>
			) : null}
			<View style={{ gap: spacing.xs }}>
				<Text variant="caption" tone="secondary">
					Hora
				</Text>
				<View style={wrap}>
					{HOUR_OPTIONS.map((o) => (
						<Chip
							key={o.hour}
							label={o.label}
							active={schedule.hour === o.hour}
							onPress={() => onChange({ ...schedule, hour: o.hour })}
						/>
					))}
				</View>
			</View>
		</View>
	);
}

/** Gaveta do prazo da cobrança repetida (Vigia). */
export function DaysSheet({
	visible,
	days,
	onSelect,
	onClose,
}: {
	visible: boolean;
	days: number;
	onSelect: (days: number) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Prazo da cobrança repetida" onClose={onClose}>
			<SheetGroup>
				{DUPLICATE_DAY_OPTIONS.map((d) => (
					<SheetRow key={d} label={daysLabel(d)} selected={d === days} onPress={() => onSelect(d)} />
				))}
			</SheetGroup>
			<Text variant="caption" tone="secondary" style={{ paddingHorizontal: spacing.xs }}>
				Duas cobranças iguais dentro deste prazo viram um aviso.
			</Text>
		</Sheet>
	);
}

export interface ModelChoice {
	id: string;
	label: string;
	description: string;
}

/** Gaveta do modelo só deste agente: "Padrão do servidor" ou um da lista permitida. */
export function ModelSheet({
	visible,
	choices,
	selected,
	onSelect,
	onClose,
}: {
	visible: boolean;
	choices: readonly ModelChoice[];
	selected: string | null;
	onSelect: (id: string | null) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Modelo deste agente" onClose={onClose}>
			<SheetGroup>
				<SheetRow
					label="Padrão do servidor"
					caption="O mesmo do chat"
					selected={selected === null}
					onPress={() => onSelect(null)}
				/>
				{choices.map((c) => (
					<SheetRow
						key={c.id}
						label={c.label}
						caption={c.description}
						selected={c.id === selected}
						onPress={() => onSelect(c.id)}
					/>
				))}
			</SheetGroup>
			<Text variant="caption" tone="secondary" style={{ paddingHorizontal: spacing.xs }}>
				Só vale para a conversa e para o texto dos avisos deste agente. O gasto entra no mesmo limite mensal.
			</Text>
		</Sheet>
	);
}

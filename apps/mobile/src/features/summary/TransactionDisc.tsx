import { colors, radius } from "@orbita/tokens";
import { View } from "react-native";
import { type BankBadge, BankLogo, Icon, type IconName } from "../../ui/index.ts";

const DISC = 44;
const BADGE = 18;
/** O selo do banco fica em (28, 28) no Figma: canto de baixo à direita do disco, vazando 2. */
const BADGE_OFFSET = 28;

/** Disco de 44 com o ícone da categoria e, se houver conta ou cartão, o selo do banco por cima. */
export function TransactionDisc({ icon, bank }: { icon: IconName; bank?: BankBadge | undefined }) {
	return (
		<View style={{ width: DISC, height: DISC }}>
			<View
				style={{
					width: DISC,
					height: DISC,
					borderRadius: radius.pill,
					backgroundColor: colors.surface2,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Icon name={icon} size={20} />
			</View>
			{bank ? (
				<View style={{ position: "absolute", left: BADGE_OFFSET, top: BADGE_OFFSET }}>
					<BankLogo {...bank} size={BADGE} ring={colors.background} />
				</View>
			) : null}
		</View>
	);
}

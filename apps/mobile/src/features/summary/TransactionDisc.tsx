import { colors } from "@orbita/tokens";
import { View } from "react-native";
import type { Brand } from "../../lib/brands.ts";
import { type BankBadge, BankLogo, type IconName, StoreDisc } from "../../ui/index.ts";

const DISC = 44;
const BADGE = 18;
/** O selo do banco fica em (28, 28) no Figma: canto de baixo à direita do disco, vazando 2. */
const BADGE_OFFSET = 28;

/**
 * Disco de 44 com a marca da loja (quando o texto do lançamento a reconhece) ou o ícone da categoria e, se houver
 * conta ou cartão, o selo do banco por cima.
 */
export function TransactionDisc({
	icon,
	brand,
	bank,
}: {
	icon: IconName;
	brand?: Brand | null | undefined;
	bank?: BankBadge | undefined;
}) {
	return (
		<View style={{ width: DISC, height: DISC }}>
			<StoreDisc brand={brand} icon={icon} size={DISC} />
			{bank ? (
				<View style={{ position: "absolute", left: BADGE_OFFSET, top: BADGE_OFFSET }}>
					<BankLogo {...bank} size={BADGE} ring={colors.background} />
				</View>
			) : null}
		</View>
	);
}

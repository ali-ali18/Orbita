import { Linking } from "react-native";
import { REPO_URL } from "./report-model.ts";

/** O app só abre no navegador endereços do repositório do projeto (nada vindo de dado externo). */
export const isRepoUrl = (url: string): boolean => url === REPO_URL || url.startsWith(`${REPO_URL}/`);

/** Abre o endereço no navegador. `false` = não foi possível (sem navegador, endereço fora do repositório). */
export async function openRepoLink(url: string): Promise<boolean> {
	if (!isRepoUrl(url)) return false;
	try {
		await Linking.openURL(url);
		return true;
	} catch {
		return false;
	}
}

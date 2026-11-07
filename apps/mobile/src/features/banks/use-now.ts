import { useEffect, useState } from "react";

/** O instante atual, renovado a cada `everyMs` (para "há 2 h" não ficar parado). Fonte única de relógio da tela. */
export function useNow(everyMs = 30_000): Date {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), everyMs);
		return () => clearInterval(timer);
	}, [everyMs]);
	return now;
}

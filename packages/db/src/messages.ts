/** Mensagens que os dois stores (Prisma e memória) precisam repetir idênticas. */
export const SLUG_TAKEN_MESSAGE = "Já existe uma categoria com este identificador.";
export const SYSTEM_CATEGORY_MESSAGE = "Categoria do sistema não pode ser arquivada.";
export const POSTING_EXISTS_MESSAGE = "Esta recorrência já foi lançada neste mês.";
export const TRANSACTION_POSTED_MESSAGE = "Este lançamento já está ligado a uma recorrência.";
export const BUDGET_SCOPE_MESSAGE = "O orçamento vale para o total ou para uma categoria que existe.";
export const ACCOUNT_ARCHIVED_MESSAGE = "A conta informada está arquivada.";
export const CARD_ARCHIVED_MESSAGE = "O cartão informado está arquivado.";
export const CATEGORY_ARCHIVED_MESSAGE = "A categoria informada está arquivada.";
export const HAS_REFUNDS_MESSAGE =
	"Este gasto tem estornos: apague os estornos antes de mudar o tipo do lançamento.";
export const SPLIT_KIND_MESSAGE = "Só despesa ou receita pode ser dividida em categorias.";
export const SPLIT_INSTALLMENT_MESSAGE =
	"Parcela não pode ser dividida: apague o parcelamento e lance de novo.";
export const SPLIT_HAS_REFUNDS_MESSAGE = "Este gasto tem estornos: apague os estornos antes de dividir.";
export const POSTING_DELETED_MESSAGE = "Não dá para ligar uma recorrência a um lançamento apagado.";
export const POSTING_KIND_MESSAGE =
	"O tipo do lançamento (gasto ou receita) não combina com o da recorrência.";
export const POSTING_MONTH_MESSAGE =
	"O mês do orçamento do lançamento não é o mês que a recorrência está cumprindo.";
export const EXTERNAL_TAKEN_MESSAGE = "Já existe um cadastro desta origem com o mesmo identificador externo.";
export const PLUGGY_CONNECTION_TAKEN_MESSAGE = "Esta conexão do Meu Pluggy já está cadastrada.";

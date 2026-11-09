package expo.modules.orbitanotifications

import java.text.Normalizer

/**
 * O que pode sair do aparelho. Espelha `packages/shared/src/notification-capture.ts` (lista de pacotes, limites e as
 * regras de código de verificação): o teste `native-sync.test.ts` do app confere que os dois não se afastam.
 *
 * A notificação de um banco é dado de terceiro. Aqui ela só é filtrada e cortada; ninguém a executa nem a interpreta.
 */
internal object NotificationPolicy {
  const val TITLE_MAX = 120
  const val TEXT_MAX = 400
  const val BATCH_MAX = 10
  const val QUEUE_MAX = 200

  /** Os únicos pacotes que este módulo aceita ler, mesmo que o JavaScript peça outros. */
  val BANK_PACKAGES: Set<String> = setOf(
    "com.nu.production",
    "br.com.intermedium",
    "com.santander.app",
    "com.mercadopago.wallet",
    "com.itau",
    "com.bradesco",
    "br.com.bb.android",
    "br.com.gabba.Caixa",
    "com.c6bank.app",
    "com.picpay",
  )

  private val SENSITIVE = Regex(
    "\\b(codigo|cod|token|senha|otp|cvv|cvc|pin|verificacao|autenticacao|nao compartilh\\w*|compartilh\\w*)\\b"
  )
  private val BARE_CODE = Regex("^\\W*(?:[a-z]-)?\\d{4,8}\\W*$")
  private val MARKS = Regex("\\p{M}+")
  private val CONTROL = Regex(
    "[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\ufeff]"
  )
  private val SPACES = Regex("\\s+")

  /** Minúsculo e sem acento. */
  fun fold(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFD).replace(MARKS, "").lowercase()

  /** Código de verificação, token, senha: a notificação inteira é jogada fora, nunca é enviada nem guardada. */
  fun isSensitive(title: String, text: String): Boolean {
    val parts = listOf(title, text).filter { it.isNotEmpty() }
    if (SENSITIVE.containsMatchIn(fold(parts.joinToString(" | ")))) return true
    return parts.any { BARE_CODE.matches(fold(it)) }
  }

  /** Sem caracteres de controle, espaços simples, no máximo `max` letras. */
  fun clean(value: String, max: Int): String {
    val text = value.replace(CONTROL, " ").replace(SPACES, " ").trim()
    return if (text.length > max) text.substring(0, max - 1).trimEnd() + "…" else text
  }
}

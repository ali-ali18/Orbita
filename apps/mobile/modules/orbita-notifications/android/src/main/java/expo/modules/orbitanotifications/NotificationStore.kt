package expo.modules.orbitanotifications

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Uma notificação de banco que já passou pelo filtro e espera para ir ao servidor. */
internal data class QueuedNotification(
  val id: String,
  val pkg: String,
  val title: String,
  val text: String,
  val postedAt: Long,
)

internal data class CaptureConfig(
  val baseUrl: String,
  val token: String,
  val packages: Set<String>,
  val enabled: Boolean,
)

/**
 * Estado do módulo, no armazenamento privado do app: a configuração (endereço do servidor, token cifrado, pacotes
 * ligados) e a fila de notificações a enviar (cifrada). O serviço de notificações e o JavaScript falam com a mesma
 * instância; a fila mora aqui, não no JavaScript, porque o serviço roda com o app fechado.
 */
internal class NotificationStore private constructor(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences("orbita_notification_capture", Context.MODE_PRIVATE)
  private val lock = Any()

  fun configure(baseUrl: String, token: String, packages: Collection<String>, enabled: Boolean) {
    synchronized(lock) {
      // Mesmo que o JavaScript peça outro pacote, só os de banco da lista fixa são aceitos.
      val allowed = packages.filter { it in NotificationPolicy.BANK_PACKAGES }.toSet()
      prefs.edit()
        .putString(KEY_BASE_URL, baseUrl.trimEnd('/'))
        .putString(KEY_TOKEN, KeystoreCrypto.encrypt(token))
        .putStringSet(KEY_PACKAGES, allowed)
        .putBoolean(KEY_ENABLED, enabled)
        .putBoolean(KEY_AUTH_FAILED, false)
        .apply()
    }
  }

  /** Sair do app: apaga a configuração, o token e tudo que esperava na fila. */
  fun clear() {
    synchronized(lock) { prefs.edit().clear().apply() }
  }

  fun config(): CaptureConfig? = synchronized(lock) {
    val baseUrl = prefs.getString(KEY_BASE_URL, null) ?: return null
    val token = prefs.getString(KEY_TOKEN, null)?.let { KeystoreCrypto.decrypt(it) } ?: return null
    CaptureConfig(
      baseUrl = baseUrl,
      token = token,
      packages = prefs.getStringSet(KEY_PACKAGES, emptySet()) ?: emptySet(),
      enabled = prefs.getBoolean(KEY_ENABLED, false),
    )
  }

  /** O servidor recusou o token (401/403): para de tentar até o app configurar de novo. */
  var authFailed: Boolean
    get() = prefs.getBoolean(KEY_AUTH_FAILED, false)
    set(value) { prefs.edit().putBoolean(KEY_AUTH_FAILED, value).apply() }

  var lastSentAt: Long
    get() = prefs.getLong(KEY_LAST_SENT, 0L)
    set(value) { prefs.edit().putLong(KEY_LAST_SENT, value).apply() }

  var lastError: String?
    get() = prefs.getString(KEY_LAST_ERROR, null)
    set(value) { prefs.edit().putString(KEY_LAST_ERROR, value).apply() }

  /** Põe na fila, sem repetir a mesma notificação no mesmo minuto, e guarda no máximo `QUEUE_MAX` (descarta as velhas). */
  fun enqueue(pkg: String, title: String, text: String, postedAt: Long) {
    synchronized(lock) {
      val items = readQueue().toMutableList()
      val minute = postedAt / 60_000
      if (items.any { it.pkg == pkg && it.title == title && it.text == text && it.postedAt / 60_000 == minute }) return
      items.add(QueuedNotification(UUID.randomUUID().toString(), pkg, title, text, postedAt))
      while (items.size > NotificationPolicy.QUEUE_MAX) items.removeAt(0)
      writeQueue(items)
    }
  }

  fun peek(max: Int): List<QueuedNotification> = synchronized(lock) { readQueue().take(max) }

  fun remove(sent: Collection<QueuedNotification>) {
    synchronized(lock) {
      val ids = sent.map { it.id }.toSet()
      writeQueue(readQueue().filter { it.id !in ids })
    }
  }

  fun size(): Int = synchronized(lock) { readQueue().size }

  private fun readQueue(): List<QueuedNotification> {
    val sealed = prefs.getString(KEY_QUEUE, null) ?: return emptyList()
    val json = KeystoreCrypto.decrypt(sealed) ?: return emptyList()
    return try {
      val array = JSONArray(json)
      (0 until array.length()).map { i ->
        val o = array.getJSONObject(i)
        QueuedNotification(
          o.getString("id"),
          o.getString("pkg"),
          o.getString("title"),
          o.getString("text"),
          o.getLong("postedAt"),
        )
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  private fun writeQueue(items: List<QueuedNotification>) {
    if (items.isEmpty()) {
      prefs.edit().remove(KEY_QUEUE).apply()
      return
    }
    val array = JSONArray()
    items.forEach {
      array.put(
        JSONObject()
          .put("id", it.id)
          .put("pkg", it.pkg)
          .put("title", it.title)
          .put("text", it.text)
          .put("postedAt", it.postedAt)
      )
    }
    prefs.edit().putString(KEY_QUEUE, KeystoreCrypto.encrypt(array.toString())).apply()
  }

  companion object {
    private const val KEY_BASE_URL = "base_url"
    private const val KEY_TOKEN = "token"
    private const val KEY_PACKAGES = "packages"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_AUTH_FAILED = "auth_failed"
    private const val KEY_LAST_SENT = "last_sent_at"
    private const val KEY_LAST_ERROR = "last_error"
    private const val KEY_QUEUE = "queue"

    @Volatile private var instance: NotificationStore? = null

    fun get(context: Context): NotificationStore =
      instance ?: synchronized(this) {
        instance ?: NotificationStore(context).also { instance = it }
      }
  }
}

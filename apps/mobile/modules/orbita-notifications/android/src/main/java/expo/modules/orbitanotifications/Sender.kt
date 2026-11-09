package expo.modules.orbitanotifications

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Envia a fila ao servidor pareado (`POST /v1/notifications`, com o token do aparelho). Roda no próprio serviço, sem
 * depender do JavaScript: com o app fechado não há JavaScript. Sem rede ou com erro do servidor, a fila fica e o
 * `FlushJobService` tenta de novo quando houver rede.
 */
internal object Sender {
  private val executor = Executors.newSingleThreadExecutor()
  private val lock = Any()

  /** Tenta mandar tudo, em segundo plano; se sobrar fila por falta de rede, agenda a nova tentativa. */
  fun flushAsync(context: Context) {
    val app = context.applicationContext
    executor.execute {
      if (!flush(app)) FlushJobService.schedule(app)
    }
  }

  /**
   * Manda a fila em lotes. `true`: não há mais o que tentar agora (esvaziou, ou o token foi recusado e só um novo
   * pareamento resolve); `false`: sobrou fila por rede ou erro do servidor, vale tentar de novo.
   */
  fun flush(context: Context): Boolean = synchronized(lock) { flushLocked(context) }

  private fun flushLocked(context: Context): Boolean {
    val store = NotificationStore.get(context)
    val config = store.config() ?: return true
    if (store.authFailed) return true
    while (true) {
      val batch = store.peek(NotificationPolicy.BATCH_MAX)
      if (batch.isEmpty()) return true
      val code = post(config, batch)
      when {
        code in 200..299 -> {
          store.remove(batch)
          store.lastSentAt = System.currentTimeMillis()
          store.lastError = null
        }
        // O servidor recusou o lote inteiro por formato (não vai mudar se repetir): descarta, senão a fila trava.
        code == 400 || code == 413 || code == 422 -> {
          store.remove(batch)
          store.lastError = "Servidor recusou o lote (HTTP $code)."
        }
        code == 401 || code == 403 -> {
          store.authFailed = true
          store.lastError = "O servidor não reconhece mais este aparelho. Entre de novo no app."
          return true
        }
        else -> {
          store.lastError = if (code < 0) "Sem conexão com o servidor." else "Servidor com problema (HTTP $code)."
          return false
        }
      }
    }
  }

  /** Código HTTP, ou -1 se não deu para falar com o servidor. */
  private fun post(config: CaptureConfig, batch: List<QueuedNotification>): Int {
    var connection: HttpURLConnection? = null
    return try {
      val items = JSONArray()
      batch.forEach {
        items.put(
          JSONObject()
            .put("package", it.pkg)
            .put("title", it.title)
            .put("text", it.text)
            .put("postedAt", it.postedAt)
        )
      }
      val body = JSONObject().put("items", items).toString().toByteArray(Charsets.UTF_8)
      connection = (URL(config.baseUrl + "/v1/notifications").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15_000
        readTimeout = 15_000
        doOutput = true
        setRequestProperty("content-type", "application/json")
        setRequestProperty("authorization", "Bearer " + config.token)
        setFixedLengthStreamingMode(body.size)
      }
      connection.outputStream.use { it.write(body) }
      val code = connection.responseCode
      // Lê e descarta a resposta para a conexão poder ser reaproveitada.
      (if (code in 200..299) connection.inputStream else connection.errorStream)?.use { it.readBytes() }
      code
    } catch (e: Exception) {
      -1
    } finally {
      connection?.disconnect()
    }
  }
}

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
 *
 * Um item ruim nunca prende a fila: o servidor responde por item; lote recusado por formato (400) é reenviado item a
 * item e só o recusado sai; só o resultado "error" DO ITEM conta tentativa (depois de `MAX_ATTEMPTS`, sai). Queda do
 * servidor (5xx), falta de rede e limite de pedidos não contam: o item espera e sai por idade (`MAX_AGE_DAYS`).
 */
internal object Sender {
  private val executor = Executors.newSingleThreadExecutor()
  private val lock = Any()

  /** Resposta do servidor: código HTTP (-1 = sem conexão) e corpo. */
  private class Reply(val code: Int, val body: String)

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
    store.dropExpired(System.currentTimeMillis())
    while (true) {
      val batch = store.peek(NotificationPolicy.BATCH_MAX)
      if (batch.isEmpty()) return true
      val reply = post(config, batch)
      val code = reply.code
      when {
        code in 200..299 -> {
          val results = parseResults(reply.body, batch.size)
          if (results == null) {
            // 2xx que não dá para ler (proxy, página de erro): não prova que o servidor guardou nada. Tenta de novo.
            store.lastError = "Resposta do servidor ilegível."
            return false
          }
          val sent = batch.filterIndexed { i, _ -> results[i] != "error" }
          val failed = batch.filterIndexed { i, _ -> results[i] == "error" }
          store.remove(sent)
          if (sent.isNotEmpty()) {
            store.lastSentAt = System.currentTimeMillis()
            store.lastError = null
          }
          if (failed.isNotEmpty()) {
            // Só estas falharam no servidor: conta a tentativa e deixa o resto seguir; tenta de novo mais tarde.
            store.bumpAttempts(failed)
            store.lastError = "O servidor não conseguiu tratar ${failed.size} notificação(ões)."
            return false
          }
        }
        // Formato recusado: não vai mudar se repetir. Com mais de um item, descobre qual é o ruim mandando um a um.
        code == 400 || code == 413 || code == 422 -> {
          if (batch.size == 1) {
            store.remove(batch)
            store.lastError = "Servidor recusou uma notificação (HTTP $code)."
          } else if (!sendOneByOne(store, config, batch)) {
            return false
          }
        }
        code == 401 || code == 403 -> {
          store.authFailed = true
          store.lastError = "O servidor não reconhece mais este aparelho. Entre de novo no app."
          return true
        }
        code >= 500 -> {
          // Servidor com problema: não conta tentativa (uma queda não pode descartar a fila); o prazo é por idade.
          store.lastError = "Servidor com problema (HTTP $code)."
          return false
        }
        else -> {
          // Sem rede (-1), limite de pedidos (429) e afins: tenta de novo depois, sem gastar tentativa.
          store.lastError = if (code < 0) "Sem conexão com o servidor." else "Servidor ocupado (HTTP $code)."
          return false
        }
      }
    }
  }

  /** Reenvia um lote recusado item a item. `false` se parou por falta de rede ou erro do servidor. */
  private fun sendOneByOne(store: NotificationStore, config: CaptureConfig, batch: List<QueuedNotification>): Boolean {
    for (item in batch) {
      val code = post(config, listOf(item)).code
      when {
        code in 200..299 -> {
          store.remove(listOf(item))
          store.lastSentAt = System.currentTimeMillis()
        }
        code == 400 || code == 413 || code == 422 -> {
          store.remove(listOf(item))
          store.lastError = "Servidor recusou uma notificação (HTTP $code)."
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
    return true
  }

  /** Resultado de cada item, ou `null` se a resposta não é o que o servidor manda (então nada é dado como entregue). */
  private fun parseResults(body: String, size: Int): List<String>? = try {
    val array = JSONObject(body).getJSONArray("results")
    if (array.length() != size) null else List(size) { i -> array.getString(i) }
  } catch (e: Exception) {
    null
  }

  private fun post(config: CaptureConfig, batch: List<QueuedNotification>): Reply {
    var connection: HttpURLConnection? = null
    return try {
      val items = JSONArray()
      batch.forEach {
        val o = JSONObject()
          .put("package", it.pkg)
          .put("title", it.title)
          .put("text", it.text)
          .put("postedAt", it.postedAt)
        if (it.sbnKey.isNotEmpty()) o.put("sbnKey", it.sbnKey)
        items.put(o)
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
      val stream = if (code in 200..299) connection.inputStream else connection.errorStream
      Reply(code, stream?.use { String(it.readBytes(), Charsets.UTF_8) } ?: "")
    } catch (e: Exception) {
      Reply(-1, "")
    } finally {
      connection?.disconnect()
    }
  }
}

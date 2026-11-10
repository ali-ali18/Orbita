package expo.modules.orbitanotifications

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Lê as notificações dos apps de banco que o dono ligou. Roda com o app fechado: o Android religa este serviço sozinho.
 *
 * Ordem das barreiras (da mais barata à mais cara, e a primeira já corta o resto):
 *  1. o pacote precisa estar na lista de bancos ligados (e na lista fixa `BANK_PACKAGES`): de qualquer outro app NADA é
 *     lido, nem o título;
 *  2. avisos de grupo e notificações fixas (em andamento) são ignorados;
 *  3. o que parece código de verificação, token ou senha é jogado fora;
 *  4. o que sobra é cortado e vai para a fila cifrada; só título, texto, pacote e horário saem do aparelho.
 */
class OrbitaNotificationListener : NotificationListenerService() {
  override fun onListenerConnected() {
    // O Android religou o serviço (reinício, atualização): manda o que ficou na fila.
    Sender.flushAsync(applicationContext)
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val posted = sbn ?: return
    // 1. A lista fixa de bancos vem ANTES de qualquer outra coisa (inclusive de abrir a configuração cifrada): de outro
    //    app nada é lido nem decifrado.
    val pkg = posted.packageName ?: return
    if (pkg !in NotificationPolicy.BANK_PACKAGES) return
    val store = NotificationStore.get(applicationContext)
    // O servidor recusou o token: não adianta enfileirar até o app configurar de novo.
    if (store.authFailed) return
    val config = store.config() ?: return
    if (!config.enabled || pkg !in config.packages) return

    val notification = posted.notification ?: return
    if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    if (notification.flags and Notification.FLAG_ONGOING_EVENT != 0) return
    val extras = notification.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
      ?.toString().orEmpty()
    if (text.isBlank()) return
    if (NotificationPolicy.isSensitive(title, text)) return

    store.enqueue(
      pkg,
      NotificationPolicy.clean(title, NotificationPolicy.TITLE_MAX),
      NotificationPolicy.clean(text, NotificationPolicy.TEXT_MAX),
      // `when` é a hora do evento e costuma ficar igual quando o app do banco atualiza a notificação; `postTime` muda.
      if (notification.`when` > 0) notification.`when` else posted.postTime,
      posted.key ?: "",
    )
    Sender.flushAsync(applicationContext)
  }
}

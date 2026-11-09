package expo.modules.orbitanotifications

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Ponte entre o app (JavaScript) e o serviço que lê as notificações. O JavaScript só configura (servidor, token,
 * bancos ligados), consulta o estado e abre as telas de permissão do Android; a leitura e o envio acontecem no
 * serviço, sem o JavaScript.
 */
class OrbitaNotificationsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OrbitaNotifications")

    /** O dono deu o acesso às notificações a este app (Configurações do Android › Acesso a notificações)? */
    Function("isAccessGranted") {
      isAccessGranted(context)
    }

    /** Abre a tela do sistema em que o dono liga o acesso. */
    Function("openAccessSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /** Informações do app: no Android 13+, o acesso de um APK instalado fora da loja pode estar bloqueado até aqui. */
    Function("openAppSettings") {
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("configure") { baseUrl: String, token: String, packages: List<String>, enabled: Boolean ->
      NotificationStore.get(context).configure(baseUrl, token, packages, enabled)
      if (enabled) Sender.flushAsync(context)
    }

    /** Sair do app: apaga servidor, token e fila. */
    Function("clear") {
      NotificationStore.get(context).clear()
    }

    Function("getStatus") {
      val store = NotificationStore.get(context)
      mapOf(
        "granted" to isAccessGranted(context),
        "queued" to store.size(),
        "lastSentAt" to store.lastSentAt.toDouble(),
        "lastError" to store.lastError,
        "authFailed" to store.authFailed,
      )
    }

    /** Manda a fila agora (ao abrir o app, por exemplo). */
    AsyncFunction("flush") {
      if (!Sender.flush(context)) FlushJobService.schedule(context)
    }
  }

  private fun isAccessGranted(context: Context): Boolean {
    val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
    val mine = ComponentName(context, OrbitaNotificationListener::class.java).flattenToString()
    return enabled.split(":").any { it == mine }
  }
}

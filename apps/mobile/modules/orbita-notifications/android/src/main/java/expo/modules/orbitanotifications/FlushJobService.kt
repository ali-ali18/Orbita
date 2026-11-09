package expo.modules.orbitanotifications

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

/**
 * Tentativa de reenvio da fila quando o aparelho tem rede de novo (o Android só chama o job com rede disponível).
 * Reagenda sozinho, com espera crescente, enquanto sobrar fila.
 */
class FlushJobService : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    val app = applicationContext
    Thread {
      val done = Sender.flush(app)
      jobFinished(params, !done)
    }.start()
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean = true

  companion object {
    private const val JOB_ID = 7301

    fun schedule(context: Context) {
      val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
      val job = JobInfo.Builder(JOB_ID, ComponentName(context, FlushJobService::class.java))
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        .setBackoffCriteria(60_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
        .setMinimumLatency(30_000L)
        .build()
      scheduler.schedule(job)
    }
  }
}

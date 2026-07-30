package com.empresa.localizador.tracking

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.empresa.localizador.R
import com.empresa.localizador.ui.MainActivity

object Notifications {

    const val CHANNEL_TRACKING = "tracking"
    const val CHANNEL_ALERTS = "alerts"

    const val ID_TRACKING = 1001
    const val ID_ALERT = 1002

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return

        // Canal del servicio: sin sonido ni vibración —es un aviso permanente que
        // Android obliga a mostrar— pero con importancia suficiente para que las
        // capas de fabricante no lo escondan (si se oculta, algunos OEM matan el
        // servicio por "no tener notificación visible").
        val tracking = NotificationChannel(
            CHANNEL_TRACKING,
            context.getString(R.string.channel_tracking_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = context.getString(R.string.channel_tracking_desc)
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        val alerts = NotificationChannel(
            CHANNEL_ALERTS,
            context.getString(R.string.channel_alerts_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.channel_alerts_desc)
        }

        nm.createNotificationChannel(tracking)
        nm.createNotificationChannel(alerts)
    }

    private fun contentIntent(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /**
     * Notificación del servicio en primer plano. El texto secundario refleja el
     * estado real (enviando, en cola, sin señal), así que el técnico —y quien mire
     * su teléfono— puede ver de un vistazo que la app está trabajando.
     */
    fun trackingNotification(context: Context, status: String): Notification =
        NotificationCompat.Builder(context, CHANNEL_TRACKING)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(context.getString(R.string.notif_tracking_title))
            .setContentText(status)
            .setStyle(NotificationCompat.BigTextStyle().bigText(status))
            .setContentIntent(contentIntent(context))
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .build()

    /** Aviso puntual cuando algo rompe el rastreo y hace falta que el técnico actúe. */
    fun alert(context: Context, title: String, body: String): Notification =
        NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(contentIntent(context))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
}

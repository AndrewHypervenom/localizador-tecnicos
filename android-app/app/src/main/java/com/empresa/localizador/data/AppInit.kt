package com.empresa.localizador.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Barrera de arranque.
 *
 * Existe por un motivo muy concreto: [Prefs.installId] **genera y guarda** un
 * identificador nuevo la primera vez que se lee. Si algo consultara ese
 * identificador antes de que [LegacyImporter] haya podido rescatar el de la
 * versión anterior, el teléfono estrenaría identidad y el servidor lo daría por
 * no vinculado — es decir, **todos los técnicos tendrían que volver a escanear el
 * QR**, justo lo que la actualización en sitio pretende evitar.
 *
 * Así que nada que dependa de la identidad del dispositivo debe correr antes de
 * que esto se cumpla.
 */
object AppInit {

    private val ready = CompletableDeferred<Unit>()

    fun markReady() {
        ready.complete(Unit)
    }

    /** Espera a que la herencia haya terminado. */
    suspend fun await() = ready.await()

    /**
     * Variante con tope de espera, para los receivers: tienen una ventana corta
     * antes de que el sistema los dé por terminados, así que es preferible seguir
     * adelante a quedarse colgado.
     */
    suspend fun awaitAtMost(millis: Long): Boolean =
        withTimeoutOrNull(millis) { ready.await() } != null
}

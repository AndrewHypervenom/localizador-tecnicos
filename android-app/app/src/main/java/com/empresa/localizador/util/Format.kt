package com.empresa.localizador.util

import java.time.Instant

/** Epoch en milisegundos → ISO-8601 UTC, el formato que espera PostgREST. */
fun Long.toIsoInstant(): String = Instant.ofEpochMilli(this).toString()

/**
 * Geometría en WKT tal y como la enviaba la versión anterior. El orden es
 * (longitud latitud): invertirlo pondría a todos los técnicos en el mar.
 */
fun toWktPoint(lng: Double, lat: Double): String = "POINT($lng $lat)"

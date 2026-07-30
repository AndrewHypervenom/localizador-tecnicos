# kotlinx.serialization: conservar los serializadores generados de los modelos.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.empresa.localizador.** {
    *** Companion;
}
-keepclasseswithmembers class com.empresa.localizador.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.empresa.localizador.**$$serializer { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**

# Room genera implementaciones por reflexión en tiempo de compilación; nada extra.

# ML Kit barcode (modelo empaquetado)
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# Los componentes declarados en el manifiesto (servicio, receivers, workers) los
# instancia el sistema por nombre: no renombrarlos.
-keep class com.empresa.localizador.tracking.TrackingService { *; }
-keep class com.empresa.localizador.boot.** { *; }
-keep class com.empresa.localizador.work.** { *; }

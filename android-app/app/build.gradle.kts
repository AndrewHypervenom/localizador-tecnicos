import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

// Credenciales de Supabase fuera del control de versiones (mismo par que usaba
// mobile/.env). secrets.properties está en .gitignore; secrets.properties.example
// documenta las claves necesarias.
val secrets = Properties().apply {
    val f = rootProject.file("secrets.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun secret(key: String): String = (secrets.getProperty(key) ?: "").trim()

android {
    namespace = "com.empresa.localizador"
    compileSdk = 35

    defaultConfig {
        // MISMO applicationId que la app React Native: firmada con la misma llave,
        // el APK entra como ACTUALIZACIÓN en sitio y conserva los datos de la app
        // anterior (de ahí LegacyImporter puede heredar el vínculo del dispositivo).
        applicationId = "com.empresa.localizador"
        minSdk = 24
        targetSdk = 35
        // 21 / 2.1.0 — latencia de envío y reposo (2026-08-24).
        // SUBIRLO en cada reparto: quien ya tenga la 2.0.0 (versionCode 20) no
        // recibiría nada si se le vuelve a empujar un 20, y el MDM daría la
        // actualización por aplicada sin haber instalado el código nuevo.
        versionCode = 21
        versionName = "2.1.0"

        buildConfigField("String", "SUPABASE_URL", "\"${secret("SUPABASE_URL")}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${secret("SUPABASE_ANON_KEY")}\"")

        vectorDrawables.useSupportLibrary = true

        ndk {
            // Solo las arquitecturas que existen en teléfonos reales. x86/x86_64
            // son emuladores y se llevaban la mitad del tamaño del APK, que aquí
            // importa porque se reparte a mano.
            abiFilters += setOf("armeabi-v7a", "arm64-v8a")
        }
    }

    signingConfigs {
        // Llave heredada de la app React Native (mobile/android/app/debug.keystore).
        // Cambiarla rompería la actualización en sitio: Android rechaza un APK del
        // mismo paquete firmado con otra llave y obligaría a desinstalar (y a que
        // los 100% de los técnicos volvieran a escanear el QR).
        create("legacy") {
            storeFile = rootProject.file("keystore/localizador-release.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("legacy")
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
        }
        release {
            signingConfig = signingConfigs.getByName("legacy")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Necesario en minSdk 24 para java.time y otras APIs usadas por las libs.
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf(
            "/META-INF/{AL2.0,LGPL2.1}",
            "META-INF/DEPENDENCIES",
        )
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.2")

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.service)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    implementation(libs.androidx.work.runtime.ktx)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)

    implementation(libs.play.services.location)

    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.mlkit.barcode.scanning)
}

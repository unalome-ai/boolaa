import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Supabase URL and anon key come from local.properties (gitignored), see README.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.isFile) f.inputStream().use { load(it) }
}
fun localProp(key: String, fallback: String) =
    localProps.getProperty(key) ?: System.getenv(key.uppercase().replace('.', '_')) ?: fallback

android {
    namespace = "com.boolaa.app"
    compileSdk = 36

    defaultConfig {
        // Google and Apple OAuth clients are registered for ro.boolaa.app (docs/oauth-clients.md).
        // The Kotlin namespace stays com.boolaa.app.
        applicationId = "ro.boolaa.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "SUPABASE_URL", "\"${localProp("supabase.url", "http://127.0.0.1:55321")}\"")
        // Next.js web app serving /privacy and /terms (emulator: adb reverse tcp:3200 tcp:3200).
        buildConfigField("String", "WEB_BASE_URL", "\"${localProp("web.baseUrl", "http://localhost:3200")}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${localProp("supabase.anonKey", "")}\"")
        // Google sign-in: Credential Manager asks for an ID token for the WEB client (docs/oauth-clients.md). Public, not a secret.
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"816126337836-0k4begddfi0f1usm1hg2e6va9fddni3m.apps.googleusercontent.com\"")
        // OAuth (Apple) returns through this deep link; it must be in the Supabase redirect allow-list.
        manifestPlaceholders["authScheme"] = "ro.boolaa.app"
        // Instrumented tests only (local stack): Mailpit for emailed codes, and the LOCAL service-role key to flip
        // app_settings flags. Both come from local.properties (gitignored) and are passed to `am instrument`, never
        // compiled into the app.
        testInstrumentationRunnerArguments["mailpitUrl"] = localProp("mailpit.url", "http://127.0.0.1:55324")
        localProps.getProperty("supabase.serviceRoleKey")?.let { testInstrumentationRunnerArguments["serviceRoleKey"] = it }
    }

    androidResources {
        // Ship only the five app languages (also trims library translations). The per-app language list is res/xml/locales_config.xml.
        localeFilters += listOf("en", "ro", "fr", "es", "it")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
    lint {
        // Compose has no HardcodedText lint, so StringsParityTest/NoHardcodedTextTest also scan the sources.
        error += listOf("HardcodedText", "MissingTranslation", "ExtraTranslation", "MissingQuantity", "UnusedQuantity")
        disable += listOf("NewerVersionAvailable", "GradleDependency", "AndroidGradlePluginVersion", "ObsoleteLintCustomCheck")
        abortOnError = true
    }
    packaging {
        resources.excludes += listOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/INDEX.LIST", "/META-INF/io.netty.versions.properties")
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.extended)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(platform(libs.supabase.bom))
    implementation(libs.supabase.auth)
    implementation(libs.supabase.postgrest)
    implementation(libs.supabase.realtime)
    implementation(libs.supabase.storage)
    implementation(libs.supabase.functions)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)
    implementation(libs.googleid)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.okhttp) { version { strictly(libs.versions.okhttp.get()) } }
    implementation(libs.androidx.browser)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.core)
}

// Newer androidx.lifecycle (2.11+) requires compileSdk 37; keep the whole group on the catalog version.
configurations.configureEach {
    resolutionStrategy.eachDependency {
        if (requested.group == "androidx.lifecycle") useVersion(libs.versions.lifecycle.get())
    }
}

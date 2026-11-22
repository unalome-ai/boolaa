package com.boolaa.app.core

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import com.boolaa.app.BuildConfig
import com.boolaa.app.state.LocaleManager
import java.util.Locale

/** Privacy policy and terms pages on the web app, in the app's language. */
object Legal {
    enum class Page(val path: String) { PRIVACY("privacy"), TERMS("terms") }

    /** The app language (per-app setting, else the UI locale), limited to the shipped languages. */
    fun appLanguage(uiLocale: Locale): String =
        (LocaleManager.current() ?: uiLocale.language).takeIf { it in LocaleManager.supported } ?: "en"

    fun url(page: Page, lang: String, base: String = BuildConfig.WEB_BASE_URL): String =
        "${base.trimEnd('/')}/${page.path}?lang=$lang"

    fun open(context: Context, page: Page, uiLocale: Locale) {
        val uri = Uri.parse(url(page, appLanguage(uiLocale)))
        try {
            CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(0xFF9D78BD.toInt()).build())
                .build()
                .launchUrl(context, uri)
        } catch (_: ActivityNotFoundException) {
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        }
    }
}

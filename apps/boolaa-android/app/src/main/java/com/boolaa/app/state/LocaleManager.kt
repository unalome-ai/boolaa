package com.boolaa.app.state

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat

/** Per-app language (res/xml/locales_config.xml). null means "follow the system". */
object LocaleManager {
    val supported = listOf("en", "ro", "fr", "es", "it")

    /** The language the app shows: the per-app choice, else the system language if supported, else English. */
    fun effective(): String = current() ?: java.util.Locale.getDefault().language.takeIf { it in supported } ?: "en"

    fun current(): String? = AppCompatDelegate.getApplicationLocales().takeIf { !it.isEmpty }?.get(0)?.language

    fun set(tag: String?) {
        AppCompatDelegate.setApplicationLocales(
            if (tag == null) LocaleListCompat.getEmptyLocaleList() else LocaleListCompat.forLanguageTags(tag),
        )
    }
}

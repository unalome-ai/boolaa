package com.boolaa.app.state

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat

/** Per-app language (res/xml/locales_config.xml). null means "follow the system". */
object LocaleManager {
    val supported = listOf("en", "ro", "fr", "es", "it")

    fun current(): String? = AppCompatDelegate.getApplicationLocales().takeIf { !it.isEmpty }?.get(0)?.language

    fun set(tag: String?) {
        AppCompatDelegate.setApplicationLocales(
            if (tag == null) LocaleListCompat.getEmptyLocaleList() else LocaleListCompat.forLanguageTags(tag),
        )
    }
}

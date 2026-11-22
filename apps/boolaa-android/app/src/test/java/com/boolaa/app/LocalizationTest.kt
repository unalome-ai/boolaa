package com.boolaa.app

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import com.boolaa.app.core.Formats
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale

/** Plurals and formatting resolved through a Context configured per locale. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
class LocalizationTest {
    private fun ctx(tag: String): Context {
        val base: Context = ApplicationProvider.getApplicationContext()
        val config = Configuration(base.resources.configuration).apply { setLocale(Locale.forLanguageTag(tag)) }
        return base.createConfigurationContext(config)
    }

    private fun members(tag: String, n: Int) = ctx(tag).resources.getQuantityString(R.plurals.members_count, n, n)

    @Test fun english() {
        assertEquals("1 member", members("en", 1))
        assertEquals("2 members", members("en", 2))
        assertEquals("0 members", members("en", 0))
    }

    @Test fun romanian_one_few_other() {
        assertEquals("1 membru", members("ro", 1))
        assertEquals("2 membri", members("ro", 2))
        assertEquals("19 membri", members("ro", 19))
        assertEquals("20 de membri", members("ro", 20))
        assertEquals("101 membri", members("ro", 101))
        assertEquals("3 din 8 membri", ctx("ro").resources.getQuantityString(R.plurals.members_of_max, 8, 3, 8))
        assertEquals("1 din 20 de aprobări", ctx("ro").resources.getQuantityString(R.plurals.approvals_of_needed, 20, 1, 20))
    }

    @Test fun french_singular_for_zero_and_one() {
        assertEquals("0 membre", members("fr", 0))
        assertEquals("1 membre", members("fr", 1))
        assertEquals("2 membres", members("fr", 2))
    }

    @Test fun spanish_and_italian() {
        assertEquals("1 miembro", members("es", 1))
        assertEquals("5 miembros", members("es", 5))
        assertEquals("1 membro", members("it", 1))
        assertEquals("3 partecipano", ctx("it").resources.getQuantityString(R.plurals.going_count, 3, 3))
    }

    @Test fun glossary_terms_per_locale() {
        val expected = mapOf(
            "en" to listOf("Home", "Settings", "Food Circle", "Marketplace"),
            "ro" to listOf("Acasă", "Setări", "Cercul culinar", "Piață"),
            "fr" to listOf("Accueil", "Réglages", "Cercle gourmand", "Marché"),
            "es" to listOf("Inicio", "Ajustes", "Círculo de comida", "Mercadillo"),
            "it" to listOf("Home", "Impostazioni", "Cerchio del cibo", "Mercatino"),
        )
        expected.forEach { (tag, terms) ->
            val r = ctx(tag).resources
            assertEquals(terms, listOf(R.string.tab_home, R.string.tab_settings, R.string.tab_food, R.string.tab_marketplace).map(r::getString))
        }
        assertEquals("Părăsește bula", ctx("ro").getString(R.string.leave_bubble))
    }

    @Test fun dates_follow_locale() {
        val t = Instant.parse("2026-11-25T15:26:00Z")
        val en = Formats.dateTime(t, Locale.ENGLISH, ZoneOffset.UTC)
        val fr = Formats.dateTime(t, Locale.FRENCH, ZoneOffset.UTC)
        assertTrue(en, en.contains("Nov"))
        assertTrue(fr, fr.contains("nov.") && fr.contains("15:26"))
        assertNotEquals(Formats.relative(t, Locale.ENGLISH, t.plusSeconds(600)), Formats.relative(t, Locale.forLanguageTag("ro"), t.plusSeconds(600)))
    }
}

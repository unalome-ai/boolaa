package com.boolaa.app

import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/** Every values-xx/strings.xml must have exactly the translatable keys and plural quantities of values/. */
class StringsParityTest {
    private val res = File("src/main/res")
    private val locales = listOf("ro", "fr", "es", "it")
    private val requiredQuantities = mapOf(
        "en" to setOf("one", "other"), "ro" to setOf("one", "few", "other"),
        "fr" to setOf("one", "many", "other"), "es" to setOf("one", "many", "other"), "it" to setOf("one", "many", "other"),
    )

    private data class Parsed(val strings: Map<String, String>, val plurals: Map<String, Set<String>>, val fixed: Set<String>)

    private fun parse(file: File): Parsed {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val strings = mutableMapOf<String, String>(); val fixed = mutableSetOf<String>()
        val sl = doc.getElementsByTagName("string")
        for (i in 0 until sl.length) {
            val e = sl.item(i) as Element
            if (e.getAttribute("translatable") == "false") fixed += e.getAttribute("name") else strings[e.getAttribute("name")] = e.textContent
        }
        val plurals = mutableMapOf<String, Set<String>>()
        val pl = doc.getElementsByTagName("plurals")
        for (i in 0 until pl.length) {
            val e = pl.item(i) as Element
            val items = e.getElementsByTagName("item")
            plurals[e.getAttribute("name")] = (0 until items.length).map { (items.item(it) as Element).getAttribute("quantity") }.toSet()
        }
        return Parsed(strings, plurals, fixed)
    }

    @Test fun locales_match_default() {
        val base = parse(File(res, "values/strings.xml"))
        assertTrue(base.strings.size > 50)
        val problems = mutableListOf<String>()
        base.plurals.forEach { (k, q) -> if (!q.containsAll(requiredQuantities.getValue("en"))) problems += "en plural $k has $q" }
        for (lang in locales) {
            val file = File(res, "values-$lang/strings.xml")
            if (!file.exists()) { problems += "missing $file"; continue }
            val p = parse(file)
            (base.strings.keys - p.strings.keys).forEach { problems += "$lang missing string $it" }
            (p.strings.keys - base.strings.keys).forEach { problems += "$lang extra string $it" }
            p.fixed.forEach { problems += "$lang redefines non-translatable $it" }
            (base.plurals.keys - p.plurals.keys).forEach { problems += "$lang missing plural $it" }
            (p.plurals.keys - base.plurals.keys).forEach { problems += "$lang extra plural $it" }
            p.plurals.forEach { (k, q) ->
                val need = requiredQuantities.getValue(lang)
                if (!q.containsAll(need)) problems += "$lang plural $k lacks ${need - q}"
            }
            // Same format placeholders as English.
            p.strings.forEach { (k, v) ->
                val ph = Regex("%\\d\\$[sd]")
                if (base.strings[k] != null && ph.findAll(v).map { it.value }.toSet() != ph.findAll(base.strings[k]!!).map { it.value }.toSet())
                    problems += "$lang placeholders differ in $k"
            }
        }
        if (problems.isNotEmpty()) fail(problems.joinToString("\n"))
    }

    @Test fun romanian_uses_comma_below_diacritics() {
        val text = File(res, "values-ro/strings.xml").readText()
        assertTrue("Romanian must use ș/ț (comma below), not ş/ţ", listOf('ş', 'ţ', 'Ş', 'Ţ').none { it in text })
    }
}

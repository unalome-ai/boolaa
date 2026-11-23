package com.boolaa.app.core

import java.net.URI

/**
 * Tappable links in chat text (docs/boolaa-spec.md "Chat"). Same rules as the web (`src/lib/linkify.ts`) and iOS
 * (`Linkify.swift`):
 *  - a link starts at `http://`, `https://` or `www.` on a word boundary and runs to whitespace;
 *  - trailing punctuation (. , ! ? ; : ' " and unbalanced closing brackets) stays text;
 *  - `www.` links get `https://`; only http(s) URLs with a host are linked.
 * No previews in chat: links open outside the app (the browser).
 */
object Linkify {
    data class Part(val text: String, val url: String? = null)

    private val pattern = Regex("""\b(?:https?://|www\.)[^\s<>"]+""", RegexOption.IGNORE_CASE)
    private val trailing = setOf('.', ',', '!', '?', ';', ':', '\'', '’', '”', '*', '_')
    private val pairs = mapOf(')' to '(', ']' to '[', '}' to '{', '>' to '<')

    /** Drops trailing punctuation that is almost always sentence text, not part of the URL. */
    fun trim(raw: String): String {
        var s = raw
        while (s.isNotEmpty()) {
            val last = s.last()
            val open = pairs[last]
            s = when {
                last in trailing -> s.dropLast(1)
                open != null && s.count { it == open } < s.count { it == last } -> s.dropLast(1)
                else -> return s
            }
        }
        return s
    }

    /** The URL a matched link opens, or null when it isn't a usable http(s) URL. */
    fun urlFor(match: String): String? {
        val href = if (match.startsWith("www.", ignoreCase = true)) "https://$match" else match
        return try {
            val uri = URI(href)
            val scheme = uri.scheme?.lowercase()
            val host = uri.host
            if ((scheme == "http" || scheme == "https") && !host.isNullOrEmpty() && (host.contains('.') || host == "localhost")) href else null
        } catch (_: Exception) {
            // Non-ASCII paths etc.: accept when the host part is plain.
            val host = href.substringAfter("://").substringBefore('/').substringBefore('?').substringBefore('#')
            if (host.contains('.') && host.all { it.isLetterOrDigit() || it == '.' || it == '-' || it == ':' }) href else null
        }
    }

    /** Plain and link parts, in order; joining every `text` gives the input back. */
    fun split(text: String): List<Part> {
        val parts = mutableListOf<Part>()
        var last = 0
        for (m in pattern.findAll(text)) {
            val raw = trim(m.value)
            val url = if (raw.isNotEmpty()) urlFor(raw) else null
            if (url == null) continue
            if (m.range.first > last) parts += Part(text.substring(last, m.range.first))
            parts += Part(raw, url)
            last = m.range.first + raw.length
        }
        if (last < text.length) parts += Part(text.substring(last))
        return parts
    }
}

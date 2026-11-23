package com.boolaa.app.core

import com.boolaa.app.model.MentionCandidate
import com.boolaa.app.model.MentionSpan
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.text.Collator

/**
 * A mention token in the composer: `text[start, end)` in **UTF-16** indices (the composer's native ones). Converted
 * to code-point [MentionSpan]s only when the message is sent.
 */
@Serializable
data class MentionToken(
    val start: Int,
    val end: Int,
    @SerialName("user_id") val userId: String,
)

/**
 * Chat @mentions (docs/boolaa-spec.md "Mentions"), pure so every rule is unit-tested:
 *  - the one place where server spans (Unicode code points) and Android indices (UTF-16) are converted;
 *  - how a message renders (me / member / anyone else);
 *  - the composer: the `@` trigger and its query, filtering and order, insertion, a token deleted as one unit,
 *    typing inside a token, trimming on send, the "Ask in chat" draft.
 */
object Mentions {
    /** More spans than this are refused by the server (`too many mentions`). */
    const val MAX_MENTIONS = 10
    /** The query after `@` is at most this many code points. */
    const val MAX_QUERY = 30
    /** A span is 2–101 code points (`@` + a name of at most 100). */
    const val MAX_SPAN = 101
    /** A message naming someone who isn't a candidate reloads the candidates at most this often. */
    const val CANDIDATES_RETRY_MS = 30_000L

    /** An `@` opens the list at the start of the text or after whitespace or one of these. */
    private val OPENERS = setOf('(', '[', '"', '\'', '“', '„', '«', '‘')

    // ---- Offsets -----------------------------------------------------------------------------------------------

    /** The UTF-16 range `[first, second)` of [span] in [text], or null when it doesn't fit the text. */
    fun nativeRange(text: String, span: MentionSpan): Pair<Int, Int>? {
        if (span.start < 0 || span.length <= 0) return null
        val points = text.codePointCount(0, text.length)
        if (span.start.toLong() + span.length > points) return null
        val start = text.offsetByCodePoints(0, span.start)
        val end = text.offsetByCodePoints(start, span.length)
        return start to end
    }

    /** The code-point span of the UTF-16 range `[start, end)` of [text]. */
    fun spanOf(text: String, start: Int, end: Int, userId: String): MentionSpan =
        MentionSpan(text.codePointCount(0, start), text.codePointCount(start, end), userId)

    // ---- Rendering ---------------------------------------------------------------------------------------------

    enum class Kind {
        /** The reader: `@` + their current name, in the filled pill. */
        ME,
        /** A mention candidate: `@` + their current name, semibold. */
        MEMBER,
        /** Anyone else (left, deleted, blocked, unknown): the span's own text, plain. */
        PLAIN,
    }

    sealed interface Part {
        val text: String
        /** Text between mentions: shown as today (linkified). */
        data class Text(override val text: String) : Part
        /** A mention, already rewritten to the text shown. Never a link or a button. */
        data class Mention(override val text: String, val userId: String, val kind: Kind) : Part
    }

    /**
     * Walks [spans] in order over [content]. [names] maps the candidates' lower-case ids to their current names.
     * Spans that don't fit (out of range, not starting with `@`, overlapping) are ignored, never a crash.
     */
    fun parts(content: String, spans: List<MentionSpan>, me: String?, myName: String?, names: Map<String, String>): List<Part> {
        if (spans.isEmpty()) return if (content.isEmpty()) emptyList() else listOf(Part.Text(content))
        val out = mutableListOf<Part>()
        var last = 0
        for (span in spans.sortedBy { it.start }) {
            val (start, end) = nativeRange(content, span) ?: continue
            if (start < last || content[start] != '@') continue
            if (start > last) out += Part.Text(content.substring(last, start))
            val own = content.substring(start, end)
            val id = span.userId.lowercase()
            val name = names[id]?.takeIf { it.isNotBlank() }
            out += when {
                me != null && id == me.lowercase() -> Part.Mention(myName?.takeIf { it.isNotBlank() }?.let { "@$it" } ?: own, id, Kind.ME)
                name != null -> Part.Mention("@$name", id, Kind.MEMBER)
                else -> Part.Mention(own, id, Kind.PLAIN)
            }
            last = end
        }
        if (last < content.length) out += Part.Text(content.substring(last))
        return out
    }

    /** The text as displayed (what TalkBack reads and what a copy would copy). */
    fun displayText(parts: List<Part>): String = parts.joinToString("") { it.text }

    /** True when a valid span of [content] names [me]: the message gets the grape bar and "{name} mentioned you". */
    fun mentionsMe(content: String, spans: List<MentionSpan>, me: String?): Boolean =
        me != null && parts(content, spans, me, null, emptyMap()).any { it is Part.Mention && it.kind == Kind.ME }

    /** Users a message mentions who are neither [me] nor a candidate (someone joined meanwhile: reload candidates). */
    fun unknownUsers(spans: List<MentionSpan>, me: String?, candidateIds: Set<String>): Set<String> =
        spans.map { it.userId.lowercase() }.filter { it != me?.lowercase() && it !in candidateIds }.toSet()

    // ---- Composer: trigger, query, list ------------------------------------------------------------------------

    /** The `@` run the caret is in: [at] is the `@`'s index, [text] what follows it up to the caret. */
    data class Query(val at: Int, val text: String)

    /**
     * The open query at [caret] (a collapsed selection), or null: an `@` at the start or after whitespace / an opening
     * bracket or quote, no line break, at most [MAX_QUERY] code points, no two spaces in a row, not inside a token.
     */
    fun query(text: String, caret: Int, tokens: List<MentionToken>): Query? {
        if (caret < 1 || caret > text.length) return null
        var i = caret - 1
        val floor = (caret - (MAX_QUERY * 2 + 1)).coerceAtLeast(0)
        while (i >= floor) {
            val ch = text[i]
            if (ch == '\n' || ch == '\r') return null
            if (ch == '@') break
            i--
        }
        if (i < floor || text[i] != '@') return null
        val q = text.substring(i + 1, caret)
        if (q.codePointCount(0, q.length) > MAX_QUERY || "  " in q) return null
        if (i > 0) {
            val before = text[i - 1]
            if (!before.isWhitespace() && before !in OPENERS) return null
        }
        if (tokens.any { it.start < caret && it.end > i }) return null
        return Query(i, q)
    }

    /** Folded like the search highlighter: NFD, marks dropped, lower case, œ/æ/ß/ø/ł/đ/ı expanded. */
    fun fold(text: String): String = foldForSearch(text).first

    /**
     * The candidates matching [query]: folded names that start with it first, then names with a **word** that starts
     * with it, each group in [collator] order. A bare `@` lists everyone. Candidates without a name are left out.
     */
    fun filter(candidates: List<MentionCandidate>, query: String, collator: Collator): List<MentionCandidate> {
        val q = fold(query)
        val named = candidates.filter { it.name.isNotBlank() }
        val byName = Comparator<MentionCandidate> { a, b -> collator.compare(a.name, b.name) }
        if (q.isEmpty()) return named.sortedWith(byName)
        val starts = mutableListOf<MentionCandidate>()
        val words = mutableListOf<MentionCandidate>()
        for (c in named) {
            val f = fold(c.name)
            when {
                f.startsWith(q) -> starts += c
                wordStarts(f).any { f.startsWith(q, it) } -> words += c
            }
        }
        return starts.sortedWith(byName) + words.sortedWith(byName)
    }

    private fun wordStarts(folded: String): List<Int> =
        (1 until folded.length).filter { !folded[it - 1].isLetterOrDigit() && folded[it].isLetterOrDigit() }

    /** What the list shows for [query]. */
    sealed interface ListState {
        /** Closed: no query, nobody to mention, a spaced query matching nobody, or dismissed with Escape. */
        data object Closed : ListState
        /** "You can mention up to 10 people in one message." (picks nothing). */
        data object Limit : ListState
        /** "No members match" (non-interactive). */
        data object NoMatch : ListState
        data class Rows(val candidates: List<MentionCandidate>) : ListState
    }

    fun listState(query: Query?, candidates: List<MentionCandidate>, tokens: List<MentionToken>, collator: Collator, dismissedAt: Int?): ListState {
        if (query == null || query.at == dismissedAt || candidates.none { it.name.isNotBlank() }) return ListState.Closed
        if (tokens.size >= MAX_MENTIONS) return ListState.Limit
        val rows = filter(candidates, query.text, collator)
        return when {
            rows.isNotEmpty() -> ListState.Rows(rows)
            query.text.contains(' ') -> ListState.Closed
            else -> ListState.NoMatch
        }
    }

    // ---- Composer: editing -------------------------------------------------------------------------------------

    /** The composer after a change: text, selection and the tokens (UTF-16, sorted). */
    data class Edit(val text: String, val selectionStart: Int, val selectionEnd: Int, val tokens: List<MentionToken>)

    /**
     * Picking [candidate]: replaces `@query` (up to [caret]) with `@<name>` and one space (none when the next character
     * is already whitespace); the caret goes after it. A name too long for a span is inserted as plain text.
     */
    fun insert(text: String, tokens: List<MentionToken>, query: Query, caret: Int, candidate: MentionCandidate): Edit {
        val token = "@" + candidate.name
        val nextIsSpace = caret < text.length && text[caret].isWhitespace()
        val inserted = if (nextIsSpace) token else "$token "
        val newText = text.substring(0, query.at) + inserted + text.substring(caret)
        val delta = inserted.length - (caret - query.at)
        val shifted = tokens.map { if (it.start >= caret) it.copy(start = it.start + delta, end = it.end + delta) else it }
        val fits = token.codePointCount(0, token.length) in 2..MAX_SPAN
        val all = if (fits) shifted + MentionToken(query.at, query.at + token.length, candidate.userId.lowercase()) else shifted
        val newCaret = query.at + inserted.length + if (nextIsSpace) 1 else 0
        return Edit(newText, newCaret, newCaret, all.sortedBy { it.start })
    }

    /**
     * Applies a text field change to the tokens. Any deletion or replacement touching part of a token removes the
     * whole token (so Backspace right after it, or Delete right before it, removes it in one keystroke); typing or
     * pasting strictly inside a token turns it into plain text; edits before a token shift it. Pasted text never
     * creates tokens. Selection-only changes keep everything.
     */
    fun applyEdit(
        oldText: String, oldSelStart: Int, oldSelEnd: Int, tokens: List<MentionToken>,
        newText: String, newSelStart: Int, newSelEnd: Int,
    ): Edit {
        if (newText == oldText || tokens.isEmpty()) return Edit(newText, newSelStart, newSelEnd, tokens)
        val (a, b, inserted) = locateChange(oldText, oldSelStart, oldSelEnd, newText)
        val removing = b > a
        var ra = a
        var rb = b
        if (removing) for (t in tokens) if (t.start < b && t.end > a) { ra = minOf(ra, t.start); rb = maxOf(rb, t.end) }
        val expanded = ra != a || rb != b
        val text = if (expanded) oldText.substring(0, ra) + inserted + oldText.substring(rb) else newText
        val delta = inserted.length - (rb - ra)
        val kept = tokens.mapNotNull { t ->
            when {
                removing && t.start < rb && t.end > ra -> null
                !removing && t.start < a && a < t.end -> null
                t.start >= rb -> t.copy(start = t.start + delta, end = t.end + delta)
                else -> t
            }
        }
        return if (expanded) {
            val caret = ra + inserted.length
            Edit(text, caret, caret, kept)
        } else Edit(text, newSelStart, newSelEnd, kept)
    }

    /** Where [old] became [new]: the replaced range `[first, second)` of [old] and the text put there. */
    internal fun locateChange(old: String, selStart: Int, selEnd: Int, new: String): Triple<Int, Int, String> {
        val s = selStart.coerceIn(0, old.length)
        val e = selEnd.coerceIn(s, old.length)
        // Typing, pasting or replacing at the selection.
        val prefix = old.substring(0, s)
        val suffix = old.substring(e)
        if (new.length >= prefix.length + suffix.length && new.startsWith(prefix) && new.endsWith(suffix)) {
            return Triple(s, e, new.substring(s, new.length - suffix.length))
        }
        // Backspace / forward delete at a collapsed caret.
        val d = old.length - new.length
        if (s == e && d > 0) {
            if (s >= d && old.removeRange(s - d, s) == new) return Triple(s - d, s, "")
            if (s + d <= old.length && old.removeRange(s, s + d) == new) return Triple(s, s + d, "")
        }
        // Anything else (an IME rewriting a word): the smallest differing middle.
        var p = 0
        val max = minOf(old.length, new.length)
        while (p < max && old[p] == new[p]) p++
        var q = 0
        while (q < max - p && old[old.length - 1 - q] == new[new.length - 1 - q]) q++
        return Triple(p, old.length - q, new.substring(p, new.length - q))
    }

    // ---- Sending and drafts ------------------------------------------------------------------------------------

    /**
     * The text sent (trimmed, at most [maxLength] UTF-16 units) and its code-point spans: tokens shifted by the trimmed
     * prefix, those that fell outside (or no longer read `@…`) dropped, sorted by start.
     */
    fun prepareSend(raw: String, tokens: List<MentionToken>, maxLength: Int = 4000): Pair<String, List<MentionSpan>> {
        val lead = raw.indexOfFirst { !it.isWhitespace() }.let { if (it < 0) raw.length else it }
        val content = raw.trim().take(maxLength)
        val spans = tokens.sortedBy { it.start }.mapNotNull { t ->
            val s = t.start - lead
            val e = t.end - lead
            if (s < 0 || e > content.length || e - s < 2 || content[s] != '@') return@mapNotNull null
            if (content.substring(s, e).any { it == '\n' || it == '\r' }) return@mapNotNull null
            spanOf(content, s, e, t.userId)
        }
        return content to spans
    }

    /**
     * The "Ask in chat" draft (`@<owner name>, is “…” still available?`) with a real token for the owner when the owner
     * is a candidate (written with their current name); otherwise the text as it was, without a token.
     */
    fun draftWithToken(draft: String, ownerId: String?, ownerName: String?, candidates: List<MentionCandidate>): Pair<String, MentionToken?> {
        if (ownerId == null || ownerName.isNullOrBlank()) return draft to null
        val written = "@$ownerName"
        val owner = candidates.firstOrNull { it.userId.equals(ownerId, ignoreCase = true) && it.name.isNotBlank() }
        if (owner == null || !draft.startsWith(written)) return draft to null
        val token = "@" + owner.name
        if (token.codePointCount(0, token.length) > MAX_SPAN) return draft to null
        return (token + draft.substring(written.length)) to MentionToken(0, token.length, owner.userId.lowercase())
    }
}

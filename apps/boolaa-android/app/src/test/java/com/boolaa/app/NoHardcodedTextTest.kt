package com.boolaa.app

import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * Lint's HardcodedText only covers XML layouts, so this scans the Compose sources for user-visible literals:
 * Text("..."), label/placeholder/title/contentDescription = "...", and stringResource-free Toasts.
 */
class NoHardcodedTextTest {
    private val patterns = listOf(
        Regex("""\bText\(\s*"[^"]*[A-Za-z][^"]*""""),
        Regex("""\b(text|title|label|placeholder|contentDescription|message|confirm)\s*=\s*"[^"]*[A-Za-z][^"]*""""),
        Regex("""Toast\.makeText\([^,]+,\s*""""),
    )

    @Test fun compose_sources_use_string_resources() {
        val offenders = File("src/main/java/com/boolaa/app/ui").walkTopDown().filter { it.extension == "kt" }.flatMap { f ->
            f.readLines().mapIndexedNotNull { i, line ->
                // Animation `label = "..."` is a debug/tooling name, not UI text.
                val ignored = Regex("""(Crossfade|animate\w*AsState|updateTransition|rememberInfiniteTransition)\(""").containsMatchIn(line)
                if (!ignored && patterns.any { it.containsMatchIn(line) }) "${f.name}:${i + 1}: ${line.trim()}" else null
            }
        }.toList()
        if (offenders.isNotEmpty()) fail("Hard-coded UI text:\n" + offenders.joinToString("\n"))
    }
}

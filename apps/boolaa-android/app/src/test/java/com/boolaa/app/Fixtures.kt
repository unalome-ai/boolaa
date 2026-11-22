package com.boolaa.app

import com.boolaa.app.core.BoolaaJson
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer

/** Real PostgREST rows captured as Alice (src/test/resources/fixtures, see README). */
object Fixtures {
    fun text(name: String): String =
        requireNotNull(javaClass.classLoader!!.getResource("fixtures/$name")) { "missing fixture $name" }.readText()

    fun <T> list(name: String, serializer: KSerializer<T>): List<T> =
        BoolaaJson.json.decodeFromString(ListSerializer(serializer), text(name))
}

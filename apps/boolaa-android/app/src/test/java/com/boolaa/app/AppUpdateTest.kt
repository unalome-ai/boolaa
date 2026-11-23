package com.boolaa.app

import com.boolaa.app.core.AndroidRelease
import com.boolaa.app.core.AppUpdate
import com.boolaa.app.core.UpdateKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppUpdateTest {
    private val manifest = """{"versionCode":3,"versionName":"1.2","minSupported":2,"url":"https://github.com/unalome-ai/boolaa/releases/download/android-1.2/boolaa-1.2.apk","sha256":"ab","size":123,"certSha256":"x","released":"2026-12-01"}"""

    @Test fun parsesTheWebManifestAndIgnoresExtraKeys() {
        val r = AppUpdate.parse(manifest)!!
        assertEquals(3, r.versionCode); assertEquals("1.2", r.versionName); assertEquals(2, r.minSupported)
    }

    @Test fun rejectsBadManifests() {
        assertNull(AppUpdate.parse("not json"))
        assertNull(AppUpdate.parse("""{"versionCode":0,"versionName":"x","url":"https://a"}"""))
        assertNull(AppUpdate.parse("""{"versionCode":2,"versionName":"x","url":"http://insecure"}"""))
    }

    @Test fun decidesOptionalRequiredOrNothing() {
        val r = AndroidRelease(versionCode = 3, versionName = "1.2", minSupported = 2, url = "https://a")
        assertEquals(UpdateKind.REQUIRED, AppUpdate.kind(1, r))
        assertEquals(UpdateKind.OPTIONAL, AppUpdate.kind(2, r))
        assertEquals(UpdateKind.NONE, AppUpdate.kind(3, r))
        assertEquals(UpdateKind.NONE, AppUpdate.kind(4, r))
        assertEquals(UpdateKind.NONE, AppUpdate.kind(2, null))
    }

    @Test fun laterHidesOnlyThatVersionButNeverARequiredOne() {
        val r = AndroidRelease(versionCode = 3, versionName = "1.2", minSupported = 2, url = "https://a")
        assertEquals(UpdateKind.NONE, AppUpdate.kind(2, r, dismissed = 3))
        assertEquals(UpdateKind.OPTIONAL, AppUpdate.kind(2, r.copy(versionCode = 4), dismissed = 3))
        assertEquals(UpdateKind.REQUIRED, AppUpdate.kind(1, r, dismissed = 3))
    }
}

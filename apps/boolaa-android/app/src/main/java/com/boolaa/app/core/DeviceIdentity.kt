package com.boolaa.app.core

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * This install's device id (docs/auth-security.md §2): 32 random bytes, base64url (43 chars), created once and kept
 * across sign-outs. Stored encrypted with an AndroidKeyStore AES-GCM key in `boolaa.device.xml`, which is excluded
 * from backup and device transfer, so a restore onto another phone counts as a new device.
 */
class DeviceIdentity(private val store: SecretStore, private val random: SecureRandom = SecureRandom()) {
    @Volatile private var cached: String? = null
    @Volatile private var override: String? = null

    /** The device id sent to `start_device_check` and `device-code`. */
    val id: String
        get() = override ?: cached ?: synchronized(this) {
            cached ?: (store.read(KEY) ?: newId().also { store.write(KEY, it) }).also { cached = it }
        }

    /** Lowercase hex sha256 of [id]: how the server names this device in `list_my_devices`. */
    val hash: String get() = sha256Hex(id)

    /** Debug and tests only: use a fixed id for this process (the seeded `boolaa-test-device`, or a fresh one). */
    fun overrideForTesting(id: String?) { override = id }

    private fun newId(): String {
        val bytes = ByteArray(32).also(random::nextBytes)
        return base64Url(bytes)
    }

    interface SecretStore {
        fun read(key: String): String?
        fun write(key: String, value: String)
    }

    companion object {
        private const val KEY = "device_id"

        /** "Pixel 9 · Android 16": no personal data, at most 120 characters. */
        fun label(model: String = Build.MODEL, release: String = Build.VERSION.RELEASE): String {
            val device = model.trim().ifEmpty { "Android" }
            val text = if (device.contains("Android", ignoreCase = true)) "$device · $release" else "$device · Android $release"
            return text.take(120)
        }

        fun sha256Hex(value: String): String =
            MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

        fun base64Url(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

        fun create(context: Context): DeviceIdentity =
            DeviceIdentity(KeystoreSecretStore(context.getSharedPreferences("boolaa.device", Context.MODE_PRIVATE)))
    }
}

/**
 * SharedPreferences whose values are AES-256-GCM ciphertext under a non-exportable AndroidKeyStore key
 * (the maintained replacement for the deprecated EncryptedSharedPreferences). If the key is gone (a restore,
 * a wiped keystore), the value can't be decrypted and a new device id is created, which is the intended behaviour.
 */
class KeystoreSecretStore(private val prefs: SharedPreferences) : DeviceIdentity.SecretStore {
    override fun read(key: String): String? {
        val stored = prefs.getString(key, null) ?: return null
        return runCatching {
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, IV_BYTES))
            String(cipher.doFinal(raw, IV_BYTES, raw.size - IV_BYTES), Charsets.UTF_8)
        }.getOrNull()
    }

    override fun write(key: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs.edit { putString(key, Base64.encodeToString(sealed, Base64.NO_WRAP)) }
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "boolaa.device_id.v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}

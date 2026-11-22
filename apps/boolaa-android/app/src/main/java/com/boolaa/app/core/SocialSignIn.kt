package com.boolaa.app.core

import android.content.Context
import androidx.credentials.Credential
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException
import com.boolaa.app.BuildConfig
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.providers.builtin.IDToken
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.security.SecureRandom

/**
 * Nonce for Google ID tokens (docs/auth-security.md §7): Google signs sha256(raw) into the token, and Supabase gets
 * the raw value, hashes it and compares. Never send the hashed value to Supabase or the raw one to Google.
 */
data class OAuthNonce(val raw: String, val hashed: String) {
    companion object {
        fun create(random: SecureRandom = SecureRandom()): OAuthNonce {
            val raw = DeviceIdentity.base64Url(ByteArray(32).also(random::nextBytes))
            return OAuthNonce(raw, DeviceIdentity.sha256Hex(raw))
        }
    }
}

/** Sign in with Google through Credential Manager, asking for an ID token for the WEB client ID. */
object GoogleSignIn {
    fun option(nonce: OAuthNonce, serverClientId: String = BuildConfig.GOOGLE_WEB_CLIENT_ID): GetGoogleIdOption =
        GetGoogleIdOption.Builder()
            .setServerClientId(serverClientId)
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .setNonce(nonce.hashed)
            .build()

    /** supabase-kt `signInWith(IDToken) { ... }`: the provider, the Google token and the RAW nonce. */
    fun idTokenConfig(idToken: String, rawNonce: String): IDToken.Config.() -> Unit = {
        this.idToken = idToken
        provider = Google
        nonce = rawNonce
    }

    fun request(nonce: OAuthNonce): GetCredentialRequest = GetCredentialRequest.Builder().addCredentialOption(option(nonce)).build()

    /** The Google ID token inside a Credential Manager result. */
    fun idToken(credential: Credential): String {
        if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            try {
                return GoogleIdTokenCredential.createFrom(credential.data).idToken
            } catch (e: GoogleIdTokenParsingException) {
                throw SocialSignInException(UserFacingError.SIGN_IN_PROVIDER_FAILED, e)
            }
        }
        throw SocialSignInException(UserFacingError.SIGN_IN_PROVIDER_FAILED)
    }

    /** Maps Credential Manager failures; null means the user closed the sheet (no error to show). */
    fun mapFailure(e: GetCredentialException): SocialSignInException? = when (e) {
        is GetCredentialCancellationException -> null
        // No Google account on the device (an emulator without one): say so instead of failing silently.
        is NoCredentialException -> SocialSignInException(UserFacingError.GOOGLE_NO_ACCOUNT, e)
        is GetCredentialProviderConfigurationException, is GetCredentialUnsupportedException ->
            SocialSignInException(UserFacingError.SIGN_IN_PROVIDER_UNAVAILABLE, e)
        else -> SocialSignInException(UserFacingError.SIGN_IN_PROVIDER_FAILED, e)
    }

    /** Shows the Google account sheet; returns the ID token, or null when the user cancelled. [activity] must be an Activity. */
    suspend fun idToken(activity: Context, nonce: OAuthNonce): String? {
        val result = try {
            CredentialManager.create(activity).getCredential(activity, request(nonce))
        } catch (e: GetCredentialException) {
            throw mapFailure(e) ?: return null
        }
        return idToken(result.credential)
    }
}

/** Reads `/auth/v1/settings` to tell whether a provider is switched on, so a disabled one never opens a dead browser page. */
object AuthProviders {
    private val http by lazy { OkHttpClient() }

    suspend fun isEnabled(provider: String, url: String = BuildConfig.SUPABASE_URL, anonKey: String = BuildConfig.SUPABASE_ANON_KEY): Boolean =
        withContext(Dispatchers.IO) {
            val request = Request.Builder().url("$url/auth/v1/settings").header("apikey", anonKey).build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use false
                parseEnabled(response.body.string(), provider)
            }
        }

    fun parseEnabled(settingsJson: String, provider: String): Boolean = runCatching {
        BoolaaJson.json.parseToJsonElement(settingsJson).jsonObject["external"]!!.jsonObject[provider]!!.jsonPrimitive.boolean
    }.getOrDefault(false)
}

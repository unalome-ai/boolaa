package com.boolaa.app.ui.components

import android.content.ContentResolver
import android.net.Uri
import com.boolaa.app.AppContainer
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.ImageCompression

/** Compresses a picked photo to JPEG and uploads it to `<uid>/<uuid>.jpg`; returns the public URL. */
suspend fun uploadPicked(container: AppContainer, resolver: ContentResolver, uri: Uri, bucket: ImageBucket): String {
    val userId = container.session.state.value.userId ?: error("not authenticated")
    val jpeg = ImageCompression.jpegFromUri(resolver, uri)
    return container.api.uploadImage(jpeg, bucket, userId)
}

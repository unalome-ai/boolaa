package com.boolaa.app.ui.components

import android.content.ContentResolver
import android.net.Uri
import com.boolaa.app.AppContainer
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.ImageCompression

/**
 * Runs a picked photo through ImageCompression (upright, downsized for [bucket], no EXIF/GPS, JPEG), uploads it to
 * `<uid>/<uuid>.jpg` and returns the public URL.
 */
suspend fun uploadPicked(container: AppContainer, resolver: ContentResolver, uri: Uri, bucket: ImageBucket): String {
    val userId = container.session.state.value.userId ?: error("not authenticated")
    val jpeg = ImageCompression.jpegFromUri(resolver, uri, bucket)
    return container.api.uploadImage(jpeg, bucket, userId)
}

package com.boolaa.app

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import com.boolaa.app.core.CameraCapture
import com.boolaa.app.core.PhotoUrlInterceptor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class BoolaaApplication : Application(), SingletonImageLoader.Factory {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.connectivity.start(this)
        container.session.start()
        container.unread.start()
        container.push.createChannels(this)
        container.push.start(container.session.state)
        // "Take photo" temp files nobody saved (core/CameraCapture.kt).
        container.appScope.launch(Dispatchers.IO) { CameraCapture.purgeStale(CameraCapture.directory(this@BoolaaApplication)) }
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components {
                // Private photo buckets: stored URLs are signed (batched, cached per path) before loading.
                add(PhotoUrlInterceptor(container.photoUrls))
                add(OkHttpNetworkFetcherFactory())
            }
            .crossfade(true)
            .build()
}

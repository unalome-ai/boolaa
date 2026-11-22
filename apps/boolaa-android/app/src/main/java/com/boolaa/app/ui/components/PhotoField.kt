package com.boolaa.app.ui.components

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.boolaa.app.R
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme

/**
 * Photo picker field (Android Photo Picker, no permission needed). Shows [picked] or [existingUrl];
 * the caller compresses to JPEG and uploads on save (ImageCompression + BoolaaApi.uploadImage).
 */
@Composable
fun PhotoField(existingUrl: String?, picked: Uri?, onPick: (Uri) -> Unit, modifier: Modifier = Modifier) {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) onPick(uri)
    }
    val shape = RoundedCornerShape(Brand.cardRadius)
    Box(
        modifier
            .fillMaxWidth()
            .height(190.dp)
            .clip(shape)
            .background(BoolaaTheme.colors.field)
            .border(1.5.dp, Brand.purple.copy(alpha = 0.35f), shape)
            .clickableRipple { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
            .testTag("photo-field"),
        contentAlignment = Alignment.Center,
    ) {
        val model: Any? = picked ?: existingUrl
        if (model != null) {
            AsyncImage(model = model, contentDescription = stringResource(R.string.photo), contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Default.AddAPhoto, contentDescription = null, tint = Brand.purple, modifier = Modifier.size(32.dp))
                Text(stringResource(R.string.choose_photo), color = Brand.purple, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 6.dp))
            }
        }
    }
}

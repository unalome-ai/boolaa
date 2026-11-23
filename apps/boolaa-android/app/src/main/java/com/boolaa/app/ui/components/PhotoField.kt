package com.boolaa.app.ui.components

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.boolaa.app.R
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type

/**
 * Photo field: a tap offers "Take photo" (system camera) and "Choose from gallery" (Android Photo Picker), neither needs
 * a permission (PhotoSource). Shows [picked] or [existingUrl];
 * the caller compresses to JPEG and uploads on save (ImageCompression + BoolaaApi.uploadImage).
 */
@Composable
fun PhotoField(existingUrl: String?, picked: Uri?, onPick: (Uri) -> Unit, modifier: Modifier = Modifier, hue: Hue = Hue.grape) {
    val source = rememberPhotoSource(onPick)
    val shape = RoundedCornerShape(Radius.card)
    val model: Any? = picked ?: existingUrl
    Box(
        modifier
            .fillMaxWidth()
            .height(200.dp)
            .clip(shape)
            .background(hue.wash)
            .then(if (model == null) Modifier.dashedBorder(hue.text.copy(alpha = 0.45f), Radius.card, dash = 7.dp) else Modifier)
            .clickableRipple(role = Role.Button) { source.open() }
            .testTag("photo-field"),
        contentAlignment = Alignment.Center,
    ) {
        if (model != null) {
            AsyncImage(model = model, contentDescription = stringResource(R.string.photo), contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                BubbleCluster(BoolaaIcons.Camera, hue, size = 72.dp)
                Text(stringResource(R.string.choose_photo), color = hue.text, style = Type.chip)
            }
        }
        PhotoSourceMenu(source)
    }
}

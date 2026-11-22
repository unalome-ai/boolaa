package com.boolaa.app.ui.profile

import android.content.ContentResolver
import android.net.Uri
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.DataExport
import com.boolaa.app.core.DataExportFile
import com.boolaa.app.core.SensitiveAction
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.state.SecurityEvents
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.auth.CodeError
import com.boolaa.app.ui.auth.CodeErrorText
import com.boolaa.app.ui.auth.CodeStepBody
import com.boolaa.app.ui.auth.CodeStepViewModel
import com.boolaa.app.ui.components.BoolaaSheet
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Type
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.io.IOException

// MARK: Download my data (export_data code -> verify -> data-export -> Storage Access Framework)

class ExportDataViewModel(private val container: AppContainer) : CodeStepViewModel() {
    private val _preparing = MutableStateFlow(false)
    /** The code was accepted and `data-export` is running. */
    val preparing = _preparing.asStateFlow()
    private val _file = MutableStateFlow<DataExportFile?>(null)
    /** The export, held in memory until it's saved (a few MB at most); one export an hour, so a cancelled picker keeps it. */
    val file = _file.asStateFlow()
    private val _exportError = MutableStateFlow<Int?>(null)
    /** Why the last export failed, shown on the first step. */
    val exportError = _exportError.asStateFlow()

    override suspend fun sendCode() {
        _exportError.value = null
        container.session.sendSensitiveActionCode(SensitiveAction.EXPORT_DATA)
    }

    override suspend fun verifyCode(code: String) {
        container.session.verifySensitiveActionCode(code)
        export()
    }

    /** Runs right after the verified code, in the same session. Any failure goes back to "Send code" with its message. */
    private suspend fun export() {
        _preparing.value = true
        try {
            _file.value = container.session.exportMyData()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Log.w("Boolaa", "data export failed", e)
            val kind = UserFacingError.classify(e)
            // "session not verified": back to the device gate, like every other surface.
            SecurityEvents.emitFor(kind)
            _exportError.value = kind.message
            resetSent()
        } finally {
            _preparing.value = false
        }
    }

    /** Writes the export to the document the user created in the system picker. */
    fun save(uri: Uri, resolver: ContentResolver) = launchCatching {
        val file = _file.value ?: return@launchCatching
        withContext(Dispatchers.IO) {
            resolver.openOutputStream(uri, "w")?.use { it.write(file.bytes) } ?: throw IOException("no output stream for $uri")
        }
    }

    /** The sheet closed: forget the export and the code step. */
    fun reset() {
        _file.value = null
        _exportError.value = null
        resetSent()
    }
}

/**
 * "Download my data" (GDPR export): what's in the file and that a code comes first, then an emailed `export_data`
 * code, then `data-export` and the system "Save as" picker (Storage Access Framework). Calm, like the security sheets.
 */
@Composable
fun ExportDataFlow(onDismiss: () -> Unit) {
    val container = LocalAppContainer.current
    val vm: ExportDataViewModel = viewModel(key = "export-data") { ExportDataViewModel(container) }
    val sentAt by vm.sentAt.collectAsStateWithLifecycle()
    val sending by vm.sending.collectAsStateWithLifecycle()
    val error by vm.codeError.collectAsStateWithLifecycle()
    val preparing by vm.preparing.collectAsStateWithLifecycle()
    val file by vm.file.collectAsStateWithLifecycle()
    val exportError by vm.exportError.collectAsStateWithLifecycle()
    val resolver = LocalContext.current.contentResolver
    val accountEmail = accountEmail()
    val c = BoolaaTheme.colors
    val saver = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(DataExport.MIME_TYPE)) { uri ->
        // Cancelled: nothing to do, the export stays here for "Save".
        if (uri != null) vm.save(uri, resolver)
    }
    var pickerOpened by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(file) {
        val ready = file ?: return@LaunchedEffect
        if (!pickerOpened) { pickerOpened = true; saver.launch(ready.filename) }
    }
    val close = { if (!preparing) { vm.reset(); onDismiss() } }

    BoolaaSheet(close, stringResource(R.string.profile_export_title), tag = "export-data-sheet") {
        val ready = file
        when {
            ready != null -> {
                SuccessNote(stringResource(R.string.profile_export_done))
                PrimaryButton(stringResource(R.string.save), onClick = { saver.launch(ready.filename) }, calm = true,
                    modifier = Modifier.testTag("export-data-save"))
            }
            preparing -> Row(
                Modifier.fillMaxWidth().padding(vertical = 12.dp).testTag("export-data-preparing"),
                horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(color = Hue.grape.text, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                Text(stringResource(R.string.profile_export_preparing), style = Type.body, color = c.textSecondary)
            }
            sentAt == null -> {
                Text(stringResource(R.string.profile_export_body), style = Type.body, color = c.textPrimary)
                Text(stringResource(R.string.profile_export_code_note), style = Type.subheadline, color = c.textSecondary)
                CodeErrorText(error ?: exportError?.let { CodeError(it) })
                PrimaryButton(stringResource(R.string.send_code), onClick = vm::send, loading = sending, calm = true,
                    modifier = Modifier.testTag("export-data-send"))
            }
            else -> {
                Text(stringResource(R.string.code_sent_to, accountEmail), style = Type.body, color = c.textSecondary)
                CodeStepBody(vm, submitLabel = stringResource(R.string.profile_export_data), calm = true)
            }
        }
        TextButton(onClick = close, enabled = !preparing, modifier = Modifier.align(Alignment.CenterHorizontally).heightIn(min = 44.dp)) {
            Text(stringResource(if (file != null) R.string.done else R.string.cancel), style = Type.headline, color = Hue.grape.text)
        }
    }
    ErrorDialogFor(vm)
}

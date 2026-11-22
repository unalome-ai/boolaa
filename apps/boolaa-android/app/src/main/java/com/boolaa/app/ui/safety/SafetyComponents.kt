package com.boolaa.app.ui.safety

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import com.boolaa.app.R
import com.boolaa.app.core.Legal
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme

/** Overflow on another member: report the user, block or unblock. */
@Composable
fun MemberSafetyMenu(name: String, blocked: Boolean, onReport: () -> Unit, onBlock: () -> Unit, onUnblock: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    IconButton(onClick = { open = true }, modifier = Modifier.size(36.dp).testTag("member-menu-$name")) {
        Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.more_actions), tint = Brand.purple)
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        DropdownMenuItem(text = { Text(stringResource(R.string.report)) }, onClick = { open = false; onReport() },
            modifier = Modifier.testTag("menu-report"))
        if (blocked) DropdownMenuItem(text = { Text(stringResource(R.string.unblock)) }, onClick = { open = false; onUnblock() },
            modifier = Modifier.testTag("menu-unblock"))
        else DropdownMenuItem(text = { Text(stringResource(R.string.block), color = Brand.danger) }, onClick = { open = false; onBlock() },
            modifier = Modifier.testTag("menu-block"))
    }
}

/** "By creating an account you agree to the Terms and Privacy Policy", with both names opening Custom Tabs. */
@Composable
fun LegalAgreementText(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current)[0] ?: java.util.Locale.ENGLISH
    val template = stringResource(R.string.legal_agree)
    val terms = stringResource(R.string.terms_of_use)
    val privacy = stringResource(R.string.privacy_policy)
    val linkStyle = TextLinkStyles(SpanStyle(color = Brand.purple, fontWeight = FontWeight.SemiBold))
    val text: AnnotatedString = buildAnnotatedString {
        var rest = template
        while (rest.isNotEmpty()) {
            val i1 = rest.indexOf("%1\$s"); val i2 = rest.indexOf("%2\$s")
            val next = listOf(i1, i2).filter { it >= 0 }.minOrNull()
            if (next == null) { append(rest); break }
            append(rest.substring(0, next))
            val page = if (next == i1) Legal.Page.TERMS else Legal.Page.PRIVACY
            pushLink(LinkAnnotation.Clickable(page.path, linkStyle) { Legal.open(context, page, locale) })
            append(if (page == Legal.Page.TERMS) terms else privacy)
            pop()
            rest = rest.substring(next + 4)
        }
    }
    Text(text, modifier = modifier.testTag("legal-agree"), color = BoolaaTheme.colors.textSecondary,
        style = LocalTextStyle.current.copy(textAlign = TextAlign.Center))
}

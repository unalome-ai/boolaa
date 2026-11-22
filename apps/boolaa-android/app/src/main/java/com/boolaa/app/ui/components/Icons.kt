package com.boolaa.app.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ManageAccounts
import androidx.compose.material.icons.rounded.AddReaction
import androidx.compose.material.icons.rounded.BookmarkAdded
import androidx.compose.material.icons.rounded.EventAvailable
import androidx.compose.material.icons.rounded.TaskAlt
import androidx.compose.material.icons.rounded.AddCircle
import androidx.compose.material.icons.rounded.ArrowOutward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.EditCalendar
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.FrontHand
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.PersonRemove
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.Redeem
import androidx.compose.material.icons.rounded.Restaurant
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Sell
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.QrCode2
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.SwapHoriz
import androidx.compose.material.icons.rounded.TakeoutDining
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/** The icon vocabulary (design-system.md §4.4): Material's rounded, filled set; outlined only for inactive tabs. */
object BoolaaIcons {
    val AddReaction = Icons.Rounded.AddReaction
    val Home = Icons.Rounded.Home
    val HomeOutline = Icons.Outlined.Home
    val Events = Icons.Rounded.CalendarMonth
    val EventsOutline = Icons.Outlined.CalendarMonth
    val Food = Icons.Rounded.Restaurant
    val FoodOutline = Icons.Outlined.Restaurant
    val Market = Icons.Rounded.Sell
    val MarketOutline = Icons.Outlined.Sell
    val Settings = Icons.Rounded.Settings
    val SettingsOutline = Icons.Outlined.Settings
    val Chat = Icons.Rounded.Forum
    val Link = Icons.Rounded.Link
    val Add = Icons.Rounded.Add
    val Back = Icons.AutoMirrored.Rounded.ArrowBack
    val Disclosure = Icons.AutoMirrored.Rounded.KeyboardArrowRight
    val More = Icons.Rounded.MoreHoriz
    val Edit = Icons.Rounded.Edit
    val Delete = Icons.Rounded.Delete
    val Time = Icons.Rounded.Schedule
    val Place = Icons.Rounded.LocationOn
    val Rsvp = Icons.Rounded.AddCircle
    val Going = Icons.Rounded.CheckCircle
    val Send = Icons.Rounded.ArrowUpward
    val Copy = Icons.Rounded.ContentCopy
    val Check = Icons.Rounded.Check
    val Close = Icons.Rounded.Close
    val Search = Icons.Rounded.Search
    val Share = Icons.Rounded.Share
    val QrCode = Icons.Rounded.QrCode2
    val Free = Icons.Rounded.Redeem
    val Trade = Icons.Rounded.SwapHoriz
    val Open = Icons.Rounded.ArrowOutward
    val SignOut = Icons.AutoMirrored.Rounded.Logout
    val Language = Icons.Rounded.Language
    val Privacy = Icons.Rounded.Shield
    val Terms = Icons.Rounded.Description
    val Blocked = Icons.Rounded.FrontHand
    val Report = Icons.Rounded.Flag
    val Photo = Icons.Rounded.Image
    val Camera = Icons.Rounded.PhotoCamera
    val Pending = Icons.Rounded.HourglassTop
    val Warning = Icons.Rounded.Warning
    val Done = Icons.Rounded.Verified
    val Sparkles = Icons.Rounded.AutoAwesome
    val Takeout = Icons.Rounded.TakeoutDining
    val NewEvent = Icons.Rounded.EditCalendar
    val AddToCalendar = Icons.Rounded.EventAvailable
    val Reserved = Icons.Rounded.BookmarkAdded
    val Taken = Icons.Rounded.TaskAlt
    val RemoveMember = Icons.Rounded.PersonRemove
    val ManageMember = Icons.Rounded.ManageAccounts

    /** Owner crown (Material Symbols "crown" is not in the icons artifact, so it is drawn here). */
    val Crown: ImageVector by lazy {
        ImageVector.Builder(defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            .addPath(
                PathParser().parsePathString(
                    "M5 20.5c-.6 0-1-.4-1-1s.4-1 1-1h14c.6 0 1 .4 1 1s-.4 1-1 1H5zM4.9 16.5 3.1 8.2c-.2-.9.8-1.6 1.6-1.1l3.6 2.4 2.8-4.6c.4-.7 1.4-.7 1.8 0l2.8 4.6 3.6-2.4c.8-.5 1.8.2 1.6 1.1l-1.8 8.3H4.9z",
                ).toNodes(),
                fill = SolidColor(Color.Black),
            ).build()
    }
}

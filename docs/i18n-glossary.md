# Boolaa i18n glossary

Languages: **en** (source and fallback), **ro**, **fr**, **es**, **it**. Both clients use these exact terms so web and iOS read the same. The tone is warm and informal: address the user as **tu** in ro, fr, es and it, never the formal register. Keep "Boolaa" untranslated.

| Key concept | en | ro | fr | es | it |
|---|---|---|---|---|---|
| bubble (group) | bubble | bulă | bulle | burbuja | bolla |
| bubbles | bubbles | bule | bulles | burbujas | bolle |
| Home | Home | Acasă | Accueil | Inicio | Home |
| Chat | Chat | Chat | Discussion | Chat | Chat |
| Events | Events | Evenimente | Événements | Eventos | Eventi |
| Food Circle | Food Circle | Cercul culinar | Cercle gourmand | Círculo de comida | Cerchio del cibo |
| Marketplace | Marketplace | Piață | Marché | Mercadillo | Mercatino |
| Links | Links | Linkuri | Liens | Enlaces | Link |
| Settings | Settings | Setări | Réglages | Ajustes | Impostazioni |
| invite code | invite code | cod de invitație | code d'invitation | código de invitación | codice di invito |
| join request | join request | cerere de alăturare | demande d'adhésion | solicitud para unirse | richiesta di adesione |
| approve / reject | Approve / Reject | Aprobă / Respinge | Approuver / Refuser | Aprobar / Rechazar | Approva / Rifiuta |
| pending approval | Pending approval | În așteptarea aprobării | En attente d'approbation | Pendiente de aprobación | In attesa di approvazione |
| members / owner | members / owner | membri / proprietar | membres / propriétaire | miembros / propietario | membri / proprietario |
| admin (bubble role) | admin / admins | admin / admini | admin / admins | admin / admins | admin / admin |
| leave bubble | Leave bubble | Părăsește bula | Quitter la bulle | Salir de la burbuja | Lascia la bolla |
| RSVP / Going | RSVP / Going | Particip | Je participe | Voy | Ci sono |
| Free / Trade (item status) | Free / Trade | Gratuit / Schimb | Gratuit / Échange | Gratis / Intercambio | Gratis / Scambio |
| Sign in / Sign out | Sign in / Sign out | Autentificare / Deconectare | Se connecter / Se déconnecter | Iniciar sesión / Cerrar sesión | Accedi / Esci |
| Create account | Create account | Creează cont | Créer un compte | Crear cuenta | Crea account |
| Profile | Profile | Profil | Profil | Perfil | Profilo |
| Language | Language | Limbă | Langue | Idioma | Lingua |
| Add buttons (Events / Food / Market / Links) | New event / Share food / New item / Add link | Eveniment nou / Împarte mâncare / Anunț nou / Adaugă link | Nouvel événement / Partager / Nouvel objet / Ajouter le lien | Nuevo evento / Compartir comida / Nuevo artículo / Añadir enlace | Nuovo evento / Condividi cibo / Nuovo oggetto / Aggiungi link |

Language names in the picker are shown in their own language: English, Română, Français, Español, Italiano.

## Rules
- **Plurals** use real plural rules, never "item(s)". Romanian has the forms one, few and other ("1 membru", "2 membri", "20 de membri"). French uses the singular for 0 and 1.
- **Dates, times and numbers** are formatted with the active locale (`Intl` on the web, `FormatStyle` / `Date.FormatStyle` on iOS), never with hard-coded formats. For relative times use `Intl.RelativeTimeFormat` or `RelativeDateTimeFormatter`.
- **Backend errors**: map the RPC exception texts `invalid invite code`, `already a member`, `bubble is full`, `not a member of this bubble`, `request not found`, `event not found` and `event has ended`, and the RLS/network failures, to translated messages. Fall back to a generic translated error and never show raw English from Postgres.

- **User content** (chat, posts, bubble names, links) is never translated.
- **Diacritics** must be correct: Romanian uses ș and ț with a comma below, not the cedilla forms ş and ţ.
- **Review**: the first translations were drafted by AI and should be reviewed by a native speaker before release.

## Auth security errors (docs/auth-security.md §3)

Message keys live under `errors.*` in the web's `messages/*.json`. Function `unauthorized` (401) uses the existing "session expired" text after one refresh-and-retry; `server_error` uses the generic error. In `codeWrong`, `#` is the number of tries left (real plural forms).

| Backend text / code | key | en | ro | fr | es | it |
|---|---|---|---|---|---|---|
| `session not verified` (RPC/RLS), function `session_not_verified` | `sessionNotVerified` | Confirm this device first: enter the code we email you. | Confirmă mai întâi acest dispozitiv: introdu codul pe care ți-l trimitem pe email. | Confirme d'abord cet appareil : saisis le code qu'on t'envoie par e-mail. | Primero confirma este dispositivo: introduce el código que te enviamos por correo. | Prima conferma questo dispositivo: inserisci il codice che ti mandiamo via email. |
| `age confirmation required` (RPC, and sign-up HTTP 400) | `ageConfirmationRequired` | Confirm that you're 16 or older to continue. | Confirmă că ai cel puțin 16 ani ca să continui. | Confirme que tu as 16 ans ou plus pour continuer. | Confirma que tienes 16 años o más para continuar. | Conferma di avere almeno 16 anni per continuare. |
| `reauthentication required` (RPC), Auth `reauthentication_needed` | `reauthenticationRequired` | For your safety, confirm it's you with the code we email you. | Pentru siguranța ta, confirmă că ești tu cu codul pe care ți-l trimitem pe email. | Pour ta sécurité, confirme que c'est bien toi avec le code qu'on t'envoie par e-mail. | Por tu seguridad, confirma que eres tú con el código que te enviamos por correo. | Per la tua sicurezza, conferma che sei tu con il codice che ti mandiamo via email. |
| `invalid device id` | `invalidDeviceId` | We couldn't recognise this browser. Reload the page and try again. | Nu am putut recunoaște acest browser. Reîncarcă pagina și încearcă din nou. | Impossible de reconnaître ce navigateur. Recharge la page et réessaie. | No hemos podido reconocer este navegador. Recarga la página e inténtalo de nuevo. | Non riusciamo a riconoscere questo browser. Ricarica la pagina e riprova. |
| `invalid terms version` | `invalidTermsVersion` | We couldn't save your confirmation. Reload the page and try again. | Nu am putut salva confirmarea. Reîncarcă pagina și încearcă din nou. | Impossible d'enregistrer ta confirmation. Recharge la page et réessaie. | No hemos podido guardar tu confirmación. Recarga la página e inténtalo de nuevo. | Non siamo riusciti a salvare la conferma. Ricarica la pagina e riprova. |
| function `invalid_code` (+ `attempts_left` → `{count}`) | `codeWrong` | That code isn't right. {count, plural, one {# try left.} other {# tries left.}} | Codul nu e corect. {count, plural, one {Mai ai # încercare.} few {Mai ai # încercări.} other {Mai ai # de încercări.}} | Ce code n'est pas bon. {count, plural, one {Il te reste # essai.} other {Il te reste # essais.}} | Ese código no es correcto. {count, plural, one {Te queda # intento.} other {Te quedan # intentos.}} | Il codice non è corretto. {count, plural, one {Ti resta # tentativo.} other {Ti restano # tentativi.}} |
| Auth `otp_expired`, `reauthentication_not_valid` | `codeWrongOrExpired` | That code is wrong or expired. | Codul e greșit sau a expirat. | Ce code est erroné ou a expiré. | Ese código es incorrecto o ha caducado. | Il codice è sbagliato o scaduto. |
| function `invalid_request` (not 6 digits) | `codeFormat` | Enter the 6-digit code. | Introdu codul din 6 cifre. | Saisis le code à 6 chiffres. | Introduce el código de 6 dígitos. | Inserisci il codice di 6 cifre. |
| function `code_expired` (410) | `codeExpired` | That code has expired. Send a new one. | Codul a expirat. Cere unul nou. | Ce code a expiré. Demandes-en un nouveau. | Ese código ha caducado. Pide uno nuevo. | Il codice è scaduto. Chiedine uno nuovo. |
| function `no_active_code` (404) | `noActiveCode` | There's no active code. Send a new one. | Nu ai niciun cod activ. Cere unul nou. | Aucun code actif. Demandes-en un nouveau. | No hay ningún código activo. Pide uno nuevo. | Non c'è nessun codice attivo. Chiedine uno nuovo. |
| function `too_many_attempts` (423) | `tooManyCodeAttempts` | Too many wrong tries. Send a new code. | Prea multe încercări greșite. Cere un cod nou. | Trop d'essais ratés. Demande un nouveau code. | Demasiados intentos fallidos. Pide un código nuevo. | Troppi tentativi sbagliati. Chiedi un nuovo codice. |
| function `rate_limited` (429) | `tooManyCodes` | Too many codes. Try again later. | Prea multe coduri. Încearcă din nou mai târziu. | Trop de codes. Réessaie plus tard. | Demasiados códigos. Inténtalo más tarde. | Troppi codici. Riprova più tardi. |
| function `email_failed` (502) | `emailSendFailed` | Couldn't send the email. Try again. | Nu am putut trimite emailul. Încearcă din nou. | Impossible d'envoyer l'e-mail. Réessaie. | No hemos podido enviar el correo. Inténtalo de nuevo. | Non siamo riusciti a inviare l'email. Riprova. |
| Auth `over_email_send_rate_limit` (429) | `emailRateLimited` | We just sent you an email. Wait a minute before asking for another. | Tocmai ți-am trimis un email. Așteaptă un minut înainte să ceri altul. | On vient de t'envoyer un e-mail. Attends une minute avant d'en demander un autre. | Te acabamos de enviar un correo. Espera un minuto antes de pedir otro. | Ti abbiamo appena inviato un'email. Aspetta un minuto prima di chiederne un'altra. |
| Auth `same_password` | `samePassword` | Your new password must be different from the old one. | Parola nouă trebuie să fie diferită de cea veche. | Ton nouveau mot de passe doit être différent de l'ancien. | Tu contraseña nueva tiene que ser distinta de la anterior. | La nuova password deve essere diversa da quella vecchia. |
| OAuth callback failed / cancelled | `oauthFailed` | Couldn't sign you in with that account. Try again. | Nu te-am putut conecta cu acel cont. Încearcă din nou. | Impossible de te connecter avec ce compte. Réessaie. | No hemos podido iniciar sesión con esa cuenta. Inténtalo de nuevo. | Non siamo riusciti a farti accedere con quell'account. Riprova. |

## Image upload errors (docs/boolaa-spec.md, "Images")

Web keys `errors.imageTooLarge` / `errors.imageUnsupported`; iOS `UserFacingError.imageTooLarge` / `.imageUnsupported`; Android `error_image_too_large` / `error_image_unsupported`.

| Source | key | en | ro | fr | es | it |
|---|---|---|---|---|---|---|
| Input above 50 MB or output above the bucket limit; Storage `statusCode` 413 / `EntityTooLarge` | `imageTooLarge` | That photo is too large. Pick a smaller one. | Fotografia e prea mare. Alege una mai mică. | Cette photo est trop lourde. Choisis-en une plus petite. | Esa foto es demasiado grande. Elige una más pequeña. | Questa foto è troppo grande. Scegline una più piccola. |
| File can't be decoded (e.g. HEIC in Chrome, not an image); Storage `statusCode` 415 / `invalid_mime_type` | `imageUnsupported` | We can't read that image. Try a different photo. | Nu putem citi această imagine. Încearcă altă fotografie. | Impossible de lire cette image. Essaie une autre photo. | No podemos leer esa imagen. Prueba con otra foto. | Non riusciamo a leggere questa immagine. Prova con un'altra foto. |

## Chat (docs/boolaa-spec.md, "Chat")

Web keys under `chat.*` (`errors.chatMessageGone`); iOS and Android use the same English texts as keys / `chat_*` resource names.

| key | en | ro | fr | es | it |
|---|---|---|---|---|---|
| `deleted` (placeholder) | This message was deleted | Mesajul a fost șters | Ce message a été supprimé | Este mensaje se ha eliminado | Questo messaggio è stato eliminato |
| `deleteMessage` (menu) | Delete message | Șterge mesajul | Supprimer le message | Eliminar mensaje | Elimina messaggio |
| `deleteConfirmTitle` | Delete this message? | Ștergi mesajul? | Supprimer ce message ? | ¿Eliminar este mensaje? | Eliminare questo messaggio? |
| `deleteConfirmBody` | It disappears for everyone in the bubble. | Dispare pentru toți cei din bulă. | Il disparaît pour tout le monde dans la bulle. | Desaparece para todos en la burbuja. | Sparisce per tutti nella bolla. |
| `deleteConfirm` (button) | Delete | Șterge | Supprimer | Eliminar | Elimina |
| `newMessages` (divider) | New messages | Mesaje noi | Nouveaux messages | Mensajes nuevos | Nuovi messaggi |
| `loadingOlder` | Loading older messages… | Se încarcă mesajele mai vechi… | Chargement des anciens messages… | Cargando mensajes anteriores… | Caricamento dei messaggi precedenti… |
| `chatStart` | That's the start of the chat | Aici începe chatul | C'est le début de la discussion | Aquí empieza el chat | Qui inizia la chat |
| `addPhoto` | Add a photo | Adaugă o fotografie | Ajouter une photo | Añadir una foto | Aggiungi una foto |
| `removePhoto` | Remove photo | Elimină fotografia | Retirer la photo | Quitar la foto | Rimuovi la foto |
| `photo` (label, Home preview) | Photo | Fotografie | Photo | Foto | Foto |
| `unread` (badge label) | {count, plural, one {# unread message} other {# unread messages}} | {count, plural, one {# mesaj necitit} few {# mesaje necitite} other {# de mesaje necitite}} | {count, plural, one {# message non lu} other {# messages non lus}} | {count, plural, one {# mensaje sin leer} other {# mensajes sin leer}} | {count, plural, one {# messaggio non letto} other {# messaggi non letti}} |
| `chatMessageGone` (error `message not found`) | That message no longer exists. | Mesajul nu mai există. | Ce message n'existe plus. | Ese mensaje ya no existe. | Questo messaggio non esiste più. |

The badge shows the number up to 99 and "99+" above (the server caps the count at 100).

## Marketplace availability and calendar (docs/boolaa-spec.md, "Marketplace availability", "Add to calendar")

Web keys under `market.*` / `events.addToCalendar`; iOS uses the English text as the key; Android `market_*` / `events_*` resources. `{name}` is the owner's name, `{title}` the item title (user content, not translated).

| key | en | ro | fr | es | it |
|---|---|---|---|---|---|
| `availability` (form label) | Availability | Disponibilitate | Disponibilité | Disponibilidad | Disponibilità |
| `available` | Available | Disponibil | Disponible | Disponible | Disponibile |
| `reserved` (badge) | Reserved | Rezervat | Réservé | Reservado | Prenotato |
| `taken` (badge) | Taken | Luat | Parti | Entregado | Preso |
| `hideTaken` (filter chip) | Hide taken | Ascunde ce e luat | Masquer ce qui est parti | Ocultar entregados | Nascondi presi |
| `markAs` (owner menu) | Mark as | Marchează ca | Marquer comme | Marcar como | Segna come |
| `askInChat` (button) | Ask in chat | Întreabă în chat | Demander dans la discussion | Preguntar en el chat | Chiedi in chat |
| `askDraft` (prefilled, unsent) | @{name}, is “{title}” still available? | @{name}, mai e disponibil „{title}”? | @{name}, « {title} » est toujours disponible ? | @{name}, ¿sigue disponible «{title}»? | @{name}, «{title}» è ancora disponibile? |
| `addToCalendar` | Add to calendar | Adaugă în calendar | Ajouter au calendrier | Añadir al calendario | Aggiungi al calendario |
| iOS calendar usage string | Boolaa adds the events you pick to your calendar. | Boolaa adaugă în calendarul tău evenimentele pe care le alegi. | Boolaa ajoute à ton calendrier les événements que tu choisis. | Boolaa añade a tu calendario los eventos que elijas. | Boolaa aggiunge al tuo calendario gli eventi che scegli. |
| iOS: calendar unavailable | Allow calendar access in Settings to add events. | Permite accesul la calendar din Setări ca să adaugi evenimente. | Autorise l'accès au calendrier dans Réglages pour ajouter des événements. | Permite el acceso al calendario en Ajustes para añadir eventos. | Consenti l'accesso al calendario nelle Impostazioni per aggiungere eventi. |
| Android: no calendar app | No calendar app found. | Nu am găsit nicio aplicație de calendar. | Aucune application de calendrier trouvée. | No se ha encontrado ninguna app de calendario. | Nessuna app di calendario trovata. |

"Taken" means given away or traded, not sold (items are free or traded), hence es "Entregado" rather than "Vendido". These were drafted by AI like the rest and are in the native-speaker review.


## Reactions and link previews (docs/boolaa-spec.md, "Reactions", "Link previews")

Web keys under `reactions.*` and `links.previewLoading`; Android `reaction_*` (plurals `reaction_chip`) and `link_preview_loading`; iOS the same English texts. The reaction names are also the accessibility labels of the emoji. Errors from `toggle_reaction` use the generic error.

| key | en | ro | fr | es | it |
|---|---|---|---|---|---|
| `like` | Like | Îmi place | J'aime | Me gusta | Mi piace |
| `love` | Love | Ador | J'adore | Me encanta | Adoro |
| `laugh` | Haha | Haha | Haha | Jaja | Ahah |
| `wow` | Wow | Uau | Waouh | Guau | Wow |
| `sad` | Sad | Trist | Triste | Triste | Triste |
| `thanks` | Thanks | Mulțumesc | Merci | Gracias | Grazie |
| `addReaction` | Add a reaction | Adaugă o reacție | Ajouter une réaction | Añadir una reacción | Aggiungi una reazione |
| `react` (menu) | React | Reacționează | Réagir | Reaccionar | Reagisci |
| `chip` | {reaction}: {count, plural, one {# reaction} other {# reactions}} | {reaction}: {count, plural, one {# reacție} few {# reacții} other {# de reacții}} | {reaction} : {count, plural, one {# réaction} other {# réactions}} | {reaction}: {count, plural, one {# reacción} other {# reacciones}} | {reaction}: {count, plural, one {# reazione} other {# reazioni}} |
| `reactedByYou` | You reacted | Ai reacționat | Tu as réagi | Has reaccionado | Hai reagito |
| `linkPreviewLoading` | Loading preview… | Se încarcă previzualizarea… | Chargement de l'aperçu… | Cargando vista previa… | Caricamento dell'anteprima… |

## Roles (docs/boolaa-spec.md, "Roles")

Web keys under `settings.*` and `errors.*`; iOS uses the English text as the key; Android `strings_roles.xml` (plus `error_only_owner_can_rotate` / `error_only_owner_can_remove`). "Admin" stays "Admin" in every language (badge). `{name}` is a member's name, `{bubble}` the bubble name (user content).

| key | en | ro | fr | es | it |
|---|---|---|---|---|---|
| admin (badge) | Admin | Admin | Admin | Admin | Admin |
| makeAdmin | Make admin | Numește admin | Nommer admin | Hacer admin | Rendi admin |
| removeAdmin | Remove admin | Retrage rolul de admin | Retirer le rôle d'admin | Quitar el rol de admin | Togli il ruolo di admin |
| transferOwnership | Transfer ownership | Cedează rolul de proprietar | Céder le rôle de propriétaire | Ceder el rol de propietario | Cedi il ruolo di proprietario |
| transferTitle | Transfer ownership? | Cedezi rolul de proprietar? | Céder le rôle de propriétaire ? | ¿Ceder el rol de propietario? | Cedere il ruolo di proprietario? |
| transferBody ({name}, {bubble}; web wraps name in <strong>) | {name} becomes the owner of {bubble}. You'll lose your owner rights and become an admin: you won't be able to change roles, remove admins or take ownership back unless {name} gives it back. | {name} devine proprietarul bulei {bubble}. Pierzi drepturile de proprietar și devii admin: nu mai poți schimba roluri, elimina admini sau lua înapoi rolul de proprietar decât dacă ți-l cedează {name}. | {name} devient propriétaire de {bubble}. Tu perds tes droits de propriétaire et deviens admin : tu ne pourras plus changer les rôles, retirer des admins ni reprendre la propriété, sauf si {name} te la rend. | {name} pasa a ser propietario de {bubble}. Pierdes tus derechos de propietario y pasas a ser admin: ya no podrás cambiar roles, quitar admins ni recuperar la propiedad, salvo que {name} te la devuelva. | {name} diventa proprietario di {bubble}. Perdi i diritti di proprietario e diventi admin: non potrai più cambiare i ruoli, rimuovere gli admin né riprenderti la proprietà, a meno che {name} non te la restituisca. |
| transferred (notice) | {name} is now the owner. | {name} e acum proprietarul. | {name} est maintenant propriétaire. | {name} ahora es el propietario. | {name} ora è il proprietario. |
| madeAdmin (notice) | {name} is now an admin. | {name} e acum admin. | {name} est maintenant admin. | {name} ahora es admin. | {name} ora è admin. |
| removedAdmin (notice) | {name} is no longer an admin. | {name} nu mai e admin. | {name} n'est plus admin. | {name} ya no es admin. | {name} non è più admin. |
| memberActions (a11y label of the per-member menu) | Manage {name} | Gestionează {name} | Gérer {name} | Gestionar a {name} | Gestisci {name} |
| ownerOnly (CHANGED existing text, shown to plain members under the bubble details) | Only the owner and admins can edit these details. | Doar proprietarul și adminii pot modifica aceste detalii. | Seuls le propriétaire et les admins peuvent modifier ces informations. | Solo el propietario y los admins pueden editar estos datos. | Solo il proprietario e gli admin possono modificare questi dettagli. |
| error onlyOwnerCanRotate (CHANGED text; backend text unchanged: "only the owner can change the invite code") | Only the owner or an admin can change the invite code. | Doar proprietarul sau un admin poate schimba codul de invitație. | Seul le propriétaire ou un admin peut changer le code d'invitation. | Solo el propietario o un admin puede cambiar el código de invitación. | Solo il proprietario o un admin può cambiare il codice di invito. |
| error onlyOwnerCanRemove (CHANGED text; backend text unchanged: "only the owner can remove members") | Only the owner or an admin can remove members. | Doar proprietarul sau un admin poate elimina membri. | Seul le propriétaire ou un admin peut retirer des membres. | Solo el propietario o un admin puede quitar miembros. | Solo il proprietario o un admin può rimuovere membri. |
| error ownerOnlyAction (NEW; backend texts "only the owner can remove admins", "only the owner can transfer ownership", "only the owner can change roles") | Only the owner can do that. | Doar proprietarul poate face asta. | Seul le propriétaire peut faire ça. | Solo el propietario puede hacer eso. | Solo il proprietario può farlo. |

## Data export and theme (docs/boolaa-spec.md, "Data export", "Theme (web)")

Web keys `profile.export*`, `errors.exportRateLimited`, `appearance.*` (web only); Android `profile_export_*` and `error_export_rate_limited` (`strings_export.xml`); iOS the English text as key. The confirmation email names the action `export_data` (`_shared/email/locales/*.json`).

| key | en | ro | fr | es | it |
|---|---|---|---|---|---|
| exportData (button) | Download my data | Descarcă datele mele | Télécharger mes données | Descargar mis datos | Scarica i miei dati |
| exportTitle | Download your data | Descarcă-ți datele | Télécharge tes données | Descarga tus datos | Scarica i tuoi dati |
| exportBody | You get one JSON file with everything Boolaa stores about you: your profile, bubbles, messages, posts, reactions, reports, blocks and settings. Your photos are listed as links that work for 7 days. Keep the file private. | Primești un fișier JSON cu tot ce păstrează Boolaa despre tine: profilul, bulele, mesajele, postările, reacțiile, raportările, blocările și setările. Fotografiile tale apar ca linkuri valabile 7 zile. Păstrează fișierul doar pentru tine. | Tu reçois un fichier JSON avec tout ce que Boolaa conserve sur toi : ton profil, tes bulles, messages, publications, réactions, signalements, blocages et réglages. Tes photos y figurent sous forme de liens valables 7 jours. Garde ce fichier pour toi. | Recibes un archivo JSON con todo lo que Boolaa guarda sobre ti: tu perfil, burbujas, mensajes, publicaciones, reacciones, denuncias, bloqueos y ajustes. Tus fotos aparecen como enlaces válidos durante 7 días. Guarda el archivo solo para ti. | Ricevi un file JSON con tutto ciò che Boolaa conserva su di te: profilo, bolle, messaggi, post, reazioni, segnalazioni, blocchi e impostazioni. Le tue foto sono incluse come link validi per 7 giorni. Tieni il file per te. |
| exportCodeNote | To keep it safe, we'll email you a code first. You can download your data once an hour. | Ca să fie în siguranță, îți trimitem mai întâi un cod pe email. Poți descărca datele o dată pe oră. | Pour ta sécurité, on t'envoie d'abord un code par e-mail. Tu peux télécharger tes données une fois par heure. | Por seguridad, primero te enviamos un código por correo. Puedes descargar tus datos una vez por hora. | Per sicurezza, prima ti mandiamo un codice via email. Puoi scaricare i tuoi dati una volta all'ora. |
| exportCodeSent (web) | Enter the 6-digit code we just emailed you. Your file downloads right after. | Introdu codul din 6 cifre pe care ți l-am trimis pe email. Fișierul se descarcă imediat după. | Saisis le code à 6 chiffres qu'on vient de t'envoyer par e-mail. Le fichier se télécharge juste après. | Introduce el código de 6 dígitos que te acabamos de enviar por correo. El archivo se descarga justo después. | Inserisci il codice di 6 cifre che ti abbiamo appena mandato via email. Il file si scarica subito dopo. |
| exportPreparing | Preparing your data… | Îți pregătim datele… | Préparation de tes données… | Preparando tus datos… | Stiamo preparando i tuoi dati… |
| exportDone | Your data is ready. | Datele tale sunt gata. | Tes données sont prêtes. | Tus datos están listos. | I tuoi dati sono pronti. |
| error `export rate limited` / function `export_rate_limited` (429) → `exportRateLimited` | You can download your data once an hour. Try again later. | Poți descărca datele o dată pe oră. Încearcă din nou mai târziu. | Tu peux télécharger tes données une fois par heure. Réessaie plus tard. | Puedes descargar tus datos una vez por hora. Inténtalo más tarde. | Puoi scaricare i tuoi dati una volta all'ora. Riprova più tardi. |
| email action `export_data` | download a copy of your data | descărcarea unei copii a datelor tale | le téléchargement d'une copie de tes données | descargar una copia de tus datos | il download di una copia dei tuoi dati |
| appearance.title (web) | Appearance | Aspect | Apparence | Apariencia | Aspetto |
| themeSystem / themeLight / themeDark | System / Light / Dark | Sistem / Luminos / Întunecat | Système / Clair / Sombre | Sistema / Claro / Oscuro | Sistema / Chiaro / Scuro |
| appearance.hint | System follows your device's light or dark setting. | Sistem urmează setarea luminos sau întunecat a dispozitivului tău. | Système suit le réglage clair ou sombre de ton appareil. | Sistema sigue el ajuste claro u oscuro de tu dispositivo. | Sistema segue l'impostazione chiara o scura del tuo dispositivo. |

The function's `reauthentication_required` and `session_not_verified` reuse `reauthenticationRequired` / `sessionNotVerified`.

## QA follow-ups: past events, export limit, preview hint, invite page (docs/boolaa-spec.md "Events", "Data export", "Chat")

Web keys `events.pastEvents`, `events.ended`, `events.wentCount`, `errors.eventEnded`, `errors.exportRateLimitedUntil`, `notifications.previewHint`, `invite.goToBoolaa` (web only); Android `events_past`, `events_ended`, plurals `went_count`, `error_event_ended` (`strings_past_events.xml`), `error_export_rate_limited_until`, `notifications_preview_hint`; iOS the English text as key. `{time}` is a locale-formatted time of day, `{bubble}` the current bubble's name (user content; "Boolaa" without a bubble).

| key | en | ro | fr | es | it |
|---|---|---|---|---|---|
| pastEvents | Past events | Evenimente trecute | Événements passés | Eventos pasados | Eventi passati |
| ended (instead of RSVP) | Ended | S-a încheiat | Terminé | Terminado | Concluso |
| wentCount | # person went / # people went (web: =0 Nobody went) | A participat # persoană / Au participat # persoane / Au participat # de persoane | # personne y est allée / # personnes y sont allées | Fue # persona / Fueron # personas | C'è andata # persona / Ci sono andate # persone |
| error `event has ended` → eventEnded | This event has already ended. | Evenimentul s-a încheiat deja. | Cet événement est déjà terminé. | Este evento ya ha terminado. | Questo evento è già finito. |
| exportRateLimitedUntil | You can download your data once an hour. Try again after {time}. | Poți descărca datele o dată pe oră. Încearcă din nou după ora {time}. | Tu peux télécharger tes données une fois par heure. Réessaie après {time}. | Puedes descargar tus datos una vez por hora. Inténtalo de nuevo a partir de las {time}. | Puoi scaricare i tuoi dati una volta all'ora. Riprova dopo le {time}. |
| previewHint (CHANGED: was the seeded "Flatmates") | When off, notifications only say "New message in {bubble}", without names or text. | Când e oprită, notificările spun doar „Mesaj nou în {bubble}”, fără nume sau text. | Désactivé, les notifications disent seulement « Nouveau message dans {bubble} », sans nom ni texte. | Si está desactivada, las notificaciones solo dicen «Nuevo mensaje en {bubble}», sin nombres ni texto. | Se disattivata, le notifiche dicono solo «Nuovo messaggio in {bubble}», senza nomi né testo. |
| goToBoolaa (invalid invite link, web) | Go to Boolaa | Mergi la Boolaa | Aller sur Boolaa | Ir a Boolaa | Vai su Boolaa |

## Accessibility labels (docs/boolaa-spec.md, "Accessibility")

Read by VoiceOver, TalkBack and screen readers on the web; never shown as visible text unless noted. Web keys under `a11y.*`; Android `a11y_*`; iOS the same English texts as keys. Labels are composed with commas (", ") so each platform reads them with a short pause; the existing strings (`avatarOf`, `bubblePhotoOf`, `chat.unread`, reaction `chip`, `reactedByYou`, `deleted`, `available` / `reserved` / `taken`) are reused, not duplicated.

| key | en | ro | fr | es | it |
|---|---|---|---|---|---|
| `skipToContent` (web, visible on focus) | Skip to content | Sari la conținut | Aller au contenu | Saltar al contenido | Vai al contenuto |
| `photoFrom` (a post or chat photo) | Photo from {name} | Fotografie de la {name} | Photo de {name} | Foto de {name} | Foto di {name} |
| `newMessageFrom` (live announcement) | New message from {name} | Mesaj nou de la {name} | Nouveau message de {name} | Nuevo mensaje de {name} | Nuovo messaggio da {name} |
| `codeDigit` (code-entry box) | Digit {index} of {count} | Cifra {index} din {count} | Chiffre {index} sur {count} | Dígito {index} de {count} | Cifra {index} di {count} |
| `opensInNewTab` (web, appended to external links) | opens in a new tab | se deschide într-o filă nouă | s'ouvre dans un nouvel onglet | se abre en una pestaña nueva | si apre in una nuova scheda |
| `mainNavigation` (tab bar / dock) | Main navigation | Navigare principală | Navigation principale | Navegación principal | Navigazione principale |
| `bubbleSwitcher` (switcher chip row) | Your bubbles | Bulele tale | Tes bulles | Tus burbujas | Le tue bolle |
| `currentBubble` (chip state) | Current bubble | Bula curentă | Bulle actuelle | Burbuja actual | Bolla attuale |
| `dismiss` (toast / banner) | Dismiss | Închide | Fermer | Cerrar | Chiudi |
| `openPhoto` (iOS VoiceOver action / Android custom action on a chat photo) | Open photo | Deschide fotografia | Ouvrir la photo | Abrir la foto | Apri la foto |

## Offline and poor network (docs/boolaa-spec.md, "Offline and poor network")

Web keys under `offline.*`; Android `offline_*`; iOS the English text as key. Calm, not alarming: say what is shown, never blame the user. "Not sent — tap to retry" is the apps' label (the whole row is the button); the web shows "Not sent" with a "Try again" button.

| key | en | ro | fr | es | it |
|---|---|---|---|---|---|
| banner | You're offline — showing what you saw last | Ești offline — îți arătăm ce ai văzut ultima dată | Tu es hors ligne — voici ce que tu as vu en dernier | Estás sin conexión — te mostramos lo último que viste | Sei offline — ti mostriamo quello che hai visto l'ultima volta |
| unreachable | Can't reach Boolaa — showing what you saw last | Nu putem contacta Boolaa — îți arătăm ce ai văzut ultima dată | Impossible de joindre Boolaa — voici ce que tu as vu en dernier | No podemos conectar con Boolaa — te mostramos lo último que viste | Non riusciamo a raggiungere Boolaa — ti mostriamo quello che hai visto l'ultima volta |
| backOnline | Back online | Conexiunea a revenit | Connexion rétablie | Conexión recuperada | Connessione ripristinata |
| loadFailed | Couldn't load this. Check your connection and try again. | Nu am putut încărca. Verifică-ți conexiunea și încearcă din nou. | Impossible de charger. Vérifie ta connexion et réessaie. | No se ha podido cargar. Comprueba tu conexión e inténtalo de nuevo. | Impossibile caricare. Controlla la connessione e riprova. |
| staleNotice | Couldn't refresh — showing what you saw last. | Nu am putut actualiza — îți arătăm ce ai văzut ultima dată. | Impossible d'actualiser — voici ce que tu as vu en dernier. | No se ha podido actualizar — te mostramos lo último que viste. | Impossibile aggiornare — ti mostriamo quello che hai visto l'ultima volta. |
| retry | Try again | Încearcă din nou | Réessayer | Reintentar | Riprova |
| sending | Sending… | Se trimite… | Envoi en cours… | Enviando… | Invio in corso… |
| notSentTapToRetry (apps) | Not sent — tap to retry | Nu s-a trimis — atinge ca să încerci din nou | Non envoyé — touche pour réessayer | No enviado — toca para reintentar | Non inviato — tocca per riprovare |
| notSent (web) | Not sent | Nu s-a trimis | Non envoyé | No enviado | Non inviato |
| discard | Don't send | Nu trimite | Ne pas envoyer | No enviar | Non inviare |

## Brand redesign: empty states and cheers (docs/design-system.md §8.4)

**Needs native-speaker review** (drafted by AI, like the first translations). Empty states pair the curious mascot with a short title (up to 3 words) and one warm line that invites an action; cheers go with the cheering mascot and use one exclamation mark at most. Load errors keep their plain wording ("Couldn't load this…"): the mascot changes, the voice doesn't. Keys are the web's `messages/*.json`; iOS and Android use the same texts. `{bubble}` is the bubble's name (user content, never translated).

| Where | key | en | ro | fr | es | it |
|---|---|---|---|---|---|---|
| Home feed empty | `home.emptyTitle` | Nothing new yet | Nimic nou încă | Rien de neuf | Nada nuevo aún | Niente di nuovo |
| Home feed empty | `home.emptyHint` | Be the first: say hi, plan something or share a snack. | Fii primul: salută, plănuiește ceva sau împarte o gustare. | Lance-toi : dis bonjour, organise quelque chose ou partage un snack. | Sé el primero: saluda, planea algo o comparte algo de picar. | Inizia tu: saluta, organizza qualcosa o condividi uno spuntino. |
| Chat, no messages | `chat.emptyTitle` | Say hi! | Spune salut! | Dis bonjour ! | ¡Saluda! | Saluta! |
| Chat, no messages | `chat.emptyHint` | Nobody's talked yet. Break the ice. | Nimeni n-a scris încă. Sparge gheața. | Personne n'a encore écrit. Brise la glace. | Nadie ha escrito todavía. Rompe el hielo. | Nessuno ha ancora scritto. Rompi il ghiaccio. |
| Events, none at all | `events.emptyTitle` | Quiet week… | Săptămână liniștită… | Semaine calme… | Semana tranquila… | Settimana tranquilla… |
| Events, none at all | `events.emptyHint` | Plan the next thing and your bubble can join in. | Plănuiește următorul lucru și bula ta ți se poate alătura. | Organise la prochaine sortie et ta bulle pourra se joindre à toi. | Planea lo próximo y tu burbuja podrá apuntarse. | Organizza la prossima uscita e la tua bolla potrà unirsi. |
| Events, “My events” empty | `events.emptyMineTitle` | Got a plan? | Ai un plan? | Une idée ? | ¿Algún plan? | Hai un piano? |
| Events, “My events” empty | `events.emptyMine` | Dinner, a hike, a film night: start something. | O cină, o drumeție, o seară de film: pornește ceva. | Un dîner, une rando, une soirée film : lance quelque chose. | Una cena, una excursión, una noche de cine: organiza algo. | Una cena, un'escursione, una serata film: organizza qualcosa. |
| Events, “Bubble events” empty | `events.emptyOthersTitle` | Quiet week… | Săptămână liniștită… | Semaine calme… | Semana tranquila… | Settimana tranquilla… |
| Events, “Bubble events” empty | `events.emptyOthers` | Nobody else has planned anything yet. | Nimeni altcineva n-a plănuit nimic încă. | Personne d'autre n'a encore rien prévu. | Nadie más ha planeado nada todavía. | Nessun altro ha ancora organizzato nulla. |
| Food Circle, nothing at all | `food.emptyTitle` | Empty table | Masa e goală | Table vide | Mesa vacía | Tavola vuota |
| Food Circle, nothing at all | `food.emptyHint` | Leftovers? Cooked too much? Snap it and share it. | Ți-au rămas resturi? Ai gătit prea mult? Fă o poză și împarte. | Des restes ? Tu as trop cuisiné ? Prends une photo et partage. | ¿Te han sobrado cosas? ¿Cocinaste de más? Hazle una foto y compártelo. | Avanzi? Hai cucinato troppo? Scatta una foto e condividilo. |
| Food, “My posts” empty | `food.emptyMineTitle` | Got leftovers? | Ai resturi? | Des restes ? | ¿Te ha sobrado algo? | Hai avanzi? |
| Food, “My posts” empty | `food.emptyMine` | Share what you've got before it goes off. | Împarte ce ai înainte să se strice. | Partage ce que tu as avant que ça se perde. | Comparte lo que tienes antes de que se eche a perder. | Condividi quello che hai prima che vada a male. |
| Food, “From the bubble” empty | `food.emptyOthersTitle` | Nothing shared yet | Nimic împărțit încă | Rien de partagé | Nada compartido aún | Niente di condiviso |
| Food, “From the bubble” empty | `food.emptyOthers` | When someone shares food, it lands here. | Când cineva împarte mâncare, apare aici. | Quand quelqu'un partage à manger, ça arrive ici. | Cuando alguien comparta comida, aparecerá aquí. | Quando qualcuno condivide del cibo, lo trovi qui. |
| Marketplace empty | `market.emptyTitle` | Empty stall | Tarabă goală | Stand vide | Puesto vacío | Bancarella vuota |
| Marketplace empty | `market.emptyHint` | Got something you don't need? Give it away or trade it. | Ai ceva de care nu mai ai nevoie? Dă-l sau schimbă-l. | Un truc dont tu n'as plus besoin ? Donne-le ou échange-le. | ¿Tienes algo que ya no necesitas? Regálalo o intercámbialo. | Hai qualcosa che non ti serve? Regalalo o scambialo. |
| Links empty | `links.emptyTitle` | Nothing saved yet | Nimic salvat încă | Rien d'enregistré | Nada guardado aún | Niente di salvato |
| Links empty | `links.emptyHint` | Recipes, playlists, that one article: keep them here. | Rețete, playlisturi, articolul ăla: păstrează-le aici. | Recettes, playlists, cet article-là : garde-les ici. | Recetas, listas de reproducción, ese artículo: guárdalos aquí. | Ricette, playlist, quell'articolo: tienili qui. |
| RSVP confirmed | `cheer.going` | You're going! | Participi! | Tu participes ! | ¡Vas a ir! | Ci sei! |
| first event saved | `cheer.firstEvent` | Your first event is up! | Primul tău eveniment e gata! | Ton premier événement est en ligne ! | ¡Tu primer evento ya está! | Il tuo primo evento è online! |
| first food post saved | `cheer.firstPost` | First post shared! | Prima postare e gata! | Premier post partagé ! | ¡Primera publicación compartida! | Primo post condiviso! |
| first market item saved | `cheer.firstItem` | First item listed! | Primul anunț e publicat! | Premier objet en ligne ! | ¡Primer artículo publicado! | Primo oggetto pubblicato! |
| admitted to a bubble (Home, once) | `cheer.joined` | You're in. Say hi to {bubble}! | Ai intrat. Salută-i pe cei din {bubble}! | Tu es dedans. Dis bonjour à {bubble} ! | Ya estás dentro. ¡Saluda a {bubble}! | Sei dentro. Saluta {bubble}! |

### Dock short labels (`nav.dock.*`, all clients)

| key | en | ro | fr | es | it |
|---|---|---|---|---|---|
| home | Home | Acasă | Accueil | Inicio | Home |
| events | Events | Agendă | Agenda | Eventos | Eventi |
| food | Food | Mâncare | Repas | Comida | Cibo |
| marketplace | Market | Piață | Marché | Mercado | Mercato |
| settings | Settings | Setări | Réglages | Ajustes | Opzioni |

Short on purpose: they must fit the active dock pill at 390 px. Needs native review with the rest.

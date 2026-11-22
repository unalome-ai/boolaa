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
| leave bubble | Leave bubble | Părăsește bula | Quitter la bulle | Salir de la burbuja | Lascia la bolla |
| RSVP / Going | RSVP / Going | Particip | Je participe | Voy | Ci sono |
| Free / Trade (item status) | Free / Trade | Gratuit / Schimb | Gratuit / Échange | Gratis / Intercambio | Gratis / Scambio |
| Sign in / Sign out | Sign in / Sign out | Autentificare / Deconectare | Se connecter / Se déconnecter | Iniciar sesión / Cerrar sesión | Accedi / Esci |
| Create account | Create account | Creează cont | Créer un compte | Crear cuenta | Crea account |
| Profile | Profile | Profil | Profil | Perfil | Profilo |
| Language | Language | Limbă | Langue | Idioma | Lingua |

Language names in the picker are shown in their own language: English, Română, Français, Español, Italiano.

## Rules
- **Plurals** use real plural rules, never "item(s)". Romanian has the forms one, few and other ("1 membru", "2 membri", "20 de membri"). French uses the singular for 0 and 1.
- **Dates, times and numbers** are formatted with the active locale (`Intl` on the web, `FormatStyle` / `Date.FormatStyle` on iOS), never with hard-coded formats. For relative times use `Intl.RelativeTimeFormat` or `RelativeDateTimeFormatter`.
- **Backend errors**: map the RPC exception texts `invalid invite code`, `already a member`, `bubble is full`, `not a member of this bubble`, `request not found` and `event not found`, and the RLS/network failures, to translated messages. Fall back to a generic translated error and never show raw English from Postgres.

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

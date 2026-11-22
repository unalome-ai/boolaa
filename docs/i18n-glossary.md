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

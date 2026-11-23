// Unit tests of the shared email renderer's localized plurals. No local stack needed:
//
//   deno test -A --no-check supabase/tests/email_render_unit.test.ts
import { render } from "../functions/_shared/email/render.ts";

function assertEq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

const expiry = (locale: string, minutes?: string) =>
  render({ locale, template: "magiclink", code: "123456", vars: minutes ? { minutes } : {} }).text
    .split("\n").find((l) => /\d+ (de )?min/.test(l));

Deno.test("email: code_expiry follows each language's plural rules", () => {
  assertEq(expiry("en"), "The code works for 10 minutes.", "en default 10");
  assertEq(expiry("en", "1"), "The code works for 1 minute.", "en one");
  assertEq(expiry("ro"), "Codul e valabil 10 minute.", "ro few (10)");
  assertEq(expiry("ro", "1"), "Codul e valabil 1 minut.", "ro one");
  assertEq(expiry("ro", "20"), "Codul e valabil 20 de minute.", "ro other (20)");
  assertEq(expiry("fr", "1"), "Le code est valable 1 minute.", "fr one");
  assertEq(expiry("fr", "15"), "Le code est valable 15 minutes.", "fr other");
  assertEq(expiry("es"), "El código es válido durante 10 minutos.", "es other");
  assertEq(expiry("it", "1"), "Il codice è valido per 1 minuto.", "it one");
  assertEq(expiry("it"), "Il codice è valido per 10 minuti.", "it other");
});

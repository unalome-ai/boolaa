// Prints a new VAPID key pair (base64url) for VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
//   deno run supabase/functions/push-dispatch/gen-vapid.ts
// The public key is what clients pass to PushManager.subscribe({ applicationServerKey }).
import { b64urlEncode } from "./jwt.ts";

const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
console.log(`VAPID_PUBLIC_KEY=${b64urlEncode(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);

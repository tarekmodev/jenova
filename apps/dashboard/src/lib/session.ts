/**
 * Cookie names shared by the middleware, the BFF route handlers and the
 * server-side api client. The session cookie carries the realm-tagged
 * opaque token EXACTLY as the api issued it (`tenant_staff.<secret>`) —
 * httpOnly, never readable by page script; revocation lives server-side.
 */

export const SESSION_COOKIE = "jenova_staff_session";
export const LOCALE_COOKIE = "jenova_locale";

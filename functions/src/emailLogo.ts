/**
 * Nightowl owl mark for email.
 *
 * Hosted PNG, not a data URI and not SVG. All three were tried:
 *
 *  - SVG is stripped outright by Gmail, Outlook and Apple Mail.
 *  - Data URI is blocked by Gmail, which is why the logo did not appear in
 *    testing. Outlook on Windows ignores them too.
 *  - Hosted PNG is the only form that renders across clients. Gmail proxies it
 *    through googleusercontent rather than blocking it, and clients that defer
 *    remote images still show it once the reader opts in.
 *
 * The asset is the solid silhouette recoloured to brand brown with cream eyes,
 * rendered at 3x the display width for retina and quantised to 32 colours
 * (4.7KB). Source: planning/brand/nightowl-header-mark-solid-black-on-white.svg
 *
 * Served from Firebase Hosting, so it ships with any `firebase deploy --only
 * hosting`. If the file moves the header breaks silently, and the alt text is
 * all the reader would see.
 */
export const OWL_MARK_URL = "https://nightowl-woodworks.web.app/brand/owl-mark-email.png";

/** Display width in px. The asset is rendered at 3x this for retina. */
export const OWL_MARK_WIDTH = 132;
export const OWL_MARK_HEIGHT = 89;

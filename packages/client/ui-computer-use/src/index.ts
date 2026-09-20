/**
 * Computer Use settings-section plugin, node half. The empty apply exists so
 * the plugin appears in the Host cordis.yml / Loader; the browser half ships
 * the top-level Computer Use settings section through exports["./client"],
 * discovered from the package.json dsh.client declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}

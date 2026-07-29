# vendor/

Third-party code committed directly, with no build step.

## pdf-lib.esm.js

- **Version:** 1.17.1
- **Source:** https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.esm.js
- **Licence:** MIT (Andrew Dillon)

Vendored rather than loaded from a CDN because `esm.sh` proved unreliable from the
development machine — it returned HTTP 200 with an empty body once, then connection
timeouts. A PDF export button that intermittently fails to load its library is worse
than 1.5 MB in git.

The trailing `sourceMappingURL` comment is stripped; the `.map` file is not vendored
and would 404 in devtools.

To update, download the same path at the new version and re-strip the sourcemap line.

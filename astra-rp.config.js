/**
 * `astra-rp create-version` configuration of `@astra-kit/cleaner`: validate with
 * `npm run ci`, then publish to npm from the `release.yml` workflow through npm
 * trusted publishing (OIDC), so no npm token is stored in the repository.
 *
 * @module astra-rp.config
 */

/** @type {import("@astra-kit/rp/create-version").CreateVersionConfig} */
export default {
  releaseTypeDescriptions: {
    patch: "Solo arreglos o cambios internos; la API pública y la CLI no cambian.",
    minor: "Limpiezas u opciones nuevas compatibles; lo existente sigue funcionando igual.",
    major: "Cambio incompatible en la API pública o en el comportamiento de la CLI.",
  },
  checks: ["npm run ci"],
  publish: "npm",
  publication: { authentication: "oidc" },
  releaseTimeZone: "America/Argentina/Buenos_Aires",
  changelogDraft: true,
  summary: ["Consumidores: pnpm add -D @astra-kit/cleaner@^{version}"],
};

/** GitHub Actions workflow used by create-version. */
export const ci = {"workflow":"release.yml","secrets":[],"variables":[],"deployment":null};

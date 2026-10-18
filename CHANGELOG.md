# Changelog

Todos los cambios relevantes de `@astra-kit/cleaner` se documentan en este archivo, según [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

## [0.2.0] - 2026-10-18

### Changed

- La limpieza `playwright` reúne las mejoras de las copias de TuTribu, beez-ui y agenda-mensual: solo considera ejecutables cuyo nombre es uno de los de WebKit, conserva los procesos con PID, padre o ruta desconocidos y consulta en WMI solo las propiedades necesarias y, si hay procesos de WebKit, únicamente los PIDs de sus padres.
- Los avisos de error incluyen el código del error (por ejemplo, `EPERM` para un proceso trabado en terminación).

## [0.1.0] - 2026-10-18

### Added

- Limpieza `playwright`: cierra en Windows los procesos de WebKit de Playwright (`Playwright.exe`, `WebKitGPUProcess.exe`, `WebKitNetworkProcess.exe`, `WebKitWebProcess.exe`) que quedaron huérfanos de una corrida abortada.
- Entradas `@astra-kit/cleaner/playwright/global-setup` y `@astra-kit/cleaner/playwright/global-teardown` para `playwright.config`.
- CLI `cleaner playwright [--dry-run]`, que no hace nada fuera de Windows.

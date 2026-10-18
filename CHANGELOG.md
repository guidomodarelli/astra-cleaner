# Changelog

Todos los cambios relevantes de `@astra-kit/cleaner` se documentan en este archivo, según [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

## [0.3.0] - 2026-10-18

### Added

- Limpieza `worktrees` (`@astra-kit/cleaner/worktrees` y `cleaner worktrees <ruta>... [--force] [--dry-run]`): borra worktrees de git aunque `git worktree remove` falle por rutas largas en `node_modules`, y también la carpeta que deja un `git worktree remove` fallido. Conserva la rama y nunca borra el worktree principal, uno bloqueado ni la carpeta actual; con cambios sin commitear, solo con `--force`.

### Changed

- La CLI acepta rutas y opciones propias de cada limpieza, y termina con código `1` cuando una limpieza deja algo sin limpiar.

## [0.2.0] - 2026-10-18

### Changed

- La limpieza `playwright` reúne las mejoras de las copias de TuTribu, beez-ui y agenda-mensual: solo considera ejecutables cuyo nombre es uno de los de WebKit, conserva los procesos con PID, padre o ruta desconocidos y consulta en WMI solo las propiedades necesarias y, si hay procesos de WebKit, únicamente los PIDs de sus padres.
- Después de cerrar un proceso, la limpieza espera (hasta 10 segundos) a que esa misma instancia termine de verdad; los que siguen trabados en terminación se informan aparte, en `stillRunningProcessIds`, con un aviso de que pueden seguir bloqueando la carpeta.
- Justo antes de cerrar, la limpieza verifica que cada PID siga siendo el mismo proceso (misma hora de inicio), para no cerrar un proceso ajeno que reutilizó el PID; si no lo puede verificar, no cierra nada y avisa.
- Cada consulta de la espera de terminación se acota al tiempo que queda, así una consulta colgada no la estira más allá de su plazo.
- Los avisos de error incluyen el código del error (por ejemplo, `EPERM` para un proceso trabado en terminación).

## [0.1.0] - 2026-10-18

### Added

- Limpieza `playwright`: cierra en Windows los procesos de WebKit de Playwright (`Playwright.exe`, `WebKitGPUProcess.exe`, `WebKitNetworkProcess.exe`, `WebKitWebProcess.exe`) que quedaron huérfanos de una corrida abortada.
- Entradas `@astra-kit/cleaner/playwright/global-setup` y `@astra-kit/cleaner/playwright/global-teardown` para `playwright.config`.
- CLI `cleaner playwright [--dry-run]`, que no hace nada fuera de Windows.

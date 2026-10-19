# @golfo/cleaner

Limpiezas del entorno de desarrollo, una por dominio. Cada limpieza es independiente (no depende de las otras ni de paquetes de terceros), tiene su decisión pura testeada, un modo `--dry-run` y no hace nada en las plataformas donde no aplica.

| Dominio | Exportación | Subcomando | Plataformas |
| --- | --- | --- | --- |
| Procesos huérfanos de WebKit de Playwright | `@golfo/cleaner/playwright` | `cleaner playwright` | Windows |
| Worktrees de git con rutas largas en `node_modules` | `@golfo/cleaner/worktrees` | `cleaner worktrees` | Todas |

## Instalación

```bash
pnpm add -D @golfo/cleaner
```

Requiere Node.js 20 o superior.

## Playwright: procesos huérfanos de WebKit

### Por qué existe

En Windows, terminar un proceso no termina a sus hijos. Cuando una corrida de Playwright muere de golpe (el timeout de la herramienta de un agente, una terminal cerrada, `TerminateProcess`), `globalTeardown` nunca se ejecuta y los procesos de WebKit (`Playwright.exe`, `WebKitGPUProcess.exe`, `WebKitNetworkProcess.exe` y `WebKitWebProcess.exe`, bajo `%LOCALAPPDATA%\ms-playwright\webkit-*`) siguen vivos sin padre.

La causa raíz combina tres cosas:

- **Los navegadores heredan el directorio de trabajo del worker** que los lanza, es decir, la carpeta del repositorio o del worktree. Playwright no expone una opción para lanzarlos con otro `cwd`.
- **En Windows los hijos no mueren con el padre.** Quien mata el runner con `TerminateProcess` (una herramienta con timeout, un agente, el administrador de tareas) termina solo ese proceso, no su árbol.
- **Nada del runner llega a ejecutarse**: ni `globalTeardown` ni los handlers de `exit` o `SIGINT` corren ante `TerminateProcess`.

Así quedan procesos de WebKit sin padre que mantienen bloqueada la carpeta: un worktree no se puede borrar hasta que terminan. La solución robusta sería lanzar el árbol dentro de un [Job Object](https://learn.microsoft.com/windows/win32/procthread/job-objects) con `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, que Windows cierra entero cuando muere su dueño, pero Node no expone Job Objects. Por eso la limpieza barre los huérfanos al empezar la siguiente corrida (`globalSetup`) y al terminar la actual (`globalTeardown`).

En macOS y Linux el navegador se lleva a sus descendientes consigo, así que ahí la limpieza no hace nada.

### Qué cierra y qué no

Un proceso se cierra solo cuando se cumplen las dos condiciones:

1. Es `Playwright.exe`, `WebKitGPUProcess.exe`, `WebKitNetworkProcess.exe` o `WebKitWebProcess.exe` y su ejecutable está dentro de una carpeta `ms-playwright` (sin importar mayúsculas ni separadores). Un WebKit instalado por otro programa nunca se toca.
2. Su padre ya no existe, o el PID del padre fue reutilizado por un proceso más nuevo que el hijo (Windows reutiliza PIDs), o el padre es un `Playwright.exe` huérfano que se cierra en la misma pasada (sus helpers no esperan a la próxima corrida).

Reglas de seguridad:

- Un proceso con el padre vivo pertenece a una corrida en curso, posiblemente de otra sesión, y **nunca** se cierra.
- Si no se conoce la hora de inicio del padre o del hijo, se asume que el padre está vivo y el proceso **no** se cierra. Lo mismo si Windows no informa el PID, el PID del padre o la ruta del ejecutable.
- Los errores al leer la lista o al cerrar un proceso (por ejemplo, uno trabado en terminación) se informan como aviso, con la operación, el PID y el código de error, y nunca rompen la corrida de tests.

Consulta: una sola llamada a PowerShell, con la ventana oculta y un timeout de 30 segundos, filtra en WMI por nombre de ejecutable (el filtro se arma desde la misma lista de la constante `WEBKIT_EXECUTABLES`) y pide solo las propiedades necesarias. Si no hay procesos de WebKit termina ahí; si los hay, consulta únicamente los PIDs de sus padres. Los padres se leen después que los hijos, así que una corrida que arranca en paralelo no se confunde con un huérfano.

Revalidación antes de cerrar: entre la consulta y el cierre, Windows puede reutilizar el PID de un huérfano, y `process.kill` mataría un proceso ajeno. Por eso, justo antes de cerrar, una consulta por lote verifica que cada PID siga siendo la misma instancia (misma hora de inicio). Los que ya no están o cambiaron de identidad no se cierran y cuentan como terminados; los que no se pueden verificar (hora desconocida) quedan corriendo, en `failedProcessIds`, con un aviso. Si la revalidación falla, no se cierra nada y se avisa. Esto achica la ventana de carrera, pero no la elimina.

Espera de terminación: en Windows `process.kill` llama a `TerminateProcess`, que puede volver antes de que el proceso termine si tiene E/S pendiente, y mientras tanto sigue bloqueando la carpeta. Por eso, después de cerrar, la limpieza consulta por lote (cada 250 ms, hasta 10 segundos; cada consulta se acota al tiempo que queda, con un piso de 250 ms, y con el plazo vencido no se consulta más) si sigue corriendo la misma instancia, identificada por PID y hora de inicio para no confundirla con un PID reutilizado. Los que terminan quedan en `terminatedProcessIds`; los que no terminan a tiempo, o cuyo cierre no se pudo confirmar, quedan en `stillRunningProcessIds` con un aviso de que pueden seguir bloqueando la carpeta hasta reiniciar Windows. El `--dry-run` no espera.

No hay handler de `exit` ni de `SIGINT`: un handler de `exit` solo admite código síncrono, ninguno de los dos corre ante `TerminateProcess` (el caso que motiva este paquete) y los workers también cargan el config, así que sumaría una consulta por worker sin cubrir nada.

### En `playwright.config`

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  // Barre los huérfanos de corridas abortadas anteriores y los de esta corrida.
  globalSetup: "@golfo/cleaner/playwright/global-setup",
  globalTeardown: "@golfo/cleaner/playwright/global-teardown",
});
```

Playwright resuelve esos especificadores con `require.resolve` desde la carpeta del config y llama a cada entrada con su config, que la limpieza ignora (no lo toma como opciones). Si el config ya tiene su propio `globalSetup`, pasá una lista: `globalSetup: ["@golfo/cleaner/playwright/global-setup", "./e2e/setup.ts"]`.

### Desde la terminal

```bash
pnpm exec cleaner playwright --dry-run   # muestra los huérfanos sin cerrarlos
pnpm exec cleaner playwright             # los cierra
```

Fuera de Windows el subcomando informa que no aplica y termina con código 0.

### Desde código

```js
import { cleanOrphanWebKitProcesses, selectOrphanWebKitProcessIds } from "@golfo/cleaner/playwright";

const result = await cleanOrphanWebKitProcesses({ dryRun: true });
// { applies, orphanProcessIds, terminatedProcessIds, stillRunningProcessIds, failedProcessIds }
```

`selectOrphanWebKitProcessIds(webKitProcesses, livingProcesses)` es la decisión pura: recibe los procesos y devuelve los PIDs a cerrar, sin tocar el sistema.

## Worktrees: carpetas que `git worktree remove` no puede borrar

### Por qué existe

En Windows, las rutas dentro de `node_modules` pasan fácilmente el límite de 260 caracteres. `git worktree remove` falla entonces con `Filename too long`, y lo hace a mitad de camino: ya borró el archivo `.git` del worktree y su registro, pero deja la carpeta con `node_modules`. `fs.rmSync` sí maneja esas rutas.

### Qué borra y qué no

`cleaner worktrees <ruta>...` borra la carpeta con `fs.rmSync` y después corre `git worktree prune` desde el worktree principal para quitar el registro. **La rama y sus commits quedan**: solo se borra la carpeta de trabajo.

Borra:

- Un worktree vinculado, sin bloquear y sin cambios sin commitear (incluidos archivos sin seguimiento).
- El resto de un `git worktree remove` fallido: una carpeta sin registro cuyo único contenido es `node_modules`. No se pierde trabajo porque una instalación lo reconstruye.

Nunca borra, ni con `--force`:

- El worktree principal, que contiene el repositorio.
- Un worktree bloqueado con `git worktree lock`.
- La carpeta actual ni una que la contenga.
- Una carpeta que no es un worktree y tiene algo más que `node_modules` (o está vacía, o no se puede leer).

Con cambios sin commitear, o si `git status` no puede leer el worktree, lo conserva salvo con `--force`. Si un proceso mantiene un archivo abierto (`EBUSY`/`EPERM`), avisa y sugiere `cleaner playwright` cuando el culpable es un WebKit huérfano.

### Desde la terminal

```bash
pnpm exec cleaner worktrees ../app-feature --dry-run   # muestra qué borraría
pnpm exec cleaner worktrees ../app-feature ../app-fix  # los borra
pnpm exec cleaner worktrees ../app-wip --force         # descarta cambios sin commitear
```

### Desde código

```js
import { removeWorktrees, decideWorktreeRemoval } from "@golfo/cleaner/worktrees";

const result = await removeWorktrees({ paths: ["../app-feature"], dryRun: true });
// { removedPaths, refused: [{ path, reason }], failed: [{ path, error }] }
```

`decideWorktreeRemoval(input)` es la decisión pura: recibe lo que se sabe de la carpeta y devuelve `remove`, `remove-leftover` o `refuse` con el motivo.

## CLI

```text
cleaner <limpieza> [argumentos] [--dry-run]
cleaner playwright [--dry-run]
cleaner worktrees <ruta>... [--force] [--dry-run]
cleaner --help
```

| Código de salida | Significado |
| --- | --- |
| `0` | Terminó: limpió todo lo pedido, o la limpieza no aplica a la plataforma. La de Playwright siempre termina en `0`, aunque haya emitido avisos. |
| `1` | La limpieza dejó algo sin limpiar: un worktree conservado por una protección o un borrado que falló. |
| `2` | Subcomando, opción o argumentos inválidos. |

## Agregar una limpieza

Cada dominio vive en `src/<dominio>/` con su `index.js` (y `index.d.ts`), se exporta como `@golfo/cleaner/<dominio>` en `package.json` y se registra como subcomando en `src/cli/commands.js`. No importa código de otro dominio. Debe tener:

- una función pura de decisión con tests unitarios;
- un modo `dryRun` que solo informe;
- `appliesTo(platform)`, para que la CLI no haga nada donde no aplica;
- manejo de errores que avise con contexto en lugar de romper.

En `src/cli/commands.js`, el subcomando declara las opciones que acepta además de `--dry-run` (`flags`), si necesita rutas (`requiresPaths`) y cómo se usan (`argumentsUsage`). Su `run` devuelve el código de salida; si no devuelve nada, es `0`.

## Desarrollo

```bash
npm ci
npm run ci   # typecheck, tests y npm pack --dry-run
```

## Publicación

Se publica con [`@golfo/rp`](https://github.com/guidomodarelli/golfo-rp) desde `main`, y el workflow `release.yml` de GitHub Actions publica con [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), sin tokens de npm:

1. Escribir las entradas del release en `## [Unreleased]` de `CHANGELOG.md`, sin versión ni fecha. Si faltan, `changelogDraft` las redacta con Claude Code o Codex.
2. Correr `npm run create-version` (alias `npm run cv`; por ejemplo `npm run cv -- --minor`). El comando corre `npm run ci`, crea el commit `X.Y.Z` (que cierra `[Unreleased]` como `## [X.Y.Z] - AAAA-MM-DD`) y el tag `vX.Y.Z`, los pushea y despacha `release.yml`, que verifica el tag y publica con procedencia.

La configuración vive en `golfo-rp.config.js`. `npm publish` directo queda bloqueado para pnpm, yarn y bun por `golfo-rp guard-publish`.

## Licencia

MIT

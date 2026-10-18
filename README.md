# @astra-kit/cleaner

Limpiezas del entorno de desarrollo, una por dominio. Cada limpieza es independiente (no depende de las otras ni de paquetes de terceros), tiene su decisión pura testeada, un modo `--dry-run` y no hace nada en las plataformas donde no aplica.

| Dominio | Exportación | Subcomando | Plataformas |
| --- | --- | --- | --- |
| Procesos huérfanos de WebKit de Playwright | `@astra-kit/cleaner/playwright` | `cleaner playwright` | Windows |
| Worktrees con `node_modules` (prevista) | `@astra-kit/cleaner/worktrees` | `cleaner worktrees` | — |

## Instalación

```bash
pnpm add -D @astra-kit/cleaner
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

No hay handler de `exit` ni de `SIGINT`: un handler de `exit` solo admite código síncrono, ninguno de los dos corre ante `TerminateProcess` (el caso que motiva este paquete) y los workers también cargan el config, así que sumaría una consulta por worker sin cubrir nada.

### En `playwright.config`

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  // Barre los huérfanos de corridas abortadas anteriores y los de esta corrida.
  globalSetup: "@astra-kit/cleaner/playwright/global-setup",
  globalTeardown: "@astra-kit/cleaner/playwright/global-teardown",
});
```

Playwright resuelve esos especificadores con `require.resolve` desde la carpeta del config y llama a cada entrada con su config, que la limpieza ignora (no lo toma como opciones). Si el config ya tiene su propio `globalSetup`, pasá una lista: `globalSetup: ["@astra-kit/cleaner/playwright/global-setup", "./e2e/setup.ts"]`.

### Desde la terminal

```bash
pnpm exec cleaner playwright --dry-run   # muestra los huérfanos sin cerrarlos
pnpm exec cleaner playwright             # los cierra
```

Fuera de Windows el subcomando informa que no aplica y termina con código 0.

### Desde código

```js
import { cleanOrphanWebKitProcesses, selectOrphanWebKitProcessIds } from "@astra-kit/cleaner/playwright";

const result = await cleanOrphanWebKitProcesses({ dryRun: true });
// { applies, orphanProcessIds, terminatedProcessIds, failedProcessIds }
```

`selectOrphanWebKitProcessIds(webKitProcesses, livingProcesses)` es la decisión pura: recibe los procesos y devuelve los PIDs a cerrar, sin tocar el sistema.

## CLI

```text
cleaner <limpieza> [--dry-run]
cleaner --help
```

| Código de salida | Significado |
| --- | --- |
| `0` | Terminó, aunque la limpieza no aplique a la plataforma o haya emitido avisos. |
| `2` | Subcomando u opción desconocidos. |

## Agregar una limpieza

Cada dominio vive en `src/<dominio>/` con su `index.js` (y `index.d.ts`), se exporta como `@astra-kit/cleaner/<dominio>` en `package.json` y se registra como subcomando en `src/cli/commands.js`. No importa código de otro dominio. Debe tener:

- una función pura de decisión con tests unitarios;
- un modo `dryRun` que solo informe;
- `appliesTo(platform)`, para que la CLI no haga nada donde no aplica;
- manejo de errores que avise con contexto en lugar de romper.

## Desarrollo

```bash
npm ci
npm run ci   # typecheck, tests y npm pack --dry-run
```

## Publicación

Se publica desde GitHub Actions con [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), sin tokens de npm:

1. Actualizar la versión en `package.json` y mover las entradas de `[Unreleased]` en `CHANGELOG.md` a la nueva versión.
2. Commitear en `main`, crear el tag `vX.Y.Z` y pushearlo: el workflow `release.yml` verifica que el tag coincida con la versión y esté en `main`, corre `npm run ci` y publica con procedencia.

## Licencia

MIT

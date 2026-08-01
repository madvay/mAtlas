export function installCacheRecovery(
  browserWindow: Window = window,
  browserDocument: Document = document
): AtlasRecoveryController {
  const parameterName = browserDocument.querySelector<HTMLMetaElement>('meta[name="atlas:cache-bust-param"]')?.content
    || '__atlas_refresh';
  const loadedWithRecoveryParameter = new URL(browserWindow.location.href).searchParams.has(parameterName);
  let reloadStarted = false;
  let terminalFailureScheduled = false;

  const randomValue = (): string => {
    try {
      const values = new Uint32Array(2);
      browserWindow.crypto.getRandomValues(values);
      return `${Date.now().toString(36)}-${values[0]!.toString(36)}${values[1]!.toString(36)}`;
    } catch {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
  };

  const cacheBustedUrl = (): string => {
    const url = new URL(browserWindow.location.href);
    url.searchParams.set(parameterName, randomValue());
    return url.toString();
  };

  const navigateFresh = (): void => {
    reloadStarted = true;
    const target = cacheBustedUrl();
    try {
      browserWindow.location.replace(target);
    } catch {
      browserWindow.location.href = target;
    }
  };

  const reload = (): boolean => {
    if (reloadStarted) return true;
    if (loadedWithRecoveryParameter) return false;
    navigateFresh();
    return true;
  };

  const ready = (): void => {
    if (!loadedWithRecoveryParameter) return;
    const url = new URL(browserWindow.location.href);
    if (!url.searchParams.has(parameterName)) return;
    url.searchParams.delete(parameterName);
    try {
      browserWindow.history.replaceState(browserWindow.history.state, '', url.toString());
    } catch {
      // A successful application load is more important than cosmetic URL cleanup.
    }
  };

  const renderTerminalFailure = (resourceUrl: string): void => {
    if (terminalFailureScheduled) return;
    terminalFailureScheduled = true;
    const render = (): void => {
      if (!browserDocument.body || browserDocument.getElementById('atlas-cache-recovery-error')) return;
      const panel = browserDocument.createElement('section');
      panel.id = 'atlas-cache-recovery-error';
      panel.setAttribute('role', 'alert');
      panel.setAttribute('style', 'position:fixed;z-index:2147483647;inset:1rem auto auto 50%;transform:translateX(-50%);box-sizing:border-box;width:min(44rem,calc(100% - 2rem));padding:1rem 1.1rem;border:1px solid #b91c1c;border-radius:.75rem;background:#fff;color:#172033;box-shadow:0 1rem 3rem rgba(15,23,42,.28);font:16px/1.45 system-ui,sans-serif');
      const heading = browserDocument.createElement('h1');
      heading.setAttribute('style', 'margin:0 0 .5rem;font-size:1.15rem');
      heading.textContent = 'The atlas could not load its current application files';
      const detail = browserDocument.createElement('p');
      detail.setAttribute('style', 'margin:.35rem 0');
      detail.textContent = 'A cache-busting refresh was already attempted, but a required file is still unavailable.';
      const resource = browserDocument.createElement('p');
      resource.setAttribute('style', 'margin:.35rem 0;overflow-wrap:anywhere;color:#475569;font-size:.85rem');
      resource.textContent = resourceUrl;
      const actions = browserDocument.createElement('p');
      actions.setAttribute('style', 'display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin:.8rem 0 0');
      const retry = browserDocument.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Try another fresh reload';
      retry.setAttribute('style', 'padding:.55rem .8rem;border:0;border-radius:.45rem;background:#1e40af;color:#fff;font:inherit;font-weight:700;cursor:pointer');
      retry.addEventListener('click', navigateFresh);
      const directory = browserDocument.createElement('a');
      directory.href = new URL('directory/', new URL('./', browserDocument.baseURI)).toString();
      directory.textContent = 'Open the static directory';
      directory.setAttribute('style', 'color:#1d4ed8;font-weight:650');
      actions.append(retry, directory);
      panel.append(heading, detail, resource, actions);
      browserDocument.body.prepend(panel);
    };
    if (browserDocument.body) render();
    else browserWindow.addEventListener('DOMContentLoaded', render, { once: true });
  };

  const failedCriticalResource = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element) || !target.hasAttribute('data-atlas-critical-asset')) return null;
    let value = '';
    if (target instanceof HTMLScriptElement) value = target.src;
    else if (target instanceof HTMLLinkElement
      && (target.relList.contains('stylesheet') || target.relList.contains('modulepreload'))) value = target.href;
    if (!value) return null;
    const url = new URL(value, browserDocument.baseURI);
    return url.origin === browserWindow.location.origin ? url.toString() : null;
  };

  const controller: AtlasRecoveryController = {
    parameterName,
    reload,
    retry: navigateFresh,
    ready,
    isReloading: () => reloadStarted
  };
  browserWindow.__atlasRecovery = controller;
  browserWindow.addEventListener('error', (event) => {
    const resourceUrl = failedCriticalResource(event.target);
    if (resourceUrl && !reload()) renderTerminalFailure(resourceUrl);
  }, true);
  return controller;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installCacheRecovery();
}

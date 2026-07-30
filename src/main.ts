import 'katex/dist/katex.min.css';
import './styles.css';
import { startAtlasApp } from './app/atlas-app.js';

function showStartupFailure(error: unknown): void {
  console.error(error);
  document.body.classList.remove('atlas-loading');
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  const graph = document.getElementById('graph');
  if (!(graph instanceof HTMLElement)) return;
  graph.setAttribute('role', 'alert');
  graph.replaceChildren();
  const panel = document.createElement('section');
  panel.className = 'startup-error';
  const heading = document.createElement('h2');
  heading.textContent = 'The atlas could not start';
  const detail = document.createElement('p');
  detail.textContent = message;
  const actions = document.createElement('p');
  const retry = document.createElement('button');
  retry.className = 'button primary';
  retry.type = 'button';
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => {
    if (window.__atlasRecovery) window.__atlasRecovery.retry();
    else window.location.reload();
  });
  const directory = document.createElement('a');
  directory.className = 'button';
  directory.href = '/directory/';
  directory.textContent = 'Open static directory';
  actions.append(retry, ' ', directory);
  panel.append(heading, detail, actions);
  graph.append(panel);
}

void startAtlasApp()
  .then(() => window.__atlasRecovery?.ready())
  .catch((error) => {
    if (!window.__atlasRecovery?.isReloading()) showStartupFailure(error);
  });

const REFRESH_MS = 10_000;
const $ = (id) => document.getElementById(id);

const STATUS = {
  active: 'Aguardando',
  opened: 'Aberto pelo cliente',
  connected: 'Conectado',
  expired: 'Expirado',
  revoked: 'Cancelado',
};

const linkUrl = (token) => `${location.origin}/c/${token}`;
const formatDate = (value) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

async function api(path, options) {
  const response = await fetch(path, options);
  if (response.status === 401) {
    location.href = '/login';
    throw new Error('Sessão expirada.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Algo deu errado. Tente novamente.');
  return body;
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

async function copy(text, button) {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = 'Copiado!';
  setTimeout(() => { button.textContent = original; }, 1500);
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function renderRow(link) {
  const status = link.status === 'active' && link.openedAt ? 'opened' : link.status;
  const row = document.createElement('tr');

  const badge = document.createElement('span');
  badge.className = `badge ${status}`;
  badge.textContent = STATUS[status];
  const statusCell = cell('');
  statusCell.append(badge);

  const actions = cell('');
  actions.className = 'actions';
  if (link.status === 'active') {
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'ghost';
    copyButton.textContent = 'Copiar';
    copyButton.addEventListener('click', () => copy(linkUrl(link.token), copyButton));

    const revokeButton = document.createElement('button');
    revokeButton.type = 'button';
    revokeButton.className = 'ghost danger';
    revokeButton.textContent = 'Cancelar';
    revokeButton.addEventListener('click', () => revoke(link));
    actions.append(copyButton, revokeButton);
  }

  row.append(cell(link.label ?? '—'), cell(link.instance), statusCell, cell(formatDate(link.expiresAt)), actions);
  return row;
}

async function loadLinks() {
  const { links } = await api('/api/links');
  $('rows').replaceChildren(...links.map(renderRow));
  $('table').hidden = links.length === 0;
  $('empty').hidden = links.length > 0;
}

async function loadInstances() {
  try {
    const { instances } = await api('/api/instances');
    $('instances').replaceChildren(...instances.map(({ name }) => {
      const option = document.createElement('option');
      option.value = name;
      return option;
    }));
  } catch (error) {
    showError(`${error.message} Você ainda pode digitar o nome da instância.`);
  }
}

async function revoke(link) {
  if (!confirm(`Cancelar o link de ${link.label ?? link.instance}?`)) return;
  try {
    await api(`/api/links/${link.id}`, { method: 'DELETE' });
    await loadLinks();
  } catch (error) {
    showError(error.message);
  }
}

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  try {
    const { link } = await api('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instance: $('instance').value,
        label: $('label').value,
        hours: Number($('hours').value),
      }),
    });
    $('created-url').value = linkUrl(link.token);
    $('created').hidden = false;
    $('instance').value = '';
    $('label').value = '';
    await loadLinks();
  } catch (error) {
    showError(error.message);
  }
});

$('created-copy').addEventListener('click', (event) => copy($('created-url').value, event.currentTarget));

$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login';
});

loadInstances();
loadLinks().catch((error) => showError(error.message));
setInterval(() => loadLinks().catch(() => {}), REFRESH_MS);

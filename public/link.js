const POLL_MS = 2000;
// A Evolution encerra a sessão depois de ~30 QRs. Sem isso, uma aba esquecida
// aberta ficaria abrindo sessões novas para sempre.
const IDLE_LIMIT_MS = 10 * 60 * 1000;

const token = location.pathname.split('/').pop();
const $ = (id) => document.getElementById(id);

let timer = null;
let polling = false;
let paused = false;
let finished = false;
let startedAt = Date.now();

const MESSAGES = {
  waiting: { icon: '⏳', text: 'Gerando o QR Code…' },
  unavailable: { icon: '⏳', text: 'Sem resposta do servidor. Tentando novamente…' },
  offline: { icon: '⏳', text: 'Sem conexão. Tentando novamente…' },
  paused: { icon: '⏸️', text: 'O QR Code foi pausado por inatividade.' },
  connected: { icon: '✅', text: 'WhatsApp conectado! Você já pode fechar esta página.' },
  expired: { icon: '⌛', text: 'Este link expirou. Peça um novo a quem enviou.' },
  revoked: { icon: '🚫', text: 'Este link foi cancelado. Peça um novo a quem enviou.' },
  invalid: { icon: '🚫', text: 'Link inválido. Confira com quem enviou.' },
};
const FINAL = new Set(['connected', 'expired', 'revoked', 'invalid']);

function showMessage(kind) {
  $('view-qr').hidden = true;
  $('view-message').hidden = false;
  $('icon').textContent = MESSAGES[kind].icon;
  $('message').textContent = MESSAGES[kind].text;
  $('resume').hidden = kind !== 'paused';
}

function showQr(src) {
  if ($('qr').src !== src) $('qr').src = src;
  $('view-message').hidden = true;
  $('view-qr').hidden = false;
}

function schedule() {
  clearTimeout(timer);
  if (!finished && !paused && !document.hidden) timer = setTimeout(poll, POLL_MS);
}

async function poll() {
  if (polling || finished || paused || document.hidden) return;

  if (Date.now() - startedAt > IDLE_LIMIT_MS) {
    paused = true;
    showMessage('paused');
    return;
  }

  polling = true;
  try {
    const response = await fetch(`/api/c/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const data = await response.json();

    if (data.label) {
      $('label').textContent = data.label;
      $('label').hidden = false;
    }

    if (data.status === 'qr') {
      showQr(data.qr);
    } else {
      finished = FINAL.has(data.status);
      showMessage(MESSAGES[data.status] ? data.status : 'unavailable');
    }
  } catch {
    showMessage('offline');
  } finally {
    polling = false;
    schedule();
  }
}

$('resume').addEventListener('click', () => {
  paused = false;
  startedAt = Date.now();
  showMessage('waiting');
  poll();
});

// Aba em segundo plano não consulta; ao voltar, atualiza na hora.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(timer);
  else poll();
});

showMessage('waiting');
poll();

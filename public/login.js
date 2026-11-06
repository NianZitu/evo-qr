const error = document.getElementById('error');

document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;

  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: document.getElementById('password').value }),
  });

  if (response.ok) {
    location.href = '/admin';
    return;
  }

  error.textContent = response.status === 429
    ? 'Muitas tentativas. Aguarde alguns minutos.'
    : 'Senha incorreta.';
  error.hidden = false;
});

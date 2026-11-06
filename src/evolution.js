import QRCode from 'qrcode';

const TIMEOUT_MS = 15_000;
// Vários visitantes do mesmo link dividem uma única consulta à Evolution.
const CACHE_MS = 1_000;

export class EvolutionError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createEvolution({ url, apiKey }) {
  const cache = new Map();
  const inFlight = new Map();

  async function request(path) {
    const response = await fetch(`${url}${path}`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new EvolutionError(`Evolution respondeu ${response.status} em ${path}`, response.status);
    }
    // O controller da Evolution captura exceções e devolve { error: true } com HTTP 200.
    if (body?.error) {
      throw new EvolutionError(`Evolution retornou erro em ${path}: ${body.message}`, 500);
    }
    return body;
  }

  async function getState(instanceName) {
    const body = await request(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
    return body?.instance?.state ?? body?.state ?? 'close';
  }

  async function fetchSnapshot(instanceName) {
    const state = await getState(instanceName);
    if (state === 'open') return { state, qr: null };

    // Seguro de repetir: em "connecting" a Evolution só devolve o QR atual.
    // Em "close" ela abre uma nova sessão, por isso só chamamos com alguém na página.
    const body = await request(`/instance/connect/${encodeURIComponent(instanceName)}`);
    if (body?.instance?.state === 'open') return { state: 'open', qr: null };

    const source = body?.qrcode ?? body;
    const qr = source?.base64 ?? (source?.code ? await QRCode.toDataURL(source.code, { margin: 3, scale: 8 }) : null);
    return { state, qr };
  }

  async function getSnapshot(instanceName) {
    const cached = cache.get(instanceName);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.snapshot;

    const pending = inFlight.get(instanceName);
    if (pending) return pending;

    const promise = fetchSnapshot(instanceName)
      .then((snapshot) => {
        cache.set(instanceName, { snapshot, at: Date.now() });
        return snapshot;
      })
      .finally(() => inFlight.delete(instanceName));
    inFlight.set(instanceName, promise);
    return promise;
  }

  async function listInstances() {
    const body = await request('/instance/fetchInstances');
    return (Array.isArray(body) ? body : [])
      .map((item) => ({
        name: item.name ?? item.instance?.instanceName,
        state: item.connectionStatus ?? item.instance?.status ?? null,
      }))
      .filter((item) => item.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return { getState, getSnapshot, listInstances };
}

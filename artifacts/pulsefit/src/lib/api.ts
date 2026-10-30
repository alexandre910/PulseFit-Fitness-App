export const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://shaded-jot-pacify.ngrok-free.dev').replace(/\/$/, '');

export type Cliente = {
  id: number;
  nome: string;
  email: string;
  senha?: string;
  nivelExperiencia?: string;
  sexo?: string;
  idade?: number;
};

export type Treino = { id: number; nome: string; descricao?: string; modalidade?: string; nivel?: string; idUsuario?: number };
export type Exercico = { id: number; nome: string; grupoMuscular?: string; descricao?: string; demonstracaoVideo?: string; modalidade?: string; nivel?: string };
export type RelacaoExercicio = { idTreino: number; idExercicio: number; series?: number; repeticoes?: string | number; carga?: string | number };
export type AgendaItem = { id: number; dataAgendada: string; status: string; idUsuario: number; idTreino: number; liberado: boolean };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.name = 'ApiError'; this.status = status; }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true', ...(init.headers || {}) },
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao PulseFit. Confira sua conexão e tente novamente.', 0);
  }
  const raw = await response.text();
  let payload: any = undefined;
  try { payload = raw ? JSON.parse(raw) : undefined; } catch { payload = undefined; }
  if (!response.ok) {
    const plainText = raw && !raw.trim().startsWith('<') ? raw : '';
    const message = payload?.message || payload?.mensagem || payload?.error || plainText || `A API respondeu com um erro (HTTP ${response.status}).`;
    throw new ApiError(String(message), response.status);
  }
  return payload as T;
}

const CLIENT_KEY = 'pulsefit-cliente';
const QUESTIONNAIRE_KEY = 'pulsefit-questionario-pendente';
export function getCliente(): Cliente | null {
  try { const value = localStorage.getItem(CLIENT_KEY); return value ? JSON.parse(value) as Cliente : null; } catch { return null; }
}
export function saveCliente(cliente: Cliente) {
  const { senha: _senha, ...safeCliente } = cliente;
  localStorage.setItem(CLIENT_KEY, JSON.stringify(safeCliente));
}
export function setQuestionarioPendente(pending: boolean) { localStorage.setItem(QUESTIONNAIRE_KEY, String(pending)); }
export function isQuestionarioPendente() { return localStorage.getItem(QUESTIONNAIRE_KEY) === 'true'; }
export function clearCliente() { localStorage.removeItem(CLIENT_KEY); localStorage.removeItem(QUESTIONNAIRE_KEY); }
export function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.';
}
export const asArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

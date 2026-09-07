/**
 * Perfis de paciente — armazenamento local, e só local.
 *
 * Nome, idade, condição e foto de alguém com ELA são dado de saúde. O termo de
 * privacidade promete que nada disso sai da máquina, e este módulo é o único
 * lugar onde esses dados existem: `localStorage`, sem nenhuma rota de rede.
 */

export const PROFILES_KEY = 'irisflow_profiles';

export interface PerfilLocal {
  id: string;
  name: string;
  age?: number;
  condition?: string;
  /** Data URL redimensionada — nunca um caminho de arquivo, que quebra ao mover a imagem. */
  avatarDataUrl?: string;
  /** ISO 8601. */
  createdAt: string;
}

export type NovoPerfil = Omit<PerfilLocal, 'id' | 'createdAt'>;

function novoId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `perfil-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function listarPerfis(): PerfilLocal[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is PerfilLocal =>
        !!p && typeof p === 'object' && typeof (p as PerfilLocal).id === 'string'
    );
  } catch {
    // Storage corrompido não pode derrubar a tela de seleção de perfil: sem ela
    // o paciente não chega à calibração nem à comunicação.
    return [];
  }
}

function gravar(perfis: PerfilLocal[]): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(perfis));
  } catch {
    // Quota estourada — provavelmente pelas fotos. O perfil vale só nesta sessão.
  }
}

export function criarPerfil(dados: NovoPerfil): PerfilLocal {
  const name = dados.name.trim();
  if (name === '') throw new Error('O perfil precisa de um nome.');

  const perfil: PerfilLocal = {
    id: novoId(),
    name,
    createdAt: new Date().toISOString(),
    ...(dados.age !== undefined ? { age: dados.age } : {}),
    ...(dados.condition && dados.condition.trim() !== ''
      ? { condition: dados.condition.trim() }
      : {}),
    ...(dados.avatarDataUrl ? { avatarDataUrl: dados.avatarDataUrl } : {}),
  };

  gravar([...listarPerfis(), perfil]);
  return perfil;
}

export function removerPerfil(id: string): void {
  gravar(listarPerfis().filter((p) => p.id !== id));
}

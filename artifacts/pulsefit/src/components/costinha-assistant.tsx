import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowRight, Dumbbell, ExternalLink, Mic, MicOff, RotateCcw, Sparkles, X } from 'lucide-react';
import { ApiError, asArray, Exercico, friendlyError, getCliente, request, requestAudio, Treino } from '@/lib/api';
import { useLocation } from 'wouter';

type MessageKind = 'text' | 'topics' | 'actions' | 'groups' | 'workout-level' | 'workout-type' | 'workout-group' | 'workout-period' | 'workout-time' | 'exercises';
type AssistantMessage = { id: number; from: 'assistant' | 'user'; kind: MessageKind; text?: string; group?: string; items?: Exercico[]; error?: boolean };
type Props = { avatarVideoUrl?: string };
type LauncherPosition = { x: number; y: number };
type LauncherDrag = { pointerId: number; startX: number; startY: number; origin: LauncherPosition; moved: boolean };
type VoiceChoice = { label: string; aliases: string[]; run: () => void };
type WorkoutRequest = {
  nivel: 'iniciante' | 'intermediario' | 'avancado';
  tipo?: 'misto' | 'especifico';
  grupo?: 'Perna' | 'Peito' | 'Braco' | 'Costas';
  periodo?: 'manha' | 'tarde' | 'noite';
  horario?: string;
};
type SpeechAlternative = { transcript: string; confidence?: number };
type SpeechResult = ArrayLike<SpeechAlternative>;
type SpeechResultEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechErrorEvent = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const GREETING = 'Olá, como posso ajudá-lo! Sou seu assistente virtual Costinha e ajudo com informação sobre nutrição, musculação ou calistenia.';
const GROUPS = [{ label: 'Peito', api: 'Peito' }, { label: 'Perna', api: 'Perna' }, { label: 'Braço', api: 'Braco' }, { label: 'Costas', api: 'Costas' }];
const POSITION_STORAGE_KEY = 'pulsefit-costinha-position-v2';
const LAUNCHER_SIZE = 58;

function clampLauncherPosition(position: LauncherPosition, width: number, height: number, path: string): LauncherPosition {
  const mobile = width <= 767;
  const edge = mobile ? 14 : 24;
  const bottom = mobile && !['/login', '/cadastro'].includes(path) ? 96 : mobile ? 20 : 24;
  const minX = edge;
  const maxX = Math.max(minX, width - LAUNCHER_SIZE - edge);
  const minY = 12;
  const maxY = Math.max(minY, height - LAUNCHER_SIZE - bottom);
  return {
    x: Math.round(Math.min(maxX, Math.max(minX, position.x))),
    y: Math.round(Math.min(maxY, Math.max(minY, position.y))),
  };
}

function defaultLauncherPosition(width: number, height: number, path: string): LauncherPosition {
  const mobile = width <= 767;
  const edge = mobile ? 14 : 24;
  const authPage = ['/login', '/cadastro'].includes(path);
  if (mobile && authPage) {
    return clampLauncherPosition({ x: width - LAUNCHER_SIZE - edge, y: edge }, width, height, path);
  }
  const bottom = mobile ? 96 : 24;
  return clampLauncherPosition(
    { x: width - LAUNCHER_SIZE - edge, y: height - LAUNCHER_SIZE - bottom },
    width,
    height,
    path,
  );
}

function loadLauncherPosition(path: string): { position: LauncherPosition; customized: boolean } {
  if (typeof window === 'undefined') return { position: { x: 24, y: 24 }, customized: false };
  try {
    const saved = window.localStorage.getItem(POSITION_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<LauncherPosition>;
      if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        return {
          position: clampLauncherPosition({ x: parsed.x!, y: parsed.y! }, window.innerWidth, window.innerHeight, path),
          customized: true,
        };
      }
    }
  } catch { /* Use the safe default when local storage is unavailable or invalid. */ }

  return { position: defaultLauncherPosition(window.innerWidth, window.innerHeight, path), customized: false };
}

function persistLauncherPosition(position: LauncherPosition) {
  try { window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position)); } catch { /* Keep the drag usable if storage is blocked. */ }
}

function records<T,>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['exercicios', 'content', 'data', 'treinos']) if (Array.isArray(object[key])) return object[key] as T[];
  }
  return asArray<T>(value);
}

function videoHref(value?: string) {
  if (!value?.trim()) return undefined;
  const raw = value.trim();
  if (/^[\w-]{11}$/.test(raw)) return `https://www.youtube.com/watch?v=${raw}`;
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw.includes('://') ? raw : `https://${raw}`);
    if (url.hostname === 'youtu.be' || url.hostname.endsWith('.youtu.be')) {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? `https://www.youtube.com/watch?v=${id}` : undefined;
    }
    if (url.hostname.includes('youtube.com')) {
      const id = url.searchParams.get('v') || url.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1];
      return id ? `https://www.youtube.com/watch?v=${id}` : url.href;
    }
    return url.href;
  } catch { return undefined; }
}

function normalized(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function normalizedSpeech(value: string) {
  return normalized(value).replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function parseWorkoutTime(input: string, period: NonNullable<WorkoutRequest['periodo']>): string | null {
  const value = normalized(input).toLowerCase().replace(/[,.!?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  const saidPeriod = value.match(/\b(?:da|de|na|no|a)\s+(manha|tarde|noite)\b/)?.[1] as WorkoutRequest['periodo'] | undefined;
  if (saidPeriod && saidPeriod !== period) return null;

  const hourWords: Record<string, number> = {
    meia: 0.5,
    uma: 1, um: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
    sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  };
  const spokenMinute = (text: string) => {
    if (/\b(?:meia|meio)\b/.test(text)) return 30;
    if (/\b(?:um quarto|quinze|quarto)\b/.test(text)) return 15;
    if (/\bvinte e cinco\b/.test(text)) return 25;
    if (/\bvinte\b/.test(text)) return 20;
    if (/\btrinta\b/.test(text)) return 30;
    if (/\bquarenta e cinco\b/.test(text)) return 45;
    if (/\bquarenta\b/.test(text)) return 40;
    if (/\bcinquenta\b/.test(text)) return 50;
    const spokenMinutes = text.match(/\be\s+(\d{1,2})\b/);
    return spokenMinutes ? Number(spokenMinutes[1]) : undefined;
  };
  const wordTokens = value.split(' ');
  let hour: number | undefined;
  let minute: number | undefined;
  let hourTokenIndex = -1;

  const numericTime = value.match(/\b(\d{1,2})(?:\s*(?::|h|e)\s*(\d{1,2}))?\s*(?:h|horas?)?\b/);
  if (numericTime) {
    hour = Number(numericTime[1]);
    minute = numericTime[2] === undefined
      ? spokenMinute(value.slice((numericTime.index ?? 0) + numericTime[0].length)) ?? 0
      : Number(numericTime[2]);
  } else {
    hourTokenIndex = wordTokens.findIndex(token => Object.hasOwn(hourWords, token) && token !== 'meia');
    if (hourTokenIndex < 0) return null;
    hour = hourWords[wordTokens[hourTokenIndex]];
    minute = spokenMinute(wordTokens.slice(hourTokenIndex + 1).join(' ')) ?? 0;
  }

  if (!Number.isInteger(hour) || hour! < 0 || hour! > 23 || !Number.isInteger(minute) || minute! < 0 || minute! > 59) return null;

  if (hour! >= 1 && hour! <= 12) {
    if (period === 'tarde' && hour! < 12) hour! += 12;
    if (period === 'noite') hour! = hour! === 12 ? 0 : hour! + 12;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function matchVoiceChoice(value: string, choices: VoiceChoice[]) {
  const spoken = normalizedSpeech(value);
  if (!spoken) return undefined;
  for (const choice of choices) {
    for (const alias of choice.aliases) {
      const normalizedAlias = normalizedSpeech(alias);
      if (spoken === normalizedAlias || (normalizedAlias.length >= 4 && spoken.includes(normalizedAlias))) return choice;
    }
  }

  let closest: { choice: VoiceChoice; distance: number; limit: number } | undefined;
  for (const choice of choices) {
    for (const alias of choice.aliases) {
      const normalizedAlias = normalizedSpeech(alias);
      const longest = Math.max(spoken.length, normalizedAlias.length);
      if (Math.min(spoken.length, normalizedAlias.length) < 5) continue;
      const limit = Math.max(1, Math.floor(longest * 0.18));
      const distance = editDistance(spoken, normalizedAlias);
      if (distance <= limit && (!closest || distance < closest.distance)) closest = { choice, distance, limit };
    }
  }
  return closest?.choice;
}

export default function CostinhaAssistant({ avatarVideoUrl }: Props) {
  const [path] = useLocation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [initialPosition] = useState(() => loadLauncherPosition(path));
  const [position, setPosition] = useState<LauncherPosition>(initialPosition.position);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState('');
  const sequence = useRef(0);
  const messagesRef = useRef(messages);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const controllersRef = useRef(new Set<AbortController>());
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(open);
  const retryRef = useRef<(() => void) | null>(null);
  const positionRef = useRef(position);
  const positionCustomizedRef = useRef(initialPosition.customized);
  const dragRef = useRef<LauncherDrag | null>(null);
  const suppressClickRef = useRef(false);
  const workoutRequestRef = useRef<WorkoutRequest | null>(null);
  openRef.current = open;
  positionRef.current = position;
  messagesRef.current = messages;

  const stopRecognition = useCallback(() => {
    const recognition = speechRecognitionRef.current;
    speechRecognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    }
    setListening(false);
  }, []);

  useEffect(() => {
    const keepPositionInBounds = () => {
      const next = positionCustomizedRef.current
        ? clampLauncherPosition(positionRef.current, window.innerWidth, window.innerHeight, path)
        : defaultLauncherPosition(window.innerWidth, window.innerHeight, path);
      positionRef.current = next;
      setPosition(next);
      if (positionCustomizedRef.current) persistLauncherPosition(next);
    };
    keepPositionInBounds();
    window.addEventListener('resize', keepPositionInBounds);
    return () => window.removeEventListener('resize', keepPositionInBounds);
  }, [path]);

  const stopAudio = useCallback(() => {
    controllersRef.current.forEach(controller => controller.abort());
    controllersRef.current.clear();
    controllerRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const speak = useCallback(async (text: string) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    controllersRef.current.add(controller);
    speechQueueRef.current = speechQueueRef.current.then(async () => {
      if (controller.signal.aborted || !openRef.current) return;
      setAudioUnavailable(false);
      let url: string | null = null;
      try {
        const blob = await requestAudio('/api/voz/falar', { method: 'POST', body: JSON.stringify({ texto: text }), signal: controller.signal });
        if (controller.signal.aborted || !openRef.current) return;
        url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error('O áudio não pôde ser reproduzido.'));
          audio.play().catch(reject);
        });
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) setAudioUnavailable(true);
      } finally {
        if (url && objectUrlRef.current === url) {
          URL.revokeObjectURL(url);
          objectUrlRef.current = null;
          audioRef.current = null;
        }
        controllersRef.current.delete(controller);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    });
    await speechQueueRef.current;
  }, []);

  const addMessage = useCallback((message: Omit<AssistantMessage, 'id'>, voiceText?: string) => {
    const id = ++sequence.current;
    setMessages(current => [...current, { ...message, id }]);
    if (message.from === 'assistant') {
      const spoken = voiceText ?? message.text;
      if (spoken) void speak(spoken);
    }
  }, [speak]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }));
    }
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        stopRecognition();
        setOpen(false);
        stopAudio();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, stopAudio, stopRecognition]);

  useEffect(() => () => {
    speechRecognitionRef.current?.abort();
    speechRecognitionRef.current = null;
    stopAudio();
  }, [stopAudio]);

  const close = () => { stopRecognition(); setOpen(false); stopAudio(); };
  const launch = () => {
    if (open) return;
    setMessages([]);
    messagesRef.current = [];
    setDraft('');
    setVoiceNotice('');
    setOpen(true);
    addMessage({ from: 'assistant', kind: 'text', text: GREETING }, GREETING);
    addMessage({ from: 'assistant', kind: 'topics' });
  };
  const chooseTopic = (topic: string) => {
    if (topic === 'Nutrição') {
      addMessage({ from: 'assistant', kind: 'text', text: 'A nutrição com inteligência artificial está à espera do endpoint Java. Assim que estiver disponível, poderei ajudar por aqui.' });
    } else if (topic === 'Musculação') {
      const text = 'A musculação fortalece os músculos e os ossos, apoia a mobilidade e pode ajudar a criar uma rotina mais ativa. Comece com cargas adequadas e respeite o seu ritmo.';
      addMessage({ from: 'assistant', kind: 'text', text });
      addMessage({ from: 'assistant', kind: 'actions' });
    } else {
      const text = 'A calistenia usa o peso do próprio corpo para desenvolver força, coordenação e controlo. Adapte a dificuldade à sua experiência e faça cada movimento com atenção.';
      addMessage({ from: 'assistant', kind: 'text', text });
      void loadExercises(undefined, 'Calistenia');
    }
  };

  const loadExercises = async (group?: string, modality?: string) => {
    retryRef.current = () => { void loadExercises(group, modality); };
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (group) params.set('grupoMuscular', group);
      if (modality) params.set('modalidade', modality);
      const found = records<Exercico>(await request(`/api/exercicios?${params.toString()}`));
      const intro = found.length ? `Encontrei ${found.length} exercícios${group ? ` para ${group}` : ' de calistenia'}.` : 'Não encontrei exercícios disponíveis para esta seleção.';
      const spokenCards = found.map(item => [item.nome, item.descricao].filter(Boolean).join('. ')).filter(Boolean).join('. ');
      addMessage({ from: 'assistant', kind: 'exercises', group: group ?? modality, items: found, text: intro },
        [intro, spokenCards].filter(Boolean).join(' '));
    } catch (error) {
      addMessage({ from: 'assistant', kind: 'text', text: friendlyError(error), error: true });
      addMessage({ from: 'assistant', kind: 'groups', group: modality ? 'Calistenia' : group });
    } finally { setBusy(false); }
  };

  const createAssistantWorkout = async (details: WorkoutRequest) => {
    retryRef.current = () => { void createAssistantWorkout(details); };
    const client = getCliente();
    if (!client) {
      addMessage({ from: 'assistant', kind: 'text', text: 'Para criar um treino, entre na sua conta de cliente e volte a tentar.' });
      return;
    }
    if (!details.tipo || !details.periodo || !details.horario || (details.tipo === 'especifico' && !details.grupo)) {
      addMessage({ from: 'assistant', kind: 'text', text: 'Ainda falta uma escolha para criar o treino. Vamos começar novamente pelo nível.' });
      workoutRequestRef.current = null;
      addMessage({ from: 'assistant', kind: 'workout-level', text: 'Qual o seu nível? Iniciante, intermediário ou avançado?' });
      return;
    }
    setBusy(true);
    try {
      const body = {
        idUsuario: client.id,
        nivel: details.nivel,
        tipo: details.tipo,
        ...(details.tipo === 'especifico' && details.grupo ? { grupo: details.grupo } : {}),
        periodo: details.periodo,
        horario: details.horario,
      };
      const response = await request<unknown>('/api/treinos/assistente', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = response && typeof response === 'object' && 'treino' in response
        ? (response as { treino?: unknown }).treino
        : response;
      const created = payload as Treino | undefined;
      if (!created || typeof created !== 'object' || !created.id) {
        throw new Error('A API criou o treino, mas não retornou os dados esperados.');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['treinos', client.id] }),
        queryClient.invalidateQueries({ queryKey: ['agenda', client.id] }),
      ]);
      const name = created.nome?.trim() || 'seu treino';
      addMessage({ from: 'assistant', kind: 'text', text: `Pronto! Criei o “${name}” pra você e já agendei para hoje às ${details.horario}. Você pode ver ele na sua lista de treinos e na sua agenda.` });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && /horario|hora/.test(normalized(error.message))) {
        workoutRequestRef.current = { ...details, horario: undefined };
        addMessage({ from: 'assistant', kind: 'workout-time', text: 'A API não aceitou esse horário. Diga novamente no formato HH:mm, como 19:30, ou fale, por exemplo, “sete da noite”.' });
        return;
      }
      addMessage({ from: 'assistant', kind: 'text', text: friendlyError(error), error: true });
    } finally { setBusy(false); }
  };

  const chooseWorkoutLevel = (nivel: WorkoutRequest['nivel']) => {
    workoutRequestRef.current = { nivel };
    addMessage({ from: 'assistant', kind: 'workout-type', text: 'Você quer um treino misto (todos os grupos) ou um treino específico (só um grupo muscular)?' });
  };

  const chooseWorkoutType = (tipo: NonNullable<WorkoutRequest['tipo']>) => {
    const current = workoutRequestRef.current;
    if (!current) {
      addMessage({ from: 'assistant', kind: 'text', text: 'Vamos começar de novo. Escolha “Montar treino” para selecionar o seu nível.' });
      return;
    }
    const details: WorkoutRequest = { ...current, tipo };
    workoutRequestRef.current = details;
    if (tipo === 'misto') {
      addMessage({ from: 'assistant', kind: 'workout-period', text: 'Qual período você prefere treinar? Manhã, tarde ou noite?' });
      return;
    }
    addMessage({ from: 'assistant', kind: 'workout-group', text: 'Qual grupo muscular? Perna, peito, braço ou costas?' });
  };

  const chooseWorkoutGroup = (grupo: NonNullable<WorkoutRequest['grupo']>) => {
    const current = workoutRequestRef.current;
    if (!current) {
      addMessage({ from: 'assistant', kind: 'text', text: 'Vamos começar de novo. Escolha “Montar treino” para selecionar o seu nível.' });
      return;
    }
    workoutRequestRef.current = { ...current, tipo: 'especifico', grupo };
    addMessage({ from: 'assistant', kind: 'workout-period', text: 'Qual período você prefere treinar? Manhã, tarde ou noite?' });
  };

  const chooseWorkoutPeriod = (periodo: NonNullable<WorkoutRequest['periodo']>) => {
    const current = workoutRequestRef.current;
    if (!current) {
      addMessage({ from: 'assistant', kind: 'text', text: 'Vamos começar de novo. Escolha “Montar treino” para selecionar o seu nível.' });
      return;
    }
    workoutRequestRef.current = { ...current, periodo, horario: undefined };
    addMessage({ from: 'assistant', kind: 'workout-time', text: 'Diga um horário. Você pode escrever, por exemplo, “19h”, “19:30” ou “sete da noite”.' });
  };

  const submitWorkoutTime = (text: string) => {
    const current = workoutRequestRef.current;
    if (!current?.periodo) {
      workoutRequestRef.current = null;
      addMessage({ from: 'assistant', kind: 'text', text: 'Vamos começar novamente. Escolha “Montar treino” para selecionar o seu nível.' });
      return;
    }
    const horario = parseWorkoutTime(text, current.periodo);
    if (!horario) {
      addMessage({ from: 'assistant', kind: 'workout-time', text: 'Não consegui identificar um horário válido. Diga novamente, por exemplo, “19:30” ou “sete da noite”.' });
      return;
    }
    const details = { ...current, horario };
    workoutRequestRef.current = details;
    void createAssistantWorkout(details);
  };

  const chooseAction = (action: 'workout' | 'exercises') => {
    if (action === 'workout') {
      workoutRequestRef.current = null;
      addMessage({ from: 'assistant', kind: 'workout-level', text: 'Qual o seu nível? Iniciante, intermediário ou avançado?' });
      return;
    }
    addMessage({ from: 'assistant', kind: 'groups' });
  };

  const chooseGroup = (group: typeof GROUPS[number]) => {
    void loadExercises(group.api, 'Musculacao');
  };

  const voiceChoicesFor = (message?: AssistantMessage): VoiceChoice[] => {
    if (!message || message.from !== 'assistant') return [];
    if (message.kind === 'topics') return [
      { label: 'Nutrição', aliases: ['nutricao', 'alimentacao', 'ganho de massa muscular', 'definicao', 'definicao muscular', 'emagrecimento'], run: () => chooseTopic('Nutrição') },
      { label: 'Musculação', aliases: ['musculacao', 'academia'], run: () => chooseTopic('Musculação') },
      { label: 'Calistenia', aliases: ['calistenia', 'treino com peso do corpo'], run: () => chooseTopic('Calistenia') },
    ];
    if (message.kind === 'actions') return [
      { label: 'Montar treino', aliases: ['montar treino', 'montar meu treino', 'criar treino', 'criar meu treino', 'montar treino rapido', 'treino rapido'], run: () => chooseAction('workout') },
      { label: 'Ver exercícios', aliases: ['ver exercicios', 'ver os exercicios', 'mostrar exercicios', 'exercicios'], run: () => chooseAction('exercises') },
    ];
    if (message.kind === 'workout-level') return [
      { label: 'Iniciante', aliases: ['iniciante', 'nivel iniciante'], run: () => chooseWorkoutLevel('iniciante') },
      { label: 'Intermediário', aliases: ['intermediario', 'intermediaria', 'nivel intermediario'], run: () => chooseWorkoutLevel('intermediario') },
      { label: 'Avançado', aliases: ['avancado', 'avancada', 'nivel avancado'], run: () => chooseWorkoutLevel('avancado') },
    ];
    if (message.kind === 'workout-type') return [
      { label: 'Treino misto', aliases: ['treino misto', 'misto', 'todos os grupos', 'todos grupos'], run: () => chooseWorkoutType('misto') },
      { label: 'Treino específico', aliases: ['treino especifico', 'especifico', 'grupo muscular', 'um grupo muscular'], run: () => chooseWorkoutType('especifico') },
    ];
    if (message.kind === 'workout-group') return [
      { label: 'Perna', aliases: ['perna', 'pernas'], run: () => chooseWorkoutGroup('Perna') },
      { label: 'Peito', aliases: ['peito', 'peitoral'], run: () => chooseWorkoutGroup('Peito') },
      { label: 'Braço', aliases: ['braco', 'bracos', 'biceps', 'triceps'], run: () => chooseWorkoutGroup('Braco') },
      { label: 'Costas', aliases: ['costas'], run: () => chooseWorkoutGroup('Costas') },
    ];
    if (message.kind === 'workout-period') return [
      { label: 'Manhã', aliases: ['manha', 'pela manha', 'de manha'], run: () => chooseWorkoutPeriod('manha') },
      { label: 'Tarde', aliases: ['tarde', 'pela tarde', 'de tarde'], run: () => chooseWorkoutPeriod('tarde') },
      { label: 'Noite', aliases: ['noite', 'pela noite', 'a noite'], run: () => chooseWorkoutPeriod('noite') },
    ];
    if (message.kind === 'groups' && message.group === 'Calistenia') return [
      { label: 'Tentar novamente', aliases: ['tentar novamente', 'repetir', 'nova busca'], run: () => void loadExercises(undefined, 'Calistenia') },
    ];
    if (message.kind === 'groups') return GROUPS.map(group => ({
      label: group.label,
      aliases: group.label === 'Braço' ? ['braco', 'bracos', 'braço', 'biceps', 'triceps'] : group.label === 'Perna' ? ['perna', 'pernas'] : group.label === 'Peito' ? ['peito', 'peitoral'] : ['costas'],
      run: () => chooseGroup(group),
    }));
    return [];
  };

  const submitUserText = (rawText: string, fromVoice = false) => {
    const text = rawText.trim();
    if (!text || busy || (listening && !fromVoice)) return;
    setDraft('');
    setVoiceNotice('');
    const lastAssistantMessage = [...messagesRef.current].reverse().find(message => message.from === 'assistant');
    const choices = voiceChoicesFor(lastAssistantMessage);
    const match = matchVoiceChoice(text, choices);
    addMessage({ from: 'user', kind: 'text', text });
    if (lastAssistantMessage?.kind === 'workout-time') {
      submitWorkoutTime(text);
      return;
    }
    if (match) {
      match.run();
      return;
    }
    const prompt = choices.length
      ? `Não identifiquei uma opção para “${text}”. Escolha uma das opções mostradas (${choices.map(choice => choice.label).join(', ')}) ou tente novamente.`
      : `Recebi “${text}”, mas não consegui identificar uma opção nesta etapa. Escolha uma das opções disponíveis ou tente novamente.`;
    if (choices.length && lastAssistantMessage && ['topics', 'actions', 'groups', 'workout-level', 'workout-type', 'workout-group', 'workout-period'].includes(lastAssistantMessage.kind)) {
      addMessage({ from: 'assistant', kind: lastAssistantMessage.kind, group: lastAssistantMessage.group, text: prompt });
    } else {
      addMessage({ from: 'assistant', kind: 'text', text: prompt });
    }
  };

  const startVoiceInput = () => {
    if (listening) {
      setVoiceNotice('Finalizando…');
      speechRecognitionRef.current?.stop();
      return;
    }
    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceNotice('Este navegador não oferece reconhecimento de voz. Você pode digitar sua mensagem.');
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 4;
      recognition.onresult = event => {
        const result = event.results[event.resultIndex];
        const alternatives = result ? Array.from(result).map(item => item.transcript.trim()).filter(Boolean) : [];
        const lastAssistantMessage = [...messagesRef.current].reverse().find(message => message.from === 'assistant');
        const choices = voiceChoicesFor(lastAssistantMessage);
        const transcript = alternatives.find(candidate => matchVoiceChoice(candidate, choices)) || alternatives[0];
        if (transcript) submitUserText(transcript, true);
        else setVoiceNotice('Não consegui transcrever a fala. Tente novamente ou digite sua mensagem.');
      };
      recognition.onerror = event => {
        const messages: Record<string, string> = {
          'not-allowed': 'Permita o acesso ao microfone nas configurações do navegador.',
          'service-not-allowed': 'O navegador bloqueou o reconhecimento de voz.',
          'no-speech': 'Não ouvi sua fala. Tente novamente.',
          'audio-capture': 'Não encontrei um microfone disponível.',
          network: 'O reconhecimento de voz falhou. Você pode digitar sua mensagem.',
        };
        setVoiceNotice(messages[event.error] || 'Não foi possível reconhecer a fala. Tente novamente ou digite sua mensagem.');
      };
      recognition.onend = () => {
        if (speechRecognitionRef.current === recognition) speechRecognitionRef.current = null;
        setListening(false);
        setVoiceNotice(current => current === 'Ouvindo… Fale sua opção.' || current === 'Finalizando…' ? '' : current);
      };
      speechRecognitionRef.current = recognition;
      recognition.start();
      setListening(true);
      setVoiceNotice('Ouvindo… Fale sua opção.');
    } catch {
      speechRecognitionRef.current = null;
      setListening(false);
      setVoiceNotice('Não foi possível iniciar o microfone. Você pode digitar sua mensagem.');
    }
  };

  const latestAssistantMessage = [...messages].reverse().find(message => message.from === 'assistant');
  const activeChoiceMessageId = latestAssistantMessage && voiceChoicesFor(latestAssistantMessage).length
    ? latestAssistantMessage.id
    : undefined;

  const retryLast = () => {
    retryRef.current?.();
  };

  const handleLauncherPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: positionRef.current,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleLauncherPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) > 5) drag.moved = true;
    if (!drag.moved) return;
    event.preventDefault();
    positionCustomizedRef.current = true;
    suppressClickRef.current = true;
    const next = clampLauncherPosition(
      { x: drag.origin.x + deltaX, y: drag.origin.y + deltaY },
      window.innerWidth,
      window.innerHeight,
      path,
    );
    positionRef.current = next;
    setPosition(next);
  };
  const finishLauncherDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) return;
    persistLauncherPosition(positionRef.current);
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
  };

  return <div className="costinha-root" style={{ left: position.x, top: position.y }} data-testid="costinha-assistant">
    {open && <section className="costinha-panel" role="dialog" aria-modal="false" aria-labelledby="costinha-title" data-testid="dialog-costinha">
      <header className="costinha-header">
        <div className="costinha-avatar costinha-avatar-small" aria-hidden="true" data-testid="img-avatar-costinha-header">
          {avatarVideoUrl ? <video src={avatarVideoUrl} muted loop autoPlay playsInline /> : <div className="costinha-face"><span /><i /><b /></div>}
        </div>
        <div className="costinha-headcopy"><span className="costinha-eyebrow">O SEU COMPANHEIRO</span><h2 id="costinha-title">Costinha <span className="costinha-online" /></h2><p>Consistência, um treino de cada vez.</p></div>
        <button className="costinha-icon-button" type="button" onClick={close} aria-label="Fechar conversa" data-testid="button-close-costinha"><X size={19} /></button>
      </header>
      <div className="costinha-messages" ref={scrollRef} role="log" aria-live="polite" aria-label="Conversa com Costinha" data-testid="list-costinha-messages">
        {messages.map(message => <div className={`costinha-message-row ${message.from === 'user' ? 'from-user' : ''}`} key={message.id} data-testid={`message-costinha-${message.id}`}>
          {message.from === 'assistant' && <div className="costinha-avatar costinha-avatar-chat" aria-hidden="true" data-testid="img-avatar-costinha-message">{avatarVideoUrl ? <video src={avatarVideoUrl} muted loop autoPlay playsInline /> : <div className="costinha-face"><span /><i /><b /></div>}</div>}
          <div className={`costinha-bubble ${message.from === 'user' ? 'user-bubble' : ''}`}>
            {message.text && <p data-testid={`text-costinha-${message.id}`}>{message.text}</p>}
            {message.error && <button className="costinha-retry" type="button" onClick={retryLast} disabled={busy || listening} data-testid="button-retry-costinha"><RotateCcw size={14} /> Tentar novamente</button>}
            {message.kind === 'topics' && <div className="costinha-chip-row" data-testid="choices-costinha-topics">
              {['Nutrição', 'Musculação', 'Calistenia'].map(topic => <button type="button" className="costinha-chip" key={topic} disabled={busy || listening || message.id !== activeChoiceMessageId} onClick={() => submitUserText(topic)} data-testid={`button-topic-${topic.toLowerCase()}`}>{topic}<ArrowRight size={13} /></button>)}
            </div>}
            {message.kind === 'actions' && <div className="costinha-action-row" data-testid="choices-musculacao">
              <button type="button" onClick={() => submitUserText('Montar treino')} disabled={busy || listening || message.id !== activeChoiceMessageId} data-testid="button-montar-treino"><Dumbbell size={15} /> Montar treino</button>
              <button type="button" onClick={() => submitUserText('Ver exercícios')} disabled={busy || listening || message.id !== activeChoiceMessageId} data-testid="button-ver-exercicios"><Activity size={15} /> Ver exercícios</button>
            </div>}
            {['workout-level', 'workout-type', 'workout-group', 'workout-period'].includes(message.kind) && <div className="costinha-chip-row" data-testid={`choices-${message.kind}`}>
              {voiceChoicesFor(message).map(choice => <button
                className="costinha-chip"
                type="button"
                key={choice.label}
                disabled={busy || listening || message.id !== activeChoiceMessageId}
                onClick={() => submitUserText(choice.label)}
                data-testid={`button-${message.kind}-${normalizedSpeech(choice.label).replace(/\s+/g, '-')}`}
              >{choice.label}<ArrowRight size={13} /></button>)}
            </div>}
            {message.kind === 'groups' && <div className="costinha-chip-row" data-testid="choices-exercise-groups">
              {message.group === 'Calistenia'
                ? <button className="costinha-chip" type="button" disabled={busy || listening || message.id !== activeChoiceMessageId} onClick={() => submitUserText('Tentar novamente')} data-testid="button-retry-calistenia">Tentar novamente<RotateCcw size={13} /></button>
                : GROUPS.map(group => <button className="costinha-chip" type="button" key={group.api} disabled={busy || listening || message.id !== activeChoiceMessageId} onClick={() => submitUserText(group.label)} data-testid={`button-group-${group.api.toLowerCase()}`}>{group.label}<ArrowRight size={13} /></button>)}
            </div>}
            {message.kind === 'exercises' && <ExerciseCards items={message.items ?? []} />}
          </div>
        </div>)}
        {busy && <div className="costinha-loading" role="status" data-testid="status-costinha-loading"><span /><span /><span /> <em>A procurar no seu plano…</em></div>}
        {audioUnavailable && <p className="costinha-audio-note" role="status" data-testid="status-audio-unavailable">Não foi possível reproduzir a voz agora. A mensagem continua disponível em texto.</p>}
      </div>
      <form className="costinha-composer" onSubmit={event => { event.preventDefault(); submitUserText(draft); }}>
        <input
          className="costinha-input"
          type="text"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder={latestAssistantMessage?.kind === 'workout-time' ? 'Ex.: 19:30 ou sete da noite' : 'Escreva ou fale com o Costinha'}
          aria-label={latestAssistantMessage?.kind === 'workout-time' ? 'Horário preferido para o treino' : 'Mensagem para o Costinha'}
          disabled={busy || listening}
          data-testid="input-costinha-message"
        />
        <button
          className={`costinha-mic-button ${listening ? 'is-listening' : ''}`}
          type="button"
          onClick={startVoiceInput}
          disabled={busy}
          aria-label={listening ? 'Parar gravação de voz' : 'Falar com o Costinha'}
          aria-pressed={listening}
          title={listening ? 'Parar gravação' : 'Falar com o Costinha'}
          data-testid="button-costinha-microphone"
        >{listening ? <MicOff size={18} /> : <Mic size={18} />}</button>
        <button className="costinha-send-button" type="submit" disabled={busy || listening || !draft.trim()} aria-label="Enviar mensagem" data-testid="button-send-costinha-message"><ArrowRight size={18} /></button>
      </form>
      {voiceNotice && <p className="costinha-voice-status" role="status" aria-live="polite" data-testid="status-costinha-voice">{voiceNotice}</p>}
      <footer className="costinha-footer"><Sparkles size={14} /><span>Informação para acompanhar o seu ritmo</span></footer>
    </section>}
    <button
      className={`costinha-launcher ${open ? 'launcher-open' : ''}`}
      type="button"
      onClick={event => {
        if (suppressClickRef.current) {
          event.preventDefault();
          suppressClickRef.current = false;
          return;
        }
        open ? close() : launch();
      }}
      onPointerDown={handleLauncherPointerDown}
      onPointerMove={handleLauncherPointerMove}
      onPointerUp={finishLauncherDrag}
      onPointerCancel={finishLauncherDrag}
      onDragStart={event => event.preventDefault()}
      aria-label={open ? 'Arraste ou feche o Costinha' : 'Arraste ou abra o Costinha'}
      aria-expanded={open}
      data-testid="button-open-costinha"
    >
      {open ? <X size={22} /> : <span className="costinha-avatar costinha-avatar-launch" data-testid="img-avatar-costinha-launch">{avatarVideoUrl ? <video src={avatarVideoUrl} muted loop autoPlay playsInline /> : <div className="costinha-face"><span /><i /><b /></div>}</span>}
    </button>
  </div>;
}

function ExerciseCards({ items }: { items: Exercico[] }) {
  if (!items.length) return <div className="costinha-empty" data-testid="state-exercises-empty">Ainda não há exercícios disponíveis para esta seleção.</div>;
  return <div className="costinha-exercise-list" data-testid="list-exercises">
    {items.map((exercise, index) => {
      const href = videoHref(exercise.demonstracaoVideo);
      return <article className="costinha-exercise-card" key={`${exercise.id ?? exercise.nome}-${index}`} data-testid={`card-exercise-${exercise.id ?? index}`}>
        <div className="costinha-exercise-heading"><span className="costinha-exercise-mark"><Activity size={15} /></span><div><h3 data-testid={`text-exercise-name-${exercise.id ?? index}`}>{exercise.nome || 'Exercício'}</h3><span>{exercise.grupoMuscular || exercise.modalidade || 'Treino'}</span></div></div>
        {exercise.descricao && <p data-testid={`text-exercise-description-${exercise.id ?? index}`}>{exercise.descricao}</p>}
        <div className="costinha-exercise-meta">{exercise.nivel && <span>{exercise.nivel}</span>}{href && <a href={href} target="_blank" rel="noreferrer" data-testid={`link-exercise-video-${exercise.id ?? index}`}><ExternalLink size={13} /> Ver demonstração</a>}</div>
      </article>;
    })}
  </div>;
}

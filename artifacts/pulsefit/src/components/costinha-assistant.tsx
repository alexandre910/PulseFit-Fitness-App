import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Dumbbell, ExternalLink, HeartPulse, RotateCcw, Sparkles, X } from 'lucide-react';
import { asArray, Exercico, friendlyError, getCliente, RelacaoExercicio, request, requestAudio, Treino } from '@/lib/api';
import { useLocation } from 'wouter';

type MessageKind = 'text' | 'topics' | 'actions' | 'groups' | 'exercises' | 'workout';
type AssistantMessage = { id: number; from: 'assistant' | 'user'; kind: MessageKind; text?: string; group?: string; items?: Exercico[]; warmups?: Exercico[]; mains?: Exercico[]; error?: boolean };
type Props = { avatarVideoUrl?: string };
type LauncherPosition = { x: number; y: number };
type LauncherDrag = { pointerId: number; startX: number; startY: number; origin: LauncherPosition; moved: boolean };

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

function exerciseId(relation: RelacaoExercicio) {
  const nested = typeof relation.id === 'object' && relation.id ? relation.id.idExercicio : undefined;
  return relation.idExercicio ?? nested;
}

function normalized(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export default function CostinhaAssistant({ avatarVideoUrl }: Props) {
  const [path] = useLocation();
  const [open, setOpen] = useState(false);
  const [initialPosition] = useState(() => loadLauncherPosition(path));
  const [position, setPosition] = useState<LauncherPosition>(initialPosition.position);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const sequence = useRef(0);
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
  openRef.current = open;
  positionRef.current = position;

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
        setOpen(false);
        stopAudio();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, stopAudio]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  const close = () => { setOpen(false); stopAudio(); };
  const launch = () => {
    if (open) return;
    setMessages([]);
    setOpen(true);
    addMessage({ from: 'assistant', kind: 'text', text: GREETING }, GREETING);
    addMessage({ from: 'assistant', kind: 'topics' });
  };
  const chooseTopic = (topic: string) => {
    addMessage({ from: 'user', kind: 'text', text: topic });
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

  const makeWorkout = async () => {
    retryRef.current = () => { void makeWorkout(); };
    const client = getCliente();
    if (!client) {
      addMessage({ from: 'assistant', kind: 'text', text: 'Para montar um treino rápido, entre na sua conta de cliente e volte a tentar.' });
      return;
    }
    setBusy(true);
    try {
      const created = await request<Treino>('/api/treinos/rapido', { method: 'POST', body: JSON.stringify({ idUsuario: client.id }) });
      if (!created?.id) throw new Error('O treino foi criado, mas não foi possível identificar os exercícios.');
      const relations = records<RelacaoExercicio>(await request(`/api/treinos/${created.id}/exercicios`));
      const resolved = await Promise.all(relations.map(async relation => {
        const id = exerciseId(relation);
        return id == null ? null : request<Exercico>(`/api/exercicios/${id}`);
      }));
      const exercises = resolved.filter((item): item is Exercico => Boolean(item));
      const warmups = exercises.filter(item =>
        [item.modalidade, item.grupoMuscular, item.nome].some(value => value && normalized(value).includes('aquec')),
      );
      const mains: Exercico[] = [];
      for (const group of ['Peito', 'Perna', 'Braco', 'Costas']) {
        const match = exercises.find(item => !warmups.includes(item) && normalized(item.grupoMuscular ?? '').includes(normalized(group)));
        if (match) mains.push(match);
      }
      const spoken = exercises.length
        ? `O seu treino rápido está pronto. ${warmups.length} exercícios de aquecimento e ${mains.length} exercícios principais. ${[...warmups, ...mains].map(item => [item.nome, item.descricao].filter(Boolean).join('. ')).filter(Boolean).join('. ')}`
        : 'O treino foi criado, mas a API não devolveu exercícios para apresentar.';
      addMessage({ from: 'assistant', kind: 'workout', warmups, mains, text: spoken }, spoken);
    } catch (error) {
      addMessage({ from: 'assistant', kind: 'text', text: friendlyError(error), error: true });
      addMessage({ from: 'assistant', kind: 'actions' });
    } finally { setBusy(false); }
  };

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
            {message.error && <button className="costinha-retry" type="button" onClick={retryLast} disabled={busy} data-testid="button-retry-costinha"><RotateCcw size={14} /> Tentar novamente</button>}
            {message.kind === 'topics' && <div className="costinha-chip-row" data-testid="choices-costinha-topics">
              {['Nutrição', 'Musculação', 'Calistenia'].map(topic => <button type="button" className="costinha-chip" key={topic} disabled={busy} onClick={() => chooseTopic(topic)} data-testid={`button-topic-${topic.toLowerCase()}`}>{topic}<ArrowRight size={13} /></button>)}
            </div>}
            {message.kind === 'actions' && <div className="costinha-action-row" data-testid="choices-musculacao">
              <button type="button" onClick={() => { addMessage({ from: 'user', kind: 'text', text: 'Montar treino' }); void makeWorkout(); }} disabled={busy} data-testid="button-montar-treino"><Dumbbell size={15} /> Montar treino</button>
              <button type="button" onClick={() => { addMessage({ from: 'user', kind: 'text', text: 'Ver exercícios' }); addMessage({ from: 'assistant', kind: 'groups' }); }} disabled={busy} data-testid="button-ver-exercicios"><Activity size={15} /> Ver exercícios</button>
            </div>}
            {message.kind === 'groups' && <div className="costinha-chip-row" data-testid="choices-exercise-groups">
              {message.group === 'Calistenia'
                ? <button className="costinha-chip" type="button" disabled={busy} onClick={() => void loadExercises(undefined, 'Calistenia')} data-testid="button-retry-calistenia">Tentar novamente<RotateCcw size={13} /></button>
                : GROUPS.map(group => <button className="costinha-chip" type="button" key={group.api} disabled={busy} onClick={() => { addMessage({ from: 'user', kind: 'text', text: group.label }); void loadExercises(group.api, 'Musculacao'); }} data-testid={`button-group-${group.api.toLowerCase()}`}>{group.label}<ArrowRight size={13} /></button>)}
            </div>}
            {message.kind === 'workout' && <WorkoutCards warmups={message.warmups ?? []} mains={message.mains ?? []} />}
            {message.kind === 'exercises' && <ExerciseCards items={message.items ?? []} />}
          </div>
        </div>)}
        {busy && <div className="costinha-loading" role="status" data-testid="status-costinha-loading"><span /><span /><span /> <em>A procurar no seu plano…</em></div>}
        {audioUnavailable && <p className="costinha-audio-note" role="status" data-testid="status-audio-unavailable">Não foi possível reproduzir a voz agora. A mensagem continua disponível em texto.</p>}
      </div>
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

function WorkoutCards({ warmups, mains }: { warmups: Exercico[]; mains: Exercico[] }) {
  if (!warmups.length && !mains.length) return <div className="costinha-empty" data-testid="state-workout-empty">A API não devolveu exercícios para este treino. Não adicionámos exercícios que não estejam no seu plano.</div>;
  return <div className="costinha-workout-results" data-testid="list-workout-results">
    {warmups.length > 0 && <section><h3 className="costinha-section-label"><HeartPulse size={14} /> Aquecimento</h3><ExerciseCards items={warmups} /></section>}
    {mains.length > 0 && <section><h3 className="costinha-section-label"><Dumbbell size={14} /> Parte principal</h3><ExerciseCards items={mains} /></section>}
    {!mains.length && <p className="costinha-no-main" data-testid="text-no-main-exercises">Não foram encontrados exercícios principais para os grupos previstos.</p>}
  </div>;
}

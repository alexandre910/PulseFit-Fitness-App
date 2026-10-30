import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { Activity, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, CircleHelp, Clock3, Dumbbell, Flame, House, LockKeyhole, LogOut, Search, UserRound, Video, X } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { clearCliente, Cliente, Exercico, friendlyError, getCliente, isQuestionarioPendente, request, saveCliente, setQuestionarioPendente, Treino, RelacaoExercicio, AgendaItem } from '@/lib/api';
import { useForm } from 'react-hook-form';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 20_000, refetchOnWindowFocus: false } } });
const navItems = [
  { href: '/inicio', label: 'Início', icon: House },
  { href: '/treinos', label: 'Treinos', icon: Dumbbell },
  { href: '/agenda', label: 'Agenda', icon: CalendarDays },
  { href: '/exercicios', label: 'Exercícios', icon: Activity },
  { href: '/perfil', label: 'Perfil', icon: UserRound },
];
const listFrom = <T,>(data: unknown, key?: string): T[] => {
  if (Array.isArray(data)) return data as T[];
  if (key && data && typeof data === 'object' && Array.isArray((data as any)[key])) return (data as any)[key] as T[];
  return [];
};
function useCliente() { return getCliente(); }
function PageLoading({ label = 'Carregando seus dados' }: { label?: string }) {
  return <div className="space-y-4" aria-label={label} data-testid="status-loading"><div className="skeleton h-4 w-32" /><div className="skeleton h-16 w-full" /><div className="skeleton h-32 w-full" /><div className="skeleton h-24 w-4/5" /></div>;
}
function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <div className="error-box flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="status-error"><span>{message}</span><button className="btn btn-quiet py-2" onClick={retry} data-testid="button-retry">Tentar novamente</button></div>;
}
function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="empty-box" data-testid="state-empty"><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[#303c52] text-[#FFA213]"><Dumbbell size={21} /></div><h3 className="display text-2xl text-[#CCCCCC]">{title}</h3><p className="mx-auto mt-1 max-w-sm text-sm">{body}</p>{action && <div className="mt-5 flex justify-center">{action}</div>}</div>;
}
function Brand() { return <div className="brand" aria-label="PulseFit">PULSE<i>FIT</i><span className="ml-2 align-middle font-sans text-[9px] tracking-[.2em] text-[#7f8a9d]">TREINE COM PROPÓSITO</span></div>; }
function Navigation({ path, mobile = false }: { path: string; mobile?: boolean }) {
  return <nav className={mobile ? 'nav-bottom' : 'desktop-nav'} aria-label="Navegação principal">
    {!mobile && <Link href="/inicio" className="mb-12 block" data-testid="link-brand"><Brand /></Link>}
    <div className={mobile ? 'contents' : 'space-y-2'}>
      {navItems.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={`nav-link ${path === href || (href === '/treinos' && path.startsWith('/treinos/')) || (href === '/exercicios' && path.startsWith('/exercicios/')) ? 'active' : ''}`} data-testid={`link-nav-${label.toLowerCase()}`}><Icon size={mobile ? 19 : 18} /><span>{label}</span></Link>)}
    </div>
    {!mobile && <div className="absolute bottom-7 left-5 right-5 panel-soft p-4"><p className="eyebrow">UM DIA DE CADA VEZ</p><p className="mt-2 text-xs leading-relaxed text-[#9ca6b6]">Consistência vence intensidade. Sua próxima versão começa no próximo treino.</p></div>}
  </nav>;
}
function AuthBrand() { return <Link href="/login" className="brand" data-testid="link-brand">PULSE<i>FIT</i></Link>; }
function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="auth-layout"><section className="auth-side"><AuthBrand /><div className="auth-art enter">MOVIMENTO<span>MUDA TUDO.</span></div><p className="relative z-10 max-w-xs text-sm text-[#95a0b1]">Seu treino, seu ritmo. Um companheiro para transformar intenção em consistência.</p></section><section className="auth-form-side">{children}</section></div>;
}
function AppShell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  return <div className="app-shell"><Navigation path={path} /><div className="main-with-nav"><header className="topbar"><Link href="/inicio" className="brand text-[25px] md:hidden" data-testid="link-brand-mobile">PULSE<i>FIT</i></Link><span className="hidden text-xs text-[#778297] md:block">SEU ESPAÇO DE TREINO</span><Link href="/perfil" className="flex items-center gap-2 text-sm font-semibold text-[#b4bdca]" data-testid="link-top-profile"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#344057] text-[#FFA213]"><UserRound size={16} /></span>Minha conta</Link></header><main>{children}</main></div><Navigation path={path} mobile /></div>;
}
function Protected({ children }: { children: ReactNode }) {
  const cliente = useCliente();
  const [, setLocation] = useLocation();
  useEffect(() => { if (!cliente) setLocation('/login'); }, [cliente, setLocation]);
  if (!cliente) return null;
  return <AppShell>{children}</AppShell>;
}
function Heading({ kicker, title, detail, children }: { kicker: string; title: string; detail?: string; children?: React.ReactNode }) {
  return <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">{kicker}</p><h1 className="page-title">{title}</h1>{detail && <p className="subtle text-sm">{detail}</p>}</div>{children}</div>;
}
function Login() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useForm<{ email: string; senha: string }>({ defaultValues: { email: '', senha: '' } });
  async function submit(values: { email: string; senha: string }) {
    setBusy(true); setError('');
    try {
      const result = await request<{ cliente: Cliente; questionarioPendente: boolean }>('/api/clientes/login', { method: 'POST', body: JSON.stringify(values) });
      saveCliente(result.cliente);
      setQuestionarioPendente(result.questionarioPendente);
      setLocation(result.questionarioPendente ? '/questionario' : '/inicio');
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  return <AuthLayout><div className="auth-form enter"><p className="eyebrow">BEM-VINDE DE VOLTA</p><h1 className="display mt-2 text-5xl uppercase">Retome seu ritmo.</h1><p className="mt-2 text-sm text-[#929daf]">Entre na sua conta e continue de onde parou.</p>
    {error && <div className="error-box mt-6" role="alert" data-testid="status-login-error">{error}</div>}
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="mt-7 space-y-5">
      <FormField control={form.control} name="email" rules={{ required: 'Informe seu e-mail.' }} render={({ field }) => <FormItem><FormLabel className="label">E-mail</FormLabel><FormControl><Input className="field" type="email" autoComplete="email" placeholder="voce@email.com" data-testid="input-email" {...field} /></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="senha" rules={{ required: 'Informe sua senha.' }} render={({ field }) => <FormItem><FormLabel className="label">Senha</FormLabel><FormControl><Input className="field" type="password" autoComplete="current-password" placeholder="Sua senha" data-testid="input-senha" {...field} /></FormControl><FormMessage /></FormItem>} />
      <Button disabled={busy} className="btn btn-primary w-full" type="submit" data-testid="button-login">{busy ? 'Entrando…' : 'Entrar na minha conta'}<ArrowRight size={17} className="ml-2" /></Button>
    </form></Form>
    <p className="mt-6 text-center text-sm text-[#9ca6b6]">Ainda não tem conta? <Link href="/cadastro" className="font-bold text-[#FFA213]" data-testid="link-cadastro">Criar cadastro</Link></p>
  </div></AuthLayout>;
}
function Cadastro() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useForm<{ nome: string; email: string; senha: string; idade: string; sexo: string; nivelExperiencia: string }>({ defaultValues: { nome: '', email: '', senha: '', idade: '', sexo: '', nivelExperiencia: '' } });
  async function submit(values: { nome: string; email: string; senha: string; idade: string; sexo: string; nivelExperiencia: string }) {
    setBusy(true); setError('');
    try {
      await request('/api/clientes', { method: 'POST', body: JSON.stringify({ ...values, idade: Number(values.idade) }) });
      setLocation('/login');
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  const field = (name: 'nome' | 'email' | 'senha' | 'idade', label: string, type = 'text', placeholder = '') => <FormField key={name} control={form.control} name={name} rules={{ required: `Informe ${label.toLowerCase()}.`, ...(name === 'idade' ? { min: { value: 13, message: 'É necessário ter pelo menos 13 anos.' } } : {}) }} render={({ field: inputField }) => <FormItem><FormLabel className="label">{label}</FormLabel><FormControl><Input {...inputField} className="field" type={type} placeholder={placeholder} data-testid={`input-${name}`} /></FormControl><FormMessage /></FormItem>} />;
  return <AuthLayout><div className="auth-form enter"><p className="eyebrow">COMECE AQUI</p><h1 className="display mt-2 text-5xl uppercase">Sua jornada começa.</h1><p className="mt-2 text-sm text-[#929daf]">Crie sua conta para ter o PulseFit ao seu lado.</p>
    {error && <div className="error-box mt-5" role="alert" data-testid="status-cadastro-error">{error}</div>}
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="mt-6 space-y-4">
      {field('nome', 'Nome completo', 'text', 'Como podemos te chamar?')}{field('email', 'E-mail', 'email', 'voce@email.com')}{field('senha', 'Senha', 'password', 'Crie uma senha')}{field('idade', 'Idade', 'number', '13')}
      <FormField control={form.control} name="sexo" rules={{ required: 'Selecione uma opção.' }} render={({ field: f }) => <FormItem><FormLabel className="label">Sexo</FormLabel><FormControl><select {...f} className="field" data-testid="select-sexo"><option value="">Selecione</option><option value="Feminino">Feminino</option><option value="Masculino">Masculino</option><option value="Outro">Outro</option></select></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="nivelExperiencia" rules={{ required: 'Selecione seu nível.' }} render={({ field: f }) => <FormItem><FormLabel className="label">Experiência</FormLabel><FormControl><select {...f} className="field" data-testid="select-nivel"><option value="">Selecione</option><option value="iniciante">Iniciante</option><option value="avançado">Avançado</option></select></FormControl><FormMessage /></FormItem>} />
      <Button disabled={busy} className="btn btn-primary w-full" type="submit" data-testid="button-cadastro">{busy ? 'Criando conta…' : 'Criar minha conta'}<ArrowRight size={17} className="ml-2" /></Button>
    </form></Form>
    <p className="mt-5 text-center text-sm text-[#9ca6b6]">Já tem conta? <Link href="/login" className="font-bold text-[#FFA213]" data-testid="link-login">Entrar</Link></p>
  </div></AuthLayout>;
}
function Questionario() {
  const cliente = useCliente(); const [, setLocation] = useLocation(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const beginner = ['iniciante', 'beginner'].includes(cliente?.nivelExperiencia?.toLowerCase() || '');
  useEffect(() => { if (cliente && (!beginner || !isQuestionarioPendente())) setLocation('/inicio'); }, [cliente, beginner, setLocation]);
  const form = useForm<{ frequencia: string }>({ defaultValues: { frequencia: '' } });
  async function submit(values: { frequencia: string }) {
    if (!cliente) return;
    setBusy(true); setError('');
    try { await request('/api/questionarios', { method: 'POST', body: JSON.stringify({ idUsuario: cliente.id, frequencia: values.frequencia }) }); setQuestionarioPendente(false); setLocation('/inicio'); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  return <Protected><div className="page-wrap max-w-3xl"><div className="panel p-6 sm:p-10"><p className="eyebrow">SEU PONTO DE PARTIDA</p><h1 className="page-title">Vamos ajustar o seu ritmo.</h1><p className="subtle mb-8">Uma resposta rápida para começar com um plano que cabe na sua rotina.</p>{error && <div className="error-box mb-5" role="alert" data-testid="status-questionario-error">{error}</div>}
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-6">
      <FormField control={form.control} name="frequencia" rules={{ required: 'Escolha uma frequência.' }} render={({ field }) => <FormItem><FormLabel className="label text-sm">Quantos dias por semana você consegue treinar?</FormLabel><FormControl><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{['1–2 dias', '3 dias', '4 dias', '5 ou mais'].map((value) => <button type="button" key={value} onClick={() => field.onChange(value)} className={`panel-soft p-4 text-sm font-semibold transition ${field.value === value ? 'border-[#FFA213] text-[#FFA213]' : 'text-[#aeb7c6]'}`} data-testid={`button-frequencia-${value.replace(/\W/g, '').toLowerCase()}`}>{value}</button>)}</div></FormControl><FormMessage /></FormItem>} />
      <div className="flex items-start gap-3 text-xs text-[#8791a2]"><CircleHelp size={16} className="mt-0.5 shrink-0 text-[#FFA213]" />Você poderá ajustar sua rotina depois. Vamos usar apenas essa informação para concluir seu início.</div>
      <Button disabled={busy} type="submit" className="btn btn-primary w-full sm:w-auto" data-testid="button-questionario">{busy ? 'Salvando…' : 'Continuar para o PulseFit'}<ArrowRight size={17} className="ml-2" /></Button>
    </form></Form>
  </div></div></Protected>;
}
function useTreinos(cliente: Cliente | null) {
  return useQuery({ queryKey: ['treinos', cliente?.id], enabled: !!cliente, queryFn: async () => {
    const data = await request<unknown>('/api/treinos');
    return listFrom<Treino>(data, 'treinos').filter((item) => Number(item.idUsuario) === Number(cliente?.id));
  } });
}
function useAgenda(cliente: Cliente | null) {
  return useQuery({ queryKey: ['agenda', cliente?.id], enabled: !!cliente, queryFn: async () => listFrom<AgendaItem>(await request<unknown>(`/api/agenda?idUsuario=${cliente?.id}`), 'agenda') });
}
function ModalityTag({ value }: { value?: string }) {
  const cls = value?.toLowerCase() === 'musculacao' || value?.toLowerCase() === 'musculação' ? 'modality-musculacao' : value?.toLowerCase() === 'calistenia' ? 'modality-calistenia' : '';
  return <span className={`tag ${cls} ${cls ? 'text-white' : ''}`} data-testid="text-modalidade">{value || 'Modalidade não informada'}</span>;
}
function WorkoutCard({ workout }: { workout: Treino }) {
  const color = workout.modalidade?.toLowerCase().includes('calistenia') ? '#BA1650' : '#056C5C';
  return <Link href={`/treinos/${workout.id}`} className="workout-card panel block" data-testid={`card-treino-${workout.id}`}>
    <div className="h-1.5" style={{ backgroundColor: color }} /><div className="p-5"><div className="flex items-start justify-between gap-3"><ModalityTag value={workout.modalidade} /><ChevronRight size={18} className="text-[#8994a6]" /></div><h3 className="display mt-5 text-3xl uppercase leading-none text-[#e0e3e8]" data-testid={`text-treino-nome-${workout.id}`}>{workout.nome}</h3><p className="mt-2 line-clamp-2 min-h-10 text-sm text-[#929daf]">{workout.descricao || 'Um treino preparado para você avançar no seu ritmo.'}</p><div className="mt-4 flex items-center gap-2 text-xs text-[#a9b2c0]"><span className="tag">{workout.nivel || 'Nível flexível'}</span></div></div>
  </Link>;
}
function Inicio() {
  const cliente = useCliente(); const workouts = useTreinos(cliente); const agenda = useAgenda(cliente);
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const upcoming = useMemo(() => (agenda.data || []).filter((item) => item.status !== 'CONCLUIDO').sort((a,b) => new Date(a.dataAgendada).getTime() - new Date(b.dataAgendada).getTime())[0], [agenda.data]);
  const agendaTrain = workouts.data?.find((t) => t.id === upcoming?.idTreino);
  const loading = workouts.isLoading || agenda.isLoading;
  const error = workouts.error || agenda.error;
  const completedSessions = agenda.data?.filter((item) => item.status === 'CONCLUIDO').length ?? 0;
  const totalSessions = agenda.data?.length ?? 0;
  const progressPercent = totalSessions ? Math.round((completedSessions / totalSessions) * 100) : 0;
  return <div className="page-wrap"><Heading kicker={today} title={`Bom treino, ${cliente?.nome?.split(' ')[0] || 'atleta'}.`} detail="Seu próximo passo começa quando você decide se mover." />
    {error && <ErrorState message={friendlyError(error)} retry={() => { workouts.refetch(); agenda.refetch(); }} />}
    {loading ? <PageLoading /> : <div className="enter">
      <section className="relative mb-7 overflow-hidden rounded-[20px] border border-[#ffa21335] bg-[#202b40] p-6 sm:p-9"><div className="absolute -right-12 -top-12 h-56 w-56 rounded-full border border-[#ffa21326] shadow-[0_0_0_24px_#ffa21308,0_0_0_56px_#ffa21305]" /><div className="relative z-10 max-w-xl"><p className="eyebrow">SEU PRÓXIMO MOVIMENTO</p><h2 className="display mt-2 text-4xl uppercase leading-[.92] sm:text-6xl">{upcoming ? agendaTrain?.nome || 'Treino na agenda' : 'Construa sua consistência.'}</h2><p className="mt-3 max-w-md text-sm text-[#9ca6b6]">{upcoming ? `Sua sessão está marcada para ${new Date(upcoming.dataAgendada).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}.` : 'Escolha um treino e marque na sua agenda. O progresso é feito de pequenos começos.'}</p><Link href={upcoming ? '/agenda' : '/treinos'} className="btn btn-primary mt-5 inline-flex items-center" data-testid="link-proximo-passo">{upcoming ? 'Ver minha agenda' : 'Encontrar meu treino'}<ArrowRight size={16} className="ml-2" /></Link></div><div className="absolute bottom-5 right-8 hidden text-[#FFA213] opacity-80 sm:block"><Flame size={76} strokeWidth={1} /></div></section>
      <div className="mb-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><div className="panel-soft p-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#056C5C33] text-[#6ad8bd]"><Dumbbell size={19} /></span><div><p className="text-xs text-[#95a0b1]">TREINOS DISPONÍVEIS</p><p className="display text-3xl">{workouts.data?.length ?? 0}</p></div></div></div><div className="panel-soft p-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#FFA21320] text-[#FFA213]"><CalendarDays size={19} /></span><div><p className="text-xs text-[#95a0b1]">SESSÕES NA AGENDA</p><p className="display text-3xl">{agenda.data?.filter((item) => item.status !== 'CONCLUIDO').length ?? 0}</p></div></div></div><div className="panel-soft p-5" data-testid="card-progresso-agenda"><div className="flex items-center justify-between gap-3"><div><p className="text-xs text-[#95a0b1]">PROGRESSO DA AGENDA</p><p className="display text-3xl" data-testid="text-progresso-geral">{progressPercent}%</p></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#BA165022] text-[#ff82a8]"><Check size={19} /></span></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#344057]"><div className="h-full rounded-full bg-[#FFA213] transition-all" style={{ width: `${progressPercent}%` }} /></div><p className="mt-2 text-xs text-[#95a0b1]">{completedSessions} de {totalSessions} sessões concluídas</p></div></div>
      <div className="mb-4 flex items-end justify-between"><div><p className="eyebrow">FEITO PARA VOCÊ</p><h2 className="display mt-1 text-3xl uppercase">Seus treinos</h2></div><Link href="/treinos" className="text-sm font-bold text-[#FFA213]" data-testid="link-ver-treinos">Ver todos <ArrowRight size={14} className="inline" /></Link></div>
      {workouts.data?.length ? <div className="grid gap-4 sm:grid-cols-2">{workouts.data.slice(0,2).map((t) => <WorkoutCard key={t.id} workout={t} />)}</div> : <EmptyState title="Seu espaço está pronto." body={workouts.error ? 'Não foi possível carregar seus treinos agora.' : 'Ainda não há treinos disponíveis para sua conta. Volte em breve.'} />}
    </div>}
  </div>;
}
function Treinos() {
  const cliente = useCliente(); const query = useTreinos(cliente);
  return <div className="page-wrap"><Heading kicker="PLANO DE TREINO" title="Treinos" detail="Rotinas para construir força, habilidade e constância." />
    {query.isLoading ? <PageLoading /> : query.error ? <ErrorState message={friendlyError(query.error)} retry={() => query.refetch()} /> : query.data?.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{query.data.map((t) => <WorkoutCard key={t.id} workout={t} />)}</div> : <EmptyState title="Nenhum treino por aqui ainda." body="Quando houver um treino associado à sua conta, ele aparece nesta lista." />}
  </div>;
}
function TreinoDetalhe() {
  const params = useParams<{ id: string }>(); const id = Number(params.id);
  const treinoQuery = useTreinos(useCliente());
  const detail = useQuery({ queryKey: ['treino-detail', id], enabled: Number.isFinite(id), queryFn: async () => {
    const relations = listFrom<RelacaoExercicio>(await request<unknown>(`/api/treinos/${id}/exercicios`), 'exercicios');
    const settled = await Promise.allSettled(relations.map(async (relation) => {
      const exerciseId = relation.idExercicio ?? (typeof relation.id === 'object' ? relation.id?.idExercicio : undefined);
      if (!Number.isFinite(exerciseId)) throw new Error('A API não informou o exercício desta série.');
      return { relation, exercise: await request<Exercico>(`/api/exercicios/${exerciseId}`) };
    }));
    const exercises = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    exercises.sort((a,b) => Number(b.exercise.modalidade?.toLowerCase() === 'aquecimento') - Number(a.exercise.modalidade?.toLowerCase() === 'aquecimento'));
    return { exercises, failedCount: settled.length - exercises.length };
  } });
  const treino = treinoQuery.data?.find((item) => item.id === id);
  return <div className="page-wrap"><Link href="/treinos" className="mb-6 inline-flex items-center gap-2 text-sm text-[#9ba5b5]" data-testid="link-voltar-treinos"><ArrowLeft size={16} /> Todos os treinos</Link>
    {treinoQuery.isLoading || detail.isLoading ? <PageLoading /> : treinoQuery.error ? <ErrorState message={friendlyError(treinoQuery.error)} retry={() => treinoQuery.refetch()} /> : !treino ? <EmptyState title="Treino não encontrado." body="Este treino não está disponível na sua lista." action={<Link href="/treinos" className="btn btn-quiet" data-testid="link-voltar-lista">Voltar aos treinos</Link>} /> : <>
      <Heading kicker="DETALHES DO TREINO" title={treino.nome} detail={treino.descricao || 'Uma sessão para avançar no seu ritmo.'}><ModalityTag value={treino.modalidade} /></Heading>
      {detail.error && <ErrorState message={friendlyError(detail.error)} retry={() => detail.refetch()} />}
      {!detail.error && detail.data?.exercises.length === 0 && <EmptyState title="Exercícios indisponíveis." body="Este treino ainda não tem exercícios cadastrados." />}
      {detail.data?.failedCount ? <div className="mb-4 rounded-xl border border-[#FFA21355] bg-[#FFA21312] p-3 text-sm text-[#ffc66e]" data-testid="status-dados-parciais">{detail.data.failedCount} exercício(s) não puderam ser carregados. O restante do treino está disponível.</div> : null}
      <div className="space-y-3">{detail.data?.exercises.map(({ relation, exercise }, index) => {
        const warmup = exercise.modalidade?.toLowerCase() === 'aquecimento';
        return <article key={`${relation.idExercicio}-${index}`} className={`panel p-4 sm:p-5 ${warmup ? 'border-l-4 border-l-[#FFA213]' : ''}`} data-testid={`card-exercicio-treino-${exercise.id}`}>
          <div className="flex items-start gap-4"><span className="mono pt-1 text-xs text-[#6f7b8f]">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2">{warmup && <span className="tag bg-[#FFA213] text-[#172033]" data-testid={`tag-aquecimento-${exercise.id}`}>Aquecimento</span>}<span className="tag">{exercise.grupoMuscular || exercise.modalidade || 'Exercício'}</span></div><h3 className="display mt-3 text-2xl uppercase text-[#e0e3e8]">{exercise.nome}</h3><p className="mt-1 text-sm text-[#929daf]">{exercise.descricao || 'Descrição não informada.'}</p></div><div className="text-right text-xs text-[#aab3c1]"><p>{relation.series ?? '—'} séries</p><p className="mt-1">{relation.repeticoes ?? '—'} repetições</p>{relation.carga && <p className="mt-1">{relation.carga}</p>}</div></div>
        </article>;
      })}</div>
    </>}
  </div>;
}
function Agenda() {
  const cliente = useCliente(); const query = useAgenda(cliente); const treinos = useTreinos(cliente);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busyId, setBusyId] = useState<number | null>(null); const [showForm, setShowForm] = useState(false);
  const today = new Date(); const maxDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const form = useForm<{ idTreino: string; dataAgendada: string }>({ defaultValues: { idTreino: '', dataAgendada: '' } });
  async function create(values: { idTreino: string; dataAgendada: string }) {
    if (!cliente) return;
    setError(''); setNotice('');
    const date = new Date(values.dataAgendada);
    if (date > maxDate || date < new Date(today.toDateString())) { setError('Escolha uma data entre hoje e os próximos 30 dias.'); return; }
    try {
      await request('/api/agenda', { method: 'POST', body: JSON.stringify({ idUsuario: cliente.id, idTreino: Number(values.idTreino), dataAgendada: date.toISOString() }) });
      setNotice('Treino adicionado à sua agenda.'); form.reset({ idTreino: '', dataAgendada: '' }); setShowForm(false); await query.refetch();
    } catch (e) { setError(friendlyError(e)); }
  }
  async function complete(item: AgendaItem) {
    setBusyId(item.id); setError(''); setNotice('');
    try { await request(`/api/agenda/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'CONCLUIDO' }) }); setNotice('Sessão concluída. A próxima etapa já pode ser liberada.'); await query.refetch(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusyId(null); }
  }
  const ordered = [...(query.data || [])].sort((a,b) => new Date(a.dataAgendada).getTime() - new Date(b.dataAgendada).getTime());
  const minInput = new Date(today.getTime() - today.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const maxInput = new Date(maxDate.getTime() - maxDate.getTimezoneOffset()*60000).toISOString().slice(0,16);
  return <div className="page-wrap"><Heading kicker="RITMO E CONSTÂNCIA" title="Sua agenda" detail="Planeje seu próximo encontro com o movimento."><button className="btn btn-primary inline-flex items-center justify-center" onClick={() => setShowForm((v) => !v)} data-testid="button-novo-agendamento">{showForm ? <X size={16} className="mr-2" /> : <CalendarDays size={16} className="mr-2" />}{showForm ? 'Fechar' : 'Agendar treino'}</button></Heading>
    {error && <div className="error-box mb-5" role="alert" data-testid="status-agenda-error">{error}</div>}{notice && <div className="mb-5 rounded-xl border border-[#056c5c] bg-[#056c5c22] p-3 text-sm text-[#8ce1c8]" role="status" data-testid="status-agenda-success">{notice}</div>}
    {showForm && <div className="panel mb-6 p-5 sm:p-6"><h2 className="display mb-5 text-3xl uppercase">Marque seu próximo treino</h2><Form {...form}><form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit(create)}>
      <FormField control={form.control} name="idTreino" rules={{ required: 'Escolha um treino.' }} render={({ field }) => <FormItem><FormLabel className="label">Treino</FormLabel><FormControl><select {...field} className="field" data-testid="select-agenda-treino"><option value="">Selecione um treino</option>{treinos.data?.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="dataAgendada" rules={{ required: 'Escolha uma data e horário.' }} render={({ field }) => <FormItem><FormLabel className="label">Data e horário</FormLabel><FormControl><Input {...field} type="datetime-local" min={minInput} max={maxInput} className="field" data-testid="input-agenda-data" /></FormControl><FormMessage /></FormItem>} />
      <Button type="submit" disabled={!treinos.data?.length} className="btn btn-primary sm:col-span-2 sm:w-fit" data-testid="button-salvar-agendamento">Salvar na agenda</Button>
    </form></Form></div>}
    {(query.isLoading || treinos.isLoading) ? <PageLoading /> : query.error ? <ErrorState message={friendlyError(query.error)} retry={() => query.refetch()} /> : !ordered.length ? <EmptyState title="Sua agenda está livre." body="Escolha um treino e reserve um momento para você." action={<button className="btn btn-primary" onClick={() => setShowForm(true)} data-testid="button-agendar-vazio">Agendar um treino</button>} /> : <div className="space-y-3">{ordered.map((item) => {
      const workout = treinos.data?.find((t) => t.id === item.idTreino);
      const completed = item.status === 'CONCLUIDO'; const locked = !item.liberado && !completed;
      return <article className={`panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center ${locked ? 'opacity-65' : ''}`} key={item.id} data-testid={`card-agenda-${item.id}`}>
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#303c52] text-[#FFA213]"><CalendarDays size={21} /></div>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="display text-2xl uppercase">{workout?.nome || `Treino ${item.idTreino}`}</h3>{locked && <span className="tag"><LockKeyhole size={11} className="mr-1" />Bloqueado</span>}{completed && <span className="tag bg-[#056c5c] text-white"><Check size={11} className="mr-1" />Concluído</span>}</div><p className="mt-1 flex items-center gap-2 text-sm text-[#9ca6b6]"><Clock3 size={14} />{new Date(item.dataAgendada).toLocaleString('pt-BR', { dateStyle:'long', timeStyle:'short' })}</p></div>
        {!completed && <button disabled={locked || busyId === item.id} className="btn btn-quiet inline-flex items-center justify-center" onClick={() => complete(item)} data-testid={`button-concluir-${item.id}`}>{busyId === item.id ? 'Salvando…' : locked ? 'Aguardando liberação' : 'Concluir sessão'}{!locked && <Check size={15} className="ml-2" />}</button>}
      </article>;
    })}</div>}
  </div>;
}
function Exercicios() {
  const [search, setSearch] = useState(''); const [modality, setModality] = useState('Todas'); const [level, setLevel] = useState('Todos');
  const query = useQuery({ queryKey: ['exercicios'], queryFn: async () => listFrom<Exercico>(await request<unknown>('/api/exercicios'), 'exercicios') });
  const filtered = useMemo(() => (query.data || []).filter((e) => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    const matchesText = !term || `${e.nome} ${e.grupoMuscular || ''}`.toLocaleLowerCase('pt-BR').includes(term);
    const matchesModality = modality === 'Todas' || e.modalidade?.toLocaleLowerCase() === modality.toLocaleLowerCase();
    const matchesLevel = level === 'Todos' || !e.nivel || e.nivel.toLocaleLowerCase() === level.toLocaleLowerCase();
    return matchesText && matchesModality && matchesLevel;
  }), [query.data, search, modality, level]);
  const modalities = ['Todas', ...new Set((query.data || []).map((x) => x.modalidade).filter(Boolean) as string[])];
  const levels = ['Todos', ...new Set((query.data || []).map((x) => x.nivel).filter(Boolean) as string[])];
  return <div className="page-wrap"><Heading kicker="BIBLIOTECA DE MOVIMENTOS" title="Exercícios" detail="Conheça os movimentos e descubra novas possibilidades." />
    <div className="panel mb-6 grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto]"><label className="relative"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8791a2]" /><input className="field pl-10" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou grupo muscular" data-testid="input-busca-exercicio" /></label><select className="field sm:w-44" value={modality} onChange={(e) => setModality(e.target.value)} aria-label="Filtrar por modalidade" data-testid="select-modalidade"><option value="Todas">Todas as modalidades</option>{modalities.filter((m) => m !== 'Todas').map((m) => <option key={m}>{m}</option>)}</select><select className="field sm:w-40" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filtrar por nível" data-testid="select-nivel-exercicio"><option value="Todos">Todos os níveis</option>{levels.filter((v) => v !== 'Todos').map((v) => <option key={v}>{v}</option>)}</select></div>
    {query.isLoading ? <PageLoading /> : query.error ? <ErrorState message={friendlyError(query.error)} retry={() => query.refetch()} /> : filtered.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{filtered.map((exercise) => <Link href={`/exercicios/${exercise.id}`} key={exercise.id} className="panel block p-5 transition hover:-translate-y-1 hover:border-[#FFA21355]" data-testid={`card-exercicio-${exercise.id}`}><div className="flex items-center justify-between"><span className="tag">{exercise.grupoMuscular || 'Grupo não informado'}</span><ChevronRight size={17} className="text-[#808ca0]" /></div><h2 className="display mt-5 text-3xl uppercase">{exercise.nome}</h2><p className="mt-2 line-clamp-2 min-h-10 text-sm text-[#929daf]">{exercise.descricao || 'Explore os detalhes deste movimento.'}</p><div className="mt-4 flex flex-wrap gap-2">{exercise.modalidade && <ModalityTag value={exercise.modalidade} />}{exercise.nivel && <span className="tag">{exercise.nivel}</span>}</div></Link>)}</div> : <EmptyState title="Nenhum movimento encontrado." body={query.data?.length ? 'Tente outro termo ou remova algum filtro.' : 'A biblioteca ainda não tem exercícios cadastrados.'} action={Boolean(search || modality !== 'Todas' || level !== 'Todos') ? <button className="btn btn-quiet" onClick={() => { setSearch(''); setModality('Todas'); setLevel('Todos'); }} data-testid="button-limpar-filtros">Limpar filtros</button> : undefined} />}
  </div>;
}
function ExercicioDetalhe() {
  const params = useParams<{ id: string }>(); const id = Number(params.id);
  const query = useQuery({ queryKey: ['exercicio', id], enabled: Number.isFinite(id), queryFn: () => request<Exercico>(`/api/exercicios/${id}`) });
  const video = query.data?.demonstracaoVideo;
  const videoUrl = video ? (/^https?:\/\//i.test(video) ? video : `https://www.youtube.com/watch?v=${video}`) : '';
  return <div className="page-wrap"><Link href="/exercicios" className="mb-6 inline-flex items-center gap-2 text-sm text-[#9ba5b5]" data-testid="link-voltar-exercicios"><ArrowLeft size={16} /> Biblioteca de exercícios</Link>{query.isLoading ? <PageLoading /> : query.error ? <ErrorState message={friendlyError(query.error)} retry={() => query.refetch()} /> : !query.data ? <EmptyState title="Exercício não encontrado." body="Este movimento não está disponível." /> : <article className="panel max-w-3xl p-6 sm:p-9" data-testid={`detail-exercicio-${id}`}><p className="eyebrow">GUIA DE MOVIMENTO</p><div className="mt-3 flex flex-wrap gap-2">{query.data.grupoMuscular && <span className="tag">{query.data.grupoMuscular}</span>}{query.data.modalidade && <ModalityTag value={query.data.modalidade} />}{query.data.nivel && <span className="tag">{query.data.nivel}</span>}</div><h1 className="page-title mt-5">{query.data.nome}</h1><p className="mt-5 text-base leading-relaxed text-[#aeb7c6]" data-testid="text-exercicio-descricao">{query.data.descricao || 'Descrição não informada.'}</p>{videoUrl ? <a href={videoUrl} target="_blank" rel="noreferrer" className="btn btn-primary mt-7 inline-flex items-center" data-testid="link-video-exercicio"><Video size={17} className="mr-2" />Assistir demonstração<ArrowRight size={15} className="ml-2" /></a> : <div className="mt-7 rounded-xl border border-[#344057] p-4 text-sm text-[#8791a2]" data-testid="status-video-indisponivel">Vídeo de demonstração não disponível para este exercício.</div>}</article>}</div>;
}
function Perfil() {
  const cliente = useCliente(); const [, setLocation] = useLocation();
  const query = useQuery({ queryKey: ['cliente', cliente?.id], enabled: !!cliente, queryFn: () => request<Cliente>(`/api/clientes/${cliente?.id}`) });
  const profile = query.data || cliente;
  function logout() { clearCliente(); queryClient.clear(); setLocation('/login'); }
  return <div className="page-wrap"><Heading kicker="SUA CONTA" title="Perfil" detail="Seus dados, no seu espaço." />
    {query.isLoading ? <PageLoading /> : query.error ? <ErrorState message={friendlyError(query.error)} retry={() => query.refetch()} /> : <div className="grid max-w-3xl gap-5 md:grid-cols-[220px_1fr]"><div className="panel flex flex-col items-center justify-center p-7 text-center"><div className="grid h-24 w-24 place-items-center rounded-full border border-[#FFA21355] bg-[#FFA21316] text-3xl font-bold text-[#FFA213]">{profile?.nome?.trim().slice(0,1).toLocaleUpperCase() || 'P'}</div><h2 className="display mt-4 text-3xl uppercase" data-testid="text-perfil-nome">{profile?.nome || 'Atleta PulseFit'}</h2><span className="tag mt-2">{profile?.nivelExperiencia || 'Nível não informado'}</span></div><div className="panel p-6"><p className="eyebrow">DADOS PESSOAIS</p><dl className="mt-5 space-y-5"><div><dt className="text-xs uppercase tracking-wider text-[#7f8a9d]">E-mail</dt><dd className="mt-1 text-sm" data-testid="text-perfil-email">{profile?.email || 'Não informado'}</dd></div><div><dt className="text-xs uppercase tracking-wider text-[#7f8a9d]">Idade</dt><dd className="mt-1 text-sm" data-testid="text-perfil-idade">{profile?.idade ? `${profile.idade} anos` : 'Não informada'}</dd></div><div><dt className="text-xs uppercase tracking-wider text-[#7f8a9d]">Sexo</dt><dd className="mt-1 text-sm">{profile?.sexo || 'Não informado'}</dd></div></dl><button onClick={logout} className="btn btn-quiet mt-8 inline-flex items-center border-[#ba165066] text-[#ff91ae]" data-testid="button-logout"><LogOut size={16} className="mr-2" />Sair da conta</button></div></div>}
  </div>;
}
function AuthRedirect({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const cliente = useCliente();
  const destination = cliente && ['iniciante', 'beginner'].includes(cliente.nivelExperiencia?.toLowerCase() || '') && isQuestionarioPendente() ? '/questionario' : '/inicio';
  useEffect(() => { if (cliente) setLocation(destination); }, [cliente, destination, setLocation]);
  if (cliente) return null;
  return <>{children}</>;
}
function RoutedApp() {
  return <Switch>
    <Route path="/login"><AuthRedirect><Login /></AuthRedirect></Route>
    <Route path="/cadastro"><AuthRedirect><Cadastro /></AuthRedirect></Route>
    <Route path="/questionario"><Questionario /></Route>
    <Route path="/inicio"><Protected><Inicio /></Protected></Route>
    <Route path="/treinos"><Protected><Treinos /></Protected></Route>
    <Route path="/treinos/:id"><Protected><TreinoDetalhe /></Protected></Route>
    <Route path="/agenda"><Protected><Agenda /></Protected></Route>
    <Route path="/exercicios"><Protected><Exercicios /></Protected></Route>
    <Route path="/exercicios/:id"><Protected><ExercicioDetalhe /></Protected></Route>
    <Route path="/perfil"><Protected><Perfil /></Protected></Route>
    <Route path="/"><AuthRedirect><Login /></AuthRedirect></Route>
    <Route component={NotFound} />
  </Switch>;
}
function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedApp /></WouterRouter></QueryClientProvider>;
}
export default App;

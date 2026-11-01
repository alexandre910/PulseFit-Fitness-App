type Props = {
  level?: string | null;
  modality?: string | null;
  className?: string;
};

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export default function ExerciseLevelBadge({ level, modality, className = '' }: Props) {
  const rawLevel = level?.trim();
  const normalizedLevel = normalize(rawLevel || '');
  const isWarmup = !normalizedLevel && normalize(modality || '') === 'aquecimento';
  const label = isWarmup
    ? 'Aquecimento'
    : normalizedLevel === 'iniciante'
      ? 'Iniciante'
      : normalizedLevel === 'intermediario'
        ? 'Intermediário'
        : normalizedLevel === 'avancado'
          ? 'Avançado'
          : rawLevel;

  if (!label) return null;

  const backgroundColor = normalizedLevel === 'avancado'
    ? '#FFA213'
    : normalizedLevel === 'intermediario'
      ? '#056C5C'
      : '#CCCCCC';
  const color = normalizedLevel === 'intermediario' ? '#FFFFFF' : '#172033';

  return <span
    className={`exercise-level-badge inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold leading-none ${className}`.trim()}
    style={{ backgroundColor, color }}
    data-testid={`badge-exercise-level-${normalize(label).replace(/\s+/g, '-')}`}
  >{label}</span>;
}

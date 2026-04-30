type Source = 'TTS' | 'WMC' | 'DERIVED' | 'ML';

const styles: Record<Source, string> = {
  TTS:     'bg-noc-tts/20    text-noc-tts    border-noc-tts/40',
  WMC:     'bg-noc-wmc/20    text-noc-wmc    border-noc-wmc/40',
  DERIVED: 'bg-noc-info/20   text-noc-info   border-noc-info/40',
  ML:      'bg-noc-accent/20 text-noc-accent border-noc-accent/40',
};

export function SourceBadge({ source }: { source: Source }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] mono uppercase tracking-wider rounded border ${styles[source]}`}>
      {source}
    </span>
  );
}

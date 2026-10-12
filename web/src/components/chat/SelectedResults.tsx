import { updateVoiceSearch, type VoiceSearch } from '../../lib/voiceSearch';
import ArticleCard from './ArticleCard';
import ProductCards from './ProductCards';
import ChatLink, { ChatLinkSources } from './ChatLink';

/** Selection is persisted server data; prose and Markdown cannot add cards. */
export default function SelectedResults({ search }: { search?: VoiceSearch | null }) {
  if (search?.presentationVersion !== 1) return null;
  const safe = updateVoiceSearch(null, {...search, phase: search.phase === 'start' ? 'complete' : search.phase});
  if (!safe?.presentations?.length) return null;
  return <div className="chat-md"><ChatLinkSources.Provider value={safe.sources}>
    {safe.presentations.map(group => {
      const selected = group.ids.map(id => safe.sources.find(source => source.id === id)!);
      const readable = selected.filter(source => !source.blocked);
      const blocked = selected.filter(source => source.blocked);
      return <section key={group.kind} aria-label={group.kind === 'products' ? 'Selected products' : 'Selected articles'}>
        {group.kind === 'products' ? readable.length > 0 && <ProductCards products={{title: 'Products', items: readable.map(source => ({title: source.title, url: source.url}))}} /> :
          readable.map(source => <ArticleCard key={source.id} href={source.url}>{source.title}</ArticleCard>)}
        {blocked.map(source => <p key={source.id}><ChatLink href={source.url}>{source.title}</ChatLink></p>)}
      </section>;
    })}
  </ChatLinkSources.Provider></div>;
}

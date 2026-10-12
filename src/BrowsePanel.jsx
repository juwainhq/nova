import { BROWSE_KINDS } from './web-browse.js';

// Search results beside NOVA. The sandbox keeps Google's page from navigating
// NOVA itself; links that open new windows still can, when the user clicks them.
export default function BrowsePanel({ browse, onClose }) {
  const kind = BROWSE_KINDS[browse.kind] || BROWSE_KINDS.web;
  return (
    <aside className={`browse-panel${browse.closing ? ' is-closing' : ''}`} aria-label={`${kind} results for ${browse.query}`} aria-hidden={browse.closing || undefined}>
      <header className="browse-header">
        <span className="browse-kind">{kind}</span>
        <h2 className="browse-query" title={browse.query}>{browse.query}</h2>
        <button className="browse-close" type="button" aria-label="Close search panel" disabled={browse.closing} onClick={onClose}>×</button>
      </header>
      <iframe
        key={browse.url}
        className="browse-frame"
        src={browse.url}
        title={`Google ${kind.toLowerCase()} results for ${browse.query}`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        allow="fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </aside>
  );
}

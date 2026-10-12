function OpenLinkIcon() {
  return (
    <svg className="rich-open-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M14 4h6v6m0-6L10 14M10 5H5v14h14v-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ImagePlaceholder() {
  return (
    <div className="rich-image-placeholder" aria-hidden="true">
      <svg viewBox="0 0 80 56" fill="none" focusable="false">
        <rect x="1" y="1" width="78" height="54" rx="8" stroke="currentColor" />
        <circle cx="57" cy="17" r="5" fill="currentColor" opacity=".6" />
        <path d="m10 45 18-20 14 14 9-10 19 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Image search</span>
    </div>
  );
}

// Anchors provide native, keyboard-accessible new-tab navigation. Model text is
// rendered as escaped text only; the thumbnail is an honest local placeholder.
export default function RichResponsePanel({ content, closing = false, onClose }) {
  return (
    <section className={`rich-content-panel${closing ? ' is-closing' : ''}`} aria-labelledby="rich-content-title" aria-hidden={closing || undefined} inert={closing ? '' : undefined} tabIndex={closing ? -1 : 0}>
      <header className="rich-content-header">
        <div><h2 id="rich-content-title">A little more for you</h2><p>From my reply · here for 30 seconds</p></div>
        <button className="text-button rich-content-close" type="button" aria-label="Close extra content" disabled={closing} onClick={onClose}>×</button>
      </header>
      {content.images.length > 0 && <div className="rich-images">
        {content.images.map((image) => <article className="rich-image-card" key={image.href}>
          <ImagePlaceholder />
          <div><h3>{image.query}</h3><p>Explore pictures on Google Images.</p>
            <a className="rich-image-button" href={image.href} target="_blank" rel="noopener noreferrer" tabIndex={closing ? -1 : undefined} aria-label={`View images of ${image.query} on Google Images (opens in a new tab)`}>View Images <OpenLinkIcon /></a>
          </div>
        </article>)}
      </div>}
      {content.links.length > 0 && <div className="rich-links" aria-label="Links from my reply">
        {content.links.map((link) => <a className="rich-link-card" key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" tabIndex={closing ? -1 : undefined} title={link.href} aria-label={`Open ${link.domain} in a new tab`}>
          <span><strong>{link.domain}</strong><small>{link.detail === '/' ? 'Open website' : link.detail}</small></span><OpenLinkIcon />
        </a>)}
      </div>}
      {content.items.length > 0 && <ul className="rich-items" aria-label="Items from my reply">
        {content.items.map((item, index) => <li className="rich-item-card" key={index}>{item}</li>)}
      </ul>}
      {content.truncated && <p className="field-hint">There’s more in my full reply. Turn on Show last response in Settings to read it.</p>}
    </section>
  );
}

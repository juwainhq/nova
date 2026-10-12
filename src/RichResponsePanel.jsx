import { useState } from 'react';
import { galleryAfterError, galleryStart } from './web-browse.js';

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

// Three found pictures; one that fails to load is replaced by the next unused
// candidate, and the Google Images placeholder returns if none load.
function ImageGallery({ image, closing }) {
  const { pictures } = image;
  const [shown, setShown] = useState(() => galleryStart(pictures.length));
  const failed = (slot) => setShown((state) => galleryAfterError(state, slot, pictures.length));
  if (shown.slots.every((index) => index < 0)) return <ImageSearchCard image={image} closing={closing} />;
  return (
    <article className="rich-image-gallery">
      <header><h3>{image.query}</h3>
        <a href={image.href} target="_blank" rel="noopener noreferrer" tabIndex={closing ? -1 : undefined} aria-label={`More images of ${image.query} on Google Images (opens in a new tab)`}>More on Google Images <OpenLinkIcon /></a>
      </header>
      <div className="rich-image-results">
        {shown.slots.map((index, slot) => index >= 0 && <a className="rich-image-result" key={`${slot}-${index}`} href={pictures[index].full} target="_blank" rel="noopener noreferrer" tabIndex={closing ? -1 : undefined} title={pictures[index].title || image.query} aria-label={`Open full-size image${pictures[index].title ? `: ${pictures[index].title}` : ''} (new tab)`}>
          <img src={pictures[index].thumb} alt={pictures[index].title || image.query} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => failed(slot)} />
          <span>{pictures[index].source}</span>
        </a>)}
      </div>
    </article>
  );
}

function ImageSearchCard({ image, closing }) {
  return (
    <article className="rich-image-card">
      <ImagePlaceholder />
      <div><h3>{image.query}</h3><p>Explore pictures on Google Images.</p>
        <a className="rich-image-button" href={image.href} target="_blank" rel="noopener noreferrer" tabIndex={closing ? -1 : undefined} aria-label={`View images of ${image.query} on Google Images (opens in a new tab)`}>View Images <OpenLinkIcon /></a>
      </div>
    </article>
  );
}

// Anchors provide native, keyboard-accessible new-tab navigation. Model text is
// rendered as escaped text only; found pictures are https thumbnails, otherwise a local placeholder.
export default function RichResponsePanel({ content, closing = false, onClose }) {
  return (
    <section className={`rich-content-panel${closing ? ' is-closing' : ''}`} aria-labelledby="rich-content-title" aria-hidden={closing || undefined} inert={closing ? '' : undefined} tabIndex={closing ? -1 : 0}>
      <header className="rich-content-header">
        <div><h2 id="rich-content-title">A little more for you</h2><p>From my reply · here for 30 seconds</p></div>
        <button className="text-button rich-content-close" type="button" aria-label="Close extra content" disabled={closing} onClick={onClose}>×</button>
      </header>
      {content.images.length > 0 && <div className="rich-images">
        {content.images.map((image) => (image.pictures?.length
          ? <ImageGallery image={image} closing={closing} key={image.href} />
          : <ImageSearchCard image={image} closing={closing} key={image.href} />))}
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

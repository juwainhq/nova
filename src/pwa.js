// Called once from the production entry, outside React and the voice lifecycle.
// Unsupported/insecure contexts simply retain the normal online app.
export async function registerPwa() {
  if (!globalThis.isSecureContext || !globalThis.navigator?.serviceWorker
    || !/^https?:$/.test(globalThis.location?.protocol || '')) return null;
  try {
    const directory = new URL('./', document.baseURI);
    return await navigator.serviceWorker.register(new URL('sw.js', directory).href, {
      scope: directory.href,
      updateViaCache: 'none',
    });
  } catch (error) {
    console.warn('NOVA offline support could not be enabled. The online app is still available.', error);
    return null;
  }
}

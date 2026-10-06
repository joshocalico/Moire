# Dictionary

`@moire/dictionary` looks up English words and phrases, then keeps successful
entries for offline use. Its launcher entry is `moire-dictionary.desktop`,
command `moire-dictionary`, and app ID `org.moire.Dictionary`.

Type a word and press Enter or Look up. New lookups use the credential-free
[Free Dictionary API](https://dictionaryapi.dev/) documented endpoint
`https://api.dictionaryapi.dev/api/v2/entries/en/<word>`. No request runs before
an explicit lookup. Definitions include part of speech, pronunciation text,
and examples when the service supplies them. Pronunciation symbols that the
bundled font cannot display produce an explicit unavailable message.

Existing cached entries are read first. The cache is
`$XDG_CACHE_HOME/moire/dictionary`, or `~/.cache/moire/dictionary`; entries use
hashed query filenames, mode 0600, and atomic replacement. A corrupt cached
entry can be replaced by a valid online response. The app validates response
shapes before rendering or caching them.

Requests have an eight-second timeout. A subsequent lookup cancels the old
request; stale results cannot replace the current entry. Closing the app also
cancels its request. Offline, missing-word, service, and cache-write errors have
separate visible states. A successful online definition remains visible even
if the local cache cannot be written.

The app does not bundle an offline definition database or play pronunciation
audio. Uncached words need network access; service availability and definition
coverage are external. The service is English-only.

Run `pnpm --filter @moire/dictionary smoke` for disposable cache/schema/error
fixtures and actual Window lookup. Tests use supplied HTTP responses and never
contact the public service.

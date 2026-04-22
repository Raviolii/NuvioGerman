// Filmpalast Scraper for Nuvio Local Scrapers

const cheerio = require('cheerio-without-node-native');

const BASE_URL = 'https://filmpalast.to';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Referer': BASE_URL
};

// ================= HELPERS =================

function getImdbId(tmdbId, type) {
    const targetType = type === 'series' ? 'tv' : 'movie';
    return fetch(`${TMDB_BASE_URL}/${targetType}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => data?.imdb_id || null)
        .catch(() => null);
}

function fetchAutocomplete(imdbId) {
    const url = `${BASE_URL}/autocomplete.php`;
    const body = `term=${encodeURIComponent(imdbId)}`;

    return fetch(url, {
        method: 'POST',
        headers: {
            ...DEFAULT_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: body
    })
    .then(r => r.ok ? r.json() : [])
    .then(movieList => {
        if (!Array.isArray(movieList) || movieList.length === 0) return null;
        return movieList.find(t => !t.toLowerCase().includes('english')) || movieList[0];
    })
    .catch(() => null);
}

// ================= MAIN =================

function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    return getImdbId(tmdbId, mediaType).then(imdbId => {
        if (!imdbId) return [];

        return fetchAutocomplete(imdbId).then(filteredResult => {
            if (!filteredResult) return [];

            const searchPageURL = `${BASE_URL}/search/title/${encodeURIComponent(filteredResult)}`;

            return fetch(searchPageURL, { headers: DEFAULT_HEADERS })
                .then(r => r.ok ? r.text() : '')
                .then(html => {
                    const $ = cheerio.load(html);
                    let streamPageUrl = null;

                    const streamAnchor = $('a[href*="filmpalast.to/stream/"]').first();

                    if (streamAnchor.length > 0) {
                        const href = streamAnchor.attr('href');
                        if (href) {
                            if (href.startsWith('http')) streamPageUrl = href;
                            else if (href.startsWith('//')) streamPageUrl = `https:${href}`;
                            else streamPageUrl = `${BASE_URL}${href}`;
                        }
                    } else if (html.includes('currentStreamLinks')) {
                        streamPageUrl = searchPageURL;
                    }

                    if (!streamPageUrl) return [];

                    return fetch(streamPageUrl, { headers: DEFAULT_HEADERS })
                        .then(r => r.ok ? r.text() : '')
                        .then(streamHtml => {
                            const $stream = cheerio.load(streamHtml);
                            const results = [];
                            
                            const linkElements = $stream(
                                '.currentStreamLinks a, .hosterSite span a, .streamList a'
                            );

                            linkElements.each((_, element) => {
                                const href = $stream(element).attr('href');
                                let hosterName = $stream(element).text().trim();

                                if (href && href !== '#' && !href.includes('javascript:void')) {
                                    let fullUrl;
                                    if (href.startsWith('http')) fullUrl = href;
                                    else if (href.startsWith('//')) fullUrl = `https:${href}`;
                                    else fullUrl = `https://${href}`;

                                    if (!hosterName || !isNaN(Number(hosterName))) {
                                        hosterName = $stream(element).attr('title') || 'Stream';
                                    }

                                    results.push({
                                        // Top line display
                                        name: `⌜ Filmpalast ⌟ | ${hosterName}`,
                                        // This is what will show the URL in the UI instead of the TMDB title
                                        title: fullUrl, 
                                        url: fullUrl,
                                        quality: '', // Left blank to prevent "HD" from overriding the display
                                        provider: 'Filmpalast',
                                        headers: {
                                            'Referer': BASE_URL,
                                            'User-Agent': DEFAULT_HEADERS['User-Agent']
                                        }
                                    });
                                }
                            });

                            return results;
                        });
                });
        });
    })
    .catch(err => {
        console.error(`[Filmpalast] Scraper Error: ${err.message}`);
        return [];
    });
}

// ================= EXPORT =================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = { getStreams };
}

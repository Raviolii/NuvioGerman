// Filmpalast Scraper for Nuvio Local Scrapers
// Structure matched to FilmpalastTO Source class

const cheerio = require('cheerio-without-node-native');

const BASE_URL = 'https://filmpalast.to';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Referer': BASE_URL
};

// ================= HELPERS =================

/**
 * Converts Nuvio TMDB ID to IMDB ID for Autocomplete
 */
function getImdbId(tmdbId, type) {
    const targetType = type === 'series' ? 'tv' : 'movie';
    return fetch(`${TMDB_BASE_URL}/${targetType}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => data?.imdb_id || null)
        .catch(() => null);
}

// ================= MAIN =================

async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    const results = [];
    
    try {
        // 0. Get IMDB ID (Required for the autocomplete logic below)
        const imdbId = await getImdbId(tmdbId, mediaType);
        if (!imdbId) return [];

        // Step 1: Autocomplete
        const autocompleteUrl = `${BASE_URL}/autocomplete.php`;
        const response = await fetch(autocompleteUrl, {
            method: 'POST',
            headers: {
                ...DEFAULT_HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: `term=${encodeURIComponent(imdbId)}`
        });

        const movieList = await response.json();
        if (!Array.isArray(movieList) || movieList.length === 0) return [];

        const filteredResult = movieList.find(title => 
            !title.toLowerCase().includes('english')
        ) || movieList[0];

        const searchPageURL = `${BASE_URL}/search/title/${encodeURIComponent(filteredResult)}`;

        // Step 2: Find stream page
        const html = await fetch(searchPageURL, { headers: DEFAULT_HEADERS }).then(r => r.text());
        const $ = cheerio.load(html);

        let streamPageUrl;
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

        // Step 3: Extract hoster links
        const streamHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        const $stream = cheerio.load(streamHtml);

        const linkElements = $stream(
            '.currentStreamLinks a, .hosterSite span a, .streamList a'
        );

        linkElements.each((_, element) => {
            const href = $stream(element).attr('href');

            if (href && href !== '#' && !href.includes('javascript:void')) {
                let fullUrl;
                if (href.startsWith('http')) fullUrl = href;
                else if (href.startsWith('//')) fullUrl = `https:${href}`;
                else fullUrl = `https://${href}`;

                // Logic to push results exactly as the Source class
                try {
                    results.push({
                        url: fullUrl,
                        meta: {
                            // SHOW COMPLETE URL AS TITLE
                            title: fullUrl, 
                            countryCodes: ['de']
                        }
                    });
                } catch (e) {
                    // ignore invalid URLs
                }
            }
        });

        console.info(`[Filmpalast] Successfully added ${results.length} results for ${imdbId}`);
    } catch (error) {
        console.error(`[Filmpalast] Scraper failed: ${error.message}`);
    }

    return results;
}

// ================= EXPORT =================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = { getStreams };
}

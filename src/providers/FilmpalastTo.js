// Filmpalast Scraper for Nuvio Local Scrapers
const cheerio = require('cheerio-without-node-native');

// Import the VOE extractor from the specified path
const { extractVoe } = require('../extractor/voe');

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

// ================= MAIN =================

async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    const results = [];
    
    try {
        const imdbId = await getImdbId(tmdbId, mediaType);
        if (!imdbId) return [];

        // Step 1: Autocomplete search via IMDB ID
        const response = await fetch(`${BASE_URL}/autocomplete.php`, {
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

        const filteredResult = movieList.find(t => !t.toLowerCase().includes('english')) || movieList[0];
        const searchPageURL = `${BASE_URL}/search/title/${encodeURIComponent(filteredResult)}`;

        // Step 2: Find the stream page
        const html = await fetch(searchPageURL, { headers: DEFAULT_HEADERS }).then(r => r.text());
        const $ = cheerio.load(html);

        let streamPageUrl;
        const streamAnchor = $('a[href*="filmpalast.to/stream/"]').first();
        if (streamAnchor.length > 0) {
            const href = streamAnchor.attr('href');
            streamPageUrl = href.startsWith('http') ? href : (href.startsWith('//') ? `https:${href}` : `${BASE_URL}${href}`);
        } else if (html.includes('currentStreamLinks')) {
            streamPageUrl = searchPageURL;
        }

        if (!streamPageUrl) return [];

        // Step 3: Extract and Filter Hoster Links
        const streamHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        const $stream = cheerio.load(streamHtml);
        const linkElements = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a');

        // Use for...of to handle the async calls to the VOE extractor
        for (const element of linkElements.toArray()) {
            const href = $stream(element).attr('href');
            if (!href || href === '#' || href.includes('javascript:void')) continue;

            const fullUrl = href.startsWith('http') ? href : (href.startsWith('//') ? `https:${href}` : `https://${href}`);

            // --- STRICT FILTER: ONLY PASS VOE LINKS ---
            if (fullUrl.includes('voe.sx')) {
                try {
                    const extractedData = await extractVoe(fullUrl);
                    
                    if (extractedData) {
                        // If extractVoe returns an array of links
                        if (Array.isArray(extractedData)) {
                            extractedData.forEach(item => {
                                results.push({
                                    ...item,
                                    meta: {
                                        title: item.url || fullUrl, // Shows the stream URL as title
                                        countryCodes: ['de']
                                    }
                                });
                            });
                        } else {
                            // If extractVoe returns a single object
                            results.push({
                                ...extractedData,
                                meta: {
                                    title: extractedData.url || fullUrl,
                                    countryCodes: ['de']
                                }
                            });
                        }
                    }
                } catch (e) {
                    console.error(`[Filmpalast] VOE extraction failed for ${fullUrl}:`, e.message);
                }
            } 
            // All other hosters are ignored as they don't match the VOE filter.
        }

    } catch (error) {
        console.error(`[Filmpalast] Scraper failed: ${error.message}`);
    }

    // Deduplicate in case the same link appears twice on the page
    return results.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
}

module.exports = { getStreams };

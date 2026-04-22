// src/sources/filmpalast.js
const cheerio = require('cheerio-without-node-native');

// Import the VOE extractor from the path you provided
const { extractVoe } = require('../extractor/voe.js');

const BASE_URL = 'https://filmpalast.to';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Referer': BASE_URL
};

// ================= HELPERS =================

async function getImdbId(tmdbId, type) {
    const targetType = type === 'series' ? 'tv' : 'movie';
    const response = await fetch(`${TMDB_BASE_URL}/${targetType}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
    const data = await response.json();
    return data?.imdb_id || null;
}

// ================= MAIN =================

async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    const results = [];
    
    try {
        const imdbId = await getImdbId(tmdbId, mediaType);
        if (!imdbId) return [];

        // Step 1: Autocomplete search
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

        // Step 2: Find the main stream page
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

        // Step 3: Extract and Parse VOE Links
        const streamHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        const $stream = cheerio.load(streamHtml);
        const linkElements = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a');

        // We use a for...of loop to properly await the async extractor
        for (const element of linkElements.toArray()) {
            const href = $stream(element).attr('href');
            if (!href || href === '#' || href.includes('javascript:void')) continue;

            const fullUrl = href.startsWith('http') ? href : (href.startsWith('//') ? `https:${href}` : `https://${href}`);

            // ONLY process if it's a VOE link
            if (fullUrl.includes('voe.sx')) {
                try {
                    const extractedStream = await extractVoe(fullUrl);
                    
                    if (extractedStream && extractedStream.url) {
                        results.push({
                            url: extractedStream.url, // The direct .m3u8 link
                            meta: {
                                // Forces the direct URL to be the title in the UI
                                title: extractedStream.url, 
                                countryCodes: ['de']
                            }
                        });
                    }
                } catch (e) {
                    console.error(`[Filmpalast] VOE extraction failed: ${e.message}`);
                }
            }
        }

    } catch (error) {
        console.error(`[Filmpalast] Scraper failed: ${error.message}`);
    }

    // Deduplicate results
    return results.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
}

module.exports = { getStreams };

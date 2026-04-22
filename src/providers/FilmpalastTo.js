const cheerio = require('cheerio-without-node-native');

const BASE_URL = 'https://filmpalast.to';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Referer': BASE_URL
};

// ==========================================
// 1. INTEGRATED VOE DECODER (Logic from voe.js)
// ==========================================

const voeDecoder = {
    shiftLetters(input) {
        return input.replace(/[a-zA-Z]/g, (c) => {
            const base = c <= 'Z' ? 65 : 97;
            return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
        });
    },

    replaceJunk(input) {
        const junkParts = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
        let result = input;
        junkParts.forEach(junk => {
            result = result.split(junk).join("_");
        });
        return result.replace(/_/g, "");
    },

    shiftBack(s, n) {
        return Array.from(s)
            .map(c => String.fromCharCode(c.charCodeAt(0) - n))
            .join('');
    },

    decode(encoded) {
        try {
            // Step 1: ROT13
            let step1 = this.shiftLetters(encoded);
            // Step 2: Junk removal
            let step2 = this.replaceJunk(step1);
            // Step 3: Base64 decode
            let step3 = Buffer.from(step2, 'base64').toString('utf-8');
            // Step 4: CharCode Shift
            let step4 = this.shiftBack(step3, 3);
            // Step 5: Reverse and Base64 decode
            let reversed = step4.split('').reverse().join('');
            let step5 = Buffer.from(reversed, 'base64').toString('utf-8');
            
            return JSON.parse(step5);
        } catch (e) {
            return null;
        }
    }
};

async function extractVoe(url) {
    try {
        const response = await fetch(url, { headers: DEFAULT_HEADERS });
        const html = await response.text();

        // Find the redirect/landing URL
        const pattern = /https?:\/\/[^'"<>]+/g;
        const matches = html.match(pattern);
        if (!matches) return null;

        const redirectUrl = matches[0];
        const urlObj = new URL(redirectUrl);
        
        const redirectHeaders = {
            ...DEFAULT_HEADERS,
            'Referer': `${urlObj.protocol}//${urlObj.host}/`
        };

        const redirectResponse = await fetch(redirectUrl, { headers: redirectHeaders });
        const redirectHtml = await redirectResponse.text();
        const $ = cheerio.load(redirectHtml);

        // Extract from application/json script tag
        const scriptTag = $('script[type="application/json"]').first();
        if (scriptTag.length > 0) {
            let raw = scriptTag.html().trim();
            if (raw.length > 4) {
                const trimmed = raw.substring(2, raw.length - 2);
                const decoded = voeDecoder.decode(trimmed);
                if (decoded && decoded.source) {
                    return decoded.source;
                }
            }
        }

        // Fallback: var a168c
        const a168cMatch = redirectHtml.match(/var a168c='([^']+)'/);
        if (a168cMatch) {
            const decoded = Buffer.from(a168cMatch[1], 'base64').toString('utf-8');
            const reversed = decoded.split('').reverse().join('');
            const json = JSON.parse(reversed);
            if (json.source) return json.source;
        }

    } catch (error) {
        console.error(`[VOE Extractor] Error: ${error.message}`);
    }
    return null;
}

// ==========================================
// 2. MAIN SCRAPER LOGIC
// ==========================================

async function getImdbId(tmdbId, type) {
    const targetType = type === 'series' ? 'tv' : 'movie';
    const response = await fetch(`${TMDB_BASE_URL}/${targetType}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
    const data = await response.json();
    return data?.imdb_id || null;
}

async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    const results = [];
    
    try {
        const imdbId = await getImdbId(tmdbId, mediaType);
        if (!imdbId) return [];

        // Step 1: Search Filmpalast via Autocomplete
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

        // Step 3: Extract and Filter VOE Links
        const streamHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        const $stream = cheerio.load(streamHtml);
        const linkElements = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a');

        for (const element of linkElements.toArray()) {
            const href = $stream(element).attr('href');
            if (!href || href === '#' || href.includes('javascript:void')) continue;

            const fullUrl = href.startsWith('http') ? href : (href.startsWith('//') ? `https:${href}` : `https://${href}`);

            // ONLY process if it's a VOE link
            if (fullUrl.includes('voe.sx')) {
                const directUrl = await extractVoe(fullUrl);
                if (directUrl) {
                    results.push({
                        url: directUrl, // Direct .m3u8 link
                        meta: {
                            title: directUrl, // Show full URL as requested
                            countryCodes: ['de']
                        }
                    });
                }
            }
        }

    } catch (error) {
        console.error(`[Filmpalast] Scraper failed: ${error.message}`);
    }

    // Deduplicate results
    return results.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
}

// ==========================================
// 3. EXPORTS
// ==========================================

module.exports = { getStreams };

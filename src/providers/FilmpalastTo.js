var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://filmpalast.to';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';
var UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36';

var DEFAULT_HEADERS = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Referer': BASE_URL
};

var VOE_MIRRORS = ['voe.sx', 'chuckle-tube.com', 'goofy-banana.com', 'smoki.cc', 'kinoger.ru', 'v-o-e-unblock.com'];

// Helper for Base64 (Works in Node and Browser/RN)
const b64Decode = (str) => {
    try {
        return typeof Buffer !== 'undefined' 
            ? Buffer.from(str, 'base64').toString('utf-8') 
            : atob(str);
    } catch (e) { return ""; }
};

// ==========================================
// OPTIMIZED VOE DECODER
// ==========================================
var voeDecoder = {
    decode: function(encoded) {
        try {
            // Combined Shift & Junk removal in one pass
            var s1 = encoded.replace(/[a-zA-Z]/g, function(c) {
                var base = c <= 'Z' ? 65 : 97;
                return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
            }).replace(/(@\$|\^\^|~@|%\?|\*~|!!|#&)/g, "");

            var s3 = b64Decode(s1);
            // Shift back 3
            var s4 = "";
            for (var i = 0; i < s3.length; i++) { s4 += String.fromCharCode(s3.charCodeAt(i) - 3); }
            
            var s5 = b64Decode(s4.split('').reverse().join(''));
            return JSON.parse(s5);
        } catch (e) { return null; }
    }
};

// ==========================================
// OPTIMIZED EXTRACTORS
// ==========================================

async function extractVoe(urlStr) {
    try {
        var response = await fetch(urlStr, { headers: DEFAULT_HEADERS });
        var html = await response.text();

        // Fast Regex check instead of full Cheerio load for Method 2 & 3
        var hlsMatch = html.match(/'hls':\s*'([^']+)'/);
        if (hlsMatch) return b64Decode(hlsMatch[1]);

        var a168Match = html.match(/var a168c='([^']+)'/);
        if (a168Match) return JSON.parse(b64Decode(a168Match[1]).split('').reverse().join('')).source;

        // Method 1 (Json)
        var $ = cheerio.load(html);
        var script = $('script[type="application/json"]').first().html();
        if (script) {
            var trimmed = script.trim();
            var decoded = voeDecoder.decode(trimmed.substring(2, trimmed.length - 2));
            if (decoded?.source) return decoded.source;
        }
    } catch (e) { return null; }
}

// ==========================================
// MAIN SCRAPER
// ==========================================

async function getStreams(tmdbId, mediaType) {
    try {
        // 1. Parallel Fetch: Get TMDB Data
        var type = mediaType === 'series' ? 'tv' : 'movie';
        var tmdbUrl = `${TMDB_BASE_URL}/${type}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
        var idData = await fetch(tmdbUrl).then(r => r.json());
        if (!idData.imdb_id) return [];

        // 2. Search Filmpalast
        var searchRes = await fetch(`${BASE_URL}/autocomplete.php`, {
            method: 'POST',
            headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `term=${idData.imdb_id}`
        }).then(r => r.json());

        if (!searchRes?.length) return [];

        // 3. Navigate to Stream Page (optimized pathing)
        var targetTitle = searchRes.find(t => !t.toLowerCase().includes('english')) || searchRes[0];
        var searchPageUrl = `${BASE_URL}/search/title/${encodeURIComponent(targetTitle)}`;
        var searchHtml = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        
        var $search = cheerio.load(searchHtml);
        var href = $search('a[href*="/stream/"]').first().attr('href');
        if (!href) return [];

        var streamPageUrl = BASE_URL + (href.startsWith('/') ? href : '/' + href).replace('/filmpalast.to', '');
        var streamHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        
        // 4. Extract Hoster Links
        var $stream = cheerio.load(streamHtml);
        var links = $stream('.currentStreamLinks a, .hosterSite span a').toArray()
            .map(el => $stream(el).attr('href'))
            .filter(h => h && !h.includes('javascript'));

        // 5. CONCURRENT EXTRACTION (The big speed boost)
        var streamPromises = links.map(async (url) => {
            var fullUrl = url.startsWith('//') ? 'https:' + url : (url.startsWith('http') ? url : 'https://' + url);
            
            if (VOE_MIRRORS.some(m => fullUrl.includes(m))) {
                const src = await extractVoe(fullUrl);
                return src ? { url: src, meta: { title: "[VOE] Filmpalast", countryCodes: ['de'] } } : null;
            }
            return null;
        });

        var results = await Promise.all(streamPromises);
        return results.filter(r => r !== null);

    } catch (e) {
        console.error("[Filmpalast] Fatal Error:", e);
        return [];
    }
}

module.exports = { getStreams };
